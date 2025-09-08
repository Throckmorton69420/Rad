import { StudyPlan, DailySchedule, ScheduledTask, StudyResource, Domain, RebalanceOptions, GeneratedStudyPlanOutcome, StudyBlock, ResourceType, ExceptionDateRule } from '../types';
import { 
    STUDY_START_DATE, 
    STUDY_END_DATE, 
    DEFAULT_CONSTRAINTS,
    MIN_DURATION_for_SPLIT_PART,
    DEFAULT_TOPIC_ORDER,
    WEEKDAY_QUESTION_BLOCK_OVERFLOW_MINUTES,
    WEEKEND_QUESTION_BLOCK_OVERFLOW_MINUTES,
} from '../constants';

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
    // This function correctly sorts resources first by sequence order, then chapter, then title,
    // ensuring a logical progression within a topic.
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

const createDomainBlocks = (resources: StudyResource[], topicOrder: Domain[], isPhysicsInTopicOrder: boolean): StudyBlock[] => {
    const primaryMaterials = resources.filter(r => r.isPrimaryMaterial && (isPhysicsInTopicOrder || r.domain !== Domain.PHYSICS));
    const domainMap = new Map<Domain, StudyResource[]>();

    for (const resource of primaryMaterials) {
        if (!domainMap.has(resource.domain)) {
            domainMap.set(resource.domain, []);
        }
        domainMap.get(resource.domain)!.push(resource);
    }
    
    const studyBlocks: StudyBlock[] = [];
    for (const domain of topicOrder) {
        if (domainMap.has(domain)) {
            const domainTasks = sortResources(domainMap.get(domain)!);
            studyBlocks.push({
                id: `block_${domain}`,
                domain: domain,
                tasks: domainTasks,
                totalDuration: domainTasks.reduce((sum, task) => sum + task.durationMinutes, 0),
                sequenceOrder: topicOrder.indexOf(domain),
            });
        }
    }

    for (const [domain, tasks] of domainMap.entries()) {
        if (!topicOrder.includes(domain)) {
             const domainTasks = sortResources(tasks);
             studyBlocks.push({
                id: `block_${domain}`,
                domain: domain,
                tasks: domainTasks,
                totalDuration: domainTasks.reduce((sum, task) => sum + task.durationMinutes, 0),
                sequenceOrder: studyBlocks.length + 100,
            });
        }
    }
    
    return studyBlocks;
};

const runCramModeScheduling = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    cramTopicOrder: Domain[], 
    isCramPhysicsInterleaved: boolean
) => {
    console.log("Running CRAM mode scheduling. Physics Interleaved:", isCramPhysicsInterleaved);
    const allCramVideos = resourcePool.filter(r => r.videoSource === 'Crack the Core - Titan Radiology Videos');
    const otherTasks = resourcePool.filter(r => r.videoSource !== 'Crack the Core - Titan Radiology Videos');

    let physicsVideos: StudyResource[] = [];
    let nonPhysicsVideos: StudyResource[];

    if (isCramPhysicsInterleaved) {
        physicsVideos = sortResources(allCramVideos.filter(v => v.domain === Domain.PHYSICS));
        nonPhysicsVideos = allCramVideos.filter(v => v.domain !== Domain.PHYSICS);
    } else {
        nonPhysicsVideos = allCramVideos;
    }

    const topicOrderMap = new Map(cramTopicOrder.map((domain, index) => [domain, index]));

    const sortedNonPhysicsVideos = nonPhysicsVideos.sort((a, b) => {
        const orderA = topicOrderMap.get(a.domain) ?? Infinity;
        const orderB = topicOrderMap.get(b.domain) ?? Infinity;
        if (orderA !== orderB) return orderA - orderB;
        return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
    });

    let allTasksToSchedule = [...sortedNonPhysicsVideos, ...sortResources(otherTasks)];
    let workdayCounter = 0;
    const physicsFrequency = 2;
    const physicsTimeSlot = 60;
    let nextPhysicsTaskIndex = 0;

    for (const day of scheduleShell) {
        if (day.isRestDay) continue;
        workdayCounter++;
        let availableTime = day.totalStudyTimeMinutes;

        // Schedule interleaved physics first
        if (isCramPhysicsInterleaved && (workdayCounter % physicsFrequency === 0) && nextPhysicsTaskIndex < physicsVideos.length && availableTime > 0) {
            let timeForPhysics = Math.min(physicsTimeSlot, availableTime);
            if (timeForPhysics >= MIN_DURATION_for_SPLIT_PART) {
                const taskToSchedule = physicsVideos[nextPhysicsTaskIndex];
                if (taskToSchedule.durationMinutes <= timeForPhysics) {
                    day.tasks.push(mapResourceToTask(taskToSchedule, day.tasks.length));
                    availableTime -= taskToSchedule.durationMinutes;
                    nextPhysicsTaskIndex++;
                } else {
                    const split = splitTask(taskToSchedule, timeForPhysics);
                    if (split) {
                        day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                        availableTime -= split.part1.durationMinutes;
                        physicsVideos[nextPhysicsTaskIndex] = split.part2;
                    }
                }
            }
        }

        // Schedule remaining tasks
        while (availableTime > 0 && allTasksToSchedule.length > 0) {
            const taskToSchedule = allTasksToSchedule[0];
            if (taskToSchedule.durationMinutes <= availableTime) {
                day.tasks.push(mapResourceToTask(taskToSchedule, day.tasks.length));
                availableTime -= taskToSchedule.durationMinutes;
                allTasksToSchedule.shift();
            } else {
                if (!taskToSchedule.isSplittable || availableTime < MIN_DURATION_for_SPLIT_PART) break;
                const split = splitTask(taskToSchedule, availableTime);
                if (split) {
                    day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                    availableTime -= split.part1.durationMinutes;
                    allTasksToSchedule[0] = split.part2;
                } else break;
            }
        }
    }
};


const runSchedulingEngine = (
    scheduleShell: DailySchedule[], 
    resourcePool: StudyResource[], 
    planConfig: {
        topicOrder: Domain[],
        cramTopicOrder: Domain[],
        isPhysicsInTopicOrder: boolean,
        isCramModeActive?: boolean,
        isCramPhysicsInterleaved: boolean
    },
    options?: RebalanceOptions
) => {
    if (planConfig.isCramModeActive) {
        runCramModeScheduling(scheduleShell, resourcePool, planConfig.cramTopicOrder, planConfig.isCramPhysicsInterleaved);
        return;
    }

    const { topicOrder, isPhysicsInTopicOrder } = planConfig;
    
    // --- 1. RESOURCE PREPARATION ---
    const primaryPhysicsResources = sortResources(resourcePool.filter(r => r.isPrimaryMaterial && r.domain === Domain.PHYSICS));
    let blocksToSchedule = createDomainBlocks(resourcePool, topicOrder, isPhysicsInTopicOrder);
    
    const secondaryResources = sortResources(resourcePool.filter(r => !r.isPrimaryMaterial && r.domain !== Domain.FINAL_REVIEW));
    
    // Split question banks into prioritized pools
    const allQuestionTasks = secondaryResources.filter(r => r.type === ResourceType.QUESTIONS);
    const qevlarQuestionTasks = allQuestionTasks.filter(r => r.bookSource === 'QEVLAR');
    const boardVitalsQuestionTasks = allQuestionTasks.filter(r => r.bookSource === 'Board Vitals');
    const otherQuestionTasks = allQuestionTasks.filter(r => r.bookSource !== 'QEVLAR' && r.bookSource !== 'Board Vitals');

    const reviewTasks = secondaryResources.filter(r => r.type === ResourceType.QUESTION_REVIEW);
    const otherSecondaryResources = secondaryResources.filter(r => r.type !== ResourceType.QUESTIONS && r.type !== ResourceType.QUESTION_REVIEW);
    const reviewTaskMap = new Map(reviewTasks.map(t => [t.pairedResourceIds?.[0], t]).filter((pair): pair is [string, StudyResource] => pair[0] !== undefined));

    const finalReviewResources = sortResources(resourcePool.filter(r => r.domain === Domain.FINAL_REVIEW));
    
    if (options?.type === 'topic-time') {
        const priorityTopics = options.topics;
        blocksToSchedule = [
            ...blocksToSchedule.filter(b => priorityTopics.includes(b.domain)),
            ...blocksToSchedule.filter(b => !priorityTopics.includes(b.domain)),
        ];
    }
    
    let nextPhysicsTaskIndex = 0;
    let workdayCounter = 0;
    const physicsFrequency = 2;
    const physicsTimeSlot = 60;
    let qBankCycleCounter = 0; // Counter for QBank split

    // --- 2. PASS 1: PRIMARY & MANDATORY CONTENT ---
    for (const day of scheduleShell) {
        if (day.isRestDay || day.dayType === 'final-review') continue;
        
        workdayCounter++;

        if (options?.type === 'topic-time' && day.date === options.date) {
            day.totalStudyTimeMinutes = options.totalTimeMinutes;
        }

        // --- "RESERVE-FIRST" LOGIC FOR Q&R ---
        let qBankPoolToUse: StudyResource[];
        // Use a 5-cycle counter for a 60/40 QEVLAR/Board Vitals split.
        // On the 4th and 5th cycles (indices 3, 4), try to use Board Vitals.
        if (qBankCycleCounter % 5 >= 3) {
            // This is for Board Vitals (40% share)
            qBankPoolToUse = boardVitalsQuestionTasks.length > 0 ? boardVitalsQuestionTasks : qevlarQuestionTasks;
        } else {
            // This is for QEVLAR (60% share)
            qBankPoolToUse = qevlarQuestionTasks.length > 0 ? qevlarQuestionTasks : boardVitalsQuestionTasks;
        }
        // If both prioritized pools are empty, fall back to other question banks.
        if (qBankPoolToUse.length === 0) {
            qBankPoolToUse = otherQuestionTasks;
        }

        let reservedQandR: { qTask: StudyResource, reviewTask: StudyResource, duration: number, pool: StudyResource[], index: number } | null = null;
        
        if (qBankPoolToUse.length > 0) {
            const nextTopic = blocksToSchedule.length > 0 && blocksToSchedule[0].tasks.length > 0 ? blocksToSchedule[0].domain : null;
            let foundIndex = -1;
            if (nextTopic) {
                foundIndex = qBankPoolToUse.findIndex(q => q.domain === nextTopic);
            }
            if (foundIndex === -1 && qBankPoolToUse.length > 0) {
                foundIndex = 0; // Fallback to the first available in the chosen pool
            }
            
            if (foundIndex !== -1) {
                const qTask = qBankPoolToUse[foundIndex];
                const reviewTask = reviewTaskMap.get(qTask.id);
                if (qTask && reviewTask) {
                    reservedQandR = {
                        qTask, reviewTask,
                        duration: qTask.durationMinutes + reviewTask.durationMinutes,
                        pool: qBankPoolToUse, // Keep track of the source pool
                        index: foundIndex,
                    };
                }
            }
        }
        
        let timeForPrimaryContent = day.totalStudyTimeMinutes;

        if (reservedQandR) {
            const dayOfWeek = new Date(day.date + 'T00:00:00').getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const overflowAllowance = isWeekend ? WEEKEND_QUESTION_BLOCK_OVERFLOW_MINUTES : WEEKDAY_QUESTION_BLOCK_OVERFLOW_MINUTES;
            
            const effectiveTimeForPrimary = day.totalStudyTimeMinutes - reservedQandR.duration;
            if (effectiveTimeForPrimary < 0 && Math.abs(effectiveTimeForPrimary) > overflowAllowance) {
                reservedQandR = null; // Can't fit, even with overflow.
            } else {
                timeForPrimaryContent = Math.max(0, effectiveTimeForPrimary);
            }
        }
        
        let availableTime = timeForPrimaryContent;

        // A. Interleaved Physics...
        if (!isPhysicsInTopicOrder && (workdayCounter % physicsFrequency === 0) && nextPhysicsTaskIndex < primaryPhysicsResources.length && availableTime > 0) {
            let timeForPhysics = Math.min(physicsTimeSlot, availableTime);
            if (timeForPhysics >= MIN_DURATION_for_SPLIT_PART) {
                const taskToSchedule = primaryPhysicsResources[nextPhysicsTaskIndex];
                if (taskToSchedule.durationMinutes <= timeForPhysics) {
                    day.tasks.push(mapResourceToTask(taskToSchedule, day.tasks.length));
                    availableTime -= taskToSchedule.durationMinutes;
                    nextPhysicsTaskIndex++;
                } else {
                    const split = splitTask(taskToSchedule, timeForPhysics);
                    if (split) {
                        day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                        availableTime -= split.part1.durationMinutes;
                        primaryPhysicsResources[nextPhysicsTaskIndex] = split.part2;
                    }
                }
            }
        }
        
        // B. Schedule primary content from blocks...
        while (availableTime >= MIN_DURATION_for_SPLIT_PART && blocksToSchedule.length > 0) {
            const currentBlock = blocksToSchedule[0];
            if (currentBlock.tasks.length === 0) {
                blocksToSchedule.shift();
                continue;
            }
            const taskToSchedule = currentBlock.tasks[0];
            if (taskToSchedule.durationMinutes <= availableTime) {
                day.tasks.push(mapResourceToTask(taskToSchedule, day.tasks.length));
                availableTime -= taskToSchedule.durationMinutes;
                currentBlock.tasks.shift();
            } else {
                const split = splitTask(taskToSchedule, availableTime);
                if (split) {
                    day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                    availableTime -= split.part1.durationMinutes;
                    currentBlock.tasks[0] = split.part2;
                }
                break; 
            }
        }

        // C. Add reserved Q&A block at the end
        if (reservedQandR) {
            day.tasks.push(mapResourceToTask(reservedQandR.qTask, day.tasks.length));
            day.tasks.push(mapResourceToTask(reservedQandR.reviewTask, day.tasks.length));
            // Remove from the correct source pool
            reservedQandR.pool.splice(reservedQandR.index, 1);
            reviewTaskMap.delete(reservedQandR.qTask.id);

            // Only increment the counter for the prioritized banks
            if (reservedQandR.qTask.bookSource === 'QEVLAR' || reservedQandR.qTask.bookSource === 'Board Vitals') {
                qBankCycleCounter++;
            }
        }
    }

    // --- 3. PASS 2: SECONDARY FILLER LOOP ---
    for (const day of scheduleShell) {
        if (day.isRestDay || day.dayType === 'final-review') continue;

        let availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

        while (availableTime >= MIN_DURATION_for_SPLIT_PART && otherSecondaryResources.length > 0) {
            const taskIndex = otherSecondaryResources.findIndex(t => t.durationMinutes <= availableTime);
            if (taskIndex !== -1) {
                const task = otherSecondaryResources.splice(taskIndex, 1)[0];
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                availableTime -= task.durationMinutes;
            } else {
                // To avoid getting stuck, try splitting the smallest available task
                const smallestTask = otherSecondaryResources.reduce((min, curr) => curr.durationMinutes < min.durationMinutes ? curr : min, otherSecondaryResources[0]);
                const split = splitTask(smallestTask, availableTime);
                if (split) {
                    day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                    availableTime -= split.part1.durationMinutes;
                    const originalIndex = otherSecondaryResources.findIndex(t => t.id === smallestTask.id);
                    if (originalIndex !== -1) {
                        otherSecondaryResources[originalIndex] = split.part2;
                    }
                }
                break; 
            }
        }
    }

    // --- 4. FINAL REVIEW AND CLEANUP ---
    let finalReviewTaskIndex = 0;
    for (const day of scheduleShell) {
        if (day.dayType !== 'final-review' || finalReviewTaskIndex >= finalReviewResources.length) continue;
        
        let availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
        
        while(availableTime >= MIN_DURATION_for_SPLIT_PART && finalReviewTaskIndex < finalReviewResources.length) {
            const task = finalReviewResources[finalReviewTaskIndex];
            if(task.durationMinutes <= availableTime) {
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                availableTime -= task.durationMinutes;
                finalReviewTaskIndex++;
            } else {
                const split = splitTask(task, availableTime);
                if(split){
                    day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                    availableTime -= split.part1.durationMinutes;
                    finalReviewResources[finalReviewTaskIndex] = split.part2;
                }
                break;
            }
        }
    }
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
    
    const getScheduleWeekIndex = (currentDate: Date, start: Date): number => {
        const startDayOfWeek = start.getDay();
        const diffTime = currentDate.getTime() - start.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return Math.floor((diffDays + startDayOfWeek) / 7);
    };

    const daysByWeek: Record<number, { date: string, dayOfWeek: number }[]> = {};
    while (currentDateIter <= endDate) {
        const weekIndex = getScheduleWeekIndex(currentDateIter, startDate);
        if (!daysByWeek[weekIndex]) {
            daysByWeek[weekIndex] = [];
        }
        daysByWeek[weekIndex].push({
            date: currentDateIter.toISOString().split('T')[0],
            dayOfWeek: currentDateIter.getDay()
        });
        currentDateIter.setDate(currentDateIter.getDate() + 1);
    }

    const sortedWeekIndexes = Object.keys(daysByWeek).map(Number).sort((a,b)=>a-b);
    let useSaturdayForNextWeekendRest = false;

    sortedWeekIndexes.forEach((weekIndex) => {
        const weekDays = daysByWeek[weekIndex];
        const hasExistingRestDay = weekDays.some(day => finalExceptionMap.get(day.date)?.isRestDayOverride);

        if (hasExistingRestDay) {
            if (weekIndex % 2 === 0) {
                 useSaturdayForNextWeekendRest = !useSaturdayForNextWeekendRest;
            }
            return;
        }

        const isWeekendRestWeek = weekIndex % 2 === 0;

        if (isWeekendRestWeek) {
            const dayToMakeRest = useSaturdayForNextWeekendRest
                ? weekDays.find(d => d.dayOfWeek === 6)
                : weekDays.find(d => d.dayOfWeek === 0);

            if (dayToMakeRest && !finalExceptionMap.has(dayToMakeRest.date)) {
                 finalExceptionMap.set(dayToMakeRest.date, {
                    date: dayToMakeRest.date,
                    dayType: 'rest-exception',
                    isRestDayOverride: true,
                    targetMinutes: 0
                 });
                 useSaturdayForNextWeekendRest = !useSaturdayForNextWeekendRest;
            }
        } else {
            const wednesday = weekDays.find(d => d.dayOfWeek === 3);
            if (wednesday && !finalExceptionMap.has(wednesday.date)) {
                finalExceptionMap.set(wednesday.date, {
                    date: wednesday.date,
                    dayType: 'rest-exception',
                    isRestDayOverride: true,
                    targetMinutes: 0
                });
            }
        }
    });

    currentDateIter = new Date(startDate);
    while (currentDateIter <= endDate) {
        const dateStr = currentDateIter.toISOString().split('T')[0];
        const dayOfWeek = currentDateIter.getDay();
        const exceptionRule = finalExceptionMap.get(dateStr);
        
        let isRestDay = false;
        let dayType: DailySchedule['dayType'] = 'workday';
        let timeBudget = 0;

        if (exceptionRule) {
            isRestDay = !!exceptionRule.isRestDayOverride;
            dayType = exceptionRule.dayType;
            timeBudget = isRestDay ? 0 : (exceptionRule.targetMinutes ?? DEFAULT_CONSTRAINTS.dailyTimeBudgetRangeWorkday[1]);
        } else {
            const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6;
            timeBudget = isWeekendDay ? DEFAULT_CONSTRAINTS.dailyTimeBudgetRangeWeekend[1] : DEFAULT_CONSTRAINTS.dailyTimeBudgetRangeWorkday[1];
            dayType = isWeekendDay ? 'high-capacity' : 'workday';
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
    currentIsPhysicsInTopicOrder?: boolean
): GeneratedStudyPlanOutcome => {
    console.log("[Scheduler Engine] Starting initial schedule generation.");
    const schedulingPool = JSON.parse(JSON.stringify(masterResourcePool.filter(r => !r.isArchived)));
    
    const planConfig = {
        topicOrder: currentTopicOrder || DEFAULT_TOPIC_ORDER,
        cramTopicOrder: currentTopicOrder || DEFAULT_TOPIC_ORDER,
        isPhysicsInTopicOrder: currentIsPhysicsInTopicOrder ?? false,
        isCramModeActive: false,
        isCramPhysicsInterleaved: true,
    };

    const schedule = createScheduleShell(STUDY_START_DATE, STUDY_END_DATE, userAddedExceptions);

    runSchedulingEngine(schedule, schedulingPool, planConfig);

    schedule.forEach(day => {
        day.totalStudyTimeMinutes = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
    });

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
        isPhysicsInTopicOrder: planConfig.isPhysicsInTopicOrder,
        isCramModeActive: planConfig.isCramModeActive,
        isCramPhysicsInterleaved: planConfig.isCramPhysicsInterleaved,
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

    return { plan };
};


export const rebalanceSchedule = (
    currentPlan: StudyPlan, 
    options: RebalanceOptions, 
    userAddedExceptions: ExceptionDateRule[],
    masterResourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    console.log("[Scheduler Engine] Rebalancing schedule with options:", options);
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    
    const rebalanceStartDate = new Date().toISOString().split('T')[0];
    const completedResourceIds = new Set<string>();

    // Create a new past schedule containing ONLY completed tasks from the past.
    // All pending tasks from the past will be implicitly put back into the scheduling pool.
    const pastScheduleWithCompletedTasksOnly = currentPlan.schedule
        .filter(day => day.date < rebalanceStartDate)
        .map(day => {
            const completedTasks = day.tasks.filter(task => {
                if (task.status === 'completed') {
                    completedResourceIds.add(task.originalResourceId || task.resourceId);
                    return true;
                }
                return false;
            });
            // Update the day's total time to reflect only completed tasks
            const newTotalTime = completedTasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            return { ...day, tasks: completedTasks, totalStudyTimeMinutes: newTotalTime };
        });

    // The pool for future scheduling should contain all active resources that have NOT been completed.
    const schedulingPool = JSON.parse(JSON.stringify(
        activeResources.filter(res => !completedResourceIds.has(res.id))
    ));
    
    // Create a fresh shell for the future part of the schedule.
    const futureScheduleShell = createScheduleShell(rebalanceStartDate, currentPlan.endDate, userAddedExceptions);
    
    const planConfig = {
        topicOrder: currentPlan.topicOrder,
        cramTopicOrder: currentPlan.cramTopicOrder,
        isPhysicsInTopicOrder: currentPlan.isPhysicsInTopicOrder,
        isCramModeActive: currentPlan.isCramModeActive,
        isCramPhysicsInterleaved: currentPlan.isCramPhysicsInterleaved,
    };
    
    runSchedulingEngine(futureScheduleShell, schedulingPool, planConfig, options);
    
    futureScheduleShell.forEach(day => {
        day.totalStudyTimeMinutes = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        day.isManuallyModified = false; 
    });
    
    const finalSchedule = [...pastScheduleWithCompletedTasksOnly, ...futureScheduleShell];
    
    const finalPlan: StudyPlan = {
        ...currentPlan,
        schedule: finalSchedule,
        progressPerDomain: {}
    };
    
    // Recalculate progress stats from scratch based on the new final schedule.
    activeResources.forEach(resource => {
        const domain = resource.domain;
        if (!finalPlan.progressPerDomain[domain]) {
            finalPlan.progressPerDomain[domain] = { completedMinutes: 0, totalMinutes: 0 };
        }
        finalPlan.progressPerDomain[domain]!.totalMinutes += resource.durationMinutes;
    });

    finalSchedule.forEach(day => {
        day.tasks.forEach(task => {
            if (task.status === 'completed') {
                const domain = task.originalTopic;
                if (finalPlan.progressPerDomain[domain]) {
                    finalPlan.progressPerDomain[domain]!.completedMinutes += task.durationMinutes;
                }
            }
        });
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

    return { plan: finalPlan };
};