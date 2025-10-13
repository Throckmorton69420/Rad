import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, GeneratedStudyPlanOutcome, DeadlineSettings, Domain, ScheduledTask, ResourceType, DailySchedule } from '../types';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { TASK_TYPE_PRIORITY } from '../constants';

const calculateResourceDuration = (resource: StudyResource): number => {
  switch (resource.type) {
    case ResourceType.READING_TEXTBOOK:
    case ResourceType.READING_GUIDE:
      return Math.round((resource.pages || 0) * 0.5);
    case ResourceType.VIDEO_LECTURE:
    case ResourceType.HIGH_YIELD_VIDEO:
      return Math.round(resource.durationMinutes * 0.75);
    case ResourceType.CASES:
      return (resource.caseCount || 0) * 1;
    case ResourceType.QUESTIONS:
    case ResourceType.REVIEW_QUESTIONS:
    case ResourceType.QUESTION_REVIEW:
      return Math.round((resource.questionCount || 0) * 1.5);
    default:
      return resource.durationMinutes;
  }
};

const resourceToTask = (resource: StudyResource, order: number, isOptionalOverride = false): ScheduledTask => {
    const calculatedDuration = calculateResourceDuration(resource);
    return {
        id: `${resource.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        resourceId: resource.id,
        originalResourceId: resource.id,
        title: resource.title,
        type: resource.type,
        originalTopic: resource.domain,
        durationMinutes: calculatedDuration,
        status: 'pending',
        order,
        isOptional: isOptionalOverride || !resource.isPrimaryMaterial,
        isPrimaryMaterial: resource.isPrimaryMaterial,
        pages: resource.pages,
        startPage: resource.startPage,
        endPage: resource.endPage,
        questionCount: resource.questionCount,
        caseCount: resource.caseCount,
        bookSource: resource.bookSource,
        videoSource: resource.videoSource,
        chapterNumber: resource.chapterNumber,
    };
};

export const generateInitialSchedule = (
  masterResourcePool: StudyResource[],
  exceptionDates: ExceptionDateRule[],
  topicOrder: Domain[] = [],
  deadlines: DeadlineSettings = {},
  startDate: string,
  endDate: string
): GeneratedStudyPlanOutcome => {
    let schedule: DailySchedule[] = [];
    const scheduledResourceIds = new Set<string>();
    const notifications: { type: 'error' | 'warning' | 'info'; message: string }[] = [];
    const exceptionMap = new Map(exceptionDates.map(e => [e.date, e]));
    
    let currentDate = parseDateString(startDate);
    const finalDate = parseDateString(endDate);

    while (currentDate <= finalDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const exception = exceptionMap.get(dateStr);
        const isRestDay = exception ? exception.isRestDayOverride : [0, 6].includes(currentDate.getUTCDay());
        
        schedule.push({
            date: dateStr,
            dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
            tasks: [],
            totalStudyTimeMinutes: isRestDay ? 0 : (exception?.targetMinutes ?? 14 * 60),
            isRestDay: isRestDay,
            isManuallyModified: false,
        });
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    const availableResources = masterResourcePool.filter(r => !r.isArchived);
    const resourceMap = new Map(availableResources.map(r => [r.id, r]));
    
    // Pass 1: Primary Content
    let currentTopicIndex = 0;
    const coveredDomains = new Set<Domain>();

    for (const day of schedule) {
        if (day.isRestDay) continue;

        let remainingTime = day.totalStudyTimeMinutes;
        let taskOrder = 0;
        
        const scheduleSet = (mainResId: string): boolean => {
            const mainRes = resourceMap.get(mainResId);
            if (!mainRes || scheduledResourceIds.has(mainResId)) return false;

            const resourceSet = [mainRes];
            (mainRes.pairedResourceIds || []).forEach(id => {
                const paired = resourceMap.get(id);
                if (paired && !scheduledResourceIds.has(id) && paired.isPrimaryMaterial) {
                    resourceSet.push(paired);
                }
            });

            const totalDuration = resourceSet.reduce((sum, r) => sum + calculateResourceDuration(r), 0);

            if (remainingTime >= totalDuration) {
                const depsMet = resourceSet.every(res => (res.dependencies || []).every(dep => scheduledResourceIds.has(dep)));
                if (!depsMet) return false;

                resourceSet
                    .sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99))
                    .forEach(res => {
                        day.tasks.push(resourceToTask(res, taskOrder++));
                        scheduledResourceIds.add(res.id);
                        coveredDomains.add(res.domain);
                    });
                remainingTime -= totalDuration;
                return true;
            }
            return false;
        };

        // Sub-pass 1.1: Daily Physics
        const hudaPhysicsVideo = availableResources.find(r => r.videoSource === 'Huda' && !scheduledResourceIds.has(r.id));
        if (hudaPhysicsVideo) {
            scheduleSet(hudaPhysicsVideo.id);
        } else {
            const titanPhysicsVideo = availableResources.find(r => r.domain === Domain.PHYSICS && r.videoSource === 'Titan Radiology' && !scheduledResourceIds.has(r.id));
            if(titanPhysicsVideo) scheduleSet(titanPhysicsVideo.id);
        }

        // Sub-pass 1.2: Daily Nucs, NIS, RISC
        const nucsVideo = availableResources.find(r => r.domain === Domain.NUCLEAR_MEDICINE && r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
        if (nucsVideo) scheduleSet(nucsVideo.id);

        const nisResource = availableResources.find(r => r.domain === Domain.NIS && r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
        if (nisResource) scheduleSet(nisResource.id);
        
        const riscResource = availableResources.find(r => r.domain === Domain.RISC && r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
        if (riscResource) scheduleSet(riscResource.id);

        // Sub-pass 1.3: Primary Topic of the Day
        let attempts = 0;
        let scheduledPrimary = false;
        while(attempts < topicOrder.length && !scheduledPrimary && remainingTime > 0) {
            const topic = topicOrder[currentTopicIndex % topicOrder.length];
            const nextResourceForTopic = availableResources.find(r => r.domain === topic && r.isPrimaryMaterial && r.type === ResourceType.VIDEO_LECTURE && !scheduledResourceIds.has(r.id));
            if (nextResourceForTopic && scheduleSet(nextResourceForTopic.id)) {
                scheduledPrimary = true;
            }
            currentTopicIndex++;
            attempts++;
        }
        
        // Sub-pass 1.4: Board Vitals
        const boardVitalsQBs = availableResources.filter(r => r.bookSource === 'Board Vitals' && !scheduledResourceIds.has(r.id) && coveredDomains.has(r.domain));
        if(boardVitalsQBs.length > 0) {
            const qbToSchedule = boardVitalsQBs[0];
            const qbDuration = calculateResourceDuration(qbToSchedule);
            if(remainingTime >= qbDuration) {
                day.tasks.push(resourceToTask(qbToSchedule, taskOrder++));
                scheduledResourceIds.add(qbToSchedule.id);
                remainingTime -= qbDuration;
            }
        }
    }
    
    // Pass 2: Supplementary Lectures (Discord)
    for (const day of schedule) {
        if (day.isRestDay) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (remainingTime <= 0) continue;
        
        const topicsToday = new Set(day.tasks.map(t => t.originalTopic));
        const discordLectures = availableResources.filter(r => r.videoSource === 'Discord' && !scheduledResourceIds.has(r.id) && topicsToday.has(r.domain));

        for (const lecture of discordLectures) {
            const duration = calculateResourceDuration(lecture);
            if (remainingTime >= duration) {
                day.tasks.push(resourceToTask(lecture, day.tasks.length, true));
                scheduledResourceIds.add(lecture.id);
                remainingTime -= duration;
            }
        }
    }

    // Pass 3: Optional Textbook (Core Radiology)
    let allCoveredTopicsCumulative = new Set<Domain>();
    for (const day of schedule) {
        day.tasks.forEach(t => allCoveredTopicsCumulative.add(t.originalTopic));
        if (day.isRestDay) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (remainingTime <= 0) continue;

        const coreReadings = availableResources.filter(r => r.bookSource === 'Core Radiology' && !scheduledResourceIds.has(r.id) && allCoveredTopicsCumulative.has(r.domain));
        for (const reading of coreReadings) {
            const duration = calculateResourceDuration(reading);
            if (remainingTime >= duration) {
                day.tasks.push(resourceToTask(reading, day.tasks.length, true));
                scheduledResourceIds.add(reading.id);
                remainingTime -= duration;
            }
        }
    }

    // Pass 4: Finalization
    schedule.forEach(day => {
      day.tasks.sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99) || a.order - b.order);
      day.tasks.forEach((task, index) => task.order = index);
    });

    const unscheduledPrimary = availableResources.filter(r => r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
    if (unscheduledPrimary.length > 0) {
        notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} high-priority items could not be scheduled. Extend dates or increase study time.` });
    }
    
    const firstPassEndDate = schedule.slice().reverse().find(day => day.tasks.some(t => t.isPrimaryMaterial))?.date || endDate;

    const plan: StudyPlan = {
        schedule, progressPerDomain: {}, startDate, endDate, firstPassEndDate,
        topicOrder, cramTopicOrder: topicOrder, deadlines,
        isCramModeActive: false, areSpecialTopicsInterleaved: true,
    };
    
    Object.values(Domain).forEach(domain => {
        const totalMinutes = masterResourcePool.filter(r => r.domain === domain && !r.isArchived && r.isPrimaryMaterial).reduce((sum, r) => sum + calculateResourceDuration(r), 0);
        plan.progressPerDomain[domain] = { completedMinutes: 0, totalMinutes };
    });

    notifications.push({ type: 'info', message: 'A new study plan has been generated.' });
    
    return { plan, notifications };
};

export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionDates: ExceptionDateRule[],
  masterResourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    const today = getTodayInNewYork();
    // FIX: Refactored ternary to a more explicit if/else block to ensure TypeScript correctly narrows the discriminated union `RebalanceOptions` type.
    let rebalanceStartDate: string;
    if (options.type === 'topic-time') {
      rebalanceStartDate = options.date;
    } else {
      rebalanceStartDate = today;
    }

    const preservedSchedule: DailySchedule[] = JSON.parse(JSON.stringify(currentPlan.schedule));
    const completedResourceIds = new Set<string>();
    
    preservedSchedule.forEach(day => {
        if (day.date < rebalanceStartDate) {
            day.tasks.forEach(task => {
                if (task.status === 'completed') {
                    completedResourceIds.add(task.originalResourceId || task.resourceId);
                }
            });
        } else {
            if (day.isManuallyModified && options.type === 'standard') {
                day.tasks.forEach(task => {
                    const id = task.originalResourceId || task.resourceId;
                    if(id) completedResourceIds.add(id);
                });
            } else {
                day.tasks = [];
                if (options.type !== 'topic-time' || day.date !== options.date) {
                    day.isManuallyModified = false;
                }
            }
        }
    });

    if (options.type === 'topic-time') {
      const dayToModify = preservedSchedule.find(d => d.date === options.date);
      if (dayToModify) {
        dayToModify.totalStudyTimeMinutes = options.totalTimeMinutes;
        dayToModify.isRestDay = options.totalTimeMinutes === 0;
        dayToModify.isManuallyModified = true;
        dayToModify.tasks = [];
        
        let remainingTime = options.totalTimeMinutes;
        let taskOrder = 0;
        
        options.topics.forEach(topic => {
            const resourcesForTopic = masterResourcePool
                .filter(r => r.domain === topic && !completedResourceIds.has(r.id) && !r.isArchived)
                .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));

            for(const res of resourcesForTopic) {
                const duration = calculateResourceDuration(res);
                if(remainingTime >= duration) {
                    dayToModify.tasks.push(resourceToTask(res, taskOrder++));
                    completedResourceIds.add(res.id);
                    remainingTime -= duration;
                }
            }
        });
      }
    }
    
    const availableForReschedule = masterResourcePool.filter(r => !completedResourceIds.has(r.id) && !r.isArchived);
    
    const generationStartDateStr = rebalanceStartDate;
    
    const futureScheduleOutcome = generateInitialSchedule(availableForReschedule, exceptionDates, currentPlan.topicOrder, currentPlan.deadlines, generationStartDateStr, currentPlan.endDate);
    
    const futureScheduleMap = new Map(futureScheduleOutcome.plan.schedule.map(d => [d.date, d]));
    
    const finalSchedule = preservedSchedule.map(day => {
        if (day.date < generationStartDateStr || (day.isManuallyModified && (options.type !== 'topic-time' || day.date !== options.date))) {
            return day;
        }
        return futureScheduleMap.get(day.date) || day;
    });

    const finalPlan = { ...currentPlan, schedule: finalSchedule };
    
    Object.values(Domain).forEach(domain => {
        if (finalPlan.progressPerDomain[domain]) {
            const completedMinutes = finalSchedule
                .flatMap(d => d.tasks)
                .filter(t => t.originalTopic === domain && t.status === 'completed')
                .reduce((sum, t) => sum + t.durationMinutes, 0);
            
            const totalMinutes = masterResourcePool.filter(r => r.domain === domain && !r.isArchived && r.isPrimaryMaterial).reduce((sum, r) => sum + calculateResourceDuration(r), 0);

            finalPlan.progressPerDomain[domain]!.completedMinutes = completedMinutes;
            finalPlan.progressPerDomain[domain]!.totalMinutes = totalMinutes;
        }
    });
    
    return { plan: finalPlan, notifications: [{ type: 'info', message: 'Schedule has been rebalanced.' }] };
};
