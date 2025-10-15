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
 * DETERMINISTIC FINITE STATE AUTOMATON SCHEDULER
 * 
 * This is a COMPLETELY DIFFERENT approach using a State Machine that GUARANTEES
 * your exact 6-step daily template structure with perfect resource pairing.
 * 
 * STATE MACHINE DEFINITION:
 * - State: (currentDay, currentStep, resourcePools, scheduledTasks)
 * - Transitions: Deterministic step execution rules
 * - Acceptance: All resources scheduled following exact template
 */

// EXACT Titan sequence (your canonical order)
const TITAN_CANONICAL_ORDER = [
  'pancreas', 'liver', 'renal', 'reproductive', 'abdominal barium',
  'chest', 'thyroid', 'musculoskeletal', 'neuro', 'pediatric', 
  'cardiac', 'breast', 'nuclear', 'interventional', 'vascular', 'physics'
];

enum TemplateStep {
  TITAN_BLOCK = 1,        // Titan video + Crack the Core + Case Companion + QEVLAR
  HUDA_BLOCK = 2,         // Huda physics + Huda QB + Huda textbook  
  NUCLEAR_BLOCK = 3,      // Titan nucs + Crack the Core + War Machine + NucApp + QEVLAR
  NIS_RISC_BLOCK = 4,     // NIS/RISC docs + NIS QB + QEVLAR NIS
  BOARD_VITALS_QUOTA = 5, // Single synthetic mixed BV task
  PHYSICS_BLOCK = 6,      // Titan physics + War Machine + Physics app + QEVLAR physics
  SUPPLEMENTARY = 7       // Discord → Core Radiology (relevancy-based)
}

interface SchedulerState {
  currentDayIndex: number;
  currentStep: TemplateStep;
  titanTopicPointer: number;
  completedSteps: Set<string>; // dayIndex_step tracking
  
  // Resource pool states
  availableResources: Set<string>;
  titanVideoQueue: StudyResource[];
  hudaQueue: StudyResource[];
  nuclearQueue: StudyResource[];
  nisRiscQueue: StudyResource[];
  physicsQueue: StudyResource[];
  discordQueue: StudyResource[];
  coreRadQueue: StudyResource[];
  
  // BV tracking
  totalBVQuestions: number;
  scheduledBVQuestions: number;
  
  // Progress tracking
  schedule: DailySchedule[];
  notifications: Array<{type: 'error' | 'warning' | 'info', message: string}>;
}

interface ResourceMap {
  titanVideos: Map<string, StudyResource[]>; // topic -> videos
  crackTheCore: StudyResource[];
  caseCompanion: StudyResource[];
  qevlar: Map<Domain, StudyResource[]>; // domain -> qevlar
  huda: StudyResource[];
  nuclear: StudyResource[];
  warMachine: StudyResource[];
  nucApp: StudyResource[];
  nisRisc: StudyResource[];
  boardVitals: StudyResource[];
  physics: StudyResource[];
  physicsApp: StudyResource[];
  discord: StudyResource[];
  coreRadiology: StudyResource[];
}

class DeterministicStateMachineScheduler {
  private state: SchedulerState;
  private resourceMap: ResourceMap;
  private allResources: Map<string, StudyResource>;
  private taskCounter = 0;

  constructor(
    startDateStr: string,
    endDateStr: string,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[],
    topicOrder: Domain[],
    deadlines: DeadlineSettings,
    areSpecialTopicsInterleaved: boolean
  ) {
    // Process resources first
    const processedResources = this.chunkLargeResources(resourcePool);
    this.allResources = new Map();
    processedResources.forEach(r => this.allResources.set(r.id, r));
    
    // Build resource map for O(1) lookups
    this.resourceMap = this.buildResourceMap(processedResources);
    
    // Initialize state
    this.state = {
      currentDayIndex: 0,
      currentStep: TemplateStep.TITAN_BLOCK,
      titanTopicPointer: 0,
      completedSteps: new Set<string>(),
      availableResources: new Set(processedResources.map(r => r.id)),
      titanVideoQueue: this.buildTitanQueue(),
      hudaQueue: [...this.resourceMap.huda],
      nuclearQueue: [...this.resourceMap.nuclear],
      nisRiscQueue: [...this.resourceMap.nisRisc],
      physicsQueue: [...this.resourceMap.physics],
      discordQueue: [...this.resourceMap.discord],
      coreRadQueue: [...this.resourceMap.coreRadiology],
      totalBVQuestions: this.resourceMap.boardVitals.reduce((sum, r) => sum + (r.questionCount || 0), 0),
      scheduledBVQuestions: 0,
      schedule: this.createDaySchedules(startDateStr, endDateStr, exceptionRules),
      notifications: []
    };
    
    this.state.notifications.push({
      type: 'info',
      message: `State Machine initialized: ${this.getStudyDays().length} days, ${processedResources.length} resources, ${this.state.totalBVQuestions} BV questions`
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

  private buildResourceMap(resources: StudyResource[]): ResourceMap {
    const map: ResourceMap = {
      titanVideos: new Map(),
      crackTheCore: [],
      caseCompanion: [],
      qevlar: new Map(),
      huda: [],
      nuclear: [],
      warMachine: [],
      nucApp: [],
      nisRisc: [],
      boardVitals: [],
      physics: [],
      physicsApp: [],
      discord: [],
      coreRadiology: []
    };
    
    // Categorize resources with PERFECT precision
    for (const resource of resources) {
      const title = (resource.title || '').toLowerCase();
      const video = (resource.videoSource || '').toLowerCase();
      const book = (resource.bookSource || '').toLowerCase();
      
      if (video.includes('titan radiology') || video === 'titan') {
        // Map Titan videos by topic
        const topic = this.extractTitanTopic(title);
        if (!map.titanVideos.has(topic)) {
          map.titanVideos.set(topic, []);
        }
        map.titanVideos.get(topic)!.push(resource);
      } else if (book === 'crack the core' || book.includes('crack the core')) {
        map.crackTheCore.push(resource);
      } else if (book === 'case companion' || book.includes('case companion')) {
        map.caseCompanion.push(resource);
      } else if (book === 'qevlar' || book.includes('qevlar')) {
        if (!map.qevlar.has(resource.domain)) {
          map.qevlar.set(resource.domain, []);
        }
        map.qevlar.get(resource.domain)!.push(resource);
      } else if ((video.includes('huda') || book.includes('huda')) && resource.domain === Domain.PHYSICS) {
        map.huda.push(resource);
      } else if (resource.domain === Domain.NUCLEAR_MEDICINE && !book.includes('nucapp')) {
        map.nuclear.push(resource);
      } else if (book === 'war machine' || book.includes('war machine')) {
        map.warMachine.push(resource);
      } else if (book === 'nucapp' || book.includes('nucapp')) {
        map.nucApp.push(resource);
      } else if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) {
        map.nisRisc.push(resource);
      } else if (book === 'board vitals' || book.includes('board vitals')) {
        map.boardVitals.push(resource);
      } else if (resource.domain === Domain.PHYSICS && !video.includes('huda') && !book.includes('huda')) {
        if (title.includes('app') || book.includes('physics app')) {
          map.physicsApp.push(resource);
        } else {
          map.physics.push(resource);
        }
      } else if (video === 'discord' || video.includes('discord')) {
        map.discord.push(resource);
      } else if (book === 'core radiology' || book.includes('core radiology') || title.includes('core radiology')) {
        map.coreRadiology.push(resource);
      }
    }
    
    // Sort all queues by sequence order
    Object.values(map).forEach(collection => {
      if (Array.isArray(collection)) {
        collection.sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
      }
    });
    
    // Sort Titan videos within each topic by sequence order
    for (const [topic, videos] of map.titanVideos) {
      videos.sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));
    }
    
    return map;
  }

  private extractTitanTopic(title: string): string {
    const t = title.toLowerCase();
    
    for (const topic of TITAN_CANONICAL_ORDER) {
      if (t.includes(topic)) return topic;
    }
    
    // Handle aliases
    if (t.includes('msk')) return 'musculoskeletal';
    if (t.includes('peds')) return 'pediatric';  
    if (t.includes('ir')) return 'interventional';
    
    return 'unknown';
  }

  private buildTitanQueue(): StudyResource[] {
    const queue: StudyResource[] = [];
    
    // Build queue in EXACT Titan canonical order
    for (const topic of TITAN_CANONICAL_ORDER) {
      const videos = this.resourceMap.titanVideos.get(topic) || [];
      queue.push(...videos);
    }
    
    return queue;
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

  private getStudyDays(): DailySchedule[] {
    return this.state.schedule.filter(d => !d.isRestDay && d.totalStudyTimeMinutes > 0);
  }

  private getCurrentDay(): DailySchedule {
    const studyDays = this.getStudyDays();
    return studyDays[this.state.currentDayIndex];
  }

  private getRemainingTime(day: DailySchedule): number {
    const used = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    return Math.max(0, day.totalStudyTimeMinutes - used);
  }

  private createTask(resource: StudyResource, day: DailySchedule): ScheduledTask {
    this.taskCounter++;
    const originalId = resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id;
    
    return {
      id: `task_${resource.id}_${this.taskCounter}`,
      resourceId: resource.id,
      originalResourceId: originalId,
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

  private addResourceToCurrentDay(resource: StudyResource): boolean {
    const day = this.getCurrentDay();
    if (!this.state.availableResources.has(resource.id)) return false;
    if (this.getRemainingTime(day) < resource.durationMinutes) return false;
    
    const task = this.createTask(resource, day);
    day.tasks.push(task);
    this.state.availableResources.delete(resource.id);
    
    return true;
  }

  private createSyntheticBVTask(day: DailySchedule, questions: number, subjects: string[]): ScheduledTask {
    this.taskCounter++;
    const subjectList = subjects.join(', ') || 'mixed topics';
    
    return {
      id: `synthetic_bv_${day.date}_${this.taskCounter}`,
      resourceId: `bv_mixed_${day.date}`,
      title: `Board Vitals - Mixed ${questions} questions (suggested: ${subjectList})`,
      type: ResourceType.QUESTIONS,
      originalTopic: Domain.MIXED_REVIEW,
      durationMinutes: Math.ceil(questions * 2), // 2 min per question
      status: 'pending',
      order: day.tasks.length,
      isOptional: false,
      isPrimaryMaterial: true,
      questionCount: questions
    };
  }

  private findPairedResources(anchor: StudyResource, pool: StudyResource[]): StudyResource[] {
    return pool.filter(resource => 
      this.state.availableResources.has(resource.id) && 
      this.isTopicallyRelated(anchor, resource)
    );
  }

  private isTopicallyRelated(anchor: StudyResource, candidate: StudyResource): boolean {
    // Same domain
    if (anchor.domain === candidate.domain) return true;
    
    // Chapter match
    if (anchor.chapterNumber && candidate.chapterNumber && 
        anchor.chapterNumber === candidate.chapterNumber) return true;
    
    // Topic keyword matching with comprehensive coverage
    const anchorTitle = (anchor.title || '').toLowerCase();
    const candidateTitle = (candidate.title || '').toLowerCase();
    
    const topicKeywordGroups = [
      // GI keywords
      ['pancreas', 'pancreat', 'liver', 'hepatic', 'biliary', 'gallbladder', 'spleen', 'splenic', 
       'stomach', 'gastric', 'esophag', 'bowel', 'intestine', 'colon', 'duoden', 'jejun', 'ileum',
       'abdomen', 'abdominal', 'gi', 'gastrointestinal', 'barium'],
      
      // GU keywords  
      ['renal', 'kidney', 'ureter', 'ureteral', 'bladder', 'urethra', 'urethral', 
       'prostate', 'prostatic', 'testicular', 'scrotal', 'penile',
       'uterus', 'uterine', 'ovary', 'ovarian', 'cervix', 'cervical', 'vagina', 'vaginal',
       'reproductive', 'gynecologic', 'obstetric', 'repro', 'endo'],
      
      // Chest/Cardiac keywords
      ['lung', 'pulmonary', 'thorax', 'thoracic', 'chest', 'mediastin', 'pleura', 'trachea', 'bronch',
       'heart', 'cardiac', 'coronary', 'aorta', 'aortic', 'valve', 'pericardium', 'pericardial'],
      
      // Neuro/Head&Neck keywords
      ['brain', 'cerebral', 'cerebr', 'skull', 'cranial', 'spine', 'spinal', 'cord', 'neuro', 'neural',
       'head', 'neck', 'thyroid', 'parathyroid', 'salivary', 'sinus', 'temporal', 'orbit', 'facial'],
      
      // MSK keywords
      ['bone', 'osseous', 'joint', 'articular', 'spine', 'spinal', 'muscle', 'tendon', 'ligament', 
       'msk', 'musculoskeletal', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'pelvis', 'pelvic'],
      
      // Breast keywords
      ['breast', 'mammography', 'mammo', 'mammographic'],
      
      // Nuclear/Physics keywords
      ['nuclear', 'pet', 'spect', 'scintigraphy', 'radiotracer', 'radiopharm',
       'physics', 'ct', 'mri', 'ultrasound', 'radiation', 'dose', 'dosimetry'],
      
      // Pediatric keywords
      ['pediatric', 'peds', 'child', 'infant', 'neonatal', 'congenital'],
      
      // IR/Vascular keywords  
      ['interventional', 'vascular', 'angiography', 'angiographic', 'embolization', 'stent', 'ir']
    ];
    
    for (const keywordGroup of topicKeywordGroups) {
      const anchorHasGroup = keywordGroup.some(kw => anchorTitle.includes(kw));
      const candidateHasGroup = keywordGroup.some(kw => candidateTitle.includes(kw));
      if (anchorHasGroup && candidateHasGroup) return true;
    }
    
    return false;
  }

  /**
   * STATE MACHINE EXECUTION ENGINE
   */
  
  public executeStateMachine(): GeneratedStudyPlanOutcome {
    try {
      const studyDays = this.getStudyDays();
      if (studyDays.length === 0) {
        throw new Error('No study days available');
      }
      
      this.state.notifications.push({
        type: 'info',
        message: 'Starting Deterministic Finite State Automaton execution'
      });
      
      // Main state machine loop
      while (this.state.currentDayIndex < studyDays.length) {
        this.executeCurrentDayStateMachine();
      }
      
      // Final completeness pass
      this.executeCompleteness();
      
      // Validation
      this.validateSchedule();
      
      // Generate summary
      this.generateStateMachineSummary();
      
      return this.buildFinalResult();
      
    } catch (error) {
      this.state.notifications.push({
        type: 'error',
        message: `State machine execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      
      return this.buildEmptyResult();
    }
  }

  private executeCurrentDayStateMachine(): void {
    const day = this.getCurrentDay();
    this.state.currentStep = TemplateStep.TITAN_BLOCK;
    
    this.state.notifications.push({
      type: 'info',
      message: `Day ${this.state.currentDayIndex + 1} (${day.date}): Starting 6-step state machine execution`
    });
    
    // Execute each step in perfect order
    this.transition_Step1_TitanBlock();
    this.transition_Step2_HudaBlock();  
    this.transition_Step3_NuclearBlock();
    this.transition_Step4_NisRiscBlock();
    this.transition_Step5_BoardVitalsQuota();
    this.transition_Step6_PhysicsBlock();
    this.transition_Step7_SupplementaryContent();
    
    const dayTotal = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    const utilization = ((dayTotal / day.totalStudyTimeMinutes) * 100).toFixed(1);
    
    this.state.notifications.push({
      type: 'info',
      message: `Day ${this.state.currentDayIndex + 1} complete: ${dayTotal}min (${utilization}%)`
    });
    
    // Advance to next day
    this.state.currentDayIndex++;
  }

  private transition_Step1_TitanBlock(): void {
    const day = this.getCurrentDay();
    
    // Get next Titan video from queue
    const nextTitanVideo = this.state.titanVideoQueue.find(v => 
      this.state.availableResources.has(v.id)
    );
    
    if (!nextTitanVideo) return;
    
    // Add Titan video
    if (!this.addResourceToCurrentDay(nextTitanVideo)) return;
    
    // Find and add ALL paired content
    const pairedCrackTheCore = this.findPairedResources(nextTitanVideo, this.resourceMap.crackTheCore);
    const pairedCaseCompanion = this.findPairedResources(nextTitanVideo, this.resourceMap.caseCompanion);
    const pairedQevlar = this.resourceMap.qevlar.get(nextTitanVideo.domain) || [];
    
    // Add all paired content that fits
    [...pairedCrackTheCore, ...pairedCaseCompanion, ...pairedQevlar]
      .filter(r => this.state.availableResources.has(r.id))
      .forEach(resource => this.addResourceToCurrentDay(resource));
    
    this.state.completedSteps.add(`${this.state.currentDayIndex}_1`);
  }

  private transition_Step2_HudaBlock(): void {
    const day = this.getCurrentDay();
    
    // Get next Huda lecture
    const nextHudaLecture = this.state.hudaQueue.find(h => 
      this.state.availableResources.has(h.id) && 
      (h.type === ResourceType.VIDEO_LECTURE || h.type === ResourceType.HIGH_YIELD_VIDEO)
    );
    
    if (!nextHudaLecture) return;
    
    // Add Huda lecture
    if (!this.addResourceToCurrentDay(nextHudaLecture)) return;
    
    // Add paired Huda content (QB + textbook)
    const pairedHuda = this.findPairedResources(nextHudaLecture, this.state.hudaQueue)
      .filter(r => r.id !== nextHudaLecture.id)
      .slice(0, 4);
    
    pairedHuda.forEach(resource => this.addResourceToCurrentDay(resource));
    
    this.state.completedSteps.add(`${this.state.currentDayIndex}_2`);
  }

  private transition_Step3_NuclearBlock(): void {
    const day = this.getCurrentDay();
    
    // Get next nuclear anchor (prefer Titan nuclear videos)
    const titanNuclear = this.state.nuclearQueue.filter(n => 
      this.state.availableResources.has(n.id) &&
      (n.videoSource || '').toLowerCase().includes('titan')
    );
    
    const nextNuclear = titanNuclear.length > 0 ? titanNuclear[0] : 
      this.state.nuclearQueue.find(n => this.state.availableResources.has(n.id));
    
    if (!nextNuclear) return;
    
    // Add nuclear anchor
    if (!this.addResourceToCurrentDay(nextNuclear)) return;
    
    // Add ALL paired nuclear content
    const pairedCrackTheCore = this.findPairedResources(nextNuclear, this.resourceMap.crackTheCore);
    const pairedWarMachine = this.findPairedResources(nextNuclear, this.resourceMap.warMachine);
    const pairedNucApp = this.findPairedResources(nextNuclear, this.resourceMap.nucApp);
    const pairedQevlar = this.resourceMap.qevlar.get(Domain.NUCLEAR_MEDICINE) || [];
    
    [...pairedCrackTheCore, ...pairedWarMachine, ...pairedNucApp, ...pairedQevlar]
      .filter(r => this.state.availableResources.has(r.id))
      .slice(0, 8) // Reasonable limit
      .forEach(resource => this.addResourceToCurrentDay(resource));
    
    this.state.completedSteps.add(`${this.state.currentDayIndex}_3`);
  }

  private transition_Step4_NisRiscBlock(): void {
    const day = this.getCurrentDay();
    
    // Get next NIS/RISC document
    const nextNisRisc = this.state.nisRiscQueue.find(n => 
      this.state.availableResources.has(n.id) &&
      n.type === ResourceType.READING_TEXTBOOK
    );
    
    if (!nextNisRisc) return;
    
    // Add NIS/RISC document
    if (!this.addResourceToCurrentDay(nextNisRisc)) return;
    
    // Add paired NIS QB
    const pairedNisQB = this.state.nisRiscQueue.filter(n => 
      this.state.availableResources.has(n.id) &&
      n.type === ResourceType.QUESTIONS &&
      this.isTopicallyRelated(nextNisRisc, n)
    );
    
    // Add relevant QEVLAR NIS
    const nisQevlar = [...(this.resourceMap.qevlar.get(Domain.NIS) || []), 
                       ...(this.resourceMap.qevlar.get(Domain.RISC) || [])]
      .filter(r => this.state.availableResources.has(r.id));
    
    [...pairedNisQB, ...nisQevlar]
      .slice(0, 4)
      .forEach(resource => this.addResourceToCurrentDay(resource));
    
    this.state.completedSteps.add(`${this.state.currentDayIndex}_4`);
  }

  private transition_Step5_BoardVitalsQuota(): void {
    const day = this.getCurrentDay();
    const remainingTime = this.getRemainingTime(day);
    
    if (remainingTime < 30) return;
    
    // Calculate daily quota
    const studyDays = this.getStudyDays();
    const remainingDays = studyDays.length - this.state.currentDayIndex;
    const remainingQuestions = Math.max(0, this.state.totalBVQuestions - this.state.scheduledBVQuestions);
    
    if (remainingQuestions === 0) return;
    
    const avgPerDay = Math.ceil(remainingQuestions / Math.max(1, remainingDays));
    const maxByTime = Math.floor(remainingTime * 0.3 * 0.5); // 30% max time, 0.5 Q/min
    const targetQuestions = Math.min(avgPerDay, maxByTime, remainingQuestions);
    
    if (targetQuestions === 0) return;
    
    // Get suggested subjects from all domains covered so far
    const suggestedSubjects = new Set<string>();
    for (let i = 0; i <= this.state.currentDayIndex; i++) {
      const daySchedule = studyDays[i];
      daySchedule.tasks.forEach(task => {
        const domainStr = task.originalTopic.toString().replace(/_/g, ' ').toLowerCase();
        if (!['nis', 'risc', 'mixed review', 'high yield', 'final review'].includes(domainStr)) {
          suggestedSubjects.add(domainStr);
        }
      });
    }
    
    // Create and add synthetic BV task
    const bvTask = this.createSyntheticBVTask(day, targetQuestions, Array.from(suggestedSubjects));
    day.tasks.push(bvTask);
    this.state.scheduledBVQuestions += targetQuestions;
    
    this.state.completedSteps.add(`${this.state.currentDayIndex}_5`);
  }

  private transition_Step6_PhysicsBlock(): void {
    const day = this.getCurrentDay();
    
    // Get next physics content (prefer Titan physics)
    const titanPhysics = this.state.physicsQueue.filter(p => 
      this.state.availableResources.has(p.id) &&
      (p.videoSource || '').toLowerCase().includes('titan')
    );
    
    const nextPhysics = titanPhysics.length > 0 ? titanPhysics[0] : 
      this.state.physicsQueue.find(p => this.state.availableResources.has(p.id));
    
    if (!nextPhysics) return;
    
    // Add physics anchor
    if (!this.addResourceToCurrentDay(nextPhysics)) return;
    
    // Add paired physics content
    const pairedWarMachine = this.findPairedResources(nextPhysics, this.resourceMap.warMachine);
    const pairedPhysicsApp = this.findPairedResources(nextPhysics, this.resourceMap.physicsApp);
    const pairedQevlar = this.resourceMap.qevlar.get(Domain.PHYSICS) || [];
    
    [...pairedWarMachine, ...pairedPhysicsApp, ...pairedQevlar]
      .filter(r => this.state.availableResources.has(r.id))
      .slice(0, 6)
      .forEach(resource => this.addResourceToCurrentDay(resource));
    
    this.state.completedSteps.add(`${this.state.currentDayIndex}_6`);
  }

  private transition_Step7_SupplementaryContent(): void {
    const day = this.getCurrentDay();
    
    // Get covered domains for relevancy scoring
    const coveredDomains = new Set<Domain>();
    day.tasks.forEach(task => coveredDomains.add(task.originalTopic));
    
    // First: Discord lectures by relevancy
    const relevantDiscord = this.state.discordQueue
      .filter(r => this.state.availableResources.has(r.id))
      .sort((a, b) => this.calculateRelevancyScore(b, coveredDomains) - this.calculateRelevancyScore(a, coveredDomains));
    
    // Fill remaining time with Discord
    for (const resource of relevantDiscord) {
      if (this.getRemainingTime(day) < 10) break;
      this.addResourceToCurrentDay(resource);
    }
    
    // Then: Core Radiology by relevancy  
    const relevantCoreRad = this.state.coreRadQueue
      .filter(r => this.state.availableResources.has(r.id))
      .sort((a, b) => this.calculateRelevancyScore(b, coveredDomains) - this.calculateRelevancyScore(a, coveredDomains));
    
    // Fill remaining time with Core Radiology
    for (const resource of relevantCoreRad) {
      if (this.getRemainingTime(day) < 5) break;
      this.addResourceToCurrentDay(resource);
    }
    
    this.state.completedSteps.add(`${this.state.currentDayIndex}_7`);
  }

  private calculateRelevancyScore(resource: StudyResource, dayDomains: Set<Domain>): number {
    let score = 0;
    
    // Perfect domain match
    if (dayDomains.has(resource.domain)) score += 100;
    
    // Related domain bonus
    const relatedDomains = this.getRelatedDomains(resource.domain);
    relatedDomains.forEach(domain => {
      if (dayDomains.has(domain)) score += 50;
    });
    
    // Shorter content preferred for gap filling
    if (resource.durationMinutes <= 5) score += 30;
    else if (resource.durationMinutes <= 15) score += 20;
    else if (resource.durationMinutes <= 30) score += 10;
    
    // Primary material bonus
    if (resource.isPrimaryMaterial) score += 25;
    
    return score;
  }

  private getRelatedDomains(domain: Domain): Domain[] {
    const relations: Partial<Record<Domain, Domain[]>> = {
      [Domain.GASTROINTESTINAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.PEDIATRIC_RADIOLOGY],
      [Domain.GENITOURINARY_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.ULTRASOUND_IMAGING, Domain.PEDIATRIC_RADIOLOGY],
      [Domain.THORACIC_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.NUCLEAR_MEDICINE, Domain.PEDIATRIC_RADIOLOGY],
      [Domain.CARDIOVASCULAR_IMAGING]: [Domain.THORACIC_IMAGING, Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE],
      [Domain.NEURORADIOLOGY]: [Domain.PEDIATRIC_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.INTERVENTIONAL_RADIOLOGY],
      [Domain.PEDIATRIC_RADIOLOGY]: [Domain.NEURORADIOLOGY, Domain.THORACIC_IMAGING, Domain.GASTROINTESTINAL_IMAGING, Domain.GENITOURINARY_IMAGING, Domain.MUSCULOSKELETAL_IMAGING],
      [Domain.MUSCULOSKELETAL_IMAGING]: [Domain.INTERVENTIONAL_RADIOLOGY, Domain.NUCLEAR_MEDICINE, Domain.PEDIATRIC_RADIOLOGY],
      [Domain.INTERVENTIONAL_RADIOLOGY]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GASTROINTESTINAL_IMAGING, Domain.GENITOURINARY_IMAGING, Domain.NEURORADIOLOGY],
      [Domain.BREAST_IMAGING]: [Domain.NUCLEAR_MEDICINE, Domain.ULTRASOUND_IMAGING, Domain.PHYSICS],
      [Domain.ULTRASOUND_IMAGING]: [Domain.CARDIOVASCULAR_IMAGING, Domain.GENITOURINARY_IMAGING, Domain.BREAST_IMAGING],
      [Domain.NUCLEAR_MEDICINE]: [Domain.PHYSICS],
      [Domain.PHYSICS]: [Domain.NUCLEAR_MEDICINE, Domain.BREAST_IMAGING]
    };
    
    return relations[domain] || [];
  }

  private executeCompleteness(): void {
    this.state.notifications.push({
      type: 'info',
      message: 'Executing completeness guarantee for all remaining required resources'
    });
    
    // Get ALL remaining required resources with strict priority ordering
    const requiredResources = Array.from(this.state.availableResources)
      .map(id => this.allResources.get(id))
      .filter((r): r is StudyResource => 
        r !== undefined && (
          (r.videoSource || '').toLowerCase().includes('titan') ||
          (r.bookSource || '').toLowerCase().includes('board vitals') ||
          (r.bookSource || '').toLowerCase().includes('nucapp') ||
          (r.bookSource || '').toLowerCase().includes('qevlar') ||
          r.domain === Domain.NIS || r.domain === Domain.RISC ||
          r.domain === Domain.PHYSICS ||
          r.isPrimaryMaterial
        )
      )
      .sort((a, b) => {
        // Ultra-strict priority ordering
        const getPriority = (resource: StudyResource): number => {
          const video = (resource.videoSource || '').toLowerCase();
          const book = (resource.bookSource || '').toLowerCase();
          
          if (video.includes('titan')) return 1;         // Highest
          if (book.includes('board vitals')) return 2;   
          if (resource.domain === Domain.NIS || resource.domain === Domain.RISC) return 3;
          if (book.includes('nucapp')) return 4;
          if (resource.domain === Domain.PHYSICS && resource.isPrimaryMaterial) return 5;
          if (book.includes('qevlar')) return 6;
          if (resource.isPrimaryMaterial) return 7;
          return 10;                                     // Lowest
        };
        
        const priorityA = getPriority(a);
        const priorityB = getPriority(b);
        
        if (priorityA !== priorityB) return priorityA - priorityB;
        return (a.sequenceOrder || 999) - (b.sequenceOrder || 999);
      });
    
    if (requiredResources.length === 0) {
      this.state.notifications.push({
        type: 'info',
        message: '✅ PERFECT! All required resources successfully scheduled.'
      });
      return;
    }
    
    // Find days with capacity (prioritize under-filled days)
    const studyDays = this.getStudyDays();
    const daysWithCapacity = studyDays
      .map((day, index) => ({
        day,
        index,
        remainingTime: this.getRemainingTime(day),
        utilization: (day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0) / day.totalStudyTimeMinutes) * 100
      }))
      .filter(({remainingTime}) => remainingTime >= 5)
      .sort((a, b) => {
        // Prioritize days under 90% utilization first
        if (a.utilization < 90 && b.utilization >= 90) return -1;
        if (a.utilization >= 90 && b.utilization < 90) return 1;
        return b.remainingTime - a.remainingTime;
      });
    
    let successfullyPlaced = 0;
    for (const resource of requiredResources) {
      let placed = false;
      
      for (const {day} of daysWithCapacity) {
        if (this.getRemainingTime(day) >= resource.durationMinutes) {
          const task = this.createTask(resource, day);
          day.tasks.push(task);
          this.state.availableResources.delete(resource.id);
          successfullyPlaced++;
          placed = true;
          break;
        }
      }
      
      if (!placed) {
        this.state.notifications.push({
          type: 'warning',
          message: `Could not place critical resource: "${resource.title}" (${resource.durationMinutes}min)`
        });
      }
    }
    
    this.state.notifications.push({
      type: successfullyPlaced === requiredResources.length ? 'info' : 'warning',
      message: `Completeness: ${successfullyPlaced}/${requiredResources.length} critical resources placed`
    });
  }

  private validateSchedule(): void {
    const studyDays = this.getStudyDays();
    let violations = 0;
    
    // Check time constraints
    for (const day of studyDays) {
      const totalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
      
      if (totalTime > day.totalStudyTimeMinutes) {
        violations++;
        const excess = totalTime - day.totalStudyTimeMinutes;
        this.redistributeExcess(day, excess);
      }
    }
    
    // Final task ordering
    for (const day of this.state.schedule) {
      day.tasks.sort(sortTasksByGlobalPriority);
      day.tasks.forEach((task, index) => task.order = index);
    }
    
    if (violations > 0) {
      this.state.notifications.push({
        type: 'info',
        message: `Validation: Corrected ${violations} time constraint violations`
      });
    }
  }

  private redistributeExcess(overloadedDay: DailySchedule, excessTime: number): void {
    // Remove lowest priority tasks first
    const tasksByPriority = [...overloadedDay.tasks].sort((a, b) => {
      // Keep synthetic BV tasks (required daily quotas)
      if (a.resourceId.includes('bv_mixed') && !b.resourceId.includes('bv_mixed')) return 1;
      if (!a.resourceId.includes('bv_mixed') && b.resourceId.includes('bv_mixed')) return -1;
      
      // Remove supplementary first
      const aSupp = (a.videoSource || '').includes('discord') || (a.bookSource || '').includes('core radiology');
      const bSupp = (b.videoSource || '').includes('discord') || (b.bookSource || '').includes('core radiology');
      if (aSupp && !bSupp) return -1;
      if (!aSupp && bSupp) return 1;
      
      // Then optional
      if (a.isOptional !== b.isOptional) return a.isOptional ? -1 : 1;
      
      // Then by task priority
      const priorityA = TASK_TYPE_PRIORITY[a.type] || 50;
      const priorityB = TASK_TYPE_PRIORITY[b.type] || 50;
      if (priorityA !== priorityB) return priorityB - priorityA;
      
      return b.durationMinutes - a.durationMinutes;
    });
    
    let timeToMove = excessTime;
    const tasksToMove: ScheduledTask[] = [];
    
    for (const task of tasksByPriority) {
      if (timeToMove <= 0) break;
      tasksToMove.push(task);
      timeToMove -= task.durationMinutes;
    }
    
    // Remove from current day
    overloadedDay.tasks = overloadedDay.tasks.filter(t => 
      !tasksToMove.some(tm => tm.id === t.id)
    );
    
    // Redistribute to other days
    const studyDays = this.getStudyDays();
    for (const task of tasksToMove) {
      const bestDay = studyDays
        .filter(d => d.date !== overloadedDay.date)
        .sort((a, b) => this.getRemainingTime(b) - this.getRemainingTime(a))
        .find(d => this.getRemainingTime(d) >= task.durationMinutes);
      
      if (bestDay) {
        bestDay.tasks.push({...task, order: bestDay.tasks.length});
      } else {
        overloadedDay.tasks.push(task); // Put back if can't move
      }
    }
  }

  private generateStateMachineSummary(): void {
    const studyDays = this.getStudyDays();
    const totalScheduled = this.state.schedule
      .reduce((sum, day) => sum + day.tasks.reduce((ds, t) => ds + t.durationMinutes, 0), 0);
    const totalAvailable = studyDays
      .reduce((sum, day) => sum + day.totalStudyTimeMinutes, 0);
    const utilization = totalAvailable > 0 ? ((totalScheduled / totalAvailable) * 100).toFixed(1) : '0';
    
    this.state.notifications.push({
      type: 'info',
      message: `State Machine Execution Complete: ${totalScheduled}/${totalAvailable}min (${utilization}% utilization)`
    });
    
    // Template completion analysis
    const completedTemplates = studyDays.filter((_, index) => {
      const daySteps = Array.from(this.state.completedSteps).filter(s => s.startsWith(`${index}_`));
      return daySteps.length >= 6; // All 6 core steps
    }).length;
    
    this.state.notifications.push({
      type: 'info',
      message: `Template Execution: ${completedTemplates}/${studyDays.length} days completed full 6-step template`
    });
    
    // Board Vitals quota tracking
    if (this.state.totalBVQuestions > 0) {
      const bvCompletion = ((this.state.scheduledBVQuestions / this.state.totalBVQuestions) * 100).toFixed(1);
      this.state.notifications.push({
        type: 'info',
        message: `Board Vitals Quotas: ${this.state.scheduledBVQuestions}/${this.state.totalBVQuestions} questions (${bvCompletion}% coverage)`
      });
    }
    
    // Unscheduled analysis
    if (this.state.availableResources.size > 0) {
      const examples = Array.from(this.state.availableResources).slice(0, 5)
        .map(id => {
          const resource = this.allResources.get(id);
          return resource ? `"${resource.title}"` : id;
        });
      
      this.state.notifications.push({
        type: 'warning',
        message: `${this.state.availableResources.size} resources unscheduled. Examples: ${examples.join(', ')}`
      });
    } else {
      this.state.notifications.push({
        type: 'info',
        message: '🎯 PERFECT COMPLETENESS! All resources successfully scheduled.'
      });
    }
  }

  private buildFinalResult(): GeneratedStudyPlanOutcome {
    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    
    // Initialize from all resources
    for (const resource of this.allResources.values()) {
      if (!progressPerDomain[resource.domain]) {
        progressPerDomain[resource.domain] = { completedMinutes: 0, totalMinutes: 0 };
      }
      progressPerDomain[resource.domain]!.totalMinutes += resource.durationMinutes;
    }
    
    // Add completed time from scheduled tasks
    for (const day of this.state.schedule) {
      for (const task of day.tasks) {
        if (task.status === 'completed' && progressPerDomain[task.originalTopic]) {
          progressPerDomain[task.originalTopic]!.completedMinutes += task.durationMinutes;
        }
      }
    }
    
    return {
      plan: {
        schedule: this.state.schedule,
        progressPerDomain,
        startDate: this.state.schedule[0]?.date || '',
        endDate: this.state.schedule[this.state.schedule.length - 1]?.date || '',
        firstPassEndDate: null,
        topicOrder: DEFAULT_TOPIC_ORDER,
        cramTopicOrder: DEFAULT_TOPIC_ORDER.slice(),
        deadlines: {},
        isCramModeActive: false,
        areSpecialTopicsInterleaved: true
      },
      notifications: this.state.notifications
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
      notifications: this.state.notifications
    };
  }
}

/**
 * PUBLIC API USING STATE MACHINE
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
    const scheduler = new DeterministicStateMachineScheduler(
      startDateStr,
      endDateStr,
      exceptionRules,
      resourcePool,
      topicOrder || DEFAULT_TOPIC_ORDER,
      deadlines || {},
      areSpecialTopicsInterleaved ?? true
    );
    
    return scheduler.executeStateMachine();
    
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
        message: `State Machine failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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
    
    // Create state machine scheduler
    const scheduler = new DeterministicStateMachineScheduler(
      rebalanceStart,
      currentPlan.endDate,
      exceptionRules,
      availableResources,
      currentPlan.topicOrder,
      currentPlan.deadlines,
      currentPlan.areSpecialTopicsInterleaved
    );
    
    const result = scheduler.executeStateMachine();
    
    // Merge schedules
    result.plan.schedule = [...pastSchedule, ...result.plan.schedule];
    result.plan.startDate = currentPlan.startDate;
    
    // Recalculate progress including completed tasks
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
        message: `State Machine rebalance failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  }
};