// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { CloudTasksClient } from '@google-cloud/tasks';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// This function is now responsible for:
// 1. Creating a 'run' record in Supabase.
// 2. Creating a Google Cloud Task to trigger the solver WITH PROPER AUTHENTICATION.
// 3. Returning the run_id immediately to the frontend.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  
  let newRunId: string | null = null;
  try {
    // 1. Create a new run record in Supabase
    const { data: newRun, error: insertError } = await supabase
      .from('runs')
      .insert({ start_date: startDate, end_date: endDate, status: 'PENDING' })
      .select('id')
      .single();

    if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);
    if (!newRun) throw new Error("Failed to create a new run record in Supabase.");
    
    newRunId = newRun.id;

    // 2. Create a Google Cloud Task with OIDC authentication
    const project = process.env.GCP_PROJECT_ID!;
    const queue = process.env.GCP_QUEUE_NAME!;
    const location = process.env.GCP_QUEUE_LOCATION!;
    const solverUrl = process.env.SOLVER_URL!;
    // This is the email of the service account Vercel uses to create tasks
    const serviceAccountEmail = process.env.GCP_CLIENT_EMAIL!; 

    const parent = tasksClient.queuePath(project, location, queue);

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${solverUrl}/internal/run-solver`,
        headers: {
          'Content-Type': 'application/json',
        },
        // Add the OIDC token for authentication. This is the critical change.
        oidcToken: {
          serviceAccountEmail,
        },
        body: Buffer.from(JSON.stringify({ run_id: newRunId })).toString('base64'),
      },
      // Give the task a long time to be dispatched, just in case.
      dispatchDeadline: { seconds: 60 * 15 },
    };

    const [taskResponse] = await tasksClient.createTask({ parent, task });
    console.log(`Created task ${taskResponse.name} for run_id ${newRunId}`);

    // 3. Immediately return the run_id to the frontend
    return res.status(202).json({ run_id: newRunId });

  } catch (error: any) {
    console.error('Critical Error in /api/solve:', error);
    // If a run was created but task creation failed, delete the orphaned run
    if (newRunId) {
        await supabase.from('runs').delete().eq('id', newRunId);
    }
    return res.status(500).json({ error: 'Failed to initiate schedule generation.', details: error.message });
  }
}
