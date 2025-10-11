// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Google Auth client using credentials from environment variables
const auth = new GoogleAuth({
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required.' });
  }
  
  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) {
    return res.status(500).json({ error: 'SOLVER_URL is not configured.' });
  }

  let newRunId: string | null = null;
  try {
    // 1. Create a new run record in Supabase
    console.log('Creating new run record in Supabase...');
    const { data: newRun, error: insertError } = await supabase
      .from('runs')
      .insert({ start_date: startDate, end_date: endDate, status: 'PENDING' })
      .select('id')
      .single();

    if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);
    if (!newRun) throw new Error('Failed to create a new run record in Supabase.');
    
    newRunId = newRun.id;
    console.log(`Successfully created run record with ID: ${newRunId}`);

    // 2. Get an OIDC-authenticated client to call the Cloud Run service directly
    console.log(`Generating OIDC token for audience: ${solverUrl}`);
    const client = await auth.getIdTokenClient(solverUrl);
    
    const solverEndpoint = `${solverUrl}/solve`;
    console.log(`Making direct POST request to solver at: ${solverEndpoint}`);

    // 3. Make the authenticated request to the solver
    const response = await client.request({
      url: solverEndpoint,
      method: 'POST',
      data: { run_id: newRunId },
      headers: { 'Content-Type': 'application/json' },
    });

    console.log(`Solver service responded with status: ${response.status}`);
    
    // Check for a successful (2xx) response from the solver
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Solver service responded with error status ${response.status}: ${response.data}`);
    }

    // 4. Immediately return the run_id to the frontend
    return res.status(202).json({ run_id: newRunId });

  } catch (error: any) {
    console.error('Critical Error in /api/solve:', error.response?.data || error.message);
    if (newRunId) {
        // If the process failed, mark the run as FAILED in the database for debugging.
        await supabase
          .from('runs')
          .update({ status: 'FAILED', error_text: error.message })
          .eq('id', newRunId);
    }
    return res.status(500).json({ error: 'Failed to initiate schedule generation.', details: error.message });
  }
}
