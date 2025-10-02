import { StudyPlan, DailySchedule, ScheduledTask, StudyResource, Domain, RebalanceOptions, GeneratedStudyPlanOutcome, StudyBlock, ResourceType, ExceptionDateRule, DeadlineSettings } from '../types';
import { 
    STUDY_START_DATE, 
    STUDY_END_DATE, 
    DEFAULT_CONSTRAINTS,
    MIN_DURATION_for_SPLIT_PART,
    DEFAULT_TOPIC_ORDER,
    WEEKDAY_QUESTION_BLOCK_OVERFLOW_MINUTES,
    WEEKEND_QUESTION_BLOCK_OVERFLOW_MINUTES,
    DEFAULT_DAILY_STUDY_MINS
} from '../constants';
import { getTodayInNewYork } from '../utils/timeFormatter';

const getDayName = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00'); 
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

const mapResourceToTask = (resource: StudyResource, order: number, status: 'pending' | 'completed' = 'pending'): ScheduledTask => {
    return {
        id: resource.isSplitSource ? `${resource.originalResourceId}_part${resource.partNumber}` : resource.id,
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
        partNumber: resource.partNumber,
        totalParts: resource.totalParts,
        isSplitPart: !!resource.isSplitSource,
        isPrimaryMaterial: resource.isPrimaryMaterial,
        bookSource: resource.bookSource,
        videoSource: resource.videoSource,
    };
};

const splitTask = (task: StudyResource, timeToFill: number): { part1: StudyResource, part2: StudyResource } | null => {
    if (!task.isSplittable || task.durationMinutes <= timeToFill || timeToFill < MIN_DURATION_for_SPLIT_PART) {
        return null;
    }

    const ratio = timeToFill / task.durationMinutes;

    const part1: StudyResource = {
        ...task,
        id: `${task.id}_p1`,
        durationMinutes: timeToFill,
        pages: task.pages ? Math.floor(task.pages * ratio) : undefined,
        questionCount: task.questionCount ? Math.floor(task.questionCount * ratio) : undefined,
        isSplitSource: true,
        partNumber: 1,
        totalParts: 2,
        originalResourceId: task.id,
    };

    const part2: StudyResource = {
        ...task,
        id: `${task.id}_p2`,
        durationMinutes: task.durationMinutes - timeToFill,
        pages: task.pages ? task.pages - (part1.pages || 0) : undefined,
        questionCount: task.questionCount ? task.questionCount - (part1.questionCount || 0) : undefined,
        isSplitSource: true,
        partNumber: 2,
        totalParts: 2,
        originalResourceId: task.id,
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

// FIX: Renamed 'planConfig' parameter to 'config' to resolve "Duplicate identifier" error.
const runSchedulingEngine = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    config: Partial<StudyPlan>,
    options?: RebalanceOptions
): GeneratedStudyPlanOutcome['notifications'] => {
    
    // FIX: Removed default empty object for deadlines to allow for proper type inference with optional chaining.
    const { deadlines, topicOrder = [], isCramModeActive, cramTopicOrder = [], areSpecialTopicsInterleaved = true } = config;
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];

    // --- 1. BUDGET ADJUSTMENT PASS based on deadlines ---
    const allSchedulableResources = resourcePool; // Include ALL resources for deadline calculation
    const todayStr = getTodayInNewYork();

    // FIX: Used optional chaining to safely access 'allContent' property, resolving potential type error.
    if (deadlines?.allContent) {
        const totalMinutes = allSchedulableResources.reduce((sum, r) => sum + r.durationMinutes, 0);
        // Available days now includes final review days for budget calculation
        // FIX: Used optional chaining to safely access 'allContent' and removed non-null assertion.
        const availableDays = scheduleShell.filter(d => d.date >= todayStr && d.date <= deadlines.allContent && !d.isRestDay);
        
        if (availableDays.length > 0) {
            const currentBudget = availableDays.reduce((sum, d) => sum + d.totalStudyTimeMinutes, 0);
            const deficit = totalMinutes - currentBudget;

            if (deficit > 0) {
                const extraMinutesPerDay = Math.ceil(deficit / availableDays.length);
                notifications.push({ type: 'warning', message: `To meet your deadline, daily study time was increased by ~${Math.round(extraMinutesPerDay)} minutes.` });
                availableDays.forEach(day => {
                    // Only add time to non-final review days to preserve their specific high-capacity budget
                    if (day.dayType !== 'final-review') {
                        day.totalStudyTimeMinutes += extraMinutesPerDay;
                    }
                });
            }
        }
    }

    // --- 2. TASK SCHEDULING PASS ---
    // A. Categorize resources
    let physicsTasks = areSpecialTopicsInterleaved ? sortResources(resourcePool.filter(r => r.domain === Domain.PHYSICS)) : [];
    let nucMedTasks = areSpecialTopicsInterleaved ? sortResources(resourcePool.filter(r => r.domain === Domain.NUCLEAR_MEDICINE)) : [];
    const finalReviewTasks = sortResources(resourcePool.filter(r => r.domain === Domain.FINAL_REVIEW));
    
    const mainTopicTasks = sortResources(resourcePool.filter(r => {
        const isSpecialTopic = r.domain === Domain.PHYSICS || r.domain === Domain.NUCLEAR_MEDICINE;
        return r.domain !== Domain.FINAL_REVIEW && (!areSpecialTopicsInterleaved || !isSpecialTopic);
    })).sort((a, b) => {
        const order = isCramModeActive ? cramTopicOrder : topicOrder;
        const topicIndexA = order.indexOf(a.domain);
        const topicIndexB = order.indexOf(b.domain);
        if (topicIndexA !== topicIndexB) return (topicIndexA === -1 ? Infinity : topicIndexA) - (topicIndexB === -1 ? Infinity : topicIndexB);
        return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
    });

    // B. Schedule day by day
    let workdayCounter = 0;
    const physicsFrequency = 2; // every 2 workdays
    const nucMedFrequency = 3;  // every 3 workdays
    const interleaveBlockSize = 60; // 60 minutes

    const scheduleTaskBlock = (day: DailySchedule, taskPool: StudyResource[], timeToFill: number) => {
        let scheduledTime = 0;
        while (timeToFill > 0 && taskPool.length > 0) {
            const taskToSchedule = taskPool[0];
            if (taskToSchedule.durationMinutes <= timeToFill) {
                day.tasks.push(mapResourceToTask(taskToSchedule, day.tasks.length));
                const scheduledDuration = taskToSchedule.durationMinutes;
                timeToFill -= scheduledDuration;
                scheduledTime += scheduledDuration;
                taskPool.shift();
            } else {
                if (!taskToSchedule.isSplittable || timeToFill < MIN_DURATION_for_SPLIT_PART) break;
                const split = splitTask(taskToSchedule, timeToFill);
                if (split) {
                    day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                    const scheduledDuration = split.part1.durationMinutes;
                    timeToFill -= scheduledDuration;
                    scheduledTime += scheduledDuration;
                    taskPool[0] = split.part2;
                } else break;
            }
        }
        return scheduledTime;
    };

    for (const day of scheduleShell) {
        if (day.isRestDay || day.dayType === 'final-review') continue;
        workdayCounter++;
        
        let availableTime = day.totalStudyTimeMinutes;

        // Conditional Interleaving
        if (areSpecialTopicsInterleaved) {
            if (workdayCounter % physicsFrequency === 0 && physicsTasks.length > 0) {
                const timeForBlock = Math.min(interleaveBlockSize, availableTime);
                if (timeForBlock > 0) availableTime -= scheduleTaskBlock(day, physicsTasks, timeForBlock);
            }

            if (workdayCounter % nucMedFrequency === 0 && nucMedTasks.length > 0) {
                const timeForBlock = Math.min(interleaveBlockSize, availableTime);
                if (timeForBlock > 0) availableTime -= scheduleTaskBlock(day, nucMedTasks, timeForBlock);
            }
        }

        // Fill remaining time with main topic tasks
        if(availableTime > 0) {
            availableTime -= scheduleTaskBlock(day, mainTopicTasks, availableTime);
        }
    }
    
    // --- 3. FINAL REVIEW and CLEANUP ---
    let finalReviewTaskIndex = 0;
    for (const day of scheduleShell) {
        if (day.dayType === 'final-review' && finalReviewTaskIndex < finalReviewTasks.length) {
            scheduleTaskBlock(day, finalReviewTasks, day.totalStudyTimeMinutes);
        }

        // Trim day's total time to match actual scheduled content
        day.totalStudyTimeMinutes = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
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
    const startDate = new Date(startDateStr + 'T00:00:00');
    const endDate = new Date(endDateStr + 'T00:00:00');
    let currentDateIter = new Date(startDate);
    
    while (currentDateIter <= endDate) {
        const dateStr = currentDateIter.toISOString().split('T')[0];
        const exceptionRule = finalExceptionMap.get(dateStr);
        
        let isRestDay = false;
        let dayType: DailySchedule['dayType'] = 'workday';
        let timeBudget = DEFAULT_DAILY_STUDY_MINS;

        if (exceptionRule) {
            isRestDay = !!exceptionRule.isRestDayOverride;
            dayType = exceptionRule.dayType;
            timeBudget = isRestDay ? 0 : (exceptionRule.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS);
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
        areSpecialTopicsInterleaved: true, // Default to true for new plans
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
    console.log("[Scheduler Engine] Performing a full rebalance of all tasks from today.");
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    const rebalanceStartDate = getTodayInNewYork();

    // Create a shell for past days, but clear all tasks as per user request for a full rebalance.
    const pastScheduleShell = currentPlan.schedule
        .filter(day => day.date < rebalanceStartDate)
        .map(day => ({
            ...day,
            tasks: [],
            totalStudyTimeMinutes: 0,
            isManuallyModified: false, // Reset manual modifications on past days as well
        }));
    
    // The entire active resource pool will be scheduled from today onwards.
    const schedulingPool = JSON.parse(JSON.stringify(activeResources));
    
    const futureScheduleShell = createScheduleShell(rebalanceStartDate, currentPlan.endDate, userAddedExceptions);
    
    const notifications = runSchedulingEngine(futureScheduleShell, schedulingPool, currentPlan, options);
    
    // Reset manual modification flags for future days
    futureScheduleShell.forEach(day => {
        day.isManuallyModified = false;
    });
    
    const finalSchedule = [...pastScheduleShell, ...futureScheduleShell];
    
    const finalPlan: StudyPlan = {
        ...currentPlan,
        schedule: finalSchedule,
        // Progress will be recalculated based on the new (empty) state of completed tasks.
        progressPerDomain: {} 
    };
    
    // Recalculate total minutes for progress tracking
    activeResources.forEach(resource => {
        const domain = resource.domain;
        if (!finalPlan.progressPerDomain[domain]) {
            finalPlan.progressPerDomain[domain] = { completedMinutes: 0, totalMinutes: 0 };
        }
        finalPlan.progressPerDomain[domain]!.totalMinutes += resource.durationMinutes;
    });

    // Since we are resetting everything, completed minutes will be 0 across all domains.
    Object.keys(finalPlan.progressPerDomain).forEach(domainKey => {
        const domain = domainKey as Domain;
        if (finalPlan.progressPerDomain[domain]) {
            finalPlan.progressPerDomain[domain]!.completedMinutes = 0;
        }
    });

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