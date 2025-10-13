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
    
    let currentTopicIndex = 0;
    const coveredDomains = new Set<Domain>();

    // --- PASS 1: Primary Content & Daily Requirements ---
    for (const day of schedule) {
        if (day.isRestDay) {
            // Add any topics from tasks on rest days (if manually added before) to coveredDomains
            day.tasks.forEach(task => coveredDomains.add(task.originalTopic));
            continue;
        }

        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
        let taskOrder = day.tasks.length;

        const scheduleResourceSet = (mainResourceId: string, isOptional = false): boolean => {
            const mainResource = resourceMap.get(mainResourceId);
            if (!mainResource || scheduledResourceIds.has(mainResourceId)) return false;

            const resourceSet = [mainResource];
            (mainResource.pairedResourceIds || []).forEach(id => {
                const paired = resourceMap.get(id);
                if (paired && !scheduledResourceIds.has(id) && paired.isPrimaryMaterial) {
                    resourceSet.push(paired);
                }
            });

            const totalDuration = resourceSet.reduce((sum, r) => sum + calculateResourceDuration(r), 0);

            if (remainingTime >= totalDuration) {
                const depsMet = resourceSet.every(res => (res.dependencies || []).every(depId => scheduledResourceIds.has(depId)));
                if (!depsMet) return false;

                resourceSet
                    .sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99))
                    .forEach(res => {
                        day.tasks.push(resourceToTask(res, taskOrder++, isOptional || !res.isPrimaryMaterial));
                        scheduledResourceIds.add(res.id);
                        coveredDomains.add(res.domain);
                    });
                remainingTime -= totalDuration;
                return true;
            }
            return false;
        };
        
        // Schedule Daily Physics
        const nextHudaPhysics = availableResources.find(r => r.videoSource === 'Huda' && !scheduledResourceIds.has(r.id));
        if (nextHudaPhysics) {
            scheduleResourceSet(nextHudaPhysics.id);
        } else {
            const nextTitanPhysics = availableResources.find(r => r.domain === Domain.PHYSICS && r.videoSource === 'Titan Radiology' && !scheduledResourceIds.has(r.id));
            if (nextTitanPhysics) scheduleResourceSet(nextTitanPhysics.id);
        }

        // Schedule Daily Nucs
        const nextNucs = availableResources.find(r => r.domain === Domain.NUCLEAR_MEDICINE && r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
        if(nextNucs) scheduleResourceSet(nextNucs.id);
        
        // Schedule Daily NIS/RISC
        const nextNis = availableResources.find(r => r.domain === Domain.NIS && r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
        if(nextNis) scheduleResourceSet(nextNis.id);
        
        const nextRisc = availableResources.find(r => r.domain === Domain.RISC && r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
        if(nextRisc) scheduleResourceSet(nextRisc.id);

        // Schedule Primary Topic of the day
        let topicScheduled = false;
        let attempts = 0;
        while (!topicScheduled && attempts < topicOrder.length && remainingTime > 30) {
            const topic = topicOrder[currentTopicIndex % topicOrder.length];
            const nextResource = availableResources.find(r => r.domain === topic && r.isPrimaryMaterial && r.type === ResourceType.VIDEO_LECTURE && !scheduledResourceIds.has(r.id));
            if (nextResource && scheduleResourceSet(nextResource.id)) {
                topicScheduled = true;
            } else {
                currentTopicIndex++;
            }
            attempts++;
        }
        if (topicScheduled) currentTopicIndex++; // Move to next topic for the next day
        
        // Schedule Board Vitals (Mixed review on covered topics)
        const coveredArray = Array.from(coveredDomains);
        const nextBoardVitals = availableResources.find(r => r.bookSource === 'Board Vitals' && !scheduledResourceIds.has(r.id) && coveredArray.includes(r.domain));
        if(nextBoardVitals) scheduleResourceSet(nextBoardVitals.id);
    }

    // Pass 2: Supplementary Lectures (Discord)
    for (const day of schedule) {
        if (day.isRestDay) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (remainingTime <= 15) continue;
        
        const topicsToday = new Set(day.tasks.map(t => t.originalTopic));
        const discordLectures = availableResources
            .filter(r => r.videoSource === 'Discord' && !scheduledResourceIds.has(r.id) && topicsToday.has(r.domain))
            .sort((a,b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999));

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
        if (remainingTime <= 15) continue;

        const coreReadings = availableResources
            .filter(r => r.bookSource === 'Core Radiology' && !scheduledResourceIds.has(r.id) && allCoveredTopicsCumulative.has(r.domain))
            .sort((a,b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999));
            
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
        day.tasks.sort((a,b) => a.order - b.order);
        day.tasks.forEach((task, index) => task.order = index);
    });

    const unscheduledPrimary = availableResources.filter(r => r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
    if (unscheduledPrimary.length > 0) {
        notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} primary resources could not be scheduled. Consider extending dates or increasing study time.` });
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
    
    let rebalanceStartDate: string;
    if (options.type === 'topic-time') {
      rebalanceStartDate = options.date;
    } else {
      rebalanceStartDate = today > currentPlan.startDate ? today : currentPlan.startDate;
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
        dayToModify.tasks = []; // Clear existing tasks for this specific day
        
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
    
    const generationOutcome = generateInitialSchedule(availableForReschedule, exceptionDates, currentPlan.topicOrder, currentPlan.deadlines, rebalanceStartDate, currentPlan.endDate);
    
    const futureScheduleMap = new Map(generationOutcome.plan.schedule.map(d => [d.date, d]));
    
    const finalSchedule = preservedSchedule.map(day => {
        // Keep past days or manually modified days that are not the target of a topic-time rebalance
        if (day.date < rebalanceStartDate || (day.isManuallyModified && (options.type !== 'topic-time' || day.date !== options.date))) {
            return day;
        }
        // If it's the day we just modified with topic-time, keep it
        if (options.type === 'topic-time' && day.date === options.date) {
            return day;
        }
        // Otherwise, take the newly generated future day
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
