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
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';


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

        for (let dt = new Date(startDate); dt <= endDate; dt.setUTCDate(dt.getUTCDate() + 1)) {
            const dateStr = formatDate(dt);
            const dayName = dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
            const exception = exceptionMap.get(dateStr);
            
            days.push({
                date: dateStr, dayName, tasks: [],
                totalStudyTimeMinutes: exception?.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS,
                isRestDay: exception?.isRestDayOverride ?? (dt.getUTCDay() === 0 || dt.getUTCDay() === 6), // Default weekends to rest days if no exception
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
                totalDuration: anchor.durationMinutes, isSplittable: anchor.isSplittable ?? true, allResourceIds: new Set([anchor.id]),
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

        const titanBlocks = blocks.filter(b => b.sourceType === 'Titan');
        const hudaBlocks = blocks.filter(b => b.sourceType === 'Huda');
        const otherPrimaryBlocks = blocks.filter(b => b.sourceType === 'Other');

        let dayIndex = 0;
        const processQueue = (queue: TopicBlock[], nextQueue: TopicBlock[]) => {
            while (queue.length > 0) {
                const startSearchIndex = dayIndex % this.studyDays.length;
                let foundSpot = false;
                
                // Search for the next available day with at least 15 mins
                for (let i = 0; i < this.studyDays.length; i++) {
                    const currentDayTryIndex = (startSearchIndex + i) % this.studyDays.length;
                    if (this.getRemainingTimeForDay(this.studyDays[currentDayTryIndex]) >= 15) {
                        dayIndex = currentDayTryIndex;
                        foundSpot = true;
                        break;
                    }
                }
                
                if (!foundSpot) {
                    this.notifications.push({ type: 'warning', message: 'Ran out of schedulable time for primary content.' });
                    queue.forEach(block => block.allResourceIds.forEach(id => this.resourcePool.delete(id)));
                    return; // Exit this processing function
                }

                const currentDay = this.studyDays[dayIndex];
                const remainingTime = this.getRemainingTimeForDay(currentDay);
                const blockToProcess = queue.shift()!;

                if (blockToProcess.totalDuration <= remainingTime) {
                    this.scheduleTask(currentDay, blockToProcess.anchorResource);
                    blockToProcess.associatedResources.forEach(res => this.scheduleTask(currentDay, res));
                } else {
                    const allItems = [blockToProcess.anchorResource, ...blockToProcess.associatedResources].sort((a,b) => (a.isSplittable === b.isSplittable ? 0 : a.isSplittable ? 1 : -1));
                    let timeForDay = remainingTime;
                    const itemsToScheduleNow: StudyResource[] = [];
                    const itemsForLater: StudyResource[] = [];
                    
                    for(const item of allItems) {
                        if (timeForDay >= item.durationMinutes) {
                            itemsToScheduleNow.push(item);
                            timeForDay -= item.durationMinutes;
                        } else if (item.isSplittable && timeForDay >= MIN_DURATION_for_SPLIT_PART) {
                            const part1: StudyResource = {...item, id: `${item.id}_part_1_${Date.now()}`, title: `${item.title} (Part 1)`, durationMinutes: timeForDay};
                            const part2: StudyResource = {...item, id: `${item.id}_part_2_${Date.now()}`, title: `${item.title} (Part 2)`, durationMinutes: item.durationMinutes - timeForDay};
                            itemsToScheduleNow.push(part1);
                            itemsForLater.push(part2);
                            timeForDay = 0;
                        } else {
                            itemsForLater.push(item);
                        }
                    }

                    itemsToScheduleNow.forEach(item => this.scheduleTask(currentDay, item));
                    
                    if (itemsForLater.length > 0) {
                        const newAnchor = itemsForLater.shift()!;
                        const remainderBlock: TopicBlock = {
                            id: `${blockToProcess.id}_rem`, anchorResource: newAnchor, associatedResources: itemsForLater,
                            totalDuration: itemsForLater.reduce((sum, r) => sum + r.durationMinutes, newAnchor.durationMinutes),
                            isSplittable: true, allResourceIds: new Set(itemsForLater.map(r => r.id).concat(newAnchor.id)),
                            domain: newAnchor.domain, sourceType: 'Other'
                        };
                        nextQueue.unshift(remainderBlock); 
                    }
                }
                blockToProcess.allResourceIds.forEach(id => this.resourcePool.delete(id));
                dayIndex++; // Move to the next day for the next block
            }
        };

        processQueue(titanBlocks, hudaBlocks);
        processQueue(hudaBlocks, otherPrimaryBlocks);
        processQueue(otherPrimaryBlocks, []);
    }

    /** Phase 2: Daily Requirements */
    private scheduleDailyRequirements() {
        const isDailyReq = (r: StudyResource) => [Domain.PHYSICS, Domain.NUCLEAR_MEDICINE, Domain.NIS, Domain.RISC].includes(r.domain);
        const dailyReqPool = Array.from(this.resourcePool.values()).filter(r => isDailyReq(r)).sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));
        
        for (const day of this.studyDays) {
            let remainingTime = this.getRemainingTimeForDay(day);
            if (remainingTime < 15) continue;
            
            const scheduleFirstAvailable = (domains: Domain[], sources?: string[]) => {
                if (this.getRemainingTimeForDay(day) < 15) return;
                const resourceIndex = dailyReqPool.findIndex(r => 
                    domains.includes(r.domain) &&
                    (!sources || sources.includes(r.videoSource || '') || sources.includes(r.bookSource || '')) &&
                    r.durationMinutes <= this.getRemainingTimeForDay(day)
                );

                if (resourceIndex !== -1) {
                    const resource = dailyReqPool.splice(resourceIndex, 1)[0];
                    this.scheduleTask(day, resource);
                    this.resourcePool.delete(resource.id);
                }
            };
            
            // Per user request, check Huda first, then Titan if Huda doesn't fit
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
                    supplementaryPool.splice(i, 1);
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

                const usedTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

                if (usedTime > day.totalStudyTimeMinutes) {
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

        // Final sorting of tasks within each day
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
    
    // Use a deep copy to prevent mutations from affecting the global state
    const poolCopy = JSON.parse(JSON.stringify(masterResourcePool.filter(r => !r.isArchived))) as StudyResource[];

    const scheduler = new Scheduler(
        startDate || STUDY_START_DATE,
        endDate || STUDY_END_DATE,
        exceptionRules,
        poolCopy,
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