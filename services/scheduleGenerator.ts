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

    private placeBlockContiguously(block: StudyResource[], startDayIndex: number): number {
        let currentDayIndex = startDayIndex;

        for (const resource of block) {
            if (!this.resourcePool.has(resource.id)) continue;
            
            let remainingDuration = resource.durationMinutes;

            while (remainingDuration > 0) {
                if (currentDayIndex >= this.studyDays.length) {
                    // Ran out of schedule, can't place this resource. Return failure.
                    return -1; 
                }

                const day = this.studyDays[currentDayIndex];
                const availableTime = this.getRemainingTimeForDay(day);

                if (availableTime <= 0) {
                    currentDayIndex++;
                    continue; // Move to the next day if current is full
                }

                const timeToPlace = Math.min(remainingDuration, availableTime);
                
                if (!resource.isSplittable) {
                    if (availableTime >= remainingDuration) {
                        day.tasks.push(this.convertResourceToTask(resource, day.tasks.length));
                        this.resourcePool.delete(resource.id);
                        remainingDuration = 0;
                    } else {
                        // Cannot split, and not enough time. We have to fail the whole block placement for this resource.
                        // In a more complex system, we could try to shift, but for now, this indicates failure.
                        return -1;
                    }
                } else { // Is splittable
                    // Only place if it's a meaningful chunk or it's the last bit
                    if (timeToPlace >= MIN_DURATION_for_SPLIT_PART || timeToPlace === remainingDuration) {
                         const numParts = Math.ceil(resource.durationMinutes / MIN_DURATION_for_SPLIT_PART);
                         const currentPart = numParts - Math.floor(remainingDuration / MIN_DURATION_for_SPLIT_PART);

                         day.tasks.push(this.convertResourceToTask(resource, day.tasks.length, timeToPlace, { part: currentPart, total: numParts }));
                         remainingDuration -= timeToPlace;
                         if (remainingDuration <= 0) {
                            this.resourcePool.delete(resource.id);
                         }
                    }

                    // Move to next day if current day is now full
                    if (this.getRemainingTimeForDay(day) <= 0) {
                        currentDayIndex++;
                    }
                }
            }
        }
        return currentDayIndex; // Return the index of the day where placement ended
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
                    firstPassEndDate: null, topicOrder: [], cramTopicOrder: [],
                    deadlines: {}, isCramModeActive: false, areSpecialTopicsInterleaved: true,
                },
                notifications: this.notifications,
            };
        }

        const allResourcesSorted = Array.from(this.resourcePool.values()).sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));

        // --- PHASE 1: ROUND ROBIN DISTRIBUTION ---
        const processPrimaryBlocks = (anchors: StudyResource[], pairings: ResourceType[][]) => {
            const blocks = this.buildBlocks(anchors, pairings);
            let rrDayCursor = 0;
            for (const block of blocks) {
                let placed = false;
                let attemptIndex = rrDayCursor;

                // Try to find a slot starting from the round-robin cursor
                while(attemptIndex < this.studyDays.length) {
                    if (this.getRemainingTimeForDay(this.studyDays[attemptIndex]) > 0) {
                       const result = this.placeBlockContiguously(block, attemptIndex);
                       if (result !== -1) {
                           placed = true;
                           break;
                       }
                    }
                    attemptIndex++;
                }

                // If not placed, try wrapping around from the beginning
                if (!placed) {
                    attemptIndex = 0;
                     while(attemptIndex < rrDayCursor) {
                        if (this.getRemainingTimeForDay(this.studyDays[attemptIndex]) > 0) {
                           const result = this.placeBlockContiguously(block, attemptIndex);
                           if (result !== -1) {
                               placed = true;
                               break;
                           }
                        }
                        attemptIndex++;
                    }
                }
                
                rrDayCursor = (rrDayCursor + 1) % this.studyDays.length;
            }
        };
        
        // Pass 1a: Titan Blocks
        const titanAnchors = allResourcesSorted.filter(r => r.videoSource === 'Titan Radiology' && r.isPrimaryMaterial);
        processPrimaryBlocks(titanAnchors, [[ResourceType.READING_TEXTBOOK], [ResourceType.CASES], [ResourceType.QUESTIONS]]);
        
        // Pass 1b: Huda Blocks
        const hudaAnchors = allResourcesSorted.filter(r => r.videoSource === 'Huda' && r.type === ResourceType.VIDEO_LECTURE && r.isPrimaryMaterial);
        processPrimaryBlocks(hudaAnchors, [[ResourceType.QUESTIONS], [ResourceType.READING_TEXTBOOK]]);
        
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
        this.schedule.forEach(day => day.tasks.sort((a, b) => a.order - b.order));
        
        const planStartDate = this.schedule.length > 0 ? this.schedule[0].date : getTodayInNewYork();
        const planEndDate = this.schedule.length > 0 ? this.schedule[this.schedule.length - 1].date : planStartDate;
        
        const unscheduledPrimary = Array.from(this.resourcePool.values()).filter(r => r.isPrimaryMaterial && !r.isArchived);
        if (unscheduledPrimary.length > 0) {
             this.notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} primary resources could not be scheduled. Consider increasing daily study time or extending the study period.` });
        } else if (this.resourcePool.size > 0) {
            this.notifications.push({ type: 'info', message: `Successfully scheduled all primary content! ${this.resourcePool.size} optional resources remain unscheduled.` });
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

    const outcome = generateInitialSchedule(
        remainingPool, exceptionRules, currentPlan.topicOrder, currentPlan.deadlines,
        rebalanceDate, currentPlan.endDate, currentPlan.areSpecialTopicsInterleaved
    );

    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceDate);
    const outcome = outcome; // Corrected variable name
    outcome.plan.schedule = [...pastSchedule, ...outcome.plan.schedule];

    Object.values(Domain).forEach(domain => {
      const totalMinutes = outcome.plan.schedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain).reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      const completedMinutes = pastSchedule.reduce((sum, day) => sum + day.tasks.filter(t => t.originalTopic === domain && t.status === 'completed').reduce((taskSum, task) => taskSum + task.durationMinutes, 0), 0);
      if (totalMinutes > 0) {
         outcome.plan.progressPerDomain[domain] = { completedMinutes, totalMinutes };
      }
    });

    return outcome;
};