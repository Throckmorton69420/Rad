// utils/taskPriority.ts
import { ScheduledTask, ResourceType } from '../types';

// Normalize a displayable "source" for grouping/ordering
export function getTaskSourceName(t: ScheduledTask): string {
  return (t.bookSource || t.videoSource || 'Custom Task').trim();
}

// Canonicalize varied labels to consistent buckets the app expects
const canonicalKey = (label: string): string => {
  const s = (label || '').trim();
  const l = s.toLowerCase();
  if (l.includes('titan')) return 'Titan Radiology';
  if (l.includes('crack the core')) return 'Crack the Core';
  if (l.includes('case companion')) return 'Case Companion';
  if (l.includes('qevlar')) return 'QEVLAR';
  // Huda cluster
  if (l.includes('huda physics qb') || l.includes('gbank') || l.includes('g bank')) return 'Huda Physics QB';
  if (l.includes('review of physics')) return 'Review of Physics 5e';
  if (l.includes('huda')) return 'Huda';
  // Nuclear cluster
  if (l.includes('war machine') || l.includes('nucs app') || l.includes('nuclear')) return 'Nuclear';
  // Institutional/other
  if (l.includes('nis') || l.includes('risc')) return 'RISC Study Guide';
  if (l.includes('board vitals')) return 'Board Vitals';
  if (l.includes('radprimer')) return 'RadPrimer';
  if (l.includes('discord')) return 'Discord';
  if (l.includes('core radiology')) return 'Core Radiology';
  return s;
};

// Global source ranking — lower is higher priority (matches user's numbered order)
const SOURCE_RANK: Record<string, number> = {
  'Titan Radiology': 1,
  'Crack the Core': 2,
  'Case Companion': 3,
  'QEVLAR': 4,
  'Huda': 5,
  'Huda Physics QB': 6,
  'Review of Physics 5e': 7,
  'Nuclear': 7, // keep nuclear cluster after Huda QB if it appears in group view
  'RISC Study Guide': 8,
  'Board Vitals': 9,
  'RadPrimer': 10,
  'Discord': 10, // allow Discord around RadPrimer; final sort will stabilize by type/title
  'Core Radiology': 12,
  'Other': 998,
  'Custom Task': 999,
};

// Resource type ranking inside a source — lower is higher priority
const TYPE_RANK: Partial<Record<ResourceType, number>> = {
  VIDEO_LECTURE: 1,
  LECTURE: 1,
  TEXTBOOK_PAGES: 2,
  READING: 2,
  CASES: 3,
  QUESTIONS: 4,
  QUESTION_REVIEW: 5,
  NOTE_REVIEW: 6,
};

// Helpers
function sourceRank(t: ScheduledTask): number {
  const raw = getTaskSourceName(t);
  const key = canonicalKey(raw);
  return SOURCE_RANK[key] ?? 997;
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
  // 1) Source rank
  const sr = sourceRank(a) - sourceRank(b);
  if (sr !== 0) return sr;

  // 2) Inside same source: type rank
  const tr = typeRank(a) - typeRank(b);
  if (tr !== 0) return tr;

  // 3) Prefer lower explicit 'order' if present (stable manual ordering)
  const or = safeNumber(a.order, Number.POSITIVE_INFINITY) - safeNumber(b.order, Number.POSITIVE_INFINITY);
  if (or !== 0) return or;

  // 4) Chapter/page progression
  const ch = safeNumber(a.chapterNumber) - safeNumber(b.chapterNumber);
  if (ch !== 0) return ch;

  const sp = safeNumber(a.startPage) - safeNumber(b.startPage);
  if (sp !== 0) return sp;

  const ep = safeNumber(a.endPage) - safeNumber(b.endPage);
  if (ep !== 0) return ep;

  // 5) Title
  const at = (a.title || '').localeCompare(b.title || '');
  if (at !== 0) return at;

  // 6) Duration (shorter first)
  const dr = safeNumber(a.durationMinutes, 99999) - safeNumber(b.durationMinutes, 99999);
  if (dr !== 0) return dr;

  return 0;
}

// Convenience sorter used by UI and scheduler
export function sortTasksByGlobalPriority(tasks: ScheduledTask[]): ScheduledTask[] {
  const arr = Array.isArray(tasks) ? tasks.slice() : [];
  arr.sort(compareTasksByPriority);
  return arr;
}

// Optional: category rank shim for legacy code paths that expect a numeric "category"
export function getCategoryRankFromTask(t: ScheduledTask): number {
  const r = sourceRank(t);
  if (r <= 1) return 1;       // Titan
  if (r <= 2) return 2;       // CTC
  if (r <= 3) return 3;       // Case Companion
  if (r <= 4) return 4;       // QEVLAR
  if (r <= 5) return 5;       // Huda
  if (r <= 6) return 6;       // Huda Physics QB
  if (r <= 7) return 7;       // Review of Physics / Nuclear cluster
  if (r <= 8) return 8;       // RISC Study Guide
  if (r <= 9) return 9;       // Board Vitals
  if (r <= 10) return 10;     // RadPrimer/Discord
  return 12;                  // Core Radiology and Others
}
