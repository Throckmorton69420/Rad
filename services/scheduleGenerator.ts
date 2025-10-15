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
 * WORKING 4-PHASE SCHEDULER - EXACT REQUIREMENTS COMPLIANCE
 * 
 * Phase 1: Strict Titan Topic Order Round-Robin with Block Carryover
 *   - Day 1: Pancreas block, Day 2: Liver block, Day 3: Renal block...
 *   - Each block = Titan video + Crack the Core + Case Companion + QEVLAR
 *   - If block doesn't fit, carry remainder to next day BEFORE next topic
 * 
 * Phase 2: Daily Requirements After Phase 1 Complete
 *   - NIS/RISC + Synthetic Board Vitals Daily Quotas + Physics
 * 
 * Phase 3: Supplementary Content (Discord/Core Radiology)
 * 
 * Phase 4: Final Required Content Mop-up + Validation
 */

// EXACT Titan sequence from your PDF
const TITAN_ORDER = [
  'pancreas', 'liver', 'renal', 'reproductive', 'barium', 'chest',
  'thyroid', 'musculoskeletal', 'neuro', 'pediatric', 'peds', 'cardiac', 
  'breast', 'nuclear', 'interventional', 'vascular', 'physics'
];

interface StrictTitanBlock {
  titanVideo: StudyResource;
  crackTheCore: StudyResource[];
  caseCompanion: StudyResource[];
  qevlar: StudyResource[];
  allResources: StudyResource[];
  titanOrderIndex: number;
  scheduledCount: number;
  isComplete: boolean;
}

class WorkingTitanScheduler {
  private resources = new Map<string, StudyResource>();
  private remaining = new Set<string>();
  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private notifications: Array<{type: 'error'|'warning'|'info', message: string}> = [];
  
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskId = 0;
  
  // Tracking
  private topicsPerDay = new Map<string, Set<Domain>>();
  
  // Phase 1 blocks
  private titanBlocks: StrictTitanBlock[] = [];
  private hudaBlocks: StudyResource[][] = [];
  private nuclearBlocks: StudyResource[][] = [];
  
  // Resource pools
  private titanVideos: StudyResource[] = [];
  private crackCore: StudyResource[] = [];
  private caseComp: StudyResource[] = [];
  private qevlar: StudyResource[] = [];
  private huda: StudyResource[] = [];
  private nuclear: StudyResource[] = [];
  private nucApp: StudyResource[] = [];
  private nisRisc: StudyResource[] = [];
  private boardVitals: StudyResource[] = [];
  private physics: StudyResource[] = [];
  private discord: StudyResource[] = [];
  private coreRad: StudyResource[] = [];
  
  // BV tracking
  private totalBVQ = 0;
  private scheduledBVQ = 0;

  constructor(
    start: string, end: string, exceptions: ExceptionDateRule[],
    pool: StudyResource[], order: Domain[], deadlines: DeadlineSettings,
    interleaved: boolean
  ) {
    this.topicOrder = order || DEFAULT_TOPIC_ORDER;
    this.deadlines = deadlines || {};
    this.areSpecialTopicsInterleaved = interleaved ?? true;
    
    // Chunk and store resources
    const chunked = this.chunk(pool);
    chunked.forEach(r => {
      this.resources.set(r.id, r);
      this.remaining.add(r.id);
    });
    
    // Create days
    this.schedule = this.makeDays(start, end, exceptions);
    this.studyDays = this.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);
    
    if (this.studyDays.length === 0) {
      throw new Error('No study days');
    }
    
    // Init tracking
    this.studyDays.forEach(d => this.topicsPerDay.set(d.date, new Set()));
    
    // Categorize
    this.categorize();
    
    // Build blocks
    this.buildTitanBlocks();
    this.buildOtherBlocks();
    
    this.log('info', `Ready: ${this.studyDays.length} days, ${this.resources.size} resources, ${this.titanBlocks.length} Titan blocks`);
  }

  private chunk(pool: StudyResource[]): StudyResource[] {
    const out: StudyResource[] = [];
    for (const r of pool) {
      if (r.isSplittable && r.durationMinutes > MIN_DURATION_for_SPLIT_PART * 2) {
        const parts = Math.ceil(r.durationMinutes / MIN_DURATION_for_SPLIT_PART);
        const each = Math.floor(r.durationMinutes / parts);
        for (let i = 0; i < parts; i++) {
          const last = i === parts - 1;
          const dur = last ? r.durationMinutes - each * i : each;
          out.push({
            ...r,
            id: `${r.id}_part_${i+1}`,
            title: `${r.title} (Part ${i+1}/${parts})`,
            durationMinutes: dur,
            isSplittable: false,
            pairedResourceIds: []
          });
        }
      } else {
        out.push(r);
      }
    }
    return out;
  }

  private makeDays(start: string, end: string, exceptions: ExceptionDateRule[]): DailySchedule[] {
    const startDate = parseDateString(start);
    const endDate = parseDateString(end);
    const exMap = new Map(exceptions.map(e => [e.date, e]));
    const days: DailySchedule[] = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = isoDate(d);
      const ex = exMap.get(date);
      days.push({
        date,
        dayName: d.toLocaleDateString('en-US', {weekday: 'long', timeZone: 'UTC'}),
        tasks: [],
        totalStudyTimeMinutes: Math.max(ex?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS, 0),
        isRestDay: ex?.isRestDayOverride ?? false,
        isManuallyModified: !!ex
      });
    }
    return days;
  }

  private categorize(): void {
    for (const r of this.resources.values()) {
      const title = (r.title || '').toLowerCase();
      const video = (r.videoSource || '').toLowerCase();
      const book = (r.bookSource || '').toLowerCase();
      
      if (video.includes('titan') && (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)) {
        this.titanVideos.push(r);
      } else if (book.includes('crack the core')) {
        this.crackCore.push(r);
      } else if (book.includes('case companion')) {
        this.caseComp.push(r);
      } else if (book.includes('qevlar')) {
        this.qevlar.push(r);
      } else if ((video.includes('huda') || book.includes('huda')) && r.domain === Domain.PHYSICS) {
        this.huda.push(r);
      } else if (r.domain === Domain.NUCLEAR_MEDICINE) {
        this.nuclear.push(r);
        if (book.includes('nucapp')) this.nucApp.push(r);
      } else if (r.domain === Domain.NIS || r.domain === Domain.RISC) {
        this.nisRisc.push(r);
      } else if (book.includes('board vitals')) {
        this.boardVitals.push(r);
        this.totalBVQ += r.questionCount || 0;
      } else if (r.domain === Domain.PHYSICS) {
        this.physics.push(r);
      } else if (video.includes('discord')) {
        this.discord.push(r);
      } else if (book.includes('core radiology') || title.includes('core radiology')) {
        this.coreRad.push(r);
      }
    }
  }

  private buildTitanBlocks(): void {
    // Sort Titan videos by EXACT topic order
    const sorted = this.titanVideos
      .filter(v => this.remaining.has(v.id))
      .map(v => ({video: v, rank: this.getTitanRank(v.title)}))
      .sort((a, b) => (a.rank - b.rank) || ((a.video.sequenceOrder || 999) - (b.video.sequenceOrder || 999)));
    
    this.titanBlocks = sorted.map(({video, rank}, idx) => {
      // Find ALL related content
      const matchedCore = this.crackCore.filter(r => this.topicalMatch(video, r));
      const matchedComp = this.caseComp.filter(r => this.topicalMatch(video, r));
      const matchedQev = this.qevlar.filter(r => this.topicalMatch(video, r));
      
      const allRes = [video, ...matchedCore, ...matchedComp, ...matchedQev];
      
      return {
        titanVideo: video,
        crackTheCore: matchedCore,
        caseCompanion: matchedComp,
        qevlar: matchedQev,
        allResources: allRes,
        titanOrderIndex: rank,
        scheduledCount: 0,
        isComplete: false
      };
    });
    
    this.log('info', `Built ${this.titanBlocks.length} Titan blocks in EXACT order`);
  }

  private buildOtherBlocks(): void {
    // Huda blocks
    const hudaAnchors = this.huda.filter(r => this.remaining.has(r.id) && 
      (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO))
      .sort((a,b) => (a.sequenceOrder||999) - (b.sequenceOrder||999));
    
    this.hudaBlocks = hudaAnchors.map(anchor => {
      const related = this.huda.filter(r => r.id !== anchor.id && 
        this.remaining.has(r.id) && this.topicalMatch(anchor, r)).slice(0, 3);
      return [anchor, ...related];
    });
    
    // Nuclear blocks
    const nucAnchors = this.nuclear.filter(r => this.remaining.has(r.id))
      .sort((a,b) => (a.sequenceOrder||999) - (b.sequenceOrder||999));
    
    this.nuclearBlocks = nucAnchors.map(anchor => {
      const related = this.nuclear.filter(r => r.id !== anchor.id && 
        this.remaining.has(r.id) && this.topicalMatch(anchor, r));
      const nucAppRel = this.nucApp.filter(r => this.remaining.has(r.id) && 
        this.topicalMatch(anchor, r));
      return [anchor, ...related, ...nucAppRel].slice(0, 5);
    });
  }

  private getTitanRank(title: string): number {
    const t = title.toLowerCase();
    for (let i = 0; i < TITAN_ORDER.length; i++) {
      if (t.includes(TITAN_ORDER[i])) return i;
    }
    return 999;
  }

  private topicalMatch(a: StudyResource, b: StudyResource): boolean {
    if (a.domain === b.domain) return true;
    if (a.chapterNumber && b.chapterNumber && a.chapterNumber === b.chapterNumber) return true;
    
    const titleA = (a.title || '').toLowerCase();
    const titleB = (b.title || '').toLowerCase();
    
    const kws = ['pancreas', 'liver', 'renal', 'kidney', 'reproductive', 'gynecologic', 'prostate',
      'barium', 'esophagus', 'stomach', 'bowel', 'chest', 'thorax', 'lung', 'thyroid',
      'musculoskeletal', 'msk', 'bone', 'neuro', 'brain', 'pediatric', 'peds', 'cardiac',
      'breast', 'mammo', 'nuclear', 'interventional', 'vascular', 'physics'];
    
    return kws.some(kw => titleA.includes(kw) && titleB.includes(kw));
  }

  private timeLeft(day: DailySchedule): number {
    const used = day.tasks.reduce((s, t) => s + t.durationMinutes, 0);
    return Math.max(0, day.totalStudyTimeMinutes - used);
  }

  private makeTask(r: StudyResource, order: number): ScheduledTask {
    this.taskId++;
    const orig = r.id.includes('_part_') ? r.id.split('_part_')[0] : r.id;
    return {
      id: `task_${r.id}_${this.taskId}`,
      resourceId: r.id,
      originalResourceId: orig,
      title: r.title,
      type: r.type,
      originalTopic: r.domain,
      durationMinutes: r.durationMinutes,
      status: 'pending',
      order,
      isOptional: r.isOptional,
      isPrimaryMaterial: r.isPrimaryMaterial,
      pages: r.pages,
      startPage: r.startPage,
      endPage: r.endPage,
      caseCount: r.caseCount,
      questionCount: r.questionCount,
      chapterNumber: r.chapterNumber,
      bookSource: r.bookSource,
      videoSource: r.videoSource
    };
  }

  private makeSyntheticBV(day: DailySchedule, questions: number, subjects: Domain[]): ScheduledTask {
    this.taskId++;
    const subj = subjects.length > 0 ? subjects.join(', ') : 'Mixed Topics';
    return {
      id: `synthetic_bv_${day.date}_${this.taskId}`,
      resourceId: `bv_${day.date}`,
      title: `Board Vitals - Mixed ${questions} questions (suggested: ${subj})`,
      type: ResourceType.QUESTIONS,
      originalTopic: Domain.MIXED_REVIEW,
      durationMinutes: Math.ceil(questions / 0.5),
      status: 'pending',
      order: day.tasks.length,
      isOptional: false,
      isPrimaryMaterial: true,
      questionCount: questions
    };
  }

  private addTask(day: DailySchedule, resource: StudyResource): boolean {
    if (!this.remaining.has(resource.id) || this.timeLeft(day) < resource.durationMinutes) {
      return false;
    }
    const task = this.makeTask(resource, day.tasks.length);
    day.tasks.push(task);
    this.remaining.delete(resource.id);
    this.topicsPerDay.get(day.date)?.add(resource.domain);
    return true;
  }

  private addSyntheticBV(day: DailySchedule, questions: number, subjects: Domain[]): boolean {
    const mins = Math.ceil(questions / 0.5);
    if (this.timeLeft(day) < mins) return false;
    
    const task = this.makeSyntheticBV(day, questions, subjects);
    day.tasks.push(task);
    this.scheduledBVQ += questions;
    this.topicsPerDay.get(day.date)?.add(Domain.MIXED_REVIEW);
    return true;
  }

  private log(type: 'info'|'warning'|'error', msg: string): void {
    this.notifications.push({type, message: msg});
  }

  /**
   * PHASE 1: STRICT TITAN ORDER WITH PERFECT CARRYOVER
   */
  
  private phase1(): void {
    this.log('info', 'Phase 1: STRICT Titan order with perfect carryover');
    
    // Pass 1a: Titan blocks
    this.scheduleTitanBlocksStrict();
    
    // Pass 1b: Huda blocks
    this.scheduleHudaBlocks();
    
    // Pass 1c: Nuclear blocks
    this.scheduleNuclearBlocks();
    
    this.log('info', 'Phase 1: Complete');
  }

  private scheduleTitanBlocksStrict(): void {
    let dayIdx = 0;
    
    for (let blockIdx = 0; blockIdx < this.titanBlocks.length; blockIdx++) {
      const block = this.titanBlocks[blockIdx];
      const unscheduled = block.allResources.filter(r => this.remaining.has(r.id));
      
      if (unscheduled.length === 0) {
        block.isComplete = true;
        dayIdx = (dayIdx + 1) % this.studyDays.length;
        continue;
      }
      
      // Schedule this block's resources with carryover
      let resIdx = 0;
      while (resIdx < unscheduled.length) {
        const day = this.studyDays[dayIdx];
        let placed = 0;
        
        // Place as many resources as fit on current day
        for (let i = resIdx; i < unscheduled.length; i++) {
          if (this.addTask(day, unscheduled[i])) {
            placed++;
            resIdx = i + 1;
            block.scheduledCount++;
          } else {
            break;
          }
        }
        
        // If we placed some but not all, carry over to next day
        if (placed > 0 && resIdx < unscheduled.length) {
          dayIdx = (dayIdx + 1) % this.studyDays.length;
        }
        // If we couldn't place any, advance day anyway
        else if (placed === 0) {
          dayIdx = (dayIdx + 1) % this.studyDays.length;
          // Skip this resource to avoid infinite loop
          if (resIdx < unscheduled.length) {
            this.log('warning', `Skipping ${unscheduled[resIdx].title} - no space`);
            resIdx++;
          }
        }
        // If we placed all remaining, block complete
        else {
          block.isComplete = true;
          break;
        }
      }
      
      // Advance to next day for next block
      dayIdx = (dayIdx + 1) % this.studyDays.length;
    }
    
    const done = this.titanBlocks.filter(b => b.isComplete).length;
    this.log('info', `Titan: ${done}/${this.titanBlocks.length} blocks completed`);
  }

  private scheduleHudaBlocks(): void {
    let dayIdx = 0;
    for (const block of this.hudaBlocks) {
      let resIdx = 0;
      while (resIdx < block.length) {
        const day = this.studyDays[dayIdx];
        let placed = 0;
        
        for (let i = resIdx; i < block.length; i++) {
          if (this.addTask(day, block[i])) {
            placed++;
            resIdx = i + 1;
          } else break;
        }
        
        dayIdx = (dayIdx + 1) % this.studyDays.length;
        if (placed === 0 && resIdx < block.length) resIdx++; // Skip if stuck
      }
    }
    this.log('info', `Huda: ${this.hudaBlocks.length} blocks processed`);
  }

  private scheduleNuclearBlocks(): void {
    let dayIdx = 0;
    for (const block of this.nuclearBlocks) {
      let resIdx = 0;
      while (resIdx < block.length) {
        const day = this.studyDays[dayIdx];
        let placed = 0;
        
        for (let i = resIdx; i < block.length; i++) {
          if (this.addTask(day, block[i])) {
            placed++;
            resIdx = i + 1;
          } else break;
        }
        
        dayIdx = (dayIdx + 1) % this.studyDays.length;
        if (placed === 0 && resIdx < block.length) resIdx++; // Skip if stuck
      }
    }
    this.log('info', `Nuclear: ${this.nuclearBlocks.length} blocks processed`);
  }

  /**
   * PHASE 2: DAILY REQUIREMENTS + SYNTHETIC BOARD VITALS
   */
  
  private phase2(): void {
    this.log('info', 'Phase 2: Daily requirements + synthetic Board Vitals');
    
    for (let i = 0; i < this.studyDays.length; i++) {
      const day = this.studyDays[i];
      
      // 2a: NIS/RISC
      const nisriscAvail = this.nisRisc.filter(r => this.remaining.has(r.id))
        .sort((a,b) => (a.sequenceOrder||999) - (b.sequenceOrder||999));
      for (const r of nisriscAvail) {
        if (this.timeLeft(day) < 60) break;
        this.addTask(day, r);
      }
      
      // 2b: Synthetic Board Vitals daily quota
      this.addDailyBVQuota(day, i);
      
      // 2c: Physics
      const physicsAvail = this.physics.filter(r => this.remaining.has(r.id))
        .sort((a,b) => (a.sequenceOrder||999) - (b.sequenceOrder||999));
      let physCount = 0;
      for (const r of physicsAvail) {
        if (this.timeLeft(day) < 30) break;
        if (this.addTask(day, r)) {
          physCount++;
          if (physCount >= 2) break; // Limit per day
        }
      }
    }
    
    this.log('info', 'Phase 2: Complete');
  }

  private addDailyBVQuota(day: DailySchedule, dayIdx: number): void {
    if (this.totalBVQ === 0) return;
    
    const remainingDays = this.studyDays.length - dayIdx;
    const remainingQs = this.totalBVQ - this.scheduledBVQ;
    
    if (remainingQs <= 0) return;
    
    const quota = Math.ceil(remainingQs / Math.max(1, remainingDays));
    const maxByTime = Math.floor(this.timeLeft(day) * 0.3 * 0.5); // 30% max, 2min/Q
    const target = Math.min(quota, maxByTime, remainingQs);
    
    if (target <= 0) return;
    
    // Get suggested subjects from topics covered up to this day
    const subjects = new Set<Domain>();
    for (let j = 0; j <= dayIdx; j++) {
      const topics = this.topicsPerDay.get(this.studyDays[j].date) || new Set();
      topics.forEach(t => {
        if (![Domain.NIS, Domain.RISC, Domain.HIGH_YIELD, Domain.MIXED_REVIEW].includes(t)) {
          subjects.add(t);
        }
      });
    }
    
    if (this.addSyntheticBV(day, target, Array.from(subjects))) {
      this.log('info', `BV ${day.date}: ${target}Q, subjects: ${Array.from(subjects).join(', ') || 'Mixed'}`);
    }
  }

  /**
   * PHASE 3: SUPPLEMENTARY CONTENT
   */
  
  private phase3(): void {
    this.log('info', 'Phase 3: Supplementary content');
    
    // Discord
    this.scheduleSupplementary(this.discord, 'Discord');
    
    // Core Radiology
    this.scheduleSupplementary(this.coreRad, 'Core Radiology');
    
    this.log('info', 'Phase 3: Complete');
  }

  private scheduleSupplementary(pool: StudyResource[], name: string): void {
    const avail = pool.filter(r => this.remaining.has(r.id));
    let count = 0;
    
    // Multiple passes
    for (let pass = 0; pass < 2; pass++) {
      for (const day of this.studyDays) {
        if (this.timeLeft(day) < 5) continue;
        
        const dayTopics = this.topicsPerDay.get(day.date) || new Set();
        const sorted = avail.filter(r => this.remaining.has(r.id))
          .sort((a, b) => this.relevancy(b, dayTopics) - this.relevancy(a, dayTopics));
        
        for (const r of sorted) {
          if (this.timeLeft(day) >= r.durationMinutes) {
            if (this.addTask(day, r)) count++;
          }
        }
      }
    }
    
    this.log('info', `${name}: ${count} resources scheduled`);
  }

  private relevancy(r: StudyResource, dayTopics: Set<Domain>): number {
    let score = 0;
    if (dayTopics.has(r.domain)) score += 100;
    if (r.isPrimaryMaterial) score += 25;
    if (r.durationMinutes <= 15) score += 10;
    return score;
  }

  /**
   * PHASE 4: FINAL MOP-UP AND VALIDATION
   */
  
  private phase4(): void {
    this.log('info', 'Phase 4: Final mop-up and validation');
    
    // Mop up required content
    this.mopUpRequired();
    
    // Validate constraints
    this.validate();
    
    // Final ordering
    this.finalOrder();
    
    this.log('info', 'Phase 4: Complete');
  }

  private mopUpRequired(): void {
    const required = Array.from(this.remaining)
      .map(id => this.resources.get(id))
      .filter((r): r is StudyResource => {
        if (!r) return false;
        const book = (r.bookSource || '').toLowerCase();
        return r.isPrimaryMaterial || r.domain === Domain.NIS || r.domain === Domain.RISC ||
               book.includes('board vitals') || book.includes('qevlar') || 
               r.domain === Domain.PHYSICS || book.includes('nucapp');
      })
      .sort((a,b) => (a.sequenceOrder||999) - (b.sequenceOrder||999));
    
    const daysByTime = this.studyDays
      .map(d => ({day: d, time: this.timeLeft(d)}))
      .filter(x => x.time >= 5)
      .sort((a,b) => b.time - a.time);
    
    let mopped = 0;
    for (const r of required) {
      for (const {day} of daysByTime) {
        if (this.addTask(day, r)) {
          mopped++;
          break;
        }
      }
    }
    
    if (mopped > 0) {
      this.log('info', `Mop-up: Placed ${mopped}/${required.length} required resources`);
    }
  }

  private validate(): void {
    let fixes = 0;
    for (const day of this.studyDays) {
      const total = day.tasks.reduce((s, t) => s + t.durationMinutes, 0);
      if (total > day.totalStudyTimeMinutes) {
        const excess = total - day.totalStudyTimeMinutes;
        this.log('warning', `${day.date} over by ${excess}min`);
        this.redistribute(day, excess);
        fixes++;
      }
    }
    if (fixes > 0) this.log('info', `Fixed ${fixes} overloaded days`);
  }

  private redistribute(day: DailySchedule, excess: number): void {
    const sorted = [...day.tasks].sort((a, b) => {
      const pA = TASK_TYPE_PRIORITY[a.type] || 99;
      const pB = TASK_TYPE_PRIORITY[b.type] || 99;
      if (pA !== pB) return pB - pA; // Higher = lower priority
      if (a.isOptional !== b.isOptional) return a.isOptional ? -1 : 1;
      return b.durationMinutes - a.durationMinutes;
    });
    
    let toMove = excess;
    const moving: ScheduledTask[] = [];
    for (const t of sorted) {
      if (toMove <= 0) break;
      moving.push(t);
      toMove -= t.durationMinutes;
    }
    
    day.tasks = day.tasks.filter(t => !moving.some(m => m.id === t.id));
    
    const targets = this.studyDays.filter(d => d.date !== day.date)
      .sort((a,b) => this.timeLeft(b) - this.timeLeft(a));
    
    for (const t of moving) {
      let moved = false;
      for (const target of targets) {
        if (this.timeLeft(target) >= t.durationMinutes) {
          target.tasks.push({...t, order: target.tasks.length});
          moved = true;
          break;
        }
      }
      if (!moved) day.tasks.push(t);
    }
  }

  private finalOrder(): void {
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      day.tasks.forEach((t, i) => t.order = i);
    }
  }

  /**
   * MAIN EXECUTION AND SUMMARY
   */
  
  public run(): GeneratedStudyPlanOutcome {
    try {
      this.log('info', 'Starting WORKING 4-phase strict compliance');
      
      this.phase1(); // Strict Titan order with carryover
      this.phase2(); // Daily requirements + synthetic BV
      this.phase3(); // Supplementary content
      this.phase4(); // Mop-up + validation
      
      this.summary();
      
      return {
        plan: {
          schedule: this.schedule,
          progressPerDomain: this.buildProgress(),
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
      
    } catch (error) {
      this.log('error', `Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      return this.emptyPlan();
    }
  }

  private summary(): void {
    const scheduled = this.schedule.reduce((s, d) => s + d.tasks.reduce((ds, t) => ds + t.durationMinutes, 0), 0);
    const available = this.studyDays.reduce((s, d) => s + d.totalStudyTimeMinutes, 0);
    const util = available > 0 ? ((scheduled / available) * 100).toFixed(1) : '0';
    
    this.log('info', `FINAL: ${scheduled}/${available}min (${util}% utilization)`);
    
    if (this.totalBVQ > 0) {
      const bvPct = ((this.scheduledBVQ / this.totalBVQ) * 100).toFixed(1);
      this.log('info', `Board Vitals: ${this.scheduledBVQ}/${this.totalBVQ} (${bvPct}%)`);
    }
    
    const unscheduled = this.remaining.size;
    if (unscheduled === 0) {
      this.log('info', '🎯 SUCCESS: All resources scheduled!');
    } else {
      this.log('warning', `${unscheduled} resources unscheduled`);
    }
  }

  private buildProgress(): StudyPlan['progressPerDomain'] {
    const prog: StudyPlan['progressPerDomain'] = {};
    for (const r of this.resources.values()) {
      prog[r.domain] = prog[r.domain] || {totalMinutes: 0, completedMinutes: 0};
      prog[r.domain]!.totalMinutes += r.durationMinutes;
    }
    for (const d of this.schedule) {
      for (const t of d.tasks) {
        if (t.status === 'completed' && prog[t.originalTopic]) {
          prog[t.originalTopic]!.completedMinutes += t.durationMinutes;
        }
      }
    }
    return prog;
  }

  private emptyPlan(): GeneratedStudyPlanOutcome {
    return {
      plan: {
        schedule: [],
        progressPerDomain: {},
        startDate: '', endDate: '', firstPassEndDate: null,
        topicOrder: this.topicOrder, cramTopicOrder: this.topicOrder.slice(),
        deadlines: this.deadlines, isCramModeActive: false,
        areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved
      },
      notifications: this.notifications
    };
  }
}

/**
 * PUBLIC API
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
  const scheduler = new WorkingTitanScheduler(
    startDateStr, endDateStr, exceptionRules, resourcePool,
    topicOrder || DEFAULT_TOPIC_ORDER, deadlines || {},
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
  
  let start: string;
  if (options.type === 'standard') {
    start = (options.rebalanceDate && options.rebalanceDate > today) ? options.rebalanceDate : today;
  } else {
    start = options.date;
  }
  
  // Clamp to bounds
  if (start > currentPlan.endDate) start = currentPlan.endDate;
  if (start < currentPlan.startDate) start = currentPlan.startDate;
  
  const past = currentPlan.schedule.filter(d => d.date < start);
  
  const completed = new Set<string>();
  for (const d of currentPlan.schedule) {
    for (const t of d.tasks) {
      if (t.status === 'completed' && t.originalResourceId) {
        completed.add(t.originalResourceId);
      }
    }
  }
  
  const available = resourcePool.filter(r => !completed.has(r.id) && !r.isArchived);
  
  const scheduler = new WorkingTitanScheduler(
    start, currentPlan.endDate, exceptionRules, available,
    currentPlan.topicOrder, currentPlan.deadlines, currentPlan.areSpecialTopicsInterleaved
  );
  
  const result = scheduler.run();
  result.plan.schedule = [...past, ...result.plan.schedule];
  result.plan.startDate = currentPlan.startDate;
  
  // Recalc progress
  const prog = result.plan.progressPerDomain;
  for (const d of result.plan.schedule) {
    for (const t of d.tasks) {
      if (t.status === 'completed' && prog[t.originalTopic]) {
        prog[t.originalTopic]!.completedMinutes += t.durationMinutes;
      }
    }
  }
  result.plan.progressPerDomain = prog;
  
  return result;
};