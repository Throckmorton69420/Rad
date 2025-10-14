// services/scheduleGenerator.ts

import { 
    StudyPlan, 
    DailySchedule, 
    ScheduledTask, 
    StudyResource, 
    Domain, 
    ResourceType,
    ExceptionDateRule,
    GeneratedStudyPlanOutcome,
    RebalanceOptions,
    DeadlineSettings,
} from '../types';
import { 
    DEFAULT_DAILY_STUDY_MINS,
    DEFAULT_TOPIC_ORDER,
    MAX_TASK_DURATION_BEFORE_SPLIT_CONSIDERATION,
    MIN_DURATION_for_SPLIT_PART,
    TASK_TYPE_PRIORITY,
} from '../constants';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';

// --- HELPER FUNCTIONS ---

const getDaysArray = (start: Date, end: Date): Date[] => {
    const arr = [];
    for(let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)){
        arr.push(new Date(dt));
    }
    return arr;
};

const formatDate = (date: Date): string => date.toISOString().split('T')[0];

const createInitialSchedule = (startDateStr: string, endDateStr: string, exceptionRules: ExceptionDateRule[]): DailySchedule[] => {
    const startDate = parseDateString(startDateStr);
    const endDate = parseDateString(endDateStr);
    const days = getDaysArray(startDate, endDate);
    const exceptionMap = new Map(exceptionRules.map(e => [e.date, e]));

    return days.map(day => {
        const dateStr = formatDate(day);
        const dayName = day.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
        
        const exception = exceptionMap.get(dateStr);
        if (exception) {
            return {
                date: dateStr,
                dayName,
                tasks: [],
                totalStudyTimeMinutes: exception.targetMinutes ?? 0,
                isRestDay: exception.isRestDayOverride,
                isManuallyModified: false,
            };
        }

        return {
            date: dateStr,
            dayName,
            tasks: [],
            totalStudyTimeMinutes: DEFAULT_DAILY_STUDY_MINS,
            isRestDay: false,
            isManuallyModified: false,
        };
    });
};

const splitResource = (resource: StudyResource): StudyResource[] => {
    if (!resource.isSplittable || resource.durationMinutes <= MAX_TASK_DURATION_BEFORE_SPLIT_CONSIDERATION) {
        return [resource];
    }
    
    const numParts = Math.ceil(resource.durationMinutes / (MAX_TASK_DURATION_BEFORE_SPLIT_CONSIDERATION * 0.8));
    const partDuration = Math.ceil(resource.durationMinutes / numParts);

    if (partDuration < MIN_DURATION_for_SPLIT_PART) {
        return [resource];
    }
    
    const parts: StudyResource[] = [];
    for (let i = 0; i < numParts; i++) {
        parts.push({
            ...resource,
            id: `${resource.id}_part_${i + 1}`,
            title: `${resource.title} (Part ${i + 1}/${numParts})`,
            durationMinutes: partDuration,
            isSplittable: false, // Parts are not further splittable
        });
    }
    return parts;
};

const createSchedulingQueue = (
    resources: StudyResource[], 
    topicOrder: Domain[], 
    areSpecialTopicsInterleaved: boolean
): StudyResource[] => {
    const primaryQueue: StudyResource[] = [];
    const specialTopics: { [key in Domain]?: StudyResource[] } = {
        [Domain.PHYSICS]: [],
        [Domain.NUCLEAR_MEDICINE]: [],
        [Domain.NIS]: [],
        [Domain.RISC]: [],
    };
    const supplementaryQueue: StudyResource[] = [];

    // Separate resources into queues
    resources.forEach(res => {
        if (res.domain in specialTopics) {
            specialTopics[res.domain as keyof typeof specialTopics]?.push(res);
        } else if (res.isPrimaryMaterial) {
            primaryQueue.push(res);
        } else {
            supplementaryQueue.push(res);
        }
    });

    // Sort queues
    const sortBySequenceAndPriority = (a: StudyResource, b: StudyResource) => 
        (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999) || 
        (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99) ||
        a.title.localeCompare(b.title);

    primaryQueue.sort(sortBySequenceAndPriority);
    Object.values(specialTopics).forEach(q => q?.sort(sortBySequenceAndPriority));
    supplementaryQueue.sort(sortBySequenceAndPriority);

    // Build final queue based on topic order
    let finalQueue: StudyResource[] = [];
    topicOrder.forEach(domain => {
        if (domain in specialTopics) {
            if (!areSpecialTopicsInterleaved) {
                finalQueue.push(...(specialTopics[domain as keyof typeof specialTopics] || []));
            }
        } else {
            finalQueue.push(...primaryQueue.filter(r => r.domain === domain));
        }
    });

    // Add remaining primary materials that might not have been in the topic order
    const scheduledPrimaryIds = new Set(finalQueue.map(r => r.id));
    primaryQueue.forEach(res => {
        if (!scheduledPrimaryIds.has(res.id)) {
            finalQueue.push(res);
        }
    });

    // If interleaving, create a separate queue
    const interleavedQueue = areSpecialTopicsInterleaved 
        ? [
            ...(specialTopics[Domain.PHYSICS] || []),
            ...(specialTopics[Domain.NUCLEAR_MEDICINE] || []),
            ...(specialTopics[Domain.NIS] || []),
            ...(specialTopics[Domain.RISC] || [])
          ].sort(sortBySequenceAndPriority)
        : [];
    
    // Add supplementary and interleaved tasks. Interleaved are handled separately by the scheduler.
    return [ ...finalQueue, ...supplementaryQueue, ...interleavedQueue ];
};

const convertResourceToTask = (resource: StudyResource, order: number): ScheduledTask => ({
    id: `${resource.id}_${Date.now()}_${Math.random()}`,
    resourceId: resource.id,
    originalResourceId: resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id,
    title: resource.title,
    type: resource.type,
    originalTopic: resource.domain,
    durationMinutes: resource.durationMinutes,
    status: 'pending',
    order,
    isOptional: resource.isOptional,
    isPrimaryMaterial: resource.isPrimaryMaterial,
    pages: resource.pages,
    startPage: resource.startPage,
    endPage: resource.endPage,
    caseCount: resource.caseCount,
    questionCount: resource.questionCount,
    chapterNumber: resource.chapterNumber,
    bookSource: resource.bookSource,
    videoSource: resource.videoSource,
});

const calculateProgress = (schedule: DailySchedule[]): StudyPlan['progressPerDomain'] => {
    const progress: StudyPlan['progressPerDomain'] = {};
    const allTasks = schedule.flatMap(d => d.tasks);

    // Initialize all domains to ensure they appear in progress report
    for (const domain of Object.values(Domain)) {
        progress[domain] = { completedMinutes: 0, totalMinutes: 0 };
    }

    allTasks.forEach(task => {
        const domain = task.originalTopic;
        if (!progress[domain]) {
            progress[domain] = { completedMinutes: 0, totalMinutes: 0 };
        }
        progress[domain]!.totalMinutes += task.durationMinutes;
        if (task.status === 'completed') {
            progress[domain]!.completedMinutes += task.durationMinutes;
        }
    });
    return progress;
};

// --- CORE SCHEDULING LOGIC ---

function runScheduling(
    schedule: DailySchedule[],
    resourceQueue: StudyResource[],
    areSpecialTopicsInterleaved: boolean
): DailySchedule[] {
    let taskQueue = [...resourceQueue];
    const interleavedDomains = [Domain.PHYSICS, Domain.NUCLEAR_MEDICINE, Domain.NIS, Domain.RISC];
    
    let interleavedTaskQueue = areSpecialTopicsInterleaved 
        ? taskQueue.filter(r => interleavedDomains.includes(r.domain))
        : [];
    taskQueue = areSpecialTopicsInterleaved 
        ? taskQueue.filter(r => !interleavedDomains.includes(r.domain))
        : taskQueue;

    const physicsFrequencyDays = 2; // From constraints, hardcoded for simplicity as per prompt
    let daysSinceLastPhysics = physicsFrequencyDays;

    for (const day of schedule) {
        if (day.isRestDay) continue;

        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        let order = day.tasks.length;

        // 1. Interleaved content (if enabled)
        if (areSpecialTopicsInterleaved) {
            daysSinceLastPhysics++;
            if (daysSinceLastPhysics >= physicsFrequencyDays && interleavedTaskQueue.length > 0) {
                const taskToSchedule = interleavedTaskQueue[0];
                if (remainingTime >= taskToSchedule.durationMinutes) {
                    day.tasks.push(convertResourceToTask(taskToSchedule, order++));
                    remainingTime -= taskToSchedule.durationMinutes;
                    interleavedTaskQueue.shift();
                    daysSinceLastPhysics = 0; // Reset counter
                }
            }
        }
        
        // 2. Main content
        while (remainingTime > 0 && taskQueue.length > 0) {
            const taskToSchedule = taskQueue[0];
            if (remainingTime >= taskToSchedule.durationMinutes) {
                day.tasks.push(convertResourceToTask(taskToSchedule, order++));
                remainingTime -= taskToSchedule.durationMinutes;
                taskQueue.shift();
            } else {
                break; // Not enough time for the next full task
            }
        }
    }

    return schedule;
}


// --- EXPORTED FUNCTIONS ---

export const generateInitialSchedule = (
    resourcePool: StudyResource[],
    exceptionRules: ExceptionDateRule[],
    topicOrder: Domain[] = DEFAULT_TOPIC_ORDER,
    deadlines: DeadlineSettings = {},
    startDateStr: string,
    endDateStr: string,
    areSpecialTopicsInterleaved: boolean = true
): GeneratedStudyPlanOutcome => {
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    
    // 1. Prepare resources
    const activeResources = resourcePool.filter(r => !r.isArchived);
    const splittedResources = activeResources.flatMap(splitResource);
    const schedulingQueue = createSchedulingQueue(splittedResources, topicOrder, areSpecialTopicsInterleaved);

    // 2. Create schedule scaffold
    let schedule = createInitialSchedule(startDateStr, endDateStr, exceptionRules);
    
    // 3. Run scheduling algorithm
    schedule = runScheduling(schedule, schedulingQueue, areSpecialTopicsInterleaved);

    // 4. Finalize plan
    const progress = calculateProgress(schedule);
    const plan: StudyPlan = {
        schedule,
        progressPerDomain: progress,
        startDate: startDateStr,
        endDate: endDateStr,
        firstPassEndDate: null, // Logic for this would be more complex, setting to null for now
        topicOrder,
        cramTopicOrder: topicOrder, // Default to same order
        deadlines,
        isCramModeActive: false,
        areSpecialTopicsInterleaved,
    };
    
    const scheduledResourceIds = new Set(schedule.flatMap(d => d.tasks.map(t => t.originalResourceId)));
    const unscheduledTasksCount = splittedResources.filter(r => !scheduledResourceIds.has(r.id)).length;

    if (unscheduledTasksCount > 0) {
        notifications.push({ type: 'warning', message: `${unscheduledTasksCount} tasks could not be scheduled. Consider increasing study time or extending the end date.`});
    }

    return { plan, notifications };
};

export const rebalanceSchedule = (
    currentPlan: StudyPlan,
    options: RebalanceOptions,
    exceptionRules: ExceptionDateRule[],
    resourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    const notifications: GeneratedStudyPlanOutcome['notifications'] = [];
    const rebalanceDateStr = options.type === 'standard' ? (options.rebalanceDate || getTodayInNewYork()) : options.date;

    // 1. Preserve past and gather future tasks
    const completedResourceIds = new Set<string>();
    const newSchedule: DailySchedule[] = [];

    currentPlan.schedule.forEach(day => {
        if (day.date < rebalanceDateStr) {
            newSchedule.push(day);
            day.tasks.forEach(task => {
                if (task.status === 'completed' && task.originalResourceId) {
                    completedResourceIds.add(task.originalResourceId);
                }
            });
        }
    });
    
    // 2. Prepare resources for re-scheduling
    const activeResources = resourcePool.filter(r => !r.isArchived && !completedResourceIds.has(r.id));
    const splittedResources = activeResources.flatMap(splitResource);
    const schedulingQueue = createSchedulingQueue(splittedResources, currentPlan.topicOrder, currentPlan.areSpecialTopicsInterleaved);

    // 3. Create future schedule scaffold
    const futureScheduleScaffold = createInitialSchedule(rebalanceDateStr, currentPlan.endDate, exceptionRules)
        .filter(d => d.date >= rebalanceDateStr);
    
    // If topic-time rebalance, modify the target day
    if (options.type === 'topic-time') {
        const targetDay = futureScheduleScaffold.find(d => d.date === options.date);
        if (targetDay) {
            targetDay.totalStudyTimeMinutes = options.totalTimeMinutes;
            targetDay.isManuallyModified = true;
            // A more complex implementation would pre-fill this day with the selected topics
        }
    }
    
    // 4. Run scheduling on the future part
    const futureSchedule = runScheduling(futureScheduleScaffold, schedulingQueue, currentPlan.areSpecialTopicsInterleaved);

    // 5. Combine and finalize
    const finalSchedule = [...newSchedule, ...futureSchedule];
    const progress = calculateProgress(finalSchedule);
    
    const updatedPlan: StudyPlan = {
        ...currentPlan,
        schedule: finalSchedule,
        progressPerDomain: progress,
    };
    
    const scheduledFutureResourceIds = new Set(futureSchedule.flatMap(d => d.tasks.map(t => t.originalResourceId)));
    const unscheduledTasksCount = splittedResources.filter(r => !scheduledFutureResourceIds.has(r.id)).length;

    if (unscheduledTasksCount > 0) {
        notifications.push({ type: 'warning', message: `${unscheduledTasksCount} future tasks could not be scheduled. Consider increasing study time.`});
    }

    return { plan: updatedPlan, notifications };
};
