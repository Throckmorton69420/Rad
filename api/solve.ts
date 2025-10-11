// /api/solve.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // This is the most important log. If you see this, the test is a success.
  console.log('--- DIAGNOSTIC LOG: /api/solve function started successfully. ---');

  if (req.method !== 'POST') {
    console.log(`[405] Method Not Allowed: Received ${req.method}`);
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  console.log('DIAGNOSTIC: Request body:', req.body);
  
  // We respond immediately with a fake run_id to test the frontend flow.
  // The frontend should then try to poll for this ID, which will fail,
  // but that proves this function worked.
  const fakeRunId = `fake_${Date.now()}`;
  console.log(`DIAGNOSTIC: Responding with 202 and fake run_id: ${fakeRunId}`);
  
  return res.status(202).json({ run_id: fakeRunId });
}
