// services/orToolsClient.ts
// Drop-in client to call the backend OR-Tools scheduler without altering existing scheduleGenerator.ts usage.
// Provides a safe wrapper with endpoint fallback to match the current FastAPI service.

export interface GeneratePayload {
  startDate: string; // ISO date (YYYY-MM-DD)
  endDate: string;   // ISO date (YYYY-MM-DD)
  dailyStudyMinutes?: number; // default 840
  includeOptional?: boolean;  // default true
}

export interface GenerateResult {
  // The backend returns a day-by-day schedule formatted for the existing React app.
  // Keep as unknown-typed structure to avoid tight coupling; callers can narrow.
  schedule?: unknown;
  [k: string]: unknown;
}

async function postJson<T = any>(url: string, body: unknown, signal?: AbortSignal): Promise<{ ok: boolean; status: number; json?: T; text?: string; }>{
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await res.json();
    return { ok: res.ok, status: res.status, json };
  } else {
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  }
}

/**
 * Generate a study schedule using the backend service.
 * Tries /schedule first (current main.py shape), then falls back to /optimize.
 * This avoids breaking changes while allowing a toggle without removing scheduleGenerator.ts.
 */
export async function generateSchedule(
  baseUrl: string,
  payload: GeneratePayload,
  signal?: AbortSignal
): Promise<GenerateResult> {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  const endpoints = ["/schedule", "/optimize"]; // try both, in order
  const errors: string[] = [];

  for (const ep of endpoints) {
    try {
      const { ok, status, json, text } = await postJson(`${trimmedBase}${ep}`, payload, signal);
      if (ok) return (json as GenerateResult) ?? {};
      errors.push(`POST ${ep} -> ${status}: ${text || JSON.stringify(json)}`);
      // 404/405 means try next endpoint
      if (status === 404 || status === 405) continue;
    } catch (e: any) {
      errors.push(`POST ${ep} -> exception: ${e?.message || e}`);
      continue;
    }
  }

  const err = `All endpoints failed. Tried ${endpoints.join(", ")}. Errors: ${errors.join(" | ")}`;
  throw new Error(err);
}
export interface RebalancePayload extends GeneratePayload {
  rebalanceType: 'standard' | 'topic-rearrange' | 'deadline-change';
  completedTasks: string[];
  preserveCompletedDate?: boolean;
}

/**
 * Rebalance existing schedule while preserving completed tasks
 */
export async function rebalanceSchedule(
  baseUrl: string,
  payload: RebalancePayload,
  signal?: AbortSignal
): Promise<GenerateResult> {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  const { ok, status, json, text } = await postJson(`${trimmedBase}/rebalance`, payload, signal);
  
  if (ok) return (json as GenerateResult) ?? {};
  
  const err = `Rebalance failed: ${status} - ${text || JSON.stringify(json)}`;
  throw new Error(err);
}
