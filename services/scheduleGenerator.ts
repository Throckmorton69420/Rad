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
    DeadlineSettings,
} from '../types';
import { 
    DEFAULT_DAILY_STUDY_MINS,
    DEFAULT_TOPIC_ORDER,
    STUDY_START_DATE,
    STUDY_END_DATE,
    MIN_DURATION_for_SPLIT_PART,
    TASK_TYPE_PRIORITY
} from '../constants';
import { getTodayInNewYork, parseDateString, formatDuration } from '../utils/timeFormatter';


// --- PRE-PROCESSING & SCHEDULER CLASS ---

const MAX_CHUNK_DURATION = 90; // Split any splittable task longer than 1.5 hours

/**
 * Pre-processes a list of resources to break down large, splittable items into smaller chunks.
 * This is crucial for making large question banks or readings manageable in a daily schedule.
 */
const chunkLargeResources = (resources: StudyResource[]): StudyResource[] => {
    const chunkedPool: StudyResource[] = [];
    resources.forEach(resource => {
        if (resource.isSplittable && resource.durationMinutes > MAX_CHUNK_DURATION) {
            const numChunks = Math.ceil(resource.durationMinutes / MAX_CHUNK_DURATION);
            const baseChunkDuration = Math.floor(resource.durationMinutes / numChunks);
            let remainderMinutes = resource.durationMinutes % numChunks;

            for (let i = 0; i < numChunks; i++) {
                const partDuration = baseChunkDuration + (remainderMinutes > 0 ? 1 : 0);
                if (partDuration < MIN_DURATION_for_SPLIT_PART / 2) continue; // Skip creating tiny leftover chunks
                if (remainderMinutes > 0) remainderMinutes--;

                chunkedPool.push({
                    ...resource,
                    id: `${resource.id}_part_${i + 1}`,
                    title: `${resource.title} (Part ${i + 1}/${numChunks})`,
                    durationMinutes: partDuration,
                    pairedResourceIds: [], // Clear pairings for chunks to avoid dependency loops
                    isSplittable: false,   // A chunk itself cannot be split further
                });
            }
        } else {
            chunkedPool.push(resource);
        }
    });
    return chunkedPool;
};

const formatDate = (date: Date): string => date.toISOString().split('T')[0];

class Scheduler {
    private schedule: DailySchedule[];
    private resourcePool: Map<string, StudyResource>;
    private notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    private taskCounter = 0;
    private studyDays: DailySchedule[];

    constructor(
        startDateStr: string, 
        endDateStr: string, 
        exceptionRules: ExceptionDateRule[], 
        resourcePool: StudyResource[],
    ) {
        this.resourcePool = new Map(resourcePool.map(r => [r.id, r]));
        this.schedule = this.createInitialSchedule(startDateStr, endDateStr, exceptionRules);
        this.studyDays = this.schedule.filter(d => !d.isRestDay);
    }

    private createInitialSchedule(startDateStr: string, endDateStr: string, exceptionRules: ExceptionDateRule[]): DailySchedule[] {
        const startDate = parseDateString(startDateStr);
        const endDate = parseDateString(endDateStr);
        const days: DailySchedule[] = [];
        const exceptionMap = new Map(exceptionRules.map(e => [e.date, e]));

        for (let dt = new Date(startDate); dt <= endDate; dt.setUTCDate(dt.getUTCDate() + 1)) {
            const dateStr = formatDate(dt);
            const dayName = dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
            const exception = exceptionMap.get(dateStr);
            
            days.push({
                date: dateStr, dayName, tasks: [],
                totalStudyTimeMinutes: exception?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS,
                isRestDay: exception?.isRestDayOverride ?? false,
                isManuallyModified: !!exception,
            });
        }
        return days;
    }

    private convertResourceToTask(resource: StudyResource, order: number): ScheduledTask {
        this.taskCounter++;
        return {
            id: `task_${resource.id}_${this.taskCounter}`,
            resourceId: resource.id,
            originalResourceId: resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id,
            title: resource.title, type: resource.type, originalTopic: resource.domain,
            durationMinutes: resource.durationMinutes, status: 'pending', order, isOptional: resource.isOptional,
            isPrimaryMaterial: resource.isPrimaryMaterial, pages: resource.pages, startPage: resource.startPage, endPage: resource.endPage,
            caseCount: resource.caseCount, questionCount: resource.questionCount,
            chapterNumber: resource.chapterNumber, bookSource: resource.bookSource, videoSource: resource.videoSource,
        };
    }

    private scheduleTaskOnDay(day: DailySchedule, resource: StudyResource): void {
        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
        this.resourcePool.delete(resource.id);
    }
    
    private getRemainingTimeForDay = (day: DailySchedule): number => day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

    /** Phase 1: Distribute non-context-aware primary blocks (Water, Vinegar, Oil) via Round-Robin. */
    private distributeStaticPrimaryContent() {
        let dayIndex = 0;

        const scheduleBlockRoundRobin = (block: StudyResource[]) => {
            if (this.studyDays.length === 0) return;

            // Sort block by defined priority to ensure videos/readings come before questions.
            const sortedBlock = block.sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

            for (const resource of sortedBlock) {
                 if (!this.resourcePool.has(resource.id)) continue;

                 let scheduled = false;
                 // Try to fit the resource into a day, starting from the last used day index.
                 for (let i = 0; i < this.studyDays.length; i++) {
                     const currentDayIndex = (dayIndex + i) % this.studyDays.length;
                     const day = this.studyDays[currentDayIndex];

                     if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                         this.scheduleTaskOnDay(day, resource);
                         dayIndex = currentDayIndex; // Next resource will start searching from this day.
                         scheduled = true;
                         break;
                     }
                 }
                 // If not scheduled, it remains in the pool to be reported later.
            }
             // After a block, advance the day index to spread out the *start* of the next block.
            dayIndex = (dayIndex + 1) % this.studyDays.length;
        };

        const allResourcesSorted = Array.from(this.resourcePool.values()).sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));
        
        const getPairedResource = (anchor: StudyResource, type: ResourceType, source?: string) => 
            (anchor.pairedResourceIds || [])
                .map(id => this.resourcePool.get(id))
                .filter((r): r is StudyResource => !!r && r.isPrimaryMaterial)
                .find(r => r.type === type && (!source || r.bookSource === source || r.videoSource === source));

        // Pass 1a-d: Titan Blocks
        const titanAnchors = allResourcesSorted.filter(r => r.videoSource === 'Titan Radiology' && r.isPrimaryMaterial);
        for (const anchor of titanAnchors) {
            if (!this.resourcePool.has(anchor.id)) continue;
            const block = [
                anchor,
                getPairedResource(anchor, ResourceType.READING_TEXTBOOK, 'Crack the Core'),
                getPairedResource(anchor, ResourceType.CASES, 'Case Companion'),
                getPairedResource(anchor, ResourceType.QUESTIONS, 'QEVLAR'),
            ].filter((r): r is StudyResource => !!r);
            scheduleBlockRoundRobin(block);
        }

        // Pass 2a-c: Huda Physics Blocks
        const hudaAnchors = allResourcesSorted.filter(r => r.videoSource === 'Huda' && r.type === ResourceType.VIDEO_LECTURE && r.isPrimaryMaterial);
        for (const anchor of hudaAnchors) {
            if (!this.resourcePool.has(anchor.id)) continue;
            const block = [
                anchor,
                getPairedResource(anchor, ResourceType.QUESTIONS),
                getPairedResource(anchor, ResourceType.READING_TEXTBOOK),
            ].filter((r): r is StudyResource => !!r);
            scheduleBlockRoundRobin(block);
        }

        // Pass 3a-b: Nucs Blocks
        const nucsAnchors = allResourcesSorted.filter(r => r.domain === Domain.NUCLEAR_MEDICINE && r.type.includes('READING') && r.isPrimaryMaterial);
        for (const anchor of nucsAnchors) {
             if (!this.resourcePool.has(anchor.id)) continue;
             const block = [
                anchor,
                getPairedResource(anchor, ResourceType.QUESTIONS, 'QEVLAR'),
                getPairedResource(anchor, ResourceType.QUESTIONS, 'NucApp'),
             ].filter((r): r is StudyResource => !!r);
             scheduleBlockRoundRobin(block);
        }
        
        // Pass 4a-c: RISC/NIS Blocks
        const nisAnchors = allResourcesSorted.filter(r => (r.domain === Domain.NIS || r.domain === Domain.RISC) && r.type.includes('READING') && r.isPrimaryMaterial);
         for (const anchor of nisAnchors) {
             if (!this.resourcePool.has(anchor.id)) continue;
             const block = [
                anchor,
                getPairedResource(anchor, ResourceType.QUESTIONS),
             ].filter((r): r is StudyResource => !!r);
             scheduleBlockRoundRobin(block);
         }
    }
    
    /** Phase 2: Schedule context-aware primary content (Board Vitals) sequentially. */
    private scheduleContextAwarePrimaryContent() {
        const cumulativeCoveredTopics = new Set<Domain>();
        const boardVitalsPool = Array.from(this.resourcePool.values())
            .filter(r => r.bookSource === 'Board Vitals' && r.isPrimaryMaterial)
            .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        for (const day of this.studyDays) {
            // Update covered topics with what was scheduled in the Round-Robin pass for today.
            day.tasks.forEach(t => cumulativeCoveredTopics.add(t.originalTopic));

            // Find applicable BV tasks based on all topics covered *up to this point*.
            const applicableBVTasks = boardVitalsPool.filter(r => 
                this.resourcePool.has(r.id) && cumulativeCoveredTopics.has(r.domain)
            );

            for (const bvTask of applicableBVTasks) {
                if (this.getRemainingTimeForDay(day) >= bvTask.durationMinutes) {
                    this.scheduleTaskOnDay(day, bvTask);
                }
            }
        }
    }
    
    /** Phase 3 & 4: Fill daily gaps with supplementary and optional content. */
    private fillGapsWithSecondaryContent() {
        const cumulativeCoveredTopics = new Set<Domain>();
        const discordPool = Array.from(this.resourcePool.values()).filter(r => r.videoSource === 'Discord');
        const coreRadiologyPool = Array.from(this.resourcePool.values()).filter(r => r.bookSource === 'Core Radiology');

        for (const day of this.studyDays) {
            const dayTopics = new Set(day.tasks.map(t => t.originalTopic));
            dayTopics.forEach(t => cumulativeCoveredTopics.add(t));
            
            const scheduleIfFits = (resource: StudyResource): boolean => {
                if (this.resourcePool.has(resource.id) && this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    this.scheduleTaskOnDay(day, resource);
                    return true;
                }
                return false;
            };
            
            // Phase 2 (Whiskey): Supplementary Lectures (Discord), relevant to today's topics.
            const relevantDiscordLectures = discordPool.filter(r => dayTopics.has(r.domain));
            for (const discordLecture of relevantDiscordLectures) {
                scheduleIfFits(discordLecture);
            }

            // Phase 3 (Ice): Optional Textbook (Core Radiology), relevant to topics covered so far.
            const relevantCoreReadings = coreRadiologyPool
                .filter(r => cumulativeCoveredTopics.has(r.domain))
                .sort((a, b) => b.durationMinutes - a.durationMinutes); // Fit largest first
            for (const coreReading of relevantCoreReadings) {
                scheduleIfFits(coreReading);
            }
        }
    }

    private validateAndOptimize() {
        let violationsFound = true;
        let iterationGuard = 0;
        const MAX_ITERATIONS = this.schedule.length * 2;

        const getTaskPriority = (task: ScheduledTask): number => {
            let priority = 50;
            if (task.isOptional) priority += 100;
            if (!task.isPrimaryMaterial) priority += 50;
            priority += TASK_TYPE_PRIORITY[task.type] || 10;
            return priority;
        };

        while (violationsFound && iterationGuard < MAX_ITERATIONS) {
            violationsFound = false;
            iterationGuard++;

            for (let i = 0; i < this.schedule.length; i++) {
                const day = this.schedule[i];
                if (day.isRestDay) continue;

                if (this.getRemainingTimeForDay(day) < 0) {
                    violationsFound = true;
                    if (day.tasks.length === 0) continue;
                    
                    day.tasks.sort((a, b) => getTaskPriority(b) - getTaskPriority(a));
                    const taskToMove = day.tasks.shift();

                    if (taskToMove) {
                        let moved = false;
                        for (let j = i + 1; j < this.schedule.length; j++) {
                            const nextDay = this.schedule[j];
                            if (!nextDay.isRestDay && this.getRemainingTimeForDay(nextDay) >= taskToMove.durationMinutes) {
                                nextDay.tasks.push(taskToMove);
                                moved = true;
                                break;
                            }
                        }
                        if (!moved) {
                            // If it can't be moved, put it back in the pool to be marked as unscheduled.
                            const originalResource = Array.from(this.resourcePool.values()).find(r => r.id === taskToMove.originalResourceId);
                             if (originalResource) this.resourcePool.set(originalResource.id, originalResource);
                        }
                    }
                    break; 
                }
            }
        }
    }

    public runFullAlgorithm(): GeneratedStudyPlanOutcome {
        // Run primary passes
        this.distributeStaticPrimaryContent();
        this.scheduleContextAwarePrimaryContent();

        // Checkpoint: are there unscheduled primary resources?
        const hasUnscheduledPrimaries = Array.from(this.resourcePool.values()).some(r => r.isPrimaryMaterial);

        // Conditionally run secondary pass
        if (!hasUnscheduledPrimaries) {
            this.fillGapsWithSecondaryContent();
        } else {
            this.notifications.push({ type: 'warning', message: 'Primary resources could not be fully scheduled. Skipping supplementary content to prioritize core materials.' });
        }
        
        this.validateAndOptimize();

        this.schedule.forEach(day => day.tasks.sort((a, b) => a.order - b.order));
        
        const planStartDate = this.schedule.length > 0 ? this.schedule[0].date : getTodayInNewYork();
        const planEndDate = this.schedule.length > 0 ? this.schedule[this.schedule.length - 1].date : planStartDate;
        
        const unscheduledPrimary = Array.from(this.resourcePool.values()).filter(r => r.isPrimaryMaterial);
        if (unscheduledPrimary.length > 0) {
             this.notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} primary resources could not be scheduled. You may need to increase your daily study time or extend the study period.` });
        }

        return {
            plan: {
                schedule: this.schedule, progressPerDomain: {}, startDate: planStartDate, endDate: planEndDate,
                firstPassEndDate: null, topicOrder: DEFAULT_TOPIC_ORDER, cramTopicOrder: [],
                deadlines: {}, isCramModeActive: false, areSpecialTopicsInterleaved: true,
            },
            notifications: this.notifications,
        };
    }
}


export const generateInitialSchedule = (
    masterResourcePool: StudyResource[],
    exceptionRules: ExceptionDateRule[],
    topicOrder?: Domain[],
    deadlines?: DeadlineSettings,
    startDate?: string,
    endDate?: string,
    areSpecialTopicsInterleaved?: boolean
): GeneratedStudyPlanOutcome => {
    
    const poolCopy = JSON.parse(JSON.stringify(masterResourcePool.filter(r => !r.isArchived))) as StudyResource[];
    const chunkedPool = chunkLargeResources(poolCopy);

    const scheduler = new Scheduler(
        startDate || STUDY_START_DATE,
        endDate || STUDY_END_DATE,
        exceptionRules,
        chunkedPool,
    );

    const outcome = scheduler.runFullAlgorithm();

    const allDomains = Object.values(Domain);
    allDomains.forEach(domain => {
      const totalMinutes = outcome.plan.schedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain).reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      if (totalMinutes > 0) {
        outcome.plan.progressPerDomain[domain] = { completedMinutes: 0, totalMinutes: totalMinutes };
      }
    });

    return outcome;
};

export const rebalanceSchedule = (
    currentPlan: StudyPlan, 
    options: RebalanceOptions, 
    exceptionRules: ExceptionDateRule[], 
    masterResourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    
    const rebalanceDate = options.type === 'standard' ? (options.rebalanceDate || getTodayInNewYork()) : options.date;
    
    const completedResourceIds = new Set<string>();
    currentPlan.schedule.forEach(day => {
        if (day.date < rebalanceDate) {
            day.tasks.forEach(task => {
                if (task.status === 'completed' && task.originalResourceId) {
                    completedResourceIds.add(task.originalResourceId);
                }
            });
        }
    });

    const remainingPool = masterResourcePool.filter(r => !completedResourceIds.has(r.id) && !r.isArchived);

    const rebalanceOutcome = generateInitialSchedule(
        remainingPool, exceptionRules, currentPlan.topicOrder, currentPlan.deadlines,
        rebalanceDate, currentPlan.endDate, currentPlan.areSpecialTopicsInterleaved
    );

    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceDate);
    rebalanceOutcome.plan.schedule = [...pastSchedule, ...rebalanceOutcome.plan.schedule];

    Object.values(Domain).forEach(domain => {
      const totalMinutes = rebalanceOutcome.plan.schedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain).reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      const completedMinutes = pastSchedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain && t.status === 'completed').reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      if (totalMinutes > 0) {
         rebalanceOutcome.plan.progressPerDomain[domain] = { completedMinutes, totalMinutes };
      }
    });

    return rebalanceOutcome;
};