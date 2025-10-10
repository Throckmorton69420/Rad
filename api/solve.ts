// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { CloudTasksClient } from '@google-cloud/tasks';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// This function is now responsible for:
// 1. Creating a 'run' record in Supabase.
// 2. Creating a Google Cloud Task to trigger the solver.
// 3. Returning the run_id immediately to the frontend.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Cloud Tasks client
const tasksClient = new CloudTasksClient();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required.' });
  }
  
  try {
    // 1. Create a new run record in Supabase to get a run_id
    const { data: newRun, error: insertError } = await supabase
      .from('runs')
      .insert({ start_date: startDate, end_date: endDate, status: 'PENDING' })
      .select('id')
      .single();

    if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);
    if (!newRun) throw new Error("Failed to create a new run record in Supabase.");
    
    const run_id = newRun.id;

    // 2. Create a Google Cloud Task to trigger the solver
    const project = process.env.GCP_PROJECT_ID!;
    const queue = process.env.GCP_QUEUE_NAME!;
    const location = process.env.GCP_QUEUE_LOCATION!;
    const solverUrl = process.env.SOLVER_URL!;
    const internalApiToken = process.env.INTERNAL_API_TOKEN!;

    const parent = tasksClient.queuePath(project, location, queue);

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${solverUrl}/internal/run-solver`, // The new internal, secure endpoint
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${internalApiToken}`, // Secure the endpoint
        },
        body: Buffer.from(JSON.stringify({ run_id })).toString('base64'),
      },
    };

    // Send the task to the queue
    const [taskResponse] = await tasksClient.createTask({ parent, task });
    console.log(`Created task ${taskResponse.name}`);

    // 3. Immediately return the run_id to the frontend
    return res.status(202).json({ run_id: run_id });

  } catch (error: any) {
    console.error('Critical Error in /api/solve:', error);
    // Attempt to clean up the created run record if task creation failed
    if (error.run_id_to_cleanup) {
        await supabase.from('runs').delete().eq('id', error.run_id_to_cleanup);
    }
    return res.status(500).json({ error: 'Failed to initiate schedule generation.', details: error.message });
  }
}
