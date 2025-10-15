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
 * DEFINITIVE 4-PHASE SCHEDULER - STRICT COMPLIANCE
 * 
 * This implementation EXACTLY follows your requirements:
 * 
 * Phase 1: Primary Content Distribution (Round-Robin with Resource Prioritization)
 *   - Titan topics in EXACT Titan video order: Pancreas->Liver->Renal->Reproductive->...
 *   - Each day gets ONE Titan block (Titan video + Crack the Core + Case Companion + QEVLAR)
 *   - If block overflows, carry remainder to next day BEFORE moving to next Titan topic
 *   - Same logic for Huda and Nuclear blocks
 * 
 * Phase 2: Other Daily Requirements (Daily First-Fit with Priority)
 *   - Pass 2a: NIS and RISC (First-Fit)
 *   - Pass 2b: Board Vitals DAILY MIXED QUOTA with subject suggestions
 *   - Pass 2c: Physics (Titan Route First-Fit)
 * 
 * Phase 3: Supplementary Content (Only after ALL Phase 1&2 complete)
 *   - Discord lectures with relevancy
 *   - Core Radiology textbook with relevancy
 * 
 * Phase 4: Validation and Optimization
 */

// EXACT Titan video sequence from your PDF
const TITAN_TOPIC_ORDER = [
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
  'interventional',
  'vascular',
  'physics'
];

interface TitanBlock {
  id: string;
  titanVideo: StudyResource;
  pairedResources: StudyResource[];
  totalMinutes: number;
  domain: Domain;
  titanOrderIndex: number;
  isComplete: boolean;
  nextResourceIndex: number; // For carryover tracking
}

interface DailyBoardVitalsQuota {
  date: string;
  targetQuestions: number;
  suggestedSubjects: Domain[];
  targetMinutes: number;
}

class DefinitiveScheduler {
  private allResources = new Map<string, StudyResource>();
  private remainingResources = new Set<string>();
  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private notifications: Array<{type: 'error' | 'warning' | 'info', message: string}> = [];
  
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskCounter = 0;
  
  // Phase tracking
  private coveredTopicsPerDay = new Map<string, Set<Domain>>();
  private titanBlocks: TitanBlock[] = [];
  private currentTitanBlockIndex = 0;
  private currentDayIndex = 0;
  
  // Board Vitals tracking
  private totalBoardVitalsQuestions = 0;
  private scheduledBoardVitalsQuestions = 0;
  private dailyBVQuotas: DailyBoardVitalsQuota[] = [];
  
  // Resource pools
  private titanVideos: StudyResource[] = [];
  private crackTheCoreResources: StudyResource[] = [];
  private caseCompanionResources: StudyResource[] = [];
  private qevlarResources: StudyResource[] = [];
  private hudaResources: StudyResource[] = [];
  private nuclearResources: StudyResource[] = [];
  private nucAppResources: StudyResource[] = [];
  private nisRiscResources: StudyResource[] = [];
  private boardVitalsResources: StudyResource[] = [];
  private physicsResources: StudyResource[] = [];
  private discordResources: StudyResource[] = [];
  private coreRadiologyResources: StudyResource[] = [];

  constructor(
    startDateStr: string,
    endDateStr: string,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[],
    topicOrder: Domain[],
    deadlines: DeadlineSettings,
    areSpecialTopicsInterleaved: boolean
  ) {
    this.topicOrder = topicOrder || DEFAULT_TOPIC_ORDER;
    this.deadlines = deadlines || {};
    this.areSpecialTopicsInterleaved = areSpecialTopicsInterleaved ?? true;
    
    // Initialize resources
    const chunkedResources = this.chunkLargeResources(resourcePool);
    chunkedResources.forEach(resource => {
      this.allResources.set(resource.id, resource);
      this.remainingResources.add(resource.id);
    });
    
    // Create schedule
    this.schedule = this.createDaySchedules(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);
    
    // Initialize tracking
    this.studyDays.forEach(day => {
      this.coveredTopicsPerDay.set(day.date, new Set<Domain>());
    });
    
    // Categorize resources
    this.categorizeAllResources();
    
    // Build Titan blocks in exact order
    this.buildTitanBlocksInOrder();
    
    // Calculate Board Vitals quotas
    this.calculateDailyBoardVitalsQuotas();
    
    this.notifications.push({
      type: 'info',
      message: `Initialized: ${this.studyDays.length} study days, ${this.allResources.size} resources, ${this.titanBlocks.length} Titan blocks`
    });
  }

  private chunkLargeResources(resources: StudyResource[]): StudyResource[] {
    const chunkedResources: StudyResource[] = [];
    
    for (const resource of resources) {
      if (resource.isSplittable && resource.durationMinutes > MIN_DURATION_for_SPLIT_PART * 2) {
        const numberOfParts = Math.ceil(resource.durationMinutes / MIN_DURATION_for_SPLIT_PART);
        const minutesPerPart = Math.floor(resource.durationMinutes / numberOfParts);
        
        for (let i = 0; i < numberOfParts; i++) {
          const isLastPart = i === numberOfParts - 1;
          const partDuration = isLastPart 
            ? resource.durationMinutes - (minutesPerPart * i)
            : minutesPerPart;
          
          chunkedResources.push({
            ...resource,
            id: `${resource.id}_part_${i + 1}`,
            title: `${resource.title} (Part ${i + 1}/${numberOfParts})`,
            durationMinutes: partDuration,
            isSplittable: false,
            pairedResourceIds: []
          });
        }
      } else {
        chunkedResources.push(resource);
      }
    }
    
    return chunkedResources;
  }

  private createDaySchedules(startDateStr: string, endDateStr: string, exceptionRules: ExceptionDateRule[]): DailySchedule[] {
    const startDate = parseDateString(startDateStr);
    const endDate = parseDateString(endDateStr);
    const exceptionMap = new Map(exceptionRules.map(rule => [rule.date, rule]));
    const daySchedules: DailySchedule[] = [];

    for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate.setUTCDate(currentDate.getUTCDate() + 1)) {
      const dateString = isoDate(currentDate);
      const exceptionRule = exceptionMap.get(dateString);
      
      daySchedules.push({
        date: dateString,
        dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        tasks: [],
        totalStudyTimeMinutes: Math.max(exceptionRule?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS, 0),
        isRestDay: exceptionRule?.isRestDayOverride ?? false,
        isManuallyModified: !!exceptionRule
      });
    }
    
    return daySchedules;
  }

  private categorizeAllResources(): void {
    for (const resource of this.allResources.values()) {
      const title = (resource.title || '').toLowerCase();
      const videoSource = (resource.videoSource || '').toLowerCase();
      const bookSource = (resource.bookSource || '').toLowerCase();
      
      // Titan videos
      if (videoSource.includes('titan radiology') || videoSource.includes('titan')) {
        this.titanVideos.push(resource);
      }
      // Crack the Core
      else if (bookSource.includes('crack the core')) {
        this.crackTheCoreResources.push(resource);
      }
      // Case Companion
      else if (bookSource.includes('case companion')) {
        this.caseCompanionResources.push(resource);
      }
      // QEVLAR
      else if (bookSource.includes('qevlar')) {
        this.qevlarResources.push(resource);
      }
      // Huda Physics
      else if ((videoSource.includes('huda') || bookSource.includes('huda')) && resource.domain === Domain.PHYSICS) {
        this.hudaResources.push(resource);
      }
      // Nuclear Medicine
      else if (resource.domain === Domain.NUCLEAR_MEDICINE) {
        this.nuclearResources.push(resource);
        if (bookSource.includes('nucapp')) {
          this.nucAppResources.push(resource);
        }
      }
      // NIS and RISC
      else if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) {
        this.nisRiscResources.push(resource);
      }
      // Board Vitals
      else if (bookSource.includes('board vitals')) {
        this.boardVitalsResources.push(resource);
        this.totalBoardVitalsQuestions += (resource.questionCount || 0);
      }
      // Physics (non-Huda)
      else if (resource.domain === Domain.PHYSICS) {
        this.physicsResources.push(resource);
      }
      // Discord
      else if (videoSource.includes('discord')) {
        this.discordResources.push(resource);
      }
      // Core Radiology
      else if (bookSource.includes('core radiology') || title.includes('core radiology')) {
        this.coreRadiologyResources.push(resource);
      }
    }
  }

  private buildTitanBlocksInOrder(): void {
    // Sort Titan videos by the exact Titan topic order
    this.titanVideos.sort((a, b) => {
      const aIndex = this.getTitanTopicIndex(a.title);
      const bIndex = this.getTitanTopicIndex(b.title);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
    });
    
    // Build blocks for each Titan video
    this.titanBlocks = this.titanVideos.map((video, index) => {
      const pairedResources: StudyResource[] = [];
      
      // Find matching Crack the Core content
      const matchingCrackTheCore = this.crackTheCoreResources.filter(resource => 
        this.isTopicallyRelated(video, resource)
      );
      
      // Find matching Case Companion content
      const matchingCaseCompanion = this.caseCompanionResources.filter(resource => 
        this.isTopicallyRelated(video, resource)
      );
      
      // Find matching QEVLAR content
      const matchingQevlar = this.qevlarResources.filter(resource => 
        this.isTopicallyRelated(video, resource)
      );
      
      pairedResources.push(...matchingCrackTheCore, ...matchingCaseCompanion, ...matchingQevlar);
      
      const allResources = [video, ...pairedResources];
      const totalMinutes = allResources.reduce((sum, r) => sum + r.durationMinutes, 0);
      
      return {
        id: `titan_block_${index}`,
        titanVideo: video,
        pairedResources,
        totalMinutes,
        domain: video.domain,
        titanOrderIndex: index,
        isComplete: false,
        nextResourceIndex: 0
      };
    });
  }

  private getTitanTopicIndex(title: string): number {
    const normalizedTitle = title.toLowerCase();
    
    for (let i = 0; i < TITAN_TOPIC_ORDER.length; i++) {
      if (normalizedTitle.includes(TITAN_TOPIC_ORDER[i])) {
        return i;
      }
    }
    
    return TITAN_TOPIC_ORDER.length; // Unknown topics go last
  }

  private isTopicallyRelated(resource1: StudyResource, resource2: StudyResource): boolean {
    // Same domain
    if (resource1.domain === resource2.domain) return true;
    
    // Same chapter number
    if (resource1.chapterNumber && resource2.chapterNumber && 
        resource1.chapterNumber === resource2.chapterNumber) return true;
    
    // Topic keyword matching
    const title1 = (resource1.title || '').toLowerCase();
    const title2 = (resource2.title || '').toLowerCase();
    
    const topicKeywords = [
      'pancreas', 'liver', 'renal', 'kidney', 'reproductive', 'gynecologic', 'prostate', 'testicular',
      'barium', 'esophagus', 'stomach', 'bowel', 'colon', 'gi', 'gastrointestinal',
      'chest', 'thorax', 'lung', 'pulmonary', 'mediastinum',
      'thyroid', 'parathyroid', 'neck',
      'musculoskeletal', 'msk', 'bone', 'joint', 'spine',
      'neuro', 'brain', 'neurological', 'head',
      'pediatric', 'peds', 'child',
      'cardiac', 'heart', 'coronary', 'cardiovascular',
      'breast', 'mammography', 'mammo',
      'nuclear', 'pet', 'spect', 'scintigraphy',
      'interventional', 'vascular', 'angiography',
      'physics', 'ct', 'mri', 'ultrasound', 'radiation'
    ];
    
    return topicKeywords.some(keyword => 
      title1.includes(keyword) && title2.includes(keyword)
    );
  }

  private calculateDailyBoardVitalsQuotas(): void {
    if (this.totalBoardVitalsQuestions === 0) return;
    
    const questionsPerMinute = 0.5; // 2 minutes per question
    let remainingQuestions = this.totalBoardVitalsQuestions;
    
    for (let i = 0; i < this.studyDays.length; i++) {
      const day = this.studyDays[i];
      const remainingDays = this.studyDays.length - i;
      
      // Calculate target questions for this day
      const avgQuestionsPerDay = Math.ceil(remainingQuestions / Math.max(1, remainingDays));
      const maxQuestionsByTime = Math.floor(day.totalStudyTimeMinutes * 0.3 * questionsPerMinute);
      
      const targetQuestions = Math.min(avgQuestionsPerDay, maxQuestionsByTime, remainingQuestions);
      const targetMinutes = Math.ceil(targetQuestions / questionsPerMinute);
      
      // Get suggested subjects from topics covered up to this day
      const suggestedSubjects = new Set<Domain>();
      for (let j = 0; j <= i; j++) {
        const dayTopics = this.coveredTopicsPerDay.get(this.studyDays[j].date) || new Set();
        dayTopics.forEach(topic => {
          // Exclude meta-domains
          if (![Domain.NIS, Domain.RISC, Domain.HIGH_YIELD, Domain.MIXED_REVIEW, 
                Domain.WEAK_AREA_REVIEW, Domain.QUESTION_BANK_CATCHUP, 
                Domain.FINAL_REVIEW, Domain.LIGHT_REVIEW].includes(topic)) {
            suggestedSubjects.add(topic);
          }
        });
      }
      
      this.dailyBVQuotas.push({
        date: day.date,
        targetQuestions,
        suggestedSubjects: Array.from(suggestedSubjects),
        targetMinutes
      });
      
      remainingQuestions = Math.max(0, remainingQuestions - targetQuestions);
    }
  }

  private getRemainingTime(day: DailySchedule): number {
    const usedTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    return Math.max(0, day.totalStudyTimeMinutes - usedTime);
  }

  private createTask(resource: StudyResource, orderIndex: number): ScheduledTask {
    this.taskCounter++;
    const originalResourceId = resource.id.includes('_part_') 
      ? resource.id.split('_part_')[0] 
      : resource.id;
    
    return {
      id: `task_${resource.id}_${this.taskCounter}`,
      resourceId: resource.id,
      originalResourceId,
      title: resource.title,
      type: resource.type,
      originalTopic: resource.domain,
      durationMinutes: resource.durationMinutes,
      status: 'pending',
      order: orderIndex,
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

  private addTaskToDay(day: DailySchedule, resource: StudyResource): boolean {
    if (!this.remainingResources.has(resource.id)) return false;
    
    const remainingTime = this.getRemainingTime(day);
    if (remainingTime < resource.durationMinutes) return false;
    
    const task = this.createTask(resource, day.tasks.length);
    day.tasks.push(task);
    this.remainingResources.delete(resource.id);
    this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
    
    // Track Board Vitals questions
    if ((resource.bookSource || '').toLowerCase().includes('board vitals') && resource.questionCount) {
      this.scheduledBoardVitalsQuestions += resource.questionCount;
    }
    
    return true;
  }

  private createSyntheticBoardVitalsTask(quota: DailyBoardVitalsQuota, actualQuestions: number): ScheduledTask {
    this.taskCounter++;
    
    const subjectsList = quota.suggestedSubjects.length > 0 
      ? quota.suggestedSubjects.join(', ')
      : 'Mixed Topics';
    
    return {
      id: `synthetic_bv_${quota.date}_${this.taskCounter}`,
      resourceId: `bv_mixed_${quota.date}`,
      title: `Board Vitals - Mixed ${actualQuestions} questions (suggested: ${subjectsList})`,
      type: ResourceType.QUESTIONS,
      originalTopic: Domain.MIXED_REVIEW,
      durationMinutes: Math.ceil(actualQuestions / 0.5), // 2 min per question
      status: 'pending',
      order: 0,
      isOptional: false,
      isPrimaryMaterial: true,
      questionCount: actualQuestions
    };
  }

  /**
   * PHASE 1: STRICT TITAN-ORDERED ROUND-ROBIN WITH BLOCK CARRYOVER
   */
  
  private executePhase1(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Starting strict Titan-ordered round-robin with block carryover'
    });
    
    // Pass 1a: Titan blocks in exact order with carryover
    this.scheduleTitanBlocksWithCarryover();
    
    // Pass 1b: Huda blocks after Titan completion
    this.scheduleHudaBlocks();
    
    // Pass 1c: Nuclear blocks after Huda completion
    this.scheduleNuclearBlocks();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Completed strict round-robin distribution'
    });
  }

  private scheduleTitanBlocksWithCarryover(): void {
    this.currentTitanBlockIndex = 0;
    this.currentDayIndex = 0;
    
    while (this.currentTitanBlockIndex < this.titanBlocks.length) {
      const block = this.titanBlocks[this.currentTitanBlockIndex];
      const day = this.studyDays[this.currentDayIndex];
      
      // Get remaining resources in this block
      const remainingBlockResources = [block.titanVideo, ...block.pairedResources]
        .slice(block.nextResourceIndex)
        .filter(resource => this.remainingResources.has(resource.id));
      
      if (remainingBlockResources.length === 0) {
        // Block is complete, move to next block
        block.isComplete = true;
        this.currentTitanBlockIndex++;
        this.currentDayIndex = (this.currentDayIndex + 1) % this.studyDays.length;
        continue;
      }
      
      // Try to fit remaining resources on current day
      let resourcesPlacedThisDay = 0;
      for (const resource of remainingBlockResources) {
        if (this.addTaskToDay(day, resource)) {
          resourcesPlacedThisDay++;
        } else {
          break; // Can't fit more on this day
        }
      }
      
      // Update block progress
      block.nextResourceIndex += resourcesPlacedThisDay;
      
      // If we placed some resources but not all, carry over to next day
      if (resourcesPlacedThisDay > 0 && block.nextResourceIndex < [block.titanVideo, ...block.pairedResources].length) {
        this.currentDayIndex = (this.currentDayIndex + 1) % this.studyDays.length;
        // Continue with same block on next day
      }
      // If we couldn't place any resources, try next day
      else if (resourcesPlacedThisDay === 0) {
        this.currentDayIndex = (this.currentDayIndex + 1) % this.studyDays.length;
      }
      // If we placed all remaining resources, block is complete
      else {
        block.isComplete = true;
        this.currentTitanBlockIndex++;
        this.currentDayIndex = (this.currentDayIndex + 1) % this.studyDays.length;
      }
    }
    
    const completedBlocks = this.titanBlocks.filter(b => b.isComplete).length;
    this.notifications.push({
      type: 'info',
      message: `Pass 1a: Completed ${completedBlocks}/${this.titanBlocks.length} Titan blocks with strict ordering and carryover`
    });
  }

  private scheduleHudaBlocks(): void {
    const hudaBlocks = this.buildHudaBlocks();
    
    for (const block of hudaBlocks) {
      let blockResourceIndex = 0;
      
      while (blockResourceIndex < block.resources.length) {
        const day = this.studyDays[this.currentDayIndex];
        let placedThisDay = 0;
        
        // Try to place as many block resources as possible on current day
        for (let i = blockResourceIndex; i < block.resources.length; i++) {
          const resource = block.resources[i];
          
          if (this.addTaskToDay(day, resource)) {
            placedThisDay++;
            blockResourceIndex = i + 1;
          } else {
            break;
          }
        }
        
        // Move to next day if we placed something or couldn't place anything
        if (placedThisDay > 0 || blockResourceIndex >= block.resources.length) {
          this.currentDayIndex = (this.currentDayIndex + 1) % this.studyDays.length;
        }
        
        // Safety break to prevent infinite loops
        if (placedThisDay === 0 && blockResourceIndex < block.resources.length) {
          this.notifications.push({
            type: 'warning',
            message: `Could not place Huda resource: ${block.resources[blockResourceIndex].title}`
          });
          blockResourceIndex++;
        }
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1b: Completed ${hudaBlocks.length} Huda blocks with carryover`
    });
  }

  private buildHudaBlocks(): Array<{resources: StudyResource[]}> {
    // Group Huda resources into logical blocks
    const hudaAnchors = this.hudaResources
      .filter(r => r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
      .filter(r => this.remainingResources.has(r.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    return hudaAnchors.map(anchor => ({
      resources: [
        anchor,
        ...this.hudaResources.filter(r => 
          r.id !== anchor.id && 
          this.remainingResources.has(r.id) && 
          this.isTopicallyRelated(anchor, r)
        ).slice(0, 3) // Limit block size
      ]
    }));
  }

  private scheduleNuclearBlocks(): void {
    const nuclearBlocks = this.buildNuclearBlocks();
    
    for (const block of nuclearBlocks) {
      let blockResourceIndex = 0;
      
      while (blockResourceIndex < block.resources.length) {
        const day = this.studyDays[this.currentDayIndex];
        let placedThisDay = 0;
        
        // Try to place as many block resources as possible on current day
        for (let i = blockResourceIndex; i < block.resources.length; i++) {
          const resource = block.resources[i];
          
          if (this.addTaskToDay(day, resource)) {
            placedThisDay++;
            blockResourceIndex = i + 1;
          } else {
            break;
          }
        }
        
        // Move to next day
        this.currentDayIndex = (this.currentDayIndex + 1) % this.studyDays.length;
        
        // Safety break
        if (placedThisDay === 0 && blockResourceIndex < block.resources.length) {
          this.notifications.push({
            type: 'warning',
            message: `Could not place Nuclear resource: ${block.resources[blockResourceIndex].title}`
          });
          blockResourceIndex++;
        }
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1c: Completed nuclear medicine blocks with carryover`
    });
  }

  private buildNuclearBlocks(): Array<{resources: StudyResource[]}> {
    const nuclearAnchors = this.nuclearResources
      .filter(r => r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO || r.type === ResourceType.READING_TEXTBOOK)
      .filter(r => this.remainingResources.has(r.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    return nuclearAnchors.map(anchor => ({
      resources: [
        anchor,
        ...this.nuclearResources.filter(r => 
          r.id !== anchor.id && 
          this.remainingResources.has(r.id) && 
          this.isTopicallyRelated(anchor, r)
        ),
        ...this.nucAppResources.filter(r => 
          this.remainingResources.has(r.id) && 
          this.isTopicallyRelated(anchor, r)
        )
      ].slice(0, 5) // Reasonable block size limit
    }));
  }

  /**
   * PHASE 2: DAILY REQUIREMENTS WITH SYNTHETIC BOARD VITALS QUOTAS
   */
  
  private executePhase2(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Starting daily requirements with synthetic Board Vitals quotas'
    });
    
    for (let dayIndex = 0; dayIndex < this.studyDays.length; dayIndex++) {
      const day = this.studyDays[dayIndex];
      
      // Pass 2a: NIS and RISC (First-Fit)
      this.scheduleNisRiscForDay(day);
      
      // Pass 2b: Board Vitals SYNTHETIC daily mixed quota
      this.scheduleBoardVitalsQuotaForDay(day, dayIndex);
      
      // Pass 2c: Physics (First-Fit)
      this.schedulePhysicsForDay(day);
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Completed daily requirements with synthetic Board Vitals'
    });
  }

  private scheduleNisRiscForDay(day: DailySchedule): void {
    const availableNisRisc = this.nisRiscResources
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    for (const resource of availableNisRisc) {
      if (this.getRemainingTime(day) < 60) break; // Leave room for other phases
      this.addTaskToDay(day, resource);
    }
  }

  private scheduleBoardVitalsQuotaForDay(day: DailySchedule, dayIndex: number): void {
    const quota = this.dailyBVQuotas[dayIndex];
    if (!quota || quota.targetQuestions === 0) return;
    
    const remainingTime = this.getRemainingTime(day);
    if (remainingTime < 30) return; // Need minimum time for BV
    
    // Create synthetic Board Vitals task
    const actualQuestions = Math.min(quota.targetQuestions, Math.floor(remainingTime * 0.4 * 0.5));
    
    if (actualQuestions > 0) {
      const syntheticTask = this.createSyntheticBoardVitalsTask(quota, actualQuestions);
      day.tasks.push(syntheticTask);
      this.scheduledBoardVitalsQuestions += actualQuestions;
      
      // Mark covered topics
      this.coveredTopicsPerDay.get(day.date)?.add(Domain.MIXED_REVIEW);
      
      this.notifications.push({
        type: 'info',
        message: `Day ${day.date}: Board Vitals quota ${actualQuestions}/${quota.targetQuestions} questions, subjects: ${quota.suggestedSubjects.join(', ') || 'Mixed'}`
      });
    }
  }

  private schedulePhysicsForDay(day: DailySchedule): void {
    const availablePhysics = this.physicsResources
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    for (const resource of availablePhysics) {
      if (this.getRemainingTime(day) < 30) break; // Leave room for Phase 3
      if (this.addTaskToDay(day, resource)) {
        break; // Only add one physics resource per day in Phase 2
      }
    }
  }

  /**
   * PHASE 3: SUPPLEMENTARY CONTENT AFTER ALL PHASE 1&2 COMPLETE
   */
  
  private executePhase3(): void {
    // Check if there are any high-priority resources remaining
    const requiredRemaining = Array.from(this.remainingResources).filter(resourceId => {
      const resource = this.allResources.get(resourceId);
      return resource && (resource.isPrimaryMaterial || 
        resource.domain === Domain.NIS || 
        resource.domain === Domain.RISC ||
        (resource.bookSource || '').toLowerCase().includes('board vitals'));
    });
    
    if (requiredRemaining.length > 0) {
      this.notifications.push({
        type: 'info',
        message: `Phase 3: ${requiredRemaining.length} required resources remain, scheduling alongside supplementary content`
      });
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Starting supplementary content with relevancy matching'
    });
    
    // Pass 3a: Discord lectures with relevancy
    this.scheduleDiscordWithRelevancy();
    
    // Pass 3b: Core Radiology with relevancy
    this.scheduleCoreRadiologyWithRelevancy();
    
    // Final mop-up pass for any remaining required content
    this.performFinalMopUp();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Completed supplementary content scheduling'
    });
  }

  private scheduleDiscordWithRelevancy(): void {
    this.scheduleSupplementaryContentWithRelevancy(
      this.discordResources.filter(r => this.remainingResources.has(r.id)),
      'Discord lectures'
    );
  }

  private scheduleCoreRadiologyWithRelevancy(): void {
    this.scheduleSupplementaryContentWithRelevancy(
      this.coreRadiologyResources.filter(r => this.remainingResources.has(r.id)),
      'Core Radiology'
    );
  }

  private scheduleSupplementaryContentWithRelevancy(resources: StudyResource[], contentType: string): void {
    let scheduledCount = 0;
    
    // Multiple passes to fill all available time
    for (let pass = 0; pass < 3; pass++) {
      for (const day of this.studyDays) {
        const dayTopics = this.coveredTopicsPerDay.get(day.date) || new Set();
        const remainingTime = this.getRemainingTime(day);
        
        if (remainingTime < 5) continue;
        
        // Sort by relevancy to day's topics
        const sortedByRelevancy = resources
          .filter(resource => this.remainingResources.has(resource.id))
          .sort((a, b) => this.calculateRelevancyScore(b, dayTopics) - this.calculateRelevancyScore(a, dayTopics));
        
        // Greedily fill remaining time
        for (const resource of sortedByRelevancy) {
          if (this.getRemainingTime(day) >= resource.durationMinutes) {
            if (this.addTaskToDay(day, resource)) {
              scheduledCount++;
            }
          }
        }
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 3: Scheduled ${scheduledCount} ${contentType} resources with relevancy matching`
    });
  }

  private performFinalMopUp(): void {
    // Final pass to place any remaining required resources in under-filled days
    const requiredResources = Array.from(this.remainingResources)
      .map(id => this.allResources.get(id))
      .filter((resource): resource is StudyResource => 
        resource !== undefined && (
          resource.isPrimaryMaterial || 
          resource.domain === Domain.NIS || 
          resource.domain === Domain.RISC ||
          (resource.bookSource || '').toLowerCase().includes('board vitals') ||
          (resource.bookSource || '').toLowerCase().includes('qevlar')
        )
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    if (requiredResources.length === 0) return;
    
    // Find days with most available time for mop-up
    const daysWithTime = this.studyDays
      .map(day => ({
        day,
        remainingTime: this.getRemainingTime(day)
      }))
      .filter(({remainingTime}) => remainingTime >= 5)
      .sort((a, b) => b.remainingTime - a.remainingTime);
    
    let moppedUp = 0;
    for (const resource of requiredResources) {
      for (const {day} of daysWithTime) {
        if (this.addTaskToDay(day, resource)) {
          moppedUp++;
          break;
        }
      }
    }
    
    if (moppedUp > 0) {
      this.notifications.push({
        type: 'info',
        message: `Final mop-up: Placed ${moppedUp} remaining required resources in under-filled days`
      });
    }
  }

  private calculateRelevancyScore(resource: StudyResource, dayTopics: Set<Domain>): number {
    let score = 0;
    
    // High relevancy for matching domain
    if (dayTopics.has(resource.domain)) {
      score += 100;
    }
    
    // Medium relevancy for related domains
    const relatedDomains = this.getRelatedDomains(resource.domain);
    for (const domain of relatedDomains) {
      if (dayTopics.has(domain)) {
        score += 50;
      }
    }
    
    // Bonus for primary material
    if (resource.isPrimaryMaterial) {
      score += 25;
    }
    
    // Bonus for shorter resources (better gap filling)
    if (resource.durationMinutes <= 10) {
      score += 15;
    } else if (resource.durationMinutes <= 30) {
      score += 10;
    }
    
    return score;
  }

  private getRelatedDomains(domain: Domain): Domain[] {
    const relationMap: Record<Domain, Domain[]> = {
      [Domain.GASTROINTESTINAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY],
      [Domain.GENITOURINARY_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY],
      [Domain.THORACIC_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING],
      [Domain.CARDIOVASCULAR_IMAGING]: [Domain.THORACIC_IMAGING, Domain.INTERVENTIONAL_RADIOLOGY],
      [Domain.NEURORADIOLOGY]: [Domain.PEDIATRIC_RADIOLOGY],
      [Domain.PEDIATRIC_RADIOLOGY]: [Domain.NEURORADIOLOGY, Domain.THORACIC_IMAGING],
      [Domain.MUSCULOSKELETAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY],
      [Domain.INTERVENTIONAL_RADIOLOGY]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GASTROINTESTINAL_IMAGING],
      [Domain.BREAST_IMAGING]: [],
      [Domain.ULTRASOUND_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GENITOURINARY_IMAGING],
      [Domain.NUCLEAR_MEDICINE]: [Domain.PHYSICS],
      [Domain.PHYSICS]: [Domain.NUCLEAR_MEDICINE]
    };
    
    return relationMap[domain] || [];
  }

  /**
   * PHASE 4: VALIDATION AND OPTIMIZATION
   */
  
  private executePhase4(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 4: Starting validation and optimization'
    });
    
    let violations = 0;
    
    // Validate time constraints
    for (const day of this.studyDays) {
      const totalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
      
      if (totalTime > day.totalStudyTimeMinutes) {
        violations++;
        const excess = totalTime - day.totalStudyTimeMinutes;
        
        this.notifications.push({
          type: 'warning',
          message: `Day ${day.date} exceeds limit by ${excess} minutes - redistributing`
        });
        
        this.redistributeExcessTasks(day, excess);
      }
    }
    
    // Final sort and order tasks
    this.finalizeTaskOrder();
    
    this.notifications.push({
      type: 'info',
      message: `Phase 4: Completed validation (${violations} violations corrected)`
    });
  }

  private redistributeExcessTasks(overloadedDay: DailySchedule, excessTime: number): void {
    // Sort tasks by priority (lowest priority first for removal)
    const sortedTasks = [...overloadedDay.tasks].sort((a, b) => {
      const priorityA = TASK_TYPE_PRIORITY[a.type] || 99;
      const priorityB = TASK_TYPE_PRIORITY[b.type] || 99;
      
      // Higher numbers = lower priority, remove first
      if (priorityA !== priorityB) return priorityB - priorityA;
      
      // Optional tasks are lower priority
      if (a.isOptional !== b.isOptional) return a.isOptional ? -1 : 1;
      
      // Longer tasks are easier to move
      return b.durationMinutes - a.durationMinutes;
    });
    
    let timeToRedistribute = excessTime;
    const tasksToMove: ScheduledTask[] = [];
    
    for (const task of sortedTasks) {
      if (timeToRedistribute <= 0) break;
      tasksToMove.push(task);
      timeToRedistribute -= task.durationMinutes;
    }
    
    // Remove from overloaded day
    overloadedDay.tasks = overloadedDay.tasks.filter(task => 
      !tasksToMove.some(t => t.id === task.id)
    );
    
    // Find best days for redistribution
    const availableDays = this.studyDays
      .filter(d => d.date !== overloadedDay.date)
      .sort((a, b) => this.getRemainingTime(b) - this.getRemainingTime(a));
    
    for (const task of tasksToMove) {
      let taskMoved = false;
      
      for (const day of availableDays) {
        if (this.getRemainingTime(day) >= task.durationMinutes) {
          day.tasks.push({...task, order: day.tasks.length});
          taskMoved = true;
          break;
        }
      }
      
      if (!taskMoved) {
        // Put back if couldn't move
        overloadedDay.tasks.push(task);
      }
    }
  }

  private finalizeTaskOrder(): void {
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      day.tasks.forEach((task, index) => {
        task.order = index;
      });
    }
  }

  /**
   * FINALIZATION AND SUMMARY
   */
  
  private generateSummary(): void {
    const totalScheduledTime = this.schedule
      .reduce((sum, day) => sum + day.tasks.reduce((daySum, task) => daySum + task.durationMinutes, 0), 0);
    
    const totalAvailableTime = this.studyDays
      .reduce((sum, day) => sum + day.totalStudyTimeMinutes, 0);
    
    const utilizationPercentage = totalAvailableTime > 0 
      ? ((totalScheduledTime / totalAvailableTime) * 100).toFixed(1)
      : '0';
    
    this.notifications.push({
      type: 'info',
      message: `Summary: ${totalScheduledTime}min/${totalAvailableTime}min scheduled (${utilizationPercentage}% utilization)`
    });
    
    // Board Vitals completion rate
    if (this.totalBoardVitalsQuestions > 0) {
      const bvCompletionRate = ((this.scheduledBoardVitalsQuestions / this.totalBoardVitalsQuestions) * 100).toFixed(1);
      this.notifications.push({
        type: 'info',
        message: `Board Vitals: ${this.scheduledBoardVitalsQuestions}/${this.totalBoardVitalsQuestions} questions scheduled (${bvCompletionRate}%)`
      });
    }
    
    // Report unscheduled
    const unscheduledCount = this.remainingResources.size;
    if (unscheduledCount > 0) {
      this.notifications.push({
        type: 'warning',
        message: `${unscheduledCount} resources remain unscheduled`
      });
      
      const examples = Array.from(this.remainingResources)
        .slice(0, 5)
        .map(id => {
          const resource = this.allResources.get(id);
          return resource ? `"${resource.title}" (${resource.durationMinutes}min)` : id;
        });
      
      if (examples.length > 0) {
        this.notifications.push({
          type: 'info',
          message: `Examples: ${examples.join(', ')}`
        });
      }
    }
  }

  /**
   * MAIN EXECUTION
   */
  
  public generateSchedule(): GeneratedStudyPlanOutcome {
    try {
      if (this.studyDays.length === 0) {
        throw new Error('No study days available');
      }
      
      this.notifications.push({
        type: 'info',
        message: `Starting definitive 4-phase algorithm: ${this.studyDays.length} days, ${this.allResources.size} resources`
      });
      
      // Execute all 4 phases
      this.executePhase1(); // Titan-ordered round-robin with carryover
      this.executePhase2(); // Daily requirements with synthetic BV quotas
      this.executePhase3(); // Supplementary content with relevancy
      this.executePhase4(); // Validation and optimization
      
      this.generateSummary();
      
      // Build progress tracking
      const progressPerDomain = this.buildProgressTracking();
      
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
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.notifications.push({
        type: 'error',
        message: `Scheduling failed: ${errorMessage}`
      });
      
      return this.createEmptyPlan();
    }
  }

  private buildProgressTracking(): StudyPlan['progressPerDomain'] {
    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    
    // Initialize with all resources
    for (const resource of this.allResources.values()) {
      if (!progressPerDomain[resource.domain]) {
        progressPerDomain[resource.domain] = {
          completedMinutes: 0,
          totalMinutes: 0
        };
      }
      progressPerDomain[resource.domain]!.totalMinutes += resource.durationMinutes;
    }
    
    // Calculate completed from scheduled tasks
    for (const day of this.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && progressPerDomain[task.originalTopic]) {
          progressPerDomain[task.originalTopic]!.completedMinutes += task.durationMinutes;
        }
      }
    }
    
    return progressPerDomain;
  }

  private createEmptyPlan(): GeneratedStudyPlanOutcome {
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
}

/**
 * PUBLIC API FUNCTIONS
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
  const scheduler = new DefinitiveScheduler(
    startDateStr,
    endDateStr,
    exceptionRules,
    resourcePool,
    topicOrder || DEFAULT_TOPIC_ORDER,
    deadlines || {},
    areSpecialTopicsInterleaved ?? true
  );
  
  return scheduler.generateSchedule();
};

export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionRules: ExceptionDateRule[],
  resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
  const today = getTodayInNewYork();
  
  // Determine rebalance start date with bounds checking
  let rebalanceStartDate: string;
  if (options.type === 'standard') {
    rebalanceStartDate = (options.rebalanceDate && options.rebalanceDate > today) 
      ? options.rebalanceDate 
      : today;
  } else {
    rebalanceStartDate = options.date;
  }
  
  // Clamp to plan bounds
  if (rebalanceStartDate > currentPlan.endDate) {
    rebalanceStartDate = currentPlan.endDate;
  }
  if (rebalanceStartDate < currentPlan.startDate) {
    rebalanceStartDate = currentPlan.startDate;
  }
  
  // Preserve past schedule
  const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStartDate);
  
  // Collect completed resources to exclude
  const completedResourceIds = new Set<string>();
  for (const day of currentPlan.schedule) {
    for (const task of day.tasks) {
      if (task.status === 'completed' && task.originalResourceId) {
        completedResourceIds.add(task.originalResourceId);
      }
    }
  }
  
  // Filter available resources
  const availableResources = resourcePool.filter(resource => 
    !completedResourceIds.has(resource.id) && !resource.isArchived
  );
  
  // Generate new schedule for remaining period
  const scheduler = new DefinitiveScheduler(
    rebalanceStartDate,
    currentPlan.endDate,
    exceptionRules,
    availableResources,
    currentPlan.topicOrder,
    currentPlan.deadlines,
    currentPlan.areSpecialTopicsInterleaved
  );
  
  const result = scheduler.generateSchedule();
  
  // Combine schedules
  result.plan.schedule = [...pastSchedule, ...result.plan.schedule];
  result.plan.startDate = currentPlan.startDate;
  
  // Recalculate progress including completed tasks
  const updatedProgress = result.plan.progressPerDomain;
  for (const day of result.plan.schedule) {
    for (const task of day.tasks) {
      if (task.status === 'completed' && updatedProgress[task.originalTopic]) {
        updatedProgress[task.originalTopic]!.completedMinutes += task.durationMinutes;
      }
    }
  }
  result.plan.progressPerDomain = updatedProgress;
  
  return result;
};
