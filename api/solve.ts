// /api/solve.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

// Centralized logger for clarity
const log = (message: string, data?: any) => {
  if (data) {
    // Using console.dir for better object inspection in Vercel logs
    console.log(message);
    console.dir(data, { depth: null });
  } else {
    console.log(message);
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  log('--- Vercel /api/solve Function Invoked ---');

  if (req.method !== 'POST') {
    log(`[405] Method Not Allowed: Received ${req.method}`);
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Step 1: Validate all required environment variables
    log('Step 1: Validating environment variables...');
    const {
      GCP_SERVICE_ACCOUNT_KEY_BASE64,
      SOLVER_URL,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
    } = process.env;

    if (!GCP_SERVICE_ACCOUNT_KEY_BASE64) throw new Error('CRITICAL: Missing Vercel env var: GCP_SERVICE_ACCOUNT_KEY_BASE64');
    if (!SOLVER_URL) throw new Error('CRITICAL: Missing Vercel env var: SOLVER_URL');
    if (!SUPABASE_URL) throw new Error('CRITICAL: Missing Vercel env var: SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('CRITICAL: Missing Vercel env var: SUPABASE_SERVICE_ROLE_KEY');
    log('Step 1: All environment variables are present.');

    // Step 2: Decode and parse the service account key
    log('Step 2: Decoding and parsing GCP service account key from Base64...');
    const keyFileContent = Buffer.from(GCP_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf-8');
    const keyData = JSON.parse(keyFileContent);
    if (!keyData.client_email || !keyData.private_key) {
      throw new Error('Parsed GCP key is invalid. Missing client_email or private_key.');
    }
    log('Step 2: Key decoded and parsed successfully.');

    // Step 3: Initialize Supabase client
    log('Step 3: Initializing Supabase client...');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    log('Step 3: Supabase client initialized.');

    // Step 4: Create a new 'run' entry in Supabase
    log('Step 4: Creating new entry in Supabase "runs" table...', { startDate: req.body.startDate, endDate: req.body.endDate });
    const { data: run, error: runError } = await supabase
      .from('runs')
      .insert({
        status: 'PENDING',
        start_date: req.body.startDate,
        end_date: req.body.endDate,
      })
      .select()
      .single();

    if (runError) throw new Error(`Supabase error creating run: ${runError.message}`);
    if (!run) throw new Error('Failed to create and retrieve run from Supabase.');
    log('Step 4: Supabase run created successfully.', { run_id: run.id });

    // Step 5: Initialize Google Auth library
    log('Step 5: Initializing Google Auth...');
    const auth = new GoogleAuth({
      credentials: {
        client_email: keyData.client_email,
        private_key: keyData.private_key,
      },
    });
    log('Step 5: Google Auth initialized.');

    // Step 6: Get an OIDC token client for the Cloud Run URL
    log('Step 6: Creating OIDC token client for target audience...', { audience: SOLVER_URL });
    const client = await auth.getIdTokenClient(SOLVER_URL);
    log('Step 6: OIDC token client created.');

    // Step 7: Make the authenticated POST request to the solver
    log('Step 7: Making authenticated POST request to solver...', { url: SOLVER_URL + '/solve' });
    const solverResponse = await client.request({
      url: SOLVER_URL + '/solve',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: run.id }),
      timeout: 15000, // Increased timeout
    });
    log('Step 7: Solver request sent. Response status:', solverResponse.status);
    
    // Step 8: Check solver response status
    log('Step 8: Checking solver response...');
    if (solverResponse.status !== 202) {
        const responseBody = solverResponse.data;
        log('Step 8: Solver returned a non-202 status.', { status: solverResponse.status, body: responseBody });
        throw new Error(`Solver service responded with status ${solverResponse.status}.`);
    }
    log('Step 8: Solver responded with 202 Accepted.');

    // Step 9: Handle success and send response to frontend
    log('Step 9: Sending successful 202 response to frontend.');
    return res.status(202).json({ run_id: run.id });

  } catch (error: any) {
    const errorMessage = error.message || 'An unknown error occurred.';
    const errorStack = error.stack || 'No stack available.';
    log('--- FATAL ERROR in /api/solve ---', { errorMessage, errorStack });
    log('Full error object:', error);
    
    return res.status(500).json({ error: 'An internal server error occurred.', details: errorMessage });
  }
}
