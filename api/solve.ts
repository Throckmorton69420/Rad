// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { CloudTasksClient } from '@google-cloud/tasks';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'buffer';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Google Cloud Tasks client
const tasksClient = new CloudTasksClient();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[/api/solve] Cloud Tasks invocation handler started.');

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
  const requiredEnv = ['SOLVER_URL', 'GCP_PROJECT_ID', 'GCP_QUEUE_LOCATION', 'GCP_QUEUE_NAME', 'GCP_CLIENT_EMAIL'];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`[/api/solve] FATAL: Server configuration error. Missing environment variable: ${key}`);
      return res.status(500).json({ error: `Server configuration error: ${key} is not set.` });
    }
  }

  const solverUrl = process.env.SOLVER_URL!;
  const projectId = process.env.GCP_PROJECT_ID!;
  const queueLocation = process.env.GCP_QUEUE_LOCATION!;
  const queueName = process.env.GCP_QUEUE_NAME!;
  const serviceAccountEmail = process.env.GCP_CLIENT_EMAIL!;

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

    // 2. Construct the Cloud Task
    const parent = tasksClient.queuePath(projectId, queueLocation, queueName);
    const taskPayload = { run_id: newRunId };
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${solverUrl}/solve`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
        oidcToken: {
          serviceAccountEmail: serviceAccountEmail,
        },
      },
    };

    // 3. Create and dispatch the task
    console.log(`[/api/solve] Creating Cloud Task to call ${solverUrl}/solve for run_id ${newRunId}`);
    const [response] = await tasksClient.createTask({ parent, task });
    console.log(`[/api/solve] Successfully created Cloud Task: ${response.name}`);

    // 4. Immediately return the run_id to the frontend
    console.log(`[/api/solve] Task creation successful. Returning 202 with run_id: ${newRunId}`);
    return res.status(202).json({ run_id: newRunId });

  } catch (error: any) {
    const errorMessage = error.message || 'An unknown error occurred.';
    console.error(`[/api/solve] CRITICAL ERROR for run_id ${newRunId}: ${errorMessage}`, error);

    if (newRunId) {
      console.log(`[/api/solve] Marking run ${newRunId} as FAILED in database due to task creation failure.`);
      await supabase
        .from('runs')
        .update({ status: 'FAILED', error_text: `Vercel function error: ${errorMessage}` })
        .eq('id', newRunId);
    }
    
    return res.status(500).json({ error: 'Failed to initiate schedule generation.', details: errorMessage });
  }
}