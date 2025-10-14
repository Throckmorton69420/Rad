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

// --- TYPES FOR ALGORITHM ---
interface TopicBlock {
    id: string;
    domain: Domain;
    anchorResource: StudyResource;
    pairedResources: StudyResource[];
    allResources: StudyResource[];
    totalDuration: number;
    priority: number;
}

// --- PRE-PROCESSING & SCHEDULER CLASS ---

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
    private scheduledResourceIds: Set<string> = new Set();

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
        const chunkedResources = chunkLargeResources(resourcePool);
        this.resourcePool = new Map(chunkedResources.map(r => [r.id, r]));
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

    private getResourcePriority(resource: StudyResource): number {
        // Priority order based on algorithm:
        // 1. Titan Radiology blocks
        // 2. Huda Physics blocks
        // 3. War Machine (Nuclear Medicine)
        // 4. Other primary content
        
        if (resource.videoSource === 'Titan Radiology') return 1;
        if (resource.videoSource === 'Huda Physics') return 2;
        if (resource.bookSource === 'War Machine' && resource.domain === Domain.NUCLEAR_MEDICINE) return 3;
        if (resource.bookSource === 'War Machine') return 4;
        return 99;
    }

    private buildTopicBlocks(): TopicBlock[] {
        const blocks: TopicBlock[] = [];
        const processedIds = new Set<string>();

        // Find all primary anchor resources (videos or high-yield videos)
        const primaryAnchors = this.allResources.filter(r => 
            r.isPrimaryMaterial && 
            this.resourcePool.has(r.id) &&
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
        ).sort((a, b) => {
            const priorityDiff = this.getResourcePriority(a) - this.getResourcePriority(b);
            if (priorityDiff !== 0) return priorityDiff;
            return (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999);
        });

        for (const anchor of primaryAnchors) {
            if (processedIds.has(anchor.id)) continue;

            const pairedResources: StudyResource[] = [];
            const allBlockResources: StudyResource[] = [anchor];
            processedIds.add(anchor.id);

            // Gather all paired resources
            if (anchor.pairedResourceIds && anchor.pairedResourceIds.length > 0) {
                for (const pairedId of anchor.pairedResourceIds) {
                    const pairedResource = this.allResources.find(r => r.id === pairedId);
                    if (pairedResource && this.resourcePool.has(pairedId) && !processedIds.has(pairedId)) {
                        pairedResources.push(pairedResource);
                        allBlockResources.push(pairedResource);
                        processedIds.add(pairedId);
                    }
                }
            }

            // Sort paired resources by type priority
            pairedResources.sort((a, b) => 
                (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99)
            );
            allBlockResources.sort((a, b) => 
                (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99)
            );

            const totalDuration = allBlockResources.reduce((sum, r) => sum + r.durationMinutes, 0);

            blocks.push({
                id: `block_${anchor.id}`,
                domain: anchor.domain,
                anchorResource: anchor,
                pairedResources,
                allResources: allBlockResources,
                totalDuration,
                priority: this.getResourcePriority(anchor),
            });
        }

        // Sort blocks by priority and sequence
        blocks.sort((a, b) => {
            const priorityDiff = a.priority - b.priority;
            if (priorityDiff !== 0) return priorityDiff;
            return (a.anchorResource.sequenceOrder || 9999) - (b.anchorResource.sequenceOrder || 9999);
        });

        return blocks;
    }

    private placeBlockRoundRobin(block: TopicBlock, dayIndex: number): boolean {
        const day = this.studyDays[dayIndex];
        let currentDay = day;
        let currentDayIndex = dayIndex;

        // Try to fit entire block on one day if possible
        const totalBlockDuration = block.allResources.reduce((sum, r) => sum + r.durationMinutes, 0);
        if (this.getRemainingTimeForDay(currentDay) >= totalBlockDuration) {
            // Place entire block on this day
            for (const resource of block.allResources) {
                if (this.resourcePool.has(resource.id)) {
                    currentDay.tasks.push(this.convertResourceToTask(resource, currentDay.tasks.length));
                    this.resourcePool.delete(resource.id);
                    this.scheduledResourceIds.add(resource.id);
                }
            }
            return true;
        }

        // Otherwise, place as much as possible starting from this day
        for (const resource of block.allResources) {
            if (!this.resourcePool.has(resource.id)) continue;

            let placed = false;
            // Try to place on current day first, then search forward
            for (let attempt = 0; attempt < this.studyDays.length; attempt++) {
                const tryDayIndex = (currentDayIndex + attempt) % this.studyDays.length;
                const tryDay = this.studyDays[tryDayIndex];

                if (this.getRemainingTimeForDay(tryDay) >= resource.durationMinutes) {
                    tryDay.tasks.push(this.convertResourceToTask(resource, tryDay.tasks.length));
                    this.resourcePool.delete(resource.id);
                    this.scheduledResourceIds.add(resource.id);
                    placed = true;
                    currentDayIndex = tryDayIndex;
                    currentDay = tryDay;
                    break;
                }
            }

            if (!placed) {
                this.notifications.push({ 
                    type: 'warning', 
                    message: `Could not fit "${resource.title}" from block ${block.id}` 
                });
                return false;
            }
        }

        return true;
    }

    private phase1_PrimaryContentDistribution(): void {
        // Build topic blocks grouped by anchor resources
        const topicBlocks = this.buildTopicBlocks();

        if (topicBlocks.length === 0) {
            this.notifications.push({ 
                type: 'info', 
                message: 'No primary content blocks found for Phase 1' 
            });
            return;
        }

        // Round-robin distribution across all study days
        let dayIndex = 0;
        for (const block of topicBlocks) {
            this.placeBlockRoundRobin(block, dayIndex % this.studyDays.length);
            dayIndex++;
        }
    }

    private phase2_DailyRequirements(): void {
        // Phase 2: Fill daily requirements using First-Fit
        // - Nuclear Medicine content daily
        // - NIS/RISC content daily
        // - Context-aware Board Vitals (only for topics already covered)

        const remainingPrimary = this.allResources.filter(r => 
            this.resourcePool.has(r.id) && 
            r.isPrimaryMaterial &&
            !this.scheduledResourceIds.has(r.id)
        );

        // Separate pools by category
        const nucMedPool = remainingPrimary.filter(r => 
            r.domain === Domain.NUCLEAR_MEDICINE
        ).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

        const nisRiscPool = remainingPrimary.filter(r => 
            r.domain === Domain.NIS || r.domain === Domain.RISC
        ).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

        const boardVitalsPool = remainingPrimary.filter(r => 
            r.bookSource === 'Board Vitals'
        ).sort((a, b) => {
            // Prioritize by domain order
            const domainIndexA = this.topicOrder.indexOf(a.domain);
            const domainIndexB = this.topicOrder.indexOf(b.domain);
            return domainIndexA - domainIndexB;
        });

        // First-fit placement for each day
        for (let dayIdx = 0; dayIdx < this.studyDays.length; dayIdx++) {
            const day = this.studyDays[dayIdx];

            // Track topics covered up to and including this day
            const coveredTopicsUpToDay = new Set<Domain>();
            for (let i = 0; i <= dayIdx; i++) {
                this.studyDays[i].tasks.forEach(task => {
                    coveredTopicsUpToDay.add(task.originalTopic);
                });
            }

            // Try to fit one Nuclear Medicine resource
            const fitFirstAvailable = (pool: StudyResource[]) => {
                for (let i = 0; i < pool.length; i++) {
                    const resource = pool[i];
                    if (this.resourcePool.has(resource.id) && 
                        this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                        this.resourcePool.delete(resource.id);
                        this.scheduledResourceIds.add(resource.id);
                        pool.splice(i, 1);
                        return true;
                    }
                }
                return false;
            };

            fitFirstAvailable(nucMedPool);
            fitFirstAvailable(nisRiscPool);

            // Context-aware Board Vitals - only place if topic already covered
            for (let i = 0; i < boardVitalsPool.length; i++) {
                const resource = boardVitalsPool[i];
                if (this.resourcePool.has(resource.id) && 
                    coveredTopicsUpToDay.has(resource.domain) &&
                    this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    this.scheduledResourceIds.add(resource.id);
                    boardVitalsPool.splice(i, 1);
                    break;
                }
            }
        }
    }

    private phase3_SupplementaryFill(): void {
        // Phase 3: Opportunistic supplementary material placement
        // Priority: Discord videos, then other supplementary materials
        // Only place supplementary materials that match topics covered on that day

        const supplementaryPool = this.allResources.filter(r => 
            !r.isPrimaryMaterial && 
            !r.isArchived &&
            this.resourcePool.has(r.id) &&
            !this.scheduledResourceIds.has(r.id)
        ).sort((a, b) => {
            // Discord videos get priority
            if (a.videoSource === 'Discord' && b.videoSource !== 'Discord') return -1;
            if (a.videoSource !== 'Discord' && b.videoSource === 'Discord') return 1;
            // Then by type priority
            return (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99);
        });

        for (const day of this.studyDays) {
            const dayTopics = new Set(day.tasks.map(t => t.originalTopic));
            
            for (let i = supplementaryPool.length - 1; i >= 0; i--) {
                const resource = supplementaryPool[i];
                
                if (dayTopics.has(resource.domain) && 
                    this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    this.scheduledResourceIds.add(resource.id);
                    supplementaryPool.splice(i, 1);
                }
            }
        }

        // Final pass: try to place any remaining supplementary materials anywhere
        for (const day of this.studyDays) {
            for (let i = supplementaryPool.length - 1; i >= 0; i--) {
                const resource = supplementaryPool[i];
                
                if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    this.scheduledResourceIds.add(resource.id);
                    supplementaryPool.splice(i, 1);
                }
            }
        }
    }

    private finalizeSchedule(): void {
        // Sort tasks within each day by their order
        this.schedule.forEach(day => {
            day.tasks.sort((a, b) => a.order - b.order);
        });

        // Report unscheduled resources
        this.resourcePool.forEach(unscheduledResource => {
            if (!this.scheduledResourceIds.has(unscheduledResource.id)) {
                this.notifications.push({ 
                    type: 'warning', 
                    message: `Could not schedule: "${unscheduledResource.title}" (${unscheduledResource.durationMinutes} min)` 
                });
            }
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

        // Execute the three-phase algorithm
        this.phase1_PrimaryContentDistribution();
        this.phase2_DailyRequirements();
        this.phase3_SupplementaryFill();
        this.finalizeSchedule();

        // Calculate progress per domain
        const progressPerDomain: StudyPlan['progressPerDomain'] = {};
        this.allResources.forEach(r => {
            if (!progressPerDomain[r.domain]) {
                progressPerDomain[r.domain] = { completedMinutes: 0, totalMinutes: 0 };
            }
            progressPerDomain[r.domain]!.totalMinutes += r.durationMinutes;
        });

        // Count completed tasks
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
