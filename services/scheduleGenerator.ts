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

const SOFT_CAP_MINUTES = 10 * 60; // 10 hours
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

    const part1: StudyResource = {
        ...task,
        id: `${originalId}_part_${Date.now()}`,
        durationMinutes: timeToFill,
        pages: task.pages ? Math.ceil(task.pages * ratio) : undefined,
        questionCount: task.questionCount ? Math.ceil(task.questionCount * ratio) : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
        partNumber: currentPartNumber,
        totalParts: totalParts,
    };
    
    const part2: StudyResource = {
        ...task,
        id: task.id,
        durationMinutes: task.durationMinutes - timeToFill,
        pages: task.pages ? task.pages - (part1.pages || 0) : undefined,
        questionCount: task.questionCount ? task.questionCount - (part1.questionCount || 0) : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
        partNumber: currentPartNumber + 1,
        totalParts: totalParts,
    };

    return { part1, part2 };
};


const sortResources = (
  resources: StudyResource[],
  topicOrder: Domain[],
  isCramMode: boolean,
  cramTopicOrder: Domain[]
): StudyResource[] => {
    const getPriorityScore = (r: StudyResource) => {
        if (r.isOptional) return 4;
        switch (r.schedulingPriority) {
            case 'high': return 1;
            case 'medium': return 2;
            case 'low': return 3;
            default: return 3;
        }
    };

    return [...resources].sort((a, b) => {
        const priorityA = getPriorityScore(a);
        const priorityB = getPriorityScore(b);
        if (priorityA !== priorityB) return priorityA - priorityB;
        
        const isSpecialDomainA = a.domain === Domain.PHYSICS || a.domain === Domain.NUCLEAR_MEDICINE;
        const isSpecialDomainB = b.domain === Domain.PHYSICS || b.domain === Domain.NUCLEAR_MEDICINE;

        if (isSpecialDomainA && isSpecialDomainB && a.domain === b.domain) {
            const isQuestionA = a.type === ResourceType.QUESTIONS || a.type === ResourceType.QUESTION_REVIEW;
            const isQuestionB = b.type === ResourceType.QUESTIONS || b.type === ResourceType.QUESTION_REVIEW;
            if (isQuestionA && !isQuestionB) return 1;
            if (!isQuestionA && isQuestionB) return -1;
        }

        const order = isCramMode ? cramTopicOrder : topicOrder;
        const topicIndexA = order.indexOf(a.domain);
        const topicIndexB = order.indexOf(b.domain);
        if (topicIndexA !== topicIndexB) return (topicIndexA === -1 ? Infinity : topicIndexA) - (topicIndexB === -1 ? Infinity : topicIndexB);
        
        if ((a.sequenceOrder ?? Infinity) !== (b.sequenceOrder ?? Infinity)) return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
        if ((a.chapterNumber ?? Infinity) !== (b.chapterNumber ?? Infinity)) return (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity);
        
        return a.title.localeCompare(b.title);
    });
};

const distributeDeficitTime = (studyDays: DailySchedule[], totalMinutesNeeded: number): void => {
    if (studyDays.length === 0) return;

    let totalMinutesAvailable = studyDays.reduce((acc, d) => acc + d.totalStudyTimeMinutes, 0);
    if (totalMinutesNeeded <= totalMinutesAvailable) return;

    let deficit = totalMinutesNeeded - totalMinutesAvailable;

    // Phase 1: Fill all days up to the soft cap
    for (const day of studyDays) {
        if (deficit <= 0) break;
        const potentialIncrease = SOFT_CAP_MINUTES - day.totalStudyTimeMinutes;
        if (potentialIncrease > 0) {
            const increase = Math.min(deficit, potentialIncrease);
            day.totalStudyTimeMinutes += increase;
            deficit -= increase;
        }
    }

    if (deficit <= 0) return;

    // Phase 2: Distribute remaining deficit evenly up to the hard cap
    const daysBelowHardCap = studyDays.filter(d => d.totalStudyTimeMinutes < HARD_CAP_MINUTES);
    if (daysBelowHardCap.length > 0) {
        const extraTimePerDay = Math.ceil(deficit / daysBelowHardCap.length);
        for (const day of daysBelowHardCap) {
            const increase = Math.min(extraTimePerDay, HARD_CAP_MINUTES - day.totalStudyTimeMinutes);
            day.totalStudyTimeMinutes += increase;
        }
    }
};

const adjustBudgetsForDeadlines = (
    scheduleShell: DailySchedule[],
    resourcePool: StudyResource[],
    deadlines: DeadlineSettings
): GeneratedStudyPlanOutcome['notifications'] => {
    if (!deadlines || Object.keys(deadlines).length === 0) {
        return [];
    }
    
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    const today = getTodayInNewYork();
    
    const deadlineCategories: { key: keyof DeadlineSettings, domains: Domain[], label: string }[] = [
        { key: 'physicsContent', domains: [Domain.PHYSICS], label: 'Physics' },
        { key: 'nucMedContent', domains: [Domain.NUCLEAR_MEDICINE], label: 'Nuclear Medicine' },
        { key: 'otherContent', domains: ALL_DOMAINS.filter(d => d !== Domain.PHYSICS && d !== Domain.NUCLEAR_MEDICINE), label: 'Other Topics' },
    ];

    for (const category of deadlineCategories) {
        const deadlineStr = deadlines[category.key];
        if (!deadlineStr) continue;

        const categoryResources = resourcePool.filter(r => category.domains.includes(r.domain) && r.isPrimaryMaterial);
        const totalMinutesNeeded = categoryResources.reduce((acc, r) => acc + r.durationMinutes, 0);

        const daysUntilDeadline = scheduleShell.filter(d => d.date >= today && d.date <= deadlineStr && !d.isRestDay);
        if (daysUntilDeadline.length === 0) {
            if (totalMinutesNeeded > 0) {
                notifications.push({ type: 'error', message: `Cannot meet ${category.label} deadline. No study days available before ${deadlineStr}.` });
            }
            continue;
        }

        const totalMinutesAvailable = daysUntilDeadline.reduce((acc, d) => acc + d.totalStudyTimeMinutes, 0);
        
        if (totalMinutesNeeded > totalMinutesAvailable) {
            distributeDeficitTime(daysUntilDeadline, totalMinutesNeeded);
            
            const newTotalMinutesAvailable = daysUntilDeadline.reduce((acc, d) => acc + d.totalStudyTimeMinutes, 0);
            if (totalMinutesNeeded > newTotalMinutesAvailable) {
                 notifications.push({ type: 'warning', message: `Could not fit all ${category.label} content by deadline even after maximizing daily study time.` });
            }
        }
    }
    return notifications;
};

const runSchedulingEngine = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    config: Partial<StudyPlan>,
): GeneratedStudyPlanOutcome['notifications'] => {
    
    const deadlineNotifications = adjustBudgetsForDeadlines(scheduleShell, resourcePool, config.deadlines || {});
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [...deadlineNotifications];

    const { topicOrder = [], isCramModeActive = false, cramTopicOrder = [], areSpecialTopicsInterleaved = true } = config;
    
    const activeResources = resourcePool.filter(r => !r.isArchived);
    const optionalResources = activeResources.filter(r => r.isOptional);
    let nonOptionalResources = activeResources.filter(r => !r.isOptional);

    let physicsAndNucsPool: StudyResource[] = [];
    if (areSpecialTopicsInterleaved) {
        physicsAndNucsPool = nonOptionalResources.filter(r => r.domain === Domain.PHYSICS || r.domain === Domain.NUCLEAR_MEDICINE);
        nonOptionalResources = nonOptionalResources.filter(r => r.domain !== Domain.PHYSICS && r.domain !== Domain.NUCLEAR_MEDICINE);
    }
    
    let tasksToSchedule = sortResources(nonOptionalResources, topicOrder, isCramModeActive, cramTopicOrder);
    const totalMinutesNeeded = [...tasksToSchedule, ...physicsAndNucsPool].reduce((acc, r) => acc + r.durationMinutes, 0);
    
    const studyDays = scheduleShell.filter(d => !d.isRestDay);
    if (studyDays.length > 0) {
        distributeDeficitTime(studyDays, totalMinutesNeeded);
        
        const totalMinutesAvailable = studyDays.reduce((acc, d) => acc + d.totalStudyTimeMinutes, 0);
        if (totalMinutesNeeded > totalMinutesAvailable) {
            notifications.push({
                type: 'error',
                message: `Could not fit all content. ${formatDuration(totalMinutesNeeded - totalMinutesAvailable)} remains. Please extend your end date or add more study time on exception days.`
            });
        }
    }
    
    for (const day of scheduleShell) {
        if (day.isRestDay || tasksToSchedule.length === 0) continue;
        let remainingTime = day.totalStudyTimeMinutes;

        while (remainingTime >= MIN_DURATION_for_SPLIT_PART && tasksToSchedule.length > 0) {
            let taskFitted = false;
            for (let i = 0; i < tasksToSchedule.length; i++) {
                if (tasksToSchedule[i].durationMinutes <= remainingTime) {
                    const task = tasksToSchedule.splice(i, 1)[0];
                    day.tasks.push(mapResourceToTask(task, day.tasks.length));
                    remainingTime -= task.durationMinutes;
                    taskFitted = true;
                    break;
                }
            }
            if (taskFitted) continue;

            let taskSplit = false;
            for (let i = 0; i < tasksToSchedule.length; i++) {
                const splitResult = splitTask(tasksToSchedule[i], remainingTime);
                if (splitResult) {
                    day.tasks.push(mapResourceToTask(splitResult.part1, day.tasks.length));
                    tasksToSchedule[i] = splitResult.part2;
                    remainingTime -= splitResult.part1.durationMinutes;
                    taskSplit = true;
                    break;
                }
            }
            if (!taskSplit) break;
        }
    }

    if (areSpecialTopicsInterleaved && physicsAndNucsPool.length > 0) {
        const sortedInterleavedPool = sortResources(physicsAndNucsPool, topicOrder, false, []);
        let dayIndex = 0;
        
        while(sortedInterleavedPool.length > 0) {
            const day = studyDays[dayIndex % studyDays.length];
            if (!day) { dayIndex++; continue; }

            const CHUNK_SIZE = Math.min(30, sortedInterleavedPool[0].durationMinutes);
            const task = sortedInterleavedPool[0];
            const split = splitTask(task, CHUNK_SIZE);
            if (split) {
                day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                sortedInterleavedPool[0] = split.part2;
            } else {
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                sortedInterleavedPool.shift();
            }
            dayIndex++;
        }
    }

    const optionalTasks = sortResources(optionalResources, topicOrder, false, []);
    for (const day of scheduleShell) {
        if (day.isRestDay || optionalTasks.length === 0) continue;
        const usedTime = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        let remainingTime = day.totalStudyTimeMinutes - usedTime;
        
        while (remainingTime >= 15 && optionalTasks.length > 0) {
            let fittedOptional = false;
            for (let i = 0; i < optionalTasks.length; i++) {
                if (optionalTasks[i].durationMinutes <= remainingTime) {
                    const task = optionalTasks.splice(i, 1)[0];
                    day.tasks.push(mapResourceToTask(task, day.tasks.length));
                    remainingTime -= task.durationMinutes;
                    fittedOptional = true;
                    break;
                }
            }
            if (!fittedOptional) break;
        }
    }

    if (tasksToSchedule.length > 0) {
        const remainingTime = tasksToSchedule.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({
            type: 'warning',
            message: `Could not fit all primary content. ${tasksToSchedule.length} tasks (~${formatDuration(remainingTime)}) remain. Please extend your end date or increase daily study time.`
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
    const activeResources = masterResourcePool.filter(r => !r.isArchived);

    const completedOriginalResourceIds = new Set<string>();
    currentPlan.schedule.flatMap(day => day.tasks).forEach(task => {
        if (task.status === 'completed') {
            completedOriginalResourceIds.add(task.originalResourceId || task.resourceId);
        }
    });

    const baseSchedulingPool = JSON.parse(JSON.stringify(
        activeResources.filter(r => !completedOriginalResourceIds.has(r.id))
    ));

    let finalSchedule: DailySchedule[];
    let notifications: GeneratedStudyPlanOutcome['notifications'] = [];

    if (options.type === 'topic-time') {
        console.log("[Scheduler Engine] Rebalancing with Topic/Time specification.");
        const { date: modifiedDate, topics, totalTimeMinutes } = options;

        const pastScheduleShell = currentPlan.schedule.filter(day => day.date < modifiedDate).map(day => ({ ...day }));

        const modifiedDayTemplate = currentPlan.schedule.find(d => d.date === modifiedDate) || createScheduleShell(modifiedDate, modifiedDate, userAddedExceptions)[0];
        const modifiedDay: DailySchedule = {
            ...modifiedDayTemplate,
            tasks: [],
            totalStudyTimeMinutes: totalTimeMinutes,
            isRestDay: totalTimeMinutes === 0,
            isManuallyModified: true,
        };

        let priorityPool = baseSchedulingPool.filter((r: StudyResource) => topics.includes(r.domain));
        let remainingPool = baseSchedulingPool.filter((r: StudyResource) => !topics.includes(r.domain));
        
        const modifiedDayNotifications = runSchedulingEngine([modifiedDay], priorityPool, currentPlan);
        notifications.push(...modifiedDayNotifications);
        
        remainingPool.push(...priorityPool); // Add back unused priority tasks

        const futureStartDate = new Date(parseDateString(modifiedDate));
        futureStartDate.setUTCDate(futureStartDate.getUTCDate() + 1);
        const futureStartDateStr = futureStartDate.toISOString().split('T')[0];
        
        let futureScheduleShell: DailySchedule[] = [];
        if (futureStartDateStr <= currentPlan.endDate) {
            futureScheduleShell = createScheduleShell(futureStartDateStr, currentPlan.endDate, userAddedExceptions);
            const futureNotifications = runSchedulingEngine(futureScheduleShell, remainingPool, currentPlan);
            notifications.push(...futureNotifications);
        }
        
        finalSchedule = [...pastScheduleShell, modifiedDay, ...futureScheduleShell];

    } else { // Standard rebalance
        console.log("[Scheduler Engine] Rebalancing schedule from today onwards.");
        const rebalanceStartDate = getTodayInNewYork();
        const pastScheduleShell = currentPlan.schedule.filter(day => day.date < rebalanceStartDate).map(day => ({ ...day }));
        const futureScheduleShell = createScheduleShell(rebalanceStartDate, currentPlan.endDate, userAddedExceptions);
        
        notifications = runSchedulingEngine(futureScheduleShell, baseSchedulingPool, currentPlan);
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