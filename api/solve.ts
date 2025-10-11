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

// --- Corrected Google Auth Initialization ---
// 1. Decode the entire base64'd JSON key file content.
const keyFileContent = Buffer.from(process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64!, 'base64').toString('utf8');

// 2. Parse the decoded string into a JSON object.
const credentials = JSON.parse(keyFileContent);

// 3. The Google Auth library requires the private key to have literal newlines.
//    The `replace` call handles formatting issues from environment variables.
const privateKeyWithNewlines = credentials.private_key.replace(/\\n/g, '\n');

// 4. Initialize the auth client with the correctly parsed credentials.
const auth = new GoogleAuth({
  credentials: {
    client_email: credentials.client_email,
    private_key: privateKeyWithNewlines,
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

  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) {
    console.error('[/api/solve] FATAL: Server configuration error. Missing SOLVER_URL.');
    return res.status(500).json({ error: 'Server configuration error: SOLVER_URL is not set.' });
  }

  let newRunId: string | null = null;
  try {
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

    console.log(`[/api/solve] Requesting OIDC token for Cloud Run service: ${solverUrl}`);
    const client = await auth.getIdTokenClient(solverUrl);
    
    const solverPayload = { run_id: newRunId };

    console.log(`[/api/solve] Invoking solver at ${solverUrl}/solve for run_id ${newRunId}`);
    const solverResponse = await client.request({
      url: `${solverUrl}/solve`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(solverPayload),
    });

    if (solverResponse.status !== 202) {
      const responseBody = solverResponse.data ? JSON.stringify(solverResponse.data) : 'No response body';
      throw new Error(`Solver service responded with status ${solverResponse.status}. Body: ${responseBody}`);
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