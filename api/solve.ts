// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import { CloudTasksClient } from '@google-cloud/tasks';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize the Cloud Tasks client using credentials from environment variables
const tasksClient = new CloudTasksClient({
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    // Vercel handles multi-line env vars by replacing \n with \\n, so we need to fix it back.
    private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }
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
    const serviceAccountEmail = process.env.GCP_CLIENT_EMAIL!;

    const parent = tasksClient.queuePath(project, location, queue);

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${solverUrl}/internal/run-solver`, // Targeting the new internal endpoint
        headers: {
          'Content-Type': 'application/json',
        },
        // OIDC token provides secure authentication between Google services
        oidcToken: {
          serviceAccountEmail,
          // CRITICAL FIX: The 'audience' must be specified for the token to be valid for the target service.
          audience: solverUrl,
        },
        body: Buffer.from(JSON.stringify({ run_id: newRunId })).toString('base64'),
      },
    };

    const [taskResponse] = await tasksClient.createTask({ parent, task });
    console.log(`Created task ${taskResponse.name} for run_id ${newRunId}`);

    // 3. Immediately return the run_id to the frontend
    return res.status(202).json({ run_id: newRunId });

  } catch (error: any) {
    console.error('Critical Error in /api/solve:', error);
    if (newRunId) {
        // Clean up the failed run record
        await supabase.from('runs').delete().eq('id', newRunId);
    }
    return res.status(500).json({ error: 'Failed to initiate schedule generation.', details: error.message });
  }
}
