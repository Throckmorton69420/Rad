import { StudyPlan, DailySchedule, ScheduledTask, StudyResource, Domain, RebalanceOptions, GeneratedStudyPlanOutcome, ResourceType, ExceptionDateRule, DeadlineSettings } from '../types';
import { 
    STUDY_START_DATE, 
    STUDY_END_DATE, 
    DEFAULT_CONSTRAINTS,
    MIN_DURATION_for_SPLIT_PART,
    DEFAULT_TOPIC_ORDER,
} from '../constants';
import { getTodayInNewYork, formatDuration, parseDateString } from '../utils/timeFormatter';

const getDayName = (dateStr: string): string => {
  const date = parseDateString(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

const mapResourceToTask = (resource: StudyResource, order: number, status: 'pending' | 'completed' = 'pending'): ScheduledTask => {
    return {
        id: resource.id,
        resourceId: resource.id,
        title: resource.title,
        type: resource.type,
        originalTopic: resource.domain,
        durationMinutes: resource.durationMinutes,
        status: status,
        order: order,
        pages: resource.pages,
        questionCount: resource.questionCount,
        chapterNumber: resource.chapterNumber,
        startPage: resource.startPage,
        endPage: resource.endPage,
        originalResourceId: resource.originalResourceId || resource.id,
        partNumber: undefined, // Part numbers are no longer used for cleaner dynamic splitting
        totalParts: undefined,
        isSplitPart: !!resource.isSplitSource,
        isPrimaryMaterial: resource.isPrimaryMaterial,
        bookSource: resource.bookSource,
        videoSource: resource.videoSource,
        isOptional: resource.isOptional,
        schedulingPriority: resource.schedulingPriority,
    };
};

const splitTask = (task: StudyResource, timeToFill: number): { part1: StudyResource, part2: StudyResource } | null => {
    if (!task.isSplittable || task.durationMinutes <= timeToFill || timeToFill < MIN_DURATION_for_SPLIT_PART) {
        return null;
    }

    const ratio = timeToFill / task.durationMinutes;
    const originalId = task.originalResourceId || task.id;

    // The part that fits now
    const part1: StudyResource = {
        ...task,
        id: `${originalId}_part_${Date.now()}`, // Unique ID for this scheduled chunk
        durationMinutes: timeToFill,
        pages: task.pages ? Math.ceil(task.pages * ratio) : undefined,
        questionCount: task.questionCount ? Math.ceil(task.questionCount * ratio) : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
        partNumber: undefined,
        totalParts: undefined,
    };
    
    // The remainder
    const part2: StudyResource = {
        ...task,
        id: task.id, // Keep original ID for the remainder that goes back into the pool
        durationMinutes: task.durationMinutes - timeToFill,
        pages: task.pages ? task.pages - (part1.pages || 0) : undefined,
        questionCount: task.questionCount ? task.questionCount - (part1.questionCount || 0) : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
        partNumber: undefined,
        totalParts: undefined,
    };

    return { part1, part2 };
}


const sortResources = (pool: StudyResource[]): StudyResource[] => {
    return pool.sort((a, b) => {
        if ((a.sequenceOrder ?? Infinity) !== (b.sequenceOrder ?? Infinity)) {
            return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
        }
        if ((a.chapterNumber ?? Infinity) !== (b.chapterNumber ?? Infinity)) {
            return (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity);
        }
        return a.title.localeCompare(b.title);
    });
};

const runSchedulingEngine = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    config: Partial<StudyPlan>,
): GeneratedStudyPlanOutcome['notifications'] => {
    
    const { deadlines, topicOrder = [], isCramModeActive, cramTopicOrder = [] } = config;
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];

    // --- 1. BUDGET ADJUSTMENT PASS based on deadlines ---
    const allHighPriorityResources = resourcePool.filter(r => r.schedulingPriority === 'high');
    const todayStr = getTodayInNewYork();

    if (deadlines?.allContent) {
        const totalMinutes = allHighPriorityResources.reduce((sum, r) => sum + r.durationMinutes, 0);
        const availableDays = scheduleShell.filter(d => d.date >= todayStr && d.date <= deadlines!.allContent! && !d.isRestDay);
        
        if (availableDays.length > 0) {
            const currentBudget = availableDays.reduce((sum, d) => sum + d.totalStudyTimeMinutes, 0);
            const deficit = totalMinutes - currentBudget;

            if (deficit > 0) {
                const extraMinutesPerDay = Math.ceil(deficit / availableDays.length);
                notifications.push({ type: 'warning', message: `To meet your deadline, daily study time was increased by ~${Math.round(extraMinutesPerDay)} minutes.` });
                availableDays.forEach(day => {
                    if (day.dayType !== 'final-review') {
                        const newTime = day.totalStudyTimeMinutes + extraMinutesPerDay;
                        day.totalStudyTimeMinutes = Math.min(newTime, 14 * 60);
                    }
                });
            }
        }
    }

    const getSortedPool = (pool: StudyResource[]) => {
        return sortResources(pool).sort((a, b) => {
            const order = isCramModeActive ? cramTopicOrder : topicOrder;
            const topicIndexA = order.indexOf(a.domain);
            const topicIndexB = order.indexOf(b.domain);
            if (topicIndexA !== topicIndexB) return (topicIndexA === -1 ? Infinity : topicIndexA) - (topicIndexB === -1 ? Infinity : topicIndexB);
            return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
        });
    };
    
    const schedulableHigh = getSortedPool(resourcePool.filter(r => r.schedulingPriority === 'high' && r.domain !== Domain.FINAL_REVIEW));
    const sortedMedium = getSortedPool(resourcePool.filter(r => r.schedulingPriority === 'medium'));
    const sortedLow = getSortedPool(resourcePool.filter(r => r.schedulingPriority === 'low'));
    const finalReviewTasks = getSortedPool(resourcePool.filter(r => r.domain === Domain.FINAL_REVIEW));

    const schedulePool = (pool: StudyResource[]) => {
        for (const day of scheduleShell) {
            if (day.isRestDay || day.dayType === 'final-review') continue;

            const scheduledTime = day.tasks.filter(t => !t.isOptional).reduce((sum, t) => sum + t.durationMinutes, 0);
            let remainingTime = day.totalStudyTimeMinutes - scheduledTime;

            while (remainingTime >= MIN_DURATION_for_SPLIT_PART && pool.length > 0) {
                // Find the first task that can fit completely
                const fitIndex = pool.findIndex(task => task.durationMinutes <= remainingTime);
                
                if (fitIndex !== -1) {
                    const taskToSchedule = pool.splice(fitIndex, 1)[0];
                    day.tasks.push(mapResourceToTask(taskToSchedule, day.tasks.length));
                    remainingTime -= taskToSchedule.durationMinutes;
                    continue; // Continue filling the day
                }

                // If no task fits completely, find the first splittable task to fill the remaining time
                const splittableIndex = pool.findIndex(task => task.isSplittable);
                
                if (splittableIndex !== -1) {
                    const taskToSplit = pool[splittableIndex];
                    const split = splitTask(taskToSplit, remainingTime);
                    if (split) {
                        day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                        // Replace original with the remainder part for future scheduling
                        pool[splittableIndex] = split.part2;
                    }
                }
                
                // Whether we split a task or not, the day is now as full as it can be.
                break;
            }
        }
    };
    
    // --- 2. TASK SCHEDULING PASSES (MULTI-TIER) ---
    schedulePool(schedulableHigh);
    schedulePool(sortedMedium);
    schedulePool(sortedLow);


    // --- 3. NOTIFICATIONS ---
    if (schedulableHigh.length > 0) {
        const remainingTime = schedulableHigh.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'error',
            message: `Could not fit all primary content. ${schedulableHigh.length} tasks (~${formatDuration(remainingTime)}) remain. Extend your end date or increase daily study time.`
        });
    }
    
    if (sortedMedium.length > 0) {
        const remainingTime = sortedMedium.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'warning',
            message: `Could not fit all essential question banks. ${sortedMedium.length} sets (~${formatDuration(remainingTime)}) remain unscheduled.`
        });
    }

    if (sortedLow.length > 0) {
        const remainingTime = sortedLow.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'info',
            message: `${sortedLow.length} supplementary question sets (~${formatDuration(remainingTime)}) remain unscheduled. They will be scheduled if time opens up.`
        });
    }

    // --- 4. FINAL REVIEW and CLEANUP ---
    for (const day of scheduleShell) {
        if (day.dayType === 'final-review' && finalReviewTasks.length) {
            let remainingTime = day.totalStudyTimeMinutes;
            while(remainingTime > 0 && finalReviewTasks.length > 0) {
                const task = finalReviewTasks.shift()!;
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                remainingTime -= task.durationMinutes;
            }
        }
        day.totalStudyTimeMinutes = day.tasks
            .filter(t => !t.isOptional)
            .reduce((sum, t) => sum + t.durationMinutes, 0);
    }

    return notifications;
};

const createScheduleShell = (
    startDateStr: string,
    endDateStr: string,
    userAddedExceptions: ExceptionDateRule[]
): DailySchedule[] => {
    const finalExceptionMap = new Map(
        [...(DEFAULT_CONSTRAINTS.exceptionDates || []), ...userAddedExceptions].map(rule => [rule.date, rule])
    );
    
    const schedule: DailySchedule[] = [];
    const startDate = parseDateString(startDateStr);
    const endDate = parseDateString(endDateStr);

    if (startDate > endDate) {
        console.error("Schedule generation failed: Start date is after end date.", { startDate, endDate });
        return [];
    }
    
    let currentDateIter = new Date(startDate);
    
    while (currentDateIter <= endDate) {
        const dateStr = currentDateIter.toISOString().split('T')[0];
        const exceptionRule = finalExceptionMap.get(dateStr);
        
        let isRestDay = false;
        let dayType: DailySchedule['dayType'] = 'workday';
        let timeBudget = 14 * 60; // Max out at 14 hours per day

        if (exceptionRule) {
            isRestDay = !!exceptionRule.isRestDayOverride;
            dayType = exceptionRule.dayType;
            timeBudget = isRestDay ? 0 : (exceptionRule.targetMinutes ?? 14 * 60);
        }
        
        schedule.push({ date: dateStr, tasks: [], totalStudyTimeMinutes: timeBudget, isRestDay, dayType, dayName: getDayName(dateStr) });
        currentDateIter.setDate(currentDateIter.getDate() + 1);
    }
    
    return schedule;
};


export const generateInitialSchedule = (
    masterResourcePool: StudyResource[], 
    userAddedExceptions: ExceptionDateRule[],
    currentTopicOrder?: Domain[],
    deadlines?: DeadlineSettings,
): GeneratedStudyPlanOutcome => {
    console.log("[Scheduler Engine] Starting initial schedule generation.");
    const schedulingPool = JSON.parse(JSON.stringify(masterResourcePool.filter(r => !r.isArchived)));
    
    const planConfig = {
        topicOrder: currentTopicOrder || DEFAULT_TOPIC_ORDER,
        cramTopicOrder: currentTopicOrder || DEFAULT_TOPIC_ORDER,
        isCramModeActive: false,
        deadlines: deadlines || {},
        areSpecialTopicsInterleaved: true,
    };

    const schedule = createScheduleShell(STUDY_START_DATE, STUDY_END_DATE, userAddedExceptions);
    const notifications = runSchedulingEngine(schedule, schedulingPool, planConfig);

    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    activeResources.forEach(resource => {
        if (!progressPerDomain[resource.domain]) {
            progressPerDomain[resource.domain] = { completedMinutes: 0, totalMinutes: 0 };
        }
        progressPerDomain[resource.domain]!.totalMinutes += resource.durationMinutes;
    });

    const plan: StudyPlan = {
        startDate: STUDY_START_DATE,
        endDate: STUDY_END_DATE,
        schedule: schedule,
        progressPerDomain: progressPerDomain,
        topicOrder: planConfig.topicOrder,
        cramTopicOrder: planConfig.cramTopicOrder,
        isCramModeActive: planConfig.isCramModeActive,
        deadlines: planConfig.deadlines,
        areSpecialTopicsInterleaved: planConfig.areSpecialTopicsInterleaved,
    };

    let firstPassEndDate: string | undefined = undefined;
    for (let i = schedule.length - 1; i >= 0; i--) {
        const day = schedule[i];
        if (day.tasks.some(t => t.isPrimaryMaterial)) {
            firstPassEndDate = day.date;
            break;
        }
    }
    plan.firstPassEndDate = firstPassEndDate;

    return { plan, notifications };
};


export const rebalanceSchedule = (
    currentPlan: StudyPlan, 
    options: RebalanceOptions, 
    userAddedExceptions: ExceptionDateRule[],
    masterResourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    console.log("[Scheduler Engine] Rebalancing schedule from today onwards.");
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    const rebalanceStartDate = getTodayInNewYork();

    const pastScheduleShell = currentPlan.schedule
        .filter(day => day.date < rebalanceStartDate)
        .map(day => ({...day})); // Preserve past days as they are

    // Find all uncompleted resource IDs from the future part of the schedule
    const uncompletedFutureTaskResources = new Set<string>();
    currentPlan.schedule
        .filter(day => day.date >= rebalanceStartDate)
        .flatMap(day => day.tasks)
        .forEach(task => {
            if (task.status !== 'completed') {
                uncompletedFutureTaskResources.add(task.originalResourceId || task.resourceId);
            }
        });
    
    const schedulingPool = JSON.parse(JSON.stringify(
        activeResources.filter(r => uncompletedFutureTaskResources.has(r.id))
    ));
    
    const futureScheduleShell = createScheduleShell(rebalanceStartDate, currentPlan.endDate, userAddedExceptions);
    
    const notifications = runSchedulingEngine(futureScheduleShell, schedulingPool, currentPlan);
    
    const finalSchedule = [...pastScheduleShell, ...futureScheduleShell];
    
    const finalPlan: StudyPlan = { ...currentPlan, schedule: finalSchedule };
    
    // Recalculate progress for all domains based on the new final schedule
    const newProgressPerDomain = { ...finalPlan.progressPerDomain };
    Object.keys(newProgressPerDomain).forEach(domainKey => {
        const domain = domainKey as Domain;
        if (newProgressPerDomain[domain]) {
            newProgressPerDomain[domain]!.completedMinutes = finalSchedule.reduce((sum, day) => 
                sum + day.tasks.reduce((taskSum, task) => 
                    (task.originalTopic === domain && task.status === 'completed') ? taskSum + task.durationMinutes : taskSum, 0), 0);
        }
    });
    finalPlan.progressPerDomain = newProgressPerDomain;

    let firstPassEndDate: string | undefined = undefined;
    for (let i = finalSchedule.length - 1; i >= 0; i--) {
        const day = finalSchedule[i];
        if (day.tasks.some(t => t.isPrimaryMaterial)) {
            firstPassEndDate = day.date;
            break;
        }
    }
    finalPlan.firstPassEndDate = firstPassEndDate;

    return { plan: finalPlan, notifications };
};