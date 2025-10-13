import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, GeneratedStudyPlanOutcome, DeadlineSettings, Domain, ScheduledTask, ResourceType, DailySchedule } from '../types';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { TASK_TYPE_PRIORITY } from '../constants';

const resourceToTask = (resource: StudyResource, order: number, isOptionalOverride = false): ScheduledTask => ({
    id: `${resource.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    resourceId: resource.id,
    originalResourceId: resource.id,
    title: resource.title,
    type: resource.type,
    originalTopic: resource.domain,
    durationMinutes: resource.durationMinutes,
    status: 'pending',
    order,
    isOptional: isOptionalOverride || !resource.isPrimaryMaterial,
    isPrimaryMaterial: resource.isPrimaryMaterial,
    pages: resource.pages,
    startPage: resource.startPage,
    endPage: resource.endPage,
    questionCount: resource.questionCount,
    bookSource: resource.bookSource,
    videoSource: resource.videoSource,
    chapterNumber: resource.chapterNumber,
});

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

    // Prepare resource queues
    const primaryVideos = availableResources.filter(r => r.type === ResourceType.VIDEO_LECTURE && r.priorityTier === 1 && r.isPrimaryMaterial);
    const topicVideoQueues: Record<string, string[]> = {};
    topicOrder.forEach(domain => {
        topicVideoQueues[domain] = primaryVideos
            .filter(r => r.domain === domain)
            .sort((a,b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999))
            .map(r => r.id);
    });

    const dailyReqs = {
        [Domain.NIS]: availableResources.filter(r => r.domain === Domain.NIS && r.isPrimaryMaterial).sort((a,b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999)).map(r => r.id),
        [Domain.RISC]: availableResources.filter(r => r.domain === Domain.RISC && r.isPrimaryMaterial).sort((a,b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999)).map(r => r.id),
        // Huda route first
        physics: availableResources.filter(r => r.videoSource === 'Huda' && r.isPrimaryMaterial).sort((a,b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999)).map(r => r.id),
        nucs: primaryVideos.filter(r => r.domain === Domain.NUCLEAR_MEDICINE).sort((a,b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999)).map(r => r.id),
    };
    // Fallback to Titan/War Machine for physics
    if (dailyReqs.physics.length === 0) {
        dailyReqs.physics = primaryVideos.filter(r => r.domain === Domain.PHYSICS).sort((a,b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999)).map(r => r.id);
    }
    
    let currentTopicIndex = 0;
    
    // --- MULTI-PASS SCHEDULING ---

    for (const day of schedule) {
        if (day.isRestDay || day.isManuallyModified) continue;

        let remainingTime = day.totalStudyTimeMinutes;
        let taskOrder = 0;
        const todaysTasks: ScheduledTask[] = [];
        
        const schedulePairedSet = (mainResId: string, isOptional=false) => {
            const mainRes = resourceMap.get(mainResId);
            if (!mainRes || scheduledResourceIds.has(mainResId)) return false;

            const allInSet = [mainRes];
            (mainRes.pairedResourceIds || []).forEach(id => {
                const paired = resourceMap.get(id);
                if (paired && !scheduledResourceIds.has(id)) {
                    allInSet.push(paired);
                }
            });
            const totalDuration = allInSet.reduce((sum, r) => sum + r.durationMinutes, 0);

            if (remainingTime >= totalDuration) {
                const depsMet = allInSet.every(res => (res.dependencies || []).every(dep => scheduledResourceIds.has(dep)));
                if (!depsMet) return false;

                allInSet
                    .sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99))
                    .forEach(res => {
                        todaysTasks.push(resourceToTask(res, taskOrder++, isOptional || !res.isPrimaryMaterial));
                        scheduledResourceIds.add(res.id);
                    });
                remainingTime -= totalDuration;
                return true;
            }
            return false;
        };

        // PASS 1: Daily Requirements
        [Domain.NIS, Domain.RISC].forEach(domain => {
            const queue = dailyReqs[domain as keyof typeof dailyReqs] as string[];
            if(queue.length > 0) schedulePairedSet(queue.shift()!);
        });

        if(dailyReqs.physics.length > 0) schedulePairedSet(dailyReqs.physics.shift()!);
        if(dailyReqs.nucs.length > 0) schedulePairedSet(dailyReqs.nucs.shift()!);


        // PASS 1: Primary Content
        let scheduledPrimaryContent = false;
        let attempts = 0;
        while (!scheduledPrimaryContent && remainingTime > 60 && attempts < topicOrder.length) {
            const primaryTopic = topicOrder[currentTopicIndex % topicOrder.length];
            const videoQueue = topicVideoQueues[primaryTopic];
            
            if (videoQueue && videoQueue.length > 0) {
                const mainVideoId = videoQueue[0];
                if (schedulePairedSet(mainVideoId)) {
                    videoQueue.shift();
                    scheduledPrimaryContent = true;
                }
            }
            
            if (!scheduledPrimaryContent) {
                 currentTopicIndex++;
                 attempts++;
            }
        }
        if(scheduledPrimaryContent) currentTopicIndex++;

        // PASS 1: Fill with Question Banks
        const topicsToday = new Set(todaysTasks.map(t => t.originalTopic));
        const allCoveredTopics = new Set(scheduledResourceIds);
        availableResources.forEach(res => { if(res.dependencies?.every(d => allCoveredTopics.has(d))) allCoveredTopics.add(res.id) });

        const focusedQbanks = availableResources.filter(r => (r.type === ResourceType.QUESTIONS || r.type === ResourceType.REVIEW_QUESTIONS) && topicsToday.has(r.domain) && !scheduledResourceIds.has(r.id));
        for(const qb of focusedQbanks) {
            schedulePairedSet(qb.id);
        }

        const randomQBank = availableResources.find(r => r.domain === Domain.MIXED_REVIEW && (r.type === ResourceType.QUESTIONS) && !scheduledResourceIds.has(r.id));
        if(randomQBank) schedulePairedSet(randomQBank.id);

        day.tasks = todaysTasks;
    }
    
    // PASS 2 & 3: Supplementary & Optional
    const allCoveredTopicsSoFar = new Set<Domain>();
    for (const day of schedule) {
        day.tasks.map(t => t.originalTopic).forEach(topic => allCoveredTopicsSoFar.add(topic));
        if (day.isRestDay || day.isManuallyModified) continue;

        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        let taskOrder = day.tasks.length;
        const topicsToday = new Set(day.tasks.map(t => t.originalTopic));

        // PASS 2: Rad Discord Lectures
        const discordLectures = availableResources.filter(r => r.priorityTier === 2 && !scheduledResourceIds.has(r.id) && topicsToday.has(r.domain));
        for (const lecture of discordLectures) {
            if (remainingTime >= lecture.durationMinutes) {
                day.tasks.push(resourceToTask(lecture, taskOrder++, true));
                scheduledResourceIds.add(lecture.id);
                remainingTime -= lecture.durationMinutes;
            }
        }

        // PASS 3: Core Radiology Textbook
        const coreReadings = availableResources.filter(r => r.priorityTier === 3 && !scheduledResourceIds.has(r.id) && (topicsToday.has(r.domain) || allCoveredTopicsSoFar.has(r.domain)));
        for (const reading of coreReadings) {
             if (remainingTime >= reading.durationMinutes) {
                day.tasks.push(resourceToTask(reading, taskOrder++, true));
                scheduledResourceIds.add(reading.id);
                remainingTime -= reading.durationMinutes;
            }
        }
    }
    
    // PASS 4+: Validation
    schedule.forEach(day => { day.tasks.sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99) || a.order - b.order); });
    
    const unscheduledPrimary = availableResources.filter(r => r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
    if (unscheduledPrimary.length > 0) {
        notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} high-priority items could not be scheduled. Consider extending dates or increasing study time.` });
    }

    const firstPassEndDate = schedule.slice().reverse().find(day => day.tasks.some(t => t.isPrimaryMaterial))?.date || endDate;
    const plan: StudyPlan = {
        schedule, progressPerDomain: {}, startDate, endDate, firstPassEndDate,
        topicOrder, cramTopicOrder: topicOrder, deadlines,
        isCramModeActive: false, areSpecialTopicsInterleaved: true,
    };
    
    // Calculate initial progress
    Object.values(Domain).forEach(domain => {
        const totalMinutes = masterResourcePool.filter(r => r.domain === domain && !r.isArchived && r.isPrimaryMaterial).reduce((sum, r) => sum + r.durationMinutes, 0);
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
    const rebalanceStartDate = options.type === 'topic-time' ? options.date : today;

    const preservedSchedule: DailySchedule[] = JSON.parse(JSON.stringify(currentPlan.schedule));
    const completedResourceIds = new Set<string>();

    preservedSchedule.forEach(day => {
        if (day.date < rebalanceStartDate) {
            day.tasks.forEach(task => {
                if (task.status === 'completed' && task.originalResourceId) {
                    completedResourceIds.add(task.originalResourceId);
                } else if (task.status === 'completed' && task.resourceId) { // For older tasks without originalResourceId
                    completedResourceIds.add(task.resourceId);
                }
            });
        } else {
            // Clear future tasks but respect manual modifications unless it's a standard rebalance
            if (day.isManuallyModified && options.type === 'standard') {
                // Keep manually modified days in a standard rebalance
                day.tasks.forEach(task => {
                    const id = task.originalResourceId || task.resourceId;
                    if(id) completedResourceIds.add(id);
                });
            } else {
                day.tasks = [];
                day.isManuallyModified = false;
            }
        }
    });

    // Handle topic-time modification specifically
    if (options.type === 'topic-time') {
      const dayToModify = preservedSchedule.find(d => d.date === options.date);
      if (dayToModify) {
        dayToModify.totalStudyTimeMinutes = options.totalTimeMinutes;
        dayToModify.isRestDay = options.totalTimeMinutes === 0;
        dayToModify.isManuallyModified = true; // Mark as modified
        dayToModify.tasks = []; // Clear existing tasks for this day
        
        let remainingTime = options.totalTimeMinutes;
        let taskOrder = 0;
        
        options.topics.forEach(topic => {
            const resourcesForTopic = masterResourcePool.filter(r => r.domain === topic && !completedResourceIds.has(r.id) && !r.isArchived);
            for(const res of resourcesForTopic) {
                if(remainingTime >= res.durationMinutes) {
                    dayToModify.tasks.push(resourceToTask(res, taskOrder++));
                    completedResourceIds.add(res.id);
                    remainingTime -= res.durationMinutes;
                }
            }
        });
      }
    }
    
    const availableForReschedule = masterResourcePool.filter(r => !completedResourceIds.has(r.id) && !r.isArchived);
    
    // Determine the start date for the new generation part.
    const generationStartDateStr = rebalanceStartDate;
    
    const futureScheduleOutcome = generateInitialSchedule(availableForReschedule, exceptionDates, currentPlan.topicOrder, currentPlan.deadlines, generationStartDateStr, currentPlan.endDate);
    
    const futureScheduleMap = new Map(futureScheduleOutcome.plan.schedule.map(d => [d.date, d]));
    
    const finalSchedule = preservedSchedule.map(day => {
        if (day.date < generationStartDateStr || day.isManuallyModified) {
            return day;
        }
        return futureScheduleMap.get(day.date) || day; // Use generated day if it exists
    });

    const finalPlan = { ...currentPlan, schedule: finalSchedule };
    
    // Recalculate progress for the entire plan
    Object.values(Domain).forEach(domain => {
        if (finalPlan.progressPerDomain[domain]) {
            const completedMinutes = finalSchedule
                .flatMap(d => d.tasks)
                .filter(t => t.originalTopic === domain && t.status === 'completed')
                .reduce((sum, t) => sum + t.durationMinutes, 0);
            finalPlan.progressPerDomain[domain]!.completedMinutes = completedMinutes;
        }
    });
    
    return { plan: finalPlan, notifications: [{ type: 'info', message: 'Schedule has been rebalanced.' }] };
};
