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


interface TopicBlock {
    id: string;
    anchorResource: StudyResource;
    associatedResources: StudyResource[];
    totalDuration: number;
    allResourceIds: Set<string>;
    sourceType: 'Titan' | 'Huda' | 'Other';
}

const formatDate = (date: Date): string => date.toISOString().split('T')[0];

class Scheduler {
    private schedule: DailySchedule[];
    private resourcePool: Map<string, StudyResource>;
    private notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    private coveredTopicsByDate = new Map<string, Set<Domain>>();
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

    private scheduleTask(day: DailySchedule, resource: StudyResource): void {
        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
        const topics = this.coveredTopicsByDate.get(day.date) || new Set<Domain>();
        topics.add(resource.domain);
        this.coveredTopicsByDate.set(day.date, topics);
    }
    
    private getRemainingTimeForDay = (day: DailySchedule): number => day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

    /** Phase 1: Distributes primary content blocks using a Round-Robin approach. */
    private distributePrimaryContent() {
        const primaryResources = Array.from(this.resourcePool.values()).filter(r => r.isPrimaryMaterial);
        const usedIds = new Set<string>();
        const blocks: TopicBlock[] = [];
        const sortedAnchors = primaryResources.sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        for (const anchor of sortedAnchors) {
            if (usedIds.has(anchor.id)) continue;

            const sourceType = anchor.videoSource === 'Titan Radiology' ? 'Titan' : anchor.videoSource === 'Huda' ? 'Huda' : 'Other';
            const block: TopicBlock = {
                id: `block_${anchor.id}`, anchorResource: anchor, associatedResources: [],
                totalDuration: anchor.durationMinutes, allResourceIds: new Set([anchor.id]),
                sourceType,
            };
            usedIds.add(anchor.id);

            const queue = [...(anchor.pairedResourceIds || [])];
            while (queue.length > 0) {
                const pairedId = queue.shift()!;
                if (!usedIds.has(pairedId) && this.resourcePool.has(pairedId)) {
                    const pairedResource = this.resourcePool.get(pairedId)!;
                    if (pairedResource.isPrimaryMaterial) {
                        block.associatedResources.push(pairedResource);
                        block.totalDuration += pairedResource.durationMinutes;
                        block.allResourceIds.add(pairedId);
                        usedIds.add(pairedId);
                        (pairedResource.pairedResourceIds || []).forEach(pId => {
                            if (!usedIds.has(pId) && !block.allResourceIds.has(pId)) queue.push(pId);
                        });
                    }
                }
            }
            blocks.push(block);
        }
        
        const processQueue = (queue: TopicBlock[]) => {
            let nextBlockStartDayIndex = 0;
            if (this.studyDays.length === 0) return;

            for (const block of queue) {
                let resourcesToSchedule = [block.anchorResource, ...block.associatedResources];
                resourcesToSchedule.sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

                let currentDayIndexForSpill = nextBlockStartDayIndex;

                for (const resource of resourcesToSchedule) {
                    let remainingDuration = resource.durationMinutes;
                    let isSplit = false;
                    
                    while (remainingDuration > 0) {
                        if (currentDayIndexForSpill >= this.studyDays.length) {
                            this.notifications.push({ type: 'warning', message: `Ran out of days for block: "${block.anchorResource.title}". Some tasks unscheduled.` });
                            break; 
                        }

                        const day = this.studyDays[currentDayIndexForSpill];
                        const availableTime = this.getRemainingTimeForDay(day);

                        if (availableTime <= 0) {
                            currentDayIndexForSpill++;
                            continue;
                        }

                        if (remainingDuration <= availableTime) {
                            const taskResource = isSplit ? 
                                {...resource, id: `${resource.id}_part_final`, title: `${resource.title} (Conclusion)`, durationMinutes: remainingDuration, isSplittable: false } :
                                resource;
                            this.scheduleTask(day, taskResource);
                            remainingDuration = 0;
                        } else {
                            if (!resource.isSplittable || availableTime < MIN_DURATION_for_SPLIT_PART) {
                                currentDayIndexForSpill++;
                                continue;
                            }
                            const partDuration = availableTime;
                            const partResource = {...resource, id: `${resource.id}_part_${currentDayIndexForSpill}`, title: `${resource.title} (Part)`, durationMinutes: partDuration, isSplittable: false };
                            this.scheduleTask(day, partResource);
                            
                            remainingDuration -= partDuration;
                            isSplit = true;
                            currentDayIndexForSpill++;
                        }
                    }
                     if (remainingDuration > 0) break;
                }
                
                block.allResourceIds.forEach(id => this.resourcePool.delete(id));
                nextBlockStartDayIndex = (nextBlockStartDayIndex + 1) % this.studyDays.length;
            }
        };

        processQueue(blocks.filter(b => b.sourceType === 'Titan'));
        processQueue(blocks.filter(b => b.sourceType === 'Huda'));
        processQueue(blocks.filter(b => b.sourceType === 'Other'));
    }

    /** Phase 2: Daily Requirements */
    private scheduleDailyRequirements() {
        const dailyReqPool = Array.from(this.resourcePool.values())
            .filter(r => [Domain.PHYSICS, Domain.NUCLEAR_MEDICINE, Domain.NIS, Domain.RISC].includes(r.domain))
            .sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));
        
        for (const day of this.studyDays) {
            if (this.getRemainingTimeForDay(day) < 15) continue;
            
            const scheduleFirstAvailable = (domains: Domain[], sources?: string[]) => {
                if (this.getRemainingTimeForDay(day) < 15) return;
                const resourceIndex = dailyReqPool.findIndex(r => 
                    this.resourcePool.has(r.id) &&
                    domains.includes(r.domain) &&
                    (!sources || sources.includes(r.videoSource || '') || sources.includes(r.bookSource || '')) &&
                    r.durationMinutes <= this.getRemainingTimeForDay(day)
                );

                if (resourceIndex !== -1) {
                    const resource = dailyReqPool[resourceIndex];
                    this.scheduleTask(day, resource);
                    this.resourcePool.delete(resource.id);
                }
            };
            
            scheduleFirstAvailable([Domain.PHYSICS], ['Huda']);
            scheduleFirstAvailable([Domain.PHYSICS], ['Titan Radiology', 'War Machine']);
            scheduleFirstAvailable([Domain.NUCLEAR_MEDICINE]);
            scheduleFirstAvailable([Domain.NIS, Domain.RISC]);
        }
    }

    /** Phase 3: Supplementary Content */
    private fillSupplementaryContent() {
        const supplementaryPool = Array.from(this.resourcePool.values()).filter(r => !r.isPrimaryMaterial);
        
        for (const day of this.studyDays) {
            let remainingTime = this.getRemainingTimeForDay(day);
            if (remainingTime < 15) continue;

            const scheduledDomains = this.coveredTopicsByDate.get(day.date) || new Set<Domain>();

            supplementaryPool.sort((a, b) => {
                const aIsRelevant = scheduledDomains.has(a.domain);
                const bIsRelevant = scheduledDomains.has(b.domain);
                if (aIsRelevant !== bIsRelevant) return aIsRelevant ? -1 : 1;
                return (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999);
            });

            for (let i = supplementaryPool.length - 1; i >= 0; i--) {
                const resource = supplementaryPool[i];
                if (this.resourcePool.has(resource.id) && resource.durationMinutes <= this.getRemainingTimeForDay(day)) {
                    this.scheduleTask(day, resource);
                    this.resourcePool.delete(resource.id);
                }
            }
        }
    }

    /** Phase 4: Validation and Optimization */
    private validateAndOptimize() {
        let violationsFound = true;
        let iterationGuard = 0;
        const MAX_ITERATIONS = this.schedule.length;

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
                            this.notifications.push({ type: 'warning', message: `Could not reschedule "${taskToMove.title}" after optimization.` });
                        }
                    }
                    break;
                }
            }
        }
    }

    public runFullAlgorithm(): GeneratedStudyPlanOutcome {
        this.distributePrimaryContent();
        this.scheduleDailyRequirements();
        this.fillSupplementaryContent();
        this.validateAndOptimize();

        this.schedule.forEach(day => day.tasks.sort((a, b) => a.order - b.order));
        
        const planStartDate = this.schedule.length > 0 ? this.schedule[0].date : getTodayInNewYork();
        const planEndDate = this.schedule.length > 0 ? this.schedule[this.schedule.length - 1].date : planStartDate;

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