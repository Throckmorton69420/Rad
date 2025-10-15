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
 * ROBUST 4-PHASE SCHEDULING ALGORITHM
 * 
 * This implementation strictly follows the user's requirements:
 * 
 * Phase 1: Primary Content Distribution (Round-Robin with Resource Prioritization)
 *   - Pass 1a: Titan Block Round-Robin (Titan + Crack the Core + Case Companion + Qevlar)
 *   - Pass 1b: Huda Physics Block Round-Robin (Huda lectures + QB + textbook)
 *   - Pass 1c: Nuclear Medicine Round-Robin (Titan + Crack the Core + War Machine + Cases + NucApp)
 * 
 * Phase 2: Other Daily Requirements (Daily First-Fit with Priority)
 *   - Pass 2a: NIS and RISC (First-Fit)
 *   - Pass 2b: Board Vitals with intelligent suggestions covering ALL questions
 *   - Pass 2c: Physics (Titan Route First-Fit)
 * 
 * Phase 3: Supplementary Content (STRICT: Only after ALL Phase 1&2 complete)
 *   - Pass 3a: Discord lectures with relevancy
 *   - Pass 3b: Core Radiology textbook with relevancy
 * 
 * Phase 4: Validation and Optimization
 */

interface TopicBlock {
  id: string;
  resources: StudyResource[];
  totalMinutes: number;
  domain: Domain;
  blockType: 'titan' | 'huda' | 'nuclear';
}

interface BoardVitalsAllocation {
  date: string;
  targetQuestions: number;
  suggestedSubjects: Domain[];
}

class RobustScheduler {
  private allResources: Map<string, StudyResource> = new Map();
  private remainingResources: Set<string> = new Set();
  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private notifications: Array<{type: 'error' | 'warning' | 'info', message: string}> = [];
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;
  private taskCounter = 0;
  
  // Phase tracking
  private coveredTopicsPerDay: Map<string, Set<Domain>> = new Map();
  private phase1Resources: Set<string> = new Set();
  private phase2Resources: Set<string> = new Set();
  private phase3Resources: Set<string> = new Set();
  
  // Board Vitals tracking
  private totalBoardVitalsQuestions = 0;
  private scheduledBoardVitalsQuestions = 0;
  private boardVitalsAllocations: BoardVitalsAllocation[] = [];

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
    
    try {
      // Initialize resources
      this.initializeResources(resourcePool);
      
      // Create day schedules
      this.createDaySchedules(startDateStr, endDateStr, exceptionRules);
      
      // Initialize tracking
      this.initializeTracking();
      
      this.notifications.push({
        type: 'info',
        message: `Scheduler initialized: ${this.studyDays.length} study days, ${this.allResources.size} resources`
      });
      
    } catch (error) {
      this.notifications.push({
        type: 'error',
        message: `Scheduler initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      throw error;
    }
  }

  private initializeResources(resourcePool: StudyResource[]): void {
    // Process and chunk large resources
    const processedResources = this.chunkLargeResources(resourcePool);
    
    processedResources.forEach(resource => {
      this.allResources.set(resource.id, resource);
      this.remainingResources.add(resource.id);
      
      // Categorize resources by phase
      this.categorizeResource(resource);
    });
    
    this.notifications.push({
      type: 'info',
      message: `Resources categorized: Phase 1: ${this.phase1Resources.size}, Phase 2: ${this.phase2Resources.size}, Phase 3: ${this.phase3Resources.size}`
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

  private categorizeResource(resource: StudyResource): void {
    const title = (resource.title || '').toLowerCase();
    const videoSource = (resource.videoSource || '').toLowerCase();
    const bookSource = (resource.bookSource || '').toLowerCase();
    
    // Phase 1: Primary Content
    if (
      videoSource.includes('titan') ||
      bookSource.includes('crack the core') ||
      bookSource.includes('case companion') ||
      bookSource.includes('qevlar') ||
      (videoSource.includes('huda') && resource.domain === Domain.PHYSICS) ||
      bookSource.includes('huda') ||
      resource.domain === Domain.NUCLEAR_MEDICINE
    ) {
      this.phase1Resources.add(resource.id);
    }
    // Phase 2: Daily Requirements
    else if (
      resource.domain === Domain.NIS ||
      resource.domain === Domain.RISC ||
      bookSource.includes('board vitals') ||
      resource.domain === Domain.PHYSICS ||
      bookSource.includes('nucapp')
    ) {
      this.phase2Resources.add(resource.id);
      
      // Track Board Vitals questions
      if (bookSource.includes('board vitals') && resource.questionCount) {
        this.totalBoardVitalsQuestions += resource.questionCount;
      }
    }
    // Phase 3: Supplementary Content
    else if (
      videoSource.includes('discord') ||
      bookSource.includes('core radiology') ||
      title.includes('core radiology')
    ) {
      this.phase3Resources.add(resource.id);
    }
    // Default to Phase 2 if primary material, Phase 3 if optional
    else {
      if (resource.isPrimaryMaterial || !resource.isOptional) {
        this.phase2Resources.add(resource.id);
      } else {
        this.phase3Resources.add(resource.id);
      }
    }
  }

  private createDaySchedules(startDateStr: string, endDateStr: string, exceptionRules: ExceptionDateRule[]): void {
    const startDate = parseDateString(startDateStr);
    const endDate = parseDateString(endDateStr);
    const exceptionMap = new Map(exceptionRules.map(rule => [rule.date, rule]));
    
    // Ensure we have a valid date range
    if (startDate > endDate) {
      throw new Error(`Invalid date range: ${startDateStr} to ${endDateStr}`);
    }
    
    const daySchedules: DailySchedule[] = [];
    
    for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate.setUTCDate(currentDate.getUTCDate() + 1)) {
      const dateString = isoDate(currentDate);
      const exceptionRule = exceptionMap.get(dateString);
      
      const totalStudyTime = exceptionRule?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS;
      const isRestDay = exceptionRule?.isRestDayOverride ?? false;
      
      const daySchedule: DailySchedule = {
        date: dateString,
        dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        tasks: [],
        totalStudyTimeMinutes: Math.max(totalStudyTime, 0), // Ensure non-negative
        isRestDay,
        isManuallyModified: !!exceptionRule
      };
      
      daySchedules.push(daySchedule);
      
      if (!isRestDay && totalStudyTime > 0) {
        this.studyDays.push(daySchedule);
      }
    }
    
    this.schedule = daySchedules;
    
    if (this.studyDays.length === 0) {
      throw new Error('No study days available - all days are rest days or have zero study time');
    }
    
    this.notifications.push({
      type: 'info',
      message: `Created ${daySchedules.length} total days (${this.studyDays.length} study days)`
    });
  }

  private initializeTracking(): void {
    // Initialize covered topics tracking
    this.studyDays.forEach(day => {
      this.coveredTopicsPerDay.set(day.date, new Set<Domain>());
    });
    
    // Pre-calculate Board Vitals allocations
    this.calculateBoardVitalsAllocations();
  }

  private calculateBoardVitalsAllocations(): void {
    if (this.totalBoardVitalsQuestions === 0) return;
    
    let remainingQuestions = this.totalBoardVitalsQuestions;
    const questionsPerMinute = 0.5; // 2 minutes per question
    
    this.studyDays.forEach((day, index) => {
      const remainingDays = this.studyDays.length - index;
      
      // Calculate target questions for this day
      const avgQuestionsPerDay = Math.ceil(remainingQuestions / remainingDays);
      const maxQuestionsByTime = Math.floor(day.totalStudyTimeMinutes * 0.4 * questionsPerMinute); // Up to 40% of day
      
      const targetQuestions = Math.min(avgQuestionsPerDay, maxQuestionsByTime, remainingQuestions);
      
      // Determine suggested subjects based on covered topics up to this day
      const coveredSubjects = new Set<Domain>();
      for (let j = 0; j <= index; j++) {
        const dayTopics = this.coveredTopicsPerDay.get(this.studyDays[j].date) || new Set();
        dayTopics.forEach(topic => {
          if (![Domain.NIS, Domain.RISC, Domain.HIGH_YIELD, Domain.MIXED_REVIEW].includes(topic)) {
            coveredSubjects.add(topic);
          }
        });
      }
      
      this.boardVitalsAllocations.push({
        date: day.date,
        targetQuestions: targetQuestions,
        suggestedSubjects: Array.from(coveredSubjects)
      });
      
      remainingQuestions -= targetQuestions;
    });
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
    const remainingTime = this.getRemainingTime(day);
    
    if (remainingTime >= resource.durationMinutes) {
      const task = this.createTask(resource, day.tasks.length);
      day.tasks.push(task);
      this.remainingResources.delete(resource.id);
      this.coveredTopicsPerDay.get(day.date)?.add(resource.domain);
      
      // Track Board Vitals questions
      if (resource.questionCount && (resource.bookSource || '').toLowerCase().includes('board vitals')) {
        this.scheduledBoardVitalsQuestions += resource.questionCount;
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * PHASE 1: PRIMARY CONTENT DISTRIBUTION (ROUND-ROBIN)
   */
  
  private executePhase1(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Starting primary content distribution'
    });
    
    // Pass 1a: Titan Block Round-Robin
    this.executeTitanBlocks();
    
    // Pass 1b: Huda Physics Block Round-Robin
    this.executeHudaBlocks();
    
    // Pass 1c: Nuclear Medicine Round-Robin
    this.executeNuclearBlocks();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 1: Primary content distribution completed'
    });
  }

  private executeTitanBlocks(): void {
    const titanBlocks = this.buildTitanBlocks();
    this.scheduleBlocksRoundRobin(titanBlocks, 'Titan');
  }

  private executeHudaBlocks(): void {
    const hudaBlocks = this.buildHudaBlocks();
    this.scheduleBlocksRoundRobin(hudaBlocks, 'Huda Physics');
  }

  private executeNuclearBlocks(): void {
    const nuclearBlocks = this.buildNuclearBlocks();
    this.scheduleBlocksRoundRobin(nuclearBlocks, 'Nuclear Medicine');
  }

  private buildTitanBlocks(): TopicBlock[] {
    const blocks: TopicBlock[] = [];
    
    // Find Titan anchor resources (videos)
    const titanAnchors = Array.from(this.allResources.values())
      .filter(r => 
        this.remainingResources.has(r.id) &&
        (r.videoSource || '').toLowerCase().includes('titan') &&
        (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    titanAnchors.forEach(anchor => {
      const blockResources = [anchor];
      
      // Find paired Crack the Core content
      const crackTheCore = Array.from(this.allResources.values())
        .filter(r => 
          this.remainingResources.has(r.id) &&
          (r.bookSource || '').toLowerCase().includes('crack the core') &&
          this.isTopicallyRelated(anchor, r)
        );
      
      // Find Case Companion content
      const caseCompanion = Array.from(this.allResources.values())
        .filter(r => 
          this.remainingResources.has(r.id) &&
          (r.bookSource || '').toLowerCase().includes('case companion') &&
          this.isTopicallyRelated(anchor, r)
        );
      
      // Find Qevlar questions
      const qevlar = Array.from(this.allResources.values())
        .filter(r => 
          this.remainingResources.has(r.id) &&
          (r.bookSource || '').toLowerCase().includes('qevlar') &&
          this.isTopicallyRelated(anchor, r)
        );
      
      blockResources.push(...crackTheCore, ...caseCompanion, ...qevlar);
      
      if (blockResources.length > 1 || anchor.durationMinutes > 0) {
        blocks.push({
          id: `titan_block_${anchor.id}`,
          resources: blockResources,
          totalMinutes: blockResources.reduce((sum, r) => sum + r.durationMinutes, 0),
          domain: anchor.domain,
          blockType: 'titan'
        });
      }
    });
    
    return blocks;
  }

  private buildHudaBlocks(): TopicBlock[] {
    const blocks: TopicBlock[] = [];
    
    // Find Huda anchor resources
    const hudaAnchors = Array.from(this.allResources.values())
      .filter(r => 
        this.remainingResources.has(r.id) &&
        ((r.videoSource || '').toLowerCase().includes('huda') || (r.bookSource || '').toLowerCase().includes('huda')) &&
        r.domain === Domain.PHYSICS
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    hudaAnchors.forEach(anchor => {
      const blockResources = [anchor];
      
      // Find related Huda content
      const relatedHuda = Array.from(this.allResources.values())
        .filter(r => 
          this.remainingResources.has(r.id) &&
          r.id !== anchor.id &&
          ((r.videoSource || '').toLowerCase().includes('huda') || (r.bookSource || '').toLowerCase().includes('huda')) &&
          r.domain === Domain.PHYSICS
        );
      
      blockResources.push(...relatedHuda.slice(0, 3)); // Limit block size
      
      blocks.push({
        id: `huda_block_${anchor.id}`,
        resources: blockResources,
        totalMinutes: blockResources.reduce((sum, r) => sum + r.durationMinutes, 0),
        domain: anchor.domain,
        blockType: 'huda'
      });
    });
    
    return blocks;
  }

  private buildNuclearBlocks(): TopicBlock[] {
    const blocks: TopicBlock[] = [];
    
    // Find Nuclear Medicine anchor resources
    const nuclearAnchors = Array.from(this.allResources.values())
      .filter(r => 
        this.remainingResources.has(r.id) &&
        r.domain === Domain.NUCLEAR_MEDICINE &&
        (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO || r.type === ResourceType.READING_TEXTBOOK)
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    nuclearAnchors.forEach(anchor => {
      const blockResources = [anchor];
      
      // Find related nuclear content
      const relatedNuclear = Array.from(this.allResources.values())
        .filter(r => 
          this.remainingResources.has(r.id) &&
          r.id !== anchor.id &&
          r.domain === Domain.NUCLEAR_MEDICINE
        );
      
      blockResources.push(...relatedNuclear.slice(0, 4)); // Include War Machine, NucApp, etc.
      
      blocks.push({
        id: `nuclear_block_${anchor.id}`,
        resources: blockResources,
        totalMinutes: blockResources.reduce((sum, r) => sum + r.durationMinutes, 0),
        domain: anchor.domain,
        blockType: 'nuclear'
      });
    });
    
    return blocks;
  }

  private isTopicallyRelated(resource1: StudyResource, resource2: StudyResource): boolean {
    // Same domain
    if (resource1.domain === resource2.domain) return true;
    
    // Same chapter
    if (resource1.chapterNumber && resource2.chapterNumber && resource1.chapterNumber === resource2.chapterNumber) {
      return true;
    }
    
    // Topic keyword matching
    const title1 = (resource1.title || '').toLowerCase();
    const title2 = (resource2.title || '').toLowerCase();
    
    const keywords = ['pancreas', 'liver', 'kidney', 'lung', 'brain', 'spine', 'heart', 'breast', 'gi', 'neuro', 'thorax', 'msk'];
    
    return keywords.some(keyword => title1.includes(keyword) && title2.includes(keyword));
  }

  private scheduleBlocksRoundRobin(blocks: TopicBlock[], blockTypeName: string): void {
    let dayIndex = 0;
    let scheduledBlocks = 0;
    
    for (const block of blocks) {
      const availableResources = block.resources.filter(r => this.remainingResources.has(r.id));
      if (availableResources.length === 0) continue;
      
      // Try to fit the entire block on one day
      let blockScheduled = false;
      
      for (let attempt = 0; attempt < this.studyDays.length; attempt++) {
        const currentDay = this.studyDays[(dayIndex + attempt) % this.studyDays.length];
        const totalBlockTime = availableResources.reduce((sum, r) => sum + r.durationMinutes, 0);
        
        if (this.getRemainingTime(currentDay) >= totalBlockTime) {
          // Schedule entire block
          availableResources.forEach(resource => {
            this.addTaskToDay(currentDay, resource);
          });
          
          dayIndex = (dayIndex + attempt + 1) % this.studyDays.length;
          blockScheduled = true;
          scheduledBlocks++;
          break;
        }
      }
      
      // If block doesn't fit as a whole, schedule resources individually while maintaining pairing preference
      if (!blockScheduled) {
        for (const resource of availableResources) {
          let resourceScheduled = false;
          
          for (let attempt = 0; attempt < this.studyDays.length; attempt++) {
            const currentDay = this.studyDays[(dayIndex + attempt) % this.studyDays.length];
            
            if (this.addTaskToDay(currentDay, resource)) {
              dayIndex = (dayIndex + attempt + 1) % this.studyDays.length;
              resourceScheduled = true;
              break;
            }
          }
          
          if (!resourceScheduled) {
            this.notifications.push({
              type: 'warning',
              message: `Could not schedule ${blockTypeName} resource: "${resource.title}" (${resource.durationMinutes} min)`
            });
          }
        }
        scheduledBlocks++;
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 1: Scheduled ${scheduledBlocks}/${blocks.length} ${blockTypeName} blocks`
    });
  }

  /**
   * PHASE 2: OTHER DAILY REQUIREMENTS (FIRST-FIT)
   */
  
  private executePhase2(): void {
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Starting daily requirements'
    });
    
    // Pass 2a: NIS and RISC
    this.scheduleNisRisc();
    
    // Pass 2b: Board Vitals
    this.scheduleBoardVitals();
    
    // Pass 2c: Physics
    this.schedulePhysics();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 2: Daily requirements completed'
    });
  }

  private scheduleNisRisc(): void {
    const nisRiscResources = Array.from(this.allResources.values())
      .filter(r => 
        this.remainingResources.has(r.id) &&
        (r.domain === Domain.NIS || r.domain === Domain.RISC)
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    this.scheduleResourcesFirstFit(nisRiscResources, 'NIS/RISC');
  }

  private scheduleBoardVitals(): void {
    this.studyDays.forEach((day, index) => {
      const allocation = this.boardVitalsAllocations[index];
      if (!allocation || allocation.targetQuestions === 0) return;
      
      const boardVitalsResources = Array.from(this.allResources.values())
        .filter(r => 
          this.remainingResources.has(r.id) &&
          (r.bookSource || '').toLowerCase().includes('board vitals')
        )
        .sort((a, b) => {
          // Prioritize resources matching suggested subjects
          const aMatches = allocation.suggestedSubjects.includes(a.domain);
          const bMatches = allocation.suggestedSubjects.includes(b.domain);
          if (aMatches && !bMatches) return -1;
          if (!aMatches && bMatches) return 1;
          return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
        });
      
      let scheduledQuestions = 0;
      for (const resource of boardVitalsResources) {
        if (scheduledQuestions >= allocation.targetQuestions) break;
        
        if (this.addTaskToDay(day, resource)) {
          scheduledQuestions += resource.questionCount || 0;
        }
      }
      
      if (allocation.suggestedSubjects.length > 0) {
        this.notifications.push({
          type: 'info',
          message: `Day ${day.date}: Board Vitals - ${scheduledQuestions} questions suggested covering: ${allocation.suggestedSubjects.join(', ')}`
        });
      }
    });
  }

  private schedulePhysics(): void {
    const physicsResources = Array.from(this.allResources.values())
      .filter(r => 
        this.remainingResources.has(r.id) &&
        r.domain === Domain.PHYSICS &&
        !this.phase1Resources.has(r.id) // Exclude Huda resources already handled in Phase 1
      )
      .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    
    this.scheduleResourcesFirstFit(physicsResources, 'Physics');
  }

  private scheduleResourcesFirstFit(resources: StudyResource[], typeName: string): void {
    let scheduledCount = 0;
    
    for (const resource of resources) {
      if (!this.remainingResources.has(resource.id)) continue;
      
      let resourceScheduled = false;
      
      // Try to schedule on the day with the most available time
      const sortedDays = [...this.studyDays]
        .sort((a, b) => this.getRemainingTime(b) - this.getRemainingTime(a));
      
      for (const day of sortedDays) {
        if (this.addTaskToDay(day, resource)) {
          resourceScheduled = true;
          scheduledCount++;
          break;
        }
      }
      
      if (!resourceScheduled) {
        this.notifications.push({
          type: 'warning',
          message: `Could not schedule ${typeName} resource: "${resource.title}" (${resource.durationMinutes} min)`
        });
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 2: Scheduled ${scheduledCount}/${resources.length} ${typeName} resources`
    });
  }

  /**
   * PHASE 3: SUPPLEMENTARY CONTENT (ONLY AFTER PHASE 1&2 COMPLETE)
   */
  
  private executePhase3(): void {
    // Check if all Phase 1&2 resources are scheduled
    const unscheduledPhase12 = Array.from(this.remainingResources)
      .filter(id => this.phase1Resources.has(id) || this.phase2Resources.has(id));
    
    if (unscheduledPhase12.length > 0) {
      this.notifications.push({
        type: 'info',
        message: `Phase 3: BLOCKED - ${unscheduledPhase12.length} Phase 1&2 resources remain unscheduled`
      });
      return;
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Starting supplementary content (all Phase 1&2 complete)'
    });
    
    // Pass 3a: Discord lectures
    this.scheduleDiscordLectures();
    
    // Pass 3b: Core Radiology textbook
    this.scheduleCoreRadiology();
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 3: Supplementary content completed'
    });
  }

  private scheduleDiscordLectures(): void {
    const discordResources = Array.from(this.allResources.values())
      .filter(r => 
        this.remainingResources.has(r.id) &&
        (r.videoSource || '').toLowerCase().includes('discord')
      );
    
    this.scheduleSupplementaryWithRelevancy(discordResources, 'Discord lectures');
  }

  private scheduleCoreRadiology(): void {
    const coreRadiologyResources = Array.from(this.allResources.values())
      .filter(r => 
        this.remainingResources.has(r.id) &&
        ((r.bookSource || '').toLowerCase().includes('core radiology') ||
         (r.title || '').toLowerCase().includes('core radiology'))
      );
    
    this.scheduleSupplementaryWithRelevancy(coreRadiologyResources, 'Core Radiology');
  }

  private scheduleSupplementaryWithRelevancy(resources: StudyResource[], typeName: string): void {
    let scheduledCount = 0;
    
    // For each day, schedule relevant supplementary content
    for (const day of this.studyDays) {
      const dayTopics = this.coveredTopicsPerDay.get(day.date) || new Set();
      
      // Sort resources by relevancy to day's topics
      const relevantResources = resources
        .filter(r => this.remainingResources.has(r.id))
        .sort((a, b) => {
          const aRelevant = dayTopics.has(a.domain) ? 1 : 0;
          const bRelevant = dayTopics.has(b.domain) ? 1 : 0;
          return bRelevant - aRelevant;
        });
      
      // Greedily fill remaining time
      for (const resource of relevantResources) {
        if (this.addTaskToDay(day, resource)) {
          scheduledCount++;
        }
      }
    }
    
    this.notifications.push({
      type: 'info',
      message: `Pass 3: Scheduled ${scheduledCount} ${typeName} resources with relevancy matching`
    });
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
    
    // Check time constraints
    for (const day of this.studyDays) {
      const totalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
      
      if (totalTime > day.totalStudyTimeMinutes) {
        violations++;
        const excess = totalTime - day.totalStudyTimeMinutes;
        
        this.notifications.push({
          type: 'warning',
          message: `Day ${day.date} exceeds limit by ${excess} minutes`
        });
        
        // Move lowest priority tasks to other days
        this.redistributeExcessTasks(day, excess);
      }
    }
    
    if (violations > 0) {
      this.notifications.push({
        type: 'info',
        message: `Phase 4: Corrected ${violations} time constraint violations`
      });
    }
    
    this.notifications.push({
      type: 'info',
      message: 'Phase 4: Validation and optimization completed'
    });
  }

  private redistributeExcessTasks(overloadedDay: DailySchedule, excessTime: number): void {
    // Sort tasks by priority (lowest first)
    const sortedTasks = [...overloadedDay.tasks]
      .sort((a, b) => (TASK_TYPE_PRIORITY[b.type] || 99) - (TASK_TYPE_PRIORITY[a.type] || 99));
    
    let timeToRedistribute = excessTime;
    const tasksToMove: ScheduledTask[] = [];
    
    for (const task of sortedTasks) {
      if (timeToRedistribute <= 0) break;
      
      tasksToMove.push(task);
      timeToRedistribute -= task.durationMinutes;
    }
    
    // Remove tasks from overloaded day
    overloadedDay.tasks = overloadedDay.tasks.filter(task => 
      !tasksToMove.some(t => t.id === task.id)
    );
    
    // Try to place moved tasks on other days
    for (const task of tasksToMove) {
      let taskMoved = false;
      
      for (const day of this.studyDays) {
        if (day.date !== overloadedDay.date && this.getRemainingTime(day) >= task.durationMinutes) {
          day.tasks.push(task);
          taskMoved = true;
          break;
        }
      }
      
      if (!taskMoved) {
        // Put back if can't be moved
        overloadedDay.tasks.push(task);
      }
    }
  }

  /**
   * FINALIZATION
   */
  
  private finalizeSchedule(): void {
    // Sort tasks within each day
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      day.tasks.forEach((task, index) => {
        task.order = index;
      });
    }
    
    // Generate summary
    const totalScheduledTime = this.schedule
      .reduce((sum, day) => sum + day.tasks.reduce((daySum, task) => daySum + task.durationMinutes, 0), 0);
    
    const totalAvailableTime = this.studyDays
      .reduce((sum, day) => sum + day.totalStudyTimeMinutes, 0);
    
    const utilizationPercentage = totalAvailableTime > 0 
      ? ((totalScheduledTime / totalAvailableTime) * 100).toFixed(1)
      : '0';
    
    this.notifications.push({
      type: 'info',
      message: `Schedule complete: ${totalScheduledTime}min/${totalAvailableTime}min scheduled (${utilizationPercentage}% utilization)`
    });
    
    // Report unscheduled resources
    const unscheduledCount = this.remainingResources.size;
    if (unscheduledCount > 0) {
      this.notifications.push({
        type: 'warning',
        message: `${unscheduledCount} resources remain unscheduled`
      });
      
      // Show examples of unscheduled resources
      const examples = Array.from(this.remainingResources)
        .slice(0, 5)
        .map(id => {
          const resource = this.allResources.get(id);
          return resource ? `"${resource.title}" (${resource.durationMinutes}min)` : id;
        });
      
      if (examples.length > 0) {
        this.notifications.push({
          type: 'info',
          message: `Unscheduled examples: ${examples.join(', ')}`
        });
      }
    }
    
    // Board Vitals completion rate
    if (this.totalBoardVitalsQuestions > 0) {
      const completionRate = ((this.scheduledBoardVitalsQuestions / this.totalBoardVitalsQuestions) * 100).toFixed(1);
      this.notifications.push({
        type: 'info',
        message: `Board Vitals: ${this.scheduledBoardVitalsQuestions}/${this.totalBoardVitalsQuestions} questions scheduled (${completionRate}%)`
      });
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
      
      if (this.allResources.size === 0) {
        throw new Error('No resources available');
      }
      
      this.notifications.push({
        type: 'info',
        message: `Starting 4-phase algorithm: ${this.studyDays.length} days, ${this.allResources.size} resources`
      });
      
      // Execute all phases
      this.executePhase1();
      this.executePhase2();
      this.executePhase3();
      this.executePhase4();
      this.finalizeSchedule();
      
      // Build progress tracking
      const progressPerDomain = this.buildProgressTracking();
      
      const studyPlan: StudyPlan = {
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
      };
      
      return {
        plan: studyPlan,
        notifications: this.notifications
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.notifications.push({
        type: 'error',
        message: `Scheduling failed: ${errorMessage}`
      });
      
      // Return empty plan with error notifications
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
    
    // Calculate completed time from scheduled tasks
    for (const day of this.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && progressPerDomain[task.originalTopic]) {
          progressPerDomain[task.originalTopic]!.completedMinutes += task.durationMinutes;
        }
      }
    }
    
    return progressPerDomain;
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
    const scheduler = new RobustScheduler(
      startDateStr,
      endDateStr,
      exceptionRules,
      resourcePool,
      topicOrder || DEFAULT_TOPIC_ORDER,
      deadlines || {},
      areSpecialTopicsInterleaved ?? true
    );
    
    return scheduler.generateSchedule();
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
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
      notifications: [
        {
          type: 'error',
          message: `Schedule generation failed: ${errorMessage}`
        }
      ]
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
    
    // Determine rebalance start date
    let rebalanceStartDate: string;
    if (options.type === 'standard') {
      rebalanceStartDate = options.rebalanceDate && options.rebalanceDate > today 
        ? options.rebalanceDate 
        : today;
    } else {
      rebalanceStartDate = options.date;
    }
    
    // Ensure rebalance date is within plan bounds
    if (rebalanceStartDate > currentPlan.endDate) {
      rebalanceStartDate = currentPlan.endDate;
    }
    
    if (rebalanceStartDate < currentPlan.startDate) {
      rebalanceStartDate = currentPlan.startDate;
    }
    
    // Preserve past schedule
    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStartDate);
    
    // Collect completed resources
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
    const scheduler = new RobustScheduler(
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
    
    // Recalculate progress
    const updatedProgress = result.plan.progressPerDomain;
    for (const day of result.plan.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && updatedProgress[task.originalTopic]) {
          updatedProgress[task.originalTopic]!.completedMinutes += task.durationMinutes;
        }
      }
    }
    
    return result;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      plan: currentPlan,
      notifications: [
        {
          type: 'error',
          message: `Rebalance failed: ${errorMessage}`
        }
      ]
    };
  }
};
