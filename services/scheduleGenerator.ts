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
        partNumber: undefined,
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

    const part1: StudyResource = {
        ...task,
        id: `${originalId}_part_${Date.now()}`,
        durationMinutes: timeToFill,
        pages: task.pages ? Math.ceil(task.pages * ratio) : undefined,
        questionCount: task.questionCount ? Math.ceil(task.questionCount * ratio) : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
    };
    
    const part2: StudyResource = {
        ...task,
        id: task.id,
        durationMinutes: task.durationMinutes - timeToFill,
        pages: task.pages ? task.pages - (part1.pages || 0) : undefined,
        questionCount: task.questionCount ? task.questionCount - (part1.questionCount || 0) : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
    };

    return { part1, part2 };
}

const getSortedPoolByTopic = (pool: StudyResource[], topicOrder: Domain[], isCramModeActive: boolean, cramTopicOrder: Domain[]): StudyResource[] => {
    return pool.sort((a, b) => {
        const order = isCramModeActive ? cramTopicOrder : topicOrder;
        const topicIndexA = order.indexOf(a.domain);
        const topicIndexB = order.indexOf(b.domain);
        if (topicIndexA !== topicIndexB) return (topicIndexA === -1 ? Infinity : topicIndexA) - (topicIndexB === -1 ? Infinity : topicIndexB);
        if ((a.sequenceOrder ?? Infinity) !== (b.sequenceOrder ?? Infinity)) return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
        if ((a.chapterNumber ?? Infinity) !== (b.chapterNumber ?? Infinity)) return (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity);
        return a.title.localeCompare(b.title);
    });
};

const schedulePriorityLevel = (scheduleShell: DailySchedule[], resourcePool: StudyResource[]): StudyResource[] => {
    const sortedPool = [...resourcePool].sort((a, b) => b.durationMinutes - a.durationMinutes);
    const placedTaskIds = new Set<string>();

    // --- PASS 1: Fit whole tasks using First Fit Decreasing strategy ---
    for (const task of sortedPool) {
        for (const day of scheduleShell) {
            if (day.isRestDay || day.dayType === 'final-review') continue;

            const scheduledTime = day.tasks.filter(t => !t.isOptional).reduce((sum, t) => sum + t.durationMinutes, 0);
            const remainingTime = day.totalStudyTimeMinutes - scheduledTime;

            if (task.durationMinutes <= remainingTime) {
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                placedTaskIds.add(task.id);
                break; // Task placed, move to the next task
            }
        }
    }

    let unplacedTasks = sortedPool.filter(t => !placedTaskIds.has(t.id));

    // --- PASS 2: Split tasks to fill remaining gaps ---
    for (const day of scheduleShell) {
        if (day.isRestDay || day.dayType === 'final-review') continue;

        let scheduledTime = day.tasks.filter(t => !t.isOptional).reduce((sum, t) => sum + t.durationMinutes, 0);
        let remainingTime = day.totalStudyTimeMinutes - scheduledTime;

        if (remainingTime < MIN_DURATION_for_SPLIT_PART) continue;

        let taskToSplitIndex = -1;
        for (let i = 0; i < unplacedTasks.length; i++) {
            if (unplacedTasks[i].isSplittable && unplacedTasks[i].durationMinutes > remainingTime) {
                taskToSplitIndex = i;
                break;
            }
        }

        if (taskToSplitIndex !== -1) {
            const taskToSplit = unplacedTasks[taskToSplitIndex];
            const splitResult = splitTask(taskToSplit, remainingTime);
            if (splitResult) {
                day.tasks.push(mapResourceToTask(splitResult.part1, day.tasks.length));
                unplacedTasks[taskToSplitIndex] = splitResult.part2;
            }
        }
    }

    return unplacedTasks.filter(t => t.durationMinutes > 0);
};

const runSchedulingEngine = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    config: Partial<StudyPlan>,
): GeneratedStudyPlanOutcome['notifications'] => {
    
    const { deadlines, topicOrder = [], isCramModeActive = false, cramTopicOrder = [] } = config;
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

    const highPriorityPool = getSortedPoolByTopic(resourcePool.filter(r => r.schedulingPriority === 'high' && r.domain !== Domain.FINAL_REVIEW), topicOrder, isCramModeActive, cramTopicOrder);
    const mediumPriorityPool = getSortedPoolByTopic(resourcePool.filter(r => r.schedulingPriority === 'medium'), topicOrder, isCramModeActive, cramTopicOrder);
    const lowPriorityPool = getSortedPoolByTopic(resourcePool.filter(r => r.schedulingPriority === 'low'), topicOrder, isCramModeActive, cramTopicOrder);
    const finalReviewTasks = getSortedPoolByTopic(resourcePool.filter(r => r.domain === Domain.FINAL_REVIEW), topicOrder, isCramModeActive, cramTopicOrder);
    
    // --- 2. TASK SCHEDULING PASSES (MULTI-TIER) ---
    const unplacedHigh = schedulePriorityLevel(scheduleShell, highPriorityPool);
    const unplacedMedium = schedulePriorityLevel(scheduleShell, mediumPriorityPool);
    const unplacedLow = schedulePriorityLevel(scheduleShell, lowPriorityPool);

    // --- 3. NOTIFICATIONS ---
    if (unplacedHigh.length > 0) {
        const remainingTime = unplacedHigh.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'error',
            message: `Could not fit all primary content. ${unplacedHigh.length} tasks (~${formatDuration(remainingTime)}) remain. Extend your end date or increase daily study time.`
        });
    }
    
    if (unplacedMedium.length > 0) {
        const remainingTime = unplacedMedium.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'warning',
            message: `Could not fit all essential question banks. ${unplacedMedium.length} sets (~${formatDuration(remainingTime)}) remain unscheduled.`
        });
    }

    if (unplacedLow.length > 0) {
        const remainingTime = unplacedLow.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'info',
            message: `${unplacedLow.length} supplementary question sets (~${formatDuration(remainingTime)}) remain unscheduled. They will be scheduled if time opens up.`
        });
    }

    // --- 4. FINAL REVIEW and CLEANUP ---
    for (const day of scheduleShell) {
        if (day.dayType === 'final-review' && finalReviewTasks.length) {
            let remainingTime = day.totalStudyTimeMinutes;
            while(remainingTime > 0 && finalReviewTasks.length > 0) {
                const task = finalReviewTasks.shift()!;
                if (task.durationMinutes <= remainingTime) {
                    day.tasks.push(mapResourceToTask(task, day.tasks.length));
                    remainingTime -= task.durationMinutes;
                } else {
                    break;
                }
            }
        }
        // Recalculate the day's total time based on what was actually scheduled.
        day.totalStudyTimeMinutes = day.tasks
            .filter(t => !t.isOptional)
            .reduce((sum, t) => sum + t.durationMinutes, 0);
        // Sort tasks for display
        day.tasks.sort((a,b) => a.order - b.order);
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
        let timeBudget = 14 * 60;

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
        .map(day => ({...day})); 

    // **FIXED LOGIC**: Determine the pool of tasks to be rescheduled based on completion status, not future placement.
    // 1. Find all original resource IDs that have been completed anywhere in the plan.
    const completedOriginalResourceIds = new Set<string>();
    currentPlan.schedule.flatMap(day => day.tasks).forEach(task => {
        if (task.status === 'completed') {
            completedOriginalResourceIds.add(task.originalResourceId || task.resourceId);
        }
    });

    // 2. The new scheduling pool is all active resources that are NOT completed.
    const schedulingPool = JSON.parse(JSON.stringify(
        activeResources.filter(r => !completedOriginalResourceIds.has(r.id))
    ));
    
    const futureScheduleShell = createScheduleShell(rebalanceStartDate, currentPlan.endDate, userAddedExceptions);
    
    const notifications = runSchedulingEngine(futureScheduleShell, schedulingPool, currentPlan);
    
    const finalSchedule = [...pastScheduleShell, ...futureScheduleShell];
    
    const finalPlan: StudyPlan = { ...currentPlan, schedule: finalSchedule };
    
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