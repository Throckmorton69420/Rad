import { ScheduledTask, StudyResource, Domain, ResourceType } from '../types';
import { TASK_TYPE_PRIORITY } from '../constants';

const ci = (s?: string | null) => (s || '').toLowerCase();
const has = (s?: string | null, needle?: string) => ci(s).includes(ci(needle));

export const getCategoryRankFromResource = (r: StudyResource): number => {
  const bs = ci(r.bookSource);
  const vs = ci(r.videoSource);
  const title = ci(r.title);
  const isVideo = r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO;
  const isQ = r.type === ResourceType.QUESTIONS || r.type === ResourceType.REVIEW_QUESTIONS || r.type === ResourceType.QUESTION_REVIEW || r.type === ResourceType.EXAM_SIM;
  const isRead = r.type === ResourceType.READING_TEXTBOOK || r.type === ResourceType.READING_GUIDE;
  const isCases = r.type === ResourceType.CASES;

  if (isVideo && vs === 'titan radiology') return 1;
  if (isRead && bs === 'crack the core') return 2;
  if (isCases && (bs === 'case companion' || has(title, 'case companion'))) return 3;
  if (isQ && (bs === 'qevlar' || vs === 'qevlar' || has(title, 'qevlar'))) return 4;
  if (isVideo && (vs === 'huda physics' || has(bs, 'huda'))) return 5;
  if (isQ && (has(bs, 'huda') || has(title, 'huda physics qb'))) return 6;
  if (isRead && (has(bs, 'huda') || has(bs, 'review of physics'))) return 7;
  if (r.domain === Domain.NUCLEAR_MEDICINE || (isQ && has(bs, 'nucs app'))) return 8;
  if (r.domain === Domain.NIS || r.domain === Domain.RISC) return 9;
  if (bs === 'board vitals') return 10;
  if (vs === 'discord') return 11;
  if (bs === 'core radiology' || vs === 'core radiology' || has(title, 'core radiology')) return 12;
  return 12;
};

export const getCategoryRankFromTask = (t: ScheduledTask): number => {
  const pseudo: StudyResource = {
    id: t.resourceId,
    title: t.title,
    type: t.type,
    domain: t.originalTopic,
    durationMinutes: t.durationMinutes,
    isOptional: t.isOptional || false,
    isPrimaryMaterial: t.isPrimaryMaterial || false,
    pairedResourceIds: [],
    pages: t.pages,
    startPage: t.startPage,
    endPage: t.endPage,
    caseCount: t.caseCount,
    questionCount: t.questionCount,
    chapterNumber: t.chapterNumber,
    bookSource: t.bookSource,
    videoSource: t.videoSource,
    sequenceOrder: undefined,
    isSplittable: false,
    isArchived: false,
  } as any;
  return getCategoryRankFromResource(pseudo);
};

export const sortTasksByGlobalPriority = (a: ScheduledTask, b: ScheduledTask) => {
  const ca = getCategoryRankFromTask(a);
  const cb = getCategoryRankFromTask(b);
  if (ca !== cb) return ca - cb;
  const ta = TASK_TYPE_PRIORITY[a.type] ?? 99;
  const tb = TASK_TYPE_PRIORITY[b.type] ?? 99;
  if (ta !== tb) return ta - tb;
  return (a.order ?? 0) - (b.order ?? 0);
};

export const CATEGORY_LABEL: Record<number, string> = {
  1: 'Titan Radiology',
  2: 'Crack the Core',
  3: 'Case Companion',
  4: 'Qevlar',
  5: 'Huda Video',
  6: 'Huda QBank',
  7: 'Huda Text',
  8: 'Nuclear Medicine',
  9: 'NIS / RISC',
  10: 'Board Vitals',
  11: 'Discord',
  12: 'Core Radiology',
};
