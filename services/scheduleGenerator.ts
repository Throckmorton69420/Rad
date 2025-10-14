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

    constructor(
        startDateStr: string, 
        endDateStr: string, 
        exceptionRules: ExceptionDateRule[], 
        resourcePool: StudyResource[],
    ) {
        this.resourceMap = new Map(resourcePool.map(r => [r.id, r]));
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

    private placeBlockContiguously(block: StudyResource[], placementHead: number): number {
        let currentDayIndex = placementHead;

        for (const resource of block) {
            if (!this.resourcePool.has(resource.id)) continue;
            
            let remainingDuration = resource.durationMinutes;
            let partCount = 1;
            const numParts = resource.isSplittable ? Math.ceil(resource.durationMinutes / MIN_DURATION_for_SPLIT_PART) : 1;

            while (remainingDuration > 0 && currentDayIndex < this.studyDays.length) {
                const day = this.studyDays[currentDayIndex];
                const availableTime = this.getRemainingTimeForDay(day);

                if (availableTime <= 0) {
                    currentDayIndex++;
                    continue;
                }

                if (!resource.isSplittable) {
                    if (availableTime >= remainingDuration) {
                        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                        remainingDuration = 0;
                    } else {
                        currentDayIndex++; // Try next day
                    }
                } else {
                    const timeToPlace = Math.min(remainingDuration, availableTime);
                    if (timeToPlace >= MIN_DURATION_for_SPLIT_PART || timeToPlace === remainingDuration) {
                         day.tasks.push(this.convertResourceToTask(resource, day.tasks.length, timeToPlace, numParts > 1 ? { part: partCount, total: numParts } : undefined));
                         remainingDuration -= timeToPlace;
                         partCount++;
                    }
                     if (this.getRemainingTimeForDay(day) < MIN_DURATION_for_SPLIT_PART) {
                        currentDayIndex++;
                    }
                }
            }
            this.resourcePool.delete(resource.id);
        }
        return currentDayIndex;
    }

    private buildBlocks(anchors: StudyResource[], pairings: ResourceType[][]): StudyResource[][] {
        const blocks: StudyResource[][] = [];
        for (const anchor of anchors) {
            if (!this.resourcePool.has(anchor.id)) continue;
            
            const block: StudyResource[] = [anchor];
            
            for (const pairingSet of pairings) {
                (anchor.pairedResourceIds || []).forEach(pairedId => {
                    const resource = this.resourcePool.get(pairedId);
                    if (resource && pairingSet.includes(resource.type)) {
                        block.push(resource);
                    }
                });
            }
            
            // Sort block by defined priority to ensure videos/readings come before questions.
            const sortedBlock = [...new Set(block)].sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));
            blocks.push(sortedBlock);
        }
        return blocks;
    }
    
    public runFullAlgorithm(): GeneratedStudyPlanOutcome {
        if (this.studyDays.length === 0) {
            this.notifications.push({ type: 'error', message: "No study days available in the selected date range." });
            // Return a valid but empty plan
             return {
                plan: {
                    schedule: this.schedule, progressPerDomain: {}, startDate: this.schedule[0]?.date || '', endDate: this.schedule[this.schedule.length - 1]?.date || '',
                    firstPassEndDate: null, topicOrder: [], cramTopicOrder: [],
                    deadlines: {}, isCramModeActive: false, areSpecialTopicsInterleaved: true,
                },
                notifications: this.notifications,
            };
        }

        const allResourcesSorted = Array.from(this.resourcePool.values()).sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        // --- PHASE 1: ROUND ROBIN ---
        let rrDayCursor = 0;
        let placementHead = 0;
        
        // Pass 1a: Titan Blocks
        const titanAnchors = allResourcesSorted.filter(r => r.videoSource === 'Titan Radiology' && r.isPrimaryMaterial);
        const titanBlocks = this.buildBlocks(titanAnchors, [[ResourceType.READING_TEXTBOOK], [ResourceType.CASES], [ResourceType.QUESTIONS]]);
        
        for (const block of titanBlocks) {
            placementHead = Math.max(placementHead, rrDayCursor);
            placementHead = this.placeBlockContiguously(block, placementHead);
            rrDayCursor = (rrDayCursor + 1) % this.studyDays.length;
        }

        // Pass 1b: Huda Blocks
        const hudaAnchors = allResourcesSorted.filter(r => r.videoSource === 'Huda' && r.type === ResourceType.VIDEO_LECTURE && r.isPrimaryMaterial);
        const hudaBlocks = this.buildBlocks(hudaAnchors, [[ResourceType.QUESTIONS], [ResourceType.READING_TEXTBOOK]]);
        for (const block of hudaBlocks) {
            placementHead = Math.max(placementHead, rrDayCursor);
            placementHead = this.placeBlockContiguously(block, placementHead);
            rrDayCursor = (rrDayCursor + 1) % this.studyDays.length;
        }
        
        // --- PHASE 2: DAILY REQUIREMENTS (First-Fit) ---
        const cumulativeCoveredTopics = new Set<Domain>();
        
        for (const day of this.studyDays) {
            day.tasks.forEach(t => cumulativeCoveredTopics.add(t.originalTopic));

            const fitResource = (resource: StudyResource) => {
                if (this.resourcePool.has(resource.id) && this.getRemainingTimeForDay(day) >= resource.durationMinutes) {
                    day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                    this.resourcePool.delete(resource.id);
                }
            };
            
            // Pass 2a: Nucs
            const nucsResources = allResourcesSorted.filter(r => this.resourcePool.has(r.id) && r.domain === Domain.NUCLEAR_MEDICINE && r.isPrimaryMaterial);
            nucsResources.forEach(fitResource);

            // Pass 2b: NIS/RISC
            const nisRiscResources = allResourcesSorted.filter(r => this.resourcePool.has(r.id) && (r.domain === Domain.NIS || r.domain === Domain.RISC) && r.isPrimaryMaterial);
            nisRiscResources.forEach(fitResource);
            
            // Pass 2c: Board Vitals
            const bvResources = allResourcesSorted.filter(r => this.resourcePool.has(r.id) && r.bookSource === 'Board Vitals' && cumulativeCoveredTopics.has(r.domain));
            bvResources.forEach(fitResource);

            // Pass 2d: Physics (Titan Route)
            const physicsTitanRoute = allResourcesSorted.filter(r => this.resourcePool.has(r.id) && r.videoSource === 'Titan Radiology' && r.domain === Domain.PHYSICS);
            physicsTitanRoute.forEach(fitResource);
        }
        
        // --- PHASE 3: SUPPLEMENTARY ---
        for (const day of this.studyDays) {
            const dayTopics = new Set(day.tasks.map(t => t.originalTopic));
            dayTopics.forEach(t => cumulativeCoveredTopics.add(t));

            const fitIfRelevant = (pool: StudyResource[], relevancyCheck: (r: StudyResource) => boolean) => {
                const relevantItems = pool.filter(r => this.resourcePool.has(r.id) && relevancyCheck(r));
                for (const item of relevantItems) {
                     if (this.getRemainingTimeForDay(day) >= item.durationMinutes) {
                        day.tasks.push(this.convertResourceToTask(item, day.tasks.length));
                        this.resourcePool.delete(item.id);
                    }
                }
            };

            // Discord Videos
            const discordPool = allResourcesSorted.filter(r => r.videoSource === 'Discord');
            fitIfRelevant(discordPool, r => dayTopics.has(r.domain));

            // Core Radiology
            const coreRadiologyPool = allResourcesSorted.filter(r => r.bookSource === 'Core Radiology');
            fitIfRelevant(coreRadiologyPool, r => cumulativeCoveredTopics.has(r.domain));
        }

        // --- PHASE 4: VALIDATE & OPTIMIZE ---
        // Basic re-ordering, a more robust optimization could be added later if needed.
        this.schedule.forEach(day => day.tasks.sort((a, b) => a.order - b.order));
        
        const planStartDate = this.schedule.length > 0 ? this.schedule[0].date : getTodayInNewYork();
        const planEndDate = this.schedule.length > 0 ? this.schedule[this.schedule.length - 1].date : planStartDate;
        
        const unscheduledPrimary = Array.from(this.resourcePool.values()).filter(r => r.isPrimaryMaterial);
        if (unscheduledPrimary.length > 0) {
             this.notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} primary resources could not be scheduled. Consider increasing daily study time or extending the study period.` });
        } else {
             this.notifications.push({ type: 'info', message: `Successfully scheduled all ${this.resourceMap.size - this.resourcePool.size} resources!` });
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
    // Use the more granular chunking for initial generation.
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

    // When rebalancing, we should not pre-chunk. The new algorithm handles splitting dynamically.
    const outcome = generateInitialSchedule(
        remainingPool, exceptionRules, currentPlan.topicOrder, currentPlan.deadlines,
        rebalanceDate, currentPlan.endDate, currentPlan.areSpecialTopicsInterleaved
    );

    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceDate);
    // FIX: Corrected variable name from `rebalanceOutcome` to `outcome`.
    outcome.plan.schedule = [...pastSchedule, ...outcome.plan.schedule];

    Object.values(Domain).forEach(domain => {
      // FIX: Corrected variable name from `rebalanceOutcome` to `outcome`.
      const totalMinutes = outcome.plan.schedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain).reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      const completedMinutes = pastSchedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain && t.status === 'completed').reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      if (totalMinutes > 0) {
         // FIX: Corrected variable name from `rebalanceOutcome` to `outcome`.
         outcome.plan.progressPerDomain[domain] = { completedMinutes, totalMinutes };
      }
    });

    // FIX: Corrected variable name from `rebalanceOutcome` to `outcome`.
    return outcome;
};