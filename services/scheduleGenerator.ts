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
    MIN_DURATION_for_SPLIT_PART,
    TASK_TYPE_PRIORITY
} from '../constants';
import { getTodayInNewYork, parseDateString, formatDuration } from '../utils/timeFormatter';


// --- PRE-PROCESSING & SCHEDULER CLASS ---

const MAX_CHUNK_DURATION = 90; // Split any splittable task longer than 1.5 hours

const chunkLargeResources = (resources: StudyResource[]): StudyResource[] => {
    const chunkedPool: StudyResource[] = [];
    resources.forEach(resource => {
        if (resource.isSplittable && resource.durationMinutes > MAX_CHUNK_DURATION) {
            const numChunks = Math.ceil(resource.durationMinutes / MAX_CHUNK_DURATION);
            const baseChunkDuration = Math.floor(resource.durationMinutes / numChunks);
            let remainderMinutes = resource.durationMinutes % numChunks;

            for (let i = 0; i < numChunks; i++) {
                const partDuration = baseChunkDuration + (remainderMinutes > 0 ? 1 : 0);
                if (partDuration < MIN_DURATION_for_SPLIT_PART / 2) continue;
                if (remainderMinutes > 0) remainderMinutes--;

                chunkedPool.push({
                    ...resource,
                    id: `${resource.id}_part_${i + 1}`,
                    title: `${resource.title} (Part ${i + 1}/${numChunks})`,
                    durationMinutes: partDuration,
                    pairedResourceIds: [], 
                    isSplittable: false,
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
    private resourceMap: Map<string, StudyResource>;
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
        areSpecialTopicsInterleaved: boolean,
    ) {
        const chunkedPool = chunkLargeResources(resourcePool);
        this.resourceMap = new Map(chunkedPool.map(r => [r.id, r]));
        this.resourcePool = new Map(chunkedPool.map(r => [r.id, r]));
        this.schedule = this.createInitialSchedule(startDateStr, endDateStr, exceptionRules);
        this.studyDays = this.schedule.filter(d => !d.isRestDay);
        this.topicOrder = topicOrder;
        this.deadlines = deadlines;
        this.areSpecialTopicsInterleaved = areSpecialTopicsInterleaved;
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

    private convertResourceToTask(resource: StudyResource, order: number, partialDuration?: number, partInfo?: { part: number, total: number }): ScheduledTask {
        this.taskCounter++;
        const originalResourceId = resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id;
        let title = resource.title;
        if (partInfo) {
            title = resource.title.includes('(Part') 
                ? resource.title.replace(/\(Part \d+\/\d+\)/, `(Part ${partInfo.part}/${partInfo.total})`)
                : `${resource.title} (Part ${partInfo.part}/${partInfo.total})`;
        }

        return {
            id: `task_${resource.id}_${this.taskCounter}`,
            resourceId: resource.id,
            originalResourceId: originalResourceId,
            title: title, type: resource.type, originalTopic: resource.domain,
            durationMinutes: partialDuration ?? resource.durationMinutes, status: 'pending', order, isOptional: resource.isOptional,
            isPrimaryMaterial: resource.isPrimaryMaterial, pages: resource.pages, startPage: resource.startPage, endPage: resource.endPage,
            caseCount: resource.caseCount, questionCount: resource.questionCount,
            chapterNumber: resource.chapterNumber, bookSource: resource.bookSource, videoSource: resource.videoSource,
        };
    }
    
    private getRemainingTimeForDay = (day: DailySchedule): number => day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

    private placeBlockContiguously(block: StudyResource[], startDayIndex: number): number {
        let currentDayIndex = startDayIndex;

        for (const resource of block) {
            if (!this.resourcePool.has(resource.id)) continue;
            
            let remainingDuration = resource.durationMinutes;

            while (remainingDuration > 0) {
                if (currentDayIndex >= this.studyDays.length) {
                    return -1; // Ran out of schedule
                }

                const day = this.studyDays[currentDayIndex];
                const availableTime = this.getRemainingTimeForDay(day);

                if (availableTime <= 0) {
                    currentDayIndex++;
                    continue;
                }

                const timeToPlace = Math.min(remainingDuration, availableTime);
                
                if (!resource.isSplittable) {
                    if (availableTime >= remainingDuration) {
                        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                        this.resourcePool.delete(resource.id);
                        remainingDuration = 0;
                    } else {
                        return -1; // Cannot split, and not enough time.
                    }
                } else { // Is splittable
                    if (timeToPlace >= MIN_DURATION_for_SPLIT_PART || timeToPlace === remainingDuration) {
                         const totalParts = Math.ceil(resource.durationMinutes / timeToPlace);
                         const partNum = totalParts - Math.floor((remainingDuration - timeToPlace) / timeToPlace);

                         day.tasks.push(this.convertResourceToTask(resource, day.tasks.length, timeToPlace, { part: partNum, total: totalParts }));
                         remainingDuration -= timeToPlace;
                         if (remainingDuration <= 0) {
                            this.resourcePool.delete(resource.id);
                         }
                    }

                    if (this.getRemainingTimeForDay(day) <= 0) {
                        currentDayIndex++;
                    }
                }
            }
        }
        return currentDayIndex;
    }

    private buildBlocks(anchors: StudyResource[], pairings: ResourceType[][]): StudyResource[][] {
        const blocks: StudyResource[][] = [];
        const usedIds = new Set<string>();

        for (const anchor of anchors) {
            if (!this.resourcePool.has(anchor.id) || usedIds.has(anchor.id)) continue;
            
            const block: StudyResource[] = [anchor];
            usedIds.add(anchor.id);
            
            const resourcesToPair = (anchor.pairedResourceIds || []).map(id => this.resourcePool.get(id)).filter(Boolean) as StudyResource[];

            for (const pairingSet of pairings) {
                resourcesToPair.forEach(resource => {
                    if (pairingSet.includes(resource.type) && !usedIds.has(resource.id)) {
                        block.push(resource);
                        usedIds.add(resource.id);
                    }
                });
            }
            
            const sortedBlock = block.sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
            blocks.push(sortedBlock);
        }
        return blocks;
    }
    
    public runFullAlgorithm(): GeneratedStudyPlanOutcome {
        if (this.studyDays.length === 0) {
            this.notifications.push({ type: 'error', message: "No study days available in the selected date range." });
            return {
                plan: {
                    schedule: this.schedule, progressPerDomain: {}, startDate: this.schedule[0]?.date || '', endDate: this.schedule[this.schedule.length - 1]?.date || '',
                    firstPassEndDate: null, topicOrder: this.topicOrder, cramTopicOrder: [],
                    deadlines: this.deadlines, isCramModeActive: false, areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved,
                },
                notifications: this.notifications,
            };
        }

        const allResources = Array.from(this.resourcePool.values());
        
        // Phase 1: Primary Content Round Robin
        const primaryPairings: ResourceType[][] = [[ResourceType.READING_TEXTBOOK, ResourceType.CASES, ResourceType.QUESTIONS]];

        const processPrimaryBlocks = (anchors: StudyResource[], pairings: ResourceType[][]) => {
            const blocks = this.buildBlocks(anchors, pairings);
            let rrDayCursor = 0;
            for (const block of blocks) {
                if (rrDayCursor >= this.studyDays.length) rrDayCursor = 0; // Cycle back
                
                this.placeBlockContiguously(block, rrDayCursor);
                rrDayCursor++;
            }
        };

        const primaryResources = allResources
            .filter(r => r.isPrimaryMaterial && this.resourcePool.has(r.id))
            .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        this.topicOrder.forEach(domain => {
            const domainAnchors = primaryResources.filter(r => r.domain === domain && this.resourcePool.has(r.id));
            processPrimaryBlocks(domainAnchors, primaryPairings);
        });

        // Phase 2/3: Greedy fill for remaining resources
        const remainingResources = Array.from(this.resourcePool.values())
            .sort((a, b) => (a.isPrimaryMaterial ? -1 : 1) || (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
        
        for (const resource of remainingResources) {
            if (!this.resourcePool.has(resource.id)) continue;
            let placed = false;
            for (let i = 0; i < this.studyDays.length; i++) {
                const day = this.studyDays[i];
                if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                this.notifications.push({ type: 'warning', message: `Could not fit "${resource.title}".` });
            }
        }

        this.schedule.forEach(day => day.tasks.sort((a, b) => a.order - b.order));
        
        const progressPerDomain: StudyPlan['progressPerDomain'] = {};
        allResources.forEach(r => {
            if (!progressPerDomain[r.domain]) progressPerDomain[r.domain] = { completedMinutes: 0, totalMinutes: 0 };
            progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes;
        });

        const plan: StudyPlan = {
            schedule: this.schedule,
            progressPerDomain,
            startDate: this.schedule[0].date,
            endDate: this.schedule[this.schedule.length - 1].date,
            firstPassEndDate: null,
            topicOrder: this.topicOrder,
            cramTopicOrder: [],
            deadlines: this.deadlines,
            isCramModeActive: false,
            areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved,
        };

        return { plan, notifications: this.notifications };
    }
}

export const generateInitialSchedule = (
    resourcePool: StudyResource[],
    exceptionRules: ExceptionDateRule[],
    topicOrder: Domain[] | undefined,
    deadlines: DeadlineSettings | undefined,
    startDateStr: string,
    endDateStr: string,
    areSpecialTopicsInterleaved: boolean | undefined
): GeneratedStudyPlanOutcome => {
    const scheduler = new Scheduler(
        startDateStr,
        endDateStr,
        exceptionRules,
        resourcePool,
        topicOrder || DEFAULT_TOPIC_ORDER,
        deadlines || {},
        areSpecialTopicsInterleaved ?? true
    );
    return scheduler.runFullAlgorithm();
};

export const rebalanceSchedule = (
    currentPlan: StudyPlan,
    options: RebalanceOptions,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    const today = getTodayInNewYork();
    const rebalanceStartDate = options.type === 'standard' 
        ? (options.rebalanceDate && options.rebalanceDate > today ? options.rebalanceDate : today) 
        : options.date;

    const pastSchedule = currentPlan.schedule.filter(d => d.date < rebalanceStartDate);
    
    const completedResourceIds = new Set<string>();
    currentPlan.schedule.forEach(day => {
        day.tasks.forEach(task => {
            if (task.status === 'completed' && task.originalResourceId) {
                completedResourceIds.add(task.originalResourceId);
            }
        });
    });

    const remainingResourcePool = resourcePool.filter(r => !completedResourceIds.has(r.id) && !r.isArchived);
    
    const scheduler = new Scheduler(
        rebalanceStartDate,
        currentPlan.endDate,
        exceptionRules,
        remainingResourcePool,
        currentPlan.topicOrder,
        currentPlan.deadlines,
        currentPlan.areSpecialTopicsInterleaved
    );

    const outcome = scheduler.runFullAlgorithm();
    
    outcome.plan.schedule = [...pastSchedule, ...outcome.plan.schedule];
    outcome.plan.startDate = currentPlan.startDate;

    // Recalculate progress
    Object.values(outcome.plan.progressPerDomain).forEach(domainProgress => {
      domainProgress.completedMinutes = 0;
    });

    outcome.plan.schedule.forEach(day => {
        day.tasks.forEach(task => {
            if (task.status === 'completed') {
                const domainProgress = outcome.plan.progressPerDomain[task.originalTopic];
                if (domainProgress) {
                    domainProgress.completedMinutes += task.durationMinutes;
                }
            }
        });
    });
    
    return outcome;
};
