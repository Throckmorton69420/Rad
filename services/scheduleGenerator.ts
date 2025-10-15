// services/scheduleGenerator.ts

import { 
  StudyPlan,
  DailySchedule,
  ScheduledTask,
  StudyResource,
  Domain,
  ResourceType,
  ExceptionDateRule,
  GeneratedStudyPlanOutcome,
  RebalanceOptions,
  DeadlineSettings
} from '../types';

import {
  DEFAULT_DAILY_STUDY_MINS,
  DEFAULT_TOPIC_ORDER,
  MIN_DURATION_for_SPLIT_PART,
  TASK_TYPE_PRIORITY
} from '../constants';

import { getTodayInNewYork, parseDateString, isoDate } from '../utils/timeFormatter';

/**
 * Scheduling algorithm with strict priority tiers and Titan chapter sequencing.
 * Primary tiers (must be fully utilized before any supplementary):
 *  1) Titan Radiology videos
 *  2) Crack the Core textbook
 *  3) Case Companion cases
 *  4) Qevlar questions
 *  5) Huda Physics videos
 *  6) Huda Physics QBank
 *  7) Huda Physics textbook (Review of Physics)
 *  8) Nuclear Medicine content (any source) + Nucs App QBank + Qevlar (nucs)
 *  9) NIS/RISC
 * 10) Board Vitals (Mixed)
 * Supplementary (only after all above are scheduled):
 * 11) Discord lectures
 * 12) Core Radiology
 */

import { sortTasksByGlobalPriority } from '../utils/taskPriority';

// Map StudyResource[] into the same global priority as ScheduledTask comparator
const sortResourcesByTaskPriority = (resources: StudyResource[]): StudyResource[] => {
  const tmpTasks = resources.map((r, idx) => ({
    id: `tmp_${r.id}_${idx}`,
    resourceId: r.id,
    originalResourceId: r.id,
    title: r.title,
    type: r.type,
    originalTopic: r.domain,
    durationMinutes: r.durationMinutes,
    status: 'pending' as const,
    order: idx,
    isOptional: !!r.isOptional,
    isPrimaryMaterial: !!r.isPrimaryMaterial,
    pages: r.pages,
    startPage: r.startPage,
    endPage: r.endPage,
    caseCount: r.caseCount,
    questionCount: r.questionCount,
    chapterNumber: r.chapterNumber,
    bookSource: r.bookSource,
    videoSource: r.videoSource,
  }));
  const sorted = sortTasksByGlobalPriority(tmpTasks);
  const byId = new Map(resources.map(r => [r.id, r]));
  return sorted.map(t => byId.get(t.resourceId)!).filter(Boolean);
};

const chunkLargeResources = (resources: StudyResource[]): StudyResource[] => {
  const out: StudyResource[] = [];
  for (const r of resources) {
    if (r.isSplittable && r.durationMinutes > MIN_DURATION_for_SPLIT_PART * 1.5) {
      const parts = Math.ceil(r.durationMinutes / MIN_DURATION_for_SPLIT_PART);
      const per = Math.round(r.durationMinutes / parts);
      for (let i = 0; i < parts; i++) {
        out.push({
          ...r,
          id: `${r.id}_part_${i + 1}`,
          title: `${r.title} (Part ${i + 1}/${parts})`,
          durationMinutes: per,
          isSplittable: false,
          pairedResourceIds: []
        });
      }
    } else {
      out.push(r);
    }
  }
  return out;
};

const sumDay = (day: DailySchedule) => day.tasks.reduce((s, t) => s + t.durationMinutes, 0);

const ci = (s?: string | null) => (s || '').toLowerCase();
const has = (s?: string | null, needle?: string) => ci(s).includes(ci(needle));

// Determine global priority tier (1..12, lower = higher priority)
const getCategoryRankFromResource = (r: StudyResource): number => {
  const type = r.type;
  const domain = r.domain;
  const bs = ci(r.bookSource);
  const vs = ci(r.videoSource);
  const title = ci(r.title);

  const isVideo = (type === ResourceType.VIDEO_LECTURE || type === ResourceType.HIGH_YIELD_VIDEO);
  const isQuestions = (type === ResourceType.QUESTIONS || type === ResourceType.REVIEW_QUESTIONS || type === ResourceType.QUESTION_REVIEW || type === ResourceType.EXAM_SIM);
  const isReading = (type === ResourceType.READING_TEXTBOOK || type === ResourceType.READING_GUIDE);
  const isCases = (type === ResourceType.CASES);

  // 1) Titan Radiology videos
  if (isVideo && vs === 'titan radiology') return 1;

  // 2) Crack the Core textbook
  if (isReading && bs === 'crack the core') return 2;

  // 3) Case Companion cases
  if (isCases && (bs === 'case companion' || has(title, 'case companion'))) return 3;

  // 4) Qevlar questions (detect by source or title)
  if (isQuestions && (bs === 'qevlar' || vs === 'qevlar' || has(title, 'qevlar'))) return 4;

  // 5) Huda Physics videos
  if (isVideo && (vs === 'huda physics' || has(bs, 'huda'))) return 5;

  // 6) Huda Physics QBank
  if (isQuestions && (has(bs, 'huda') || has(title, 'huda physics qb'))) return 6;

  // 7) Huda Physics textbook (Review of Physics 5e)
  if (isReading && (has(bs, 'huda') || has(bs, 'review of physics'))) return 7;

  // 8) Nuclear Medicine (any source) + Nucs App QBank + Qevlar (nucs)
  if (domain === Domain.NUCLEAR_MEDICINE) return 8;
  if (isQuestions && (has(bs, 'nucs app'))) return 8;

  // 9) NIS/RISC
  if (domain === Domain.NIS || domain === Domain.RISC) return 9;

  // 10) Board Vitals
  if (bs === 'board vitals') return 10;

  // 11) Discord lectures
  if (vs === 'discord') return 11;

  // 12) Core Radiology (fallback supplementary)
  if (bs === 'core radiology' || vs === 'core radiology' || has(title, 'core radiology')) return 12;

  // default: treat as supplementary tail
  return 12;
};

const getCategoryRankFromTask = (t: ScheduledTask): number => {
  // Map task back to StudyResource-like fields
  const asRes: StudyResource = {
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
    isArchived: false
  } as any;
  return getCategoryRankFromResource(asRes);
};

const isPrimaryByCategory = (r: StudyResource): boolean => getCategoryRankFromResource(r) <= 10;

const compareTasksByGlobalPriority = (a: ScheduledTask, b: ScheduledTask) => {
  const ca = getCategoryRankFromTask(a);
  const cb = getCategoryRankFromTask(b);
  if (ca !== cb) return ca - cb;
  // Within same category, prefer intrinsic type priority
  const ta = TASK_TYPE_PRIORITY[a.type] ?? 99;
  const tb = TASK_TYPE_PRIORITY[b.type] ?? 99;
  if (ta !== tb) return ta - tb;
  // Stable by insertion order
  return (a.order ?? 0) - (b.order ?? 0);
};

type Block = {
  anchorId: string;
  domain: Domain;
  items: StudyResource[]; // sorted by type priority
  totalMinutes: number;
};

class Scheduler {
  private allResources: Map<string, StudyResource>;
  private remaining: Set<string>;
  private schedule: DailySchedule[];
  private studyDays: DailySchedule[];
  private notifications: GeneratedStudyPlanOutcome['notifications'] = [];
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskCounter = 0;

  constructor(
    startDateStr: string,
    endDateStr: string,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[],
    topicOrder: Domain[],
    deadlines: DeadlineSettings,
    areSpecialTopicsInterleaved: boolean
  ) {
    const chunked = chunkLargeResources(resourcePool);
    this.allResources = new Map(chunked.map(r => [r.id, r]));
    this.remaining = new Set(chunked.map(r => r.id));
    this.schedule = this.createDays(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay);
    this.topicOrder = topicOrder || DEFAULT_TOPIC_ORDER;
    this.deadlines = deadlines || {};
    this.areSpecialTopicsInterleaved = areSpecialTopicsInterleaved ?? true;
  }

  private createDays(startDateStr: string, endDateStr: string, exceptionRules: ExceptionDateRule[]): DailySchedule[] {
    const start = parseDateString(startDateStr);
    const end = parseDateString(endDateStr);
    const exceptionMap = new Map(exceptionRules.map(e => [e.date, e]));
    const days: DailySchedule[] = [];

    for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
      const date = isoDate(dt);
      const ex = exceptionMap.get(date);
      days.push({
        date,
        dayName: dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        tasks: [],
        totalStudyTimeMinutes: ex?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS,
        isRestDay: ex?.isRestDayOverride ?? false,
        isManuallyModified: !!ex
      });
    }
    return days;
  }

  private remainingTime(day: DailySchedule): number { return day.totalStudyTimeMinutes - sumDay(day); }

  private toTask(res: StudyResource, order: number): ScheduledTask {
    this.taskCounter++;
    const originalResourceId = res.id.includes('_part_') ? res.id.split('_part_')[0] : res.id;
    return {
      id: `task_${res.id}_${this.taskCounter}`,
      resourceId: res.id,
      originalResourceId,
      title: res.title,
      type: res.type,
      originalTopic: res.domain,
      durationMinutes: res.durationMinutes,
      status: 'pending',
      order,
      isOptional: res.isOptional,
      isPrimaryMaterial: isPrimaryByCategory(res) || res.isPrimaryMaterial,
      pages: res.pages,
      startPage: res.startPage,
      endPage: res.endPage,
      caseCount: res.caseCount,
      questionCount: res.questionCount,
      chapterNumber: res.chapterNumber,
      bookSource: res.bookSource,
      videoSource: res.videoSource
    };
  }

  private buildBlockFromAnchor(anchor: StudyResource): Block {
    const seen = new Set<string>();
    const q: string[] = [anchor.id];
    let items: StudyResource[] = [];
    while (q.length) {
      const id = q.shift()!;
      if (seen.has(id)) continue;
      const r = this.allResources.get(id);
      if (!r) continue;
      if (!this.remaining.has(id)) continue;
      seen.add(id);
      items.push(r);

      // 1) Explicit pairing via pairedResourceIds
      for (const pid of r.pairedResourceIds ?? []) if (!seen.has(pid)) q.push(pid);

      // 2) Implicit topic-based pairing within same domain (chapter/title match)
      const relatedByTopic = [...this.allResources.values()].filter(candidate => {
        if (seen.has(candidate.id)) return false;
        if (!this.remaining.has(candidate.id)) return false;
        if (candidate.domain !== r.domain) return false;
        // Chapter alignment
        if (r.chapterNumber && candidate.chapterNumber && r.chapterNumber === candidate.chapterNumber) return true;
        // Title/topic keyword alignment
        const rTopic = (r.title || '').toLowerCase();
        const cTopic = (candidate.title || '').toLowerCase();
        return this.topicsMatch(rTopic, cTopic);
      });
      for (const related of relatedByTopic) if (!seen.has(related.id)) q.push(related.id);
    }
    items = sortResourcesByTaskPriority(items);
    const total = items.reduce((s, r) => s + r.durationMinutes, 0);
    return { anchorId: anchor.id, domain: anchor.domain, items, totalMinutes: total };
  }

  // Heuristic topic matcher to keep paired content together by subject
  private topicsMatch(topic1: string, topic2: string): boolean {
    if (!topic1 || !topic2) return false;
    const kws = [
      'pancreas','liver','renal','kidney','adrenal','spleen','biliary','gallbladder','gi','bowel','barium',
      'thorax','chest','lung','mediastinum','pleura','thyroid','parathyroid',
      'msk','musculoskeletal','bone','joint','soft tissue',
      'neuro','brain','spine','spinal','head and neck','hn',
      'peds','pediatric','paediatric','infant','child',
      'cardiac','heart','coronary',
      'breast','mamm',
      'interventional','ir','vascular',
      'nuclear','spect','pet',
      'physics','ct','mr','mri','dose','artifact','resolution'
    ];
    return kws.some(kw => topic1.includes(kw) && topic2.includes(kw));
  }

  // Place remaining items on days that match their topic; if not possible, only after topic introduced
  private placeLeftoversWithDomainAlignment(): void {
    const seenDomains = new Set<Domain>();
    const firstDayForDomain = new Map<Domain, number>();

    for (let i = 0; i < this.studyDays.length; i++) {
      const day = this.studyDays[i];
      for (const t of day.tasks) {
        if (!seenDomains.has(t.originalTopic)) {
          seenDomains.add(t.originalTopic);
          firstDayForDomain.set(t.originalTopic, i);
        }
      }
    }

    const leftovers = [...this.remaining]
      .map(id => this.allResources.get(id)!)
      .filter(Boolean);

    for (const res of leftovers) {
      let placed = false;

      // Attempt 1: place on day that already covers this topic (by domain or title alignment)
      for (const day of this.studyDays) {
        const dayDomains = new Set(day.tasks.map(t => t.originalTopic));
        const aligns = dayDomains.has(res.domain) || this.dayTitleAligns(day, res);
        if (aligns && this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
          placed = true;
          break;
        }
      }
      if (placed) continue;

      // Attempt 2: place only after the topic has been introduced
      const firstIdx = firstDayForDomain.get(res.domain);
      if (typeof firstIdx === 'number') {
        for (let i = firstIdx + 1; i < this.studyDays.length; i++) {
          const day = this.studyDays[i];
          if (this.remainingTime(day) >= res.durationMinutes) {
            day.tasks.push(this.toTask(res, day.tasks.length));
            this.remaining.delete(res.id);
            placed = true;
            break;
          }
        }
      }

      if (!placed) {
        this.notifications.push({
          type: 'warning',
          message: `No aligned slot for "${res.title}" (${res.durationMinutes} min) respecting topic/day rules`
        });
      }
    }
  }

  // Allow matching by day content titles to align Discord/Core Radiology
  private dayTitleAligns(day: DailySchedule, res: StudyResource): boolean {
    if (!day.tasks.length) return false;
    const rTopic = ((res.title || '') + ' ' + String(res.domain || '')).toLowerCase();
    for (const t of day.tasks) {
      const s = ((t.title || '') + ' ' + String(t.originalTopic || '')).toLowerCase();
      if (this.topicsMatch(s, rTopic)) return true;
    }
    return false;
  }

  private tryPlaceWholeBlockOnDay(block: Block, dayIndexStart: number): number | null {
    for (let i = 0; i < this.studyDays.length; i++) {
      const idx = (dayIndexStart + i) % this.studyDays.length;
      const day = this.studyDays[idx];
      const minutes = block.items.filter(it => this.remaining.has(it.id)).reduce((s, r) => s + r.durationMinutes, 0);
      if (this.remainingTime(day) >= minutes) return idx;
    }
    return null;
  }

  private placeBlockStrictRoundRobin(blocks: Block[], startCursor: number): number {
    let cursor = startCursor;
    for (const block of blocks) {
      const live = block.items.filter(it => this.remaining.has(it.id));
      if (live.length === 0) { cursor++; continue; }
      const fitDay = this.tryPlaceWholeBlockOnDay({ ...block, items: live, totalMinutes: live.reduce((s, r) => s + r.durationMinutes, 0) }, cursor);
      if (fitDay !== null) {
        const day = this.studyDays[fitDay];
        for (const r of live) { day.tasks.push(this.toTask(r, day.tasks.length)); this.remaining.delete(r.id); }
        cursor = (fitDay + 1) % this.studyDays.length; continue;
      }
      let placedAny = false;
      for (const r of live) {
        let placed = false;
        for (let i = 0; i < this.studyDays.length; i++) {
          const idx = (cursor + i) % this.studyDays.length;
          const day = this.studyDays[idx];
          if (this.remainingTime(day) >= r.durationMinutes) {
            day.tasks.push(this.toTask(r, day.tasks.length));
            this.remaining.delete(r.id); placed = true; placedAny = true; cursor = (idx + 1) % this.studyDays.length; break;
          }
        }
        if (!placed) this.notifications.push({ type: 'warning', message: `Block item could not fit: "${r.title}" (${r.durationMinutes} min)` });
      }
      if (!placedAny) { this.notifications.push({ type: 'warning', message: `Block could not be placed: anchor "${block.anchorId}"` }); cursor = (cursor + 1) % this.studyDays.length; }
    }
    return cursor;
  }

  // Phase 1a: Titan Radiology (chapter asc, then sequence)
  private phase1a_distributeTitan(cursorStart: number): number {
    const anchors = [...this.allResources.values()].filter(r => this.remaining.has(r.id) && (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) && ci(r.videoSource) === 'titan radiology');
    anchors.sort((a, b) => {
      const ca = a.chapterNumber ?? 9999, cb = b.chapterNumber ?? 9999; if (ca !== cb) return ca - cb; return (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999);
    });
    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 1b: Huda Physics (sequence)
  private phase1b_distributeHuda(cursorStart: number): number {
    const anchors = [...this.allResources.values()].filter(r => this.remaining.has(r.id) && (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) && (ci(r.videoSource) === 'huda physics' || has(r.bookSource, 'huda')));
    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 1c: Other primary anchors (videos not Titan/Huda)
  private phase1c_distributeOtherPrimaries(cursorStart: number): number {
    const anchors = [...this.allResources.values()].filter(r => this.remaining.has(r.id) && (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) && ci(r.videoSource) !== 'titan radiology' && ci(r.videoSource) !== 'huda physics' && (isPrimaryByCategory(r) || r.isPrimaryMaterial));
    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 1d: Distribute remaining non-Nuclear, non-Physics resources in Titan domain order
  private phase1d_distributeByTitanDomainOrder(cursorStart: number): number {
    const DOMAIN_ORDER: Domain[] = [
      Domain.GASTROINTESTINAL_IMAGING,
      Domain.GENITOURINARY_IMAGING,
      Domain.THORACIC_IMAGING,
      Domain.MUSCULOSKELETAL_IMAGING,
      Domain.NEURORADIOLOGY,
      Domain.PEDIATRIC_RADIOLOGY,
      Domain.CARDIOVASCULAR_IMAGING,
      Domain.BREAST_IMAGING,
      Domain.INTERVENTIONAL_RADIOLOGY,
    ];

    const domainBlocks = DOMAIN_ORDER.map(dom => {
      const items = [...this.remaining]
        .map(id => this.allResources.get(id)!)
        .filter(r => r && r.domain === dom && r.domain !== Domain.NUCLEAR_MEDICINE && r.domain !== Domain.PHYSICS)
        .filter(r => (isPrimaryByCategory(r) || r.isPrimaryMaterial));
      const sortedItems = sortResourcesByTaskPriority(items);
      const totalMinutes = sortedItems.reduce((s, r) => s + r.durationMinutes, 0);
      const anchorId = sortedItems[0]?.id || `${dom}_anchor`;
      return { anchorId, domain: dom, items: sortedItems, totalMinutes } as Block;
    }).filter(b => b.items.length > 0);

    if (domainBlocks.length === 0) return cursorStart;
    return this.placeBlockStrictRoundRobin(domainBlocks, cursorStart);
  }

  // Phase 2a: Nuclear Medicine (videos/readings/cases/questions in Nuclear, plus Nucs App/Qevlar for nucs)
  private phase2a_distributeNuclear(cursorStart: number): number {
    const anchors = [...this.allResources.values()].filter(r =>
      this.remaining.has(r.id) &&
      (
        r.domain === Domain.NUCLEAR_MEDICINE ||
        ci(r.bookSource).includes('nucs app') ||
        (ci(r.bookSource) === 'qevlar' && r.domain === Domain.NUCLEAR_MEDICINE)
      ) &&
      (isPrimaryByCategory(r) || r.isPrimaryMaterial)
    );
    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 2b: NIS / RISC
  private phase2b_distributeNisRisc(cursorStart: number): number {
    const anchors = [...this.allResources.values()].filter(r =>
      this.remaining.has(r.id) &&
      (r.domain === Domain.NIS || r.domain === Domain.RISC) &&
      (isPrimaryByCategory(r) || r.isPrimaryMaterial)
    );
    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 2c: Board Vitals
  private phase2c_distributeBoardVitals(cursorStart: number): number {
    const anchors = [...this.allResources.values()].filter(r =>
      this.remaining.has(r.id) &&
      ci(r.bookSource) === 'board vitals' &&
      (isPrimaryByCategory(r) || r.isPrimaryMaterial)
    );
    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }
// Phase 1d: Distribute remaining non-Nuclear, non-Physics resources in Titan domain order
private phase1d_distributeByTitanDomainOrder(cursorStart: number): number {
    // Titan-inspired domain sequence excluding Nuclear and Physics (handled elsewhere)
    const DOMAIN_ORDER: Domain[] = [
      Domain.GASTROINTESTINAL_IMAGING,
      Domain.GENITOURINARY_IMAGING,
      Domain.THORACIC_IMAGING,
      Domain.MUSCULOSKELETAL_IMAGING,
      Domain.NEURORADIOLOGY,
      Domain.PEDIATRIC_RADIOLOGY,
      Domain.CARDIOVASCULAR_IMAGING,
      Domain.BREAST_IMAGING,
      Domain.INTERVENTIONAL_RADIOLOGY,
    ];

    // Build one block per domain in preferred order
    const domainBlocks = DOMAIN_ORDER.map(dom => {
      const items = [...this.remaining]
        .map(id => this.allResources.get(id)!)
        .filter(r => r && r.domain === dom && r.domain !== Domain.NUCLEAR_MEDICINE && r.domain !== Domain.PHYSICS)
        .filter(r => (isPrimaryByCategory(r) || r.isPrimaryMaterial));
      const sortedItems = sortResourcesByTaskPriority(items);
      const totalMinutes = sortedItems.reduce((s, r) => s + r.durationMinutes, 0);
      const anchorId = sortedItems[0]?.id || `${dom}_anchor`;
      return { anchorId, domain: dom, items: sortedItems, totalMinutes } as Block;
    }).filter(b => b.items.length > 0);

    if (domainBlocks.length === 0) return cursorStart;
    return this.placeBlockStrictRoundRobin(domainBlocks, cursorStart);
  }

  private phase2_dailyFirstFit(): void {
    // Pre-pass: distribute block families with round-robin before daily fill
    let cursor = 0;
    cursor = this.phase2a_distributeNuclear(cursor);
    cursor = this.phase2b_distributeNisRisc(cursor);
    cursor = this.phase2c_distributeBoardVitals(cursor);
    const remainingResources = [...this.remaining].map(id => this.allResources.get(id)!).filter(Boolean);
    const nucMed = sortResourcesByTaskPriority(remainingResources.filter(r => r.domain === Domain.NUCLEAR_MEDICINE && (isPrimaryByCategory(r) || r.isPrimaryMaterial)));
    const nisRisc = sortResourcesByTaskPriority(remainingResources.filter(r => (r.domain === Domain.NIS || r.domain === Domain.RISC) && (isPrimaryByCategory(r) || r.isPrimaryMaterial)));
    const boardVitals = sortResourcesByTaskPriority(remainingResources.filter(r => ci(r.bookSource) === 'board vitals' && (isPrimaryByCategory(r) || r.isPrimaryMaterial)));

    for (let d = 0; d < this.studyDays.length; d++) {
      const day = this.studyDays[d];
      const covered = new Set<Domain>();
      for (let i = 0; i <= d; i++) for (const t of this.studyDays[i].tasks) covered.add(t.originalTopic);

      const tryFit = (pool: StudyResource[]) => {
        for (let i = 0; i < pool.length; i++) {
          const r = pool[i]; if (!this.remaining.has(r.id)) continue;
          if (this.remainingTime(day) >= r.durationMinutes) { day.tasks.push(this.toTask(r, day.tasks.length)); this.remaining.delete(r.id); pool.splice(i, 1); return true; }
        } return false;
      };

      tryFit(nucMed);
      tryFit(nisRisc);

      for (let i = 0; i < boardVitals.length; i++) {
        const r = boardVitals[i]; if (!this.remaining.has(r.id)) continue; if (!covered.has(r.domain)) continue;
        if (this.remainingTime(day) >= r.durationMinutes) { day.tasks.push(this.toTask(r, day.tasks.length)); this.remaining.delete(r.id); boardVitals.splice(i, 1); break; }
      }
    }
  }

  // Phase 2b — fill remaining capacity with any remaining primaries
  private phase2b_fillPrimariesToCapacity(): void {
    const primaries = [...this.remaining].map(id => this.allResources.get(id)!).filter(r => r && (isPrimaryByCategory(r) || r.isPrimaryMaterial));
    primaries.sort((a, b) => {
      const ca = getCategoryRankFromResource(a), cb = getCategoryRankFromResource(b); if (ca !== cb) return ca - cb;
      const tp = (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99); if (tp !== 0) return tp;
      const seq = (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999); if (seq !== 0) return seq;
      return a.durationMinutes - b.durationMinutes;
    });

    for (const day of this.studyDays) {
      if (day.isRestDay) continue; let rt = this.remainingTime(day); if (rt <= 0) continue;
      for (let i = 0; i < primaries.length && rt > 0; ) {
        const r = primaries[i]; if (!this.remaining.has(r.id)) { primaries.splice(i, 1); continue; }
        if (r.durationMinutes <= rt) { day.tasks.push(this.toTask(r, day.tasks.length)); this.remaining.delete(r.id); rt -= r.durationMinutes; primaries.splice(i, 1); }
        else { i++; }
      }
    }
  }

  // Phase 3 — supplementary only if no primaries remain
  private phase3_supplementaryFill(): void {
    const anyPrimaryLeft = [...this.remaining].some(id => { const r = this.allResources.get(id)!; return r && (isPrimaryByCategory(r) || r.isPrimaryMaterial); });
    if (anyPrimaryLeft) { this.notifications.push({ type: 'info', message: 'Primary resources remain; supplementary scheduling deferred.' }); return; }

    const pool = [...this.remaining].map(id => this.allResources.get(id)!).filter(Boolean);
    const supplementary = pool.filter(r => !isPrimaryByCategory(r) && !r.isPrimaryMaterial && !r.isArchived).sort((a, b) => {
      const ca = getCategoryRankFromResource(a), cb = getCategoryRankFromResource(b); if (ca !== cb) return ca - cb; // ensures Discord (11) before Core Radiology (12)
      return (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99);
    });

    // Topic-aware
    for (const day of this.studyDays) {
      if (day.isRestDay) continue; const topics = new Set(day.tasks.map(t => t.originalTopic));
      for (let i = supplementary.length - 1; i >= 0; i--) {
        const r = supplementary[i]; if (!this.remaining.has(r.id)) { supplementary.splice(i, 1); continue; }
        if (topics.has(r.domain) && this.remainingTime(day) >= r.durationMinutes) { day.tasks.push(this.toTask(r, day.tasks.length)); this.remaining.delete(r.id); supplementary.splice(i, 1); }
      }
    }

    // General fill
    for (const day of this.studyDays) {
      if (day.isRestDay) continue;
      for (let i = supplementary.length - 1; i >= 0; i--) {
        const r = supplementary[i]; if (!this.remaining.has(r.id)) { supplementary.splice(i, 1); continue; }
        if (this.remainingTime(day) >= r.durationMinutes) { day.tasks.push(this.toTask(r, day.tasks.length)); this.remaining.delete(r.id); supplementary.splice(i, 1); }
      }
    }
  }

  private finalize(): void {
    for (const day of this.schedule) day.tasks.sort(sortTasksByGlobalPriority);

    const primariesUnscheduled = [...this.remaining].filter(id => { const r = this.allResources.get(id); return r && (isPrimaryByCategory(r) || r.isPrimaryMaterial); });
    for (const id of this.remaining) { const r = this.allResources.get(id); if (r) this.notifications.push({ type: 'warning', message: `Could not schedule: "${r.title}" (${r.durationMinutes} min)` }); }
    if (primariesUnscheduled.length > 0) this.notifications.push({ type: 'warning', message: `Unscheduled primary items remain (${primariesUnscheduled.length}). Consider extending range or reducing exceptions.` });
  }

  public run(): GeneratedStudyPlanOutcome {
    if (this.studyDays.length === 0) {
      this.notifications.push({ type: 'error', message: 'No study days available in the selected period.' });
      return { plan: { schedule: [], progressPerDomain: {}, startDate: '', endDate: '', firstPassEndDate: null, topicOrder: [], cramTopicOrder: [], deadlines: {}, isCramModeActive: false, areSpecialTopicsInterleaved: false }, notifications: this.notifications };
    }

    let cursor = 0;
    cursor = this.phase1a_distributeTitan(cursor);
    cursor = this.phase1b_distributeHuda(cursor);
    cursor = this.phase1c_distributeOtherPrimaries(cursor);

    this.phase2_dailyFirstFit();
    this.phase2b_fillPrimariesToCapacity();
    this.phase3_supplementaryFill();
    this.finalize();

    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    for (const r of this.allResources.values()) { if (!progressPerDomain[r.domain]) progressPerDomain[r.domain] = { completedMinutes: 0, totalMinutes: 0 }; progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes; }

    return { plan: { schedule: this.schedule, progressPerDomain, startDate: this.schedule[0].date, endDate: this.schedule[this.schedule.length - 1].date, firstPassEndDate: null, topicOrder: this.topicOrder, cramTopicOrder: [], deadlines: this.deadlines, isCramModeActive: false, areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved }, notifications: this.notifications };
  }
}

export const generateInitialSchedule = (
  resourcePool: StudyResource[],
  exceptionRules: ExceptionDateRule[],
  topicOrder: Domain[] | undefined,
  deadlines: DeadlineSettings | undefined,
  startDateStr: string,
  endDateStr: string,
  areSpecialTopicsInterleaved: boolean | undefined
): GeneratedStudyPlanOutcome => {
  const s = new Scheduler(startDateStr, endDateStr, exceptionRules, resourcePool, topicOrder || DEFAULT_TOPIC_ORDER, deadlines || {}, areSpecialTopicsInterleaved ?? true);
  return s.run();
};

export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionRules: ExceptionDateRule[],
  resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
  const today = getTodayInNewYork();
  const rebalanceStart = options.type === 'standard' ? (options.rebalanceDate && options.rebalanceDate > today ? options.rebalanceDate : today) : options.date;
  const past = currentPlan.schedule.filter(d => d.date < rebalanceStart);
  const completed = new Set<string>();
  for (const day of currentPlan.schedule) for (const t of day.tasks) if (t.status === 'completed' && t.originalResourceId) completed.add(t.originalResourceId);
  const remainingPool = resourcePool.filter(r => !completed.has(r.id) && !r.isArchived);
  const s = new Scheduler(rebalanceStart, currentPlan.endDate, exceptionRules, remainingPool, currentPlan.topicOrder, currentPlan.deadlines, currentPlan.areSpecialTopicsInterleaved);
  const out = s.run();
  out.plan.schedule = [...past, ...out.plan.schedule]; out.plan.startDate = currentPlan.startDate;
  Object.values(out.plan.progressPerDomain).forEach(p => p.completedMinutes = 0);
  for (const day of out.plan.schedule) for (const t of day.tasks) if (t.status === 'completed') { const p = out.plan.progressPerDomain[t.originalTopic]; if (p) p.completedMinutes += t.durationMinutes; }
  return out;
};