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
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';

// --- PRE-PROCESSING ---

const chunkLargeResources = (resources: StudyResource[]): StudyResource[] => {
    const chunkedPool: StudyResource[] = [];
    resources.forEach(resource => {
        if (resource.isSplittable && resource.durationMinutes > MIN_DURATION_for_SPLIT_PART * 1.5) {
            const numChunks = Math.ceil(resource.durationMinutes / MIN_DURATION_for_SPLIT_PART);
            const chunkDuration = Math.round(resource.durationMinutes / numChunks);

            for (let i = 0; i < numChunks; i++) {
                chunkedPool.push({
                    ...resource,
                    id: `${resource.id}_part_${i + 1}`,
                    title: `${resource.title} (Part ${i + 1}/${numChunks})`,
                    durationMinutes: chunkDuration,
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
    private allResources: StudyResource[];
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
        this.allResources = [...resourcePool];
        const chunked = chunkLargeResources(resourcePool);
        this.resourcePool = new Map(chunked.map(r => [r.id, r]));
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
        this.taskCounter++;
        const originalResourceId = resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id;

        return {
            id: `task_${resource.id}_${this.taskCounter}`,
            resourceId: resource.id,
            originalResourceId: originalResourceId,
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
            videoSource: resource.videoSource,
        };
    }
    
    private getRemainingTimeForDay = (day: DailySchedule): number => {
        return day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    };

    private collectResourcesWithPaired(anchor: StudyResource): StudyResource[] {
        const block: StudyResource[] = [];
        const toProcess = [anchor];
        const seen = new Set<string>();

        while (toProcess.length > 0) {
            const current = toProcess.shift()!;
            if (seen.has(current.id) || !this.resourcePool.has(current.id)) continue;
            
            seen.add(current.id);
            block.push(current);

            if (current.pairedResourceIds) {
                for (const pairedId of current.pairedResourceIds) {
                    const paired = this.allResources.find(r => r.id === pairedId);
                    if (paired && !seen.has(paired.id)) {
                        toProcess.push(paired);
                    }
                }
            }
        }

        // Sort by type priority
        block.sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
        return block;
    }

    private phase1_TitanBlocksRoundRobin(): void {
        const titanVideos = this.allResources.filter(r =>
            r.videoSource === 'Titan Radiology' &&
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

        let dayIndex = 0;
        for (const video of titanVideos) {
            const block = this.collectResourcesWithPaired(video);
            
            // Try to place entire block
            let placed = false;
            for (let attempt = 0; attempt < this.studyDays.length && !placed; attempt++) {
                const targetDay = this.studyDays[(dayIndex + attempt) % this.studyDays.length];
                const totalBlockDuration = block.reduce((sum, r) => 
                    this.resourcePool.has(r.id) ? sum + r.durationMinutes : sum, 0
                );

                if (this.getRemainingTimeForDay(targetDay) >= totalBlockDuration) {
                    for (const resource of block) {
                        if (this.resourcePool.has(resource.id)) {
                            targetDay.tasks.push(this.convertResourceToTask(resource, targetDay.tasks.length));
                            this.resourcePool.delete(resource.id);
                        }
                    }
                    placed = true;
                }
            }

            if (!placed) {
                // Split placement
                for (const resource of block) {
                    if (!this.resourcePool.has(resource.id)) continue;
                    
                    let resourcePlaced = false;
                    for (let attempt = 0; attempt < this.studyDays.length; attempt++) {
                        const targetDay = this.studyDays[(dayIndex + attempt) % this.studyDays.length];
                        if (this.getRemainingTimeForDay(targetDay) >= resource.durationMinutes) {
                            targetDay.tasks.push(this.convertResourceToTask(resource, targetDay.tasks.length));
                            this.resourcePool.delete(resource.id);
                            resourcePlaced = true;
                            break;
                        }
                    }

                    if (!resourcePlaced) {
                        this.notifications.push({
                            type: 'warning',
                            message: `Phase 1a: Could not fit "${resource.title}"`
                        });
                    }
                }
            }

            dayIndex++;
        }
    }

    private phase1b_HudaBlocksRoundRobin(startDayIndex: number): number {
        const hudaVideos = this.allResources.filter(r =>
            r.videoSource === 'Huda Physics' &&
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

        let dayIndex = startDayIndex;
        for (const video of hudaVideos) {
            const block = this.collectResourcesWithPaired(video);
            
            let placed = false;
            for (let attempt = 0; attempt < this.studyDays.length && !placed; attempt++) {
                const targetDay = this.studyDays[(dayIndex + attempt) % this.studyDays.length];
                const totalBlockDuration = block.reduce((sum, r) => 
                    this.resourcePool.has(r.id) ? sum + r.durationMinutes : sum, 0
                );

                if (this.getRemainingTimeForDay(targetDay) >= totalBlockDuration) {
                    for (const resource of block) {
                        if (this.resourcePool.has(resource.id)) {
                            targetDay.tasks.push(this.convertResourceToTask(resource, targetDay.tasks.length));
                            this.resourcePool.delete(resource.id);
                        }
                    }
                    placed = true;
                }
            }

            if (!placed) {
                for (const resource of block) {
                    if (!this.resourcePool.has(resource.id)) continue;
                    
                    for (let attempt = 0; attempt < this.studyDays.length; attempt++) {
                        const targetDay = this.studyDays[(dayIndex + attempt) % this.studyDays.length];
                        if (this.getRemainingTimeForDay(targetDay) >= resource.durationMinutes) {
                            targetDay.tasks.push(this.convertResourceToTask(resource, targetDay.tasks.length));
                            this.resourcePool.delete(resource.id);
                            break;
                        }
                    }
                }
            }

            dayIndex++;
        }
        return dayIndex;
    }

    private phase1c_OtherPrimaryBlocksRoundRobin(startDayIndex: number): void {
        const otherPrimaryVideos = this.allResources.filter(r =>
            r.videoSource !== 'Titan Radiology' &&
            r.videoSource !== 'Huda Physics' &&
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

        let dayIndex = startDayIndex;
        for (const video of otherPrimaryVideos) {
            const block = this.collectResourcesWithPaired(video);
            
            for (const resource of block) {
                if (!this.resourcePool.has(resource.id)) continue;
                
                for (let attempt = 0; attempt < this.studyDays.length; attempt++) {
                    const targetDay = this.studyDays[(dayIndex + attempt) % this.studyDays.length];
                    if (this.getRemainingTimeForDay(targetDay) >= resource.durationMinutes) {
                        targetDay.tasks.push(this.convertResourceToTask(resource, targetDay.tasks.length));
                        this.resourcePool.delete(resource.id);
                        break;
                    }
                }
            }

            dayIndex++;
        }
    }

    private phase2_DailyRequirements(): void {
        // Build pools
        const nucMedPool = this.allResources.filter(r =>
            r.domain === Domain.NUCLEAR_MEDICINE &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

        const nisRiscPool = this.allResources.filter(r =>
            (r.domain === Domain.NIS || r.domain === Domain.RISC) &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

        const boardVitalsPool = this.allResources.filter(r =>
            r.bookSource === 'Board Vitals' &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        );

        // First-fit for each day
        for (let dayIdx = 0; dayIdx < this.studyDays.length; dayIdx++) {
            const day = this.studyDays[dayIdx];

            // Get topics covered up to this day
            const coveredTopics = new Set<Domain>();
            for (let i = 0; i <= dayIdx; i++) {
                this.studyDays[i].tasks.forEach(task => coveredTopics.add(task.originalTopic));
            }

            // Try to fit one Nuc Med resource
            for (let i = 0; i < nucMedPool.length; i++) {
                const resource = nucMedPool[i];
                if (this.resourcePool.has(resource.id) && this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    nucMedPool.splice(i, 1);
                    break;
                }
            }

            // Try to fit one NIS/RISC resource
            for (let i = 0; i < nisRiscPool.length; i++) {
                const resource = nisRiscPool[i];
                if (this.resourcePool.has(resource.id) && this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    nisRiscPool.splice(i, 1);
                    break;
                }
            }

            // Context-aware Board Vitals
            for (let i = 0; i < boardVitalsPool.length; i++) {
                const resource = boardVitalsPool[i];
                if (this.resourcePool.has(resource.id) && 
                    coveredTopics.has(resource.domain) &&
                    this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    boardVitalsPool.splice(i, 1);
                    break;
                }
            }
        }
    }

    private phase3_SupplementaryBackfill(): void {
        const supplementaryPool = this.allResources.filter(r =>
            !r.isPrimaryMaterial &&
            !r.isArchived &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => {
            // Discord videos first
            if (a.videoSource === 'Discord' && b.videoSource !== 'Discord') return -1;
            if (a.videoSource !== 'Discord' && b.videoSource === 'Discord') return 1;
            return (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99);
        });

        // First pass: match supplementary to days with same topic
        for (const day of this.studyDays) {
            const dayTopics = new Set(day.tasks.map(t => t.originalTopic));
            
            for (let i = supplementaryPool.length - 1; i >= 0; i--) {
                const resource = supplementaryPool[i];
                if (dayTopics.has(resource.domain) && 
                    this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    supplementaryPool.splice(i, 1);
                }
            }
        }

        // Second pass: fill any remaining space
        for (const day of this.studyDays) {
            for (let i = supplementaryPool.length - 1; i >= 0; i--) {
                const resource = supplementaryPool[i];
                if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    supplementaryPool.splice(i, 1);
                }
            }
        }
    }

    private finalizeSchedule(): void {
        this.schedule.forEach(day => {
            day.tasks.sort((a, b) => a.order - b.order);
        });

        this.resourcePool.forEach(unscheduled => {
            this.notifications.push({
                type: 'warning',
                message: `Could not schedule: "${unscheduled.title}"`
            });
        });
    }

    public runFullAlgorithm(): GeneratedStudyPlanOutcome {
        if (this.studyDays.length === 0) {
            this.notifications.push({ 
                type: 'error', 
                message: "No study days available in the selected date range." 
            });
            return { 
                plan: { 
                    schedule: [], 
                    progressPerDomain: {}, 
                    startDate: '', 
                    endDate: '', 
                    firstPassEndDate: null, 
                    topicOrder: [], 
                    cramTopicOrder: [], 
                    deadlines: {}, 
                    isCramModeActive: false, 
                    areSpecialTopicsInterleaved: false 
                }, 
                notifications: this.notifications 
            };
        }

        // Execute three-phase algorithm
        this.phase1_TitanBlocksRoundRobin();
        const hudaStartIndex = Math.floor(this.studyDays.length / 3); // Spread starting point
        const otherStartIndex = this.phase1b_HudaBlocksRoundRobin(hudaStartIndex);
        this.phase1c_OtherPrimaryBlocksRoundRobin(otherStartIndex);
        
        this.phase2_DailyRequirements();
        this.phase3_SupplementaryBackfill();
        this.finalizeSchedule();

        // Calculate progress
        const progressPerDomain: StudyPlan['progressPerDomain'] = {};
        this.allResources.forEach(r => {
            if (!progressPerDomain[r.domain]) {
                progressPerDomain[r.domain] = { completedMinutes: 0, totalMinutes: 0 };
            }
            progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes;
        });

        this.schedule.forEach(day => {
            day.tasks.forEach(task => {
                if (task.status === 'completed') {
                    const domainProgress = progressPerDomain[task.originalTopic];
                    if (domainProgress) {
                        domainProgress.completedMinutes += task.durationMinutes;
                    }
                }
            });
        });

        const plan: StudyPlan = {
            schedule: this.schedule,
            progressPerDomain,
            startDate: this.schedule[0]?.date || '',
            endDate: this.schedule[this.schedule.length - 1]?.date || '',
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

    const remainingResourcePool = resourcePool.filter(r => 
        !completedResourceIds.has(r.id) && !r.isArchived
    );
    
    const scheduler = new Scheduler(
        rebalanceStartDate,
        currentPlan.endDate,
        exceptionRules,
        remainingResourcePool,
        currentPlan.topicOrder,
        currentPlan.deadlines,
        currentPlan.areSpecialTopicsInterleaved
    );

    const rebalanceOutcome = scheduler.runFullAlgorithm();
    
    rebalanceOutcome.plan.schedule = [...pastSchedule, ...rebalanceOutcome.plan.schedule];
    rebalanceOutcome.plan.startDate = currentPlan.startDate;

    // Recalculate progress
    Object.values(rebalanceOutcome.plan.progressPerDomain).forEach(domainProgress => {
        domainProgress.completedMinutes = 0;
    });

    rebalanceOutcome.plan.schedule.forEach(day => {
        day.tasks.forEach(task => {
            if (task.status === 'completed') {
                const domainProgress = rebalanceOutcome.plan.progressPerDomain[task.originalTopic];
                if (domainProgress) {
                    domainProgress.completedMinutes += task.durationMinutes;
                }
            }
        });
    });

    return rebalanceOutcome;
};
