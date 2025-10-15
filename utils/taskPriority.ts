// utils/taskPriority.ts
import { ScheduledTask, ResourceType } from '../types';

// Normalize a displayable "source" for grouping/ordering
export function getTaskSourceName(t: ScheduledTask): string {
  return (t.bookSource || t.videoSource || 'Custom Task').trim();
}

// Global source ranking — lower is higher priority
const SOURCE_RANK: Record<string, number> = {
  'Titan Radiology': 1,
  'Crack the Core': 2,
  'Case Companion': 3,
  'Qevlar': 4,
  // Physics cluster
  'Huda Physics': 5,        // generic bucket if used
  'Huda Text': 5,
  'Huda Gbank': 5,
  // Nuclear cluster
  'Nuclear Medicine': 6,
  'War Machine': 6,         // if present in your data
  'Nucs App': 6,
  // Institutional/other
  'NIS / RISC': 7,
  'Board Vitals': 8,
  'RadPrimer': 9,
  'Discord': 10,
  'Other': 998,
  'Custom Task': 999,
};

// Resource type ranking inside a source — lower is higher priority
const TYPE_RANK: Partial<Record<ResourceType, number>> = {
  VIDEO_LECTURE: 1,
  LECTURE: 1,           // alias if your enum has it
  TEXTBOOK_PAGES: 2,
  READING: 2,
  CASES: 3,
  QUESTIONS: 4,
  QUESTION_REVIEW: 5,
  NOTE_REVIEW: 6,
};

// Helpers
function sourceRank(t: ScheduledTask): number {
  const s = getTaskSourceName(t);
  return SOURCE_RANK[s] ?? 997;
}

function typeRank(t: ScheduledTask): number {
  const tr = TYPE_RANK[t.type as keyof typeof TYPE_RANK];
  return tr ?? 50;
}

function safeNumber(n: number | undefined | null, fallback = Number.POSITIVE_INFINITY): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

// Primary comparator for display and scheduling
export function compareTasksByPriority(a: ScheduledTask, b: ScheduledTask): number {
  // 1) Source rank (Titan → CTC → Case Companion → Qevlar → Huda → Nuclear → NIS/RISC → Board Vitals…)
  const sr = sourceRank(a) - sourceRank(b);
  if (sr !== 0) return sr;

  // 2) Inside same source: type rank (video → reading → cases → questions → reviews)
  const tr = typeRank(a) - typeRank(b);
  if (tr !== 0) return tr;

  // 3) Prefer lower explicit 'order' if present (stable manual ordering)
  const or = safeNumber(a.order, Number.POSITIVE_INFINITY) - safeNumber(b.order, Number.POSITIVE_INFINITY);
  if (or !== 0) return or;

  // 4) If both are book-based, keep natural progression by chapter → startPage → endPage
  const ch = safeNumber(a.chapterNumber) - safeNumber(b.chapterNumber);
  if (ch !== 0) return ch;

  const sp = safeNumber(a.startPage) - safeNumber(b.startPage);
  if (sp !== 0) return sp;

  const ep = safeNumber(a.endPage) - safeNumber(b.endPage);
  if (ep !== 0) return ep;

  // 5) Finally, title as stable tie-break
  const at = (a.title || '').localeCompare(b.title || '');
  if (at !== 0) return at;

  // 6) Durations last (shorter first)
  const dr = safeNumber(a.durationMinutes, 99999) - safeNumber(b.durationMinutes, 99999);
  if (dr !== 0) return dr;

  return 0;
}

// Convenience sorter used by UI and scheduler
export function sortTasksByGlobalPriority(tasks: ScheduledTask[]): ScheduledTask[] {
  const copy = [...tasks];
  copy.sort(compareTasksByPriority);
  return copy;
}

// Optional: category rank shim for legacy code paths that expect a numeric "category"
export function getCategoryRankFromTask(t: ScheduledTask): number {
  // Collapse SOURCE_RANK into a coarse 1..12 band for chips/groups if needed
  const r = sourceRank(t);
  if (r <= 1) return 1;       // Titan
  if (r <= 2) return 2;       // CTC
  if (r <= 3) return 3;       // Case Companion
  if (r <= 4) return 4;       // Qevlar
  if (r <= 5) return 5;       // Physics cluster
  if (r <= 6) return 6;       // Nuclear cluster
  if (r <= 7) return 7;       // NIS / RISC
  if (r <= 8) return 8;       // Board Vitals
  if (r <= 9) return 9;       // RadPrimer
  if (r <= 10) return 10;     // Discord
  return 12;                  // Other
}
