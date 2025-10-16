export interface GeneratePayload {
  startDate: string;
  endDate: string;
  dailyStudyMinutes?: number;
  includeOptional?: boolean;
}

export interface RebalancePayload extends GeneratePayload {
  rebalanceType:
    | 'standard'
    | 'topic-time'
    | 'deadline-change'
    | 'date-change'
    | 'topic-rearrange'
    | 'exception-change'
    | 'task-edit';
  completedTasks: string[];
  preserveCompletedDate?: boolean;
  topics?: string[];
  dayTotalMinutes?: number;
  deadlines?: Record<string, string>;
}

export interface GenerateResult {
  schedule?: unknown;
  [k: string]: unknown;
}

async function postJson<T = any>(url: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await res.json() : await res.text();
  return { ok: res.ok, status: res.status, json: isJson ? payload : undefined, text: isJson ? undefined : payload } as {
    ok: boolean; status: number; json?: T; text?: string;
  };
}

export async function generateSchedule(baseUrl: string, payload: GeneratePayload, signal?: AbortSignal) {
  const { ok, status, json, text } = await postJson(`${baseUrl.replace(/\/$/,'')}/schedule`, payload, signal);
  if (ok) return json as GenerateResult;
  throw new Error(`POST /schedule failed: ${status} ${text || JSON.stringify(json)}`);
}

export async function rebalanceSchedule(baseUrl: string, payload: RebalancePayload, signal?: AbortSignal) {
  const { ok, status, json, text } = await postJson(`${baseUrl.replace(/\/$/,'')}/rebalance`, payload, signal);
  if (ok) return json as GenerateResult;
  throw new Error(`POST /rebalance failed: ${status} ${text || JSON.stringify(json)}`);
}
