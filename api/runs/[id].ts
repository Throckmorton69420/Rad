// MOCK API - In a real application, this would fetch the status of a solver job from a database.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const { id } = req.query;
  const runId = Array.isArray(id) ? id[0] : id;

  if (!runId || !runId.startsWith('run_')) {
    return res.status(400).json({ error: 'Invalid run ID format.' });
  }

  try {
    const startTime = parseInt(runId.split('_')[1], 10);
    if (isNaN(startTime)) {
        throw new Error('Invalid timestamp in run ID');
    }
    const elapsed = Date.now() - startTime;
    const mockSolveTime = 10000; // 10-second mock solve time

    if (elapsed < mockSolveTime) {
      // If not enough time has passed, report that the job is still solving.
      res.status(200).json({ id: runId, status: 'SOLVING' });
    } else {
      // After the mock solve time, report completion.
      // A real implementation would return the schedule slots from the solver.
      // Here, we return an empty array, which the frontend can handle.
      res.status(200).json({
        id: runId,
        status: 'COMPLETE',
        slots: [], // No tasks generated in this mock response.
        error_text: null,
      });
    }
  } catch (error) {
    return res.status(400).json({ error: 'Invalid run ID.' });
  }
}
