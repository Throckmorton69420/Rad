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
// Per user feedback, the hard cap is set to 14 hours.
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
    let deficit = totalMinutesNeeded - totalMinutesAvailable;

    if (deficit <= 0) return;

    // Iteratively distribute the deficit to ensure even loading and a balanced schedule.
    while (deficit > 0) {
        // Find days that are not yet at the hard cap
        const daysBelowHardCap = studyDays.filter(d => d.totalStudyTimeMinutes < HARD_CAP_MINUTES);
        if (daysBelowHardCap.length === 0) {
            // All available days are maxed out, cannot add more time.
            break;
        }

        // Distribute the remaining deficit evenly among the available days
        const timeToAddPerDay = Math.ceil(deficit / daysBelowHardCap.length);

        let deficitReducedInThisLoop = 0;
        for (const day of daysBelowHardCap) {
            const currentDeficit = deficit - deficitReducedInThisLoop;
            if (currentDeficit <= 0) break;
            
            const canAdd = HARD_CAP_MINUTES - day.totalStudyTimeMinutes;
            const amountToAdd = Math.min(timeToAddPerDay, canAdd, currentDeficit);
            
            day.totalStudyTimeMinutes += amountToAdd;
            deficitReducedInThisLoop += amountToAdd;
        }

        deficit -= deficitReducedInThisLoop;
        
        // If we couldn't add any time in a loop, it means all days are capped.
        if (deficitReducedInThisLoop === 0) break;
    }
};

const adjustBudgetsForDeadlines = (
    scheduleShell: DailySchedule[],
    resourcePool: StudyResource[],
    deadlines: DeadlineSettings
): GeneratedStudyPlanOutcome['notifications'] => {
    if (!deadlines || Object.values(deadlines).every(d => !d)) {
        return [];
    }
    
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    const primaryResources = resourcePool.filter(r => r.isPrimaryMaterial);

    const resourceToDeadlineMap = new Map<StudyResource, string>();
    for (const resource of primaryResources) {
        let earliestDeadline: string | null = deadlines.allContent || null;

        const isPhysics = resource.domain === Domain.PHYSICS;
        const isNucMed = resource.domain === Domain.NUCLEAR_MEDICINE;

        if (isPhysics && deadlines.physicsContent) {
            if (!earliestDeadline || deadlines.physicsContent < earliestDeadline) {
                earliestDeadline = deadlines.physicsContent;
            }
        }
        if (isNucMed && deadlines.nucMedContent) {
            if (!earliestDeadline || deadlines.nucMedContent < earliestDeadline) {
                earliestDeadline = deadlines.nucMedContent;
            }
        }
        if (!isPhysics && !isNucMed && deadlines.otherContent) {
            if (!earliestDeadline || deadlines.otherContent < earliestDeadline) {
                earliestDeadline = deadlines.otherContent;
            }
        }

        if (earliestDeadline) {
            resourceToDeadlineMap.set(resource, earliestDeadline);
        }
    }

    const deadlineToResourcesMap = new Map<string, StudyResource[]>();
    for (const [resource, deadline] of resourceToDeadlineMap.entries()) {
        if (!deadlineToResourcesMap.has(deadline)) {
            deadlineToResourcesMap.set(deadline, []);
        }
        deadlineToResourcesMap.get(deadline)!.push(resource);
    }

    const sortedDeadlines = Array.from(deadlineToResourcesMap.keys()).sort();

    for (const deadlineStr of sortedDeadlines) {
        const resourcesForDeadline = deadlineToResourcesMap.get(deadlineStr)!;
        const totalMinutesNeeded = resourcesForDeadline.reduce((acc, r) => acc + r.durationMinutes, 0);

        const daysUntilDeadline = scheduleShell.filter(d => d.date <= deadlineStr && !d.isRestDay);
        
        if (daysUntilDeadline.length === 0) {
            if (totalMinutesNeeded > 0) {
                notifications.push({ type: 'error', message: `Cannot meet deadline ${deadlineStr}. No study days available before this date.` });
            }
            continue;
        }

        const totalMinutesAvailable = daysUntilDeadline.reduce((acc, d) => acc + d.totalStudyTimeMinutes, 0);
        
        if (totalMinutesNeeded > totalMinutesAvailable) {
            distributeDeficitTime(daysUntilDeadline, totalMinutesNeeded);
            
            const newTotalMinutesAvailable = daysUntilDeadline.reduce((acc, d) => acc + d.totalStudyTimeMinutes, 0);
            if (totalMinutesNeeded > newTotalMinutesAvailable) {
                 notifications.push({ type: 'warning', message: `Could not fit all content for deadline ${deadlineStr} even after maximizing daily study time.` });
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

    // This captures tasks that were in the queue but couldn't be placed.
    const unscheduledPrimary = tasksToSchedule;
    // The optionalTasks array has had items spliced out of it, so what remains is unscheduled.
    const unscheduledOptional = optionalTasks;

    if (unscheduledPrimary.length > 0 || unscheduledOptional.length > 0) {
        const primaryTime = unscheduledPrimary.reduce((acc, task) => acc + task.durationMinutes, 0);
        const optionalTime = unscheduledOptional.reduce((acc, task) => acc + task.durationMinutes, 0);

        let message = '';
        // FIX: The notification type should be 'error' if primary content is unscheduled, as this is a critical planning failure.
        let notifType: 'error' | 'warning' | 'info' = 'info';

        if (unscheduledPrimary.length > 0) {
            notifType = 'error';
            message += `Could not fit all primary content. ${unscheduledPrimary.length} tasks (~${formatDuration(primaryTime)}) remain unscheduled.\n\n`;
            message += "Primary Items Left:\n";
            message += unscheduledPrimary.slice(0, 10).map(task => `• ${task.title} [${formatDuration(task.durationMinutes)}]`).join('\n');
            if (unscheduledPrimary.length > 10) {
                message += `\n...and ${unscheduledPrimary.length - 10} more.`;
            }
            message += `\n\n`;
        }

        if (unscheduledOptional.length > 0) {
            if (notifType === 'info') notifType = 'warning';
            message += `Could not fit all optional content. ${unscheduledOptional.length} tasks (~${formatDuration(optionalTime)}) remain unscheduled.\n\n`;
            message += "Optional Items Left:\n";
            message += unscheduledOptional.slice(0, 10).map(task => `• ${task.title} [${formatDuration(task.durationMinutes)}]`).join('\n');
            if (unscheduledOptional.length > 10) {
                message += `\n...and ${unscheduledOptional.length - 10} more.`;
            }
            message += `\n\n`;
        }

        message += 'To fit more content, consider extending your study period, adding study time on specific days, or adjusting content deadlines.';

        notifications.push({
            type: notifType,
            message: message.trim()
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

    // Create the shell for the entire period for UI rendering
    const fullScheduleShell = createScheduleShell(STUDY_START_DATE, STUDY_END_DATE, userAddedExceptions);
    
    // For initial generation or regeneration, only schedule tasks from today onwards.
    const today = getTodayInNewYork();
    const futureSchedulingDays = fullScheduleShell.filter(day => day.date >= today);

    // Run the engine ONLY on future days.
    const notifications = runSchedulingEngine(futureSchedulingDays, schedulingPool, planConfig);
    
    // The final schedule in the plan should contain all days (past and future) for UI consistency.
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

    // This is the definitive list of what's been completed.
    const completedOriginalResourceIds = new Set<string>();
    currentPlan.schedule.flatMap(day => day.tasks).forEach(task => {
        if (task.status === 'completed') {
            completedOriginalResourceIds.add(task.originalResourceId || task.resourceId);
        }
    });

    // This pool contains every resource that still needs to be scheduled.
    const baseSchedulingPool = JSON.parse(JSON.stringify(
        activeResources.filter(r => !completedOriginalResourceIds.has(r.id))
    ));

    const rebalanceStartDate = getTodayInNewYork();
    
    // Preserve the past, but only with completed tasks. Unfinished tasks from the past will be rescheduled.
    const pastScheduleShell = currentPlan.schedule
        .filter(day => day.date < rebalanceStartDate)
        .map(day => ({
            ...day,
            tasks: day.tasks.filter(t => t.status === 'completed')
        }));

    if (options.type === 'topic-time') {
        console.log("[Scheduler Engine] Rebalancing with Topic/Time specification, carrying over past pending tasks.");
        const { date: modifiedDate, topics, totalTimeMinutes } = options;

        if (modifiedDate < rebalanceStartDate) {
            notifications.push({ type: 'error', message: "Cannot use Topic/Time rebalance for a past date. Please use Standard Rebalance." });
            return { plan: currentPlan, notifications };
        }

        // Create shell for days between today and the modified day.
        const intermediateScheduleShell = createScheduleShell(rebalanceStartDate, modifiedDate, userAddedExceptions).filter(d => d.date < modifiedDate);

        // Create the modified day.
        const modifiedDayTemplate = createScheduleShell(modifiedDate, modifiedDate, userAddedExceptions)[0];
        const modifiedDay: DailySchedule = {
            ...modifiedDayTemplate,
            tasks: [],
            totalStudyTimeMinutes: totalTimeMinutes,
            isRestDay: totalTimeMinutes === 0,
            isManuallyModified: true,
        };
        
        // Create shell for days after the modified day.
        const futureStartDate = new Date(parseDateString(modifiedDate));
        futureStartDate.setUTCDate(futureStartDate.getUTCDate() + 1);
        const futureStartDateStr = futureStartDate.toISOString().split('T')[0];
        
        let futureScheduleShell: DailySchedule[] = [];
        if (futureStartDateStr <= currentPlan.endDate) {
            futureScheduleShell = createScheduleShell(futureStartDateStr, currentPlan.endDate, userAddedExceptions);
        }

        // Separate task pools.
        let priorityPool = baseSchedulingPool.filter((r: StudyResource) => topics.includes(r.domain));
        let remainingPool = baseSchedulingPool.filter((r: StudyResource) => !topics.includes(r.domain));

        // Schedule the modified day first with priority tasks.
        const modifiedDayNotifications = runSchedulingEngine([modifiedDay], priorityPool, currentPlan);
        notifications.push(...modifiedDayNotifications);
        
        // Add unused priority tasks back to the main pool to be scheduled later.
        remainingPool.push(...priorityPool);

        // Schedule all other future days (before and after the modified day) with the remaining pool.
        const remainingScheduleShell = [...intermediateScheduleShell, ...futureScheduleShell];
        const remainingNotifications = runSchedulingEngine(remainingScheduleShell, remainingPool, currentPlan);
        notifications.push(...remainingNotifications);
        
        // Stitch the full schedule back together.
        finalSchedule = [...pastScheduleShell, ...intermediateScheduleShell, modifiedDay, ...futureScheduleShell];

    } else { // Standard rebalance
        console.log("[Scheduler Engine] Rebalancing schedule from today onwards, carrying over past pending tasks.");
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