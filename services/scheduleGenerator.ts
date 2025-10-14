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
                    isSplittable: false, // The chunks themselves are not splittable further
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
        const initialPool = chunkLargeResources(resourcePool.filter(r => r.isPrimaryMaterial));
        this.resourcePool = new Map(initialPool.map(r => [r.id, r]));
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

    private convertResourceToTask(resource: StudyResource, order: number): ScheduledTask {
        this.taskCounter++;
        const originalResourceId = resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id;

        return {
            id: `task_${resource.id}_${this.taskCounter}`,
            resourceId: resource.id,
            originalResourceId: originalResourceId,
            title: resource.title, type: resource.type, originalTopic: resource.domain,
            durationMinutes: resource.durationMinutes, status: 'pending', order, isOptional: resource.isOptional,
            isPrimaryMaterial: resource.isPrimaryMaterial, pages: resource.pages, startPage: resource.startPage, endPage: resource.endPage,
            caseCount: resource.caseCount, questionCount: resource.questionCount,
            chapterNumber: resource.chapterNumber, bookSource: resource.bookSource, videoSource: resource.videoSource,
        };
    }
    
    private getRemainingTimeForDay = (day: DailySchedule): number => day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

    private placeBlock(block: StudyResource[], startDayIndex: number): void {
        let currentDayIndex = startDayIndex;

        for (const resource of block) {
            if (!this.resourcePool.has(resource.id)) continue;

            let placed = false;
            // Try to place the resource starting from currentDayIndex, wrapping around if necessary
            for (let i = 0; i < this.studyDays.length; i++) {
                const dayIndex = (currentDayIndex + i) % this.studyDays.length;
                const day = this.studyDays[dayIndex];
                
                if (this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    placed = true;
                    // Important: The next resource in the same block starts searching from this day.
                    currentDayIndex = dayIndex; 
                    break;
                }
            }

            if (!placed) {
                this.notifications.push({ type: 'warning', message: `Could not fit "${resource.title}" from a block.` });
            }
        }
    }
    
    private getResourceBlock(anchor: StudyResource): StudyResource[] {
        const block: StudyResource[] = [anchor];
        const usedIds = new Set<string>([anchor.id]);

        (anchor.pairedResourceIds || []).forEach(pairedId => {
            const pairedResource = this.allResources.find(r => r.id === pairedId);
            if (pairedResource && !usedIds.has(pairedId)) {
                block.push(pairedResource);
                usedIds.add(pairedId);
            }
        });

        return block.sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
    }


    public runFullAlgorithm(): GeneratedStudyPlanOutcome {
        if (this.studyDays.length === 0) {
            this.notifications.push({ type: 'error', message: "No study days available in the selected date range." });
            // Return empty plan structure
            return { plan: { schedule: [], progressPerDomain: {}, startDate: '', endDate: '', firstPassEndDate: null, topicOrder: [], cramTopicOrder: [], deadlines: {}, isCramModeActive: false, areSpecialTopicsInterleaved: false }, notifications: this.notifications };
        }

        // --- Phase 1: Primary Content Distribution ---
        const primaryAnchors = this.allResources.filter(r => 
            r.isPrimaryMaterial && 
            (r.type === ResourceType.VIDEO_LECTURE || r.type === ResourceType.HIGH_YIELD_VIDEO)
        ).sort((a,b) => (a.sequenceOrder || 9999) - (b.sequenceOrder || 9999));
        
        let rrDayCursor = 0;
        
        const processBlocksForAnchors = (anchors: StudyResource[]) => {
            for (const anchor of anchors) {
                const block = this.getResourceBlock(anchor);
                // Place the block starting on the next round-robin day
                this.placeBlock(block, rrDayCursor % this.studyDays.length);
                rrDayCursor++;
            }
        }
        
        // Phase 1a, 1b, 1c logic simplified by ordering the anchors
        processBlocksForAnchors(primaryAnchors);


        // --- Phase 2: Daily Requirements (First-Fit) ---
        const remainingPrimary = this.allResources.filter(r => this.resourcePool.has(r.id) && r.isPrimaryMaterial);
        
        const nucMedPool = remainingPrimary.filter(r => r.domain === Domain.NUCLEAR_MEDICINE).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
        const nisRiscPool = remainingPrimary.filter(r => r.domain === Domain.NIS || r.domain === Domain.RISC).sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
        const boardVitalsPool = remainingPrimary.filter(r => r.bookSource === 'Board Vitals'); // Simplified for now
        
        for (const day of this.studyDays) {
            const coveredTopics = new Set(this.schedule.slice(0, this.schedule.indexOf(day) + 1).flatMap(d => d.tasks.map(t => t.originalTopic)));

            const fitResource = (pool: StudyResource[]) => {
                for (let i = 0; i < pool.length; i++) {
                    const resource = pool[i];
                    if (this.resourcePool.has(resource.id) && this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                        this.resourcePool.delete(resource.id);
                        pool.splice(i, 1);
                        return;
                    }
                }
            };
            
            fitResource(nucMedPool);
            fitResource(nisRiscPool);

            // Context-aware Board Vitals
            for (let i = 0; i < boardVitalsPool.length; i++) {
                const resource = boardVitalsPool[i];
                if (this.resourcePool.has(resource.id) && coveredTopics.has(resource.domain) && this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                    boardVitalsPool.splice(i, 1);
                    break;
                }
            }
        }
        
        // --- Phase 3: Supplementary Fill ---
        const supplementaryPool = this.allResources.filter(r => !r.isPrimaryMaterial && !r.isArchived)
            .sort((a, b) => (a.videoSource === 'Discord' ? -1 : 1));

        for (const day of this.studyDays) {
            const dayTopics = new Set(day.tasks.map(t => t.originalTopic));
            for (let i = 0; i < supplementaryPool.length; i++) {
                const resource = supplementaryPool[i];
                if (this.getRemainingTimeForDay(day) >= resource.durationMinutes && dayTopics.has(resource.domain)) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    supplementaryPool.splice(i, 1);
                    i--; // Adjust index after removal
                }
            }
        }
        
        this.resourcePool.forEach(unscheduledResource => {
             this.notifications.push({ type: 'warning', message: `Could not schedule: "${unscheduledResource.title}"` });
        });

        this.schedule.forEach(day => day.tasks.sort((a, b) => a.order - b.order));
        
        const progressPerDomain: StudyPlan['progressPerDomain'] = {};
        this.allResources.forEach(r => {
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
