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

const HARD_CAP_MINUTES = 14 * 60;

const getDayName = (dateStr: string): string => {
  const date = parseDateString(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

const mapResourceToTask = (resource: StudyResource, order: number, status: 'pending' | 'completed' = 'pending'): ScheduledTask => ({
    id: `task_${resource.id}_${order}`,
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
});

const splitTask = (task: StudyResource, timeToFill: number): { part1: StudyResource, part2: StudyResource } | null => {
    if (!task.isSplittable || task.durationMinutes <= timeToFill || timeToFill < MIN_DURATION_for_SPLIT_PART) {
        return null;
    }

    const ratio = timeToFill / task.durationMinutes;
    const originalId = task.originalResourceId || task.id;
    
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
        partNumber: (task.partNumber || 1),
    };
    
    const part2: StudyResource = {
        ...task,
        id: task.id,
        durationMinutes: task.durationMinutes - timeToFill,
        pages: (task.pages && part1Pages) ? task.pages - part1Pages : undefined,
        questionCount: (task.questionCount && part1Questions) ? task.questionCount - part1Questions : undefined,
        isSplitSource: true,
        originalResourceId: originalId,
        partNumber: (task.partNumber || 1) + 1,
    };
    
    if (task.startPage && task.pages && part1.pages && part1.pages > 0) {
        part1.endPage = task.startPage + part1.pages - 1;
        part2.startPage = part1.endPage + 1;
    }
    // Update totalParts on both, as we don't know the final number of splits yet
    part1.totalParts = (task.totalParts || 1) + 1; 
    part2.totalParts = (task.totalParts || 1) + 1;

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
    if (!source) return 99;
    const priorityKey = Object.keys(sourcePriorityMap).find(key => source.includes(key));
    return priorityKey ? sourcePriorityMap[priorityKey] : 90;
};

const sortResourcesForScheduling = (resources: StudyResource[], topicOrder: Domain[]): StudyResource[] => {
    return [...resources].sort((a, b) => {
        if (a.isOptional !== b.isOptional) return a.isOptional ? 1 : -1;
        const domainIndexA = topicOrder.indexOf(a.domain);
        const domainIndexB = topicOrder.indexOf(b.domain);
        if (domainIndexA !== domainIndexB) return (domainIndexA === -1 ? Infinity : domainIndexA) - (domainIndexB === -1 ? Infinity : domainIndexB);
        const sourcePrioA = getSourcePriority(a);
        const sourcePrioB = getSourcePriority(b);
        if (sourcePrioA !== sourcePrioB) return sourcePrioA - sourcePrioB;
        if ((a.sequenceOrder ?? Infinity) !== (b.sequenceOrder ?? Infinity)) return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
        return a.title.localeCompare(b.title);
    });
};

const fillTimeOnDay = (day: DailySchedule, pool: StudyResource[], timeToFill: number, filterFunc: (r: StudyResource) => boolean = () => true): number => {
    let timeFilled = 0;
    while (timeToFill >= MIN_DURATION_for_SPLIT_PART && pool.length > 0) {
        let taskFitted = false;
        for (let i = 0; i < pool.length; i++) {
            if (filterFunc(pool[i]) && pool[i].durationMinutes <= timeToFill) {
                const task = pool.splice(i, 1)[0];
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                timeToFill -= task.durationMinutes;
                timeFilled += task.durationMinutes;
                taskFitted = true;
                break; 
            }
        }
        if (taskFitted) continue;

        let taskSplit = false;
        for (let i = 0; i < pool.length; i++) {
            if (filterFunc(pool[i])) { 
                const splitResult = splitTask(pool[i], timeToFill);
                if (splitResult) {
                    day.tasks.push(mapResourceToTask(splitResult.part1, day.tasks.length));
                    pool[i] = splitResult.part2; 
                    const filledDuration = splitResult.part1.durationMinutes;
                    timeToFill -= filledDuration;
                    timeFilled += filledDuration;
                    taskSplit = true;
                    break; 
                }
            }
        }
        if (!taskSplit) break; 
    }
    return timeFilled;
};


const runSchedulingEngine = (
    scheduleShell: DailySchedule[],
    resourcePool: StudyResource[],
    config: Partial<StudyPlan>,
): GeneratedStudyPlanOutcome['notifications'] => {
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    const { topicOrder = [] } = config;

    scheduleShell.forEach(day => {
        day.tasks = []; 
    });

    const activeResources: StudyResource[] = JSON.parse(JSON.stringify(resourcePool.filter((r: StudyResource) => !r.isArchived)));
    const resourceMap = new Map<string, StudyResource>(activeResources.map((r: StudyResource) => [r.id, r]));
    const isQuestion = (r: StudyResource) => r.type === ResourceType.QUESTIONS || r.type === ResourceType.REVIEW_QUESTIONS || r.type === ResourceType.QUESTION_REVIEW;
    
    const pools = {
        titan: sortResourcesForScheduling(activeResources.filter(r => r.videoSource === 'Titan Radiology Videos' && !r.isOptional), topicOrder),
        ctc: sortResourcesForScheduling(activeResources.filter(r => r.bookSource?.includes('Crack the Core Volume') && !r.isOptional), topicOrder),
        caseCompanion: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'Crack the Core Case Companion' && !r.isOptional), topicOrder),
        nisRisc: sortResourcesForScheduling(activeResources.filter(r => (r.domain === Domain.NIS || r.domain === Domain.RISC) && !r.isOptional), topicOrder),
        boardVitals: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'Board Vitals' && isQuestion(r) && !r.isOptional), topicOrder),
        qevlar: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'QEVLAR' && isQuestion(r) && !r.isOptional), topicOrder),
        otherQBanks: sortResourcesForScheduling(activeResources.filter(r => (r.bookSource === 'Physics Qbank (Categorized)' || r.bookSource === 'NucApp' || r.bookSource === 'NIS Question Bank') && isQuestion(r) && !r.isOptional), topicOrder),
        discord: sortResourcesForScheduling(activeResources.filter(r => r.videoSource === 'Discord Review Sessions'), topicOrder),
        coreRadiology: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'Core Radiology' && !r.isOptional), topicOrder),
    };

    const findDayForResource = (resource: StudyResource, schedule: DailySchedule[], startingDayIndex = 0): { day: DailySchedule, dayIndex: number } | null => {
        for (let i = startingDayIndex; i < schedule.length; i++) {
            const day = schedule[i];
            const timeUsed = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            if (!day.isRestDay && (day.totalStudyTimeMinutes - timeUsed) >= resource.durationMinutes) {
                return { day, dayIndex: i };
            }
        }
        return null;
    };

    const placeResourceOnDay = (resource: StudyResource, day: DailySchedule) => {
        day.tasks.push(mapResourceToTask(resource, day.tasks.length));
    };

    const placeMatchingResource = (day: DailySchedule, primaryResource: StudyResource, pool: StudyResource[]) => {
        const availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (availableTime < MIN_DURATION_for_SPLIT_PART) return;

        if (primaryResource.pairedResourceIds) {
            for (const pairedId of primaryResource.pairedResourceIds) {
                const idx = pool.findIndex(r => r.id === pairedId);
                if (idx !== -1 && pool[idx].durationMinutes <= availableTime) {
                    const [pairedResource] = pool.splice(idx, 1);
                    placeResourceOnDay(pairedResource, day);
                    return; 
                }
            }
        }
        const idx = pool.findIndex(r => r.domain === primaryResource.domain && r.durationMinutes <= availableTime);
        if (idx !== -1) {
            const [pairedResource] = pool.splice(idx, 1);
            placeResourceOnDay(pairedResource, day);
        }
    };

    // --- Pass 1: Titan Videos and their direct pairs ---
    const titanMasterList = [...pools.titan];
    const unscheduledTitan: StudyResource[] = [];

    for (const titanResource of titanMasterList) {
        const foundDay = findDayForResource(titanResource, scheduleShell);
        if (foundDay) {
            placeResourceOnDay(titanResource, foundDay.day);
            placeMatchingResource(foundDay.day, titanResource, pools.ctc);
            placeMatchingResource(foundDay.day, titanResource, pools.caseCompanion);
        } else {
            unscheduledTitan.push(titanResource);
        }
    }

    // --- Pass 2: Standalone high-priority (NIS/RISC) ---
    const nisRiscMasterList = [...pools.nisRisc];
    const unscheduledNisRisc: StudyResource[] = [];
    for (const resource of nisRiscMasterList) {
        const foundDay = findDayForResource(resource, scheduleShell);
        if (foundDay) {
            placeResourceOnDay(resource, foundDay.day);
        } else {
            unscheduledNisRisc.push(resource);
        }
    }
    
    // --- Pass 3: Questions ---
    for (const day of scheduleShell) {
        if(day.isRestDay) continue;
        let availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((s,t)=>s+t.durationMinutes,0);
        if (availableTime < MIN_DURATION_for_SPLIT_PART) continue;

        const topicsOnDay = new Set(day.tasks.map(t => t.originalTopic));
        if (topicsOnDay.size === 0) continue;
        
        const questionFilter = (r: StudyResource) => topicsOnDay.has(r.domain);
        availableTime -= fillTimeOnDay(day, pools.qevlar, availableTime, questionFilter);
        availableTime -= fillTimeOnDay(day, pools.otherQBanks, availableTime, questionFilter);
        availableTime -= fillTimeOnDay(day, pools.boardVitals, availableTime);
    }

    // --- Pass 4: Fillers ---
    const fillerPool = sortResourcesForScheduling([
        ...pools.discord, ...pools.coreRadiology, ...pools.ctc, ...pools.caseCompanion,
        ...unscheduledTitan, ...unscheduledNisRisc
    ], topicOrder);

    for (const day of scheduleShell) {
        if(day.isRestDay) continue;
        const timeUsed = day.tasks.reduce((s,t)=>s+t.durationMinutes,0);
        const timeToFill = HARD_CAP_MINUTES - timeUsed;
        if (timeToFill > MIN_DURATION_for_SPLIT_PART) {
            const timeFilled = fillTimeOnDay(day, fillerPool, timeToFill);
            if (timeFilled > 0 && (timeUsed + timeFilled) > day.totalStudyTimeMinutes) {
                 day.totalStudyTimeMinutes = timeUsed + timeFilled;
            }
        }
    }
    
    // --- Final Task Sorting within each day ---
    const taskTypePriority: Partial<Record<ResourceType, number>> = {
        [ResourceType.VIDEO_LECTURE]: 1,
        [ResourceType.READING_TEXTBOOK]: 2,
        [ResourceType.READING_GUIDE]: 2,
        [ResourceType.CASES]: 3,
        [ResourceType.QUESTIONS]: 4,
        [ResourceType.QUESTION_REVIEW]: 5,
    };

    scheduleShell.forEach(day => {
        day.tasks.sort((a, b) => {
            const prioA = taskTypePriority[a.type] ?? 99;
            const prioB = taskTypePriority[b.type] ?? 99;
            if (prioA !== prioB) return prioA - prioB;
            return a.order - b.order;
        });
        day.tasks.forEach((task, index) => task.order = index);
    });

    const unscheduledPrimary = [
        ...unscheduledTitan, ...unscheduledNisRisc, 
        ...pools.ctc, ...pools.caseCompanion, ...pools.qevlar, ...pools.boardVitals,
        ...pools.otherQBanks, ...pools.coreRadiology
    ].filter(r => !r.isOptional);

    if (unscheduledPrimary.length > 0) {
        const time = unscheduledPrimary.reduce((acc, task) => acc + task.durationMinutes, 0);
        notifications.push({ type: 'error', message: `Could not fit all primary content. ${unscheduledPrimary.length} tasks (~${formatDuration(time)}) remain unscheduled. Consider extending deadlines or adding study time.` });
    }
    
    return notifications;
};


export const createScheduleShell = (
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
    planStartDate: string = STUDY_START_DATE,
    planEndDate: string = STUDY_END_DATE,
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

    const fullScheduleShell = createScheduleShell(planStartDate, planEndDate, userAddedExceptions);
    
    const notifications = runSchedulingEngine(fullScheduleShell, schedulingPool, planConfig);
    
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
        startDate: planStartDate,
        endDate: planEndDate,
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