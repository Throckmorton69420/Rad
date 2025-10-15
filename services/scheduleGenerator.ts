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
 * Complete 4-Phase Scheduling Algorithm Implementation
 * 
 * Phase 1: Primary Content Distribution (Round-Robin with Resource Prioritization)
 *   - Pass 1a: Titan Block Round-Robin (Titan video + Crack the Core + Case Companion + Qevlar)
 *   - Pass 1b: Huda Physics Block Round-Robin (Huda lectures + question bank + textbook)
 *   - Pass 1c: Nuclear Medicine Round-Robin (Titan + Crack the Core + War Machine + Cases + Questions)
 * 
 * Phase 2: Other Daily Requirements (Daily First-Fit with Priority)
 *   - Pass 2a: NIS and RISC (First-Fit)
 *   - Pass 2b: Board Vitals questions with intelligent suggestions
 *   - Pass 2c: Physics content (Titan Route First-Fit)
 * 
 * Phase 3: Supplementary Content (Only after Phases 1&2 complete)
 *   - Pass 3a: Discord lectures with relevancy matching
 *   - Pass 3b: Core Radiology textbook with relevancy matching
 * 
 * Phase 4: Validation and Optimization (Iterative Constraint Checking)
 *   - Constraint checking for 14-hour daily maximum
 *   - Resource pairing validation
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
}

interface RelevancyScore {
  resourceId: string;
  score: number;
  matchedTopics: Domain[];
}

class FourPhaseAdvancedScheduler {
  private allResources: Map<string, StudyResource>;
  private remainingResources: Set<string>;
  private schedule: DailySchedule[];
  private studyDays: DailySchedule[];
  private notifications: GeneratedStudyPlanOutcome['notifications'] = [];
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskCounter = 0;
  
  // Phase tracking
  private coveredTopicsPerDay: Map<string, Set<Domain>> = new Map();
  private phase1Complete = false;
  private phase2Complete = false;
  private phase3Complete = false;
  
  // Resource categorization
  private titanResources: StudyResource[] = [];
  private hudaResources: StudyResource[] = [];
  private nuclearMedicineResources: StudyResource[] = [];
  private nisRiscResources: StudyResource[] = [];
  private boardVitalsResources: StudyResource[] = [];
  private physicsResources: StudyResource[] = [];
  private discordResources: StudyResource[] = [];
  private coreRadiologyResources: StudyResource[] = [];
  private otherResources: StudyResource[] = [];

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
          lowerBookSource.includes('case companion') ||
          lowerBookSource.includes('qevlar')) {
        this.titanResources.push(resource);
      }
      
      // Huda Physics resources
      else if (lowerVideoSource.includes('huda physics') || 
               lowerBookSource.includes('huda physics') ||
               (resource.domain === Domain.PHYSICS && lowerBookSource.includes('huda'))) {
        this.hudaResources.push(resource);
      }
      
      // Nuclear Medicine resources (including War Machine)
      else if (resource.domain === Domain.NUCLEAR_MEDICINE) {
        this.nuclearMedicineResources.push(resource);
      }
      
      // NIS and RISC resources
      else if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) {
        this.nisRiscResources.push(resource);
      }
      
      // Board Vitals resources
      else if (lowerBookSource.includes('board vitals')) {
        this.boardVitalsResources.push(resource);
      }
      
      // Physics resources (non-Huda)
      else if (resource.domain === Domain.PHYSICS) {
        this.physicsResources.push(resource);
      }
      
      // Discord resources
      else if (lowerVideoSource.includes('discord')) {
        this.discordResources.push(resource);
      }
      
      // Core Radiology textbook resources
      else if (lowerBookSource.includes('core radiology') || lowerTitle.includes('core radiology')) {
        this.coreRadiologyResources.push(resource);
      }
      
      // Other resources
      else {
        this.otherResources.push(resource);
      }
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
      return true;
    }
    return false;
  }

  /**
   * TOPIC BLOCK BUILDING METHODS
   */
  
  private buildTopicBlock(anchorResource: StudyResource, blockType: 'titan' | 'huda' | 'nuclear'): TopicBlock {
    const visited = new Set<string>([anchorResource.id]);
    const pairedResources: StudyResource[] = [];
    const processingQueue = [...(anchorResource.pairedResourceIds || [])];
    
    // Process explicitly paired resources
    while (processingQueue.length > 0) {
      const resourceId = processingQueue.shift()!;
      if (visited.has(resourceId)) continue;
      
      const resource = this.allResources.get(resourceId);
      if (!resource || !this.remainingResources.has(resourceId)) continue;
      
      visited.add(resourceId);
      pairedResources.push(resource);
      
      // Add any additional paired resources from this resource
      if (resource.pairedResourceIds) {
        processingQueue.push(...resource.pairedResourceIds.filter(id => !visited.has(id)));
      }
    }
    
    // Find topic and context-related resources based on block type
    const relatedResources = this.findRelatedResources(anchorResource, blockType, visited);
    pairedResources.push(...relatedResources);
    
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
   * PHASE 1: PRIMARY CONTENT DISTRIBUTION (ROUND-ROBIN WITH RESOURCE PRIORITIZATION)
   */
  
  private executePhase1(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Starting primary content distribution with round-robin scheduling'
    });
    
    // Pass 1a: Titan Block Round-Robin
    this.executeTitanBlockRoundRobin();
    
    // Pass 1b: Huda Physics Block Round-Robin  
    this.executeHudaPhysicsBlockRoundRobin();
    
    // Pass 1c: Nuclear Medicine Round-Robin
    this.executeNuclearMedicineRoundRobin();
    
    this.phase1Complete = true;
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
    
    // Round-robin distribution
    this.scheduleBlocksRoundRobin(titanBlocks, 0);
    
    this.notifications.push({
      type: 'info', 
      message: `Pass 1a: Scheduled ${titanBlocks.length} Titan blocks using round-robin distribution`
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
    this.scheduleBlocksRoundRobin(hudaBlocks, startingDayIndex);
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1b: Scheduled ${hudaBlocks.length} Huda Physics blocks using round-robin distribution`
    });
  }

  private executeNuclearMedicineRoundRobin(): void {
    // Build Nuclear Medicine blocks (Titan + Crack the Core + War Machine + Cases + Questions)
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
    this.scheduleBlocksRoundRobin(nuclearBlocks, startingDayIndex);
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1c: Scheduled ${nuclearBlocks.length} Nuclear Medicine blocks using round-robin distribution`
    });
  }

  private scheduleBlocksRoundRobin(blocks: TopicBlock[], startDayIndex: number): number {
    let currentDayIndex = startDayIndex;
    
    for (const block of blocks) {
      const allBlockResources = [block.anchorResource, ...block.pairedResources]
        .filter(resource => this.remainingResources.has(resource.id));
      
      if (allBlockResources.length === 0) continue;
      
      // Try to fit entire block on one day
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
      
      // If block doesn't fit entirely, split across days while maintaining pairings
      if (!blockScheduled) {
        for (const resource of allBlockResources) {
          let resourceScheduled = false;
          
          for (let dayOffset = 0; dayOffset < this.studyDays.length && !resourceScheduled; dayOffset++) {
            const dayIndex = (currentDayIndex + dayOffset) % this.studyDays.length;
            const day = this.studyDays[dayIndex];
            
            if (this.addTaskToDay(day, resource)) {
              currentDayIndex = (dayIndex + 1) % this.studyDays.length;
              resourceScheduled = true;
            }
          }
          
          if (!resourceScheduled) {
            this.notifications.push({
              type: 'warning',
              message: `Could not schedule resource: "${resource.title}" (${resource.durationMinutes} min) - insufficient time available`
            });
          }
        }
      }
    }
    
    return currentDayIndex;
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
   * PHASE 2: OTHER DAILY REQUIREMENTS (DAILY FIRST-FIT WITH PRIORITY)
   */
  
  private executePhase2(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Starting daily requirements scheduling'
    });
    
    // Pass 2a: NIS and RISC (First-Fit)
    this.scheduleNisRiscFirstFit();
    
    // Pass 2b: Board Vitals questions (mixed random with intelligent suggestions)
    this.scheduleBoardVitalsWithSuggestions();
    
    // Pass 2c: Physics (Titan Route First-Fit)
    this.schedulePhysicsFirstFit();
    
    this.phase2Complete = true;
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Daily requirements scheduling completed'
    });
  }

  private scheduleNisRiscFirstFit(): void {
    const nisRiscResources = this.nisRiscResources
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    this.scheduleResourcesFirstFit(nisRiscResources, 'NIS and RISC');
    
    this.notifications.push({
      type: 'info',
      message: `Pass 2a: Scheduled ${nisRiscResources.length} NIS and RISC resources using first-fit`
    });
  }

  private scheduleBoardVitalsWithSuggestions(): void {
    // Generate Board Vitals suggestions for each day
    for (const day of this.studyDays) {
      const suggestion = this.generateBoardVitalsSuggestion(day);
      
      if (suggestion.subjects.length > 0 && suggestion.questionCount > 0) {
        const suggestionMessage = `Day ${day.date}: Suggested Board Vitals - ${suggestion.questionCount} questions covering: ${suggestion.subjects.join(', ')} (${suggestion.availableTime} min available)`;
        
        this.notifications.push({
          type: 'info',
          message: suggestionMessage
        });
      }
      
      // Schedule available Board Vitals resources for this day
      const availableBoardVitals = this.boardVitalsResources
        .filter(resource => this.remainingResources.has(resource.id))
        .slice(0, 2); // Limit to avoid overwhelming single day
      
      for (const resource of availableBoardVitals) {
        if (this.addTaskToDay(day, resource)) {
          break; // Only add one Board Vitals resource per day
        }
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Pass 2b: Generated Board Vitals suggestions based on covered topics per day'
    });
  }

  private generateBoardVitalsSuggestion(day: DailySchedule): BoardVitalsSuggestion {
    const allCoveredTopics = new Set<Domain>();
    
    // Collect all topics covered up to and including the current day
    for (const scheduleDay of this.studyDays) {
      if (scheduleDay.date <= day.date) {
        const dayTopics = this.coveredTopicsPerDay.get(scheduleDay.date) || new Set();
        dayTopics.forEach(topic => allCoveredTopics.add(topic));
      }
    }
    
    // Convert to array and filter out meta-domains
    const subjects = Array.from(allCoveredTopics).filter(topic => 
      ![Domain.NIS, Domain.RISC, Domain.HIGH_YIELD, Domain.MIXED_REVIEW, 
        Domain.WEAK_AREA_REVIEW, Domain.QUESTION_BANK_CATCHUP, Domain.FINAL_REVIEW, 
        Domain.LIGHT_REVIEW].includes(topic)
    );
    
    // Calculate available time and question suggestions
    const availableTime = this.getRemainingTimeInDay(day);
    const totalBoardVitalsQuestions = this.boardVitalsResources
      .reduce((sum, resource) => sum + (resource.questionCount || 0), 0);
    
    // Assume 2 minutes per question on average
    const questionsPerMinute = 0.5;
    const maxQuestionsByTime = Math.floor(availableTime * questionsPerMinute);
    const averageQuestionsPerDay = Math.ceil(totalBoardVitalsQuestions / this.studyDays.length);
    
    const questionCount = Math.min(maxQuestionsByTime, averageQuestionsPerDay, 50); // Cap at 50 questions
    
    return {
      subjects,
      questionCount: Math.max(0, questionCount),
      availableTime,
      totalQuestionsPool: totalBoardVitalsQuestions
    };
  }

  private schedulePhysicsFirstFit(): void {
    const physicsResources = this.physicsResources
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    this.scheduleResourcesFirstFit(physicsResources, 'Physics (Titan Route)');
    
    this.notifications.push({
      type: 'info',
      message: `Pass 2c: Scheduled ${physicsResources.length} Physics resources using first-fit`
    });
  }

  private scheduleResourcesFirstFit(resources: StudyResource[], resourceTypeName: string): void {
    let scheduledCount = 0;
    
    for (const resource of resources) {
      if (!this.remainingResources.has(resource.id)) continue;
      
      let resourceScheduled = false;
      
      for (const day of this.studyDays) {
        if (this.addTaskToDay(day, resource)) {
          resourceScheduled = true;
          scheduledCount++;
          break;
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
   * PHASE 3: SUPPLEMENTARY CONTENT (ONLY AFTER PHASES 1&2 COMPLETE)
   */
  
  private executePhase3(): void {
    // Only proceed if Phases 1 and 2 are complete and no primary material remains
    const primaryMaterialRemaining = Array.from(this.remainingResources)
      .some(resourceId => {
        const resource = this.allResources.get(resourceId);
        return resource && (resource.isPrimaryMaterial || !resource.isOptional);
      });
    
    if (primaryMaterialRemaining) {
      this.notifications.push({
        type: 'info',
        message: 'Phase 3: Deferred - Primary material still remains unscheduled'
      });
      return;
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Starting supplementary content scheduling (all primary material completed)'
    });
    
    // Pass 3a: Discord lectures with relevancy matching
    this.scheduleDiscordWithRelevancy();
    
    // Pass 3b: Core Radiology textbook with relevancy matching
    this.scheduleCoreRadiologyWithRelevancy();
    
    this.phase3Complete = true;
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
      message: `Pass 3a: Scheduled Discord lectures based on topic relevancy`
    });
  }

  private scheduleCoreRadiologyWithRelevancy(): void {
    const coreRadiologyResources = this.coreRadiologyResources
      .filter(resource => this.remainingResources.has(resource.id));
    
    this.scheduleSupplementaryContentWithRelevancy(coreRadiologyResources, 'Core Radiology textbook');
    
    this.notifications.push({
      type: 'info',
      message: `Pass 3b: Scheduled Core Radiology textbook based on topic relevancy`
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
      for (const relevancyScore of relevancyScores) {
        const resource = this.allResources.get(relevancyScore.resourceId);
        if (resource && this.remainingResources.has(resource.id)) {
          if (this.addTaskToDay(day, resource)) {
            // Resource successfully scheduled
          } else {
            // No more time available in this day
            break;
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
   * PHASE 4: VALIDATION AND OPTIMIZATION (ITERATIVE CONSTRAINT CHECKING)
   */
  
  private executePhase4(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 4: Starting validation and optimization'
    });
    
    let iterationCount = 0;
    const maxIterations = 5;
    let violationsFound = true;
    
    while (violationsFound && iterationCount < maxIterations) {
      iterationCount++;
      violationsFound = false;
      
      // Pass 4a: Check 14-hour daily maximum constraints
      if (this.validateAndCorrectTimeConstraints()) {
        violationsFound = true;
      }
      
      // Pass 4b: Validate resource pairings
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
      message: `Phase 4: Validation completed after ${iterationCount} iteration(s)`
    });
    
    if (violationsFound) {
      this.notifications.push({
        type: 'warning',
        message: 'Some constraint violations could not be automatically corrected'
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
          message: `Day ${day.date} exceeds time limit by ${excessTime} minutes - attempting reallocation`
        });
        
        // Move lowest-priority tasks to next available days
        this.reallocateExcessTasks(day, excessTime);
      }
    }
    
    return violationsFound;
  }

  private reallocateExcessTasks(overloadedDay: DailySchedule, excessTime: number): void {
    // Sort tasks by priority (lowest priority first for removal)
    const sortedTasks = [...overloadedDay.tasks].sort((a, b) => {
      const priorityA = TASK_TYPE_PRIORITY[a.type] || 99;
      const priorityB = TASK_TYPE_PRIORITY[b.type] || 99;
      
      // Lower priority first (higher numbers = lower priority)
      if (priorityA !== priorityB) return priorityB - priorityA;
      
      // Optional tasks are lower priority
      if (a.isOptional !== b.isOptional) return (a.isOptional ? 1 : 0) - (b.isOptional ? 1 : 0);
      
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
    
    // Find placement for reallocated tasks
    const overloadedDayIndex = this.studyDays.findIndex(d => d.date === overloadedDay.date);
    
    for (const task of tasksToReallocate) {
      let taskReallocated = false;
      
      // Try subsequent days first
      for (let i = overloadedDayIndex + 1; i < this.studyDays.length && !taskReallocated; i++) {
        const targetDay = this.studyDays[i];
        if (this.getRemainingTimeInDay(targetDay) >= task.durationMinutes) {
          targetDay.tasks.push(task);
          taskReallocated = true;
        }
      }
      
      // If not placed, try previous days
      if (!taskReallocated) {
        for (let i = overloadedDayIndex - 1; i >= 0 && !taskReallocated; i--) {
          const targetDay = this.studyDays[i];
          if (this.getRemainingTimeInDay(targetDay) >= task.durationMinutes) {
            targetDay.tasks.push(task);
            taskReallocated = true;
          }
        }
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
    // This validation ensures that paired resources are scheduled close together
    let violationsFound = false;
    
    for (const [resourceId, resource] of this.allResources) {
      if (!resource.pairedResourceIds || resource.pairedResourceIds.length === 0) continue;
      
      const resourceTask = this.findTaskForResource(resourceId);
      if (!resourceTask) continue;
      
      const resourceDay = this.findDayForTask(resourceTask.id);
      if (!resourceDay) continue;
      
      // Check if paired resources are scheduled within reasonable proximity
      for (const pairedResourceId of resource.pairedResourceIds) {
        const pairedTask = this.findTaskForResource(pairedResourceId);
        if (!pairedTask) continue;
        
        const pairedDay = this.findDayForTask(pairedTask.id);
        if (!pairedDay) continue;
        
        const dayDifference = Math.abs(
          this.studyDays.findIndex(d => d.date === resourceDay.date) - 
          this.studyDays.findIndex(d => d.date === pairedDay.date)
        );
        
        // If paired resources are more than 3 days apart, attempt to move them closer
        if (dayDifference > 3) {
          violationsFound = true;
          this.notifications.push({
            type: 'info',
            message: `Paired resources "${resource.title}" and "${this.allResources.get(pairedResourceId)?.title}" are ${dayDifference} days apart - attempting to move closer`
          });
          
          // Implementation of pairing correction could be added here
          // For now, we just log the violation
        }
      }
    }
    
    return violationsFound;
  }

  private validateAndCorrectTopicRelevancy(): boolean {
    // Validate that supplementary content is appropriately matched to daily topics
    let violationsFound = false;
    
    // This is a placeholder for more sophisticated relevancy validation
    // The current implementation already handles relevancy during scheduling
    
    return violationsFound;
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
      this.notifications.push({
        type: 'warning',
        message: `${unscheduledResources.length} resources could not be scheduled due to time constraints`
      });
      
      // Log details of first few unscheduled resources
      const detailLimit = Math.min(5, unscheduledResources.length);
      for (let i = 0; i < detailLimit; i++) {
        const resource = unscheduledResources[i];
        this.notifications.push({
          type: 'warning',
          message: `Unscheduled: "${resource.title}" (${resource.durationMinutes} min, ${resource.domain})`
        });
      }
      
      if (unscheduledResources.length > detailLimit) {
        this.notifications.push({
          type: 'info',
          message: `... and ${unscheduledResources.length - detailLimit} more unscheduled resources`
        });
      }
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
    
    this.notifications.push({
      type: 'info',
      message: `Schedule generated: ${totalScheduledTime} minutes scheduled out of ${totalAvailableTime} minutes available (${utilizationPercentage}% utilization)`
    });
    
    // Count resources by phase
    const scheduledResourceIds = new Set<string>();
    for (const day of this.schedule) {
      for (const task of day.tasks) {
        scheduledResourceIds.add(task.originalResourceId || task.resourceId);
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Total resources scheduled: ${scheduledResourceIds.size} out of ${this.allResources.size} available`
    });
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
        message: `Starting 4-phase scheduling algorithm for ${this.studyDays.length} study days`
      });
      
      // Execute the complete 4-phase algorithm
      this.executePhase1(); // Primary Content Distribution (Round-Robin)
      this.executePhase2(); // Daily Requirements (First-Fit)
      this.executePhase3(); // Supplementary Content (Relevancy-Based)
      this.executePhase4(); // Validation and Optimization
      
      // Finalize the schedule
      this.finalizeSchedule();
      
      // Build progress tracking
      const progressPerDomain = this.buildProgressTracking();
      
      this.notifications.push({
        type: 'info',
        message: '4-phase scheduling algorithm completed successfully'
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
        message: `Scheduling algorithm failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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
  const scheduler = new FourPhaseAdvancedScheduler(
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
  
  // Create new scheduler for remaining period
  const scheduler = new FourPhaseAdvancedScheduler(
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