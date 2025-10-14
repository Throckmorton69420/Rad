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
} from '../constants';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';


// --- TIME CALCULATION ---

const calculateResourceDuration = (resource: StudyResource): number => {
    switch (resource.type) {
        case ResourceType.VIDEO_LECTURE:
        case ResourceType.HIGH_YIELD_VIDEO:
            return Math.ceil(resource.durationMinutes * 0.75);
        case ResourceType.READING_TEXTBOOK:
        case ResourceType.READING_GUIDE:
            if (resource.pages && resource.pages > 0) return Math.ceil(resource.pages * 0.5);
            break;
        case ResourceType.CASES:
            if (resource.caseCount && resource.caseCount > 0) return Math.ceil(resource.caseCount * 1);
            break;
        case ResourceType.QUESTIONS:
        case ResourceType.REVIEW_QUESTIONS:
        case ResourceType.QUESTION_REVIEW:
            if (resource.questionCount && resource.questionCount > 0) return Math.ceil(resource.questionCount * 1.5);
            break;
        default:
            break;
    }
    return resource.durationMinutes;
};

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
    domain: Domain;
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

        for (let dt = new Date(startDate); dt <= endDate; dt.setDate(dt.getDate() + 1)) {
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
        return {
            id: `task_${resource.id}_${++this.taskCounter}`,
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
        if (!this.coveredTopicsByDate.has(day.date)) {
            this.coveredTopicsByDate.set(day.date, new Set());
        }
        this.coveredTopicsByDate.get(day.date)!.add(resource.domain);
    }
    
    private getRemainingTimeForDay = (day: DailySchedule): number => day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

    private buildTopicBlocks(): TopicBlock[] {
        const primaryResources = Array.from(this.resourcePool.values()).filter(r => r.isPrimaryMaterial);
        const resourceMap = new Map(primaryResources.map(r => [r.id, r]));
        const usedIds = new Set<string>();
        const blocks: TopicBlock[] = [];

        const sortedAnchors = primaryResources
            .filter(r => r.type.includes('VIDEO_LECTURE') || r.isPrimaryMaterial)
            .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        for (const anchor of sortedAnchors) {
            if (usedIds.has(anchor.id)) continue;
            
            const sourceType = anchor.videoSource === 'Titan Radiology' ? 'Titan' : anchor.videoSource === 'Huda' ? 'Huda' : 'Other';

            const block: TopicBlock = {
                id: `block_${anchor.id}`, anchorResource: anchor, associatedResources: [],
                totalDuration: anchor.durationMinutes, isSplittable: anchor.isSplittable, allResourceIds: new Set([anchor.id]),
                domain: anchor.domain, sourceType,
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
                        if (pairedResource.isSplittable) block.isSplittable = true;
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
        return blocks;
    }

    /** Phase 1: Distributes primary content blocks using a Round-Robin approach. */
    private distributePrimaryContent() {
        const allBlocks = this.buildTopicBlocks();
        const titanBlocks = allBlocks.filter(b => b.sourceType === 'Titan');
        const hudaBlocks = allBlocks.filter(b => b.sourceType === 'Huda');
        const otherBlocks = allBlocks.filter(b => b.sourceType === 'Other');

        let dayIndex = 0;
        const processQueue = (queue: TopicBlock[]) => {
             while (queue.length > 0) {
                if (dayIndex >= this.studyDays.length) {
                    this.notifications.push({ type: 'warning', message: 'Ran out of study days for primary content. Some materials may not be scheduled.' });
                    return; // Stop scheduling if we run out of days.
                }

                let currentDay = this.studyDays[dayIndex];
                let remainingTime = this.getRemainingTimeForDay(currentDay);
                
                // If the current day is full, move to the next.
                if (remainingTime < 15) {
                    dayIndex++;
                    continue;
                }

                const blockToProcess = queue.shift()!;

                if (blockToProcess.totalDuration <= remainingTime) {
                    this.scheduleTask(currentDay, blockToProcess.anchorResource);
                    blockToProcess.associatedResources.forEach(res => this.scheduleTask(currentDay, res));
                    blockToProcess.allResourceIds.forEach(id => this.resourcePool.delete(id));
                } else { // Block is too large and needs to be split
                    const allItems = [blockToProcess.anchorResource, ...blockToProcess.associatedResources].sort((a, b) => a.isSplittable === b.isSplittable ? 0 : a.isSplittable ? 1 : -1);
                    let timeForDay = remainingTime;
                    
                    const itemsToScheduleNow: StudyResource[] = [];
                    const itemsForLater: StudyResource[] = [];
                    
                    allItems.forEach(item => {
                        if (timeForDay >= item.durationMinutes) {
                            itemsToScheduleNow.push(item);
                            timeForDay -= item.durationMinutes;
                        } else if (item.isSplittable && timeForDay > 15) {
                            const part1Duration = timeForDay;
                            const part2Duration = item.durationMinutes - part1Duration;
                            
                            const part1: StudyResource = {...item, id: `${item.id}_part_1_${Date.now()}`, title: `${item.title} (Part 1)`, durationMinutes: part1Duration};
                            const part2: StudyResource = {...item, id: `${item.id}_part_2_${Date.now()}`, title: `${item.title} (Part 2)`, durationMinutes: part2Duration};

                            itemsToScheduleNow.push(part1);
                            itemsForLater.push(part2);
                            timeForDay = 0;
                        } else {
                            itemsForLater.push(item);
                        }
                    });

                    itemsToScheduleNow.forEach(item => this.scheduleTask(currentDay, item));
                    blockToProcess.allResourceIds.forEach(id => this.resourcePool.delete(id));
                    
                    if (itemsForLater.length > 0) {
                        const newAnchor = itemsForLater.shift()!;
                        const remainderBlock: TopicBlock = {
                            id: `${blockToProcess.id}_rem`,
                            anchorResource: newAnchor,
                            associatedResources: itemsForLater,
                            totalDuration: itemsForLater.reduce((sum, r) => sum + r.durationMinutes, newAnchor.durationMinutes),
                            isSplittable: true,
                            allResourceIds: new Set(itemsForLater.map(r => r.id).concat(newAnchor.id)),
                            domain: newAnchor.domain,
                            sourceType: 'Other' // Treat remainder as 'Other' to avoid re-prioritization
                        };
                        // Push the remainder to the front of the next pass queue to be scheduled on the next day.
                        otherBlocks.unshift(remainderBlock); 
                    }
                }
                dayIndex = (dayIndex + 1) % this.studyDays.length;
            }
        };

        processQueue(titanBlocks);
        processQueue(hudaBlocks);
        processQueue(otherBlocks);
    }
    
    private scheduleDailyRequirements() {
        // Placeholder for Phase 2
    }
    
    private fillSupplementaryContent() {
        // Placeholder for Phase 3
    }
    
    private validateAndOptimize() {
        // Placeholder for Phase 4
    }

    public runFullAlgorithm() {
        this.distributePrimaryContent();
        this.scheduleDailyRequirements();
        this.fillSupplementaryContent();
        this.validateAndOptimize();

        const planStartDate = this.schedule.length > 0 ? this.schedule[0].date : getTodayInNewYork();
        const planEndDate = this.schedule.length > 0 ? this.schedule[this.schedule.length - 1].date : planStartDate;

        return {
            plan: {
                schedule: this.schedule,
                progressPerDomain: {},
                startDate: planStartDate,
                endDate: planEndDate,
                firstPassEndDate: null,
                topicOrder: DEFAULT_TOPIC_ORDER,
                cramTopicOrder: [],
                deadlines: {},
                isCramModeActive: false,
                areSpecialTopicsInterleaved: true,
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
    
    const poolWithCalculatedTimes = calculateAndApplyDurations(masterResourcePool);
    
    const scheduler = new Scheduler(
        startDate || STUDY_START_DATE,
        endDate || STUDY_END_DATE,
        exceptionRules,
        poolWithCalculatedTimes.filter(r => !r.isArchived),
    );

    const outcome = scheduler.runFullAlgorithm();

    // Final progress calculation
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
        remainingPool,
        exceptionRules,
        currentPlan.topicOrder,
        currentPlan.deadlines,
        rebalanceDate,
        currentPlan.endDate,
        currentPlan.areSpecialTopicsInterleaved
    );

    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceDate);
    rebalanceOutcome.plan.schedule = [...pastSchedule, ...rebalanceOutcome.plan.schedule];

    Object.values(Domain).forEach(domain => {
      const totalMinutes = rebalanceOutcome.plan.schedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain).reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      const completedMinutes = rebalanceOutcome.plan.schedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain && t.status === 'completed').reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      if (totalMinutes > 0) {
         rebalanceOutcome.plan.progressPerDomain[domain] = { completedMinutes, totalMinutes };
      }
    });

    return rebalanceOutcome;
};