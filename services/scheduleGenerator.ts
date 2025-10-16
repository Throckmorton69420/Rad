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
 * WORKING 6-STEP DAILY TEMPLATE SCHEDULER (updated for 0.75 min/Q and priorities)
 */

// Exact Titan sequence
const TITAN_ORDER = [
  'pancreas', 'liver', 'renal', 'reproductive', 'abdominal barium',
  'chest', 'thyroid', 'musculoskeletal', 'neuro', 'pediatric', 
  'cardiac', 'breast', 'nuclear', 'interventional', 'vascular', 'physics'
];

// New timing constants for frontend synthetic tasks
const MINUTES_PER_QUESTION = 0.75;
const MINUTES_PER_PAGE = 0.75;
const MINUTES_PER_CASE = 1.0;

class WorkingScheduler {
  private allResources = new Map<string, StudyResource>();
  private remaining = new Set<string>();
  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private notifications: Array<{type: 'error' | 'warning' | 'info', message: string}> = [];
  private taskCounter = 0;
  
  // Resource pools
  private titanVideos: StudyResource[] = [];
  private crackTheCore: StudyResource[] = [];
  private caseCompanion: StudyResource[] = [];
  private qevlar: StudyResource[] = [];
  private huda: StudyResource[] = [];
  private nuclear: StudyResource[] = [];
  private warMachine: StudyResource[] = [];
  private nucApp: StudyResource[] = [];
  private nisRisc: StudyResource[] = [];
  private boardVitals: StudyResource[] = [];
  private physics: StudyResource[] = [];
  private physicsApp: StudyResource[] = [];
  private discord: StudyResource[] = [];
  private coreRadiology: StudyResource[] = [];
  
  // BV tracking
  private totalBVQuestions = 0;
  private scheduledBVQuestions = 0;
  
  // Day progression
  private currentTitanIndex = 0;

  constructor(
    startDateStr: string,
    endDateStr: string,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[],
    topicOrder: Domain[],
    deadlines: DeadlineSettings,
    areSpecialTopicsInterleaved: boolean
  ) {
    const chunked = this.chunkResources(resourcePool);
    chunked.forEach(r => {
      this.allResources.set(r.id, r);
      this.remaining.add(r.id);
    });
    
    this.schedule = this.createDays(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);
    
    this.categorizeResources();
    
    this.titanVideos.sort((a, b) => {
      const aIndex = this.getTitanIndex(a.title);
      const bIndex = this.getTitanIndex(b.title);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
    });
    
    this.notifications.push({
      type: 'info',
      message: `Working Scheduler: ${this.studyDays.length} days, ${chunked.length} resources, ${this.titanVideos.length} Titan videos`
    });
  }

  private chunkResources(resources: StudyResource[]): StudyResource[] {
    const result: StudyResource[] = [];
    
    for (const resource of resources) {
      if (resource.isSplittable && resource.durationMinutes > MIN_DURATION_for_SPLIT_PART * 1.5) {
        const parts = Math.ceil(resource.durationMinutes / MIN_DURATION_for_SPLIT_PART);
        const perPart = Math.floor(resource.durationMinutes / parts);
        
        for (let i = 0; i < parts; i++) {
          const duration = (i === parts - 1) 
            ? resource.durationMinutes - (perPart * i) 
            : perPart;
          
          result.push({
            ...resource,
            id: `${resource.id}_part_${i + 1}`,
            title: `${resource.title} (Part ${i + 1}/${parts})`,
            durationMinutes: duration,
            isSplittable: false,
            pairedResourceIds: []
          });
        }
      } else {
        result.push(resource);
      }
    }
    
    return result;
  }

  private createDays(startDateStr: string, endDateStr: string, exceptions: ExceptionDateRule[]): DailySchedule[] {
    const start = parseDateString(startDateStr);
    const end = parseDateString(endDateStr);
    const exMap = new Map(exceptions.map(e => [e.date, e]));
    const days: DailySchedule[] = [];

    for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      const dateStr = isoDate(date);
      const ex = exMap.get(dateStr);
      
      days.push({
        date: dateStr,
        dayName: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        tasks: [],
        totalStudyTimeMinutes: Math.max(ex?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS, 0),
        isRestDay: ex?.isRestDayOverride ?? false,
        isManuallyModified: !!ex
      });
    }
    
    return days;
  }

  private categorizeResources(): void {
    for (const r of this.allResources.values()) {
      const title = (r.title || '').toLowerCase();
      const video = (r.videoSource || '').toLowerCase();
      const book = (r.bookSource || '').toLowerCase();
      
      if (video.includes('titan radiology') || video === 'titan') {
        this.titanVideos.push(r);
      } else if (book.includes('crack the core') && !book.includes('case companion')) {
        this.crackTheCore.push(r);
      } else if (book.includes('case companion')) {
        this.caseCompanion.push(r);
      } else if (book.includes('qevlar')) {
        // Physics QEVLAR stays in physics pairing; non-physics QEVLAR pairs with Titan topics
        this.qevlar.push(r);
      } else if ((video.includes('huda') || book.includes('huda')) && r.domain === Domain.PHYSICS) {
        // Huda physics lectures + QB are primary; Huda book stays optional (not categorized here)
        this.huda.push(r);
      } else if (r.domain === Domain.NUCLEAR_MEDICINE && !book.includes('nucapp')) {
        this.nuclear.push(r);
      } else if (book.includes('war machine')) {
        // Huda book (War Machine/Principles) is optional; we don't include it in primary pools
        // It will be picked up in supplementary step if present in resourcePool with isOptional=true
        this.coreRadiology.push(r);
      } else if (book.includes('nucapp')) {
        this.nucApp.push(r);
      } else if (r.domain === Domain.NIS || r.domain === Domain.RISC) {
        this.nisRisc.push(r);
      } else if (book.includes('board vitals')) {
        this.boardVitals.push(r);
        this.totalBVQuestions += (r.questionCount || 0);
      } else if (r.domain === Domain.PHYSICS && !video.includes('huda') && !book.includes('huda')) {
        if (title.includes('app') || book.includes('physics app')) {
          this.physicsApp.push(r);
        } else {
          this.physics.push(r);
        }
      } else if (video.includes('discord')) {
        this.discord.push(r);
      } else if (book.includes('core radiology') || title.includes('core radiology')) {
        this.coreRadiology.push(r);
      }
    }
    
    [this.crackTheCore, this.caseCompanion, this.qevlar, this.huda, this.nuclear, this.coreRadiology,
     this.nucApp, this.nisRisc, this.boardVitals, this.physics, this.physicsApp, this.discord]
      .forEach(pool => pool.sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999)));
  }

  private getTitanIndex(title: string): number {
    const t = title.toLowerCase();
    for (let i = 0; i < TITAN_ORDER.length; i++) {
      if (t.includes(TITAN_ORDER[i])) return i;
    }
    if (t.includes('msk')) return TITAN_ORDER.indexOf('musculoskeletal');
    if (t.includes('peds')) return TITAN_ORDER.indexOf('pediatric');
    if (t.includes('ir')) return TITAN_ORDER.indexOf('interventional');
    return 999;
  }

  private getRemainingTime(day: DailySchedule): number {
    const used = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
    return Math.max(0, day.totalStudyTimeMinutes - used);
  }

  private createTask(resource: StudyResource, day: DailySchedule): ScheduledTask {
    this.taskCounter++;
    const origId = resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id;
    
    return {
      id: `task_${resource.id}_${this.taskCounter}`,
      resourceId: resource.id,
      originalResourceId: origId,
      title: resource.title,
      type: resource.type,
      originalTopic: resource.domain,
      durationMinutes: resource.durationMinutes,
      status: 'pending',
      order: day.tasks.length,
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

  private addToDay(day: DailySchedule, resource: StudyResource): boolean {
    if (!this.remaining.has(resource.id)) return false;
    if (this.getRemainingTime(day) < resource.durationMinutes) return false;
    const task = this.createTask(resource, day);
    day.tasks.push(task);
    this.remaining.delete(resource.id);
    return true;
  }

  private isRelated(anchor: StudyResource, candidate: StudyResource): boolean {
    if (anchor.domain === candidate.domain) return true;
    if (anchor.chapterNumber && candidate.chapterNumber && anchor.chapterNumber === candidate.chapterNumber) return true;
    const aTitle = (anchor.title || '').toLowerCase();
    const cTitle = (candidate.title || '').toLowerCase();
    const keywords = ['pancreas','liver','renal','kidney','reproductive','prostate','ovarian','testicular','barium','esophagus','stomach','bowel','gi','chest','thorax','lung','mediastinum','cardiac','heart','thyroid','neck','msk','musculoskeletal','bone','joint','neuro','brain','spine','pediatric','peds','breast','mammography','nuclear','pet','spect','interventional','vascular','physics'];
    return keywords.some(kw => aTitle.includes(kw) && cTitle.includes(kw));
  }

  private findPaired(anchor: StudyResource, pool: StudyResource[]): StudyResource[] {
    return pool.filter(r => this.remaining.has(r.id) && this.isRelated(anchor, r));
  }

  private createBVTask(day: DailySchedule, questions: number, subjects: string[]): ScheduledTask {
    this.taskCounter++;
    const subjectStr = subjects.length > 0 ? subjects.join(', ') : 'mixed topics';
    return {
      id: `synthetic_bv_${day.date}_${this.taskCounter}`,
      resourceId: `bv_mixed_${day.date}`,
      title: `Board Vitals - Mixed ${questions} questions (suggested: ${subjectStr})`,
      type: ResourceType.QUESTIONS,
      originalTopic: Domain.MIXED_REVIEW,
      durationMinutes: Math.ceil(questions * MINUTES_PER_QUESTION),
      status: 'pending',
      order: day.tasks.length,
      isOptional: false,
      isPrimaryMaterial: true,
      questionCount: questions
    };
  }

  public generate(): GeneratedStudyPlanOutcome {
    try {
      this.notifications.push({ type: 'info', message: 'Starting 6-step template execution (0.75 rates)' });
      for (let dayIndex = 0; dayIndex < this.studyDays.length; dayIndex++) {
        this.executeDay(dayIndex);
      }
      this.finalCleanup();
      return this.buildResult();
    } catch (error) {
      this.notifications.push({ type: 'error', message: `Failed: ${error}` });
      return this.buildEmptyResult();
    }
  }

  private executeDay(dayIndex: number): void {
    const day = this.studyDays[dayIndex];
    const titanTopic = TITAN_ORDER[dayIndex % TITAN_ORDER.length];
    this.notifications.push({ type: 'info', message: `Day ${dayIndex + 1}: ${titanTopic} template` });
    this.step1_TitanBlock(day, titanTopic);
    this.step2_HudaBlock(day);
    this.step3_NuclearBlock(day);
    this.step4_NisRiscBlock(day);
    this.step5_BoardVitalsQuota(day, dayIndex);
    this.step6_PhysicsBlock(day);
    this.step7_Supplementary(day);
    const total = day.tasks.reduce((s, t) => s + t.durationMinutes, 0);
    const pct = ((total / day.totalStudyTimeMinutes) * 100).toFixed(1);
    this.notifications.push({ type: 'info', message: `Day ${dayIndex + 1}: ${total}min (${pct}%)` });
  }

  private step1_TitanBlock(day: DailySchedule, titanTopic: string): void {
    const titanVideo = this.titanVideos.find(v => this.remaining.has(v.id) && v.title.toLowerCase().includes(titanTopic)) || this.titanVideos.find(v => this.remaining.has(v.id));
    if (!titanVideo) return;
    if (!this.addToDay(day, titanVideo)) return;
    const pairedCTC = this.findPaired(titanVideo, this.crackTheCore);
    const pairedCC = this.findPaired(titanVideo, this.caseCompanion);
    const pairedQEV = this.qevlar.filter(q => this.remaining.has(q.id) && (q.domain === titanVideo.domain || this.isRelated(titanVideo, q)));
    [...pairedCTC, ...pairedCC, ...pairedQEV].forEach(r => this.addToDay(day, r));
  }

  private step2_HudaBlock(day: DailySchedule): void {
    const hudaLecture = this.huda.find(h => this.remaining.has(h.id) && (h.type === ResourceType.VIDEO_LECTURE || h.type === ResourceType.HIGH_YIELD_VIDEO));
    if (!hudaLecture) return;
    if (!this.addToDay(day, hudaLecture)) return;
    const pairedHuda = this.findPaired(hudaLecture, this.huda).filter(h => h.id !== hudaLecture.id).slice(0, 4);
    pairedHuda.forEach(r => this.addToDay(day, r));
  }

  private step3_NuclearBlock(day: DailySchedule): void {
    const titanNuclear = this.nuclear.filter(n => this.remaining.has(n.id) && (n.videoSource || '').toLowerCase().includes('titan'));
    const nucAnchor = titanNuclear[0] || this.nuclear.find(n => this.remaining.has(n.id));
    if (!nucAnchor) return;
    if (!this.addToDay(day, nucAnchor)) return;
    const pairedCTC = this.findPaired(nucAnchor, this.crackTheCore);
    const pairedWM = this.findPaired(nucAnchor, this.warMachine);
    const pairedNucApp = this.findPaired(nucAnchor, this.nucApp);
    const pairedQEV = this.qevlar.filter(q => this.remaining.has(q.id) && q.domain === Domain.NUCLEAR_MEDICINE && this.isRelated(nucAnchor, q));
    [...pairedCTC, ...pairedWM, ...pairedNucApp, ...pairedQEV].slice(0, 8).forEach(r => this.addToDay(day, r));
  }

  private step4_NisRiscBlock(day: DailySchedule): void {
    const nisDoc = this.nisRisc.find(n => this.remaining.has(n.id) && n.type === ResourceType.READING_TEXTBOOK);
    if (!nisDoc) return;
    if (!this.addToDay(day, nisDoc)) return;
    const pairedNisQB = this.nisRisc.filter(n => this.remaining.has(n.id) && n.type === ResourceType.QUESTIONS && this.isRelated(nisDoc, n));
    const nisQevlar = this.qevlar.filter(q => this.remaining.has(q.id) && (q.domain === Domain.NIS || q.domain === Domain.RISC));
    [...pairedNisQB, ...nisQevlar].slice(0, 4).forEach(r => this.addToDay(day, r));
  }

  private step5_BoardVitalsQuota(day: DailySchedule, dayIndex: number): void {
    const remainingTime = this.getRemainingTime(day);
    if (remainingTime < 30) return;
    const remainingDays = this.studyDays.length - dayIndex;
    const remainingQs = Math.max(0, this.totalBVQuestions - this.scheduledBVQuestions);
    if (remainingQs === 0) return;
    const avgPerDay = Math.ceil(remainingQs / Math.max(1, remainingDays));
    const maxByTime = Math.floor(remainingTime / MINUTES_PER_QUESTION * 0.25); // limit BV to ~25% remaining time
    const targetQs = Math.min(avgPerDay, maxByTime, remainingQs);
    if (targetQs === 0) return;
    const subjects = new Set<string>();
    for (let i = 0; i <= dayIndex; i++) {
      this.studyDays[i].tasks.forEach(t => {
        const domain = t.originalTopic.toString().replace(/_/g, ' ').toLowerCase();
        if (!['nis', 'risc', 'mixed review', 'high yield'].includes(domain)) {
          subjects.add(domain);
        }
      });
    }
    const bvTask = this.createBVTask(day, targetQs, Array.from(subjects));
    day.tasks.push(bvTask);
    this.scheduledBVQuestions += targetQs;
  }

  private step6_PhysicsBlock(day: DailySchedule): void {
    const titanPhysics = this.physics.filter(p => this.remaining.has(p.id) && (p.videoSource || '').toLowerCase().includes('titan'));
    const physicsAnchor = titanPhysics[0] || this.physics.find(p => this.remaining.has(p.id));
    if (!physicsAnchor) return;
    if (!this.addToDay(day, physicsAnchor)) return;
    const pairedWM = this.findPaired(physicsAnchor, this.warMachine);
    const pairedApp = this.findPaired(physicsAnchor, this.physicsApp);
    const pairedQEV = this.qevlar.filter(q => this.remaining.has(q.id) && q.domain === Domain.PHYSICS && this.isRelated(physicsAnchor, q)).slice(0, 2); // partial QEVLAR physics only
    [...pairedWM, ...pairedApp, ...pairedQEV].slice(0, 6).forEach(r => this.addToDay(day, r));
  }

  private step7_Supplementary(day: DailySchedule): void {
    const dayDomains = new Set<Domain>();
    day.tasks.forEach(t => dayDomains.add(t.originalTopic));
    const sortedDiscord = this.discord.filter(r => this.remaining.has(r.id)).sort((a, b) => this.relevanceScore(b, dayDomains) - this.relevanceScore(a, dayDomains));
    for (const r of sortedDiscord) {
      if (this.getRemainingTime(day) < 10) break;
      this.addToDay(day, r);
    }
    const sortedCoreRad = this.coreRadiology.filter(r => this.remaining.has(r.id)).sort((a, b) => this.relevanceScore(b, dayDomains) - this.relevanceScore(a, dayDomains));
    for (const r of sortedCoreRad) {
      if (this.getRemainingTime(day) < 5) break;
      this.addToDay(day, r);
    }
  }

  private relevanceScore(resource: StudyResource, dayDomains: Set<Domain>): number {
    let score = 0;
    if (dayDomains.has(resource.domain)) score += 100;
    if (resource.durationMinutes <= 5) score += 20;
    else if (resource.durationMinutes <= 15) score += 10;
    if (resource.isPrimaryMaterial) score += 15;
    return score;
  }

  private finalCleanup(): void {
    const required = Array.from(this.remaining).map(id => this.allResources.get(id)).filter((r): r is StudyResource => r !== undefined && ((r.videoSource || '').toLowerCase().includes('titan') || (r.bookSource || '').toLowerCase().includes('board vitals') || (r.bookSource || '').toLowerCase().includes('nucapp') || r.domain === Domain.NIS || r.domain === Domain.RISC || r.domain === Domain.PHYSICS || r.isPrimaryMaterial)).sort((a, b) => {
      const priorityA = (a.videoSource || '').includes('titan') ? 1 : (a.bookSource || '').includes('board vitals') ? 2 : (a.domain === Domain.NIS || a.domain === Domain.RISC) ? 3 : 10;
      const priorityB = (b.videoSource || '').includes('titan') ? 1 : (b.bookSource || '').includes('board vitals') ? 2 : (b.domain === Domain.NIS || b.domain === Domain.RISC) ? 3 : 10;
      return priorityA - priorityB;
    });
    const daysWithTime = this.studyDays.map(d => ({ day: d, time: this.getRemainingTime(d) })).filter(x => x.time >= 5).sort((a, b) => b.time - a.time);
    let placed = 0;
    for (const r of required) {
      for (const { day } of daysWithTime) {
        if (this.addToDay(day, r)) { placed++; break; }
      }
    }
    this.notifications.push({ type: 'info', message: `Final cleanup: ${placed}/${required.length} required resources placed` });
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      day.tasks.forEach((t, i) => t.order = i);
    }
  }

  private buildResult(): GeneratedStudyPlanOutcome {
    const progress: StudyPlan['progressPerDomain'] = {};
    for (const r of this.allResources.values()) {
      if (!progress[r.domain]) progress[r.domain] = { completedMinutes: 0, totalMinutes: 0 };
      progress[r.domain]!.totalMinutes += r.durationMinutes;
    }
    for (const day of this.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && progress[task.originalTopic]) {
          progress[task.originalTopic]!.completedMinutes += task.durationMinutes;
        }
      }
    }
    const total = this.schedule.reduce((s, d) => s + d.tasks.reduce((ds, t) => ds + t.durationMinutes, 0), 0);
    const avail = this.studyDays.reduce((s, d) => s + d.totalStudyTimeMinutes, 0);
    const util = avail > 0 ? ((total / avail) * 100).toFixed(1) : '0';
    this.notifications.push({ type: 'info', message: `Final: ${total}/${avail}min (${util}%), ${this.remaining.size} unscheduled` });
    return {
      plan: {
        schedule: this.schedule,
        progressPerDomain: progress,
        startDate: this.schedule[0]?.date || '',
        endDate: this.schedule[this.schedule.length - 1]?.date || '',
        firstPassEndDate: null,
        topicOrder: DEFAULT_TOPIC_ORDER,
        cramTopicOrder: DEFAULT_TOPIC_ORDER.slice(),
        deadlines: {},
        isCramModeActive: false,
        areSpecialTopicsInterleaved: true
      },
      notifications: this.notifications
    };
  }

  private buildEmptyResult(): GeneratedStudyPlanOutcome {
    return {
      plan: {
        schedule: [],
        progressPerDomain: {},
        startDate: '',
        endDate: '',
        firstPassEndDate: null,
        topicOrder: DEFAULT_TOPIC_ORDER,
        cramTopicOrder: DEFAULT_TOPIC_ORDER.slice(),
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
  const scheduler = new WorkingScheduler(
    startDateStr,
    endDateStr,
    exceptionRules,
    resourcePool,
    topicOrder || DEFAULT_TOPIC_ORDER,
    deadlines || {},
    areSpecialTopicsInterleaved ?? true
  );
  return scheduler.generate();
};

export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionRules: ExceptionDateRule[],
  resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
  const today = getTodayInNewYork();
  let rebalanceStart: string;
  if (options.type === 'standard') {
    rebalanceStart = (options.rebalanceDate && options.rebalanceDate > today) ? options.rebalanceDate : today;
  } else {
    rebalanceStart = options.date;
  }
  rebalanceStart = Math.max(rebalanceStart, currentPlan.startDate);
  rebalanceStart = Math.min(rebalanceStart, currentPlan.endDate);
  const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStart);
  const completedIds = new Set<string>();
  for (const day of currentPlan.schedule) {
    for (const task of day.tasks) {
      if (task.status === 'completed' && task.originalResourceId) {
        completedIds.add(task.originalResourceId);
      }
    }
  }
  const availableResources = resourcePool.filter(r => !completedIds.has(r.id) && !r.isArchived);
  const scheduler = new WorkingScheduler(
    rebalanceStart,
    currentPlan.endDate,
    exceptionRules,
    availableResources,
    currentPlan.topicOrder,
    currentPlan.deadlines,
    currentPlan.areSpecialTopicsInterleaved
  );
  const result = scheduler.generate();
  result.plan.schedule = [...pastSchedule, ...result.plan.schedule];
  result.plan.startDate = currentPlan.startDate;
  return result;
};