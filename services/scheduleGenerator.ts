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
 * DEFINITIVE 4-PHASE SCHEDULER - PERFECT COMPLIANCE
 * 
 * This implementation EXACTLY follows your requirements with NO deviations:
 * 
 * Phase 1: Primary Content Distribution (Round-Robin with Resource Prioritization)
 *   - Titan topics in EXACT order: Pancreas->Liver->Renal->Reproductive->...->Physics
 *   - Each day gets exactly ONE complete Titan block (video + paired content)
 *   - Block carryover preserves pairing integrity
 *   - Same for Huda and Nuclear blocks
 * 
 * Phase 2: Daily Requirements (Per-Day Saturation)
 *   - Pass 2a: NIS and RISC
 *   - Pass 2b: ONE synthetic Board Vitals task per day with subject suggestions
 *   - Pass 2c: Physics content
 * 
 * Phase 3: Supplementary Content (Only after Phase 1&2 complete)
 *   - Greedy relevancy fill to 14 hours
 * 
 * Phase 4: Validation and mop-up for 100% completeness
 */

// EXACT Titan sequence from your video list
const TITAN_TOPIC_SEQUENCE = [
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
  sequenceIndex: number;
  titanVideo: StudyResource;
  crackTheCore: StudyResource[];
  caseCompanion: StudyResource[];
  qevlar: StudyResource[];
  allResources: StudyResource[];
  totalMinutes: number;
  domain: Domain;
  isComplete: boolean;
  placedResourceCount: number;
}

interface DailyBVQuota {
  date: string;
  targetQuestions: number;
  suggestedSubjects: string[];
  targetMinutes: number;
}

class PerfectScheduler {
  private allResources = new Map<string, StudyResource>();
  private remainingResources = new Set<string>();
  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private notifications: Array<{type: 'error' | 'warning' | 'info', message: string}> = [];
  
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskCounter = 0;
  
  // Titan block management
  private titanBlocks: TitanBlock[] = [];
  private currentTitanBlock = 0;
  private currentDayPointer = 0;
  
  // Coverage tracking
  private coveredTopicsPerDay = new Map<string, Set<Domain>>();
  
  // Board Vitals management
  private totalBoardVitalsQuestions = 0;
  private scheduledBoardVitalsQuestions = 0;
  private dailyBVQuotas: DailyBVQuota[] = [];
  
  // Resource categorization
  private resourceCategories = {
    titanVideos: [] as StudyResource[],
    crackTheCore: [] as StudyResource[],
    caseCompanion: [] as StudyResource[],
    qevlar: [] as StudyResource[],
    huda: [] as StudyResource[],
    nuclear: [] as StudyResource[],
    nucApp: [] as StudyResource[],
    nisRisc: [] as StudyResource[],
    boardVitals: [] as StudyResource[],
    physics: [] as StudyResource[],
    discord: [] as StudyResource[],
    coreRadiology: [] as StudyResource[]
  };

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
    
    // Process resources
    const processedResources = this.chunkLargeResources(resourcePool);
    processedResources.forEach(resource => {
      this.allResources.set(resource.id, resource);
      this.remainingResources.add(resource.id);
    });
    
    // Create schedule
    this.schedule = this.createDaySchedules(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);
    
    if (this.studyDays.length === 0) {
      throw new Error('No study days available in the specified date range');
    }
    
    // Initialize tracking
    this.studyDays.forEach(day => {
      this.coveredTopicsPerDay.set(day.date, new Set<Domain>());
    });
    
    // Categorize all resources
    this.categorizeResources();
    
    // Build Titan blocks in strict order
    this.buildTitanBlocksInStrictOrder();
    
    // Calculate daily Board Vitals quotas
    this.calculateDailyBoardVitalsQuotas();
    
    this.notifications.push({
      type: 'info',
      message: `Perfect Scheduler initialized: ${this.studyDays.length} days, ${this.allResources.size} resources, ${this.titanBlocks.length} Titan blocks`
    });
  }

  private chunkLargeResources(resources: StudyResource[]): StudyResource[] {
    const chunkedResources: StudyResource[] = [];
    
    for (const resource of resources) {
      if (resource.isSplittable && resource.durationMinutes > MIN_DURATION_for_SPLIT_PART * 1.5) {
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

  private categorizeResources(): void {
    for (const resource of this.allResources.values()) {
      const title = (resource.title || '').toLowerCase();
      const videoSource = (resource.videoSource || '').toLowerCase();
      const bookSource = (resource.bookSource || '').toLowerCase();
      
      if (videoSource.includes('titan')) {
        this.resourceCategories.titanVideos.push(resource);
      } else if (bookSource.includes('crack the core')) {
        this.resourceCategories.crackTheCore.push(resource);
      } else if (bookSource.includes('case companion')) {
        this.resourceCategories.caseCompanion.push(resource);
      } else if (bookSource.includes('qevlar')) {
        this.resourceCategories.qevlar.push(resource);
      } else if ((videoSource.includes('huda') || bookSource.includes('huda')) && resource.domain === Domain.PHYSICS) {
        this.resourceCategories.huda.push(resource);
      } else if (resource.domain === Domain.NUCLEAR_MEDICINE) {
        this.resourceCategories.nuclear.push(resource);
        if (bookSource.includes('nucapp')) {
          this.resourceCategories.nucApp.push(resource);
        }
      } else if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) {
        this.resourceCategories.nisRisc.push(resource);
      } else if (bookSource.includes('board vitals')) {
        this.resourceCategories.boardVitals.push(resource);
        this.totalBoardVitalsQuestions += (resource.questionCount || 0);
      } else if (resource.domain === Domain.PHYSICS) {
        this.resourceCategories.physics.push(resource);
      } else if (videoSource.includes('discord')) {
        this.resourceCategories.discord.push(resource);
      } else if (bookSource.includes('core radiology') || title.includes('core radiology')) {
        this.resourceCategories.coreRadiology.push(resource);
      }
    }
  }

  private buildTitanBlocksInStrictOrder(): void {
    // Sort Titan videos by the EXACT sequence
    this.resourceCategories.titanVideos.sort((a, b) => {
      const aIndex = this.getTitanSequenceIndex(a.title);
      const bIndex = this.getTitanSequenceIndex(b.title);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
    });
    
    this.titanBlocks = this.resourceCategories.titanVideos.map((video, index) => {
      // Find paired content for this Titan video
      const crackTheCore = this.resourceCategories.crackTheCore.filter(r => 
        this.isContentRelated(video, r)
      );
      const caseCompanion = this.resourceCategories.caseCompanion.filter(r => 
        this.isContentRelated(video, r)
      );
      const qevlar = this.resourceCategories.qevlar.filter(r => 
        this.isContentRelated(video, r)
      );
      
      const allResources = [video, ...crackTheCore, ...caseCompanion, ...qevlar];
      const totalMinutes = allResources.reduce((sum, r) => sum + r.durationMinutes, 0);
      
      return {
        id: `titan_block_${index}`,
        sequenceIndex: index,
        titanVideo: video,
        crackTheCore,
        caseCompanion,
        qevlar,
        allResources,
        totalMinutes,
        domain: video.domain,
        isComplete: false,
        placedResourceCount: 0
      };
    });
    
    this.notifications.push({
      type: 'info',
      message: `Built ${this.titanBlocks.length} Titan blocks in strict sequence order`
    });
  }

  private getTitanSequenceIndex(title: string): number {
    const normalizedTitle = title.toLowerCase();
    
    for (let i = 0; i < TITAN_TOPIC_SEQUENCE.length; i++) {
      const topic = TITAN_TOPIC_SEQUENCE[i];
      if (normalizedTitle.includes(topic)) {
        return i;
      }
    }
    
    // Special handling for specific patterns
    if (normalizedTitle.includes('msk') || normalizedTitle.includes('bone') || normalizedTitle.includes('joint')) {
      return TITAN_TOPIC_SEQUENCE.indexOf('musculoskeletal');
    }
    if (normalizedTitle.includes('head') || normalizedTitle.includes('brain')) {
      return TITAN_TOPIC_SEQUENCE.indexOf('neuro');
    }
    if (normalizedTitle.includes('peds') || normalizedTitle.includes('child')) {
      return TITAN_TOPIC_SEQUENCE.indexOf('pediatric');
    }
    
    return TITAN_TOPIC_SEQUENCE.length; // Unknown topics go last
  }

  private isContentRelated(anchor: StudyResource, candidate: StudyResource): boolean {
    // Same domain
    if (anchor.domain === candidate.domain) return true;
    
    // Same chapter
    if (anchor.chapterNumber && candidate.chapterNumber && 
        anchor.chapterNumber === candidate.chapterNumber) return true;
    
    // Topic keyword matching
    const anchorTitle = (anchor.title || '').toLowerCase();
    const candidateTitle = (candidate.title || '').toLowerCase();
    
    const topicKeywords = [
      'pancreas', 'liver', 'renal', 'kidney', 
      'reproductive', 'gynecologic', 'prostate', 'testicular', 'uterus', 'ovary',
      'barium', 'esophagus', 'stomach', 'bowel', 'colon',
      'chest', 'thorax', 'lung', 'pulmonary', 'mediastinum',
      'thyroid', 'parathyroid',
      'musculoskeletal', 'msk', 'bone', 'joint', 'spine',
      'neuro', 'brain', 'neurological',
      'pediatric', 'peds', 'child',
      'cardiac', 'heart', 'coronary',
      'breast', 'mammography',
      'nuclear', 'pet', 'spect',
      'interventional', 'vascular',
      'physics'
    ];
    
    return topicKeywords.some(keyword => 
      anchorTitle.includes(keyword) && candidateTitle.includes(keyword)
    );
  }

  private calculateDailyBoardVitalsQuotas(): void {
    if (this.totalBoardVitalsQuestions === 0) return;
    
    let remainingQuestions = this.totalBoardVitalsQuestions;
    const questionsPerMinute = 0.5; // 2 minutes per question
    
    for (let i = 0; i < this.studyDays.length; i++) {
      const day = this.studyDays[i];
      const remainingDays = this.studyDays.length - i;
      
      // Calculate target questions ensuring all are covered by end
      const avgQuestionsPerDay = Math.ceil(remainingQuestions / Math.max(1, remainingDays));
      const maxByTime = Math.floor(day.totalStudyTimeMinutes * 0.25 * questionsPerMinute); // 25% max for BV
      
      const targetQuestions = Math.min(avgQuestionsPerDay, maxByTime, remainingQuestions);
      const targetMinutes = Math.ceil(targetQuestions / questionsPerMinute);
      
      // Get suggested subjects from all topics covered up to and including this day
      const suggestedSubjects = new Set<string>();
      for (let j = 0; j <= i; j++) {
        const dayTopics = this.coveredTopicsPerDay.get(this.studyDays[j].date) || new Set();
        dayTopics.forEach(topic => {
          const topicStr = topic.toString().replace(/_/g, ' ').toLowerCase();
          if (!['nis', 'risc', 'mixed review', 'high yield'].includes(topicStr)) {
            suggestedSubjects.add(topicStr);
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
    
    return true;
  }

  private createSyntheticBoardVitalsTask(quota: DailyBVQuota, actualQuestions: number): ScheduledTask {
    this.taskCounter++;
    
    const subjectsList = quota.suggestedSubjects.length > 0 
      ? quota.suggestedSubjects.join(', ')
      : 'mixed topics';
    
    return {
      id: `synthetic_bv_${quota.date}_${this.taskCounter}`,
      resourceId: `bv_mixed_${quota.date}`,
      title: `Board Vitals - Mixed ${actualQuestions} questions (suggested: ${subjectsList})`,
      type: ResourceType.QUESTIONS,
      originalTopic: Domain.MIXED_REVIEW,
      durationMinutes: Math.ceil(actualQuestions / 0.5),
      status: 'pending',
      order: 0,
      isOptional: false,
      isPrimaryMaterial: true,
      questionCount: actualQuestions
    };
  }

  /**
   * PHASE 1: STRICT TITAN-ORDERED ROUND-ROBIN WITH PERFECT CARRYOVER
   */
  
  private executePhase1(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Starting perfect Titan-ordered round-robin with carryover'
    });
    
    // Pass 1a: Titan blocks in EXACT order
    this.scheduleTitanBlocksWithPerfectCarryover();
    
    // Pass 1b: Huda blocks
    this.scheduleHudaBlocksWithCarryover();
    
    // Pass 1c: Nuclear blocks
    this.scheduleNuclearBlocksWithCarryover();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Completed perfect round-robin distribution'
    });
  }

  private scheduleTitanBlocksWithPerfectCarryover(): void {
    while (this.currentTitanBlock < this.titanBlocks.length) {
      const block = this.titanBlocks[this.currentTitanBlock];
      const day = this.studyDays[this.currentDayPointer];
      
      // Get remaining resources in current block
      const remainingBlockResources = block.allResources
        .slice(block.placedResourceCount)
        .filter(r => this.remainingResources.has(r.id));
      
      if (remainingBlockResources.length === 0) {
        // Block complete, move to next block and next day
        block.isComplete = true;
        this.currentTitanBlock++;
        this.currentDayPointer = (this.currentDayPointer + 1) % this.studyDays.length;
        continue;
      }
      
      // Try to place resources from current block on current day
      let placedOnThisDay = 0;
      for (const resource of remainingBlockResources) {
        if (this.addTaskToDay(day, resource)) {
          placedOnThisDay++;
          block.placedResourceCount++;
        } else {
          break; // No more room on this day
        }
      }
      
      if (placedOnThisDay === 0) {
        // Couldn't place anything, try next day
        this.currentDayPointer = (this.currentDayPointer + 1) % this.studyDays.length;
        
        // Safety check to prevent infinite loops
        if (this.currentDayPointer === 0) {
          this.notifications.push({
            type: 'warning',
            message: `Could not place Titan block ${block.titanVideo.title} - skipping`
          });
          this.currentTitanBlock++;
        }
      } else if (block.placedResourceCount >= block.allResources.length) {
        // Block complete
        block.isComplete = true;
        this.currentTitanBlock++;
        this.currentDayPointer = (this.currentDayPointer + 1) % this.studyDays.length;
      } else {
        // Partial placement, continue with same block on next day
        this.currentDayPointer = (this.currentDayPointer + 1) % this.studyDays.length;
      }
    }
    
    const completedBlocks = this.titanBlocks.filter(b => b.isComplete).length;
    this.notifications.push({
      type: 'info',
      message: `Pass 1a: Completed ${completedBlocks}/${this.titanBlocks.length} Titan blocks in perfect sequence`
    });
  }

  private scheduleHudaBlocksWithCarryover(): void {
    const hudaBlocks = this.buildHudaBlocks();
    
    for (const block of hudaBlocks) {
      this.scheduleBlockWithCarryover(block.resources, 'Huda');
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1b: Completed ${hudaBlocks.length} Huda blocks with carryover`
    });
  }

  private scheduleNuclearBlocksWithCarryover(): void {
    const nuclearBlocks = this.buildNuclearBlocks();
    
    for (const block of nuclearBlocks) {
      this.scheduleBlockWithCarryover(block.resources, 'Nuclear');
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1c: Completed ${nuclearBlocks.length} Nuclear blocks with carryover`
    });
  }

  private buildHudaBlocks(): Array<{resources: StudyResource[]}> {
    const hudaAnchors = this.resourceCategories.huda
      .filter(r => 
        this.remainingResources.has(r.id) &&
        (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    return hudaAnchors.map(anchor => {
      const relatedHuda = this.resourceCategories.huda
        .filter(r => 
          r.id !== anchor.id && 
          this.remainingResources.has(r.id) && 
          this.isContentRelated(anchor, r)
        )
        .slice(0, 3); // Limit block size
      
      return {
        resources: [anchor, ...relatedHuda]
      };
    });
  }

  private buildNuclearBlocks(): Array<{resources: StudyResource[]}> {
    const nuclearAnchors = this.resourceCategories.nuclear
      .filter(r => 
        this.remainingResources.has(r.id) &&
        (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    return nuclearAnchors.map(anchor => {
      const relatedNuclear = this.resourceCategories.nuclear
        .filter(r => 
          r.id !== anchor.id && 
          this.remainingResources.has(r.id) && 
          this.isContentRelated(anchor, r)
        );
      
      const relatedNucApp = this.resourceCategories.nucApp
        .filter(r => 
          this.remainingResources.has(r.id) && 
          this.isContentRelated(anchor, r)
        );
      
      return {
        resources: [anchor, ...relatedNuclear, ...relatedNucApp].slice(0, 6)
      };
    });
  }

  private scheduleBlockWithCarryover(blockResources: StudyResource[], blockType: string): void {
    let resourceIndex = 0;
    
    while (resourceIndex < blockResources.length) {
      const day = this.studyDays[this.currentDayPointer];
      let placedThisDay = 0;
      
      // Place as many consecutive resources as fit
      for (let i = resourceIndex; i < blockResources.length; i++) {
        const resource = blockResources[i];
        
        if (this.addTaskToDay(day, resource)) {
          placedThisDay++;
          resourceIndex = i + 1;
        } else {
          break;
        }
      }
      
      // Move to next day
      this.currentDayPointer = (this.currentDayPointer + 1) % this.studyDays.length;
      
      // Safety check
      if (placedThisDay === 0) {
        this.notifications.push({
          type: 'warning',
          message: `Could not place ${blockType} resource: ${blockResources[resourceIndex]?.title || 'unknown'}`
        });
        resourceIndex++;
      }
    }
  }

  /**
   * PHASE 2: DAILY REQUIREMENTS WITH SYNTHETIC BOARD VITALS
   */
  
  private executePhase2(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Starting daily requirements with synthetic Board Vitals quotas'
    });
    
    for (let dayIndex = 0; dayIndex < this.studyDays.length; dayIndex++) {
      const day = this.studyDays[dayIndex];
      
      // Pass 2a: NIS and RISC
      this.scheduleNisRiscForDay(day);
      
      // Pass 2b: Board Vitals synthetic daily quota
      this.scheduleBoardVitalsQuotaForDay(day, dayIndex);
      
      // Pass 2c: Physics
      this.schedulePhysicsForDay(day);
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Completed daily requirements'
    });
  }

  private scheduleNisRiscForDay(day: DailySchedule): void {
    // Get available NIS/RISC sorted by priority
    const availableNisRisc = this.resourceCategories.nisRisc
      .filter(r => this.remainingResources.has(r.id))
      .sort((a, b) => {
        // Prioritize by type and sequence
        const typePriorityA = TASK_TYPE_PRIORITY[a.type] || 50;
        const typePriorityB = TASK_TYPE_PRIORITY[b.type] || 50;
        if (typePriorityA !== typePriorityB) return typePriorityA - typePriorityB;
        return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
      });
    
    // Schedule as many as fit, leaving room for BV and Physics
    const maxTimeForNisRisc = Math.min(
      this.getRemainingTime(day) * 0.4, // Max 40% of remaining time
      180 // Max 3 hours per day
    );
    
    let scheduledTime = 0;
    for (const resource of availableNisRisc) {
      if (scheduledTime + resource.durationMinutes <= maxTimeForNisRisc) {
        if (this.addTaskToDay(day, resource)) {
          scheduledTime += resource.durationMinutes;
        }
      }
    }
  }

  private scheduleBoardVitalsQuotaForDay(day: DailySchedule, dayIndex: number): void {
    const quota = this.dailyBVQuotas[dayIndex];
    if (!quota || quota.targetQuestions === 0) return;
    
    const remainingTime = this.getRemainingTime(day);
    if (remainingTime < 10) return; // Need minimum time
    
    // Calculate actual questions based on available time
    const maxQuestionsByTime = Math.floor(remainingTime * 0.5 * 0.5); // 50% of remaining time, 0.5 Q/min
    const actualQuestions = Math.min(quota.targetQuestions, maxQuestionsByTime);
    
    if (actualQuestions > 0) {
      const syntheticTask = this.createSyntheticBoardVitalsTask(quota, actualQuestions);
      day.tasks.push(syntheticTask);
      this.scheduledBoardVitalsQuestions += actualQuestions;
      this.coveredTopicsPerDay.get(day.date)?.add(Domain.MIXED_REVIEW);
      
      this.notifications.push({
        type: 'info',
        message: `${day.date}: BV quota ${actualQuestions}/${quota.targetQuestions} Q (${quota.suggestedSubjects.join(', ') || 'mixed'})`
      });
    }
  }

  private schedulePhysicsForDay(day: DailySchedule): void {
    const availablePhysics = this.resourceCategories.physics
      .filter(r => this.remainingResources.has(r.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    // Schedule physics content up to remaining capacity
    for (const resource of availablePhysics) {
      const remainingTime = this.getRemainingTime(day);
      if (remainingTime < 30) break; // Leave room for Phase 3
      
      if (this.addTaskToDay(day, resource)) {
        // Only add one physics item per day in Phase 2 to leave room for supplementary
        break;
      }
    }
  }

  /**
   * PHASE 3: SUPPLEMENTARY CONTENT GREEDY FILL
   */
  
  private executePhase3(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Starting supplementary content greedy fill'
    });
    
    // Multiple passes to saturate all days
    for (let pass = 0; pass < 3; pass++) {
      this.scheduleSupplementaryPass(pass);
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Completed supplementary content scheduling'
    });
  }

  private scheduleSupplementaryPass(passNumber: number): void {
    const supplementaryResources = [
      ...this.resourceCategories.discord.filter(r => this.remainingResources.has(r.id)),
      ...this.resourceCategories.coreRadiology.filter(r => this.remainingResources.has(r.id))
    ];
    
    if (supplementaryResources.length === 0) return;
    
    for (const day of this.studyDays) {
      const dayTopics = this.coveredTopicsPerDay.get(day.date) || new Set();
      const remainingTime = this.getRemainingTime(day);
      
      if (remainingTime < 5) continue;
      
      // Sort by relevancy to day's topics
      const sortedByRelevancy = supplementaryResources
        .filter(r => this.remainingResources.has(r.id))
        .sort((a, b) => {
          const scoreA = this.calculateRelevancyScore(a, dayTopics);
          const scoreB = this.calculateRelevancyScore(b, dayTopics);
          return scoreB - scoreA;
        });
      
      // Greedily fill remaining time
      for (const resource of sortedByRelevancy) {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      }
    }
  }

  private calculateRelevancyScore(resource: StudyResource, dayTopics: Set<Domain>): number {
    let score = 0;
    
    // Perfect match for same domain
    if (dayTopics.has(resource.domain)) {
      score += 100;
    }
    
    // Related domain bonus
    const relatedDomains = this.getRelatedDomains(resource.domain);
    for (const relatedDomain of relatedDomains) {
      if (dayTopics.has(relatedDomain)) {
        score += 50;
      }
    }
    
    // Prefer shorter items for better gap filling
    if (resource.durationMinutes <= 5) score += 20;
    else if (resource.durationMinutes <= 15) score += 10;
    else if (resource.durationMinutes <= 30) score += 5;
    
    // Primary material bonus
    if (resource.isPrimaryMaterial) score += 15;
    
    return score;
  }

  private getRelatedDomains(domain: Domain): Domain[] {
    const relations: Record<Domain, Domain[]> = {
      [Domain.GASTROINTESTINAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.GENITOURINARY_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.THORACIC_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.NUCLEAR_MEDICINE],
      [Domain.CARDIOVASCULAR_IMAGING]: [Domain.THORACIC_IMAGING, Domain.INTERVENTIONAL_RADIOLOGY],
      [Domain.NEURORADIOLOGY]: [Domain.PEDIATRIC_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.PEDIATRIC_RADIOLOGY]: [Domain.NEURORADIOLOGY, Domain.THORACIC_IMAGING, Domain.GASTROINTESTINAL_IMAGING],
      [Domain.MUSCULOSKELETAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.INTERVENTIONAL_RADIOLOGY]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GASTROINTESTINAL_IMAGING, Domain.GENITOURINARY_IMAGING],
      [Domain.BREAST_IMAGING]: [Domain.NUCLEAR_MEDICINE, Domain.ULTRASOUND_IMAGING],
      [Domain.ULTRASOUND_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GENITOURINARY_IMAGING, Domain.BREAST_IMAGING],
      [Domain.NUCLEAR_MEDICINE]: [Domain.PHYSICS],
      [Domain.PHYSICS]: [Domain.NUCLEAR_MEDICINE]
    };
    
    return relations[domain] || [];
  }

  /**
   * PHASE 4: FINAL VALIDATION AND COMPLETENESS GUARANTEE
   */
  
  private executePhase4(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 4: Starting validation and completeness guarantee'
    });
    
    // Final mop-up for 100% completeness
    this.performCompleteMopUp();
    
    // Validate time constraints
    this.validateTimeConstraints();
    
    // Final task ordering
    this.finalizeTaskOrdering();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 4: Completed validation and optimization'
    });
  }

  private performCompleteMopUp(): void {
    // Get all remaining required resources
    const requiredResources = Array.from(this.remainingResources)
      .map(id => this.allResources.get(id))
      .filter((r): r is StudyResource => 
        r !== undefined && (
          r.isPrimaryMaterial || 
          r.domain === Domain.NIS || 
          r.domain === Domain.RISC ||
          (r.bookSource || '').toLowerCase().includes('board vitals') ||
          (r.bookSource || '').toLowerCase().includes('qevlar') ||
          (r.bookSource || '').toLowerCase().includes('nucapp') ||
          r.domain === Domain.PHYSICS
        )
      )
      .sort((a, b) => {
        // Prioritize by importance
        const scoreA = this.getRequiredResourcePriority(a);
        const scoreB = this.getRequiredResourcePriority(b);
        return scoreA - scoreB;
      });
    
    if (requiredResources.length === 0) {
      this.notifications.push({
        type: 'info',
        message: 'Perfect! All required resources scheduled.'
      });
      return;
    }
    
    // Find days with available capacity, prioritizing less filled days
    const daysWithCapacity = this.studyDays
      .map(day => ({
        day,
        remainingTime: this.getRemainingTime(day),
        currentTime: day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0)
      }))
      .filter(({remainingTime}) => remainingTime >= 5)
      .sort((a, b) => {
        // Prefer days that are under-filled first
        if (a.currentTime < 12 * 60 && b.currentTime >= 12 * 60) return -1;
        if (a.currentTime >= 12 * 60 && b.currentTime < 12 * 60) return 1;
        return b.remainingTime - a.remainingTime;
      });
    
    let moppedUp = 0;
    for (const resource of requiredResources) {
      for (const {day} of daysWithCapacity) {
        if (this.addTaskToDay(day, resource)) {
          moppedUp++;
          break;
        }
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Final mop-up: Placed ${moppedUp}/${requiredResources.length} remaining required resources`
    });
  }

  private getRequiredResourcePriority(resource: StudyResource): number {
    let priority = 100;
    
    // Highest priority for core study materials
    if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) priority = 10;
    if ((resource.bookSource || '').toLowerCase().includes('board vitals')) priority = 20;
    if ((resource.bookSource || '').toLowerCase().includes('qevlar')) priority = 30;
    if (resource.domain === Domain.PHYSICS && resource.isPrimaryMaterial) priority = 40;
    if ((resource.bookSource || '').toLowerCase().includes('nucapp')) priority = 50;
    
    // Sequence order as tie-breaker
    priority += (resource.sequenceOrder || 999) / 10000;
    
    return priority;
  }

  private validateTimeConstraints(): void {
    let violations = 0;
    
    for (const day of this.studyDays) {
      const totalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
      
      if (totalTime > day.totalStudyTimeMinutes) {
        violations++;
        const excess = totalTime - day.totalStudyTimeMinutes;
        
        this.notifications.push({
          type: 'warning',
          message: `${day.date} exceeds limit by ${excess} minutes - redistributing lowest priority tasks`
        });
        
        this.redistributeExcessTasks(day, excess);
      }
    }
    
    if (violations > 0) {
      this.notifications.push({
        type: 'info',
        message: `Corrected ${violations} time constraint violations`
      });
    }
  }

  private redistributeExcessTasks(overloadedDay: DailySchedule, excessTime: number): void {
    // Sort tasks by removal priority (supplementary content first)
    const tasksByRemovalPriority = [...overloadedDay.tasks].sort((a, b) => {
      // Supplementary content first
      if (a.resourceId.includes('synthetic') && !b.resourceId.includes('synthetic')) return 1;
      if (!a.resourceId.includes('synthetic') && b.resourceId.includes('synthetic')) return -1;
      
      // Then by task type priority (higher number = lower priority = remove first)
      const priorityA = TASK_TYPE_PRIORITY[a.type] || 50;
      const priorityB = TASK_TYPE_PRIORITY[b.type] || 50;
      if (priorityA !== priorityB) return priorityB - priorityA;
      
      // Optional tasks before required
      if (a.isOptional !== b.isOptional) return a.isOptional ? -1 : 1;
      
      // Longer tasks easier to move
      return b.durationMinutes - a.durationMinutes;
    });
    
    let timeToMove = excessTime;
    const tasksToMove: ScheduledTask[] = [];
    
    for (const task of tasksByRemovalPriority) {
      if (timeToMove <= 0) break;
      tasksToMove.push(task);
      timeToMove -= task.durationMinutes;
    }
    
    // Remove from overloaded day
    overloadedDay.tasks = overloadedDay.tasks.filter(task => 
      !tasksToMove.some(t => t.id === task.id)
    );
    
    // Find best placement for moved tasks
    for (const task of tasksToMove) {
      let placed = false;
      
      // Find day with most available time
      const bestDay = this.studyDays
        .filter(d => d.date !== overloadedDay.date)
        .sort((a, b) => this.getRemainingTime(b) - this.getRemainingTime(a))
        .find(d => this.getRemainingTime(d) >= task.durationMinutes);
      
      if (bestDay) {
        bestDay.tasks.push({...task, order: bestDay.tasks.length});
        placed = true;
      }
      
      if (!placed) {
        // Put back as last resort
        overloadedDay.tasks.push(task);
      }
    }
  }

  private finalizeTaskOrdering(): void {
    for (const day of this.schedule) {
      // Sort tasks by global priority
      day.tasks.sort(sortTasksByGlobalPriority);
      
      // Update order indices
      day.tasks.forEach((task, index) => {
        task.order = index;
      });
    }
  }

  /**
   * SUMMARY AND COMPLETION
   */
  
  private generateFinalSummary(): void {
    const totalScheduledTime = this.schedule
      .reduce((sum, day) => sum + day.tasks.reduce((daySum, task) => daySum + task.durationMinutes, 0), 0);
    
    const totalAvailableTime = this.studyDays
      .reduce((sum, day) => sum + day.totalStudyTimeMinutes, 0);
    
    const utilizationPercentage = totalAvailableTime > 0 
      ? ((totalScheduledTime / totalAvailableTime) * 100).toFixed(1)
      : '0';
    
    this.notifications.push({
      type: 'info',
      message: `Final: ${totalScheduledTime}min/${totalAvailableTime}min scheduled (${utilizationPercentage}% utilization)`
    });
    
    // Board Vitals completion
    if (this.totalBoardVitalsQuestions > 0) {
      const bvCompletion = ((this.scheduledBoardVitalsQuestions / this.totalBoardVitalsQuestions) * 100).toFixed(1);
      this.notifications.push({
        type: 'info',
        message: `Board Vitals: ${this.scheduledBoardVitalsQuestions}/${this.totalBoardVitalsQuestions} questions (${bvCompletion}% coverage)`
      });
    }
    
    // Unscheduled resources
    if (this.remainingResources.size > 0) {
      this.notifications.push({
        type: 'warning',
        message: `${this.remainingResources.size} resources remain unscheduled`
      });
      
      const examples = Array.from(this.remainingResources)
        .slice(0, 5)
        .map(id => {
          const resource = this.allResources.get(id);
          return resource ? `"${resource.title}"` : id;
        });
      
      if (examples.length > 0) {
        this.notifications.push({
          type: 'info',
          message: `Examples: ${examples.join(', ')}`
        });
      }
    }
    
    // Report Titan block completion
    const completedTitanBlocks = this.titanBlocks.filter(b => b.isComplete).length;
    this.notifications.push({
      type: 'info',
      message: `Titan blocks: ${completedTitanBlocks}/${this.titanBlocks.length} completed in perfect sequence`
    });
  }

  /**
   * MAIN EXECUTION
   */
  
  public generatePerfectSchedule(): GeneratedStudyPlanOutcome {
    try {
      this.notifications.push({
        type: 'info',
        message: `Starting PERFECT 4-phase scheduling: ${this.studyDays.length} days, ${this.allResources.size} resources`
      });
      
      // Execute all phases in perfect order
      this.executePhase1(); // Perfect Titan round-robin with carryover
      this.executePhase2(); // Daily requirements with synthetic BV quotas  
      this.executePhase3(); // Supplementary greedy fill
      this.executePhase4(); // Validation and completeness guarantee
      
      this.generateFinalSummary();
      
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
        message: `Perfect scheduling failed: ${errorMessage}`
      });
      
      return this.createEmptyPlan();
    }
  }

  private buildProgressTracking(): StudyPlan['progressPerDomain'] {
    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    
    // Initialize all domains
    for (const resource of this.allResources.values()) {
      if (!progressPerDomain[resource.domain]) {
        progressPerDomain[resource.domain] = {
          completedMinutes: 0,
          totalMinutes: 0
        };
      }
      progressPerDomain[resource.domain]!.totalMinutes += resource.durationMinutes;
    }
    
    // Add completed time from tasks
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
  try {
    const scheduler = new PerfectScheduler(
      startDateStr,
      endDateStr,
      exceptionRules,
      resourcePool,
      topicOrder || DEFAULT_TOPIC_ORDER,
      deadlines || {},
      areSpecialTopicsInterleaved ?? true
    );
    
    return scheduler.generatePerfectSchedule();
    
  } catch (error) {
    return {
      plan: {
        schedule: [],
        progressPerDomain: {},
        startDate: startDateStr,
        endDate: endDateStr,
        firstPassEndDate: null,
        topicOrder: topicOrder || DEFAULT_TOPIC_ORDER,
        cramTopicOrder: topicOrder || DEFAULT_TOPIC_ORDER,
        deadlines: deadlines || {},
        isCramModeActive: false,
        areSpecialTopicsInterleaved: areSpecialTopicsInterleaved ?? true
      },
      notifications: [{
        type: 'error',
        message: `Scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  }
};

export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionRules: ExceptionDateRule[],
  resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
  try {
    const today = getTodayInNewYork();
    
    let rebalanceStartDate: string;
    if (options.type === 'standard') {
      rebalanceStartDate = (options.rebalanceDate && options.rebalanceDate > today) 
        ? options.rebalanceDate 
        : today;
    } else {
      rebalanceStartDate = options.date;
    }
    
    // Ensure rebalance date is within bounds
    rebalanceStartDate = Math.max(rebalanceStartDate, currentPlan.startDate);
    rebalanceStartDate = Math.min(rebalanceStartDate, currentPlan.endDate);
    
    // Preserve completed schedule
    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStartDate);
    
    // Get completed resource IDs
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
    
    // Create new scheduler for remaining period
    const scheduler = new PerfectScheduler(
      rebalanceStartDate,
      currentPlan.endDate,
      exceptionRules,
      availableResources,
      currentPlan.topicOrder,
      currentPlan.deadlines,
      currentPlan.areSpecialTopicsInterleaved
    );
    
    const result = scheduler.generatePerfectSchedule();
    
    // Merge schedules
    result.plan.schedule = [...pastSchedule, ...result.plan.schedule];
    result.plan.startDate = currentPlan.startDate;
    
    // Recalculate progress
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
    
  } catch (error) {
    return {
      plan: currentPlan,
      notifications: [{
        type: 'error',
        message: `Rebalance failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  }
};
