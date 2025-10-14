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

    private findBestFitDay(resource: StudyResource, startDayIndex: number = 0): number | null {
        for (let i = 0; i < this.studyDays.length; i++) {
            const dayIndex = (startDayIndex + i) % this.studyDays.length;
            const day = this.studyDays[dayIndex];
            if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                return dayIndex;
            }
        }
        return null;
    }

    private gatherTopicBlock(anchorResource: StudyResource): StudyResource[] {
        const block = [anchorResource];
        const processed = new Set([anchorResource.id]);

        if (anchorResource.pairedResourceIds) {
            for (const pairedId of anchorResource.pairedResourceIds) {
                if (!processed.has(pairedId)) {
                    const paired = this.allResources.find(r => r.id === pairedId);
                    if (paired && this.resourcePool.has(pairedId)) {
                        block.push(paired);
                        processed.add(pairedId);
                    }
                }
            }
        }

        // Sort by task type priority
        block.sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
        return block;
    }

    private phase1a_TitanRadiologyRoundRobin(): void {
        // Get all Titan Radiology primary videos in sequence order
        const titanVideos = this.allResources.filter(r =>
            r.videoSource === 'Titan Radiology' &&
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

        let currentDayIndex = 0;
        for (const video of titanVideos) {
            const topicBlock = this.gatherTopicBlock(video);
            
            // Try to place entire block on one day using round-robin
            const targetDay = this.studyDays[currentDayIndex % this.studyDays.length];
            const blockDuration = topicBlock.reduce((sum, r) => 
                this.resourcePool.has(r.id) ? sum + r.durationMinutes : sum, 0
            );

            if (this.getRemainingTimeForDay(targetDay) >= blockDuration) {
                // Place entire block
                for (const resource of topicBlock) {
                    if (this.resourcePool.has(resource.id)) {
                        targetDay.tasks.push(this.convertResourceToTask(resource, targetDay.tasks.length));
                        this.resourcePool.delete(resource.id);
                    }
                }
            } else {
                // Split placement across days
                for (const resource of topicBlock) {
                    if (!this.resourcePool.has(resource.id)) continue;
                    
                    const dayIndex = this.findBestFitDay(resource, currentDayIndex);
                    if (dayIndex !== null) {
                        const day = this.studyDays[dayIndex];
                        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                        this.resourcePool.delete(resource.id);
                    } else {
                        this.notifications.push({
                            type: 'warning',
                            message: `Phase 1a: Could not fit "${resource.title}"`
                        });
                    }
                }
            }
            currentDayIndex++;
        }
    }

    private phase1b_HudaPhysicsRoundRobin(startIndex: number): number {
        const hudaVideos = this.allResources.filter(r =>
            r.videoSource === 'Huda Physics' &&
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

        let currentDayIndex = startIndex;
        for (const video of hudaVideos) {
            const topicBlock = this.gatherTopicBlock(video);
            
            for (const resource of topicBlock) {
                if (!this.resourcePool.has(resource.id)) continue;
                
                const dayIndex = this.findBestFitDay(resource, currentDayIndex);
                if (dayIndex !== null) {
                    const day = this.studyDays[dayIndex];
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                }
            }
            currentDayIndex++;
        }
        return currentDayIndex;
    }

    private phase1c_OtherPrimaryRoundRobin(startIndex: number): void {
        const otherVideos = this.allResources.filter(r =>
            r.videoSource !== 'Titan Radiology' &&
            r.videoSource !== 'Huda Physics' &&
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO) &&
            r.isPrimaryMaterial &&
            this.resourcePool.has(r.id)
        ).sort((a, b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));

        let currentDayIndex = startIndex;
        for (const video of otherVideos) {
            const topicBlock = this.gatherTopicBlock(video);
            
            for (const resource of topicBlock) {
                if (!this.resourcePool.has(resource.id)) continue;
                
                const dayIndex = this.findBestFitDay(resource, currentDayIndex);
                if (dayIndex !== null) {
                    const day = this.studyDays[dayIndex];
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                }
            }
            currentDayIndex++;
        }
    }

    private phase2_DailyRequirements(): void {
        // Build requirement pools
        const nucMedPool = Array.from(this.resourcePool.values()).filter(r =>
            r.domain === Domain.NUCLEAR_MEDICINE &&
            r.isPrimaryMaterial
        ).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

        const nisRiscPool = Array.from(this.resourcePool.values()).filter(r =>
            (r.domain === Domain.NIS || r.domain === Domain.RISC) &&
            r.isPrimaryMaterial
        ).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

        const boardVitalsPool = Array.from(this.resourcePool.values()).filter(r =>
            r.bookSource === 'Board Vitals' &&
            r.isPrimaryMaterial
        );

        // First-fit for each day
        for (let dayIdx = 0; dayIdx < this.studyDays.length; dayIdx++) {
            const day = this.studyDays[dayIdx];

            // Get covered topics up to this day
            const coveredTopics = new Set<Domain>();
            for (let i = 0; i <= dayIdx; i++) {
                this.studyDays[i].tasks.forEach(task => coveredTopics.add(task.originalTopic));
            }

            // Try to place one Nuc Med
            for (let i = 0; i < nucMedPool.length; i++) {
                const resource = nucMedPool[i];
                if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    nucMedPool.splice(i, 1);
                    break;
                }
            }

            // Try to place one NIS/RISC
            for (let i = 0; i < nisRiscPool.length; i++) {
                const resource = nisRiscPool[i];
                if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    nisRiscPool.splice(i, 1);
                    break;
                }
            }

            // Context-aware Board Vitals
            for (let i = 0; i < boardVitalsPool.length; i++) {
                const resource = boardVitalsPool[i];
                if (coveredTopics.has(resource.domain) &&
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
        const supplementaryPool = Array.from(this.resourcePool.values()).filter(r =>
            !r.isPrimaryMaterial && !r.isArchived
        ).sort((a, b) => {
            // Discord videos first, then by type priority
            if (a.videoSource === 'Discord' && b.videoSource !== 'Discord') return -1;
            if (a.videoSource !== 'Discord' && b.videoSource === 'Discord') return 1;
            return (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99);
        });

        // First pass: topic-aware placement
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

        // Second pass: fill remaining space
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

        // Phase 1: Primary Content Distribution (Round-Robin)
        this.phase1a_TitanRadiologyRoundRobin();
        const hudaStart = Math.ceil(this.studyDays.length * 0.33); // Offset start
        const otherStart = this.phase1b_HudaPhysicsRoundRobin(hudaStart);
        this.phase1c_OtherPrimaryRoundRobin(otherStart);

        // Phase 2: Daily Requirements (First-Fit)
        this.phase2_DailyRequirements();

        // Phase 3: Supplementary Backfill
        this.phase3_SupplementaryBackfill();

        // Report unscheduled
        Array.from(this.resourcePool.values()).forEach(resource => {
            this.notifications.push({
                type: 'warning',
                message: `Could not schedule: "${resource.title}" (${resource.durationMinutes} min)`
            });
        });

        // Sort tasks within days
        this.schedule.forEach(day => {
            day.tasks.sort((a, b) => a.order - b.order);
        });

        // Calculate progress
        const progressPerDomain: StudyPlan['progressPerDomain'] = {};
        this.allResources.forEach(r => {
            if (!progressPerDomain[r.domain]) {
                progressPerDomain[r.domain] = { completedMinutes: 0, totalMinutes: 0 };
            }
            progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes;
        });

        const plan: StudyPlan = {
            schedule: this.schedule,
            progressPerDomain,
            startDate: this.schedule[0]?.date || '',
            endDate: this.schedule[this.schedule.length - 1]?.date || '',
            firstPassEndDate: null,
            topicOrder: this.topicOrder,
            cramTopicOrder: [],
            deadlines: {},
            isCramModeActive: false,
            areSpecialTopicsInterleaved: true,
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

    return rebalanceOutcome;
};
