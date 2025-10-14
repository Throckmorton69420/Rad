import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, GeneratedStudyPlanOutcome, DeadlineSettings, Domain, ScheduledTask, ResourceType, DailySchedule } from '../types';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { TASK_TYPE_PRIORITY } from '../constants';

/**
 * Calculates the real-world study duration for a resource based on its type and metrics.
 * This function applies the user-defined conversion factors.
 * - Reading: 30 seconds per page
 * - Videos: Watched at ~1.33x speed (75% of original duration)
 * - Cases: 1 minute per case
 * - Questions: 1.5 minutes per question (to account for review time)
 * @param resource The study resource to calculate the duration for.
 * @returns The calculated duration in minutes.
 */
const calculateResourceDuration = (resource: StudyResource): number => {
  let duration = 0;
  switch (resource.type) {
    case ResourceType.READING_TEXTBOOK:
    case ResourceType.READING_GUIDE:
      duration = (resource.pages || 0) * 0.5; // 30 seconds per page
      break;
    case ResourceType.VIDEO_LECTURE:
    case ResourceType.HIGH_YIELD_VIDEO:
      duration = resource.durationMinutes * 0.75; // Watched at ~1.33x speed
      break;
    case ResourceType.CASES:
      duration = (resource.caseCount || 0) * 1; // 1 minute per case
      break;
    case ResourceType.QUESTIONS:
    case ResourceType.REVIEW_QUESTIONS:
    case ResourceType.QUESTION_REVIEW:
      duration = (resource.questionCount || 0) * 1.5; // 1.5 minutes per question (do + review)
      break;
    default:
      duration = resource.durationMinutes;
      break;
  }
  return Math.round(duration);
};

// Represents a resource or a group of paired resources that must be scheduled together.
interface SchedulingBlock {
  id: string;
  resources: StudyResource[];
  totalDuration: number;
  remainingDuration: number;
  isSplittable: boolean;
}

const resourceToTask = (resource: StudyResource, order: number, duration?: number, isOptionalOverride = false): ScheduledTask => {
    const calculatedDuration = calculateResourceDuration(resource);
    return {
        id: `${resource.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        resourceId: resource.id,
        originalResourceId: resource.id,
        title: resource.title,
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

export const generateInitialSchedule = (
  masterResourcePool: StudyResource[],
  exceptionDates: ExceptionDateRule[],
  topicOrder: Domain[] = [],
  deadlines: DeadlineSettings = {},
  startDate: string,
  endDate: string,
  areSpecialTopicsInterleaved: boolean = true,
): GeneratedStudyPlanOutcome => {
    const schedule: DailySchedule[] = [];
    const notifications: { type: 'error' | 'warning' | 'info'; message: string }[] = [];
    const exceptionMap = new Map(exceptionDates.map(e => [e.date, e]));
    
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
    
    const availableResources = masterResourcePool.filter(r => !r.isArchived);
    const scheduledResourceIds = new Set<string>();
    
    // --- Phase 1: Pre-computation & "Blockification" (The Homework) ---
    const resourceMap = new Map(availableResources.map(r => [r.id, r]));
    const processedForBlocking = new Set<string>();
    const schedulingBlocks: SchedulingBlock[] = [];

    for (const resource of availableResources) {
        if (processedForBlocking.has(resource.id) || !resource.isPrimaryMaterial) continue;

        const blockResources = new Set<StudyResource>([resource]);
        const idsToProcess = [...(resource.pairedResourceIds || [])];
        
        while (idsToProcess.length > 0) {
            const id = idsToProcess.shift();
            if (id && !processedForBlocking.has(id)) {
                const pairedResource = resourceMap.get(id);
                if (pairedResource && pairedResource.isPrimaryMaterial) {
                    blockResources.add(pairedResource);
                    processedForBlocking.add(id);
                    (pairedResource.pairedResourceIds || []).forEach(nextId => {
                        if (!blockResources.has(resourceMap.get(nextId)!) && !processedForBlocking.has(nextId)) {
                            idsToProcess.push(nextId);
                        }
                    });
                }
            }
        }

        const resourcesInBlock = Array.from(blockResources);
        resourcesInBlock.forEach(r => processedForBlocking.add(r.id));
        
        const totalDuration = resourcesInBlock.reduce((sum, r) => sum + calculateResourceDuration(r), 0);
        
        schedulingBlocks.push({
            id: resource.id,
            resources: resourcesInBlock,
            totalDuration,
            remainingDuration: totalDuration,
            isSplittable: resourcesInBlock.some(r => r.isSplittable),
        });
    }

    // Sort blocks based on the main topic order
    schedulingBlocks.sort((a, b) => {
        const topicA_Index = topicOrder.indexOf(a.resources[0].domain);
        const topicB_Index = topicOrder.indexOf(b.resources[0].domain);
        if (topicA_Index !== topicB_Index) return topicA_Index - topicB_Index;
        return (a.resources[0].sequenceOrder ?? 999) - (b.resources[0].sequenceOrder ?? 999);
    });

    const blockQueue = [...schedulingBlocks];

    // --- Phase 2: Intelligent Primary Content Placement ---
    for (const day of schedule) {
        if (day.isRestDay) continue;

        let remainingTimeOnDay = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        let taskOrder = day.tasks.length;
        
        while (remainingTimeOnDay > 0 && blockQueue.length > 0) {
            const block = blockQueue[0];
            
            if (block.remainingDuration <= remainingTimeOnDay) {
                // The whole (remaining) block fits, schedule it
                blockQueue.shift(); // Consume the block
                
                const splittableResource = block.isSplittable ? block.resources.find(r => r.isSplittable) : null;

                block.resources
                    .sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99))
                    .forEach(res => {
                        let taskDuration = calculateResourceDuration(res);
                        // If this is part of a split block, use remaining duration for the splittable part
                        if (splittableResource && res.id === splittableResource.id && block.totalDuration !== block.remainingDuration) {
                            taskDuration = block.remainingDuration - (block.totalDuration - calculateResourceDuration(splittableResource));
                        }
                        
                        if(taskDuration > 0) {
                            day.tasks.push(resourceToTask(res, taskOrder++, taskDuration));
                            scheduledResourceIds.add(res.id);
                        }
                    });
                remainingTimeOnDay -= block.remainingDuration;
            } else if (block.isSplittable) {
                // Block is too big, but we can split it
                const splittableResource = block.resources.find(r => r.isSplittable);
                if (splittableResource) {
                     const durationToSchedule = remainingTimeOnDay;
                     const originalDuration = calculateResourceDuration(splittableResource);

                     const task = resourceToTask(splittableResource, taskOrder++, durationToSchedule);
                     task.title += ` (Part ${Math.round(((originalDuration - block.remainingDuration) / originalDuration) * 10) + 1})`;
                     day.tasks.push(task);
                     
                     block.remainingDuration -= durationToSchedule;
                     scheduledResourceIds.add(splittableResource.id);
                     remainingTimeOnDay = 0; // Day is full
                } else {
                     break; // Can't split, day is effectively full for primary
                }
            } else {
                // Block is too big and not splittable, move to next day
                break;
            }
        }
    }
    
    // --- Pass 3: Supplementary Lectures (Discord) ---
    for (const day of schedule) {
        if (day.isRestDay) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (remainingTime <= 15) continue;
        
        const topicsToday = new Set(day.tasks.map(t => t.originalTopic));
        const discordLectures = availableResources
            .filter(r => r.videoSource === 'Discord' && !scheduledResourceIds.has(r.id) && topicsToday.has(r.domain))
            .sort((a,b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999));

        for (const lecture of discordLectures) {
            const duration = calculateResourceDuration(lecture);
            if (remainingTime >= duration) {
                day.tasks.push(resourceToTask(lecture, day.tasks.length, duration, true));
                scheduledResourceIds.add(lecture.id);
                remainingTime -= duration;
            }
        }
    }

    // --- Pass 4: Optional Textbook (Core Radiology) ---
    let allCoveredTopicsCumulative = new Set<Domain>();
    for (const day of schedule) {
        day.tasks.forEach(t => allCoveredTopicsCumulative.add(t.originalTopic));
        if (day.isRestDay) continue;
        let remainingTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (remainingTime <= 5) continue;

        const coreReadings = availableResources
            .filter(r => r.bookSource === 'Core Radiology' && !scheduledResourceIds.has(r.id) && allCoveredTopicsCumulative.has(r.domain))
            .sort((a,b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999));
            
        for (const reading of coreReadings) {
            const duration = calculateResourceDuration(reading);
            if (remainingTime >= duration) {
                day.tasks.push(resourceToTask(reading, day.tasks.length, duration, true));
                scheduledResourceIds.add(reading.id);
                remainingTime -= duration;
            }
        }
    }
    
    schedule.forEach(day => {
        day.tasks.sort((a, b) => a.order - b.order);
        day.tasks.forEach((task, index) => task.order = index);
    });
    
    const unscheduledPrimary = availableResources.filter(r => r.isPrimaryMaterial && !scheduledResourceIds.has(r.id));
    if (unscheduledPrimary.length > 0 || blockQueue.some(b => b.remainingDuration > 0)) {
        const unscheduledCount = unscheduledPrimary.length + blockQueue.length;
        notifications.push({ type: 'warning', message: `${unscheduledCount} primary resources/blocks could not be fully scheduled. Consider extending dates or increasing study time.` });
    }
    
    const firstPassEndDate = schedule.slice().reverse().find(day => day.tasks.some(t => t.isPrimaryMaterial))?.date || endDate;

    const plan: StudyPlan = {
        schedule, progressPerDomain: {}, startDate, endDate, firstPassEndDate,
        topicOrder, cramTopicOrder: topicOrder, deadlines,
        isCramModeActive: false, areSpecialTopicsInterleaved,
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
    const today = getTodayInNewYork();
    
    let rebalanceStartDate: string;
    if (options.type === 'topic-time') {
      rebalanceStartDate = options.date;
    } else {
      rebalanceStartDate = today > currentPlan.startDate ? today : currentPlan.startDate;
    }

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
                if (options.type !== 'topic-time' || day.date !== options.date) {
                    day.isManuallyModified = false;
                }
            }
        }
    });

    if (options.type === 'topic-time') {
      const dayToModify = preservedSchedule.find(d => d.date === options.date);
      if (dayToModify) {
        dayToModify.totalStudyTimeMinutes = options.totalTimeMinutes;
        dayToModify.isRestDay = options.totalTimeMinutes === 0;
        dayToModify.isManuallyModified = true;
        dayToModify.tasks = [];
        
        let remainingTime = options.totalTimeMinutes;
        let taskOrder = 0;
        
        options.topics.forEach(topic => {
            const resourcesForTopic = masterResourcePool
                .filter(r => r.domain === topic && !completedResourceIds.has(r.id) && !r.isArchived)
                .sort((a, b) => (a.sequenceOrder || 999) - (b.sequenceOrder || 999));

            for(const res of resourcesForTopic) {
                const duration = calculateResourceDuration(res);
                if(remainingTime >= duration) {
                    dayToModify.tasks.push(resourceToTask(res, taskOrder++, duration));
                    completedResourceIds.add(res.id);
                    remainingTime -= duration;
                }
            }
        });
      }
    }
    
    const availableForReschedule = masterResourcePool.filter(r => !completedResourceIds.has(r.id) && !r.isArchived);
    
    const generationOutcome = generateInitialSchedule(availableForReschedule, exceptionDates, currentPlan.topicOrder, currentPlan.deadlines, rebalanceStartDate, currentPlan.endDate, currentPlan.areSpecialTopicsInterleaved);
    
    const futureScheduleMap = new Map(generationOutcome.plan.schedule.map(d => [d.date, d]));
    
    const finalSchedule = preservedSchedule.map(day => {
        if (day.date < rebalanceStartDate || (day.isManuallyModified && (options.type !== 'topic-time' || day.date !== options.date))) {
            return day;
        }
        if (options.type === 'topic-time' && day.date === options.date) {
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
