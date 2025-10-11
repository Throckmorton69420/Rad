// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'buffer';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Use console.log for Vercel logs
  console.log('--- Vercel /api/solve Function Invoked ---');

  if (req.method !== 'POST') {
    console.log(`[405] Method Not Allowed: Received ${req.method}`);
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Step 1: Validate incoming request body
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      console.error('[400] Bad Request: startDate and endDate are required.');
      return res.status(400).json({ error: 'startDate and endDate are required.' });
    }
    console.log(`Received request for dates: ${startDate} to ${endDate}`);

    // Step 2: Validate essential environment variables
    const solverUrl = process.env.SOLVER_URL;
    const gcpKeyBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64;

    if (!solverUrl) {
      console.error('[500] FATAL: Server configuration error. Missing SOLVER_URL.');
      return res.status(500).json({ error: 'Server configuration error: SOLVER_URL is not set.' });
    }
    if (!gcpKeyBase64) {
      console.error('[500] FATAL: Server configuration error. Missing GCP_SERVICE_ACCOUNT_KEY_BASE64.');
      return res.status(500).json({ error: 'Server configuration error: GCP key is not set.' });
    }
    console.log(`Solver URL configured: ${solverUrl}`);

    // Step 3: Decode and parse GCP credentials
    console.log('Decoding GCP key from Base64...');
    const keyFileContent = Buffer.from(gcpKeyBase64, 'base64').toString('utf8');
    const credentials = JSON.parse(keyFileContent);
    console.log(`Successfully parsed credentials for client_email: ${credentials.client_email}`);
    
    // Step 4: Format the private key
    const privateKeyWithNewlines = credentials.private_key.replace(/\\n/g, '\n');
    console.log('Private key formatted with newlines.');

    // Step 5: Initialize Google Auth
    console.log('Initializing GoogleAuth...');
    const auth = new GoogleAuth({
      credentials: {
        client_email: credentials.client_email,
        private_key: privateKeyWithNewlines,
      },
    });
    console.log('GoogleAuth initialized.');

    // Step 6: Create a new 'run' record in Supabase
    console.log('Creating new run record in Supabase...');
    const { data: newRun, error: insertError } = await supabase
      .from('runs')
      .insert({ start_date: startDate, end_date: endDate, status: 'PENDING' })
      .select('id')
      .single();

    if (insertError) {
        console.error('Supabase insert error:', insertError);
        throw new Error(`Supabase insert error: ${insertError.message}`);
    }
    if (!newRun) {
        throw new Error('Failed to create a new run record in Supabase (newRun data is null).');
    }
    const newRunId = newRun.id;
    console.log(`Successfully created run record with ID: ${newRunId}`);

    // Step 7: Get an OIDC token client
    console.log(`Requesting OIDC token client for audience: ${solverUrl}`);
    const client = await auth.getIdTokenClient(solverUrl);
    console.log('OIDC token client obtained.');

    // Step 8: Make the authenticated request to Cloud Run
    const solverPayload = { run_id: newRunId };
    console.log(`Invoking solver at ${solverUrl}/solve with payload:`, solverPayload);
    
    const solverResponse = await client.request({
      url: `${solverUrl}/solve`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(solverPayload),
      timeout: 10000, // 10 second timeout for the initial request
    });
    
    console.log(`Solver responded with status: ${solverResponse.status}`);
    
    // Step 9: Handle solver response
    if (solverResponse.status !== 202) {
      const responseBody = solverResponse.data ? JSON.stringify(solverResponse.data) : 'No response body';
      console.error(`Solver service responded with non-202 status. Body: ${responseBody}`);
      throw new Error(`Solver service responded with status ${solverResponse.status}.`);
    }

    console.log(`[202] Solver invocation successful. Returning run_id: ${newRunId}`);
    return res.status(202).json({ run_id: newRunId });

  } catch (error: any) {
    // Generic error handling for the entire function
    const errorMessage = error.response?.data?.error || error.message || 'An unknown error occurred.';
    console.error(`--- CRITICAL ERROR in /api/solve ---`);
    console.error(`Error message: ${errorMessage}`);
    console.error('Full error object:', error);
    
    // Note: Can't mark run as FAILED here if it was never created.
    // This logging is the most important part for debugging.
    
    return res.status(500).json({ 
        error: 'An internal error occurred while trying to start the schedule generation.', 
        details: errorMessage 
    });
  }
}