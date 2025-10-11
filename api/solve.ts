// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'buffer';

// Initialize Supabase client for server-side access
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Google Auth client
// The credentials will be automatically sourced from environment variables.
const auth = new GoogleAuth({
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: Buffer.from(process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64!, 'base64').toString('utf8'),
  },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[/api/solve] Direct invocation handler started.');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) {
    console.error('[/api/solve] Bad Request: startDate and endDate are required.');
    return res.status(400).json({ error: 'startDate and endDate are required.' });
  }

  // --- Environment Variable Validation ---
  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) {
    console.error('[/api/solve] FATAL: Server configuration error. Missing SOLVER_URL.');
    return res.status(500).json({ error: 'Server configuration error: SOLVER_URL is not set.' });
  }

  let newRunId: string | null = null;
  try {
    // 1. Create a new run record in Supabase to get a run_id
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

    // 2. Get an authenticated client for invoking the Cloud Run service
    console.log(`[/api/solve] Requesting OIDC token for Cloud Run service: ${solverUrl}`);
    const client = await auth.getIdTokenClient(solverUrl);
    
    // 3. Prepare the request payload for the solver
    const solverPayload = { run_id: newRunId };

    // 4. Make the authenticated request to the solver
    console.log(`[/api/solve] Invoking solver at ${solverUrl}/solve for run_id ${newRunId}`);
    const solverResponse = await client.request({
      url: `${solverUrl}/solve`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(solverPayload),
    });

    // The Python solver returns 202 Accepted immediately and runs in the background.
    // We just need to check that the request was accepted.
    if (solverResponse.status !== 202) {
      throw new Error(`Solver service responded with status ${solverResponse.status}. Body: ${JSON.stringify(solverResponse.data)}`);
    }

    console.log(`[/api/solve] Solver invocation successful. Returning 202 with run_id: ${newRunId}`);
    return res.status(202).json({ run_id: newRunId });

  } catch (error: any) {
    const errorMessage = error.response?.data?.error || error.message || 'An unknown error occurred.';
    console.error(`[/api/solve] CRITICAL ERROR for run_id ${newRunId}: ${errorMessage}`, error);

    if (newRunId) {
      console.log(`[/api/solve] Marking run ${newRunId} as FAILED due to invocation error.`);
      await supabase
        .from('runs')
        .update({ status: 'FAILED', error_text: `Vercel function error: ${errorMessage}` })
        .eq('id', newRunId);
    }
    
    return res.status(500).json({ error: 'Failed to initiate schedule generation.', details: errorMessage });
  }
}