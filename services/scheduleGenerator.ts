import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, GeneratedStudyPlanOutcome, DeadlineSettings, Domain, ScheduledTask, ResourceType, DailySchedule } from '../types';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { TASK_TYPE_PRIORITY } from '../constants';

/**
 * Calculates the real-world study duration for a resource based on its type and metrics.
 * This function applies the user-defined conversion factors.
 */
const calculateResourceDuration = (resource: StudyResource): number => {
  // This function is now internal and respects the original durationMinutes as the source of truth.
  return Math.round(resource.durationMinutes > 0 ? resource.durationMinutes : 1);
};

// Helper to create a task from a resource
const resourceToTask = (
  resource: StudyResource, 
  order: number, 
  duration?: number, 
  isOptionalOverride = false, 
  titleSuffix = ''
): ScheduledTask => {
    const calculatedDuration = calculateResourceDuration(resource);
    return {
        id: `${resource.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        resourceId: resource.id,
        originalResourceId: resource.id,
        title: resource.title + titleSuffix,
        type: resource.type,
        originalTopic: resource.domain,
        durationMinutes: duration ?? calculatedDuration,
        status: 'pending',
        order,
        isOptional: isOptionalOverride || !resource.isPrimaryMaterial,
        isPrimaryMaterial: resource.isPrimaryMaterial,
        pages: resource.pages,
        startPage: resource.startPage,
        endPage: resource.endPage,
        questionCount: resource.questionCount,
        caseCount: resource.caseCount,
        bookSource: resource.bookSource,
        videoSource: resource.videoSource,
        chapterNumber: resource.chapterNumber,
    };
};

interface TopicBlock {
    id: string;
    resources: StudyResource[];
    sortKey: string;
}

interface ScheduleState {
    schedule: DailySchedule[];
    scheduledResourceIds: Set<string>;
    resourceRemainders: Map<string, number>; // resourceId -> remainingMinutes
}

// Main function to schedule a queue of topic blocks
const scheduleTopicBlocks = (state: ScheduleState, blockQueue: TopicBlock[]) => {
    let dayIndex = 0;
    
    while (blockQueue.length > 0 && dayIndex < state.schedule.length) {
        const day = state.schedule[dayIndex];
        let availableTime = day.isRestDay ? 0 : day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);

        if (availableTime <= 10) { // Leave a small buffer, move to next day if not enough time
            dayIndex++;
            continue;
        }

        const block = blockQueue[0];
        
        const getDuration = (res: StudyResource) => state.resourceRemainders.get(res.id) ?? calculateResourceDuration(res);

        const resourcesInBlock = block.resources.filter(r => (state.resourceRemainders.get(r.id) ?? calculateResourceDuration(r)) > 0);
        if (resourcesInBlock.length === 0) {
            blockQueue.shift();
            continue;
        }

        const totalBlockDuration = resourcesInBlock.reduce((sum, res) => sum + getDuration(res), 0);

        if (totalBlockDuration <= availableTime) {
            // Block fits, schedule it all
            for (const resource of resourcesInBlock) {
                const duration = getDuration(resource);
                day.tasks.push(resourceToTask(resource, day.tasks.length, duration, false, state.resourceRemainders.has(resource.id) ? ' (Cont.)' : ''));
                state.scheduledResourceIds.add(resource.id);
                state.resourceRemainders.delete(resource.id);
            }
            blockQueue.shift(); // Move to the next block
        } else {
            // Block doesn't fit, chunk it
            const nonSplittable = resourcesInBlock.filter(r => !r.isSplittable);
            const splittable = resourcesInBlock.filter(r => r.isSplittable);
            
            const nonSplittableDuration = nonSplittable.reduce((sum, r) => sum + getDuration(r), 0);

            if (nonSplittableDuration > availableTime) {
                dayIndex++; // Can't even fit required parts, try next day
                continue;
            }

            // Schedule non-splittable parts
            for (const resource of nonSplittable) {
                const duration = getDuration(resource);
                day.tasks.push(resourceToTask(resource, day.tasks.length, duration, false, state.resourceRemainders.has(resource.id) ? ' (Cont.)' : ''));
                state.scheduledResourceIds.add(resource.id);
                state.resourceRemainders.delete(resource.id);
            }

            let timeForSplittables = availableTime - nonSplittableDuration;
            const totalSplittableDuration = splittable.reduce((sum, r) => sum + getDuration(r), 0);
            
            if (timeForSplittables > 0 && totalSplittableDuration > 0) {
                 for (const resource of splittable) {
                    const remainingDuration = getDuration(resource);
                    const proportion = remainingDuration / totalSplittableDuration;
                    const timeToScheduleThisDay = Math.floor(proportion * timeForSplittables);

                    if (timeToScheduleThisDay > 0) {
                        const suffix = state.resourceRemainders.has(resource.id) ? ' (Cont.)' : ' (Part 1)';
                        day.tasks.push(resourceToTask(resource, day.tasks.length, timeToScheduleThisDay, false, suffix));
                        
                        const newRemaining = remainingDuration - timeToScheduleThisDay;
                        if (newRemaining > 1) { // Only keep remainder if it's more than a minute
                            state.resourceRemainders.set(resource.id, newRemaining);
                        } else {
                            state.scheduledResourceIds.add(resource.id);
                            state.resourceRemainders.delete(resource.id);
                        }
                    }
                }
            }
            // Block remains at the front of the queue, move to next day to schedule its remainder
            dayIndex++;
        }
    }
};

const scheduleFillerResources = (state: ScheduleState, resources: StudyResource[]) => {
    const sortedResources = resources.sort((a,b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99));

    for (const resource of sortedResources) {
        if (state.scheduledResourceIds.has(resource.id)) continue;
        
        let durationToSchedule = calculateResourceDuration(resource);

        for (const day of state.schedule) {
            if (day.isRestDay || durationToSchedule <= 0) continue;

            const availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            if (availableTime <= 0) continue;

            const timeToScheduleThisDay = Math.min(durationToSchedule, availableTime);

            if (timeToScheduleThisDay > 0) {
                if (!resource.isSplittable || durationToSchedule <= availableTime) {
                    day.tasks.push(resourceToTask(resource, day.tasks.length, durationToSchedule, !resource.isPrimaryMaterial));
                    durationToSchedule = 0;
                    state.scheduledResourceIds.add(resource.id);
                    break;
                } else {
                    day.tasks.push(resourceToTask(resource, day.tasks.length, timeToScheduleThisDay, !resource.isPrimaryMaterial, " (Part)"));
                    durationToSchedule -= timeToScheduleThisDay;
                }
            }
        }
    }
};


export const generateInitialSchedule = (
  masterResourcePool: StudyResource[],
  exceptionDates: ExceptionDateRule[],
  topicOrder: Domain[] = [],
  deadlines: DeadlineSettings = {},
  startDate: string,
  endDate: string
): GeneratedStudyPlanOutcome => {
    
    // --- 1. INITIAL SETUP ---
    const notifications: { type: 'error' | 'warning' | 'info'; message: string }[] = [];
    const exceptionMap = new Map(exceptionDates.map(e => [e.date, e]));
    const schedule: DailySchedule[] = [];
    
    let currentDate = parseDateString(startDate);
    const finalDate = parseDateString(endDate);

    while (currentDate <= finalDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const exception = exceptionMap.get(dateStr);
        const isRestDay = exception ? exception.isRestDayOverride : false;
        
        schedule.push({
            date: dateStr,
            dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
            tasks: [],
            totalStudyTimeMinutes: isRestDay ? 0 : (exception?.targetMinutes ?? 14 * 60),
            isRestDay: isRestDay,
            isManuallyModified: false,
        });
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    // --- 2. RESOURCE GROUPING ---
    const activeResources = masterResourcePool.filter(r => !r.isArchived);
    const resourceMap = new Map(activeResources.map(r => [r.id, r]));
    const childrenIds = new Set(activeResources.flatMap(r => r.pairedResourceIds || []));

    // Anchors are primary materials that are not themselves paired to another resource
    const anchors = activeResources.filter(r => r.isPrimaryMaterial && !childrenIds.has(r.id));
    
    const topicBlocks: TopicBlock[] = [];
    const resourcesInBlocks = new Set<string>();

    for (const anchor of anchors) {
        if (resourcesInBlocks.has(anchor.id)) continue;
        
        const block: TopicBlock = {
            id: anchor.id,
            resources: [anchor],
            sortKey: `${String(topicOrder.indexOf(anchor.domain)).padStart(2,'0')}_${String(anchor.sequenceOrder ?? 9999).padStart(4,'0')}`
        };
        resourcesInBlocks.add(anchor.id);

        const queue = [...(anchor.pairedResourceIds || [])];
        const visitedInBlock = new Set(queue);
        visitedInBlock.add(anchor.id);

        while(queue.length > 0) {
            const resourceId = queue.shift()!;
            const resource = resourceMap.get(resourceId);

            if (resource && resource.isPrimaryMaterial && !resourcesInBlocks.has(resourceId)) {
                block.resources.push(resource);
                resourcesInBlocks.add(resourceId);
                (resource.pairedResourceIds || []).forEach(nextId => {
                    if (!visitedInBlock.has(nextId)) {
                        visitedInBlock.add(nextId);
                        queue.push(nextId);
                    }
                });
            }
        }
        topicBlocks.push(block);
    }
    
    // Any remaining primary materials become their own blocks
    const standalonePrimary = activeResources.filter(r => r.isPrimaryMaterial && !resourcesInBlocks.has(r.id));
    standalonePrimary.forEach(r => {
        topicBlocks.push({
            id: r.id,
            resources: [r],
            sortKey: `${String(topicOrder.indexOf(r.domain)).padStart(2,'0')}_${String(r.sequenceOrder ?? 9999).padStart(4,'0')}`
        });
        resourcesInBlocks.add(r.id);
    });

    topicBlocks.sort((a,b) => a.sortKey.localeCompare(b.sortKey));
    
    // --- 3. SCHEDULING ---
    const state: ScheduleState = {
        schedule,
        scheduledResourceIds: new Set<string>(),
        resourceRemainders: new Map<string, number>()
    };

    scheduleTopicBlocks(state, topicBlocks);

    // Schedule remaining optional resources
    const fillerResources = activeResources.filter(r => !resourcesInBlocks.has(r.id));
    scheduleFillerResources(state, fillerResources);

    // --- 4. FINALIZATION ---
    state.schedule.forEach(day => {
        day.tasks.sort((a, b) => {
            const priorityA = TASK_TYPE_PRIORITY[a.type] || 99;
            const priorityB = TASK_TYPE_PRIORITY[b.type] || 99;
            if (priorityA !== priorityB) return priorityA - priorityB;
            return a.order - b.order;
        });
        day.tasks.forEach((task, index) => task.order = index);
    });

    const unscheduledPrimary = activeResources.filter(r => r.isPrimaryMaterial && !state.scheduledResourceIds.has(r.id));
    if (unscheduledPrimary.length > 0) {
        notifications.push({ type: 'warning', message: `${unscheduledPrimary.length} primary resources could not be fully scheduled. Consider extending dates or increasing study time.` });
    }
    
    const firstPassEndDate = state.schedule.slice().reverse().find(day => day.tasks.some(t => t.isPrimaryMaterial))?.date || endDate;

    const plan: StudyPlan = {
        schedule: state.schedule, progressPerDomain: {}, startDate, endDate, firstPassEndDate,
        topicOrder, cramTopicOrder: topicOrder, deadlines,
        isCramModeActive: false, areSpecialTopicsInterleaved: true,
    };
    
    Object.values(Domain).forEach(domain => {
        const totalMinutes = masterResourcePool.filter(r => r.domain === domain && !r.isArchived && r.isPrimaryMaterial).reduce((sum, r) => sum + calculateResourceDuration(r), 0);
        plan.progressPerDomain[domain] = { completedMinutes: 0, totalMinutes };
    });

    notifications.push({ type: 'info', message: 'A new study plan has been generated.' });
    
    return { plan, notifications };
};


export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionDates: ExceptionDateRule[],
  masterResourcePool: StudyResource[]
): GeneratedStudyPlanOutcome => {
    let rebalanceStartDate: string;

    const rebalanceFrom = options.type === 'standard' 
        ? (options.rebalanceDate || getTodayInNewYork())
        : options.date;

    rebalanceStartDate = rebalanceFrom > currentPlan.startDate ? rebalanceFrom : currentPlan.startDate;
    
    const preservedSchedule: DailySchedule[] = JSON.parse(JSON.stringify(currentPlan.schedule));
    const completedResourceIds = new Set<string>();
    
    preservedSchedule.forEach(day => {
        if (day.date < rebalanceStartDate) {
            day.tasks.forEach(task => {
                if (task.status === 'completed') {
                    completedResourceIds.add(task.originalResourceId || task.resourceId);
                }
            });
        } else {
            if (day.isManuallyModified && options.type === 'standard') {
                day.tasks.forEach(task => {
                    const id = task.originalResourceId || task.resourceId;
                    if(id) completedResourceIds.add(id);
                });
            } else {
                day.tasks = [];
                day.isManuallyModified = false;
            }
        }
    });
    
    const availableForReschedule = masterResourcePool.filter(r => !completedResourceIds.has(r.id) && !r.isArchived);
    
    const generationOutcome = generateInitialSchedule(availableForReschedule, exceptionDates, currentPlan.topicOrder, currentPlan.deadlines, rebalanceStartDate, currentPlan.endDate);
    
    const futureScheduleMap = new Map(generationOutcome.plan.schedule.map(d => [d.date, d]));
    
    const finalSchedule = preservedSchedule.map(day => {
        if (day.date < rebalanceStartDate || day.isManuallyModified) {
            return day;
        }
        return futureScheduleMap.get(day.date) || day;
    });

    const finalPlan = { ...currentPlan, schedule: finalSchedule };
    
    Object.values(Domain).forEach(domain => {
        if (finalPlan.progressPerDomain[domain]) {
            const completedMinutes = finalSchedule
                .flatMap(d => d.tasks)
                .filter(t => t.originalTopic === domain && t.status === 'completed')
                .reduce((sum, t) => sum + t.durationMinutes, 0);
            
            const totalMinutes = masterResourcePool.filter(r => r.domain === domain && !r.isArchived && r.isPrimaryMaterial).reduce((sum, r) => sum + calculateResourceDuration(r), 0);

            finalPlan.progressPerDomain[domain]!.completedMinutes = completedMinutes;
            finalPlan.progressPerDomain[domain]!.totalMinutes = totalMinutes;
        }
    });
    
    return { plan: finalPlan, notifications: [{ type: 'info', message: 'Schedule has been rebalanced.' }] };
};