// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// This function needs to be outside the handler to be memoized correctly by Vercel
const getGoogleAuthClient = () => {
  try {
    const base64Key = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64;
    if (!base64Key) {
      throw new Error('GCP_SERVICE_ACCOUNT_KEY_BASE64 env var is not set.');
    }
    
    // Decode the Base64 string to get the JSON key file content
    const keyFileContent = Buffer.from(base64Key, 'base64').toString('utf-8');
    const credentials = JSON.parse(keyFileContent);

    // Initialize Google Auth client using the decoded credentials
    return new GoogleAuth({
      credentials,
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
  } catch (error: any) {
    console.error('Failed to initialize GoogleAuth:', error.message);
    return null;
  }
};

const auth = getGoogleAuthClient();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[/api/solve] Function invoked.');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { startDate, endDate } = req.body;
  console.log(`[/api/solve] Received request with startDate: ${startDate}, endDate: ${endDate}`);
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required.' });
  }
  
  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) {
    console.error('[/api/solve] FATAL: SOLVER_URL is not configured.');
    return res.status(500).json({ error: 'Server configuration error: SOLVER_URL is not set.' });
  }

  if (!auth) {
    console.error('[/api/solve] FATAL: Google Auth client failed to initialize. Check GCP_SERVICE_ACCOUNT_KEY_BASE64 variable.');
    return res.status(500).json({ error: 'Server configuration error: Could not initialize authentication.' });
  }

  let newRunId: string | null = null;
  try {
    // 1. Create a new run record in Supabase
    console.log('[/api/solve] Creating new run record in Supabase...');
    const { data: newRun, error: insertError } = await supabase
      .from('runs')
      .insert({ start_date: startDate, end_date: endDate, status: 'PENDING' })
      .select('id')
      .single();

    if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);
    if (!newRun) throw new Error('Failed to create a new run record in Supabase.');
    
    newRunId = newRun.id;
    console.log(`[/api/solve] Successfully created run record with ID: ${newRunId}`);

    // 2. Get an OIDC-authenticated client
    console.log(`[/api/solve] Generating OIDC token for audience: ${solverUrl}`);
    const client = await auth.getIdTokenClient(solverUrl);
    console.log('[/api/solve] OIDC token client created successfully.');
    
    const solverEndpoint = `${solverUrl}/solve`;
    console.log(`[/api/solve] Making direct POST request to solver at: ${solverEndpoint}`);

    // 3. Make the authenticated request to the solver
    const response = await client.request({
      url: solverEndpoint,
      method: 'POST',
      data: { run_id: newRunId },
      headers: { 'Content-Type': 'application/json' },
    });

    console.log(`[/api/solve] Solver service responded with status: ${response.status}`);
    
    if (response.status < 200 || response.status >= 300) {
      const responseBody = response.data ? JSON.stringify(response.data) : 'No response body';
      throw new Error(`Solver service responded with error status ${response.status}: ${responseBody}`);
    }

    // 4. Immediately return the run_id to the frontend
    console.log(`[/api/solve] Successfully initiated solver. Returning 202 with run_id: ${newRunId}`);
    return res.status(202).json({ run_id: newRunId });

  } catch (error: any) {
    const errorMessage = error.response?.data || error.message;
    console.error(`[/api/solve] CRITICAL ERROR for run_id ${newRunId}:`, errorMessage);
    
    if (newRunId) {
        console.log(`[/api/solve] Marking run ${newRunId} as FAILED in database.`);
        await supabase
          .from('runs')
          .update({ status: 'FAILED', error_text: `Vercel function error: ${errorMessage}` })
          .eq('id', newRunId);
    }
    
    return res.status(500).json({ error: 'Failed to initiate schedule generation.', details: errorMessage });
  }
}
