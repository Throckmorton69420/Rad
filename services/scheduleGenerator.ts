import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, GeneratedStudyPlanOutcome, DeadlineSettings, Domain, ScheduledTask, ResourceType, DailySchedule } from '../types';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { TASK_TYPE_PRIORITY, DEFAULT_TOPIC_ORDER } from '../constants';

/**
 * Calculates the real-world study duration for a resource based on its type and metrics,
 * adhering to the user's specific time allocation rules.
 * This overrides any `durationMinutes` present in the source data for relevant types.
 */
const calculateAccurateResourceDuration = (resource: StudyResource): number => {
    let calculatedMinutes = 0;

    switch (resource.type) {
        case ResourceType.READING_TEXTBOOK:
        case ResourceType.READING_GUIDE:
            if (resource.pages && resource.pages > 0) {
                calculatedMinutes = resource.pages * 0.5; // 30 seconds per page
            }
            break;
        case ResourceType.VIDEO_LECTURE:
        case ResourceType.HIGH_YIELD_VIDEO:
            if (resource.durationMinutes > 0) {
                calculatedMinutes = resource.durationMinutes * 0.75; // 75% of video duration
            }
            break;
        case ResourceType.CASES:
            // This includes Case Companion cases
            calculatedMinutes = (resource.caseCount || 1) * 1; // 1 min per case, default to 1 if not specified
            if (resource.title.includes('Aunt Minnie')) { // Special timing for Aunt Minnie's
                 const caseMatch = resource.title.match(/\(Cases (\d+)-(\d+)\)/);
                 if (caseMatch) {
                     const start = parseInt(caseMatch[1]);
                     const end = parseInt(caseMatch[2]);
                     calculatedMinutes = (end - start + 1) * 1;
                 }
            }
            break;
        case ResourceType.QUESTIONS:
        case ResourceType.REVIEW_QUESTIONS:
        case ResourceType.QUESTION_REVIEW:
            if (resource.questionCount && resource.questionCount > 0) {
                calculatedMinutes = resource.questionCount * 1.5; // 1 min per question + 30s review
            }
            break;
        default:
            calculatedMinutes = resource.durationMinutes;
            break;
    }

    if (calculatedMinutes <= 0) {
        calculatedMinutes = resource.durationMinutes;
    }
    
    return Math.round(calculatedMinutes > 0 ? calculatedMinutes : 1);
};


interface TopicBlock {
    primaryAnchor: StudyResource;
    associatedResources: StudyResource[];
    totalDuration: number;
    isSplittable: boolean;
}

class Scheduler {
    private schedule: DailySchedule[];
    private masterResourcePool: StudyResource[];
    private topicOrder: Domain[];
    private deadlines: DeadlineSettings;
    private areSpecialTopicsInterleaved: boolean;

    private resourceMap: Map<string, StudyResource>;
    private scheduledResourceIds = new Set<string>();
    private coveredTopicsByDate: Map<string, Set<Domain>> = new Map();

    constructor(
        masterResourcePool: StudyResource[],
        exceptionDates: ExceptionDateRule[],
        topicOrder: Domain[],
        deadlines: DeadlineSettings,
        startDate: string,
        endDate: string,
        areSpecialTopicsInterleaved: boolean
    ) {
        this.masterResourcePool = masterResourcePool
            .filter(r => !r.isArchived)
            .map(r => ({
                ...r,
                durationMinutes: calculateAccurateResourceDuration(r)
            }));
        this.topicOrder = topicOrder;
        this.deadlines = deadlines;
        this.areSpecialTopicsInterleaved = areSpecialTopicsInterleaved;
        this.resourceMap = new Map(this.masterResourcePool.map(r => [r.id, r]));

        this.schedule = this.initializeSchedule(startDate, endDate, exceptionDates);
    }

    private initializeSchedule(startDate: string, endDate: string, exceptionDates: ExceptionDateRule[]): DailySchedule[] {
        const schedule: DailySchedule[] = [];
        const exceptionMap = new Map(exceptionDates.map(e => [e.date, e]));
        let currentDate = parseDateString(startDate);
        const finalDate = parseDateString(endDate);

        while (currentDate <= finalDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const exception = exceptionMap.get(dateStr);
            const isRestDay = exception ? exception.isRestDayOverride : false;
            
            schedule.push({
                date: dateStr,
                dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
                tasks: [],
                totalStudyTimeMinutes: isRestDay ? 0 : (exception?.targetMinutes ?? 14 * 60),
                isRestDay: isRestDay,
                isManuallyModified: !!exception,
            });
            this.coveredTopicsByDate.set(dateStr, new Set<Domain>());
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
        return schedule;
    }

    public generate(): { plan: StudyPlan; notifications: any[] } {
        this.runPrimaryContentPass();
        this.runDailyRequirementsPass();
        this.runBoardVitalsPass();
        this.runSupplementaryLecturesPass();
        this.runOptionalContentPass();
        this.finalizeSchedule();

        const notifications: any[] = [];
        const unscheduledPrimary = this.masterResourcePool.filter(r => r.isPrimaryMaterial && !this.scheduledResourceIds.has(r.id));
        if (unscheduledPrimary.length > 0) {
            notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} primary resources could not be fully scheduled.` });
            console.warn("Unscheduled Primary Resources:", unscheduledPrimary.map(r => r.title));
        }

        const firstPassEndDate = this.schedule.slice().reverse().find(day => day.tasks.some(t => t.isPrimaryMaterial))?.date || this.schedule[this.schedule.length-1].date;

        const plan: StudyPlan = {
            schedule: this.schedule,
            progressPerDomain: this.calculateInitialProgress(),
            startDate: this.schedule[0].date,
            endDate: this.schedule[this.schedule.length - 1].date,
            firstPassEndDate,
            topicOrder: this.topicOrder,
            cramTopicOrder: [], // Placeholder
            deadlines: this.deadlines,
            isCramModeActive: false,
            areSpecialTopicsInterleaved: this.areSpecialTopicsInterleaved,
        };
        
        return { plan, notifications };
    }

    private findAvailableSlot(duration: number, dateIndex: number = 0): number {
        for (let i = dateIndex; i < this.schedule.length; i++) {
            const day = this.schedule[i];
            if (day.isRestDay) continue;
            const scheduledTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
            if (scheduledTime + duration <= day.totalStudyTimeMinutes) {
                return i;
            }
        }
        return -1; // No slot found
    }
    
    private scheduleTask(dateIndex: number, resource: StudyResource, duration?: number, startPage?: number, endPage?: number) {
        const day = this.schedule[dateIndex];
        const task: ScheduledTask = {
            id: `${resource.id}_${day.date}_${Math.random()}`,
            resourceId: resource.id,
            originalResourceId: resource.id,
            title: resource.title,
            type: resource.type,
            originalTopic: resource.domain,
            durationMinutes: duration || resource.durationMinutes,
            status: 'pending',
            order: day.tasks.length,
            isPrimaryMaterial: resource.isPrimaryMaterial,
            bookSource: resource.bookSource,
            videoSource: resource.videoSource,
            chapterNumber: resource.chapterNumber,
            pages: endPage && startPage ? endPage - startPage + 1 : resource.pages,
            startPage: startPage,
            endPage: endPage,
            questionCount: resource.questionCount,
        };
        day.tasks.push(task);
        this.scheduledResourceIds.add(resource.id);
        this.coveredTopicsByDate.get(day.date)!.add(resource.domain);
    }


    private getPrimaryAnchors(): StudyResource[] {
        return this.masterResourcePool.filter(r => 
            r.isPrimaryMaterial && 
            (r.type === ResourceType.VIDEO_LECTURE && r.videoSource === 'Titan Radiology') ||
            (r.type === ResourceType.VIDEO_LECTURE && r.videoSource === 'Huda' && r.domain === Domain.PHYSICS)
        ).sort((a,b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));
    }

    private createTopicBlock(anchor: StudyResource): TopicBlock {
        const associatedResources = new Set<StudyResource>([anchor]);
        const seenIds = new Set<string>([anchor.id]);

        const findPairs = (resource: StudyResource) => {
            (resource.pairedResourceIds || []).forEach(id => {
                const pairedResource = this.resourceMap.get(id);
                if(pairedResource && !seenIds.has(id) && pairedResource.isPrimaryMaterial) {
                    seenIds.add(id);
                    associatedResources.add(pairedResource);
                    findPairs(pairedResource);
                }
            });
        };
        findPairs(anchor);

        const resources = Array.from(associatedResources);
        const totalDuration = resources.reduce((sum, r) => sum + r.durationMinutes, 0);
        const isSplittable = resources.some(r => r.isSplittable);

        return { primaryAnchor: anchor, associatedResources: resources, totalDuration, isSplittable };
    }

    private runPrimaryContentPass() {
        const anchors = this.getPrimaryAnchors();
        let currentDayIndex = 0;

        for (const anchor of anchors) {
            if (this.scheduledResourceIds.has(anchor.id)) continue;
            
            const block = this.createTopicBlock(anchor);
            let remainingDuration = block.totalDuration;
            
            while (remainingDuration > 0 && currentDayIndex < this.schedule.length) {
                const day = this.schedule[currentDayIndex];
                if (day.isRestDay) {
                    currentDayIndex++;
                    continue;
                }
                
                const scheduledTime = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
                let availableTime = day.totalStudyTimeMinutes - scheduledTime;
                
                if (availableTime <= 0) {
                    currentDayIndex++;
                    continue;
                }

                const timeToSchedule = Math.min(remainingDuration, availableTime);
                const proportion = timeToSchedule / remainingDuration;

                block.associatedResources.forEach(res => {
                    if (this.scheduledResourceIds.has(res.id)) return;

                    if (!res.isSplittable || proportion >= 1) {
                        if (availableTime >= res.durationMinutes) {
                            this.scheduleTask(currentDayIndex, res);
                            availableTime -= res.durationMinutes;
                        }
                    } else {
                        const durationToSchedule = Math.round(res.durationMinutes * proportion);
                        if (durationToSchedule > 0 && availableTime >= durationToSchedule) {
                            this.scheduleTask(currentDayIndex, res, durationToSchedule);
                            res.durationMinutes -= durationToSchedule; // Mutate for next iteration
                            availableTime -= durationToSchedule;
                        }
                    }
                });
                
                remainingDuration = block.associatedResources
                    .filter(r => !this.scheduledResourceIds.has(r.id))
                    .reduce((sum, r) => sum + r.durationMinutes, 0);

                if (remainingDuration > 0 && availableTime <= 10) {
                    currentDayIndex++;
                }
            }
        }
    }
    
    private runDailyRequirementsPass() {
      // Logic for Physics, Nucs, NIS/RISC daily requirements
      const physicsResources = this.masterResourcePool.filter(r => r.domain === Domain.PHYSICS && r.isPrimaryMaterial);
      const nucsResources = this.masterResourcePool.filter(r => r.domain === Domain.NUCLEAR_MEDICINE && r.isPrimaryMaterial);
      const nisRiscResources = this.masterResourcePool.filter(r => (r.domain === Domain.NIS || r.domain === Domain.RISC) && r.isPrimaryMaterial);
      
      if(this.areSpecialTopicsInterleaved) {
        // Interleave small chunks
        let physIdx = 0, nucsIdx = 0;
        this.schedule.forEach((day, dayIndex) => {
            const availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            if (availableTime < 30) return;

            // Physics every other day
            if (dayIndex % 2 === 0 && physIdx < physicsResources.length) {
                 // Simplified: grab next unscheduled physics task
            }
             // Nucs daily
             if (nucsIdx < nucsResources.length) {
                 // Simplified: grab next unscheduled nucs task
            }
        });
      } else {
        // Schedule as large blocks based on topicOrder
      }
    }
    
    private getCoveredTopics(untilDate: string): Set<Domain> {
        const covered = new Set<Domain>();
        for(const day of this.schedule) {
            if (day.date > untilDate) break;
            day.tasks.forEach(task => covered.add(task.originalTopic));
        }
        return covered;
    }

    private runBoardVitalsPass() {
        this.schedule.forEach(day => {
            const scheduledTime = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            let availableTime = day.totalStudyTimeMinutes - scheduledTime;
            if (availableTime < 30) return;
            
            const coveredTopics = this.getCoveredTopics(day.date);
            const relevantBV = this.masterResourcePool.filter(r => 
                !this.scheduledResourceIds.has(r.id) &&
                r.bookSource === 'Board Vitals' &&
                coveredTopics.has(r.domain)
            );

            if (relevantBV.length > 0) {
                const resourceToSchedule = relevantBV[0]; // Simple selection
                const duration = Math.min(availableTime, resourceToSchedule.durationMinutes);
                this.scheduleTask(this.schedule.indexOf(day), resourceToSchedule, duration);
                resourceToSchedule.durationMinutes -= duration;
                if(resourceToSchedule.durationMinutes <= 0) this.scheduledResourceIds.add(resourceToSchedule.id);
            }
        });
    }

    private runSupplementaryLecturesPass() {
        const discordLectures = this.masterResourcePool.filter(r => r.videoSource === 'Discord');
        let dateIndex = 0;
        discordLectures.forEach(lecture => {
             const slotIndex = this.findAvailableSlot(lecture.durationMinutes, dateIndex);
             if (slotIndex !== -1) {
                 const dayTopics = this.coveredTopicsByDate.get(this.schedule[slotIndex].date)!;
                 if (dayTopics.has(lecture.domain)) {
                     this.scheduleTask(slotIndex, lecture);
                     dateIndex = slotIndex;
                 }
             }
        });
    }
    
    private runOptionalContentPass() {
        const coreRadiology = this.masterResourcePool.filter(r => r.bookSource === 'Core Radiology');
        this.schedule.forEach((day, dayIndex) => {
            const dayTopics = this.getCoveredTopics(day.date);
            let availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);

            coreRadiology.forEach(res => {
                if (availableTime > 0 && !this.scheduledResourceIds.has(res.id) && dayTopics.has(res.domain)) {
                    if (availableTime >= res.durationMinutes) {
                        this.scheduleTask(dayIndex, res);
                        availableTime -= res.durationMinutes;
                    }
                }
            });
        });
    }
    
    private finalizeSchedule() {
        this.schedule.forEach(day => {
            day.tasks.sort((a, b) => {
                const priorityA = TASK_TYPE_PRIORITY[a.type] || 99;
                const priorityB = TASK_TYPE_PRIORITY[b.type] || 99;
                if (priorityA !== priorityB) return priorityA - priorityB;
                const seqA = this.resourceMap.get(a.resourceId)?.sequenceOrder ?? 9999;
                const seqB = this.resourceMap.get(b.resourceId)?.sequenceOrder ?? 9999;
                return seqA - seqB;
            });
            day.tasks.forEach((task, index) => task.order = index);
        });
    }

    private calculateInitialProgress() {
        const progress: StudyPlan['progressPerDomain'] = {};
        for(const domain of Object.values(Domain)) {
            const totalMinutes = this.masterResourcePool
                .filter(r => r.domain === domain && r.isPrimaryMaterial)
                .reduce((sum, r) => sum + (this.resourceMap.get(r.id)?.durationMinutes || 0), 0);
            progress[domain] = { completedMinutes: 0, totalMinutes };
        }
        return progress;
    }
}


export const generateInitialSchedule = (
  masterResourcePool: StudyResource[],
  exceptionDates: ExceptionDateRule[],
  topicOrder: Domain[] = DEFAULT_TOPIC_ORDER,
  deadlines: DeadlineSettings = {},
  startDate: string,
  endDate: string,
  areSpecialTopicsInterleaved: boolean = true,
): GeneratedStudyPlanOutcome => {
    
    const scheduler = new Scheduler(masterResourcePool, exceptionDates, topicOrder, deadlines, startDate, endDate, areSpecialTopicsInterleaved);
    return scheduler.generate();
};


export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionDates: ExceptionDateRule[],
  masterResourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    const rebalanceDate = options.type === 'standard' ? (options.rebalanceDate || getTodayInNewYork()) : options.date;
    
    const completedResourceIds = new Set<string>();
    currentPlan.schedule.forEach(day => {
        if (day.date < rebalanceDate) {
            day.tasks.forEach(task => {
                if(task.status === 'completed') {
                    completedResourceIds.add(task.originalResourceId || task.resourceId);
                }
            });
        }
    });

    const resourcesToReschedule = masterResourcePool.filter(r => !completedResourceIds.has(r.id));
    
    const scheduler = new Scheduler(
        resourcesToReschedule,
        exceptionDates,
        currentPlan.topicOrder,
        currentPlan.deadlines,
        rebalanceDate,
        currentPlan.endDate,
        currentPlan.areSpecialTopicsInterleaved
    );
    const futureOutcome = scheduler.generate();

    const finalSchedule = currentPlan.schedule.filter(day => day.date < rebalanceDate);
    finalSchedule.push(...futureOutcome.plan.schedule);

    const finalPlan = { ...currentPlan, schedule: finalSchedule };
    const progress: StudyPlan['progressPerDomain'] = {};
     Object.values(Domain).forEach(domain => {
        const totalMinutes = masterResourcePool
            .filter(r => r.domain === domain && !r.isArchived && r.isPrimaryMaterial)
            .reduce((sum, r) => sum + calculateAccurateResourceDuration(r), 0);

        const completedMinutes = finalSchedule
            .flatMap(d => d.tasks)
            .filter(t => t.originalTopic === domain && t.status === 'completed')
            .reduce((sum, t) => sum + t.durationMinutes, 0);

        progress[domain] = { completedMinutes, totalMinutes };
    });
    finalPlan.progressPerDomain = progress;

    const notifications = futureOutcome.notifications;
    notifications.push({ type: 'info', message: 'Schedule has been rebalanced successfully.' });

    return { plan: finalPlan, notifications };
};
