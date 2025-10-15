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
 * Complete 4-Phase Scheduling Algorithm Implementation - FIXED VERSION
 * 
 * Phase 1: Primary Content Distribution (Round-Robin with Resource Prioritization)
 *   - Pass 1a: Titan Block Round-Robin (Titan video + Crack the Core + Case Companion + Qevlar)
 *   - Pass 1b: Huda Physics Block Round-Robin (Huda lectures + question bank + textbook)
 *   - Pass 1c: Nuclear Medicine Round-Robin (Titan + Crack the Core + War Machine + Cases + Questions)
 * 
 * Phase 2: Other Daily Requirements (Daily First-Fit with Priority)
 *   - Pass 2a: NIS and RISC (First-Fit with saturation)
 *   - Pass 2b: Board Vitals questions with intelligent suggestions and full pool coverage
 *   - Pass 2c: Physics content (Titan Route First-Fit with saturation)
 * 
 * Phase 3: Supplementary Content (STRICT: Only after ALL Phase 1&2 complete globally)
 *   - Pass 3a: Discord lectures with relevancy matching
 *   - Pass 3b: Core Radiology textbook with relevancy matching
 * 
 * Phase 4: Validation and Optimization (Iterative Constraint Checking)
 *   - Constraint checking for 14-hour daily maximum
 *   - Resource pairing validation with corrective reallocation
 *   - Iterative correction with task reallocation
 */

interface TopicBlock {
  id: string;
  anchorResource: StudyResource;
  pairedResources: StudyResource[];
  totalMinutes: number;
  domain: Domain;
  priority: number;
  blockType: 'titan' | 'huda' | 'nuclear' | 'other';
}

interface BoardVitalsSuggestion {
  subjects: Domain[];
  questionCount: number;
  availableTime: number;
  totalQuestionsPool: number;
  targetMinutes: number;
}

interface RelevancyScore {
  resourceId: string;
  score: number;
  matchedTopics: Domain[];
}

interface DailyBoardVitalsAllocation {
  date: string;
  targetQuestions: number;
  targetMinutes: number;
  subjects: Domain[];
}

class StrictFourPhaseScheduler {
  private allResources: Map<string, StudyResource>;
  private remainingResources: Set<string>;
  private schedule: DailySchedule[];
  private studyDays: DailySchedule[];
  private notifications: GeneratedStudyPlanOutcome['notifications'] = [];
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskCounter = 0;
  
  // Phase tracking with strict enforcement
  private coveredTopicsPerDay: Map<string, Set<Domain>> = new Map();
  private phase1Resources: Set<string> = new Set();
  private phase2Resources: Set<string> = new Set();
  private phase3Resources: Set<string> = new Set();
  private allRequiredResourcesScheduled = false;
  
  // Resource categorization with enhanced tracking
  private titanResources: StudyResource[] = [];
  private hudaResources: StudyResource[] = [];
  private nuclearMedicineResources: StudyResource[] = [];
  private nisRiscResources: StudyResource[] = [];
  private boardVitalsResources: StudyResource[] = [];
  private physicsResources: StudyResource[] = [];
  private qevlarResources: StudyResource[] = [];
  private nucAppResources: StudyResource[] = [];
  private discordResources: StudyResource[] = [];
  private coreRadiologyResources: StudyResource[] = [];
  private otherResources: StudyResource[] = [];
  
  // Board Vitals enhanced tracking
  private totalBoardVitalsQuestions: number = 0;
  private scheduledBoardVitalsQuestions: number = 0;
  private dailyBoardVitalsAllocations: DailyBoardVitalsAllocation[] = [];

  constructor(
    startDateStr: string,
    endDateStr: string,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[],
    topicOrder: Domain[],
    deadlines: DeadlineSettings,
    areSpecialTopicsInterleaved: boolean
  ) {
    // Initialize core data structures
    const chunkedResources = this.chunkLargeResources(resourcePool);
    this.allResources = new Map(chunkedResources.map(r => [r.id, r]));
    this.remainingResources = new Set(chunkedResources.map(r => r.id));
    this.schedule = this.createDaySchedules(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay);
    this.topicOrder = topicOrder || DEFAULT_TOPIC_ORDER;
    this.deadlines = deadlines || {};
    this.areSpecialTopicsInterleaved = areSpecialTopicsInterleaved ?? true;
    
    // Initialize covered topics tracking
    this.studyDays.forEach(day => {
      this.coveredTopicsPerDay.set(day.date, new Set<Domain>());
    });
    
    // Categorize all resources for phase-specific processing
    this.categorizeResources();
    
    // Pre-calculate Board Vitals daily allocations
    this.calculateBoardVitalsAllocations();
  }

  /**
   * RESOURCE PREPARATION METHODS
   */
  
  private chunkLargeResources(resources: StudyResource[]): StudyResource[] {
    const chunkedResources: StudyResource[] = [];
    
    for (const resource of resources) {
      if (resource.isSplittable && resource.durationMinutes > MIN_DURATION_for_SPLIT_PART * 1.5) {
        const numberOfParts = Math.ceil(resource.durationMinutes / MIN_DURATION_for_SPLIT_PART);
        const minutesPerPart = Math.round(resource.durationMinutes / numberOfParts);
        
        for (let partIndex = 0; partIndex < numberOfParts; partIndex++) {
          const partResource: StudyResource = {
            ...resource,
            id: `${resource.id}_part_${partIndex + 1}`,
            title: `${resource.title} (Part ${partIndex + 1}/${numberOfParts})`,
            durationMinutes: partIndex === numberOfParts - 1 
              ? resource.durationMinutes - (minutesPerPart * partIndex) 
              : minutesPerPart,
            isSplittable: false,
            pairedResourceIds: []
          };
          chunkedResources.push(partResource);
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
        totalStudyTimeMinutes: exceptionRule?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS,
        isRestDay: exceptionRule?.isRestDayOverride ?? false,
        isManuallyModified: !!exceptionRule
      });
    }
    
    return daySchedules;
  }

  private categorizeResources(): void {
    for (const resource of this.allResources.values()) {
      const lowerTitle = (resource.title || '').toLowerCase();
      const lowerVideoSource = (resource.videoSource || '').toLowerCase();
      const lowerBookSource = (resource.bookSource || '').toLowerCase();
      
      // Titan Radiology resources (videos, Crack the Core, Case Companion, Qevlar)
      if (lowerVideoSource.includes('titan radiology') || 
          lowerBookSource.includes('crack the core') ||
          lowerBookSource.includes('case companion')) {
        this.titanResources.push(resource);
        this.phase1Resources.add(resource.id);
      }
      
      // QEVLAR resources (separate tracking for pairing)
      else if (lowerBookSource.includes('qevlar')) {
        this.qevlarResources.push(resource);
        this.phase1Resources.add(resource.id);
      }
      
      // Huda Physics resources
      else if (lowerVideoSource.includes('huda physics') || 
               lowerBookSource.includes('huda physics') ||
               (resource.domain === Domain.PHYSICS && lowerBookSource.includes('huda'))) {
        this.hudaResources.push(resource);
        this.phase1Resources.add(resource.id);
      }
      
      // Nuclear Medicine resources (including War Machine, NucApp)
      else if (resource.domain === Domain.NUCLEAR_MEDICINE) {
        this.nuclearMedicineResources.push(resource);
        if (lowerBookSource.includes('nucapp')) {
          this.nucAppResources.push(resource);
        }
        this.phase1Resources.add(resource.id);
      }
      
      // NIS and RISC resources
      else if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) {
        this.nisRiscResources.push(resource);
        this.phase2Resources.add(resource.id);
      }
      
      // Board Vitals resources
      else if (lowerBookSource.includes('board vitals')) {
        this.boardVitalsResources.push(resource);
        this.phase2Resources.add(resource.id);
        this.totalBoardVitalsQuestions += (resource.questionCount || 0);
      }
      
      // Physics resources (non-Huda, including Titan Physics)
      else if (resource.domain === Domain.PHYSICS) {
        this.physicsResources.push(resource);
        this.phase2Resources.add(resource.id);
      }
      
      // Discord resources
      else if (lowerVideoSource.includes('discord')) {
        this.discordResources.push(resource);
        this.phase3Resources.add(resource.id);
      }
      
      // Core Radiology textbook resources
      else if (lowerBookSource.includes('core radiology') || lowerTitle.includes('core radiology')) {
        this.coreRadiologyResources.push(resource);
        this.phase3Resources.add(resource.id);
      }
      
      // Other resources - categorize based on priority
      else {
        this.otherResources.push(resource);
        if (resource.isPrimaryMaterial || !resource.isOptional) {
          this.phase2Resources.add(resource.id);
        } else {
          this.phase3Resources.add(resource.id);
        }
      }
    }
  }

  private calculateBoardVitalsAllocations(): void {
    if (this.totalBoardVitalsQuestions === 0) return;
    
    const questionsPerMinute = 0.5; // 2 minutes per question average
    let remainingQuestions = this.totalBoardVitalsQuestions;
    
    for (let i = 0; i < this.studyDays.length; i++) {
      const day = this.studyDays[i];
      const remainingDays = this.studyDays.length - i;
      
      // Calculate target questions for this day
      const avgQuestionsPerDay = Math.ceil(remainingQuestions / remainingDays);
      const maxQuestionsByTime = Math.floor(day.totalStudyTimeMinutes * 0.3 * questionsPerMinute); // Up to 30% of day for BV
      
      const targetQuestions = Math.min(avgQuestionsPerDay, maxQuestionsByTime, remainingQuestions);
      const targetMinutes = Math.ceil(targetQuestions / questionsPerMinute);
      
      // Get subjects covered up to this day (for suggestion purposes)
      const coveredSubjects: Domain[] = [];
      for (let j = 0; j <= i; j++) {
        const dayTopics = this.coveredTopicsPerDay.get(this.studyDays[j].date) || new Set();
        dayTopics.forEach(topic => {
          if (!coveredSubjects.includes(topic) && 
              ![Domain.NIS, Domain.RISC, Domain.HIGH_YIELD, Domain.MIXED_REVIEW, 
                Domain.WEAK_AREA_REVIEW, Domain.QUESTION_BANK_CATCHUP, Domain.FINAL_REVIEW, 
                Domain.LIGHT_REVIEW].includes(topic)) {
            coveredSubjects.push(topic);
          }
        });
      }
      
      this.dailyBoardVitalsAllocations.push({
        date: day.date,
        targetQuestions: targetQuestions,
        targetMinutes: targetMinutes,
        subjects: coveredSubjects.length > 0 ? coveredSubjects : [Domain.PHYSICS, Domain.NUCLEAR_MEDICINE] // Default subjects
      });
      
      remainingQuestions -= targetQuestions;
    }
  }

  /**
   * UTILITY METHODS
   */
  
  private getRemainingTimeInDay(day: DailySchedule): number {
    const usedTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    return day.totalStudyTimeMinutes - usedTime;
  }

  private createScheduledTask(resource: StudyResource, orderIndex: number): ScheduledTask {
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
    if (this.getRemainingTimeInDay(day) >= resource.durationMinutes) {
      const task = this.createScheduledTask(resource, day.tasks.length);
      day.tasks.push(task);
      this.remainingResources.delete(resource.id);
      this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
      
      // Track Board Vitals questions scheduled
      if (resource.questionCount && resource.bookSource?.toLowerCase().includes('board vitals')) {
        this.scheduledBoardVitalsQuestions += resource.questionCount;
      }
      
      return true;
    }
    return false;
  }

  /**
   * ENHANCED TOPIC BLOCK BUILDING METHODS
   */
  
  private buildTopicBlock(anchorResource: StudyResource, blockType: 'titan' | 'huda' | 'nuclear'): TopicBlock {
    const visited = new Set<string>([anchorResource.id]);
    const pairedResources: StudyResource[] = [];
    
    // Process explicitly paired resources first
    const processingQueue = [...(anchorResource.pairedResourceIds || [])];
    while (processingQueue.length > 0) {
      const resourceId = processingQueue.shift()!;
      if (visited.has(resourceId)) continue;
      
      const resource = this.allResources.get(resourceId);
      if (!resource || !this.remainingResources.has(resourceId)) continue;
      
      visited.add(resourceId);
      pairedResources.push(resource);
      
      if (resource.pairedResourceIds) {
        processingQueue.push(...resource.pairedResourceIds.filter(id => !visited.has(id)));
      }
    }
    
    // Find topic and context-related resources based on block type
    const relatedResources = this.findRelatedResources(anchorResource, blockType, visited);
    pairedResources.push(...relatedResources);
    
    // For Titan blocks, explicitly look for QEVLAR pairings
    if (blockType === 'titan') {
      const qevlarMatches = this.qevlarResources.filter(qr => 
        !visited.has(qr.id) && 
        this.remainingResources.has(qr.id) &&
        this.hasMatchingTopicKeywords(anchorResource.title, qr.title)
      );
      pairedResources.push(...qevlarMatches);
      qevlarMatches.forEach(qr => visited.add(qr.id));
    }
    
    // For Nuclear blocks, include NucApp resources
    if (blockType === 'nuclear') {
      const nucAppMatches = this.nucAppResources.filter(nr => 
        !visited.has(nr.id) && 
        this.remainingResources.has(nr.id) &&
        (nr.domain === anchorResource.domain || this.hasMatchingTopicKeywords(anchorResource.title, nr.title))
      );
      pairedResources.push(...nucAppMatches);
      nucAppMatches.forEach(nr => visited.add(nr.id));
    }
    
    const totalMinutes = [anchorResource, ...pairedResources]
      .reduce((sum, resource) => sum + resource.durationMinutes, 0);
    
    const priority = this.calculateBlockPriority(anchorResource, blockType);
    
    return {
      id: `block_${blockType}_${anchorResource.id}`,
      anchorResource,
      pairedResources,
      totalMinutes,
      domain: anchorResource.domain,
      priority,
      blockType
    };
  }

  private findRelatedResources(anchorResource: StudyResource, blockType: string, visited: Set<string>): StudyResource[] {
    const relatedResources: StudyResource[] = [];
    let searchPool: StudyResource[] = [];
    
    // Determine search pool based on block type
    switch (blockType) {
      case 'titan':
        searchPool = [...this.titanResources];
        break;
      case 'huda':
        searchPool = [...this.hudaResources];
        break;
      case 'nuclear':
        searchPool = [...this.nuclearMedicineResources];
        break;
    }
    
    for (const candidate of searchPool) {
      if (visited.has(candidate.id) || !this.remainingResources.has(candidate.id)) continue;
      if (candidate.domain !== anchorResource.domain) continue;
      
      // Chapter number matching
      if (anchorResource.chapterNumber && candidate.chapterNumber && 
          anchorResource.chapterNumber === candidate.chapterNumber) {
        relatedResources.push(candidate);
        visited.add(candidate.id);
        continue;
      }
      
      // Topic keyword matching
      if (this.hasMatchingTopicKeywords(anchorResource.title, candidate.title)) {
        relatedResources.push(candidate);
        visited.add(candidate.id);
      }
    }
    
    return relatedResources;
  }

  private hasMatchingTopicKeywords(title1: string, title2: string): boolean {
    if (!title1 || !title2) return false;
    
    const normalizedTitle1 = title1.toLowerCase();
    const normalizedTitle2 = title2.toLowerCase();
    
    const topicKeywords = [
      'pancreas', 'liver', 'renal', 'kidney', 'adrenal', 'spleen', 'biliary', 'gallbladder', 
      'gi', 'gastrointestinal', 'bowel', 'colon', 'small bowel',
      'thorax', 'chest', 'lung', 'pulmonary', 'mediastinum', 'pleura', 'airways',
      'thyroid', 'parathyroid', 'neck',
      'msk', 'musculoskeletal', 'bone', 'joint', 'soft tissue', 'spine', 'extremity',
      'neuro', 'brain', 'spine', 'spinal', 'head and neck', 'neurological',
      'peds', 'pediatric', 'paediatric', 'infant', 'child', 'children',
      'cardiac', 'heart', 'coronary', 'cardiovascular', 'vascular',
      'breast', 'mammography', 'mammo',
      'interventional', 'ir', 'vascular', 'angiography',
      'ultrasound', 'us', 'doppler', 'echocardiography',
      'nuclear', 'spect', 'pet', 'scintigraphy',
      'physics', 'ct', 'mr', 'mri', 'dose', 'artifact', 'radiation', 'contrast'
    ];
    
    return topicKeywords.some(keyword => 
      normalizedTitle1.includes(keyword) && normalizedTitle2.includes(keyword)
    );
  }

  private calculateBlockPriority(anchorResource: StudyResource, blockType: string): number {
    let priority = 0;
    
    // Block type priority
    switch (blockType) {
      case 'titan': priority += 100; break;
      case 'huda': priority += 90; break;
      case 'nuclear': priority += 80; break;
      default: priority += 50; break;
    }
    
    // Resource type priority
    priority += TASK_TYPE_PRIORITY[anchorResource.type] || 50;
    
    // Sequence order (lower sequence = higher priority)
    priority += (1000 - (anchorResource.sequenceOrder || 500));
    
    // Chapter order for systematic progression
    if (anchorResource.chapterNumber) {
      priority += (100 - anchorResource.chapterNumber);
    }
    
    return priority;
  }

  /**
   * PHASE 1: PRIMARY CONTENT DISTRIBUTION (ROUND-ROBIN WITH ENHANCED PAIRING)
   */
  
  private executePhase1(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Starting primary content distribution with strict round-robin and pairing'
    });
    
    // Pass 1a: Titan Block Round-Robin
    this.executeTitanBlockRoundRobin();
    
    // Pass 1b: Huda Physics Block Round-Robin  
    this.executeHudaPhysicsBlockRoundRobin();
    
    // Pass 1c: Nuclear Medicine Round-Robin
    this.executeNuclearMedicineRoundRobin();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Primary content distribution completed'
    });
  }

  private executeTitanBlockRoundRobin(): void {
    // Build Titan blocks (Titan video + Crack the Core + Case Companion + Qevlar)
    const titanAnchors = this.titanResources
      .filter(resource => 
        this.remainingResources.has(resource.id) && 
        (resource.type === ResourceType.VIDEO_LECTURE || resource.type === ResourceType.HIGH_YIELD_VIDEO) &&
        (resource.videoSource?.toLowerCase().includes('titan radiology'))
      )
      .sort((a, b) => {
        // Sort by chapter number first, then sequence order
        const chapterDiff = (a.chapterNumber || 999) - (b.chapterNumber || 999);
        if (chapterDiff !== 0) return chapterDiff;
        return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
      });
    
    const titanBlocks = titanAnchors.map(anchor => this.buildTopicBlock(anchor, 'titan'));
    
    // Sort blocks by priority
    titanBlocks.sort((a, b) => b.priority - a.priority);
    
    // Round-robin distribution with enhanced pairing preservation
    this.scheduleBlocksRoundRobinWithPairing(titanBlocks, 0);
    
    this.notifications.push({
      type: 'info', 
      message: `Pass 1a: Scheduled ${titanBlocks.length} Titan blocks using round-robin with pairing preservation`
    });
  }

  private executeHudaPhysicsBlockRoundRobin(): void {
    // Build Huda Physics blocks (lectures + question bank + textbook)
    const hudaAnchors = this.hudaResources
      .filter(resource => 
        this.remainingResources.has(resource.id) && 
        (resource.type === ResourceType.VIDEO_LECTURE || resource.type === ResourceType.HIGH_YIELD_VIDEO)
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    const hudaBlocks = hudaAnchors.map(anchor => this.buildTopicBlock(anchor, 'huda'));
    
    // Sort blocks by priority
    hudaBlocks.sort((a, b) => b.priority - a.priority);
    
    // Resume round-robin from where Titan blocks left off
    const startingDayIndex = this.getNextAvailableDayIndex();
    this.scheduleBlocksRoundRobinWithPairing(hudaBlocks, startingDayIndex);
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1b: Scheduled ${hudaBlocks.length} Huda Physics blocks using round-robin with pairing preservation`
    });
  }

  private executeNuclearMedicineRoundRobin(): void {
    // Build Nuclear Medicine blocks (Titan + Crack the Core + War Machine + Cases + Questions + NucApp)
    const nuclearAnchors = this.nuclearMedicineResources
      .filter(resource => 
        this.remainingResources.has(resource.id) && 
        (resource.type === ResourceType.VIDEO_LECTURE || resource.type === ResourceType.HIGH_YIELD_VIDEO)
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    const nuclearBlocks = nuclearAnchors.map(anchor => this.buildTopicBlock(anchor, 'nuclear'));
    
    // Sort blocks by priority  
    nuclearBlocks.sort((a, b) => b.priority - a.priority);
    
    // Continue round-robin distribution
    const startingDayIndex = this.getNextAvailableDayIndex();
    this.scheduleBlocksRoundRobinWithPairing(nuclearBlocks, startingDayIndex);
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1c: Scheduled ${nuclearBlocks.length} Nuclear Medicine blocks using round-robin with pairing preservation`
    });
  }

  private scheduleBlocksRoundRobinWithPairing(blocks: TopicBlock[], startDayIndex: number): number {
    let currentDayIndex = startDayIndex;
    
    for (const block of blocks) {
      const allBlockResources = [block.anchorResource, ...block.pairedResources]
        .filter(resource => this.remainingResources.has(resource.id));
      
      if (allBlockResources.length === 0) continue;
      
      // Try to fit entire block on one day first
      let blockScheduled = false;
      
      for (let dayOffset = 0; dayOffset < this.studyDays.length && !blockScheduled; dayOffset++) {
        const dayIndex = (currentDayIndex + dayOffset) % this.studyDays.length;
        const day = this.studyDays[dayIndex];
        
        const totalBlockTime = allBlockResources.reduce((sum, r) => sum + r.durationMinutes, 0);
        
        if (this.getRemainingTimeInDay(day) >= totalBlockTime) {
          // Schedule entire block on this day
          for (const resource of allBlockResources) {
            this.addTaskToDay(day, resource);
          }
          currentDayIndex = (dayIndex + 1) % this.studyDays.length;
          blockScheduled = true;
          break;
        }
      }
      
      // If block doesn't fit entirely, use enhanced carryover with pairing preservation
      if (!blockScheduled) {
        currentDayIndex = this.scheduleBlockWithCarryover(allBlockResources, currentDayIndex);
      }
    }
    
    return currentDayIndex;
  }

  private scheduleBlockWithCarryover(blockResources: StudyResource[], startDayIndex: number): number {
    let currentDayIndex = startDayIndex;
    let resourceIndex = 0;
    
    while (resourceIndex < blockResources.length) {
      const dayIndex = currentDayIndex % this.studyDays.length;
      const day = this.studyDays[dayIndex];
      const remainingTime = this.getRemainingTimeInDay(day);
      
      // Find how many consecutive resources from the block can fit in remaining time
      let resourcesForThisDay: StudyResource[] = [];
      let totalTimeForDay = 0;
      
      for (let i = resourceIndex; i < blockResources.length; i++) {
        const resource = blockResources[i];
        if (totalTimeForDay + resource.durationMinutes <= remainingTime) {
          resourcesForThisDay.push(resource);
          totalTimeForDay += resource.durationMinutes;
        } else {
          break; // Stop when we can't fit more
        }
      }
      
      // Schedule the resources that fit
      for (const resource of resourcesForThisDay) {
        this.addTaskToDay(day, resource);
      }
      
      resourceIndex += resourcesForThisDay.length;
      currentDayIndex++;
      
      // Prevent infinite loop
      if (resourcesForThisDay.length === 0) {
        // If no resources could be scheduled, try individual placement
        const resource = blockResources[resourceIndex];
        let placed = false;
        
        for (let dayOffset = 0; dayOffset < this.studyDays.length; dayOffset++) {
          const tryDayIndex = (currentDayIndex + dayOffset) % this.studyDays.length;
          const tryDay = this.studyDays[tryDayIndex];
          
          if (this.addTaskToDay(tryDay, resource)) {
            resourceIndex++;
            currentDayIndex = tryDayIndex + 1;
            placed = true;
            break;
          }
        }
        
        if (!placed) {
          this.notifications.push({
            type: 'warning',
            message: `Could not schedule block resource: "${resource.title}" (${resource.durationMinutes} min) - insufficient time available`
          });
          resourceIndex++;
        }
      }
    }
    
    return currentDayIndex % this.studyDays.length;
  }

  private getNextAvailableDayIndex(): number {
    // Find the day with the most recent task scheduled to continue round-robin from there
    let lastUsedDay = 0;
    let maxTasks = -1;
    
    for (let i = 0; i < this.studyDays.length; i++) {
      const taskCount = this.studyDays[i].tasks.length;
      if (taskCount > maxTasks) {
        maxTasks = taskCount;
        lastUsedDay = i;
      }
    }
    
    return (lastUsedDay + 1) % this.studyDays.length;
  }

  /**
   * PHASE 2: ENHANCED DAILY REQUIREMENTS WITH SATURATION
   */
  
  private executePhase2(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Starting enhanced daily requirements with full saturation'
    });
    
    // Pass 2a: NIS and RISC with saturation
    this.scheduleNisRiscWithSaturation();
    
    // Pass 2b: Board Vitals with enhanced allocation system
    this.scheduleBoardVitalsEnhanced();
    
    // Pass 2c: Physics content with saturation
    this.schedulePhysicsWithSaturation();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Enhanced daily requirements completed'
    });
  }

  private scheduleNisRiscWithSaturation(): void {
    const nisRiscResources = this.nisRiscResources
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    this.scheduleResourcesWithSaturation(nisRiscResources, 'NIS and RISC');
    
    this.notifications.push({
      type: 'info',
      message: `Pass 2a: Scheduled ${nisRiscResources.filter(r => !this.remainingResources.has(r.id)).length}/${nisRiscResources.length} NIS and RISC resources with saturation`
    });
  }

  private scheduleBoardVitalsEnhanced(): void {
    // Process each day with its pre-calculated allocation
    for (let dayIndex = 0; dayIndex < this.studyDays.length; dayIndex++) {
      const day = this.studyDays[dayIndex];
      const allocation = this.dailyBoardVitalsAllocations[dayIndex];
      
      if (!allocation || allocation.targetQuestions === 0) continue;
      
      // Find suitable Board Vitals resources for this day
      const availableBoardVitals = this.boardVitalsResources
        .filter(resource => this.remainingResources.has(resource.id))
        .sort((a, b) => {
          // Prioritize resources matching covered subjects
          const aMatchesSubjects = allocation.subjects.some(subject => 
            resource.title.toLowerCase().includes(subject.toLowerCase()) ||
            resource.domain === subject
          );
          const bMatchesSubjects = allocation.subjects.some(subject => 
            resource.title.toLowerCase().includes(subject.toLowerCase()) ||
            resource.domain === subject
          );
          
          if (aMatchesSubjects && !bMatchesSubjects) return -1;
          if (!aMatchesSubjects && bMatchesSubjects) return 1;
          
          return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
        });
      
      // Schedule Board Vitals resources up to the target
      let scheduledQuestions = 0;
      let scheduledMinutes = 0;
      
      for (const resource of availableBoardVitals) {
        if (scheduledMinutes >= allocation.targetMinutes) break;
        
        const remainingTimeInDay = this.getRemainingTimeInDay(day);
        if (remainingTimeInDay < resource.durationMinutes) continue;
        
        if (this.addTaskToDay(day, resource)) {
          scheduledQuestions += (resource.questionCount || 0);
          scheduledMinutes += resource.durationMinutes;
        }
      }
      
      // Generate suggestion message
      if (allocation.subjects.length > 0) {
        const suggestionMessage = `Day ${day.date}: Board Vitals allocated ${scheduledQuestions}/${allocation.targetQuestions} questions (${scheduledMinutes}/${allocation.targetMinutes} min) covering: ${allocation.subjects.join(', ')}`;
        
        this.notifications.push({
          type: 'info',
          message: suggestionMessage
        });
      }
    }
    
    const remainingBoardVitals = this.boardVitalsResources.filter(r => this.remainingResources.has(r.id));
    this.notifications.push({
      type: 'info',
      message: `Pass 2b: Board Vitals enhanced scheduling completed. Remaining: ${remainingBoardVitals.length} resources`
    });
  }

  private schedulePhysicsWithSaturation(): void {
    const physicsResources = this.physicsResources
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    this.scheduleResourcesWithSaturation(physicsResources, 'Physics (Titan Route)');
    
    this.notifications.push({
      type: 'info',
      message: `Pass 2c: Scheduled ${physicsResources.filter(r => !this.remainingResources.has(r.id)).length}/${physicsResources.length} Physics resources with saturation`
    });
  }

  private scheduleResourcesWithSaturation(resources: StudyResource[], resourceTypeName: string): void {
    let scheduledCount = 0;
    const bufferMinutes = 15; // Leave small buffer before hitting daily limit
    
    for (const resource of resources) {
      if (!this.remainingResources.has(resource.id)) continue;
      
      let resourceScheduled = false;
      
      // Try to schedule on each day, prioritizing days with more available time
      const sortedDays = [...this.studyDays].sort((a, b) => 
        this.getRemainingTimeInDay(b) - this.getRemainingTimeInDay(a)
      );
      
      for (const day of sortedDays) {
        const remainingTime = this.getRemainingTimeInDay(day);
        
        // Only schedule if we have sufficient time including buffer
        if (remainingTime >= resource.durationMinutes + bufferMinutes) {
          if (this.addTaskToDay(day, resource)) {
            resourceScheduled = true;
            scheduledCount++;
            break;
          }
        }
      }
      
      if (!resourceScheduled) {
        // Try without buffer as last resort
        for (const day of sortedDays) {
          if (this.addTaskToDay(day, resource)) {
            resourceScheduled = true;
            scheduledCount++;
            break;
          }
        }
      }
      
      if (!resourceScheduled) {
        this.notifications.push({
          type: 'warning',
          message: `Could not schedule ${resourceTypeName} resource: "${resource.title}" (${resource.durationMinutes} min) - insufficient time available`
        });
      }
    }
  }

  /**
   * STRICT PHASE 3: SUPPLEMENTARY CONTENT (GLOBAL GATING)
   */
  
  private executePhase3(): void {
    // STRICT CHECK: Only proceed if ALL Phase 1 and 2 resources are scheduled
    const unscheduledPhase1And2 = Array.from(this.remainingResources)
      .filter(resourceId => 
        this.phase1Resources.has(resourceId) || this.phase2Resources.has(resourceId)
      );
    
    if (unscheduledPhase1And2.length > 0) {
      this.notifications.push({
        type: 'info',
        message: `Phase 3: BLOCKED - ${unscheduledPhase1And2.length} Phase 1&2 resources remain unscheduled. Supplementary content deferred.`
      });
      
      // Log some examples of what's blocking Phase 3
      const examples = unscheduledPhase1And2.slice(0, 3).map(id => {
        const resource = this.allResources.get(id);
        return resource ? `"${resource.title}" (${resource.durationMinutes}min)` : id;
      });
      
      this.notifications.push({
        type: 'info',
        message: `Examples of blocking resources: ${examples.join(', ')}${unscheduledPhase1And2.length > 3 ? ` and ${unscheduledPhase1And2.length - 3} more` : ''}`
      });
      
      this.allRequiredResourcesScheduled = false;
      return;
    }
    
    this.allRequiredResourcesScheduled = true;
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: UNLOCKED - All Phase 1&2 resources completed. Starting supplementary content scheduling.'
    });
    
    // Pass 3a: Discord lectures with relevancy matching
    this.scheduleDiscordWithRelevancy();
    
    // Pass 3b: Core Radiology textbook with relevancy matching
    this.scheduleCoreRadiologyWithRelevancy();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Supplementary content scheduling completed'
    });
  }

  private scheduleDiscordWithRelevancy(): void {
    const discordResources = this.discordResources
      .filter(resource => this.remainingResources.has(resource.id));
    
    this.scheduleSupplementaryContentWithRelevancy(discordResources, 'Discord lectures');
    
    this.notifications.push({
      type: 'info',
      message: `Pass 3a: Scheduled ${discordResources.filter(r => !this.remainingResources.has(r.id)).length}/${discordResources.length} Discord lectures based on topic relevancy`
    });
  }

  private scheduleCoreRadiologyWithRelevancy(): void {
    const coreRadiologyResources = this.coreRadiologyResources
      .filter(resource => this.remainingResources.has(resource.id));
    
    this.scheduleSupplementaryContentWithRelevancy(coreRadiologyResources, 'Core Radiology textbook');
    
    this.notifications.push({
      type: 'info',
      message: `Pass 3b: Scheduled ${coreRadiologyResources.filter(r => !this.remainingResources.has(r.id)).length}/${coreRadiologyResources.length} Core Radiology topics based on topic relevancy`
    });
  }

  private scheduleSupplementaryContentWithRelevancy(resources: StudyResource[], contentType: string): void {
    // For each day, calculate relevancy scores and greedily fill remaining time
    for (const day of this.studyDays) {
      const dayTopics = this.coveredTopicsPerDay.get(day.date) || new Set();
      
      // Calculate relevancy scores for remaining resources
      const relevancyScores: RelevancyScore[] = resources
        .filter(resource => this.remainingResources.has(resource.id))
        .map(resource => ({
          resourceId: resource.id,
          score: this.calculateRelevancyScore(resource, dayTopics),
          matchedTopics: Array.from(dayTopics).filter(topic => topic === resource.domain)
        }));
      
      // Sort by relevancy score (highest first)
      relevancyScores.sort((a, b) => b.score - a.score);
      
      // Greedily fill remaining time with most relevant resources
      const bufferMinutes = 10; // Small buffer for supplementary content
      
      for (const relevancyScore of relevancyScores) {
        const resource = this.allResources.get(relevancyScore.resourceId);
        if (resource && this.remainingResources.has(resource.id)) {
          const remainingTime = this.getRemainingTimeInDay(day);
          
          if (remainingTime >= resource.durationMinutes + bufferMinutes) {
            this.addTaskToDay(day, resource);
          } else {
            // Try without buffer for small resources
            if (resource.durationMinutes <= 10 && remainingTime >= resource.durationMinutes) {
              this.addTaskToDay(day, resource);
            } else {
              break; // No more time available in this day
            }
          }
        }
      }
    }
  }

  private calculateRelevancyScore(resource: StudyResource, dayTopics: Set<Domain>): number {
    let score = 0;
    
    // High relevancy if resource domain matches covered topics
    if (dayTopics.has(resource.domain)) {
      score += 100;
    }
    
    // Medium relevancy for related domains
    const relatedDomains = this.getRelatedDomains(resource.domain);
    for (const relatedDomain of relatedDomains) {
      if (dayTopics.has(relatedDomain)) {
        score += 50;
      }
    }
    
    // Bonus for primary material
    if (resource.isPrimaryMaterial) {
      score += 25;
    }
    
    // Bonus for higher priority resources
    if (resource.schedulingPriority === 'high') {
      score += 20;
    } else if (resource.schedulingPriority === 'medium') {
      score += 10;
    }
    
    // Penalty for very long resources to encourage variety
    if (resource.durationMinutes > 120) {
      score -= 10;
    }
    
    // Bonus for shorter resources that fit gaps better
    if (resource.durationMinutes <= 5) {
      score += 15;
    } else if (resource.durationMinutes <= 15) {
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
      [Domain.PEDIATRIC_RADIOLOGY]: [Domain.NEURORADIOLOGY, Domain.THORACIC_IMAGING, Domain.GASTROINTESTINAL_IMAGING],
      [Domain.MUSCULOSKELETAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY],
      [Domain.INTERVENTIONAL_RADIOLOGY]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GASTROINTESTINAL_IMAGING, Domain.GENITOURINARY_IMAGING],
      [Domain.BREAST_IMAGING]: [],
      [Domain.ULTRASOUND_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GENITOURINARY_IMAGING],
      [Domain.NUCLEAR_MEDICINE]: [Domain.PHYSICS],
      [Domain.PHYSICS]: [Domain.NUCLEAR_MEDICINE]
    };
    
    return relationMap[domain] || [];
  }

  /**
   * PHASE 4: ENHANCED VALIDATION WITH CORRECTIVE ACTIONS
   */
  
  private executePhase4(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 4: Starting enhanced validation and optimization'
    });
    
    let iterationCount = 0;
    const maxIterations = 5;
    let violationsFound = true;
    
    while (violationsFound && iterationCount < maxIterations) {
      iterationCount++;
      violationsFound = false;
      
      // Pass 4a: Check and correct time constraints
      if (this.validateAndCorrectTimeConstraints()) {
        violationsFound = true;
      }
      
      // Pass 4b: Validate and correct resource pairings
      if (this.validateAndCorrectResourcePairings()) {
        violationsFound = true;
      }
      
      // Pass 4c: Validate topic relevancy for optional materials
      if (this.validateAndCorrectTopicRelevancy()) {
        violationsFound = true;
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Phase 4: Enhanced validation completed after ${iterationCount} iteration(s)`
    });
    
    if (violationsFound) {
      this.notifications.push({
        type: 'warning',
        message: 'Some constraint violations could not be automatically corrected within iteration limit'
      });
    }
  }

  private validateAndCorrectTimeConstraints(): boolean {
    let violationsFound = false;
    
    for (const day of this.studyDays) {
      const totalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
      const maxTime = day.totalStudyTimeMinutes;
      
      if (totalTime > maxTime) {
        violationsFound = true;
        const excessTime = totalTime - maxTime;
        
        this.notifications.push({
          type: 'warning',
          message: `Day ${day.date} exceeds time limit by ${excessTime} minutes - attempting intelligent reallocation`
        });
        
        // Enhanced reallocation with priority-aware movement
        this.reallocateExcessTasksIntelligently(day, excessTime);
      }
    }
    
    return violationsFound;
  }

  private reallocateExcessTasksIntelligently(overloadedDay: DailySchedule, excessTime: number): void {
    // Sort tasks by priority for intelligent removal (lowest priority first)
    const sortedTasks = [...overloadedDay.tasks].sort((a, b) => {
      const priorityA = TASK_TYPE_PRIORITY[a.type] || 99;
      const priorityB = TASK_TYPE_PRIORITY[b.type] || 99;
      
      // Lower priority first (higher numbers = lower priority)
      if (priorityA !== priorityB) return priorityB - priorityA;
      
      // Optional tasks are lower priority
      if (a.isOptional !== b.isOptional) return (a.isOptional ? 1 : 0) - (b.isOptional ? 1 : 0);
      
      // Phase 3 resources are lower priority than Phase 1&2
      const aIsPhase3 = this.phase3Resources.has(a.originalResourceId || a.resourceId);
      const bIsPhase3 = this.phase3Resources.has(b.originalResourceId || b.resourceId);
      if (aIsPhase3 !== bIsPhase3) return aIsPhase3 ? 1 : -1;
      
      // Longer tasks are slightly lower priority for easier reallocation
      return b.durationMinutes - a.durationMinutes;
    });
    
    let timeToReallocate = excessTime;
    const tasksToReallocate: ScheduledTask[] = [];
    
    // Select tasks to move
    for (const task of sortedTasks) {
      if (timeToReallocate <= 0) break;
      
      tasksToReallocate.push(task);
      timeToReallocate -= task.durationMinutes;
    }
    
    // Remove selected tasks from overloaded day
    overloadedDay.tasks = overloadedDay.tasks.filter(task => 
      !tasksToReallocate.some(t => t.id === task.id)
    );
    
    // Find optimal placement for reallocated tasks
    const overloadedDayIndex = this.studyDays.findIndex(d => d.date === overloadedDay.date);
    
    for (const task of tasksToReallocate) {
      let taskReallocated = false;
      
      // Try to place on the best available day (most available time first)
      const availableDays = this.studyDays
        .map((day, index) => ({ day, index, availableTime: this.getRemainingTimeInDay(day) }))
        .filter(({availableTime}) => availableTime >= task.durationMinutes)
        .sort((a, b) => b.availableTime - a.availableTime);
      
      if (availableDays.length > 0) {
        const bestDay = availableDays[0].day;
        bestDay.tasks.push(task);
        taskReallocated = true;
      }
      
      if (!taskReallocated) {
        this.notifications.push({
          type: 'warning',
          message: `Could not reallocate task: "${task.title}" - no available time slots`
        });
        
        // Add back to overloaded day as last resort
        overloadedDay.tasks.push(task);
      }
    }
  }

  private validateAndCorrectResourcePairings(): boolean {
    let violationsFound = false;
    
    for (const [resourceId, resource] of this.allResources) {
      if (!resource.pairedResourceIds || resource.pairedResourceIds.length === 0) continue;
      
      const resourceTask = this.findTaskForResource(resourceId);
      if (!resourceTask) continue;
      
      const resourceDay = this.findDayForTask(resourceTask.id);
      if (!resourceDay) continue;
      
      const resourceDayIndex = this.studyDays.findIndex(d => d.date === resourceDay.date);
      
      // Check if paired resources are scheduled within reasonable proximity
      for (const pairedResourceId of resource.pairedResourceIds) {
        const pairedTask = this.findTaskForResource(pairedResourceId);
        if (!pairedTask) continue;
        
        const pairedDay = this.findDayForTask(pairedTask.id);
        if (!pairedDay) continue;
        
        const pairedDayIndex = this.studyDays.findIndex(d => d.date === pairedDay.date);
        const dayDifference = Math.abs(resourceDayIndex - pairedDayIndex);
        
        // If paired resources are more than 2 days apart, attempt to move them closer
        if (dayDifference > 2) {
          violationsFound = true;
          
          this.notifications.push({
            type: 'info',
            message: `Paired resources "${resource.title}" and "${this.allResources.get(pairedResourceId)?.title}" are ${dayDifference} days apart - attempting to move closer`
          });
          
          // Try to move the paired task closer
          this.movePairedTaskCloser(pairedTask, resourceDay, pairedDay);
        }
      }
    }
    
    return violationsFound;
  }

  private movePairedTaskCloser(taskToMove: ScheduledTask, targetDay: DailySchedule, currentDay: DailySchedule): void {
    // Remove task from current day
    currentDay.tasks = currentDay.tasks.filter(t => t.id !== taskToMove.id);
    
    // Try to add to target day
    if (this.getRemainingTimeInDay(targetDay) >= taskToMove.durationMinutes) {
      targetDay.tasks.push(taskToMove);
      return;
    }
    
    // Try adjacent days to target day
    const targetDayIndex = this.studyDays.findIndex(d => d.date === targetDay.date);
    const adjacentIndices = [targetDayIndex - 1, targetDayIndex + 1].filter(i => i >= 0 && i < this.studyDays.length);
    
    for (const adjacentIndex of adjacentIndices) {
      const adjacentDay = this.studyDays[adjacentIndex];
      if (this.getRemainingTimeInDay(adjacentDay) >= taskToMove.durationMinutes) {
        adjacentDay.tasks.push(taskToMove);
        return;
      }
    }
    
    // If can't move closer, put back in original day
    currentDay.tasks.push(taskToMove);
  }

  private validateAndCorrectTopicRelevancy(): boolean {
    // This could validate that Phase 3 content is appropriately matched to daily topics
    // For now, we trust the relevancy scoring system used during scheduling
    return false;
  }

  private findTaskForResource(resourceId: string): ScheduledTask | null {
    for (const day of this.schedule) {
      for (const task of day.tasks) {
        if (task.resourceId === resourceId || task.originalResourceId === resourceId) {
          return task;
        }
      }
    }
    return null;
  }

  private findDayForTask(taskId: string): DailySchedule | null {
    for (const day of this.schedule) {
      if (day.tasks.some(task => task.id === taskId)) {
        return day;
      }
    }
    return null;
  }

  /**
   * FINALIZATION METHODS
   */
  
  private finalizeSchedule(): void {
    // Sort tasks within each day by global priority
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      
      // Update task order indices
      day.tasks.forEach((task, index) => {
        task.order = index;
      });
    }
    
    // Report any unscheduled resources
    this.reportUnscheduledResources();
    
    // Generate summary statistics
    this.generateSummaryStatistics();
  }

  private reportUnscheduledResources(): void {
    const unscheduledResources: StudyResource[] = [];
    
    for (const resourceId of this.remainingResources) {
      const resource = this.allResources.get(resourceId);
      if (resource) {
        unscheduledResources.push(resource);
      }
    }
    
    if (unscheduledResources.length > 0) {
      // Categorize unscheduled by phase
      const unscheduledPhase1 = unscheduledResources.filter(r => this.phase1Resources.has(r.id));
      const unscheduledPhase2 = unscheduledResources.filter(r => this.phase2Resources.has(r.id));
      const unscheduledPhase3 = unscheduledResources.filter(r => this.phase3Resources.has(r.id));
      
      this.notifications.push({
        type: 'warning',
        message: `${unscheduledResources.length} resources unscheduled: ${unscheduledPhase1.length} Phase 1, ${unscheduledPhase2.length} Phase 2, ${unscheduledPhase3.length} Phase 3`
      });
      
      // Log details of first few unscheduled resources from each phase
      [
        { resources: unscheduledPhase1, phase: 'Phase 1' },
        { resources: unscheduledPhase2, phase: 'Phase 2' },
        { resources: unscheduledPhase3, phase: 'Phase 3' }
      ].forEach(({ resources, phase }) => {
        const detailLimit = Math.min(3, resources.length);
        for (let i = 0; i < detailLimit; i++) {
          const resource = resources[i];
          this.notifications.push({
            type: 'warning',
            message: `${phase} unscheduled: "${resource.title}" (${resource.durationMinutes} min, ${resource.domain})`
          });
        }
        
        if (resources.length > detailLimit) {
          this.notifications.push({
            type: 'info',
            message: `... and ${resources.length - detailLimit} more ${phase} resources`
          });
        }
      });
    }
  }

  private generateSummaryStatistics(): void {
    const totalScheduledTime = this.schedule
      .reduce((sum, day) => sum + day.tasks.reduce((daySum, task) => daySum + task.durationMinutes, 0), 0);
    
    const totalAvailableTime = this.studyDays
      .reduce((sum, day) => sum + day.totalStudyTimeMinutes, 0);
    
    const utilizationPercentage = totalAvailableTime > 0 
      ? ((totalScheduledTime / totalAvailableTime) * 100).toFixed(1)
      : '0';
    
    // Calculate statistics by phase
    const scheduledResourceIds = new Set<string>();
    let phase1Count = 0, phase2Count = 0, phase3Count = 0;
    
    for (const day of this.schedule) {
      for (const task of day.tasks) {
        const resourceId = task.originalResourceId || task.resourceId;
        scheduledResourceIds.add(resourceId);
        
        if (this.phase1Resources.has(resourceId)) phase1Count++;
        else if (this.phase2Resources.has(resourceId)) phase2Count++;
        else if (this.phase3Resources.has(resourceId)) phase3Count++;
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Schedule: ${totalScheduledTime} min scheduled / ${totalAvailableTime} min available (${utilizationPercentage}% utilization)`
    });
    
    this.notifications.push({
      type: 'info',
      message: `Resources by phase: ${phase1Count} Phase 1, ${phase2Count} Phase 2, ${phase3Count} Phase 3 (${scheduledResourceIds.size} total)`
    });
    
    // Board Vitals completion rate
    if (this.totalBoardVitalsQuestions > 0) {
      const bvCompletionRate = ((this.scheduledBoardVitalsQuestions / this.totalBoardVitalsQuestions) * 100).toFixed(1);
      this.notifications.push({
        type: 'info',
        message: `Board Vitals: ${this.scheduledBoardVitalsQuestions}/${this.totalBoardVitalsQuestions} questions scheduled (${bvCompletionRate}%)`
      });
    }
  }

  /**
   * MAIN EXECUTION METHOD
   */
  
  public generateSchedule(): GeneratedStudyPlanOutcome {
    try {
      if (this.studyDays.length === 0) {
        this.notifications.push({
          type: 'error',
          message: 'No study days available in the selected date range'
        });
        return this.createEmptyPlan();
      }
      
      this.notifications.push({
        type: 'info',
        message: `Starting ENHANCED 4-phase scheduling for ${this.studyDays.length} study days with strict compliance`
      });
      
      // Execute the complete enhanced 4-phase algorithm
      this.executePhase1(); // Primary Content Distribution (Round-Robin with Enhanced Pairing)
      this.executePhase2(); // Daily Requirements (Saturating First-Fit)
      this.executePhase3(); // Supplementary Content (STRICT Global Gating)
      this.executePhase4(); // Enhanced Validation and Optimization
      
      // Finalize the schedule
      this.finalizeSchedule();
      
      // Build progress tracking
      const progressPerDomain = this.buildProgressTracking();
      
      this.notifications.push({
        type: 'info',
        message: 'ENHANCED 4-phase scheduling algorithm completed with strict compliance enforcement'
      });
      
      return {
        plan: {
          schedule: this.schedule,
          progressPerDomain,
          startDate: this.schedule[0]?.date || '',
          endDate: this.schedule[this.schedule.length - 1]?.date || '',
          firstPassEndDate: null,
          topicOrder: this.topicOrder,
          cramTopicOrder: this.topicOrder.slice(), // Copy for cram mode
          deadlines: this.deadlines,
          isCramModeActive: false,
          areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved
        },
        notifications: this.notifications
      };
      
    } catch (error) {
      this.notifications.push({
        type: 'error',
        message: `Enhanced scheduling algorithm failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      
      return this.createEmptyPlan();
    }
  }

  private buildProgressTracking(): StudyPlan['progressPerDomain'] {
    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    
    // Initialize progress tracking for all domains
    for (const resource of this.allResources.values()) {
      if (!progressPerDomain[resource.domain]) {
        progressPerDomain[resource.domain] = {
          completedMinutes: 0,
          totalMinutes: 0
        };
      }
      progressPerDomain[resource.domain]!.totalMinutes += resource.durationMinutes;
    }
    
    // Calculate completed minutes from scheduled tasks
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
  const scheduler = new StrictFourPhaseScheduler(
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
  
  // Determine rebalance start date
  const rebalanceStartDate = options.type === 'standard' 
    ? (options.rebalanceDate && options.rebalanceDate > today ? options.rebalanceDate : today)
    : options.date;
  
  // Preserve past schedule (before rebalance date)
  const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStartDate);
  
  // Collect completed resources to exclude from new scheduling
  const completedResourceIds = new Set<string>();
  for (const day of currentPlan.schedule) {
    for (const task of day.tasks) {
      if (task.status === 'completed' && task.originalResourceId) {
        completedResourceIds.add(task.originalResourceId);
      }
    }
  }
  
  // Filter resource pool to exclude completed and archived resources
  const availableResources = resourcePool.filter(resource => 
    !completedResourceIds.has(resource.id) && !resource.isArchived
  );
  
  // Create new enhanced scheduler for remaining period
  const scheduler = new StrictFourPhaseScheduler(
    rebalanceStartDate,
    currentPlan.endDate,
    exceptionRules,
    availableResources,
    currentPlan.topicOrder,
    currentPlan.deadlines,
    currentPlan.areSpecialTopicsInterleaved
  );
  
  const result = scheduler.generateSchedule();
  
  // Combine past schedule with new schedule
  result.plan.schedule = [...pastSchedule, ...result.plan.schedule];
  result.plan.startDate = currentPlan.startDate;
  
  // Recalculate progress tracking including completed tasks
  const updatedProgressPerDomain = result.plan.progressPerDomain;
  for (const day of result.plan.schedule) {
    for (const task of day.tasks) {
      if (task.status === 'completed' && updatedProgressPerDomain[task.originalTopic]) {
        updatedProgressPerDomain[task.originalTopic]!.completedMinutes += task.durationMinutes;
      }
    }
  }
  
  result.plan.progressPerDomain = updatedProgressPerDomain;
  
  return result;
};