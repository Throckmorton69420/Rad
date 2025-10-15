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
 * TEMPLATE-BASED SEQUENTIAL SCHEDULER
 * 
 * Each day follows EXACTLY this template:
 * 1. Titan video(s) + paired Crack the Core + paired Case Companion + paired QEVLAR
 * 2. Huda physics lecture + paired Huda QB + paired Huda textbook
 * 3. Titan nucs + paired Crack the Core + War Machine + NucApp + QEVLAR nucs
 * 4. NIS/RISC documents + paired NIS QB + relevant QEVLAR
 * 5. Board Vitals mixed questions (single synthetic task)
 * 6. Titan physics videos + War Machine + Physics app + QEVLAR physics
 * 7. ONLY THEN: supplementary content (Discord → Core Radiology)
 */

// Exact Titan topic sequence
const TITAN_SEQUENCE = [
  'pancreas', 'liver', 'renal', 'reproductive', 'abdominal barium',
  'chest', 'thyroid', 'musculoskeletal', 'neuro', 'pediatric', 
  'cardiac', 'breast', 'nuclear', 'interventional', 'vascular', 'physics'
];

interface DailyTemplate {
  date: string;
  dayIndex: number;
  titanTopicIndex: number;
  titanTopic: string;
  completedSteps: Set<number>; // Track which steps are complete
}

interface ResourcePool {
  titanVideos: StudyResource[];
  crackTheCore: StudyResource[];
  caseCompanion: StudyResource[];
  qevlar: StudyResource[];
  huda: StudyResource[];
  nuclear: StudyResource[];
  nucApp: StudyResource[];
  nisRisc: StudyResource[];
  boardVitals: StudyResource[];
  physics: StudyResource[];
  discord: StudyResource[];
  coreRadiology: StudyResource[];
}

class TemplateBasedScheduler {
  private allResources = new Map<string, StudyResource>();
  private remainingResources = new Set<string>();
  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private dailyTemplates: DailyTemplate[] = [];
  private notifications: Array<{type: 'error' | 'warning' | 'info', message: string}> = [];
  
  private pools: ResourcePool;
  private coveredTopicsPerDay = new Map<string, Set<Domain>>();
  private taskCounter = 0;
  
  // Board Vitals tracking
  private totalBoardVitalsQuestions = 0;
  private scheduledBoardVitalsQuestions = 0;
  
  private topicOrder: Domain[];
  private deadlines: DeadlineSettings;
  private areSpecialTopicsInterleaved: boolean;

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
    
    // Process and categorize resources
    const processedResources = this.chunkLargeResources(resourcePool);
    processedResources.forEach(resource => {
      this.allResources.set(resource.id, resource);
      this.remainingResources.add(resource.id);
    });
    
    // Create schedule structure
    this.schedule = this.createDaySchedules(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);
    
    // Initialize tracking
    this.studyDays.forEach(day => {
      this.coveredTopicsPerDay.set(day.date, new Set<Domain>());
    });
    
    // Categorize resources into pools
    this.pools = this.categorizeResourcesIntoPools();
    
    // Create daily templates
    this.createDailyTemplates();
    
    this.notifications.push({
      type: 'info',
      message: `Template scheduler initialized: ${this.studyDays.length} days, ${this.allResources.size} resources`
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

  private categorizeResourcesIntoPools(): ResourcePool {
    const pools: ResourcePool = {
      titanVideos: [],
      crackTheCore: [],
      caseCompanion: [],
      qevlar: [],
      huda: [],
      nuclear: [],
      nucApp: [],
      nisRisc: [],
      boardVitals: [],
      physics: [],
      discord: [],
      coreRadiology: []
    };
    
    for (const resource of this.allResources.values()) {
      const title = (resource.title || '').toLowerCase();
      const videoSource = (resource.videoSource || '').toLowerCase();
      const bookSource = (resource.bookSource || '').toLowerCase();
      
      if (videoSource.includes('titan')) {
        pools.titanVideos.push(resource);
      } else if (bookSource.includes('crack the core')) {
        pools.crackTheCore.push(resource);
      } else if (bookSource.includes('case companion')) {
        pools.caseCompanion.push(resource);
      } else if (bookSource.includes('qevlar')) {
        pools.qevlar.push(resource);
      } else if ((videoSource.includes('huda') || bookSource.includes('huda')) && resource.domain === Domain.PHYSICS) {
        pools.huda.push(resource);
      } else if (resource.domain === Domain.NUCLEAR_MEDICINE) {
        pools.nuclear.push(resource);
        if (bookSource.includes('nucapp')) {
          pools.nucApp.push(resource);
        }
      } else if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) {
        pools.nisRisc.push(resource);
      } else if (bookSource.includes('board vitals')) {
        pools.boardVitals.push(resource);
        this.totalBoardVitalsQuestions += (resource.questionCount || 0);
      } else if (resource.domain === Domain.PHYSICS) {
        pools.physics.push(resource);
      } else if (videoSource.includes('discord')) {
        pools.discord.push(resource);
      } else if (bookSource.includes('core radiology') || title.includes('core radiology')) {
        pools.coreRadiology.push(resource);
      }
    }
    
    // Sort all pools by sequence order
    Object.values(pools).forEach(pool => {
      pool.sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    });
    
    // Sort Titan videos by canonical sequence
    pools.titanVideos.sort((a, b) => {
      const aIndex = this.getTitanSequenceIndex(a.title);
      const bIndex = this.getTitanSequenceIndex(b.title);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
    });
    
    return pools;
  }

  private createDailyTemplates(): void {
    this.dailyTemplates = this.studyDays.map((day, index) => ({
      date: day.date,
      dayIndex: index,
      titanTopicIndex: index % TITAN_SEQUENCE.length,
      titanTopic: TITAN_SEQUENCE[index % TITAN_SEQUENCE.length],
      completedSteps: new Set<number>()
    }));
  }

  private getTitanSequenceIndex(title: string): number {
    const normalizedTitle = title.toLowerCase();
    
    for (let i = 0; i < TITAN_SEQUENCE.length; i++) {
      if (normalizedTitle.includes(TITAN_SEQUENCE[i])) {
        return i;
      }
    }
    
    // Handle special cases
    if (normalizedTitle.includes('msk')) return TITAN_SEQUENCE.indexOf('musculoskeletal');
    if (normalizedTitle.includes('peds')) return TITAN_SEQUENCE.indexOf('pediatric');
    if (normalizedTitle.includes('ir')) return TITAN_SEQUENCE.indexOf('interventional');
    
    return TITAN_SEQUENCE.length; // Unknown goes last
  }

  private isTopicallyRelated(anchor: StudyResource, candidate: StudyResource): boolean {
    // Same domain
    if (anchor.domain === candidate.domain) return true;
    
    // Same chapter
    if (anchor.chapterNumber && candidate.chapterNumber && 
        anchor.chapterNumber === candidate.chapterNumber) return true;
    
    // Topic keyword matching
    const anchorTitle = (anchor.title || '').toLowerCase();
    const candidateTitle = (candidate.title || '').toLowerCase();
    
    const keywords = [
      'pancreas', 'liver', 'renal', 'kidney', 'reproductive', 'gynecologic', 'prostate', 'testicular',
      'barium', 'esophagus', 'stomach', 'bowel', 'colon', 'gi',
      'chest', 'thorax', 'lung', 'pulmonary', 'mediastinum',
      'thyroid', 'parathyroid', 'neck',
      'musculoskeletal', 'msk', 'bone', 'joint', 'spine',
      'neuro', 'brain', 'neurological', 'head',
      'pediatric', 'peds', 'child',
      'cardiac', 'heart', 'coronary', 'cardiovascular',
      'breast', 'mammography', 'mammo',
      'nuclear', 'pet', 'spect', 'scintigraphy',
      'interventional', 'vascular', 'angiography', 'ir',
      'physics', 'ct', 'mri', 'ultrasound', 'radiation'
    ];
    
    return keywords.some(keyword => 
      anchorTitle.includes(keyword) && candidateTitle.includes(keyword)
    );
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

  private createSyntheticBoardVitalsTask(day: DailySchedule, targetQuestions: number, suggestedSubjects: string[]): ScheduledTask {
    this.taskCounter++;
    const actualMinutes = Math.ceil(targetQuestions * 2); // 2 minutes per question
    
    const subjectList = suggestedSubjects.length > 0 
      ? suggestedSubjects.join(', ') 
      : 'mixed topics';
    
    return {
      id: `synthetic_bv_${day.date}_${this.taskCounter}`,
      resourceId: `bv_mixed_${day.date}`,
      title: `Board Vitals - Mixed ${targetQuestions} questions (suggested: ${subjectList})`,
      type: ResourceType.QUESTIONS,
      originalTopic: Domain.MIXED_REVIEW,
      durationMinutes: actualMinutes,
      status: 'pending',
      order: day.tasks.length,
      isOptional: false,
      isPrimaryMaterial: true,
      questionCount: targetQuestions
    };
  }

  /**
   * MAIN TEMPLATE-BASED SCHEDULING ALGORITHM
   */
  
  public generateScheduleUsingTemplate(): GeneratedStudyPlanOutcome {
    try {
      if (this.studyDays.length === 0) {
        throw new Error('No study days available');
      }
      
      this.notifications.push({
        type: 'info',
        message: `Starting template-based sequential scheduling: ${this.studyDays.length} days`
      });
      
      // Execute daily template for each day
      for (let dayIndex = 0; dayIndex < this.studyDays.length; dayIndex++) {
        this.executeDailyTemplate(dayIndex);
      }
      
      // Final validation and optimization
      this.finalValidationAndMopUp();
      
      // Generate summary
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
        message: `Template scheduling failed: ${errorMessage}`
      });
      
      return this.createEmptyPlan();
    }
  }

  private executeDailyTemplate(dayIndex: number): void {
    const day = this.studyDays[dayIndex];
    const template = this.dailyTemplates[dayIndex];
    
    this.notifications.push({
      type: 'info',
      message: `Day ${dayIndex + 1} (${day.date}): Executing template for ${template.titanTopic}`
    });
    
    // Step 1: Titan video + paired content
    this.executeStep1TitanBlock(day, template);
    
    // Step 2: Huda physics block
    this.executeStep2HudaBlock(day, template);
    
    // Step 3: Nuclear medicine block
    this.executeStep3NuclearBlock(day, template);
    
    // Step 4: NIS/RISC block
    this.executeStep4NisRiscBlock(day, template);
    
    // Step 5: Board Vitals mixed questions
    this.executeStep5BoardVitals(day, template, dayIndex);
    
    // Step 6: Physics block
    this.executeStep6PhysicsBlock(day, template);
    
    // Step 7: Supplementary content (Discord then Core Radiology)
    this.executeStep7SupplementaryContent(day, template);
    
    const dayTotal = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    const utilization = ((dayTotal / day.totalStudyTimeMinutes) * 100).toFixed(1);
    
    this.notifications.push({
      type: 'info',
      message: `Day ${dayIndex + 1} complete: ${dayTotal}min/${day.totalStudyTimeMinutes}min (${utilization}%)`
    });
  }

  private executeStep1TitanBlock(day: DailySchedule, template: DailyTemplate): void {
    // Find Titan video for this topic
    const titanVideo = this.pools.titanVideos.find(video => 
      this.remainingResources.has(video.id) && 
      video.title.toLowerCase().includes(template.titanTopic)
    );
    
    if (titanVideo) {
      this.addTaskToDay(day, titanVideo);
      
      // Find paired Crack the Core content
      const pairedCrackTheCore = this.pools.crackTheCore.filter(resource => 
        this.remainingResources.has(resource.id) && 
        this.isTopicallyRelated(titanVideo, resource)
      );
      
      pairedCrackTheCore.forEach(resource => {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      });
      
      // Find paired Case Companion content
      const pairedCaseCompanion = this.pools.caseCompanion.filter(resource => 
        this.remainingResources.has(resource.id) && 
        this.isTopicallyRelated(titanVideo, resource)
      );
      
      pairedCaseCompanion.forEach(resource => {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      });
      
      // Find paired QEVLAR content
      const pairedQevlar = this.pools.qevlar.filter(resource => 
        this.remainingResources.has(resource.id) && 
        this.isTopicallyRelated(titanVideo, resource)
      );
      
      pairedQevlar.forEach(resource => {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      });
      
      template.completedSteps.add(1);
    }
  }

  private executeStep2HudaBlock(day: DailySchedule, template: DailyTemplate): void {
    // Find next available Huda lecture
    const hudaLecture = this.pools.huda.find(resource => 
      this.remainingResources.has(resource.id) && 
      (resource.type === ResourceType.VIDEO_LECTURE || resource.type === ResourceType.HIGH_YIELD_VIDEO)
    );
    
    if (hudaLecture && this.getRemainingTime(day) >= hudaLecture.durationMinutes) {
      this.addTaskToDay(day, hudaLecture);
      
      // Find paired Huda QB and textbook
      const pairedHuda = this.pools.huda.filter(resource => 
        this.remainingResources.has(resource.id) && 
        resource.id !== hudaLecture.id &&
        this.isTopicallyRelated(hudaLecture, resource)
      );
      
      pairedHuda.slice(0, 3).forEach(resource => {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      });
      
      template.completedSteps.add(2);
    }
  }

  private executeStep3NuclearBlock(day: DailySchedule, template: DailyTemplate): void {
    // Find next available nuclear content
    const nuclearAnchor = this.pools.nuclear.find(resource => 
      this.remainingResources.has(resource.id)
    );
    
    if (nuclearAnchor && this.getRemainingTime(day) >= nuclearAnchor.durationMinutes) {
      this.addTaskToDay(day, nuclearAnchor);
      
      // Find paired nuclear content
      const pairedNuclear = this.pools.nuclear.filter(resource => 
        this.remainingResources.has(resource.id) && 
        resource.id !== nuclearAnchor.id &&
        this.isTopicallyRelated(nuclearAnchor, resource)
      );
      
      // Add NucApp content
      const pairedNucApp = this.pools.nucApp.filter(resource => 
        this.remainingResources.has(resource.id) && 
        this.isTopicallyRelated(nuclearAnchor, resource)
      );
      
      // Add nuclear QEVLAR
      const nuclearQevlar = this.pools.qevlar.filter(resource => 
        this.remainingResources.has(resource.id) && 
        resource.domain === Domain.NUCLEAR_MEDICINE &&
        this.isTopicallyRelated(nuclearAnchor, resource)
      );
      
      [...pairedNuclear.slice(0, 2), ...pairedNucApp.slice(0, 2), ...nuclearQevlar.slice(0, 2)].forEach(resource => {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      });
      
      template.completedSteps.add(3);
    }
  }

  private executeStep4NisRiscBlock(day: DailySchedule, template: DailyTemplate): void {
    // Find next available NIS/RISC content
    const nisRiscContent = this.pools.nisRisc.find(resource => 
      this.remainingResources.has(resource.id)
    );
    
    if (nisRiscContent && this.getRemainingTime(day) >= nisRiscContent.durationMinutes) {
      this.addTaskToDay(day, nisRiscContent);
      
      // Find paired NIS QEVLAR
      const nisQevlar = this.pools.qevlar.filter(resource => 
        this.remainingResources.has(resource.id) && 
        (resource.domain === Domain.NIS || resource.domain === Domain.RISC) &&
        this.isTopicallyRelated(nisRiscContent, resource)
      );
      
      nisQevlar.slice(0, 2).forEach(resource => {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      });
      
      template.completedSteps.add(4);
    }
  }

  private executeStep5BoardVitals(day: DailySchedule, template: DailyTemplate, dayIndex: number): void {
    const remainingTime = this.getRemainingTime(day);
    if (remainingTime < 30) return; // Need minimum time
    
    // Calculate daily quota
    const remainingDays = this.studyDays.length - dayIndex;
    const remainingQuestions = Math.max(0, this.totalBoardVitalsQuestions - this.scheduledBoardVitalsQuestions);
    
    if (remainingQuestions === 0) return;
    
    const avgQuestionsPerDay = Math.ceil(remainingQuestions / Math.max(1, remainingDays));
    const maxQuestionsByTime = Math.floor(remainingTime * 0.3 * 0.5); // 30% of time, 0.5 Q/min
    const targetQuestions = Math.min(avgQuestionsPerDay, maxQuestionsByTime, remainingQuestions);
    
    if (targetQuestions > 0) {
      // Get suggested subjects from covered topics up to this day
      const suggestedSubjects: string[] = [];
      for (let i = 0; i <= dayIndex; i++) {
        const dayTopics = this.coveredTopicsPerDay.get(this.studyDays[i].date) || new Set();
        dayTopics.forEach(topic => {
          const topicStr = topic.toString().replace(/_/g, ' ').toLowerCase();
          if (!['nis', 'risc', 'mixed review', 'high yield'].includes(topicStr) && 
              !suggestedSubjects.includes(topicStr)) {
            suggestedSubjects.push(topicStr);
          }
        });
      }
      
      // Create synthetic Board Vitals task
      const bvTask = this.createSyntheticBoardVitalsTask(day, targetQuestions, suggestedSubjects);
      day.tasks.push(bvTask);
      this.scheduledBoardVitalsQuestions += targetQuestions;
      this.coveredTopicsPerDay.get(day.date)?.add(Domain.MIXED_REVIEW);
      
      template.completedSteps.add(5);
    }
  }

  private executeStep6PhysicsBlock(day: DailySchedule, template: DailyTemplate): void {
    // Find next available Titan physics or general physics content
    const physicsContent = this.pools.physics.find(resource => 
      this.remainingResources.has(resource.id)
    );
    
    if (physicsContent && this.getRemainingTime(day) >= physicsContent.durationMinutes) {
      this.addTaskToDay(day, physicsContent);
      
      // Find paired physics QEVLAR
      const physicsQevlar = this.pools.qevlar.filter(resource => 
        this.remainingResources.has(resource.id) && 
        resource.domain === Domain.PHYSICS &&
        this.isTopicallyRelated(physicsContent, resource)
      );
      
      physicsQevlar.slice(0, 1).forEach(resource => {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          this.addTaskToDay(day, resource);
        }
      });
      
      template.completedSteps.add(6);
    }
  }

  private executeStep7SupplementaryContent(day: DailySchedule, template: DailyTemplate): void {
    const dayTopics = this.coveredTopicsPerDay.get(day.date) || new Set();
    
    // First: Discord lectures by relevancy
    const relevantDiscord = this.pools.discord
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => this.calculateRelevancyScore(b, dayTopics) - this.calculateRelevancyScore(a, dayTopics));
    
    for (const resource of relevantDiscord) {
      if (this.getRemainingTime(day) >= resource.durationMinutes) {
        this.addTaskToDay(day, resource);
      }
    }
    
    // Then: Core Radiology by relevancy
    const relevantCoreRad = this.pools.coreRadiology
      .filter(resource => this.remainingResources.has(resource.id))
      .sort((a, b) => this.calculateRelevancyScore(b, dayTopics) - this.calculateRelevancyScore(a, dayTopics));
    
    for (const resource of relevantCoreRad) {
      if (this.getRemainingTime(day) >= resource.durationMinutes) {
        this.addTaskToDay(day, resource);
      }
    }
    
    template.completedSteps.add(7);
  }

  private calculateRelevancyScore(resource: StudyResource, dayTopics: Set<Domain>): number {
    let score = 0;
    
    // Perfect domain match
    if (dayTopics.has(resource.domain)) score += 100;
    
    // Related domain match
    const relatedDomains = this.getRelatedDomains(resource.domain);
    relatedDomains.forEach(domain => {
      if (dayTopics.has(domain)) score += 50;
    });
    
    // Shorter content for better gap filling
    if (resource.durationMinutes <= 5) score += 20;
    else if (resource.durationMinutes <= 15) score += 15;
    else if (resource.durationMinutes <= 30) score += 10;
    
    // Primary material bonus
    if (resource.isPrimaryMaterial) score += 25;
    
    return score;
  }

  private getRelatedDomains(domain: Domain): Domain[] {
    const relations: Record<Domain, Domain[]> = {
      [Domain.GASTROINTESTINAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.GENITOURINARY_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.ULTRASOUND_IMAGING],
      [Domain.THORACIC_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.NUCLEAR_MEDICINE],
      [Domain.CARDIOVASCULAR_IMAGING]: [Domain.THORACIC_IMAGING, Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.NEURORADIOLOGY]: [Domain.PEDIATRIC_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.PEDIATRIC_RADIOLOGY]: [Domain.NEURORADIOLOGY, Domain.THORACIC_IMAGING, Domain.GASTROINTESTINAL_IMAGING],
      [Domain.MUSCULOSKELETAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.INTERVENTIONAL_RADIOLOGY]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GASTROINTESTINAL_IMAGING, Domain.GENITOURINARY_IMAGING],
      [Domain.BREAST_IMAGING]: [Domain.NUCLEAR_MEDICINE, Domain.ULTRASOUND_IMAGING, Domain.PHYSICS],
      [Domain.ULTRASOUND_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GENITOURINARY_IMAGING, Domain.BREAST_IMAGING],
      [Domain.NUCLEAR_MEDICINE]: [Domain.PHYSICS],
      [Domain.PHYSICS]: [Domain.NUCLEAR_MEDICINE]
    };
    
    return relations[domain] || [];
  }

  private finalValidationAndMopUp(): void {
    this.notifications.push({
      type: 'info',
      message: 'Starting final validation and completeness mop-up'
    });
    
    // Mop up any remaining required content
    this.performCompleteMopUp();
    
    // Validate time constraints
    this.validateTimeConstraints();
    
    // Final task ordering
    this.finalizeTaskOrdering();
  }

  private performCompleteMopUp(): void {
    // Get ALL remaining required resources
    const requiredResources = Array.from(this.remainingResources)
      .map(id => this.allResources.get(id))
      .filter((resource): resource is StudyResource => 
        resource !== undefined && (
          (resource.bookSource || '').toLowerCase().includes('board vitals') ||
          (resource.bookSource || '').toLowerCase().includes('nucapp') ||
          (resource.bookSource || '').toLowerCase().includes('qevlar') ||
          resource.domain === Domain.NIS || 
          resource.domain === Domain.RISC ||
          resource.domain === Domain.PHYSICS ||
          resource.isPrimaryMaterial
        )
      )
      .sort((a, b) => {
        // Priority order: Board Vitals > NIS/RISC > NucApp > Physics > QEVLAR
        const getPriority = (r: StudyResource) => {
          const book = (r.bookSource || '').toLowerCase();
          if (book.includes('board vitals')) return 1;
          if (r.domain === Domain.NIS || r.domain === Domain.RISC) return 2;
          if (book.includes('nucapp')) return 3;
          if (r.domain === Domain.PHYSICS) return 4;
          if (book.includes('qevlar')) return 5;
          return 6;
        };
        
        const priorityA = getPriority(a);
        const priorityB = getPriority(b);
        
        if (priorityA !== priorityB) return priorityA - priorityB;
        return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
      });
    
    if (requiredResources.length === 0) {
      this.notifications.push({
        type: 'info',
        message: '✅ Perfect! All required resources scheduled.'
      });
      return;
    }
    
    // Find days with capacity, prioritizing under-filled days
    const daysWithCapacity = this.studyDays
      .map(day => ({
        day,
        remainingTime: this.getRemainingTime(day),
        currentUtilization: (day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0) / day.totalStudyTimeMinutes) * 100
      }))
      .filter(({remainingTime}) => remainingTime >= 5)
      .sort((a, b) => {
        // Prioritize days under 90% utilization first
        if (a.currentUtilization < 90 && b.currentUtilization >= 90) return -1;
        if (a.currentUtilization >= 90 && b.currentUtilization < 90) return 1;
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
      type: moppedUp === requiredResources.length ? 'info' : 'warning',
      message: `Mop-up complete: Placed ${moppedUp}/${requiredResources.length} remaining required resources`
    });
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
          message: `${day.date} exceeds limit by ${excess} minutes - redistributing`
        });
        
        this.redistributeExcessTasks(day, excess);
      }
    }
    
    if (violations > 0) {
      this.notifications.push({
        type: 'info',
        message: `Corrected ${violations} time violations`
      });
    }
  }

  private redistributeExcessTasks(overloadedDay: DailySchedule, excessTime: number): void {
    // Remove supplementary content first, then optional content
    const tasksByRemovalPriority = [...overloadedDay.tasks].sort((a, b) => {
      // Remove synthetic BV tasks last (they're required)
      if (a.resourceId.includes('bv_mixed') && !b.resourceId.includes('bv_mixed')) return 1;
      if (!a.resourceId.includes('bv_mixed') && b.resourceId.includes('bv_mixed')) return -1;
      
      // Remove supplementary content first
      const aIsSupplementary = (a.videoSource || '').toLowerCase().includes('discord') || 
                               (a.bookSource || '').toLowerCase().includes('core radiology');
      const bIsSupplementary = (b.videoSource || '').toLowerCase().includes('discord') || 
                               (b.bookSource || '').toLowerCase().includes('core radiology');
      
      if (aIsSupplementary && !bIsSupplementary) return -1;
      if (!aIsSupplementary && bIsSupplementary) return 1;
      
      // Then by task priority
      const priorityA = TASK_TYPE_PRIORITY[a.type] || 50;
      const priorityB = TASK_TYPE_PRIORITY[b.type] || 50;
      if (priorityA !== priorityB) return priorityB - priorityA;
      
      // Optional tasks before required
      if (a.isOptional !== b.isOptional) return a.isOptional ? -1 : 1;
      
      return b.durationMinutes - a.durationMinutes;
    });
    
    let timeToMove = excessTime;
    const tasksToMove: ScheduledTask[] = [];
    
    for (const task of tasksByRemovalPriority) {
      if (timeToMove <= 0) break;
      tasksToMove.push(task);
      timeToMove -= task.durationMinutes;
    }
    
    // Remove from current day
    overloadedDay.tasks = overloadedDay.tasks.filter(task => 
      !tasksToMove.some(t => t.id === task.id)
    );
    
    // Try to place on other days
    for (const task of tasksToMove) {
      const bestDay = this.studyDays
        .filter(d => d.date !== overloadedDay.date)
        .sort((a, b) => this.getRemainingTime(b) - this.getRemainingTime(a))
        .find(d => this.getRemainingTime(d) >= task.durationMinutes);
      
      if (bestDay) {
        bestDay.tasks.push({...task, order: bestDay.tasks.length});
      } else {
        // Put back if can't place anywhere
        overloadedDay.tasks.push(task);
      }
    }
  }

  private finalizeTaskOrdering(): void {
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      day.tasks.forEach((task, index) => {
        task.order = index;
      });
    }
  }

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
      message: `Final: ${totalScheduledTime}min/${totalAvailableTime}min (${utilizationPercentage}% utilization)`
    });
    
    // Board Vitals completion
    if (this.totalBoardVitalsQuestions > 0) {
      const bvCompletion = ((this.scheduledBoardVitalsQuestions / this.totalBoardVitalsQuestions) * 100).toFixed(1);
      this.notifications.push({
        type: 'info',
        message: `Board Vitals: ${this.scheduledBoardVitalsQuestions}/${this.totalBoardVitalsQuestions} questions (${bvCompletion}%)`
      });
    }
    
    // Template execution summary
    const completedTemplates = this.dailyTemplates.filter(t => t.completedSteps.size >= 6).length;
    this.notifications.push({
      type: 'info',
      message: `Daily templates: ${completedTemplates}/${this.dailyTemplates.length} completed all 6 core steps`
    });
    
    // Unscheduled summary
    if (this.remainingResources.size > 0) {
      const unscheduledExamples = Array.from(this.remainingResources)
        .slice(0, 5)
        .map(id => {
          const resource = this.allResources.get(id);
          return resource ? `"${resource.title}"` : id;
        });
      
      this.notifications.push({
        type: 'warning',
        message: `${this.remainingResources.size} resources unscheduled. Examples: ${unscheduledExamples.join(', ')}`
      });
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
    
    // Add completed time from scheduled tasks
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
    const scheduler = new TemplateBasedScheduler(
      startDateStr,
      endDateStr,
      exceptionRules,
      resourcePool,
      topicOrder || DEFAULT_TOPIC_ORDER,
      deadlines || {},
      areSpecialTopicsInterleaved ?? true
    );
    
    return scheduler.generateScheduleUsingTemplate();
    
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
    
    // Ensure date is within bounds
    rebalanceStartDate = Math.max(rebalanceStartDate, currentPlan.startDate);
    rebalanceStartDate = Math.min(rebalanceStartDate, currentPlan.endDate);
    
    // Preserve past schedule
    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStartDate);
    
    // Get completed resources
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
    
    // Create scheduler for remaining period
    const scheduler = new TemplateBasedScheduler(
      rebalanceStartDate,
      currentPlan.endDate,
      exceptionRules,
      availableResources,
      currentPlan.topicOrder,
      currentPlan.deadlines,
      currentPlan.areSpecialTopicsInterleaved
    );
    
    const result = scheduler.generateScheduleUsingTemplate();
    
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
