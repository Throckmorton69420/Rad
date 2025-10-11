// /api/runs/[id].ts
// FIX: This file was a placeholder. Implemented the API endpoint to poll the status of a solver run.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const log = (message: string, data?: any) => {
  if (data) {
    console.log(message);
    console.dir(data, { depth: null });
  } else {
    console.log(message);
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  log(`--- Vercel /api/runs/[id] Function Invoked for ID: ${req.query.id} ---`);

  if (req.method !== 'GET') {
    log(`[405] Method Not Allowed: Received ${req.method}`);
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Step 1: Validate environment variables and request query
    log('Step 1: Validating environment and request...');
    const runId = req.query.id as string;
    if (!runId) {
      throw new Error('Run ID is missing from the request query.');
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL) throw new Error('CRITICAL: Missing Vercel env var: SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('CRITICAL: Missing Vercel env var: SUPABASE_SERVICE_ROLE_KEY');
    log('Step 1: Validation successful.');

    // Step 2: Initialize Supabase client
    log('Step 2: Initializing Supabase client...');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    log('Step 2: Supabase client initialized.');

    // Step 3: Fetch the run details from Supabase
    log(`Step 3: Fetching run details for run_id: ${runId}...`);
    const { data: run, error: runError } = await supabase
      .from('runs')
      .select('*')
      .eq('id', runId)
      .single();

    if (runError) {
      if (runError.code === 'PGRST116') { // "The result contains 0 rows"
        log(`[404] Run not found in Supabase for id: ${runId}`);
        return res.status(404).json({ error: 'Run not found.' });
      }
      throw new Error(`Supabase error fetching run: ${runError.message}`);
    }
    log('Step 3: Run details fetched successfully.', { status: run.status });

    // Step 4: If the run is complete, fetch the associated schedule slots
    if (run.status === 'COMPLETE') {
      log(`Step 4: Run is COMPLETE. Fetching schedule_slots for run_id: ${runId}...`);
      const { data: slots, error: slotsError } = await supabase
        .from('schedule_slots')
        .select('*')
        .eq('run_id', runId);
      
      if (slotsError) {
        throw new Error(`Supabase error fetching schedule_slots: ${slotsError.message}`);
      }
      log(`Step 4: Fetched ${slots?.length || 0} schedule slots.`);
      
      // Combine run and slots data for the response
      const responsePayload = { ...run, slots: slots || [] };
      log('Step 5: Sending COMPLETE response with slots to frontend.');
      return res.status(200).json(responsePayload);
    } else {
      // If not complete, just return the run status
      log('Step 5: Sending PENDING/SOLVING/FAILED response to frontend.');
      return res.status(200).json(run);
    }

  } catch (error: any) {
    const errorMessage = error.message || 'An unknown error occurred.';
    log('--- FATAL ERROR in /api/runs/[id] ---', { errorMessage, errorStack: error.stack });
    return res.status(500).json({ error: 'An internal server error occurred.', details: errorMessage });
  }
}
