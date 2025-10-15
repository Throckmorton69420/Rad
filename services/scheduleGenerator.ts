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
 * STRICT 6-STEP DAILY TEMPLATE SCHEDULER
 * 
 * EXACTLY implements your daily structure:
 * Step 1: Titan video + paired Crack the Core + paired Case Companion + paired QEVLAR
 * Step 2: Huda physics lecture + paired Huda QB + paired Huda textbook  
 * Step 3: Titan nucs + paired Crack the Core + War Machine + NucApp + QEVLAR nucs
 * Step 4: NIS/RISC documents + paired NIS QB + relevant QEVLAR
 * Step 5: Board Vitals mixed questions (single synthetic task with suggested subjects)
 * Step 6: Titan physics videos + War Machine + Physics app + QEVLAR physics
 * Step 7: ONLY AFTER all above complete: Discord lectures → Core Radiology (relevancy-based)
 *
 * Topic order follows exact Titan video sequence.
 */

// EXACT Titan sequence from your PDF
const TITAN_SEQUENCE = [
  'pancreas', 'liver', 'renal', 'reproductive', 'abdominal barium',
  'chest', 'thyroid', 'musculoskeletal', 'neuro', 'pediatric', 
  'cardiac', 'breast', 'nuclear', 'interventional', 'vascular', 'physics'
];

interface ResourcePools {
  // Primary pools for template steps
  titanVideos: StudyResource[];
  crackTheCore: StudyResource[];
  caseCompanion: StudyResource[];
  qevlar: StudyResource[];
  huda: StudyResource[];
  nuclear: StudyResource[];
  warMachine: StudyResource[];
  nucApp: StudyResource[];
  nisRisc: StudyResource[];
  boardVitals: StudyResource[];
  physics: StudyResource[];
  physicsApp: StudyResource[];
  
  // Supplementary pools for step 7
  discord: StudyResource[];
  coreRadiology: StudyResource[];
}

interface DailyExecution {
  date: string;
  titanTopic: string;
  titanTopicIndex: number;
  stepsCompleted: number;
  coveredDomains: Set<Domain>;
}

class StrictTemplateScheduler {
  private allResources = new Map<string, StudyResource>();
  private availableResources = new Set<string>();
  
  private schedule: DailySchedule[] = [];
  private studyDays: DailySchedule[] = [];
  private dailyExecutions: DailyExecution[] = [];
  
  private pools: ResourcePools;
  private notifications: Array<{type: 'error' | 'warning' | 'info', message: string}> = [];
  private taskCounter = 0;
  
  // Board Vitals quota tracking
  private totalBoardVitalsQuestions = 0;
  private scheduledBoardVitalsQuestions = 0;
  
  // Global iterators for resource consumption
  private globalIterators = {
    titan: 0,
    huda: 0,
    nuclear: 0,
    nisRisc: 0,
    physics: 0,
    discord: 0,
    coreRad: 0
  };

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
    
    // Process resources
    const processedResources = this.chunkLargeResources(resourcePool);
    processedResources.forEach(resource => {
      this.allResources.set(resource.id, resource);
      this.availableResources.add(resource.id);
    });
    
    // Create schedule
    this.schedule = this.createDaySchedules(startDateStr, endDateStr, exceptionRules);
    this.studyDays = this.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);
    
    if (this.studyDays.length === 0) {
      throw new Error('No study days available');
    }
    
    // Categorize into strict pools
    this.pools = this.categorizeIntoStrictPools();
    
    // Create daily execution plans
    this.createDailyExecutionPlans();
    
    this.notifications.push({
      type: 'info',
      message: `Strict template scheduler: ${this.studyDays.length} days, ${this.allResources.size} resources, ${this.pools.titanVideos.length} Titan videos`
    });
  }

  private chunkLargeResources(resources: StudyResource[]): StudyResource[] {
    const chunked: StudyResource[] = [];
    
    for (const resource of resources) {
      if (resource.isSplittable && resource.durationMinutes > MIN_DURATION_for_SPLIT_PART * 1.5) {
        const parts = Math.ceil(resource.durationMinutes / MIN_DURATION_for_SPLIT_PART);
        const perPart = Math.floor(resource.durationMinutes / parts);
        
        for (let i = 0; i < parts; i++) {
          const isLast = i === parts - 1;
          const duration = isLast ? resource.durationMinutes - (perPart * i) : perPart;
          
          chunked.push({
            ...resource,
            id: `${resource.id}_part_${i + 1}`,
            title: `${resource.title} (Part ${i + 1}/${parts})`,
            durationMinutes: duration,
            isSplittable: false,
            pairedResourceIds: []
          });
        }
      } else {
        chunked.push(resource);
      }
    }
    
    return chunked;
  }

  private createDaySchedules(startDateStr: string, endDateStr: string, exceptionRules: ExceptionDateRule[]): DailySchedule[] {
    const startDate = parseDateString(startDateStr);
    const endDate = parseDateString(endDateStr);
    const exceptionMap = new Map(exceptionRules.map(rule => [rule.date, rule]));
    const days: DailySchedule[] = [];

    for (let date = new Date(startDate); date <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
      const dateStr = isoDate(date);
      const exception = exceptionMap.get(dateStr);
      
      days.push({
        date: dateStr,
        dayName: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        tasks: [],
        totalStudyTimeMinutes: Math.max(exception?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS, 0),
        isRestDay: exception?.isRestDayOverride ?? false,
        isManuallyModified: !!exception
      });
    }
    
    return days;
  }

  private categorizeIntoStrictPools(): ResourcePools {
    const pools: ResourcePools = {
      titanVideos: [], crackTheCore: [], caseCompanion: [], qevlar: [],
      huda: [], nuclear: [], warMachine: [], nucApp: [],
      nisRisc: [], boardVitals: [], physics: [], physicsApp: [],
      discord: [], coreRadiology: []
    };
    
    for (const resource of this.allResources.values()) {
      const title = (resource.title || '').toLowerCase();
      const video = (resource.videoSource || '').toLowerCase();
      const book = (resource.bookSource || '').toLowerCase();
      
      // Strict categorization
      if (video.includes('titan')) {
        pools.titanVideos.push(resource);
      } else if (book.includes('crack the core') && !book.includes('case companion')) {
        pools.crackTheCore.push(resource);
      } else if (book.includes('case companion')) {
        pools.caseCompanion.push(resource);
      } else if (book.includes('qevlar')) {
        pools.qevlar.push(resource);
      } else if ((video.includes('huda') || book.includes('huda')) && resource.domain === Domain.PHYSICS) {
        pools.huda.push(resource);
      } else if (resource.domain === Domain.NUCLEAR_MEDICINE && !book.includes('nucapp')) {
        pools.nuclear.push(resource);
      } else if (book.includes('war machine')) {
        pools.warMachine.push(resource);
      } else if (book.includes('nucapp')) {
        pools.nucApp.push(resource);
      } else if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) {
        pools.nisRisc.push(resource);
      } else if (book.includes('board vitals')) {
        pools.boardVitals.push(resource);
        this.totalBoardVitalsQuestions += (resource.questionCount || 0);
      } else if (resource.domain === Domain.PHYSICS && !video.includes('huda') && !book.includes('huda')) {
        if (title.includes('app') || book.includes('physics app')) {
          pools.physicsApp.push(resource);
        } else {
          pools.physics.push(resource);
        }
      } else if (video.includes('discord')) {
        pools.discord.push(resource);
      } else if (book.includes('core radiology') || title.includes('core radiology')) {
        pools.coreRadiology.push(resource);
      }
    }
    
    // Sort all pools by sequence order
    Object.values(pools).forEach(pool => {
      pool.sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    });
    
    // Sort Titan videos by EXACT canonical sequence
    pools.titanVideos.sort((a, b) => {
      const aIndex = this.getTitanSequenceIndex(a.title);
      const bIndex = this.getTitanSequenceIndex(b.title);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
    });
    
    return pools;
  }

  private getTitanSequenceIndex(title: string): number {
    const t = title.toLowerCase();
    
    for (let i = 0; i < TITAN_SEQUENCE.length; i++) {
      const topic = TITAN_SEQUENCE[i];
      if (t.includes(topic)) return i;
    }
    
    // Handle aliases
    if (t.includes('msk')) return TITAN_SEQUENCE.indexOf('musculoskeletal');
    if (t.includes('peds')) return TITAN_SEQUENCE.indexOf('pediatric');
    if (t.includes('ir')) return TITAN_SEQUENCE.indexOf('interventional');
    
    return 999; // Unknown
  }

  private createDailyExecutionPlans(): void {
    this.dailyExecutions = this.studyDays.map((day, index) => ({
      date: day.date,
      titanTopic: TITAN_SEQUENCE[index % TITAN_SEQUENCE.length],
      titanTopicIndex: index % TITAN_SEQUENCE.length,
      stepsCompleted: 0,
      coveredDomains: new Set<Domain>()
    }));
  }

  private getRemainingTime(day: DailySchedule): number {
    const used = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    return Math.max(0, day.totalStudyTimeMinutes - used);
  }

  private createTask(resource: StudyResource, order: number): ScheduledTask {
    this.taskCounter++;
    const originalId = resource.id.includes('_part_') 
      ? resource.id.split('_part_')[0] 
      : resource.id;
    
    return {
      id: `task_${resource.id}_${this.taskCounter}`,
      resourceId: resource.id,
      originalResourceId: originalId,
      title: resource.title,
      type: resource.type,
      originalTopic: resource.domain,
      durationMinutes: resource.durationMinutes,
      status: 'pending',
      order,
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
    if (!this.availableResources.has(resource.id)) return false;
    if (this.getRemainingTime(day) < resource.durationMinutes) return false;
    
    const task = this.createTask(resource, day.tasks.length);
    day.tasks.push(task);
    this.availableResources.delete(resource.id);
    
    const execution = this.dailyExecutions.find(e => e.date === day.date);
    execution?.coveredDomains.add(resource.domain);
    
    return true;
  }

  private isTopicallyRelated(anchor: StudyResource, candidate: StudyResource): boolean {
    // Same domain match
    if (anchor.domain === candidate.domain) return true;
    
    // Chapter number match
    if (anchor.chapterNumber && candidate.chapterNumber && 
        anchor.chapterNumber === candidate.chapterNumber) return true;
    
    // Title keyword matching
    const anchorTitle = (anchor.title || '').toLowerCase();
    const candidateTitle = (candidate.title || '').toLowerCase();
    
    const topicKeywords = [
      // GI
      'pancreas', 'liver', 'hepatic', 'biliary', 'gallbladder', 'spleen', 'stomach', 'gastric',
      'esophagus', 'bowel', 'colon', 'intestine', 'abdomen', 'gi', 'gastrointestinal',
      
      // GU  
      'renal', 'kidney', 'ureter', 'bladder', 'urethra', 'prostate', 'testicular', 'scrotal',
      'uterus', 'ovary', 'cervix', 'vagina', 'reproductive', 'gynecologic', 'obstetric',
      
      // Chest/Cardiac
      'lung', 'pulmonary', 'thorax', 'chest', 'mediastinum', 'pleura', 'trachea', 'bronch',
      'heart', 'cardiac', 'coronary', 'aorta', 'valve', 'pericardium',
      
      // Neuro/Head&Neck  
      'brain', 'cerebral', 'skull', 'spine', 'cord', 'neuro', 'head', 'neck',
      'thyroid', 'parathyroid', 'salivary', 'sinus', 'temporal', 'orbit',
      
      // MSK
      'bone', 'joint', 'spine', 'muscle', 'tendon', 'ligament', 'msk', 'musculoskeletal',
      'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'pelvis',
      
      // Breast
      'breast', 'mammography', 'mammo',
      
      // Nuclear/Physics
      'nuclear', 'pet', 'spect', 'scintigraphy', 'radiotracer',
      'physics', 'ct', 'mri', 'ultrasound', 'radiation', 'dose',
      
      // Peds
      'pediatric', 'peds', 'child', 'infant', 'neonatal',
      
      // IR/Vascular
      'interventional', 'vascular', 'angiography', 'embolization', 'stent'
    ];
    
    return topicKeywords.some(keyword => 
      anchorTitle.includes(keyword) && candidateTitle.includes(keyword)
    );
  }

  private createSyntheticBoardVitalsTask(
    day: DailySchedule, 
    execution: DailyExecution,
    dayIndex: number
  ): ScheduledTask | null {
    const remainingTime = this.getRemainingTime(day);
    if (remainingTime < 30) return null;
    
    // Calculate quota
    const remainingDays = this.studyDays.length - dayIndex;
    const remainingQuestions = Math.max(0, this.totalBoardVitalsQuestions - this.scheduledBoardVitalsQuestions);
    
    if (remainingQuestions === 0) return null;
    
    const avgPerDay = Math.ceil(remainingQuestions / Math.max(1, remainingDays));
    const maxByTime = Math.floor(remainingTime * 0.25 * 0.5); // 25% max time, 0.5 Q/min
    const targetQuestions = Math.min(avgPerDay, maxByTime, remainingQuestions);
    
    if (targetQuestions === 0) return null;
    
    // Suggested subjects from covered domains up to this day
    const suggestedSubjects = new Set<string>();
    for (let i = 0; i <= dayIndex; i++) {
      const exec = this.dailyExecutions[i];
      exec.coveredDomains.forEach(domain => {
        const domainStr = domain.toString().replace(/_/g, ' ').toLowerCase();
        if (!['nis', 'risc', 'mixed review', 'high yield', 'final review'].includes(domainStr)) {
          suggestedSubjects.add(domainStr);
        }
      });
    }
    
    const subjectList = Array.from(suggestedSubjects).join(', ') || 'mixed topics';
    const minutes = Math.ceil(targetQuestions * 2); // 2 min per question
    
    this.taskCounter++;
    return {
      id: `synthetic_bv_${day.date}_${this.taskCounter}`,
      resourceId: `bv_mixed_${day.date}`,
      title: `Board Vitals - Mixed ${targetQuestions} questions (suggested: ${subjectList})`,
      type: ResourceType.QUESTIONS,
      originalTopic: Domain.MIXED_REVIEW,
      durationMinutes: minutes,
      status: 'pending',
      order: day.tasks.length,
      isOptional: false,
      isPrimaryMaterial: true,
      questionCount: targetQuestions
    };
  }

  private findPairedResources(anchor: StudyResource, pool: StudyResource[]): StudyResource[] {
    return pool.filter(resource => 
      this.availableResources.has(resource.id) && 
      this.isTopicallyRelated(anchor, resource)
    );
  }

  /**
   * STRICT 6-STEP DAILY TEMPLATE EXECUTION
   */
  
  public executeStrictTemplate(): GeneratedStudyPlanOutcome {
    try {
      this.notifications.push({
        type: 'info',
        message: 'Starting STRICT 6-step daily template execution'
      });
      
      // Execute template for each day in sequence
      for (let dayIndex = 0; dayIndex < this.studyDays.length; dayIndex++) {
        this.executeStrictDailyTemplate(dayIndex);
      }
      
      // Final completeness guarantee
      this.guaranteeCompleteness();
      
      // Validate and optimize
      this.validateAndOptimize();
      
      // Generate summary
      this.generateExecutionSummary();
      
      return {
        plan: {
          schedule: this.schedule,
          progressPerDomain: this.buildProgressTracking(),
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
      this.notifications.push({
        type: 'error',
        message: `Strict template execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      
      return this.createEmptyPlan();
    }
  }

  private executeStrictDailyTemplate(dayIndex: number): void {
    const day = this.studyDays[dayIndex];
    const execution = this.dailyExecutions[dayIndex];
    
    this.notifications.push({
      type: 'info',
      message: `Day ${dayIndex + 1} (${day.date}): Executing template for ${execution.titanTopic}`
    });
    
    // STEP 1: Titan video + paired content
    if (this.executeStep1_TitanBlock(day, execution)) execution.stepsCompleted++;
    
    // STEP 2: Huda physics block
    if (this.executeStep2_HudaBlock(day, execution)) execution.stepsCompleted++;
    
    // STEP 3: Nuclear medicine block  
    if (this.executeStep3_NuclearBlock(day, execution)) execution.stepsCompleted++;
    
    // STEP 4: NIS/RISC block
    if (this.executeStep4_NisRiscBlock(day, execution)) execution.stepsCompleted++;
    
    // STEP 5: Board Vitals mixed quota
    if (this.executeStep5_BoardVitalsQuota(day, execution, dayIndex)) execution.stepsCompleted++;
    
    // STEP 6: Physics block
    if (this.executeStep6_PhysicsBlock(day, execution)) execution.stepsCompleted++;
    
    // STEP 7: Supplementary content (only after steps 1-6)
    if (execution.stepsCompleted >= 6) {
      this.executeStep7_SupplementaryContent(day, execution);
    }
    
    const totalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    const utilization = ((totalTime / day.totalStudyTimeMinutes) * 100).toFixed(1);
    
    this.notifications.push({
      type: 'info',
      message: `Day ${dayIndex + 1}: ${execution.stepsCompleted}/6 core steps, ${totalTime}min (${utilization}%)`
    });
  }

  private executeStep1_TitanBlock(day: DailySchedule, execution: DailyExecution): boolean {
    // Find Titan video for this day's topic
    const titanVideo = this.pools.titanVideos.find(video => 
      this.availableResources.has(video.id) && 
      this.getTitanSequenceIndex(video.title) === execution.titanTopicIndex
    );
    
    if (!titanVideo) {
      // Try any available Titan video if specific topic not found
      const anyTitan = this.pools.titanVideos.find(video => 
        this.availableResources.has(video.id)
      );
      if (!anyTitan) return false;
      
      if (!this.addTaskToDay(day, anyTitan)) return false;
      
      // Find ALL paired content for this Titan video
      const pairedContent = [
        ...this.findPairedResources(anyTitan, this.pools.crackTheCore),
        ...this.findPairedResources(anyTitan, this.pools.caseCompanion),
        ...this.findPairedResources(anyTitan, this.pools.qevlar)
      ];
      
      // Add all paired content that fits
      for (const resource of pairedContent) {
        this.addTaskToDay(day, resource);
      }
      
      return true;
    }
    
    // Add the specific Titan video
    if (!this.addTaskToDay(day, titanVideo)) return false;
    
    // Add ALL paired content
    const pairedContent = [
      ...this.findPairedResources(titanVideo, this.pools.crackTheCore),
      ...this.findPairedResources(titanVideo, this.pools.caseCompanion),
      ...this.findPairedResources(titanVideo, this.pools.qevlar)
    ];
    
    for (const resource of pairedContent) {
      this.addTaskToDay(day, resource);
    }
    
    return true;
  }

  private executeStep2_HudaBlock(day: DailySchedule, execution: DailyExecution): boolean {
    // Find next Huda lecture
    const hudaLectures = this.pools.huda.filter(r => 
      this.availableResources.has(r.id) && 
      (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
    );
    
    if (hudaLectures.length === 0) return false;
    
    const hudaLecture = hudaLectures[this.globalIterators.huda % hudaLectures.length];
    this.globalIterators.huda++;
    
    if (!this.addTaskToDay(day, hudaLecture)) return false;
    
    // Add paired Huda content (QB + textbook)
    const pairedHuda = this.findPairedResources(hudaLecture, this.pools.huda)
      .filter(r => r.id !== hudaLecture.id)
      .slice(0, 4); // Limit to prevent day overflow
    
    for (const resource of pairedHuda) {
      this.addTaskToDay(day, resource);
    }
    
    return true;
  }

  private executeStep3_NuclearBlock(day: DailySchedule, execution: DailyExecution): boolean {
    // Find next nuclear content (prioritize Titan nuclear videos)
    const titanNuclear = this.pools.nuclear.filter(r =>
      this.availableResources.has(r.id) && 
      (r.videoSource || '').toLowerCase().includes('titan')
    );
    
    const nuclearAnchor = titanNuclear.length > 0 
      ? titanNuclear[0]
      : this.pools.nuclear.find(r => this.availableResources.has(r.id));
    
    if (!nuclearAnchor) return false;
    
    if (!this.addTaskToDay(day, nuclearAnchor)) return false;
    
    // Add paired nuclear content
    const pairedNuclear = [
      ...this.findPairedResources(nuclearAnchor, this.pools.nuclear).filter(r => r.id !== nuclearAnchor.id),
      ...this.findPairedResources(nuclearAnchor, this.pools.crackTheCore),
      ...this.findPairedResources(nuclearAnchor, this.pools.warMachine),
      ...this.findPairedResources(nuclearAnchor, this.pools.nucApp),
      ...this.pools.qevlar.filter(r => 
        this.availableResources.has(r.id) && 
        r.domain === Domain.NUCLEAR_MEDICINE &&
        this.isTopicallyRelated(nuclearAnchor, r)
      )
    ].slice(0, 6); // Limit block size
    
    for (const resource of pairedNuclear) {
      this.addTaskToDay(day, resource);
    }
    
    return true;
  }

  private executeStep4_NisRiscBlock(day: DailySchedule, execution: DailyExecution): boolean {
    // Find next NIS/RISC document
    const nisRiscDocs = this.pools.nisRisc.filter(r => 
      this.availableResources.has(r.id) && 
      r.type === ResourceType.READING_TEXTBOOK
    );
    
    if (nisRiscDocs.length === 0) return false;
    
    const nisRiscDoc = nisRiscDocs[this.globalIterators.nisRisc % nisRiscDocs.length];
    this.globalIterators.nisRisc++;
    
    if (!this.addTaskToDay(day, nisRiscDoc)) return false;
    
    // Add paired NIS QB and relevant QEVLAR
    const pairedNisContent = [
      ...this.pools.nisRisc.filter(r => 
        this.availableResources.has(r.id) && 
        r.type === ResourceType.QUESTIONS &&
        r.id !== nisRiscDoc.id
      ),
      ...this.pools.qevlar.filter(r => 
        this.availableResources.has(r.id) && 
        (r.domain === Domain.NIS || r.domain === Domain.RISC)
      )
    ].slice(0, 3);
    
    for (const resource of pairedNisContent) {
      this.addTaskToDay(day, resource);
    }
    
    return true;
  }

  private executeStep5_BoardVitalsQuota(day: DailySchedule, execution: DailyExecution, dayIndex: number): boolean {
    const syntheticBVTask = this.createSyntheticBoardVitalsTask(day, execution, dayIndex);
    
    if (!syntheticBVTask) return false;
    
    day.tasks.push(syntheticBVTask);
    this.scheduledBoardVitalsQuestions += syntheticBVTask.questionCount || 0;
    execution.coveredDomains.add(Domain.MIXED_REVIEW);
    
    return true;
  }

  private executeStep6_PhysicsBlock(day: DailySchedule, execution: DailyExecution): boolean {
    // Find next Titan physics or general physics content
    const titanPhysics = this.pools.physics.filter(r =>
      this.availableResources.has(r.id) && 
      (r.videoSource || '').toLowerCase().includes('titan')
    );
    
    const physicsAnchor = titanPhysics.length > 0
      ? titanPhysics[0]
      : this.pools.physics.find(r => this.availableResources.has(r.id));
    
    if (!physicsAnchor) return false;
    
    if (!this.addTaskToDay(day, physicsAnchor)) return false;
    
    // Add paired physics content
    const pairedPhysics = [
      ...this.findPairedResources(physicsAnchor, this.pools.warMachine),
      ...this.findPairedResources(physicsAnchor, this.pools.physicsApp),
      ...this.pools.qevlar.filter(r => 
        this.availableResources.has(r.id) && 
        r.domain === Domain.PHYSICS &&
        this.isTopicallyRelated(physicsAnchor, r)
      )
    ].slice(0, 4);
    
    for (const resource of pairedPhysics) {
      this.addTaskToDay(day, resource);
    }
    
    return true;
  }

  private executeStep7_SupplementaryContent(day: DailySchedule, execution: DailyExecution): void {
    // First: Discord lectures with relevancy matching
    const relevantDiscord = this.pools.discord
      .filter(r => this.availableResources.has(r.id))
      .sort((a, b) => this.calculateRelevancyScore(b, execution.coveredDomains) - this.calculateRelevancyScore(a, execution.coveredDomains));
    
    for (const resource of relevantDiscord) {
      if (this.getRemainingTime(day) < 5) break;
      this.addTaskToDay(day, resource);
    }
    
    // Then: Core Radiology with relevancy matching
    const relevantCoreRad = this.pools.coreRadiology
      .filter(r => this.availableResources.has(r.id))
      .sort((a, b) => this.calculateRelevancyScore(b, execution.coveredDomains) - this.calculateRelevancyScore(a, execution.coveredDomains));
    
    for (const resource of relevantCoreRad) {
      if (this.getRemainingTime(day) < 5) break;
      this.addTaskToDay(day, resource);
    }
  }

  private calculateRelevancyScore(resource: StudyResource, dayDomains: Set<Domain>): number {
    let score = 0;
    
    // Perfect domain match
    if (dayDomains.has(resource.domain)) score += 100;
    
    // Related domain bonus
    const related = this.getRelatedDomains(resource.domain);
    for (const relatedDomain of related) {
      if (dayDomains.has(relatedDomain)) score += 50;
    }
    
    // Shorter items for gap filling
    if (resource.durationMinutes <= 5) score += 25;
    else if (resource.durationMinutes <= 15) score += 15;
    else if (resource.durationMinutes <= 30) score += 10;
    
    // Primary material bonus
    if (resource.isPrimaryMaterial) score += 20;
    
    return score;
  }

  private getRelatedDomains(domain: Domain): Domain[] {
    const relations: Partial<Record<Domain, Domain[]>> = {
      [Domain.GASTROINTESTINAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.PEDIATRIC_RADIOLOGY],
      [Domain.GENITOURINARY_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.ULTRASOUND_IMAGING],
      [Domain.THORACIC_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.NUCLEAR_MEDICINE, Domain.PEDIATRIC_RADIOLOGY],
      [Domain.CARDIOVASCULAR_IMAGING]: [Domain.THORACIC_IMAGING, Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.NEURORADIOLOGY]: [Domain.PEDIATRIC_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.PEDIATRIC_RADIOLOGY]: [Domain.NEURORADIOLOGY, Domain.THORACIC_IMAGING, Domain.GASTROINTESTINAL_IMAGING, Domain.GENITOURINARY_IMAGING, Domain.MUSCULOSKELETAL_IMAGING],
      [Domain.MUSCULOSKELETAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.PEDIATRIC_RADIOLOGY],
      [Domain.INTERVENTIONAL_RADIOLOGY]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GASTROINTESTINAL_IMAGING, Domain.GENITOURINARY_IMAGING],
      [Domain.BREAST_IMAGING]: [Domain.NUCLEAR_MEDICINE, Domain.ULTRASOUND_IMAGING, Domain.PHYSICS],
      [Domain.ULTRASOUND_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GENITOURINARY_IMAGING, Domain.BREAST_IMAGING],
      [Domain.NUCLEAR_MEDICINE]: [Domain.PHYSICS],
      [Domain.PHYSICS]: [Domain.NUCLEAR_MEDICINE, Domain.BREAST_IMAGING]
    };
    
    return relations[domain] || [];
  }

  private guaranteeCompleteness(): void {
    this.notifications.push({
      type: 'info',
      message: 'Guaranteeing 100% completeness for all required resources'
    });
    
    // Get all remaining required resources with strict priority
    const requiredResources = Array.from(this.availableResources)
      .map(id => this.allResources.get(id))
      .filter((r): r is StudyResource => 
        r !== undefined && (
          // Board Vitals pools
          (r.bookSource || '').toLowerCase().includes('board vitals') ||
          // NucApp pools  
          (r.bookSource || '').toLowerCase().includes('nucapp') ||
          // QEVLAR pools
          (r.bookSource || '').toLowerCase().includes('qevlar') ||
          // NIS/RISC
          r.domain === Domain.NIS || r.domain === Domain.RISC ||
          // Physics content
          r.domain === Domain.PHYSICS ||
          // Titan videos
          (r.videoSource || '').toLowerCase().includes('titan') ||
          // Primary material
          r.isPrimaryMaterial
        )
      )
      .sort((a, b) => {
        // Priority ranking
        const getPriority = (resource: StudyResource): number => {
          const book = (resource.bookSource || '').toLowerCase();
          const video = (resource.videoSource || '').toLowerCase();
          
          if (video.includes('titan')) return 1; // Highest priority
          if (book.includes('board vitals')) return 2;
          if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) return 3;
          if (book.includes('nucapp')) return 4;
          if (resource.domain === Domain.PHYSICS) return 5;
          if (book.includes('qevlar')) return 6;
          return 10;
        };
        
        const prioA = getPriority(a);
        const prioB = getPriority(b);
        
        if (prioA !== prioB) return prioA - prioB;
        return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
      });
    
    if (requiredResources.length === 0) {
      this.notifications.push({
        type: 'info',
        message: '✅ Perfect! All required resources already scheduled.'
      });
      return;
    }
    
    // Find days with most available capacity
    const daysWithCapacity = this.studyDays
      .map(day => ({
        day,
        remainingTime: this.getRemainingTime(day),
        utilization: (day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0) / day.totalStudyTimeMinutes) * 100
      }))
      .filter(({remainingTime}) => remainingTime >= 5)
      .sort((a, b) => {
        // Prefer under-utilized days first
        if (a.utilization < 85 && b.utilization >= 85) return -1;
        if (a.utilization >= 85 && b.utilization < 85) return 1;
        return b.remainingTime - a.remainingTime;
      });
    
    let placed = 0;
    for (const resource of requiredResources) {
      let resourcePlaced = false;
      
      for (const {day} of daysWithCapacity) {
        if (this.addTaskToDay(day, resource)) {
          placed++;
          resourcePlaced = true;
          break;
        }
      }
      
      if (!resourcePlaced) {
        this.notifications.push({
          type: 'warning',
          message: `Could not place required resource: ${resource.title} (${resource.durationMinutes}min)`
        });
      }
    }
    
    this.notifications.push({
      type: placed === requiredResources.length ? 'info' : 'warning',
      message: `Completeness: ${placed}/${requiredResources.length} required resources placed`
    });
  }

  private validateAndOptimize(): void {
    // Handle time constraint violations
    for (const day of this.studyDays) {
      const totalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
      
      if (totalTime > day.totalStudyTimeMinutes) {
        const excess = totalTime - day.totalStudyTimeMinutes;
        this.redistributeExcessTasks(day, excess);
      }
    }
    
    // Final task ordering within each day
    for (const day of this.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      day.tasks.forEach((task, index) => {
        task.order = index;
      });
    }
  }

  private redistributeExcessTasks(overloadedDay: DailySchedule, excessTime: number): void {
    const sortedTasks = [...overloadedDay.tasks].sort((a, b) => {
      // Keep synthetic BV tasks (they're calculated quotas)
      if (a.resourceId.includes('bv_mixed') && !b.resourceId.includes('bv_mixed')) return 1;
      if (!a.resourceId.includes('bv_mixed') && b.resourceId.includes('bv_mixed')) return -1;
      
      // Remove supplementary content first
      const aSupp = (a.videoSource || '').includes('discord') || (a.bookSource || '').includes('core radiology');
      const bSupp = (b.videoSource || '').includes('discord') || (b.bookSource || '').includes('core radiology');
      if (aSupp && !bSupp) return -1;
      if (!aSupp && bSupp) return 1;
      
      // Then optional tasks
      if (a.isOptional !== b.isOptional) return a.isOptional ? -1 : 1;
      
      // Then by duration (easier to move longer tasks)
      return b.durationMinutes - a.durationMinutes;
    });
    
    let timeToMove = excessTime;
    const tasksToMove: ScheduledTask[] = [];
    
    for (const task of sortedTasks) {
      if (timeToMove <= 0) break;
      tasksToMove.push(task);
      timeToMove -= task.durationMinutes;
    }
    
    // Remove from current day
    overloadedDay.tasks = overloadedDay.tasks.filter(t => 
      !tasksToMove.some(tm => tm.id === t.id)
    );
    
    // Place on best available days
    for (const task of tasksToMove) {
      const bestDay = this.studyDays
        .filter(d => d.date !== overloadedDay.date)
        .sort((a, b) => this.getRemainingTime(b) - this.getRemainingTime(a))
        .find(d => this.getRemainingTime(d) >= task.durationMinutes);
      
      if (bestDay) {
        bestDay.tasks.push({...task, order: bestDay.tasks.length});
      } else {
        overloadedDay.tasks.push(task);
      }
    }
  }

  private generateExecutionSummary(): void {
    const totalScheduled = this.schedule
      .reduce((sum, day) => sum + day.tasks.reduce((ds, t) => ds + t.durationMinutes, 0), 0);
    const totalAvailable = this.studyDays
      .reduce((sum, day) => sum + day.totalStudyTimeMinutes, 0);
    const utilization = totalAvailable > 0 ? ((totalScheduled / totalAvailable) * 100).toFixed(1) : '0';
    
    this.notifications.push({
      type: 'info',
      message: `Execution complete: ${totalScheduled}/${totalAvailable}min (${utilization}% utilization)`
    });
    
    // Board Vitals tracking
    if (this.totalBoardVitalsQuestions > 0) {
      const bvPct = ((this.scheduledBoardVitalsQuestions / this.totalBoardVitalsQuestions) * 100).toFixed(1);
      this.notifications.push({
        type: 'info',
        message: `Board Vitals: ${this.scheduledBoardVitalsQuestions}/${this.totalBoardVitalsQuestions} questions (${bvPct}%)`
      });
    }
    
    // Template completion
    const fullTemplates = this.dailyExecutions.filter(e => e.stepsCompleted === 6).length;
    this.notifications.push({
      type: 'info', 
      message: `Template execution: ${fullTemplates}/${this.dailyExecutions.length} days completed all 6 steps`
    });
    
    // Unscheduled summary
    if (this.availableResources.size > 0) {
      const examples = Array.from(this.availableResources).slice(0, 3)
        .map(id => this.allResources.get(id)?.title || id);
      
      this.notifications.push({
        type: 'warning',
        message: `${this.availableResources.size} resources unscheduled. Examples: ${examples.join(', ')}`
      });
    }
  }

  private buildProgressTracking(): StudyPlan['progressPerDomain'] {
    const progress: StudyPlan['progressPerDomain'] = {};
    
    // Initialize from all resources
    for (const resource of this.allResources.values()) {
      if (!progress[resource.domain]) {
        progress[resource.domain] = { completedMinutes: 0, totalMinutes: 0 };
      }
      progress[resource.domain]!.totalMinutes += resource.durationMinutes;
    }
    
    // Add completed time from tasks
    for (const day of this.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && progress[task.originalTopic]) {
          progress[task.originalTopic]!.completedMinutes += task.durationMinutes;
        }
      }
    }
    
    return progress;
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
  try {
    const scheduler = new StrictTemplateScheduler(
      startDateStr,
      endDateStr,
      exceptionRules,
      resourcePool,
      topicOrder || DEFAULT_TOPIC_ORDER,
      deadlines || {},
      areSpecialTopicsInterleaved ?? true
    );
    
    return scheduler.executeStrictTemplate();
    
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
    
    let rebalanceStart: string;
    if (options.type === 'standard') {
      rebalanceStart = (options.rebalanceDate && options.rebalanceDate > today) 
        ? options.rebalanceDate : today;
    } else {
      rebalanceStart = options.date;
    }
    
    // Clamp to plan bounds
    rebalanceStart = Math.max(rebalanceStart, currentPlan.startDate);
    rebalanceStart = Math.min(rebalanceStart, currentPlan.endDate);
    
    // Preserve past
    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStart);
    
    // Get completed resources
    const completedIds = new Set<string>();
    for (const day of currentPlan.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && task.originalResourceId) {
          completedIds.add(task.originalResourceId);
        }
      }
    }
    
    // Available resources
    const availableResources = resourcePool.filter(r => 
      !completedIds.has(r.id) && !r.isArchived
    );
    
    // Create scheduler
    const scheduler = new StrictTemplateScheduler(
      rebalanceStart,
      currentPlan.endDate,
      exceptionRules,
      availableResources,
      currentPlan.topicOrder,
      currentPlan.deadlines,
      currentPlan.areSpecialTopicsInterleaved
    );
    
    const result = scheduler.executeStrictTemplate();
    
    // Merge
    result.plan.schedule = [...pastSchedule, ...result.plan.schedule];
    result.plan.startDate = currentPlan.startDate;
    
    // Recalculate progress
    const progress = result.plan.progressPerDomain;
    for (const day of result.plan.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && progress[task.originalTopic]) {
          progress[task.originalTopic]!.completedMinutes += task.durationMinutes;
        }
      }
    }
    result.plan.progressPerDomain = progress;
    
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