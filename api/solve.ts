// MOCK API - In a real application, this would trigger a backend solver job.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method === 'POST') {
    // In a real app, this would trigger a job and store its state in a database.
    // Here, we just generate a time-based ID for the polling endpoint to use.
    const run_id = `run_${Date.now()}`;
    res.status(202).json({ run_id });
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
