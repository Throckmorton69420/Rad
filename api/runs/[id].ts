// /api/runs/[id].ts
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'A valid run ID is required.' });
  }

  try {
    // 1. Fetch the run status and progress
    const { data: run, error: runError } = await supabase
      .from('runs')
      .select('id, status, objective_values, error_text, progress')
      .eq('id', id)
      .single();

    if (runError) throw runError;
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    // 2. If complete, fetch the associated schedule slots
    if (run.status === 'COMPLETE') {
      const { data: slots, error: slotsError } = await supabase
        .from('schedule_slots')
        .select('*')
        .eq('run_id', id)
        .order('date', { ascending: true })
        .order('start_minute', { ascending: true });

      if (slotsError) throw slotsError;
      
      return res.status(200).json({ ...run, slots });
    }

    // 3. If still pending or solving, just return the current status and progress
    return res.status(200).json(run);

  } catch (error: any) {
    console.error(`Error in /api/runs/${id}:`, error);
    return res.status(500).json({ error: error.message });
  }
}