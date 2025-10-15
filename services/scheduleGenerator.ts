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
 * 4-Phase Scheduling Algorithm:
 * Phase 1: Primary Content Distribution (Round-Robin with Resource Prioritization)
 * Phase 2: Other Daily Requirements (Daily First-Fit with Priority)
 * Phase 3: Supplementary Lectures and Optional Content (Only after Phases 1&2 complete)
 * Phase 4: Validation and Optimization (Iterative Constraint Checking)
 */

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

type TopicBlock = {
  id: string;
  anchorResource: StudyResource;
  pairedResources: StudyResource[];
  totalMinutes: number;
  domain: Domain;
};

class AdvancedScheduler {
  private allResources: Map<string, StudyResource>;
  private remaining: Set<string>;
  private schedule: DailySchedule[];
  private studyDays: DailySchedule[];
  private notifications: GeneratedStudyPlanOutcome['notifications'] = [];
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskCounter = 0;
  private coveredTopicsPerDay: Map<string, Set<Domain>> = new Map();

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
    
    // Initialize covered topics tracking
    this.studyDays.forEach(day => {
      this.coveredTopicsPerDay.set(day.date, new Set<Domain>());
    });
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

  private buildTopicBlock(anchor: StudyResource): TopicBlock {
    const seen = new Set<string>();
    const queue: string[] = [anchor.id];
    const pairedResources: StudyResource[] = [];
    
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      const r = this.allResources.get(id);
      if (!r || !this.remaining.has(id)) continue;
      
      seen.add(id);
      if (r.id !== anchor.id) pairedResources.push(r);

      // Find paired resources
      for (const pid of r.pairedResourceIds ?? []) {
        if (!seen.has(pid)) queue.push(pid);
      }

      // Find topic-related resources
      const related = [...this.allResources.values()].filter(candidate => {
        if (seen.has(candidate.id) || !this.remaining.has(candidate.id)) return false;
        if (candidate.domain !== r.domain) return false;
        
        // Chapter alignment
        if (r.chapterNumber && candidate.chapterNumber && r.chapterNumber === candidate.chapterNumber) return true;
        
        // Title/topic keyword alignment  
        return this.topicsMatch((r.title || '').toLowerCase(), (candidate.title || '').toLowerCase());
      });
      
      for (const rel of related) {
        if (!seen.has(rel.id)) queue.push(rel.id);
      }
    }

    const totalMinutes = [anchor, ...pairedResources].reduce((s, r) => s + r.durationMinutes, 0);
    
    return {
      id: `block_${anchor.id}`,
      anchorResource: anchor,
      pairedResources,
      totalMinutes,
      domain: anchor.domain
    };
  }

  private topicsMatch(topic1: string, topic2: string): boolean {
    if (!topic1 || !topic2) return false;
    const keywords = [
      'pancreas','liver','renal','kidney','adrenal','spleen','biliary','gallbladder','gi','bowel',
      'thorax','chest','lung','mediastinum','pleura','thyroid','parathyroid',
      'msk','musculoskeletal','bone','joint','soft tissue',
      'neuro','brain','spine','spinal','head and neck',
      'peds','pediatric','paediatric','infant','child',
      'cardiac','heart','coronary','breast','mamm',
      'interventional','ir','vascular','nuclear','spect','pet',
      'physics','ct','mr','mri','dose','artifact'
    ];
    return keywords.some(kw => topic1.includes(kw) && topic2.includes(kw));
  }

  private scheduleBlockRoundRobin(blocks: TopicBlock[], startDayIndex: number = 0): number {
    let dayIndex = startDayIndex;
    
    for (const block of blocks) {
      const allResources = [block.anchorResource, ...block.pairedResources]
        .filter(r => this.remaining.has(r.id));
      
      if (allResources.length === 0) continue;

      // Try to fit entire block on one day
      let placed = false;
      for (let i = 0; i < this.studyDays.length; i++) {
        const tryDayIndex = (dayIndex + i) % this.studyDays.length;
        const day = this.studyDays[tryDayIndex];
        
        if (this.remainingTime(day) >= block.totalMinutes) {
          // Place entire block
          for (const resource of allResources) {
            day.tasks.push(this.toTask(resource, day.tasks.length));
            this.remaining.delete(resource.id);
            this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
          }
          dayIndex = (tryDayIndex + 1) % this.studyDays.length;
          placed = true;
          break;
        }
      }
      
      // If block doesn't fit entirely, split across days but keep pairs together
      if (!placed) {
        for (const resource of allResources) {
          for (let i = 0; i < this.studyDays.length; i++) {
            const tryDayIndex = (dayIndex + i) % this.studyDays.length;
            const day = this.studyDays[tryDayIndex];
            
            if (this.remainingTime(day) >= resource.durationMinutes) {
              day.tasks.push(this.toTask(resource, day.tasks.length));
              this.remaining.delete(resource.id);
              this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
              dayIndex = (tryDayIndex + 1) % this.studyDays.length;
              break;
            }
          }
        }
      }
    }
    
    return dayIndex;
  }

  private scheduleFirstFit(resources: StudyResource[]): void {
    for (const resource of resources) {
      if (!this.remaining.has(resource.id)) continue;
      
      let placed = false;
      for (const day of this.studyDays) {
        if (this.remainingTime(day) >= resource.durationMinutes) {
          day.tasks.push(this.toTask(resource, day.tasks.length));
          this.remaining.delete(resource.id);
          this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
          placed = true;
          break;
        }
      }
      
      if (!placed) {
        this.notifications.push({
          type: 'warning',
          message: `Could not schedule: "${resource.title}" (${resource.durationMinutes} min)`
        });
      }
    }
  }

  private getBoardVitalsSuggestions(day: DailySchedule): { subjects: Domain[], questionCount: number } {
    const allCoveredTopics = new Set<Domain>();
    
    // Get topics covered up to and including current day
    for (const d of this.studyDays) {
      if (d.date <= day.date) {
        const dayTopics = this.coveredTopicsPerDay.get(d.date) || new Set();
        dayTopics.forEach(topic => allCoveredTopics.add(topic));
      }
    }
    
    const subjects = Array.from(allCoveredTopics);
    
    // Calculate question count based on available time and total questions
    const remainingTime = this.remainingTime(day);
    const totalBoardVitalsQuestions = [...this.allResources.values()]
      .filter(r => ci(r.bookSource) === 'board vitals')
      .reduce((sum, r) => sum + (r.questionCount || 0), 0);
    
    const questionsPerMinute = 0.5; // Assume 2 minutes per question
    const maxQuestions = Math.floor(remainingTime * questionsPerMinute);
    const suggestedQuestions = Math.min(maxQuestions, Math.ceil(totalBoardVitalsQuestions / this.studyDays.length));
    
    return { subjects, questionCount: suggestedQuestions };
  }

  private scheduleWithRelevancy(resources: StudyResource[], type: 'discord' | 'core-radiology'): void {
    for (const day of this.studyDays) {
      const dayTopics = this.coveredTopicsPerDay.get(day.date) || new Set();
      
      // Sort resources by relevancy to day's topics
      const relevantResources = resources
        .filter(r => this.remaining.has(r.id))
        .sort((a, b) => {
          const aRelevant = dayTopics.has(a.domain) ? 1 : 0;
          const bRelevant = dayTopics.has(b.domain) ? 1 : 0;
          return bRelevant - aRelevant; // Higher relevance first
        });
      
      // Greedily fill remaining time
      for (const resource of relevantResources) {
        if (this.remainingTime(day) >= resource.durationMinutes) {
          day.tasks.push(this.toTask(resource, day.tasks.length));
          this.remaining.delete(resource.id);
          this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
        }
      }
    }
  }

  // PHASE 1: Primary Content Distribution (Round-Robin with Resource Prioritization)
  private phase1_primaryContentDistribution(): void {
    let dayIndex = 0;
    
    // Pass 1a: Titan Block Round-Robin
    const titanBlocks = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id) && 
        (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
        ci(r.videoSource) === 'titan radiology')
      .sort((a, b) => {
        const ca = a.chapterNumber ?? 9999;
        const cb = b.chapterNumber ?? 9999;
        if (ca !== cb) return ca - cb;
        return (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999);
      })
      .map(anchor => this.buildTopicBlock(anchor));
    
    dayIndex = this.scheduleBlockRoundRobin(titanBlocks, dayIndex);
    
    // Pass 1b: Huda Physics Block Round-Robin
    const hudaBlocks = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id) &&
        (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
        (ci(r.videoSource) === 'huda physics' || has(r.bookSource, 'huda')))
      .sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999))
      .map(anchor => this.buildTopicBlock(anchor));
    
    dayIndex = this.scheduleBlockRoundRobin(hudaBlocks, dayIndex);
    
    // Pass 1c: Nuclear Medicine Round-Robin
    const nuclearBlocks = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id) && r.domain === Domain.NUCLEAR_MEDICINE)
      .sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999))
      .map(anchor => this.buildTopicBlock(anchor));
    
    this.scheduleBlockRoundRobin(nuclearBlocks, dayIndex);
  }

  // PHASE 2: Other Daily Requirements (Daily First-Fit with Priority)
  private phase2_dailyRequirements(): void {
    // Pass 2a: NIS and RISC (First-Fit)
    const nisRiscResources = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id) && 
        (r.domain === Domain.NIS || r.domain === Domain.RISC))
      .sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
    
    this.scheduleFirstFit(nisRiscResources);
    
    // Pass 2b: Board Vitals questions with suggestions
    for (const day of this.studyDays) {
      const suggestions = this.getBoardVitalsSuggestions(day);
      
      if (suggestions.subjects.length > 0 && suggestions.questionCount > 0) {
        this.notifications.push({
          type: 'info',
          message: `Day ${day.date}: Suggested Board Vitals - ${suggestions.questionCount} questions covering: ${suggestions.subjects.join(', ')}`
        });
      }
      
      // Schedule Board Vitals resources
      const boardVitalsResources = [...this.allResources.values()]
        .filter(r => this.remaining.has(r.id) && ci(r.bookSource) === 'board vitals')
        .slice(0, 1); // Limit to available time
      
      for (const resource of boardVitalsResources) {
        if (this.remainingTime(day) >= resource.durationMinutes) {
          day.tasks.push(this.toTask(resource, day.tasks.length));
          this.remaining.delete(resource.id);
          this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
          break;
        }
      }
    }
    
    // Pass 2c: Physics (Titan Route First-Fit)
    const physicsResources = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id) && r.domain === Domain.PHYSICS)
      .sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
    
    this.scheduleFirstFit(physicsResources);
  }

  // PHASE 3: Supplementary Content (Only after Phases 1&2 complete)
  private phase3_supplementaryContent(): void {
    const anyPrimaryLeft = [...this.remaining].some(id => {
      const r = this.allResources.get(id);
      return r && (r.isPrimaryMaterial || !r.isOptional);
    });
    
    if (anyPrimaryLeft) {
      this.notifications.push({
        type: 'info',
        message: 'Primary resources remain; supplementary scheduling deferred.'
      });
      return;
    }
    
    // Pass 3a: Discord videos based on relevancy
    const discordResources = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id) && ci(r.videoSource) === 'discord');
    
    this.scheduleWithRelevancy(discordResources, 'discord');
    
    // Pass 3b: Core Radiology text based on relevancy
    const coreRadResources = [...this.allResources.values()]
      .filter(r => this.remaining.has(r.id) && 
        (ci(r.bookSource) === 'core radiology' || has(r.title, 'core radiology')));
    
    this.scheduleWithRelevancy(coreRadResources, 'core-radiology');
  }

  // PHASE 4: Validation and Optimization
  private phase4_validation(): void {
    let violations = 0;
    
    // Check 14-hour daily maximum
    for (const day of this.studyDays) {
      const totalMinutes = sumDay(day);
      const maxMinutes = day.totalStudyTimeMinutes;
      
      if (totalMinutes > maxMinutes) {
        violations++;
        const excess = totalMinutes - maxMinutes;
        this.notifications.push({
          type: 'warning',
          message: `Day ${day.date} exceeds limit by ${excess} minutes`
        });
        
        // Move lowest-priority tasks to next available day
        const sortedTasks = [...day.tasks].sort((a, b) => {
          const priorityA = TASK_TYPE_PRIORITY[a.type] ?? 99;
          const priorityB = TASK_TYPE_PRIORITY[b.type] ?? 99;
          return priorityB - priorityA; // Lower priority first
        });
        
        let removed = 0;
        for (const task of sortedTasks) {
          if (removed >= excess) break;
          
          // Find next available day
          const dayIndex = this.studyDays.findIndex(d => d.date === day.date);
          for (let i = dayIndex + 1; i < this.studyDays.length; i++) {
            const nextDay = this.studyDays[i];
            if (this.remainingTime(nextDay) >= task.durationMinutes) {
              // Move task
              day.tasks = day.tasks.filter(t => t.id !== task.id);
              nextDay.tasks.push(task);
              removed += task.durationMinutes;
              break;
            }
          }
        }
      }
    }
    
    if (violations > 0) {
      this.notifications.push({
        type: 'info',
        message: `Corrected ${violations} scheduling violations`
      });
    }
  }

  private finalize(): void {
    // Sort tasks within each day by global priority
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
    }
    
    // Report unscheduled resources
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
      this.notifications.push({
        type: 'error',
        message: 'No study days available in the selected period.'
      });
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

    // Execute 4-phase algorithm
    this.phase1_primaryContentDistribution();
    this.phase2_dailyRequirements();
    this.phase3_supplementaryContent();
    this.phase4_validation();
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
        startDate: this.schedule[0]?.date || '',
        endDate: this.schedule[this.schedule.length - 1]?.date || '',
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
  const scheduler = new AdvancedScheduler(
    startDateStr,
    endDateStr,
    exceptionRules,
    resourcePool,
    topicOrder || DEFAULT_TOPIC_ORDER,
    deadlines || {},
    areSpecialTopicsInterleaved ?? true
  );
  return scheduler.run();
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
  const completed = new Set<string>();
  
  for (const day of currentPlan.schedule) {
    for (const t of day.tasks) {
      if (t.status === 'completed' && t.originalResourceId) {
        completed.add(t.originalResourceId);
      }
    }
  }
  
  const remainingPool = resourcePool.filter(r => !completed.has(r.id) && !r.isArchived);
  const scheduler = new AdvancedScheduler(
    rebalanceStart,
    currentPlan.endDate,
    exceptionRules,
    remainingPool,
    currentPlan.topicOrder,
    currentPlan.deadlines,
    currentPlan.areSpecialTopicsInterleaved
  );
  
  const out = scheduler.run();
  out.plan.schedule = [...past, ...out.plan.schedule];
  out.plan.startDate = currentPlan.startDate;
  
  // Update progress tracking
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
