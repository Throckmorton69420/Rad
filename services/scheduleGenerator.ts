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
 * Scheduling algorithm with STRICT domain completion before moving to next domain.
 * Strategy: Exhaust each domain completely (all Titan videos + all CTC + all Cases + all QEVLAR for that domain)
 * before moving to next domain in Titan order.
 * 
 * Nuclear/Physics/NIS/RISC are interleaved daily with round-robin.
 */

import { sortTasksByGlobalPriority } from '../utils/taskPriority';

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

  if (isVideo && vs === 'titan radiology') return 1;
  if (isReading && bs === 'crack the core') return 2;
  if (isCases && (bs === 'case companion' || has(title, 'case companion'))) return 3;
  if (isQuestions && (bs === 'qevlar' || vs === 'qevlar' || has(title, 'qevlar'))) return 4;
  if (isVideo && (vs === 'huda physics' || has(bs, 'huda'))) return 5;
  if (isQuestions && (has(bs, 'huda') || has(title, 'huda physics qb'))) return 6;
  if (isReading && (has(bs, 'huda') || has(bs, 'review of physics'))) return 7;
  if (domain === Domain.NUCLEAR_MEDICINE) return 8;
  if (isQuestions && (has(bs, 'nucs app'))) return 8;
  if (domain === Domain.NIS || domain === Domain.RISC) return 9;
  if (bs === 'board vitals') return 10;
  if (vs === 'discord') return 11;
  if (bs === 'core radiology' || vs === 'core radiology' || has(title, 'core radiology')) return 12;
  return 12;
};

const isPrimaryByCategory = (r: StudyResource): boolean => getCategoryRankFromResource(r) <= 10;

class Scheduler {
  private allResources: Map<string, StudyResource>;
  private remaining: Set<string>;
  private schedule: DailySchedule[];
  private studyDays: DailySchedule[];
  private notifications: GeneratedStudyPlanOutcome['notifications'] = [];
  private taskCounter = 0;

  // Define Titan domain order (excludes Nuclear/Physics which are daily)
  private readonly TITAN_DOMAIN_ORDER: Domain[] = [
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
    return day.totalStudyTimeMinutes - sumDay(day);
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

  /**
   * CRITICAL METHOD: Exhaust entire domain before moving to next.
   * For each domain, place ALL Titan videos, ALL CTC pages, ALL Cases, ALL QEVLAR for that domain.
   */
  private exhaustDomainCompletely(domain: Domain, dayIndexStart: number): number {
    let cursor = dayIndexStart;

    // Step 1: Get ALL remaining resources for this domain (primaries only)
    const domainResources = [...this.remaining]
      .map(id => this.allResources.get(id)!)
      .filter(r => r && r.domain === domain && (isPrimaryByCategory(r) || r.isPrimaryMaterial));

    // Step 2: Sort by global priority (Titan videos first, then CTC, then Cases, then QEVLAR)
    const sorted = sortResourcesByTaskPriority(domainResources);

    // Step 3: Place each item in order, round-robin across days
    for (const res of sorted) {
      if (!this.remaining.has(res.id)) continue;

      let placed = false;
      // Try to fit on current day or next available day
      for (let attempt = 0; attempt < this.studyDays.length; attempt++) {
        const dayIndex = (cursor + attempt) % this.studyDays.length;
        const day = this.studyDays[dayIndex];
        
        if (this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
          placed = true;
          cursor = (dayIndex + 1) % this.studyDays.length; // Advance cursor for next item
          break;
        }
      }

      if (!placed) {
        this.notifications.push({
          type: 'warning',
          message: `Could not fit "${res.title}" (${res.durationMinutes} min) for domain ${domain}`
        });
      }
    }

    return cursor;
  }

  /**
   * Place daily Nuclear/Physics/NIS/RISC items (one per day in round-robin)
   */
  private interleaveSpecialTopics(): void {
    const getSpecialResources = (domain: Domain) => {
      return [...this.remaining]
        .map(id => this.allResources.get(id)!)
        .filter(r => r && r.domain === domain && (isPrimaryByCategory(r) || r.isPrimaryMaterial));
    };

    const nuclear = sortResourcesByTaskPriority(getSpecialResources(Domain.NUCLEAR_MEDICINE));
    const physics = sortResourcesByTaskPriority(getSpecialResources(Domain.PHYSICS));
    const nis = sortResourcesByTaskPriority(getSpecialResources(Domain.NIS));
    const risc = sortResourcesByTaskPriority(getSpecialResources(Domain.RISC));

    for (let dayIdx = 0; dayIdx < this.studyDays.length; dayIdx++) {
      const day = this.studyDays[dayIdx];

      // Try to place one Nuclear item
      if (nuclear.length > 0) {
        const res = nuclear.shift()!;
        if (this.remaining.has(res.id) && this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
        }
      }

      // Try to place one Physics item
      if (physics.length > 0) {
        const res = physics.shift()!;
        if (this.remaining.has(res.id) && this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
        }
      }

      // Try to place NIS/RISC if introduced
      if (dayIdx > 5 && nis.length > 0) {
        const res = nis.shift()!;
        if (this.remaining.has(res.id) && this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
        }
      }

      if (dayIdx > 5 && risc.length > 0) {
        const res = risc.shift()!;
        if (this.remaining.has(res.id) && this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
        }
      }
    }
  }

  /**
   * Fill remaining capacity with supplementary (Discord, Core Radiology) - topic-aligned
   */
  private fillSupplementary(): void {
    const supplementary = [...this.remaining]
      .map(id => this.allResources.get(id)!)
      .filter(r => r && !isPrimaryByCategory(r) && !r.isPrimaryMaterial);

    // Sort: Discord (11) before Core Radiology (12)
    supplementary.sort((a, b) => getCategoryRankFromResource(a) - getCategoryRankFromResource(b));

    for (const day of this.studyDays) {
      const dayDomains = new Set(day.tasks.map(t => t.originalTopic));
      
      // First pass: place supplementary that matches day's topics
      for (let i = supplementary.length - 1; i >= 0; i--) {
        const res = supplementary[i];
        if (!this.remaining.has(res.id)) {
          supplementary.splice(i, 1);
          continue;
        }

        if (dayDomains.has(res.domain) && this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
          supplementary.splice(i, 1);
        }
      }
    }

    // Second pass: place any remaining supplementary wherever it fits
    for (const day of this.studyDays) {
      for (let i = supplementary.length - 1; i >= 0; i--) {
        const res = supplementary[i];
        if (!this.remaining.has(res.id)) {
          supplementary.splice(i, 1);
          continue;
        }

        if (this.remainingTime(day) >= res.durationMinutes) {
          day.tasks.push(this.toTask(res, day.tasks.length));
          this.remaining.delete(res.id);
          supplementary.splice(i, 1);
        }
      }
    }
  }

  private finalize(): void {
    // Sort each day's tasks by global priority
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      // Reindex
      day.tasks.forEach((t, idx) => t.order = idx);
    }

    // Report unscheduled
    for (const id of this.remaining) {
      const r = this.allResources.get(id);
      if (r) {
        this.notifications.push({
          type: 'warning',
          message: `Could not schedule: "${r.title}" (${r.durationMinutes} min)`
        });
      }
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

    let cursor = 0;

    // PHASE 1: Process each Titan domain in order - EXHAUST COMPLETELY before moving to next
    for (const domain of this.TITAN_DOMAIN_ORDER) {
      cursor = this.exhaustDomainCompletely(domain, cursor);
    }

    // PHASE 2: Interleave Nuclear/Physics/NIS/RISC daily
    this.interleaveSpecialTopics();

    // PHASE 3: Fill remaining capacity with supplementary (Discord, Core Radiology)
    this.fillSupplementary();

    // PHASE 4: Finalize
    this.finalize();

    // Build progress tracking
    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    for (const r of this.allResources.values()) {
      if (!progressPerDomain[r.domain]) {
        progressPerDomain[r.domain] = { completedMinutes: 0, totalMinutes: 0 };
      }
      progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes;
    }

    return {
      plan: {
        schedule: this.schedule,
        progressPerDomain,
        startDate: this.schedule[0].date,
        endDate: this.schedule[this.schedule.length - 1].date,
        firstPassEndDate: null,
        topicOrder: this.TITAN_DOMAIN_ORDER,
        cramTopicOrder: [],
        deadlines: {},
        isCramModeActive: false,
        areSpecialTopicsInterleaved: true
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
    topicOrder || [],
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
  const rebalanceStart =
    options.type === 'standard'
      ? options.rebalanceDate && options.rebalanceDate > today
        ? options.rebalanceDate
        : today
      : options.date;
  const past = currentPlan.schedule.filter(d => d.date < rebalanceStart);
  const completed = new Set<string>();
  for (const day of currentPlan.schedule) {
    for (const t of day.tasks) {
      if (t.status === 'completed' && t.originalResourceId) {
        completed.add(t.originalResourceId);
      }
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
  Object.values(out.plan.progressPerDomain).forEach(p => (p.completedMinutes = 0));
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
