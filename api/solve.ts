// /api/solve.ts
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Initialize Supabase client with SERVICE_ROLE_KEY for server-side operations
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { startDate, endDate } = req.body;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  try {
    // 1. Create a new 'pending' run in Supabase
    const { data: run, error: insertError } = await supabase
      .from('runs')
      .insert({
        status: 'PENDING',
        start_date: startDate,
        end_date: endDate,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // 2. Asynchronously trigger the Python solver microservice
    //    We don't await this; we let it run in the background.
    fetch(process.env.SOLVER_URL!, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SOLVER_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        run_id: run.id,
        // Pass any other necessary options to the solver here
      }),
    }).catch(fetchError => {
        // If the trigger fails, update the run status to FAILED
        console.error('Solver trigger failed:', fetchError);
        supabase.from('runs').update({ status: 'FAILED', error_text: 'Solver service could not be reached.' }).eq('id', run.id).then();
    });
    
    // 3. Immediately respond to the client with the run ID
    return res.status(202).json({ run_id: run.id });

  } catch (error: any) {
    console.error('Error in /api/solve:', error);
    return res.status(500).json({ error: error.message });
  }
}