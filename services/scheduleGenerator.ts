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
import { sortTasksByGlobalPriority } from '../utils/taskPriority';

/**
 * Strict Titan-First, 4-Phase Scheduler
 *
 * Phase 1: Primary Content Distribution (Round-Robin with Pairing + Carryover)
 *   - Pass 1a: Titan blocks (Titan video + Crack the Core + Case Companion + QEVLAR)
 *   - Pass 1b: Huda blocks (Physics content grouped)
 *   - Pass 1c: Nuclear blocks (Titan/War Machine/NucApp + paired)
 *
 * Phase 2: Per-Day Saturation (NIS/RISC -> Board Vitals -> Physics)
 *   - Board Vitals daily mixed quota with subject suggestions derived from covered topics
 *
 * Phase 3: Greedy Relevancy Fill (Discord/Core Radiology) after Phase 1 placed and per-day Phase 2 attempted
 *
 * Phase 4: Validation and Corrective Redistribution
 */

type BlockType = 'titan' | 'huda' | 'nuclear';

interface TopicBlock {
  id: string;
  type: BlockType;
  domain: Domain;
  resources: StudyResource[];
  totalMinutes: number;
  titanOrderRank?: number; // Used to enforce Titan sequence
}

interface BVAllocation {
  date: string;
  targetQuestions: number;
  suggestedSubjects: Domain[];
}

const TITAN_SEQUENCE_KEYWORDS: string[] = [
  'pancreas',
  'liver',
  'renal',
  'reproductive',
  'abdominal barium',
  'chest',
  'thyroid',
  'musculoskeletal',
  'neuro',
  'pediatric',
  'cardiac',
  'breast',
  'nuclear',
  'interventional and vascular',
  'physics'
];

class StrictTitanScheduler {
  private allResources = new Map<string, StudyResource>();
  private remaining = new Set<string>();

  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private notifications: Array<{ type: 'error' | 'warning' | 'info'; message: string }> = [];

  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;

  private taskCounter = 0;

  // Per-day topic tracking for BV suggestions and relevancy
  private coveredTopicsByDay = new Map<string, Set<Domain>>();

  // Phase groups
  private phase1Ids = new Set<string>();
  private phase2Ids = new Set<string>();
  private phase3Ids = new Set<string>();

  // Categorized pools
  private titanPool: StudyResource[] = [];
  private hudaPool: StudyResource[] = [];
  private nuclearPool: StudyResource[] = [];
  private nisRiscPool: StudyResource[] = [];
  private boardVitalsPool: StudyResource[] = [];
  private physicsPool: StudyResource[] = [];
  private nucAppPool: StudyResource[] = [];
  private qevlarPool: StudyResource[] = [];
  private discordPool: StudyResource[] = [];
  private coreRadPool: StudyResource[] = [];

  // BV tracking
  private totalBVQuestions = 0;
  private scheduledBVQuestions = 0;
  private bvDaily: BVAllocation[] = [];

  constructor(
    startDateStr: string,
    endDateStr: string,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[],
    topicOrder: Domain[] | undefined,
    deadlines: DeadlineSettings | undefined,
    areSpecialTopicsInterleaved: boolean | undefined
  ) {
    this.topicOrder = topicOrder || DEFAULT_TOPIC_ORDER;
    this.deadlines = deadlines || {};
    this.areSpecialTopicsInterleaved = areSpecialTopicsInterleaved ?? true;

    const processed = this.chunkSplittable(resourcePool);
    for (const r of processed) {
      this.allResources.set(r.id, r);
      this.remaining.add(r.id);
    }

    this.schedule = this.createDays(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);

    if (this.studyDays.length === 0) {
      this.notifications.push({ type: 'error', message: 'No study days available in range' });
      return;
    }

    for (const d of this.studyDays) this.coveredTopicsByDay.set(d.date, new Set<Domain>());

    this.categorize();
    this.precomputeBVDailyQuotas();

    this.notifications.push({
      type: 'info',
      message: `Init: ${this.studyDays.length} study days, resources ${this.allResources.size} (P1=${this.phase1Ids.size}, P2=${this.phase2Ids.size}, P3=${this.phase3Ids.size})`
    });
  }

  private chunkSplittable(resources: StudyResource[]): StudyResource[] {
    const out: StudyResource[] = [];
    for (const r of resources) {
      if (r.isSplittable && r.durationMinutes > MIN_DURATION_for_SPLIT_PART * 2) {
        const parts = Math.ceil(r.durationMinutes / MIN_DURATION_for_SPLIT_PART);
        const per = Math.floor(r.durationMinutes / parts);
        for (let i = 0; i < parts; i++) {
          const last = i === parts - 1;
          const dur = last ? r.durationMinutes - per * i : per;
          out.push({
            ...r,
            id: `${r.id}_part_${i + 1}`,
            title: `${r.title} (Part ${i + 1}/${parts})`,
            durationMinutes: dur,
            pairedResourceIds: [],
            isSplittable: false
          });
        }
      } else {
        out.push(r);
      }
    }
    return out;
  }

  private createDays(startDateStr: string, endDateStr: string, exceptions: ExceptionDateRule[]): DailySchedule[] {
    const start = parseDateString(startDateStr);
    const end = parseDateString(endDateStr);
    const map = new Map(exceptions.map(e => [e.date, e]));
    const days: DailySchedule[] = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const date = isoDate(cursor);
      const ex = map.get(date);
      const minutes = Math.max(ex?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS, 0);
      const isRest = ex?.isRestDayOverride ?? false;
      days.push({
        date,
        dayName: cursor.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        tasks: [],
        totalStudyTimeMinutes: minutes,
        isRestDay: isRest,
        isManuallyModified: !!ex
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  private categorize(): void {
    for (const r of this.allResources.values()) {
      const title = (r.title || '').toLowerCase();
      const video = (r.videoSource || '').toLowerCase();
      const book = (r.bookSource || '').toLowerCase();

      // Titan + paired
      if (video.includes('titan')) {
        this.titanPool.push(r);
        this.phase1Ids.add(r.id);
      } else if (book.includes('crack the core') || book.includes('case companion')) {
        this.phase1Ids.add(r.id);
      } else if (book.includes('qevlar')) {
        this.qevlarPool.push(r);
        this.phase1Ids.add(r.id);
      }
      // Huda (Physics)
      else if (video.includes('huda') || book.includes('huda')) {
        this.hudaPool.push(r);
        this.phase1Ids.add(r.id);
      }
      // Nuclear (including NucApp)
      else if (r.domain === Domain.NUCLEAR_MEDICINE) {
        this.nuclearPool.push(r);
        this.phase1Ids.add(r.id);
        if (book.includes('nucapp')) this.nucAppPool.push(r);
      }
      // NIS / RISC
      else if (r.domain === Domain.NIS || r.domain === Domain.RISC) {
        this.nisRiscPool.push(r);
        this.phase2Ids.add(r.id);
      }
      // Board Vitals
      else if (book.includes('board vitals')) {
        this.boardVitalsPool.push(r);
        this.phase2Ids.add(r.id);
        if (r.questionCount) this.totalBVQuestions += r.questionCount;
      }
      // Physics non-Huda
      else if (r.domain === Domain.PHYSICS) {
        this.physicsPool.push(r);
        this.phase2Ids.add(r.id);
      }
      // Discord
      else if (video.includes('discord')) {
        this.discordPool.push(r);
        this.phase3Ids.add(r.id);
      }
      // Core Radiology
      else if (book.includes('core radiology') || title.includes('core radiology')) {
        this.coreRadPool.push(r);
        this.phase3Ids.add(r.id);
      }
      // Default fallback
      else {
        // Primary material treated as Phase 2
        if (r.isPrimaryMaterial || !r.isOptional) {
          this.phase2Ids.add(r.id);
        } else {
          this.phase3Ids.add(r.id);
        }
      }
    }
  }

  private precomputeBVDailyQuotas(): void {
    if (this.totalBVQuestions <= 0) return;
    let remaining = this.totalBVQuestions;
    const perMin = 0.5; // 2 min per Q

    for (let i = 0; i < this.studyDays.length; i++) {
      const day = this.studyDays[i];
      const remainingDays = this.studyDays.length - i;
      const avgPerDay = Math.ceil(remaining / Math.max(1, remainingDays));
      const maxByTime = Math.floor(day.totalStudyTimeMinutes * 0.4 * perMin); // up to 40% for BV

      const target = Math.max(0, Math.min(avgPerDay, maxByTime, remaining));

      // Suggested subjects: union of topics covered today & earlier (exclude misc buckets)
      const suggestions = new Set<Domain>();
      for (let j = 0; j <= i; j++) {
        const topics = this.coveredTopicsByDay.get(this.studyDays[j].date) || new Set();
        topics.forEach(t => suggestions.add(t));
      }

      this.bvDaily.push({
        date: day.date,
        targetQuestions: target,
        suggestedSubjects: Array.from(suggestions)
      });

      remaining -= target;
    }
  }

  private remainingTime(day: DailySchedule): number {
    const used = day.tasks.reduce((s, t) => s + t.durationMinutes, 0);
    return Math.max(0, day.totalStudyTimeMinutes - used);
  }

  private taskFor(resource: StudyResource, order: number): ScheduledTask {
    this.taskCounter++;
    const orig = resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id;
    return {
      id: `task_${resource.id}_${this.taskCounter}`,
      resourceId: resource.id,
      originalResourceId: orig,
      title: resource.title,
      type: resource.type,
      originalTopic: resource.domain,
      durationMinutes: resource.durationMinutes,
      status: 'pending',
      order,
      isOptional: resource.isOptional,
      isPrimaryMaterial: resource.isPrimaryMaterial,
      pages: resource.pages,
      startPage: resource.startPage,
      endPage: resource.endPage,
      caseCount: resource.caseCount,
      questionCount: resource.questionCount,
      chapterNumber: resource.chapterNumber,
      bookSource: resource.bookSource,
      videoSource: resource.videoSource
    };
  }

  private addToDay(day: DailySchedule, r: StudyResource): boolean {
    if (!this.remaining.has(r.id)) return false;
    if (this.remainingTime(day) < r.durationMinutes) return false;
    day.tasks.push(this.taskFor(r, day.tasks.length));
    this.remaining.delete(r.id);
    const set = this.coveredTopicsByDay.get(day.date)!;
    set.add(r.domain);
    if ((r.bookSource || '').toLowerCase().includes('board vitals') && r.questionCount) {
      this.scheduledBVQuestions += r.questionCount;
    }
    return true;
  }

  private hasKeyword(title: string, keyword: string): boolean {
    return title.toLowerCase().includes(keyword);
  }

  private titanRankFromTitle(title: string): number {
    const t = title.toLowerCase();
    for (let i = 0; i < TITAN_SEQUENCE_KEYWORDS.length; i++) {
      if (t.includes(TITAN_SEQUENCE_KEYWORDS[i])) return i;
    }
    return TITAN_SEQUENCE_KEYWORDS.length + 999; // lowest priority if unknown
  }

  private topicallyRelated(a: StudyResource, b: StudyResource): boolean {
    if (a.domain === b.domain) return true;
    if (a.chapterNumber && b.chapterNumber && a.chapterNumber === b.chapterNumber) return true;
    const titleA = (a.title || '').toLowerCase();
    const titleB = (b.title || '').toLowerCase();
    for (const kw of [
      'pancreas', 'liver', 'renal', 'kidney', 'reproductive', 'gyne', 'uterus', 'ovary', 'prostate', 'testicular',
      'barium', 'esophagus', 'stomach', 'small bowel', 'colon', 'crohn',
      'chest', 'thorax', 'lung', 'mediastinum', 'airways',
      'thyroid', 'parathyroid',
      'msk', 'musculoskeletal', 'bone', 'joint',
      'neuro', 'brain', 'spine', 'temporal bone',
      'peds', 'pediatric',
      'cardiac', 'coronary',
      'breast',
      'nuclear', 'pet', 'spect', 'vq',
      'ir', 'interventional', 'vascular',
      'physics', 'ct', 'mri', 'ultrasound', 'fluoro', 'x-ray'
    ]) {
      if (titleA.includes(kw) && titleB.includes(kw)) return true;
    }
    return false;
  }

  private buildTitanBlocks(): TopicBlock[] {
    // Titan anchors sorted by the Titan canonical sequence, then by sequenceOrder as tiebreaker
    const anchors = this.titanPool
      .filter(r =>
        this.remaining.has(r.id) &&
        (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
      )
      .map(r => ({ r, rank: this.titanRankFromTitle(r.title || '') }))
      .sort((a, b) => (a.rank - b.rank) || ((a.r.sequenceOrder ?? 9999) - (b.r.sequenceOrder ?? 9999)));

    const blocks: TopicBlock[] = [];

    for (const { r: anchor, rank } of anchors) {
      const blockResources: StudyResource[] = [anchor];

      // Pair Crack the Core + Case Companion by topical match
      for (const s of this.allResources.values()) {
        if (!this.remaining.has(s.id)) continue;
        const book = (s.bookSource || '').toLowerCase();
        if ((book.includes('crack the core') || book.includes('case companion')) && this.topicallyRelated(anchor, s)) {
          blockResources.push(s);
        }
      }

      // QEVLAR topical pair
      for (const q of this.qevlarPool) {
        if (!this.remaining.has(q.id)) continue;
        if (this.topicallyRelated(anchor, q)) blockResources.push(q);
      }

      // Unique by id
      const seen = new Set<string>();
      const unique = blockResources.filter(x => {
        if (seen.has(x.id)) return false;
        seen.add(x.id);
        return true;
      });

      const total = unique.reduce((sum, x) => sum + x.durationMinutes, 0);
      blocks.push({
        id: `titan_block_${anchor.id}`,
        type: 'titan',
        domain: anchor.domain,
        resources: unique,
        totalMinutes: total,
        titanOrderRank: rank
      });
    }
    // Ensure strict Titan order
    blocks.sort((a, b) => (a.titanOrderRank! - b.titanOrderRank!));
    return blocks;
  }

  private buildHudaBlocks(): TopicBlock[] {
    const anchors = this.hudaPool
      .filter(r => this.remaining.has(r.id))
      .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

    const blocks: TopicBlock[] = [];
    for (const a of anchors) {
      const group = [a];
      // Grab a couple more Huda items to keep Physics pairing compact
      for (const s of this.hudaPool) {
        if (!this.remaining.has(s.id)) continue;
        if (s.id === a.id) continue;
        if (s.domain === Domain.PHYSICS) group.push(s);
        if (group.length >= 4) break;
      }
      const seen = new Set<string>();
      const unique = group.filter(x => {
        if (seen.has(x.id)) return false;
        seen.add(x.id);
        return true;
      });
      const total = unique.reduce((sum, x) => sum + x.durationMinutes, 0);
      blocks.push({
        id: `huda_block_${a.id}`,
        type: 'huda',
        domain: Domain.PHYSICS,
        resources: unique,
        totalMinutes: total
      });
    }
    return blocks;
  }

  private buildNuclearBlocks(): TopicBlock[] {
    const anchors = this.nuclearPool
      .filter(r => this.remaining.has(r.id))
      .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

    const blocks: TopicBlock[] = [];
    for (const a of anchors) {
      const group: StudyResource[] = [a];
      // Related nukes content incl. NucApp by topical or domain match
      for (const s of this.nuclearPool) {
        if (!this.remaining.has(s.id)) continue;
        if (s.id === a.id) continue;
        if (s.domain === a.domain || this.topicallyRelated(a, s)) group.push(s);
        if (group.length >= 6) break;
      }
      for (const n of this.nucAppPool) {
        if (!this.remaining.has(n.id)) continue;
        if (this.topicallyRelated(a, n)) group.push(n);
      }

      const seen = new Set<string>();
      const unique = group.filter(x => {
        if (seen.has(x.id)) return false;
        seen.add(x.id);
        return true;
      });
      const total = unique.reduce((sum, x) => sum + x.durationMinutes, 0);
      blocks.push({
        id: `nuclear_block_${a.id}`,
        type: 'nuclear',
        domain: a.domain,
        resources: unique,
        totalMinutes: total
      });
    }
    return blocks;
  }

  private placeBlocksRoundRobin(blocks: TopicBlock[], ringStart = 0): number {
    let idx = ringStart;
    for (const block of blocks) {
      const pending = block.resources.filter(r => this.remaining.has(r.id));
      if (pending.length === 0) {
        idx = (idx + 1) % this.studyDays.length;
        continue;
      }

      // Try same-day whole block placement
      let placedWhole = false;
      for (let k = 0; k < this.studyDays.length; k++) {
        const d = this.studyDays[(idx + k) % this.studyDays.length];
        const sum = pending.reduce((s, r) => s + r.durationMinutes, 0);
        if (this.remainingTime(d) >= sum) {
          for (const r of pending) this.addToDay(d, r);
          idx = (idx + k + 1) % this.studyDays.length;
          placedWhole = true;
          break;
        }
      }

      if (placedWhole) continue;

      // Carryover preserving order: fill remainder today, move rest to next day, etc.
      let resIdx = 0;
      while (resIdx < pending.length) {
        const d = this.studyDays[idx];
        const space = this.remainingTime(d);
        if (space <= 0) {
          idx = (idx + 1) % this.studyDays.length;
          continue;
        }
        // add as many sequential resources as fit
        let addedAny = false;
        for (let i = resIdx; i < pending.length; i++) {
          const r = pending[i];
          if (this.remainingTime(d) >= r.durationMinutes) {
            this.addToDay(d, r);
            resIdx = i + 1;
            addedAny = true;
          } else {
            break;
          }
        }
        if (!addedAny) {
          // if nothing fit, advance ring
          idx = (idx + 1) % this.studyDays.length;
        } else {
          // move to next day to continue carryover
          idx = (idx + 1) % this.studyDays.length;
        }
      }
    }
    return idx;
  }

  private executePhase1(): void {
    this.notifications.push({ type: 'info', message: 'Phase 1: Start (Titan/Huda/Nuclear)' });

    const titanBlocks = this.buildTitanBlocks();
    let ring = this.placeBlocksRoundRobin(titanBlocks, 0);

    const hudaBlocks = this.buildHudaBlocks();
    ring = this.placeBlocksRoundRobin(hudaBlocks, ring);

    const nuclearBlocks = this.buildNuclearBlocks();
    ring = this.placeBlocksRoundRobin(nuclearBlocks, ring);

    this.notifications.push({ type: 'info', message: 'Phase 1: Complete' });
  }

  private executePhase2PerDay(): void {
    this.notifications.push({ type: 'info', message: 'Phase 2: Start per-day saturation' });

    // Build simple iterators for pools
    const nisRisc = this.nisRiscPool.filter(r => this.remaining.has(r.id))
      .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));
    const physics = this.physicsPool.filter(r => this.remaining.has(r.id))
      .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

    for (let di = 0; di < this.studyDays.length; di++) {
      const day = this.studyDays[di];

      // Pass 2a: NIS/RISC first-fit on this day
      for (const r of nisRisc) {
        if (!this.remaining.has(r.id)) continue;
        if (!this.addToDay(day, r)) continue;
      }

      // Pass 2b: Board Vitals daily mixed quota with subjects from covered topics up to this day
      const bvAlloc = this.bvDaily[di];
      if (bvAlloc && bvAlloc.targetQuestions > 0) {
        let scheduledQs = 0;
        const bvSorted = this.boardVitalsPool
          .filter(r => this.remaining.has(r.id))
          .sort((a, b) => {
            const aMatch = bvAlloc.suggestedSubjects.includes(a.domain) ? 1 : 0;
            const bMatch = bvAlloc.suggestedSubjects.includes(b.domain) ? 1 : 0;
            if (aMatch !== bMatch) return bMatch - aMatch;
            return (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999);
          });

        for (const r of bvSorted) {
          if (scheduledQs >= bvAlloc.targetQuestions) break;
          if (!this.addToDay(day, r)) continue;
          scheduledQs += r.questionCount ?? 0;
        }

        if (scheduledQs > 0) {
          this.notifications.push({
            type: 'info',
            message: `BV ${day.date}: ${scheduledQs}/${bvAlloc.targetQuestions} Q, suggested ${bvAlloc.suggestedSubjects.map(x => x).join(', ')}`
          });
        }
      }

      // Pass 2c: Physics (non-Huda) first-fit
      for (const r of physics) {
        if (!this.remaining.has(r.id)) continue;
        if (!this.addToDay(day, r)) continue;
      }
    }

    this.notifications.push({ type: 'info', message: 'Phase 2: Complete per-day saturation' });
  }

  private executePhase3Greedy(): void {
    // Unlock after Phase 1 placed and Phase 2 attempted; do not hard-block on unscheduled Phase 2 pools
    this.notifications.push({ type: 'info', message: 'Phase 3: Start greedy relevancy fill' });

    const supplementary = [
      ...this.discordPool.filter(r => this.remaining.has(r.id)),
      ...this.coreRadPool.filter(r => this.remaining.has(r.id))
    ];

    // Multiple greedy passes to consume slack
    for (let pass = 0; pass < 2; pass++) {
      for (const day of this.studyDays) {
        if (this.remainingTime(day) < 5) continue;

        const dayTopics = this.coveredTopicsByDay.get(day.date) || new Set<Domain>();
        const rank = (r: StudyResource) => {
          let score = 0;
          if (dayTopics.has(r.domain)) score += 100;
          // shorter items first to fill gaps better
          if (r.durationMinutes <= 10) score += 20;
          else if (r.durationMinutes <= 20) score += 10;
          // primary material bonus
          if (r.isPrimaryMaterial) score += 5;
          return score;
        };

        const sorted = supplementary.filter(r => this.remaining.has(r.id)).sort((a, b) => rank(b) - rank(a));
        for (const r of sorted) {
          if (!this.addToDay(day, r)) continue;
          if (this.remainingTime(day) < 5) break;
        }
      }
    }

    this.notifications.push({ type: 'info', message: 'Phase 3: Complete greedy fill' });
  }

  private validateAndCorrect(): void {
    // Enforce daily capacity with corrective redistribution
    for (let i = 0; i < this.studyDays.length; i++) {
      const day = this.studyDays[i];
      let total = day.tasks.reduce((s, t) => s + t.durationMinutes, 0);
      if (total <= day.totalStudyTimeMinutes) continue;

      const excess = total - day.totalStudyTimeMinutes;
      this.notifications.push({ type: 'warning', message: `Overload ${day.date}: ${excess} min, redistributing` });

      // Sort tasks by lower priority last -> move first
      const sorted = [...day.tasks].sort((a, b) => {
        const pa = TASK_TYPE_PRIORITY[a.type] ?? 999;
        const pb = TASK_TYPE_PRIORITY[b.type] ?? 999;
        if (pa !== pb) return pb - pa; // move lower-priority first
        if (a.isOptional !== b.isOptional) return a.isOptional ? -1 : 1; // move optional first
        return b.durationMinutes - a.durationMinutes; // move longer first
      });

      let moveMinutes = excess;
      const toMove: ScheduledTask[] = [];
      for (const t of sorted) {
        if (moveMinutes <= 0) break;
        toMove.push(t);
        moveMinutes -= t.durationMinutes;
      }

      // Remove from day
      day.tasks = day.tasks.filter(t => !toMove.some(m => m.id === t.id));

      // Try to place on other days with most available time
      const candidates = this.studyDays
        .map(d => ({ d, free: d.totalStudyTimeMinutes - d.tasks.reduce((s, t) => s + t.durationMinutes, 0) }))
        .sort((a, b) => b.free - a.free)
        .map(x => x.d);

      for (const t of toMove) {
        let placed = false;
        for (const d of candidates) {
          if (d.date === day.date) continue;
          const free = d.totalStudyTimeMinutes - d.tasks.reduce((s, x) => s + x.durationMinutes, 0);
          if (free >= t.durationMinutes) {
            d.tasks.push({ ...t, order: d.tasks.length });
            placed = true;
            break;
          }
        }
        if (!placed) {
          // Put back if cannot place anywhere (rare)
          day.tasks.push(t);
        }
      }
    }

    // Resort tasks within each day
    for (const d of this.schedule) {
      d.tasks.sort(sortTasksByGlobalPriority);
      d.tasks.forEach((t, idx) => (t.order = idx));
    }
  }

  private finalize(): void {
    const totalScheduled = this.schedule.reduce((s, d) => s + d.tasks.reduce((ds, t) => ds + t.durationMinutes, 0), 0);
    const totalAvail = this.studyDays.reduce((s, d) => s + d.totalStudyTimeMinutes, 0);
    const util = totalAvail > 0 ? ((totalScheduled / totalAvail) * 100).toFixed(1) : '0.0';

    this.notifications.push({ type: 'info', message: `Utilization: ${totalScheduled} / ${totalAvail} min (${util}%)` });

    if (this.totalBVQuestions > 0) {
      const pct = ((this.scheduledBVQuestions / this.totalBVQuestions) * 100).toFixed(1);
      this.notifications.push({
        type: 'info',
        message: `Board Vitals scheduled: ${this.scheduledBVQuestions}/${this.totalBVQuestions} (${pct}%)`
      });
    }

    // Report remaining unscheduled
    const unscheduled = Array.from(this.remaining).slice(0, 10).map(id => {
      const r = this.allResources.get(id);
      return r ? `"${r.title}" (${r.durationMinutes}m)` : id;
    });
    if (this.remaining.size > 0) {
      this.notifications.push({
        type: 'warning',
        message: `Unscheduled remaining: ${this.remaining.size}${unscheduled.length ? ` e.g. ${unscheduled.join(', ')}` : ''}`
      });
    }
  }

  public generate(): GeneratedStudyPlanOutcome {
    if (this.studyDays.length === 0 || this.allResources.size === 0) {
      return {
        plan: {
          schedule: [],
          progressPerDomain: {},
          startDate: '',
          endDate: '',
          firstPassEndDate: null,
          topicOrder: this.topicOrder,
          cramTopicOrder: this.topicOrder.slice(),
          deadlines: this.deadlines,
          isCramModeActive: false,
          areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved
        },
        notifications: this.notifications
      };
    }

    // Phase 1
    this.executePhase1();
    // Phase 2
    this.executePhase2PerDay();
    // Phase 3
    this.executePhase3Greedy();
    // Phase 4
    this.validateAndCorrect();
    // Finalize
    this.finalize();

    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    // Initialize from all resources
    for (const r of this.allResources.values()) {
      progressPerDomain[r.domain] = progressPerDomain[r.domain] || { totalMinutes: 0, completedMinutes: 0 };
      progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes;
    }
    // Completed accumulation (if present)
    for (const d of this.schedule) {
      for (const t of d.tasks) {
        if (t.status === 'completed') {
          progressPerDomain[t.originalTopic]!.completedMinutes += t.durationMinutes;
        }
      }
    }

    return {
      plan: {
        schedule: this.schedule,
        progressPerDomain,
        startDate: this.schedule[0]?.date || '',
        endDate: this.schedule[this.schedule.length - 1]?.date || '',
        firstPassEndDate: null,
        topicOrder: this.topicOrder,
        cramTopicOrder: this.topicOrder.slice(),
        deadlines: this.deadlines,
        isCramModeActive: false,
        areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved
      },
      notifications: this.notifications
    };
  }
}

/**
 * Public API
 */

export const generateInitialSchedule = (
  resourcePool: StudyResource[],
  exceptionRules: ExceptionDateRule[],
  topicOrder: Domain[] | undefined,
  deadlines: DeadlineSettings | undefined,
  startDateStr: string,
  endDateStr: string,
  areSpecialTopicsInterleaved: boolean | undefined
): GeneratedStudyPlanOutcome => {
  const sched = new StrictTitanScheduler(
    startDateStr,
    endDateStr,
    exceptionRules,
    resourcePool,
    topicOrder,
    deadlines,
    areSpecialTopicsInterleaved
  );
  return sched.generate();
};

export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionRules: ExceptionDateRule[],
  resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
  const today = getTodayInNewYork();
  const start =
    options.type === 'standard'
      ? (options.rebalanceDate && options.rebalanceDate > today ? options.rebalanceDate : today)
      : options.date;

  const clampedStart = start > currentPlan.endDate ? currentPlan.endDate : (start < currentPlan.startDate ? currentPlan.startDate : start);

  const past = currentPlan.schedule.filter(d => d.date < clampedStart);

  // Exclude completed and archived
  const completed = new Set<string>();
  for (const d of currentPlan.schedule) {
    for (const t of d.tasks) {
      if (t.status === 'completed' && t.originalResourceId) completed.add(t.originalResourceId);
    }
  }
  const available = resourcePool.filter(r => !completed.has(r.id) && !r.isArchived);

  const sched = new StrictTitanScheduler(
    clampedStart,
    currentPlan.endDate,
    exceptionRules,
    available,
    currentPlan.topicOrder,
    currentPlan.deadlines,
    currentPlan.areSpecialTopicsInterleaved
  );
  const result = sched.generate();

  result.plan.schedule = [...past, ...result.plan.schedule];
  result.plan.startDate = currentPlan.startDate;

  // Recompute completed minutes including preserved past
  const ppd = result.plan.progressPerDomain;
  for (const d of result.plan.schedule) {
    for (const t of d.tasks) {
      if (t.status === 'completed') {
        ppd[t.originalTopic]!.completedMinutes += t.durationMinutes;
      }
    }
  }
  result.plan.progressPerDomain = ppd;
  return result;
};
