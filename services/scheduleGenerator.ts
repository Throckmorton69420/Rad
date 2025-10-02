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
    planConfig: Partial<StudyPlan>,
    options?: RebalanceOptions
): GeneratedStudyPlanOutcome['notifications'] => {
    
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    const { deadlines = {}, isCramModeActive, cramTopicOrder = [], isCramPhysicsInterleaved, topicOrder = [], isPhysicsInTopicOrder } = planConfig;

    if (isCramModeActive) {
        runCramModeScheduling(scheduleShell, resourcePool, cramTopicOrder, !!isCramPhysicsInterleaved);
        return notifications;
    }

    // --- 1. BUDGET ADJUSTMENT PASS based on deadlines ---
    const primaryResources = resourcePool.filter(r => r.isPrimaryMaterial);
    const jobs: { category: string, resources: StudyResource[], deadline?: string }[] = [
        { category: 'physics', resources: primaryResources.filter(r => r.domain === Domain.PHYSICS), deadline: deadlines.physicsContent },
        { category: 'nucMed', resources: primaryResources.filter(r => r.domain === Domain.NUCLEAR_MEDICINE), deadline: deadlines.nucMedContent },
        { category: 'other', resources: primaryResources.filter(r => r.domain !== Domain.PHYSICS && r.domain !== Domain.NUCLEAR_MEDICINE), deadline: deadlines.otherContent }
    ];
    if (deadlines.allContent) {
        jobs.push({ category: 'all', resources: primaryResources, deadline: deadlines.allContent });
    }

    const todayStr = getTodayInNewYork();
    for (const job of jobs.filter(j => j.deadline)) {
        const totalMinutes = job.resources.reduce((sum, r) => sum + r.durationMinutes, 0);
        const availableDays = scheduleShell.filter(d => d.date >= todayStr && d.date <= job.deadline! && !d.isRestDay);
        if (availableDays.length === 0) continue;

        const currentBudget = availableDays.reduce((sum, d) => sum + d.totalStudyTimeMinutes, 0);
        const deficit = totalMinutes - currentBudget;

        if (deficit > 0) {
            const extraMinutesPerDay = Math.ceil(deficit / availableDays.length);
            notifications.push({ type: 'warning', message: `To meet the ${job.category} deadline, daily study time for the period was increased by ~${Math.round(extraMinutesPerDay)} minutes.` });
            availableDays.forEach(day => {
                day.totalStudyTimeMinutes += extraMinutesPerDay;
            });
        }
    }

    // --- 2. TASK SCHEDULING PASS ---
    // A. Categorize remaining resources
    const allQuestionTasks = resourcePool.filter(r => r.type === ResourceType.QUESTIONS);
    const reviewTasks = resourcePool.filter(r => r.type === ResourceType.QUESTION_REVIEW);
    const otherSecondaryResources = sortResources(resourcePool.filter(r => !r.isPrimaryMaterial && r.type !== ResourceType.QUESTIONS && r.type !== ResourceType.QUESTION_REVIEW));
    const reviewTaskMap = new Map(reviewTasks.map(t => [t.pairedResourceIds?.[0], t]).filter((pair): pair is [string, StudyResource] => pair[0] !== undefined));
    const finalReviewResources = sortResources(resourcePool.filter(r => r.domain === Domain.FINAL_REVIEW));

    // B. Create a unified, prioritized list of primary tasks
    const getDeadline = (resource: StudyResource): string => {
        if (deadlines.allContent) return deadlines.allContent;
        if (resource.domain === Domain.PHYSICS && deadlines.physicsContent) return deadlines.physicsContent;
        if (resource.domain === Domain.NUCLEAR_MEDICINE && deadlines.nucMedContent) return deadlines.nucMedContent;
        if (resource.domain !== Domain.PHYSICS && resource.domain !== Domain.NUCLEAR_MEDICINE && deadlines.otherContent) return deadlines.otherContent;
        return '9999-12-31'; // No specific deadline, sort to the end
    };
    
    const primaryTasksToSchedule = sortResources(primaryResources).sort((a, b) => {
        const deadlineA = getDeadline(a);
        const deadlineB = getDeadline(b);
        if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB);
        // Fallback to topic order if deadlines are the same or not set
        const topicIndexA = topicOrder.indexOf(a.domain);
        const topicIndexB = topicOrder.indexOf(b.domain);
        if (topicIndexA !== topicIndexB) return (topicIndexA === -1 ? Infinity : topicIndexA) - (topicIndexB === -1 ? Infinity : topicIndexB);
        return (a.sequenceOrder ?? Infinity) - (b.sequenceOrder ?? Infinity);
    });

    // C. Schedule day by day
    for (const day of scheduleShell) {
        if (day.isRestDay || day.dayType === 'final-review') continue;

        let availableTime = day.totalStudyTimeMinutes;

        // Fill with primary tasks first
        while (availableTime >= MIN_DURATION_for_SPLIT_PART && primaryTasksToSchedule.length > 0) {
            const task = primaryTasksToSchedule[0];
            if (task.durationMinutes <= availableTime) {
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                availableTime -= task.durationMinutes;
                primaryTasksToSchedule.shift();
            } else {
                const split = splitTask(task, availableTime);
                if (split) {
                    day.tasks.push(mapResourceToTask(split.part1, day.tasks.length));
                    availableTime -= split.part1.durationMinutes;
                    primaryTasksToSchedule[0] = split.part2;
                }
                break;
            }
        }
        
        // Fill remaining time with other tasks (Q&A, secondary)
        // (Simplified logic for now, can be enhanced with better Q&A pairing)
         while (availableTime >= MIN_DURATION_for_SPLIT_PART && allQuestionTasks.length > 0) {
            const task = allQuestionTasks[0];
            const review = reviewTaskMap.get(task.id);
            const blockDuration = task.durationMinutes + (review?.durationMinutes || 0);

            if (blockDuration <= availableTime) {
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                if (review) day.tasks.push(mapResourceToTask(review, day.tasks.length));
                availableTime -= blockDuration;
                allQuestionTasks.shift();
                if(review) reviewTaskMap.delete(task.id);
            } else {
                break; // Don't split question blocks for simplicity
            }
        }
         while (availableTime >= MIN_DURATION_for_SPLIT_PART && otherSecondaryResources.length > 0) {
            const task = otherSecondaryResources[0];
             if (task.durationMinutes <= availableTime) {
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                availableTime -= task.durationMinutes;
                otherSecondaryResources.shift();
            } else break;
        }
    }
    
    // --- 3. FINAL REVIEW and CLEANUP ---
    let finalReviewTaskIndex = 0;
    for (const day of scheduleShell) {
        // Trim day's total time to match actual scheduled content
        day.totalStudyTimeMinutes = day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);

        if (day.dayType !== 'final-review' || finalReviewTaskIndex >= finalReviewResources.length) continue;
        
        let availableTime = DEFAULT_CONSTRAINTS.dailyTimeBudget[1] - day.totalStudyTimeMinutes;
        
        while(availableTime >= MIN_DURATION_for_SPLIT_PART && finalReviewTaskIndex < finalReviewResources.length) {
            const task = finalReviewResources[finalReviewTaskIndex];
            if(task.durationMinutes <= availableTime) {
                day.tasks.push(mapResourceToTask(task, day.tasks.length));
                availableTime -= task.durationMinutes;
                day.totalStudyTimeMinutes += task.durationMinutes;
                finalReviewTaskIndex++;
            } else break;
        }
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
    currentIsPhysicsInTopicOrder?: boolean,
    deadlines?: DeadlineSettings
): GeneratedStudyPlanOutcome => {
    console.log("[Scheduler Engine] Starting initial schedule generation.");
    const schedulingPool = JSON.parse(JSON.stringify(masterResourcePool.filter(r => !r.isArchived)));
    
    const planConfig = {
        topicOrder: currentTopicOrder || DEFAULT_TOPIC_ORDER,
        cramTopicOrder: currentTopicOrder || DEFAULT_TOPIC_ORDER,
        isPhysicsInTopicOrder: currentIsPhysicsInTopicOrder ?? false,
        isCramModeActive: false,
        isCramPhysicsInterleaved: true,
        deadlines: deadlines || {},
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
        isPhysicsInTopicOrder: planConfig.isPhysicsInTopicOrder,
        isCramModeActive: planConfig.isCramModeActive,
        isCramPhysicsInterleaved: planConfig.isCramPhysicsInterleaved,
        deadlines: planConfig.deadlines,
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
    console.log("[Scheduler Engine] Rebalancing schedule with options:", options);
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    
    const rebalanceStartDate = getTodayInNewYork();
    const completedResourceIds = new Set<string>();

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
            const newTotalTime = completedTasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            return { ...day, tasks: completedTasks, totalStudyTimeMinutes: newTotalTime };
        });

    const schedulingPool = JSON.parse(JSON.stringify(
        activeResources.filter(res => !completedResourceIds.has(res.id))
    ));
    
    const futureScheduleShell = createScheduleShell(rebalanceStartDate, currentPlan.endDate, userAddedExceptions);
    
    const notifications = runSchedulingEngine(futureScheduleShell, schedulingPool, currentPlan, options);
    
    futureScheduleShell.forEach(day => {
        day.isManuallyModified = false; 
    });
    
    const finalSchedule = [...pastScheduleWithCompletedTasksOnly, ...futureScheduleShell];
    
    const finalPlan: StudyPlan = {
        ...currentPlan,
        schedule: finalSchedule,
        progressPerDomain: {}
    };
    
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

    return { plan: finalPlan, notifications };
};
