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
    'Core Radiology': 9,
    'Discord Review Sessions': 8,
    'RISC Study Guide': 4,
    'NIS Study Guide': 4,
    'QEVLAR': 5,
    'Board Vitals': 6,
    'Physics Qbank (Categorized)': 7,
    'NIS Question Bank': 7,
    'NucApp': 7,
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

    scheduleShell.forEach(day => { day.tasks = []; });

    const activeResources = JSON.parse(JSON.stringify(resourcePool.filter((r) => !r.isArchived))) as StudyResource[];
    const isQuestion = (r: StudyResource) => r.type === ResourceType.QUESTIONS || r.type === ResourceType.REVIEW_QUESTIONS || r.type === ResourceType.QUESTION_REVIEW;

    const pools = {
        titan: sortResourcesForScheduling(activeResources.filter(r => r.videoSource === 'Titan Radiology Videos' && !r.isOptional), topicOrder),
        ctc: sortResourcesForScheduling(activeResources.filter(r => r.bookSource?.includes('Crack the Core') && !r.bookSource.includes('Companion') && !r.isOptional), topicOrder),
        caseCompanion: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'Crack the Core Case Companion' && !r.isOptional), topicOrder),
        nisRisc: sortResourcesForScheduling(activeResources.filter(r => (r.domain === Domain.NIS || r.domain === Domain.RISC) && !isQuestion(r) && !r.isOptional), topicOrder),
        qevlar: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'QEVLAR' && isQuestion(r) && !r.isOptional), topicOrder),
        boardVitals: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'Board Vitals' && isQuestion(r) && !r.isOptional), topicOrder),
        otherQBanks: sortResourcesForScheduling(activeResources.filter(r => isQuestion(r) && !r.isOptional && !['QEVLAR', 'Board Vitals'].includes(r.bookSource || '')), topicOrder),
        discord: sortResourcesForScheduling(activeResources.filter(r => r.videoSource === 'Discord Review Sessions' && !r.isOptional), topicOrder),
        coreRadiology: sortResourcesForScheduling(activeResources.filter(r => r.bookSource === 'Core Radiology' && !r.isOptional), topicOrder),
    };

    let dayIndex = 0;
    const unscheduledTitan: StudyResource[] = [];

    // Main Loop: Iterate through Titan videos and build days around them
    while (pools.titan.length > 0) {
        const titanAnchor = pools.titan.shift()!;
        
        // Find the earliest day with enough space
        let foundDayInfo = null;
        for (let i = dayIndex; i < scheduleShell.length; i++) {
            const day = scheduleShell[i];
            const timeUsed = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            if (!day.isRestDay && (day.totalStudyTimeMinutes - timeUsed) >= titanAnchor.durationMinutes) {
                foundDayInfo = { day, index: i };
                break;
            }
        }

        if (!foundDayInfo) {
            unscheduledTitan.push(titanAnchor);
            continue;
        }

        const { day, index } = foundDayInfo;
        dayIndex = index; // Start search for next titan from this day for efficiency
        let timeUsedOnDay = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);

        // --- Build Thematic Block for the Day ---
        day.tasks.push(mapResourceToTask(titanAnchor, day.tasks.length));
        timeUsedOnDay += titanAnchor.durationMinutes;
        const dayTopics = new Set<Domain>([titanAnchor.domain]);

        // Helper to place matching resources, now with pairing logic
        const placeMatchingResource = (pool: StudyResource[], primaryResource: StudyResource) => {
            let availableTime = day.totalStudyTimeMinutes - timeUsedOnDay;
            if (availableTime < MIN_DURATION_for_SPLIT_PART) return;

            let foundIndex = -1;
            // 1. Prioritize explicitly paired resources
            if (primaryResource.pairedResourceIds) {
                foundIndex = pool.findIndex(r => primaryResource.pairedResourceIds!.includes(r.id) && r.durationMinutes <= availableTime);
            }
            // 2. Fallback to topic-matched resources
            if (foundIndex === -1) {
                foundIndex = pool.findIndex(r => r.domain === primaryResource.domain && r.durationMinutes <= availableTime);
            }

            if (foundIndex !== -1) {
                const [resourceToPlace] = pool.splice(foundIndex, 1);
                day.tasks.push(mapResourceToTask(resourceToPlace, day.tasks.length));
                timeUsedOnDay += resourceToPlace.durationMinutes;
                dayTopics.add(resourceToPlace.domain);
            }
        };
        
        // --- Stricter Hierarchical Pass ---

        // Pass 2: Paired Content (CTC, Case Companion)
        placeMatchingResource(pools.ctc, titanAnchor);
        placeMatchingResource(pools.caseCompanion, titanAnchor);

        // Pass 3: Secondary Content (NIS/RISC) - These are less topic-specific, so just fit them if possible
        let availableTime = day.totalStudyTimeMinutes - timeUsedOnDay;
        const nisRiscIndex = pools.nisRisc.findIndex(t => t.durationMinutes <= availableTime);
        if (nisRiscIndex !== -1) {
             const [nisRiscTask] = pools.nisRisc.splice(nisRiscIndex, 1);
             day.tasks.push(mapResourceToTask(nisRiscTask, day.tasks.length));
             timeUsedOnDay += nisRiscTask.durationMinutes;
        }
        
        // Pass 4: Questions (must be after content)
        // The filter ensures questions are only for topics covered today
        const questionFilter = (r: StudyResource) => dayTopics.has(r.domain);

        // QEVLAR (topic-specific) first
        availableTime = day.totalStudyTimeMinutes - timeUsedOnDay;
        if (availableTime >= MIN_DURATION_for_SPLIT_PART) {
            timeUsedOnDay += fillTimeOnDay(day, pools.qevlar, availableTime, questionFilter);
        }
        
        // Other specific QBanks
        availableTime = day.totalStudyTimeMinutes - timeUsedOnDay;
        if (availableTime >= MIN_DURATION_for_SPLIT_PART) {
            timeUsedOnDay += fillTimeOnDay(day, pools.otherQBanks, availableTime, questionFilter);
        }
        
        // Board Vitals (broad) can be used to fill remaining time
        availableTime = day.totalStudyTimeMinutes - timeUsedOnDay;
        if (availableTime >= MIN_DURATION_for_SPLIT_PART) {
            timeUsedOnDay += fillTimeOnDay(day, pools.boardVitals, availableTime);
        }

        // Pass 5: Discord Videos
        availableTime = day.totalStudyTimeMinutes - timeUsedOnDay;
        if (availableTime >= MIN_DURATION_for_SPLIT_PART) {
            timeUsedOnDay += fillTimeOnDay(day, pools.discord, availableTime);
        }
        
        // Pass 6: Core Radiology Filler
        availableTime = day.totalStudyTimeMinutes - timeUsedOnDay;
        if (availableTime >= MIN_DURATION_for_SPLIT_PART) {
            timeUsedOnDay += fillTimeOnDay(day, pools.coreRadiology, availableTime);
        }
    }
    
    // --- Pass for Leftovers: Fill remaining time in all days up to HARD_CAP ---
    const leftoverPool = sortResourcesForScheduling([
        ...unscheduledTitan, ...pools.ctc, ...pools.caseCompanion, ...pools.nisRisc,
        ...pools.qevlar, ...pools.boardVitals, ...pools.otherQBanks,
        ...pools.discord, ...pools.coreRadiology
    ], topicOrder);

    scheduleShell.forEach(day => {
        if (day.isRestDay) return;
        const timeUsed = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        const timeToFill = HARD_CAP_MINUTES - timeUsed;
        if (timeToFill >= MIN_DURATION_for_SPLIT_PART) {
            const filledTime = fillTimeOnDay(day, leftoverPool, timeToFill);
            if (timeUsed + filledTime > day.totalStudyTimeMinutes) {
                day.totalStudyTimeMinutes = Math.min(HARD_CAP_MINUTES, timeUsed + filledTime);
            }
        }
    });

    // --- Final Task Sorting and Validation within each day ---
    const getTaskSourcePriority = (task: ScheduledTask): number => {
        const source = task.bookSource || task.videoSource;
        if (!source) return 99; // Custom tasks last
        const priorityKey = Object.keys(sourcePriorityMap).find(key => source.includes(key));
        return priorityKey ? sourcePriorityMap[priorityKey] : 90; // other known sources
    };
    
    scheduleShell.forEach(day => {
        day.tasks.sort((a, b) => getTaskSourcePriority(a) - getTaskSourcePriority(b));
        day.tasks.forEach((task, index) => task.order = index);
    });

    const unscheduledPrimary = leftoverPool.filter(r => !r.isOptional);

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