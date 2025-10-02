import { StudyPlan, DailySchedule, ScheduledTask, StudyResource, Domain, RebalanceOptions, GeneratedStudyPlanOutcome, ResourceType, ExceptionDateRule, DeadlineSettings } from '../types';
import { 
    STUDY_START_DATE, 
    STUDY_END_DATE, 
    DEFAULT_CONSTRAINTS,
    MIN_DURATION_for_SPLIT_PART,
    DEFAULT_TOPIC_ORDER,
    DEFAULT_DAILY_STUDY_MINS,
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

const runSchedulingEngine = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    config: Partial<StudyPlan>,
): GeneratedStudyPlanOutcome['notifications'] => {
    
    const { topicOrder = [], isCramModeActive = false, cramTopicOrder = [] } = config;
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];

    const priorityMap = { high: 1, medium: 2, low: 3 };
    const tasksToSchedule = [...resourcePool].sort((a, b) => {
        const priorityA = priorityMap[a.schedulingPriority || 'low'];
        const priorityB = priorityMap[b.schedulingPriority || 'low'];
        if (priorityA !== priorityB) return priorityA - priorityB;

        const order = isCramModeActive ? cramTopicOrder : topicOrder;
        const topicIndexA = order.indexOf(a.domain);
        const topicIndexB = order.indexOf(b.domain);
        if (topicIndexA !== topicIndexB) return (topicIndexA === -1 ? Infinity : topicIndexA) - (topicIndexB === -1 ? Infinity : topicIndexB);
        
        if ((a.sequenceOrder ?? Infinity) !== (b.sequenceOrder ?? Infinity)) return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
        if ((a.chapterNumber ?? Infinity) !== (b.chapterNumber ?? Infinity)) return (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity);
        
        return a.title.localeCompare(b.title);
    });

    for (const day of scheduleShell) {
        if (day.isRestDay || day.dayType === 'final-review' || tasksToSchedule.length === 0) continue;

        let remainingTime = day.totalStudyTimeMinutes - day.tasks.filter(t => !t.isOptional).reduce((sum, t) => sum + t.durationMinutes, 0);

        while (remainingTime >= MIN_DURATION_for_SPLIT_PART && tasksToSchedule.length > 0) {
            let taskFittedOrSplit = false;
            
            // Try to fit a whole task first
            for (let i = 0; i < tasksToSchedule.length; i++) {
                const task = tasksToSchedule[i];
                if (task.durationMinutes <= remainingTime) {
                    day.tasks.push(mapResourceToTask(task, day.tasks.length));
                    remainingTime -= task.durationMinutes;
                    tasksToSchedule.splice(i, 1);
                    taskFittedOrSplit = true;
                    break; 
                }
            }
            if(taskFittedOrSplit) continue; // Restart loop for the day to find another task

            // If no whole task fits, try to split the first splittable one
            for (let i = 0; i < tasksToSchedule.length; i++) {
                const taskToSplit = tasksToSchedule[i];
                const splitResult = splitTask(taskToSplit, remainingTime);
                if (splitResult) {
                    day.tasks.push(mapResourceToTask(splitResult.part1, day.tasks.length));
                    remainingTime -= splitResult.part1.durationMinutes;
                    tasksToSchedule[i] = splitResult.part2;
                    taskFittedOrSplit = true;
                    break;
                }
            }

            // If nothing could be fit or split, the day is full.
            if (!taskFittedOrSplit) break;
        }
    }

    if (tasksToSchedule.length > 0) {
        const remainingTime = tasksToSchedule.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'error',
            message: `Could not fit all content. ${tasksToSchedule.length} tasks (~${formatDuration(remainingTime)}) remain. Please extend your end date or increase daily study time.`
        });
    }

    scheduleShell.forEach(day => day.tasks.sort((a,b) => a.order - b.order));

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
        let timeBudget: number;

        if (exceptionRule) {
            isRestDay = !!exceptionRule.isRestDayOverride;
            dayType = exceptionRule.dayType;
            timeBudget = isRestDay ? 0 : (exceptionRule.targetMinutes ?? DEFAULT_DAILY_STUDY_MINS);
        } else {
            isRestDay = false;
            dayType = 'workday';
            timeBudget = DEFAULT_DAILY_STUDY_MINS;
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
    console.log("[Scheduler Engine] Starting initial schedule generation (simplified engine).");
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
    console.log("[Scheduler Engine] Rebalancing schedule from today onwards (simplified engine).");
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    const rebalanceStartDate = getTodayInNewYork();

    const pastScheduleShell = currentPlan.schedule
        .filter(day => day.date < rebalanceStartDate)
        .map(day => ({...day})); 

    const completedOriginalResourceIds = new Set<string>();
    currentPlan.schedule.flatMap(day => day.tasks).forEach(task => {
        if (task.status === 'completed') {
            completedOriginalResourceIds.add(task.originalResourceId || task.resourceId);
        }
    });

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