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
} from '../constants';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';


// --- TIME CALCULATION ---

/**
 * Calculates the duration of a resource based on user-defined rules, overriding any default duration.
 * This is the single source of truth for task durations.
 */
const calculateResourceDuration = (resource: StudyResource): number => {
    switch (resource.type) {
        case ResourceType.VIDEO_LECTURE:
        case ResourceType.HIGH_YIELD_VIDEO:
            return Math.ceil(resource.durationMinutes * 0.75);
        case ResourceType.READING_TEXTBOOK:
        case ResourceType.READING_GUIDE:
            if (resource.pages && resource.pages > 0) {
                return Math.ceil(resource.pages * 0.5); // 30 seconds per page
            }
            break;
        case ResourceType.CASES:
            if (resource.caseCount && resource.caseCount > 0) {
                return Math.ceil(resource.caseCount * 1); // 1 min per case
            }
            break;
        case ResourceType.QUESTIONS:
        case ResourceType.REVIEW_QUESTIONS:
        case ResourceType.QUESTION_REVIEW:
            if (resource.questionCount && resource.questionCount > 0) {
                return Math.ceil(resource.questionCount * 1.5); // 1 min per Q + 30s review
            }
            break;
        default:
            break;
    }
    // Fallback to the original duration if no specific calculation applies
    return resource.durationMinutes;
};

/**
 * Applies the accurate time calculation to the entire resource pool.
 * This is called once at the beginning of any schedule generation.
 */
const calculateAndApplyDurations = (resources: StudyResource[]): StudyResource[] => {
    return resources.map(res => ({
        ...res,
        durationMinutes: calculateResourceDuration(res),
    }));
};


// --- SCHEDULER CLASS & HELPERS ---

interface TopicBlock {
    id: string;
    anchorResource: StudyResource;
    associatedResources: StudyResource[];
    totalDuration: number;
    isSplittable: boolean;
    allResourceIds: Set<string>;
}

const formatDate = (date: Date): string => date.toISOString().split('T')[0];

class Scheduler {
    private schedule: DailySchedule[];
    private resourcePool: Map<string, StudyResource>;
    private topicOrder: Domain[];
    private areSpecialTopicsInterleaved: boolean;
    private notifications: GeneratedStudyPlanOutcome['notifications'] = [];

    private coveredTopicsByDate = new Map<string, Set<Domain>>();
    private taskCounter = 0;

    constructor(
        startDateStr: string, 
        endDateStr: string, 
        exceptionRules: ExceptionDateRule[], 
        resourcePool: StudyResource[],
        topicOrder: Domain[],
        areSpecialTopicsInterleaved: boolean
    ) {
        this.resourcePool = new Map(resourcePool.map(r => [r.id, r]));
        this.schedule = this.createInitialSchedule(startDateStr, endDateStr, exceptionRules);
        this.topicOrder = topicOrder;
        this.areSpecialTopicsInterleaved = areSpecialTopicsInterleaved;
    }

    private createInitialSchedule(startDateStr: string, endDateStr: string, exceptionRules: ExceptionDateRule[]): DailySchedule[] {
        const startDate = parseDateString(startDateStr);
        const endDate = parseDateString(endDateStr);
        const days: DailySchedule[] = [];
        const exceptionMap = new Map(exceptionRules.map(e => [e.date, e]));

        for (let dt = new Date(startDate); dt <= endDate; dt.setDate(dt.getDate() + 1)) {
            const dateStr = formatDate(dt);
            const dayName = dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
            const exception = exceptionMap.get(dateStr);
            
            days.push({
                date: dateStr,
                dayName,
                tasks: [],
                totalStudyTimeMinutes: exception?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS,
                isRestDay: exception?.isRestDayOverride ?? false,
                isManuallyModified: !!exception,
            });
        }
        return days;
    }

    private convertResourceToTask(resource: StudyResource, order: number): ScheduledTask {
        return {
            id: `task_${resource.id}_${++this.taskCounter}`,
            resourceId: resource.id,
            originalResourceId: resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id,
            title: resource.title,
            type: resource.type,
            originalTopic: resource.domain,
            durationMinutes: resource.durationMinutes,
            status: 'pending',
            order,
            isOptional: resource.isOptional,
            isPrimaryMaterial: resource.isPrimaryMaterial,
            pages: resource.pages, startPage: resource.startPage, endPage: resource.endPage,
            caseCount: resource.caseCount, questionCount: resource.questionCount,
            chapterNumber: resource.chapterNumber, bookSource: resource.bookSource, videoSource: resource.videoSource,
        };
    }
    
    private buildTopicBlocks(primaryResources: StudyResource[]): TopicBlock[] {
        const resourceMap = new Map(primaryResources.map(r => [r.id, r]));
        const usedIds = new Set<string>();
        const blocks: TopicBlock[] = [];

        // Prioritize anchors with sequenceOrder
        const sortedAnchors = primaryResources
            .filter(r => r.type.includes('VIDEO'))
            .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        for (const anchor of sortedAnchors) {
            if (usedIds.has(anchor.id)) continue;
            
            const block: TopicBlock = {
                id: `block_${anchor.id}`,
                anchorResource: anchor,
                associatedResources: [],
                totalDuration: anchor.durationMinutes,
                isSplittable: false,
                allResourceIds: new Set([anchor.id]),
            };
            usedIds.add(anchor.id);
            
            const queue = [...(anchor.pairedResourceIds || [])];
            while (queue.length > 0) {
                const pairedId = queue.shift()!;
                if (!usedIds.has(pairedId) && resourceMap.has(pairedId)) {
                    const pairedResource = resourceMap.get(pairedId)!;
                    if (pairedResource.isPrimaryMaterial) {
                        block.associatedResources.push(pairedResource);
                        block.totalDuration += pairedResource.durationMinutes;
                        if (pairedResource.isSplittable) block.isSplittable = true;
                        block.allResourceIds.add(pairedId);
                        usedIds.add(pairedId);
                        // Recursively add paired resources of the associated item
                        (pairedResource.pairedResourceIds || []).forEach(pId => {
                            if (!usedIds.has(pId) && !block.allResourceIds.has(pId)) {
                                queue.push(pId);
                            }
                        });
                    }
                }
            }
            blocks.push(block);
        }

        // Add any remaining primary non-video resources as their own blocks
        for (const resource of primaryResources) {
            if (!usedIds.has(resource.id)) {
                 blocks.push({
                    id: `block_${resource.id}`,
                    anchorResource: resource,
                    associatedResources: [],
                    totalDuration: resource.durationMinutes,
                    isSplittable: resource.isSplittable,
                    allResourceIds: new Set([resource.id]),
                });
                usedIds.add(resource.id);
            }
        }
        
        return blocks.sort((a,b) => (a.anchorResource.sequenceOrder ?? 9999) - (b.anchorResource.sequenceOrder ?? 9999));
    }
    
    private getRemainingTimeForDay(day: DailySchedule): number {
        const scheduledTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
        return day.totalStudyTimeMinutes - scheduledTime;
    }
    
    private scheduleTask(day: DailySchedule, resource: StudyResource): void {
        const order = day.tasks.length;
        day.tasks.push(this.convertResourceToTask(resource, order));
        if (!this.coveredTopicsByDate.has(day.date)) {
            this.coveredTopicsByDate.set(day.date, new Set());
        }
        this.coveredTopicsByDate.get(day.date)!.add(resource.domain);
    }
    
    run() {
        // --- Pass 1: Primary Content ---
        const primaryResources = Array.from(this.resourcePool.values()).filter(r => r.isPrimaryMaterial);
        const topicBlocks = this.buildTopicBlocks(primaryResources);
        let remainderQueue: StudyResource[] = [];

        for (const day of this.schedule) {
            if (day.isRestDay) continue;
            
            let remainingTime = this.getRemainingTimeForDay(day);

            // First, schedule any high-priority remainders
            while(remainderQueue.length > 0 && remainingTime >= remainderQueue[0].durationMinutes) {
                const remainderTask = remainderQueue.shift()!;
                this.scheduleTask(day, remainderTask);
                remainingTime -= remainderTask.durationMinutes;
            }

            // Then, try to fit whole blocks
            while(remainingTime > 0) {
                const bestFitIndex = topicBlocks.findIndex(block => block.totalDuration <= remainingTime);
                if (bestFitIndex > -1) {
                    const blockToSchedule = topicBlocks.splice(bestFitIndex, 1)[0];
                    this.scheduleTask(day, blockToSchedule.anchorResource);
                    blockToSchedule.associatedResources.forEach(res => this.scheduleTask(day, res));
                    remainingTime = this.getRemainingTimeForDay(day);
                } else {
                    break; // No full blocks fit
                }
            }

            // If space remains, chunk the next largest splittable block
            if (remainingTime > 30 && topicBlocks.length > 0) {
                const blockToChunk = topicBlocks.find(b => b.isSplittable) || topicBlocks[0];
                if (blockToChunk && blockToChunk.totalDuration > remainingTime) {
                    topicBlocks.splice(topicBlocks.indexOf(blockToChunk), 1);

                    const allItemsInBlock = [blockToChunk.anchorResource, ...blockToChunk.associatedResources];
                    const nonSplittable = allItemsInBlock.filter(r => !r.isSplittable);
                    const splittable = allItemsInBlock.filter(r => r.isSplittable);
                    
                    let timeForSplittable = remainingTime;
                    
                    // Schedule non-splittable parts first if they fit
                    nonSplittable.sort((a,b) => a.durationMinutes - b.durationMinutes).forEach(item => {
                        if (timeForSplittable >= item.durationMinutes) {
                            this.scheduleTask(day, item);
                            timeForSplittable -= item.durationMinutes;
                        } else {
                            remainderQueue.push(item);
                        }
                    });

                    // Proportionally chunk the splittable items
                    const totalSplittableDuration = splittable.reduce((sum, r) => sum + r.durationMinutes, 0);
                    if (totalSplittableDuration > 0 && timeForSplittable > 0) {
                        splittable.forEach(item => {
                            const proportion = item.durationMinutes / totalSplittableDuration;
                            const timeForThisChunk = Math.max(15, Math.floor(proportion * timeForSplittable));

                            if (item.durationMinutes > timeForThisChunk) {
                                // Create chunk
                                const chunkResource: StudyResource = {...item, id: `${item.id}_part_1`, title: `${item.title} (Part 1)`, durationMinutes: timeForThisChunk, isSplittable: false };
                                this.scheduleTask(day, chunkResource);
                                
                                // Create remainder
                                const remainderResource: StudyResource = {...item, id: `${item.id}_part_2`, title: `${item.title} (Part 2)`, durationMinutes: item.durationMinutes - timeForThisChunk, isSplittable: true }; // Remainder might be splittable again
                                remainderQueue.push(remainderResource);
                            } else {
                                this.scheduleTask(day, item);
                            }
                        });
                    } else {
                         remainderQueue.push(...splittable);
                    }
                }
            }
        }
        remainderQueue.forEach(r => this.resourcePool.set(r.id, r));
        topicBlocks.flatMap(b => [b.anchorResource, ...b.associatedResources]).forEach(r => {
             if (!Array.from(this.schedule.flatMap(d=>d.tasks).map(t => t.resourceId)).includes(r.id)) {
                this.notifications.push({ type: 'warning', message: `Primary resource "${r.title}" could not be scheduled.` });
             }
        });

        // --- Pass 2: Daily Requirements (Physics, Nucs, NIS/RISC) ---
        if (this.areSpecialTopicsInterleaved) {
            const dailyReqs: Record<string, StudyResource[]> = {
                [Domain.PHYSICS]: Array.from(this.resourcePool.values()).filter(r => r.domain === Domain.PHYSICS).sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999)),
                [Domain.NUCLEAR_MEDICINE]: Array.from(this.resourcePool.values()).filter(r => r.domain === Domain.NUCLEAR_MEDICINE).sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999)),
                [Domain.NIS]: Array.from(this.resourcePool.values()).filter(r => r.domain === Domain.NIS).sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999)),
                [Domain.RISC]: Array.from(this.resourcePool.values()).filter(r => r.domain === Domain.RISC).sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999)),
            };

            for (const day of this.schedule) {
                if (day.isRestDay) continue;
                let remainingTime = this.getRemainingTimeForDay(day);
                
                // Prioritize Physics every other day if possible
                if (this.schedule.indexOf(day) % 2 === 1 && remainingTime > 0 && dailyReqs[Domain.PHYSICS].length > 0) {
                     const task = dailyReqs[Domain.PHYSICS][0];
                     if(remainingTime >= task.durationMinutes) {
                        this.scheduleTask(day, task);
                        dailyReqs[Domain.PHYSICS].shift();
                        remainingTime -= task.durationMinutes;
                     }
                }

                // Fill with other daily reqs
                 for(const domain of [Domain.NUCLEAR_MEDICINE, Domain.NIS, Domain.RISC, Domain.PHYSICS]) {
                     while(remainingTime > 0 && dailyReqs[domain].length > 0) {
                         const task = dailyReqs[domain][0];
                         if (remainingTime >= task.durationMinutes) {
                             this.scheduleTask(day, task);
                             dailyReqs[domain].shift();
                             remainingTime -= task.durationMinutes;
                         } else {
                             break;
                         }
                     }
                 }
            }
        }
        
        // --- Pass 3: Supplementary Content (Board Vitals, Discord, Core Radiology) ---
        const supplementaryResources = Array.from(this.resourcePool.values())
            .filter(r => !r.isPrimaryMaterial)
            .sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        const scheduledIds = new Set(this.schedule.flatMap(d => d.tasks.map(t => t.originalResourceId)));
        let unscheduledSupplementary = supplementaryResources.filter(r => !scheduledIds.has(r.id));
        
        let cumulativeCoveredTopics = new Set<Domain>();

        for (const day of this.schedule) {
             if (day.isRestDay) continue;

            const topicsForThisDay = this.coveredTopicsByDate.get(day.date) || new Set();
            topicsForThisDay.forEach(t => cumulativeCoveredTopics.add(t));
            
            let remainingTime = this.getRemainingTimeForDay(day);

            let i = 0;
            while (i < unscheduledSupplementary.length && remainingTime > 15) {
                const resource = unscheduledSupplementary[i];
                if (resource.durationMinutes <= remainingTime && cumulativeCoveredTopics.has(resource.domain)) {
                    this.scheduleTask(day, resource);
                    remainingTime -= resource.durationMinutes;
                    unscheduledSupplementary.splice(i, 1);
                } else {
                    i++;
                }
            }
        }


        // Final check for unscheduled primary material
        const finalScheduledIds = new Set(this.schedule.flatMap(day => day.tasks.map(task => task.originalResourceId)));
        primaryResources.forEach(res => {
            if (!finalScheduledIds.has(res.id)) {
                 this.notifications.push({ type: 'warning', message: `Primary resource "${res.title}" could not be scheduled. Increase time.` });
            }
        });


        return { schedule: this.schedule, notifications: this.notifications };
    }
}

// --- EXPORTED FUNCTIONS ---

export const generateInitialSchedule = (
    resourcePool: StudyResource[],
    exceptionRules: ExceptionDateRule[],
    topicOrder: Domain[] = DEFAULT_TOPIC_ORDER,
    deadlines: DeadlineSettings = {},
    startDateStr: string,
    endDateStr: string,
    areSpecialTopicsInterleaved: boolean = true
): GeneratedStudyPlanOutcome => {
    
    const resourcesWithCorrectedTime = calculateAndApplyDurations(resourcePool.filter(r => !r.isArchived));
    
    const scheduler = new Scheduler(startDateStr, endDateStr, exceptionRules, resourcesWithCorrectedTime, topicOrder, areSpecialTopicsInterleaved);
    const { schedule, notifications } = scheduler.run();

    const progress = calculateProgress(schedule);
    const plan: StudyPlan = {
        schedule,
        progressPerDomain: progress,
        startDate: startDateStr,
        endDate: endDateStr,
        firstPassEndDate: null, 
        topicOrder,
        cramTopicOrder: topicOrder,
        deadlines,
        isCramModeActive: false,
        areSpecialTopicsInterleaved,
    };
    
    return { plan, notifications };
};

export const rebalanceSchedule = (
    currentPlan: StudyPlan,
    options: RebalanceOptions,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    const rebalanceDateStr = options.type === 'standard' ? (options.rebalanceDate || getTodayInNewYork()) : options.date;

    const completedResourceIds = new Set<string>();
    const pastSchedule: DailySchedule[] = [];

    currentPlan.schedule.forEach(day => {
        if (day.date < rebalanceDateStr) {
            pastSchedule.push(day);
            day.tasks.forEach(task => {
                if (task.status === 'completed' && task.originalResourceId) {
                    completedResourceIds.add(task.originalResourceId);
                }
            });
        }
    });
    
    const resourcesForRebalance = resourcePool.filter(r => !r.isArchived && !completedResourceIds.has(r.id));
    const resourcesWithCorrectedTime = calculateAndApplyDurations(resourcesForRebalance);

    const scheduler = new Scheduler(rebalanceDateStr, currentPlan.endDate, exceptionRules, resourcesWithCorrectedTime, currentPlan.topicOrder, currentPlan.areSpecialTopicsInterleaved);
    
    if (options.type === 'topic-time') {
        const targetDay = scheduler['schedule'].find(d => d.date === options.date);
        if (targetDay) {
            targetDay.totalStudyTimeMinutes = options.totalTimeMinutes;
            targetDay.isManuallyModified = true;
        }
    }

    const { schedule: futureSchedule, notifications } = scheduler.run();
    
    const finalSchedule = [...pastSchedule, ...futureSchedule];
    const progress = calculateProgress(finalSchedule);
    
    const updatedPlan: StudyPlan = {
        ...currentPlan,
        schedule: finalSchedule,
        progressPerDomain: progress,
    };

    return { plan: updatedPlan, notifications };
};

const calculateProgress = (schedule: DailySchedule[]): StudyPlan['progressPerDomain'] => {
    const progress: StudyPlan['progressPerDomain'] = {};
    const allTasks = schedule.flatMap(d => d.tasks);

    for (const domain of Object.values(Domain)) {
        progress[domain] = { completedMinutes: 0, totalMinutes: 0 };
    }

    allTasks.forEach(task => {
        const domain = task.originalTopic;
        progress[domain]!.totalMinutes += task.durationMinutes;
        if (task.status === 'completed') {
            progress[domain]!.completedMinutes += task.durationMinutes;
        }
    });
    return progress;
};
