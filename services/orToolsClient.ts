// services/orToolsClient.ts
export type RebalanceType =
  | 'standard'
  | 'topic-time'
  | 'deadline-change'
  | 'date-change'
  | 'topic-rearrange'
  | 'exception-change'
  | 'task-edit';

export interface GeneratePayload {
  startDate: string;    // YYYY-MM-DD
  endDate: string;      // YYYY-MM-DD
  dailyStudyMinutes?: number; // default 840
  includeOptional?: boolean;  // default true
}

export interface RebalancePayload extends GeneratePayload {
  rebalanceType: RebalanceType;
  completedTasks: string[];
  preserveCompletedDate?: boolean;
  topics?: string[];
  dayTotalMinutes?: number;
  deadlines?: Record<string, string>;
}

export interface BackendScheduleResponse {
  schedule: any[];
  summary?: any;
}

async function postJson<T = any>(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; json?: T; text?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await res.json() : await res.text();
  return { ok: res.ok, status: res.status, json: isJson ? payload : undefined, text: isJson ? undefined : payload };
}

export async function generateSchedule(
  baseUrl: string,
  payload: GeneratePayload,
  signal?: AbortSignal
): Promise<BackendScheduleResponse> {
  const { ok, status, json, text } = await postJson<BackendScheduleResponse>(
    `${baseUrl.replace(/\/$/, "")}/generate-schedule`,
    payload,
    signal
  );
  if (ok && json) return json;
  throw new Error(`POST /generate-schedule failed: ${status} ${text || JSON.stringify(json)}`);
}

export async function rebalanceSchedule(
  baseUrl: string,
  payload: RebalancePayload,
  signal?: AbortSignal
): Promise<BackendScheduleResponse> {
  const { ok, status, json, text } = await postJson<BackendScheduleResponse>(
    `${baseUrl.replace(/\/$/, "")}/rebalance`,
    payload,
    signal
  );
  if (ok && json) return json;
  throw new Error(`POST /rebalance failed: ${status} ${text || JSON.stringify(json)}`);
}
