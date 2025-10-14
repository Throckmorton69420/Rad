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

import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';

/**
 * Core fixes implemented:
 * 1) Do NOT filter the pool to primary-only; Phase 1 blocks include paired items (e.g., Qevlar/CTC) that may be non-primary. 
 * 2) Build blocks by following pairedResourceIds (BFS), keeping all paired items together and sorted by TASK_TYPE_PRIORITY.
 * 3) Strict round-robin distribution:
 *    - Pass 1a: Titan video anchors → whole block to Day k; if not enough time, try next day; only split if the block cannot fit in any single day and contains non-splittable items.
 *    - Pass 1b: Huda videos in the same manner, continuing the day cursor where Titan pass ended.
 *    - Pass 1c: Other primary videos (e.g., War Machine anchors) likewise.
 * 4) Phase 2 and Phase 3 retained, but they never preempt or dilute Phase 1 ordering.
 */

const isoDate = (d: Date) => d.toISOString().split('T')[0];

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
    // Critical fix: do not pre-filter to primary material here; Phase 1 blocks include paired content that may be non-primary.
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

  private remainingTime(day: DailySchedule): number {
    return day.totalStudyTimeMinutes - day.tasks.reduce((s, t) => s + t.durationMinutes, 0);
  }

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
      isPrimaryMaterial: res.isPrimaryMaterial,
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

  // BFS over pairedResourceIds to gather a complete block; includes non-primary paired materials.
  private buildBlockFromAnchor(anchor: StudyResource): Block {
    const seen = new Set<string>();
    const q: string[] = [anchor.id];
    const items: StudyResource[] = [];

    while (q.length) {
      const id = q.shift()!;
      if (seen.has(id)) continue;
      const r = this.allResources.get(id);
      if (!r) continue;
      if (!this.remaining.has(id)) continue; // already scheduled

      seen.add(id);
      items.push(r);
      for (const pid of r.pairedResourceIds ?? []) {
        if (!seen.has(pid)) q.push(pid);
      }
    }

    // Sort by type priority (videos → readings → cases → questions → …)
    items.sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
    const total = items.reduce((s, r) => s + r.durationMinutes, 0);

    return { anchorId: anchor.id, domain: anchor.domain, items, totalMinutes: total };
  }

  private tryPlaceWholeBlockOnDay(block: Block, dayIndexStart: number): number | null {
    for (let i = 0; i < this.studyDays.length; i++) {
      const idx = (dayIndexStart + i) % this.studyDays.length;
      const day = this.studyDays[idx];
      if (this.remainingTime(day) >= block.totalMinutes) return idx;
    }
    return null;
  }

  private placeBlockStrictRoundRobin(blocks: Block[], startCursor: number): number {
    let cursor = startCursor;
    for (const block of blocks) {
      // Skip if block already consumed externally
      const liveItems = block.items.filter(it => this.remaining.has(it.id));
      if (liveItems.length === 0) { cursor++; continue; }

      // Preferred: whole block on a single day (round-robin search)
      const fitDay = this.tryPlaceWholeBlockOnDay(
        { ...block, items: liveItems, totalMinutes: liveItems.reduce((s, r) => s + r.durationMinutes, 0) },
        cursor
      );

      if (fitDay !== null) {
        const day = this.studyDays[fitDay];
        for (const r of liveItems) {
          day.tasks.push(this.toTask(r, day.tasks.length));
          this.remaining.delete(r.id);
        }
        cursor = (fitDay + 1) % this.studyDays.length;
        continue;
      }

      // Fallback: ordered multi-day placement without reordering within the block
      let placedAny = false;
      for (const r of liveItems) {
        let placed = false;

        // If a single resource can't fit any day and is splittable chunks already created, they will be separate items; otherwise try all days
        for (let i = 0; i < this.studyDays.length; i++) {
          const idx = (cursor + i) % this.studyDays.length;
          const day = this.studyDays[idx];
          if (this.remainingTime(day) >= r.durationMinutes) {
            day.tasks.push(this.toTask(r, day.tasks.length));
            this.remaining.delete(r.id);
            placed = true;
            placedAny = true;
            cursor = (idx + 1) % this.studyDays.length;
            break;
          }
        }

        if (!placed) {
          // Could not place this resource anywhere
          this.notifications.push({ type: 'warning', message: `Block item could not fit: "${r.title}" (${r.durationMinutes} min)` });
        }
      }

      if (!placedAny) {
        this.notifications.push({ type: 'warning', message: `Block could not be placed: anchor "${block.anchorId}"` });
        cursor = (cursor + 1) % this.studyDays.length;
      }
    }
    return cursor;
  }

  // Phase 1a: Titan Radiology
  private phase1a_distributeTitan(cursorStart: number): number {
    const anchors: StudyResource[] = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id)
        && (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
        && r.videoSource === 'Titan Radiology');

    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 1b: Huda Physics
  private phase1b_distributeHuda(cursorStart: number): number {
    const anchors: StudyResource[] = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id)
        && (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
        && r.videoSource === 'Huda Physics');

    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 1c: Other primary anchors (e.g., War Machine)
  private phase1c_distributeOtherPrimaries(cursorStart: number): number {
    const anchors: StudyResource[] = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id)
        && (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
        && r.videoSource !== 'Titan Radiology'
        && r.videoSource !== 'Huda Physics'
        && r.isPrimaryMaterial);

    anchors.sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

    const blocks = anchors.map(a => this.buildBlockFromAnchor(a));
    return this.placeBlockStrictRoundRobin(blocks, cursorStart);
  }

  // Phase 2: Daily requirements (conservative first-fit; never preempts Phase 1)
  private phase2_dailyFirstFit(): void {
    // Build pools from remaining
    const remainingResources = [...this.remaining].map(id => this.allResources.get(id)!).filter(Boolean);

    const nucMed = remainingResources
      .filter(r => r.domain === Domain.NUCLEAR_MEDICINE && r.isPrimaryMaterial)
      .sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

    const nisRisc = remainingResources
      .filter(r => (r.domain === Domain.NIS || r.domain === Domain.RISC) && r.isPrimaryMaterial)
      .sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

    const boardVitals = remainingResources
      .filter(r => r.bookSource === 'Board Vitals' && r.isPrimaryMaterial);

    for (let d = 0; d < this.studyDays.length; d++) {
      const day = this.studyDays[d];

      // Covered topics up to today
      const covered = new Set<Domain>();
      for (let i = 0; i <= d; i++) {
        for (const t of this.studyDays[i].tasks) covered.add(t.originalTopic);
      }

      // Fit one Nuc Med
      for (let i = 0; i < nucMed.length; i++) {
        const r = nucMed[i];
        if (!this.remaining.has(r.id)) continue;
        if (this.remainingTime(day) >= r.durationMinutes) {
          day.tasks.push(this.toTask(r, day.tasks.length));
          this.remaining.delete(r.id);
          nucMed.splice(i, 1);
          break;
        }
      }

      // Fit one NIS/RISC
      for (let i = 0; i < nisRisc.length; i++) {
        const r = nisRisc[i];
        if (!this.remaining.has(r.id)) continue;
        if (this.remainingTime(day) >= r.durationMinutes) {
          day.tasks.push(this.toTask(r, day.tasks.length));
          this.remaining.delete(r.id);
          nisRisc.splice(i, 1);
          break;
        }
      }

      // Context-aware Board Vitals: only if topic already covered
      for (let i = 0; i < boardVitals.length; i++) {
        const r = boardVitals[i];
        if (!this.remaining.has(r.id)) continue;
        if (!covered.has(r.domain)) continue;
        if (this.remainingTime(day) >= r.durationMinutes) {
          day.tasks.push(this.toTask(r, day.tasks.length));
          this.remaining.delete(r.id);
          boardVitals.splice(i, 1);
          break;
        }
      }
    }
  }

  // Phase 3: Supplementary fill (topic-aware then general)
  private phase3_supplementaryFill(): void {
    const pool = [...this.remaining].map(id => this.allResources.get(id)!).filter(Boolean);

    const supplementary = pool
      .filter(r => !r.isPrimaryMaterial && !r.isArchived)
      .sort((a, b) => {
        if (a.videoSource === 'Discord' && b.videoSource !== 'Discord') return -1;
        if (a.videoSource !== 'Discord' && b.videoSource === 'Discord') return 1;
        return (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99);
      });

    // Topic-aware pass
    for (const day of this.studyDays) {
      const topics = new Set(day.tasks.map(t => t.originalTopic));
      for (let i = supplementary.length - 1; i >= 0; i--) {
        const r = supplementary[i];
        if (!this.remaining.has(r.id)) { supplementary.splice(i, 1); continue; }
        if (topics.has(r.domain) && this.remainingTime(day) >= r.durationMinutes) {
          day.tasks.push(this.toTask(r, day.tasks.length));
          this.remaining.delete(r.id);
          supplementary.splice(i, 1);
        }
      }
    }

    // General fill pass
    for (const day of this.studyDays) {
      for (let i = supplementary.length - 1; i >= 0; i--) {
        const r = supplementary[i];
        if (!this.remaining.has(r.id)) { supplementary.splice(i, 1); continue; }
        if (this.remainingTime(day) >= r.durationMinutes) {
          day.tasks.push(this.toTask(r, day.tasks.length));
          this.remaining.delete(r.id);
          supplementary.splice(i, 1);
        }
      }
    }
  }

  private finalize(): void {
    // Sort tasks within each day (by their insertion order already coherent)
    for (const day of this.schedule) {
      day.tasks.sort((a, b) => a.order - b.order);
    }
    // Report unscheduled
    for (const id of this.remaining) {
      const r = this.allResources.get(id);
      if (r) this.notifications.push({ type: 'warning', message: `Could not schedule: "${r.title}" (${r.durationMinutes} min)` });
    }
  }

  public run(): GeneratedStudyPlanOutcome {
    if (this.studyDays.length === 0) {
      this.notifications.push({ type: 'error', message: 'No study days available in the selected period.' });
      return {
        plan: {
          schedule: [],
          progressPerDomain: {},
          startDate: '',
          endDate: '',
          firstPassEndDate: null,
          topicOrder: [],
          cramTopicOrder: [],
          deadlines: {},
          isCramModeActive: false,
          areSpecialTopicsInterleaved: false
        },
        notifications: this.notifications
      };
    }

    // Phase 1: Strict block round-robin in priority order
    let cursor = 0;
    cursor = this.phase1a_distributeTitan(cursor);    // Pass 1a
    cursor = this.phase1b_distributeHuda(cursor);     // Pass 1b
    cursor = this.phase1c_distributeOtherPrimaries(cursor); // Pass 1c
    // Phase 2: Daily requirements
    this.phase2_dailyFirstFit();
    // Phase 3: Supplementary backfill
    this.phase3_supplementaryFill();
    // Finalize
    this.finalize();

    // Progress
    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    for (const r of this.allResources.values()) {
      if (!progressPerDomain[r.domain]) progressPerDomain[r.domain] = { completedMinutes: 0, totalMinutes: 0 };
      progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes;
    }

    return {
      plan: {
        schedule: this.schedule,
        progressPerDomain,
        startDate: this.schedule[0].date,
        endDate: this.schedule[this.schedule.length - 1].date,
        firstPassEndDate: null,
        topicOrder: this.topicOrder,
        cramTopicOrder: [],
        deadlines: this.deadlines,
        isCramModeActive: false,
        areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved
      },
      notifications: this.notifications
    };
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
  const s = new Scheduler(
    startDateStr,
    endDateStr,
    exceptionRules,
    resourcePool,
    topicOrder || DEFAULT_TOPIC_ORDER,
    deadlines || {},
    areSpecialTopicsInterleaved ?? true
  );
  return s.run();
};

export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionRules: ExceptionDateRule[],
  resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
  const today = getTodayInNewYork();
  const rebalanceStart = options.type === 'standard'
    ? (options.rebalanceDate && options.rebalanceDate > today ? options.rebalanceDate : today)
    : options.date;

  const past = currentPlan.schedule.filter(d => d.date < rebalanceStart);

  // Determine completed original resource IDs
  const completed = new Set<string>();
  for (const day of currentPlan.schedule) {
    for (const t of day.tasks) {
      if (t.status === 'completed' && t.originalResourceId) completed.add(t.originalResourceId);
    }
  }

  const remainingPool = resourcePool.filter(r => !completed.has(r.id) && !r.isArchived);

  const s = new Scheduler(
    rebalanceStart,
    currentPlan.endDate,
    exceptionRules,
    remainingPool,
    currentPlan.topicOrder,
    currentPlan.deadlines,
    currentPlan.areSpecialTopicsInterleaved
  );

  const out = s.run();
  out.plan.schedule = [...past, ...out.plan.schedule];
  out.plan.startDate = currentPlan.startDate;

  // Recompute completed
  Object.values(out.plan.progressPerDomain).forEach(p => p.completedMinutes = 0);
  for (const day of out.plan.schedule) {
    for (const t of day.tasks) {
      if (t.status === 'completed') {
        const p = out.plan.progressPerDomain[t.originalTopic];
        if (p) p.completedMinutes += t.durationMinutes;
      }
    }
  }

  return out;
};
