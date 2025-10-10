import { StudyPlan, DailySchedule, ScheduledTask, StudyResource, Domain, RebalanceOptions, GeneratedStudyPlanOutcome, ResourceType, ExceptionDateRule, DeadlineSettings } from '../types';
import { 
    STUDY_START_DATE, 
    STUDY_END_DATE, 
    DEFAULT_CONSTRAINTS,
    MIN_DURATION_for_SPLIT_PART,
    DEFAULT_TOPIC_ORDER,
    DEFAULT_DAILY_STUDY_MINS,
    ALL_DOMAINS,
} from '../constants';
import { getTodayInNewYork, formatDuration, parseDateString } from '../utils/timeFormatter';

const HARD_CAP_MINUTES = 14 * 60; // 14 hours

const getDayName = (dateStr: string): string => {
  const date = parseDateString(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
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
        partNumber: resource.partNumber,
        totalParts: resource.totalParts,
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
    const currentPartNumber = task.partNumber || 1;
    const totalParts = task.totalParts || Math.ceil(task.durationMinutes / MIN_DURATION_for_SPLIT_PART);
    
    const part1Pages = task.pages ? Math.round(task.pages * ratio) : undefined;
    const part1Questions = task.questionCount ? Math.round(task.questionCount * ratio) : undefined;

    const part1: StudyResource = {
        ...task,
        id: `${originalId}_part_${Date.now()}`,
        durationMinutes: timeToFill,
        pages: part1Pages,
        questionCount: part1Questions,
        isSplitSource: true,
        originalResourceId: originalId,
        partNumber: currentPartNumber,
        totalParts: totalParts,
    };
    
    const part2: StudyResource = {
        ...task,
        id: task.id,
        durationMinutes: task.durationMinutes - timeToFill,
        pages: (task.pages && part1Pages) ? task.pages - part1Pages : undefined,
        questionCount: (task.questionCount && part1Questions) ? task.questionCount - part1Questions : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
        partNumber: currentPartNumber + 1,
        totalParts: totalParts,
    };
    
    if (task.startPage && task.pages && part1.pages && part1.pages > 0) {
        part1.endPage = task.startPage + part1.pages - 1;
        part2.startPage = part1.endPage + 1;
    }

    return { part1, part2 };
};


const sourcePriorityMap: Record<string, number> = {
    'Titan Radiology Videos': 1,
    'Crack the Core Volume 1': 2,
    'Crack the Core Volume 2': 2,
    'Crack the Core Case Companion': 3,
    'Core Radiology': 4,
    'Discord Review Sessions': 5,
    'RISC Study Guide': 6,
    'NIS Study Guide': 6,
    'QEVLAR': 10,
    'Board Vitals': 11,
    'Physics Qbank (Categorized)': 12,
    'NIS Question Bank': 13,
    'NucApp': 14,
};

const getSourcePriority = (r: StudyResource): number => {
    const source = r.bookSource || r.videoSource;
    if (!source) return 99; // Custom tasks last
    const priorityKey = Object.keys(sourcePriorityMap).find(key => source.includes(key));
    return priorityKey ? sourcePriorityMap[priorityKey] : 90;
};

const sortResources = (resources: StudyResource[], topicOrder: Domain[]): StudyResource[] => {
    return [...resources].sort((a, b) => {
        // 1. Optional status
        if (a.isOptional !== b.isOptional) return a.isOptional ? 1 : -1;

        // 2. Domain order
        const domainIndexA = topicOrder.indexOf(a.domain);
        const domainIndexB = topicOrder.indexOf(b.domain);
        if (domainIndexA !== domainIndexB) return (domainIndexA === -1 ? Infinity : domainIndexA) - (domainIndexB === -1 ? Infinity : domainIndexB);
        
        // 3. Source Priority
        const sourcePrioA = getSourcePriority(a);
        const sourcePrioB = getSourcePriority(b);
        if (sourcePrioA !== sourcePrioB) return sourcePrioA - sourcePrioB;

        // 4. Sequence Order (e.g., chapters, video series order)
        if ((a.sequenceOrder ?? Infinity) !== (b.sequenceOrder ?? Infinity)) return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
        
        // 5. Fallback title sort
        return a.title.localeCompare(b.title);
    });
};

const runSchedulingEngine = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    config: Partial<StudyPlan>,
): GeneratedStudyPlanOutcome['notifications'] => {
    
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    const { topicOrder = [] } = config;
    const activeResources = resourcePool.filter(r => !r.isArchived);

    // Max out study days by default
    scheduleShell.forEach(day => {
        if (day.dayType === 'workday' && !day.isRestDay) {
            day.totalStudyTimeMinutes = HARD_CAP_MINUTES;
        }
    });
    
    // Separate resources into logical pools
    const isQuestion = (r: StudyResource) => r.type === ResourceType.QUESTIONS || r.type === ResourceType.QUESTION_REVIEW;
    const contentPool = sortResources(activeResources.filter(r => !isQuestion(r) && !r.isOptional), topicOrder);
    const questionPool = sortResources(activeResources.filter(r => isQuestion(r) && !r.isOptional), topicOrder);
    const optionalPool = sortResources(activeResources.filter(r => r.isOptional), topicOrder);
    
    // --- PASS 1: SCHEDULE CONTENT ---
    for (const day of scheduleShell) {
        if (day.isRestDay || contentPool.length === 0) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);

        while (remainingTime >= MIN_DURATION_for_SPLIT_PART && contentPool.length > 0) {
            let taskFitted = false;
            // Try to fit a whole task
            for (let i = 0; i < contentPool.length; i++) {
                if (contentPool[i].durationMinutes <= remainingTime) {
                    const task = contentPool.splice(i, 1)[0];
                    day.tasks.push(mapResourceToTask(task, day.tasks.length));
                    remainingTime -= task.durationMinutes;
                    taskFitted = true;
                    break;
                }
            }
            if (taskFitted) continue;

            // If no whole task fits, try to split one
            let taskSplit = false;
            for (let i = 0; i < contentPool.length; i++) {
                const splitResult = splitTask(contentPool[i], remainingTime);
                if (splitResult) {
                    day.tasks.push(mapResourceToTask(splitResult.part1, day.tasks.length));
                    contentPool[i] = splitResult.part2;
                    remainingTime -= splitResult.part1.durationMinutes;
                    taskSplit = true;
                    break;
                }
            }
            if (!taskSplit) break; // No more tasks can be fit or split into this day
        }
    }
    
    // --- DETERMINE CONTENT COMPLETION DATES ---
    const lastContentDayByDomain: Partial<Record<Domain, string>> = {};
    for (const day of scheduleShell) {
        for (const task of day.tasks) {
            if (task.isPrimaryMaterial || task.type === ResourceType.VIDEO_LECTURE || task.type === ResourceType.READING_TEXTBOOK) {
                const domain = task.originalTopic;
                if (!lastContentDayByDomain[domain] || day.date > lastContentDayByDomain[domain]!) {
                    lastContentDayByDomain[domain] = day.date;
                }
            }
        }
    }

    // --- PASS 2: SCHEDULE QUESTIONS ---
    for (const day of scheduleShell) {
        if (day.isRestDay || questionPool.length === 0) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);

        while (remainingTime >= MIN_DURATION_for_SPLIT_PART && questionPool.length > 0) {
            let taskFitted = false;
            for (let i = 0; i < questionPool.length; i++) {
                const task = questionPool[i];
                const contentDeadline = lastContentDayByDomain[task.domain] || '0000-00-00';
                if (day.date >= contentDeadline && task.durationMinutes <= remainingTime) {
                    const scheduledTask = questionPool.splice(i, 1)[0];
                    day.tasks.push(mapResourceToTask(scheduledTask, day.tasks.length));
                    remainingTime -= scheduledTask.durationMinutes;
                    taskFitted = true;
                    break;
                }
            }
            if (!taskFitted) break;
        }
    }

    // --- PASS 3: SCHEDULE OPTIONAL CONTENT ---
    for (const day of scheduleShell) {
        if (day.isRestDay || optionalPool.length === 0) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        while (remainingTime >= MIN_DURATION_for_SPLIT_PART && optionalPool.length > 0) {
            let taskFitted = false;
            for (let i = 0; i < optionalPool.length; i++) {
                if (optionalPool[i].durationMinutes <= remainingTime) {
                    const task = optionalPool.splice(i, 1)[0];
                    day.tasks.push(mapResourceToTask(task, day.tasks.length));
                    remainingTime -= task.durationMinutes;
                    taskFitted = true;
                    break;
                }
            }
            if (!taskFitted) break;
        }
    }

    // --- FINAL NOTIFICATIONS ---
    const unscheduledPrimary = [...contentPool, ...questionPool];
    const unscheduledOptional = optionalPool;

    if (unscheduledPrimary.length > 0) {
        const time = unscheduledPrimary.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'error',
            message: `Could not fit all primary content. ${unscheduledPrimary.length} tasks (~${formatDuration(time)}) remain unscheduled. Consider adding study time or archiving content.`
        });
    } else if (unscheduledOptional.length > 0) {
        const time = unscheduledOptional.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'warning',
            message: `Could not fit all optional content. ${unscheduledOptional.length} tasks (~${formatDuration(time)}) remain.`
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
    
    let currentDateIter = new Date(startDate.getTime());
    
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
        currentDateIter.setUTCDate(currentDateIter.getUTCDate() + 1);
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

    const fullScheduleShell = createScheduleShell(STUDY_START_DATE, STUDY_END_DATE, userAddedExceptions);
    
    const today = getTodayInNewYork();
    const futureSchedulingDays = fullScheduleShell.filter(day => day.date >= today);

    const notifications = runSchedulingEngine(futureSchedulingDays, schedulingPool, planConfig);
    
    const schedule = fullScheduleShell;

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
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    let notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    let finalSchedule: DailySchedule[];

    const completedOriginalResourceIds = new Set<string>();
    currentPlan.schedule.flatMap(day => day.tasks).forEach(task => {
        if (task.status === 'completed') {
            completedOriginalResourceIds.add(task.originalResourceId || task.resourceId);
        }
    });

    const baseSchedulingPool = JSON.parse(JSON.stringify(
        activeResources.filter(r => !completedOriginalResourceIds.has(r.id))
    ));

    const rebalanceStartDate = getTodayInNewYork();
    
    const pastScheduleShell = currentPlan.schedule
        .filter(day => day.date < rebalanceStartDate)
        .map(day => ({
            ...day,
            tasks: day.tasks.filter(t => t.status === 'completed')
        }));

    if (options.type === 'topic-time') {
        const { date: modifiedDate, topics, totalTimeMinutes } = options;

        if (modifiedDate < rebalanceStartDate) {
            notifications.push({ type: 'error', message: "Cannot use Topic/Time rebalance for a past date." });
            return { plan: currentPlan, notifications };
        }

        const intermediateScheduleShell = createScheduleShell(rebalanceStartDate, modifiedDate, userAddedExceptions).filter(d => d.date < modifiedDate);
        const modifiedDayTemplate = createScheduleShell(modifiedDate, modifiedDate, userAddedExceptions)[0];
        // FIX: Changed totalStudyTimeMinutes to totalStudyTimeMinutes: totalTimeMinutes to correctly assign the value.
        const modifiedDay: DailySchedule = { ...modifiedDayTemplate, tasks: [], totalStudyTimeMinutes: totalTimeMinutes, isRestDay: totalTimeMinutes === 0, isManuallyModified: true };
        
        const futureStartDate = new Date(parseDateString(modifiedDate));
        futureStartDate.setUTCDate(futureStartDate.getUTCDate() + 1);
        const futureStartDateStr = futureStartDate.toISOString().split('T')[0];
        
        let futureScheduleShell: DailySchedule[] = [];
        if (futureStartDateStr <= currentPlan.endDate) {
            futureScheduleShell = createScheduleShell(futureStartDateStr, currentPlan.endDate, userAddedExceptions);
        }

        let priorityPool = baseSchedulingPool.filter((r: StudyResource) => topics.includes(r.domain));
        let remainingPool = baseSchedulingPool.filter((r: StudyResource) => !topics.includes(r.domain));

        runSchedulingEngine([modifiedDay], priorityPool, currentPlan);
        remainingPool.push(...priorityPool);
        
        const remainingScheduleShell = [...intermediateScheduleShell, ...futureScheduleShell];
        const remainingNotifications = runSchedulingEngine(remainingScheduleShell, remainingPool, currentPlan);
        notifications.push(...remainingNotifications);
        
        finalSchedule = [...pastScheduleShell, ...intermediateScheduleShell, modifiedDay, ...futureScheduleShell];

    } else { // Standard rebalance
        const futureScheduleShell = createScheduleShell(rebalanceStartDate, currentPlan.endDate, userAddedExceptions);
        const standardNotifications = runSchedulingEngine(futureScheduleShell, baseSchedulingPool, currentPlan);
        notifications.push(...standardNotifications);
        finalSchedule = [...pastScheduleShell, ...futureScheduleShell];
    }
    
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