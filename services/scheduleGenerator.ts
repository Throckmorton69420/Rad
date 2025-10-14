import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, GeneratedStudyPlanOutcome, DeadlineSettings, Domain, ScheduledTask, ResourceType, DailySchedule } from '../types';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { TASK_TYPE_PRIORITY } from '../constants';

/**
 * Calculates the real-world study duration for a resource based on its type and metrics.
 * This function applies the user-defined conversion factors.
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
      duration = (resource.caseCount || 1) * 1; // 1 minute per case, default to 1 if not specified
      break;
    case ResourceType.QUESTIONS:
    case ResourceType.REVIEW_QUESTIONS:
    case ResourceType.QUESTION_REVIEW:
      duration = (resource.questionCount || 1) * 1.5; // 1.5 minutes per question (do + review)
      break;
    default:
      duration = resource.durationMinutes;
      break;
  }
  return Math.round(duration > 0 ? duration : 1); // Ensure a minimum of 1 minute
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

type SchedulerState = {
  schedule: DailySchedule[];
  resourcePool: StudyResource[];
  scheduledResourceIds: Set<string>;
  splitResourceRemainders: Map<string, { resource: StudyResource, remainingDuration: number }>;
};

// --- CORE SCHEDULING PASSES ---

/**
 * A generic pass that schedules a filtered set of resources.
 * It handles splitting resources across days if they are too large.
 */
const scheduleResourcePass = (
  state: SchedulerState,
  resourceFilter: (res: StudyResource) => boolean,
  isOptional: boolean = false
): void => {
  const resourcesToSchedule = state.resourcePool.filter(
    (r) => resourceFilter(r) && !state.scheduledResourceIds.has(r.id)
  );

  for (const resource of resourcesToSchedule) {
    let durationToSchedule = calculateResourceDuration(resource);

    for (const day of state.schedule) {
      if (day.isRestDay || durationToSchedule <= 0) continue;

      const availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
      if (availableTime <= 0) continue;

      const timeToScheduleThisDay = Math.min(durationToSchedule, availableTime);
      
      if (timeToScheduleThisDay > 0) {
        if (durationToSchedule <= availableTime || !resource.isSplittable) {
          // Schedule the whole (remaining) thing
          day.tasks.push(resourceToTask(resource, day.tasks.length, durationToSchedule, isOptional));
          durationToSchedule = 0;
          state.scheduledResourceIds.add(resource.id);
          break; // Move to the next resource
        } else {
          // Split the resource
          const partSuffix = state.splitResourceRemainders.has(resource.id) ? ' (Cont.)' : ' (Part 1)';
          day.tasks.push(resourceToTask(resource, day.tasks.length, timeToScheduleThisDay, isOptional, partSuffix));
          durationToSchedule -= timeToScheduleThisDay;
          state.splitResourceRemainders.set(resource.id, { resource, remainingDuration: durationToSchedule });
        }
      }
    }
  }
};

/**
 * Schedules paired resources immediately following their anchors.
 */
const schedulePairedResourcePass = (
  state: SchedulerState,
  anchorFilter: (task: ScheduledTask) => boolean,
  pairedResourceFilter: (res: StudyResource, anchorTask: ScheduledTask) => boolean
): void => {
  const pairedResources = state.resourcePool.filter(r => !state.scheduledResourceIds.has(r.id));

  for (let i = 0; i < state.schedule.length; i++) {
    const day = state.schedule[i];
    const anchorTasks = day.tasks.filter(anchorFilter);

    for (const anchor of anchorTasks) {
      const resourcesToPair = pairedResources.filter(
        (r) => (r.pairedResourceIds?.includes(anchor.resourceId) && pairedResourceFilter(r, anchor)) && !state.scheduledResourceIds.has(r.id)
      );

      for (const resource of resourcesToPair) {
        let duration = calculateResourceDuration(resource);
        let scheduled = false;

        // Try to fit on the same day
        let availableTimeToday = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (duration <= availableTimeToday) {
          day.tasks.push(resourceToTask(resource, day.tasks.length, duration));
          state.scheduledResourceIds.add(resource.id);
          scheduled = true;
          continue;
        }

        // If not, try subsequent days
        for (let j = i + 1; j < state.schedule.length; j++) {
            const nextDay = state.schedule[j];
            if (nextDay.isRestDay) continue;

            let availableTimeNextDay = nextDay.totalStudyTimeMinutes - nextDay.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
            if (duration <= availableTimeNextDay) {
                nextDay.tasks.push(resourceToTask(resource, nextDay.tasks.length, duration));
                state.scheduledResourceIds.add(resource.id);
                scheduled = true;
                break;
            }
        }
      }
    }
  }
};


const scheduleCumulativeTopicBankPass = (state: SchedulerState, filter: (res: StudyResource) => boolean, isOptional: boolean): void => {
    let coveredTopics = new Set<Domain>();
    const unscheduledResources = state.resourcePool.filter(r => filter(r) && !state.scheduledResourceIds.has(r.id));
    
    for (const day of state.schedule) {
        day.tasks.forEach(t => coveredTopics.add(t.originalTopic));
        if (day.isRestDay) continue;

        let availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        
        const potentialResources = unscheduledResources
          .filter(r => (r.domain ? coveredTopics.has(r.domain) : false) && !state.scheduledResourceIds.has(r.id))
          .sort(() => 0.5 - Math.random()); 

        for (const resource of potentialResources) {
            if (availableTime <= 0) break;

            const duration = calculateResourceDuration(resource);
            if (duration <= availableTime) {
                day.tasks.push(resourceToTask(resource, day.tasks.length, duration, isOptional));
                state.scheduledResourceIds.add(resource.id);
                availableTime -= duration;
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
    
    const state: SchedulerState = {
      schedule: [],
      resourcePool: [...masterResourcePool].filter(r => !r.isArchived).sort((a,b) => {
          const topicA_Index = topicOrder.indexOf(a.domain);
          const topicB_Index = topicOrder.indexOf(b.domain);
          if (topicA_Index !== topicB_Index) return topicA_Index - topicB_Index;
          return (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999);
      }),
      scheduledResourceIds: new Set<string>(),
      splitResourceRemainders: new Map()
    };
    
    const notifications: { type: 'error' | 'warning' | 'info'; message: string }[] = [];
    const exceptionMap = new Map(exceptionDates.map(e => [e.date, e]));
    
    let currentDate = parseDateString(startDate);
    const finalDate = parseDateString(endDate);

    while (currentDate <= finalDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const exception = exceptionMap.get(dateStr);
        const isRestDay = exception ? exception.isRestDayOverride : false;
        
        state.schedule.push({
            date: dateStr,
            dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
            tasks: [],
            totalStudyTimeMinutes: isRestDay ? 0 : (exception?.targetMinutes ?? 14 * 60),
            isRestDay: isRestDay,
            isManuallyModified: false,
        });
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    // --- PHASE 1 ---
    // Pass 1a: Titan Radiology videos
    scheduleResourcePass(state, r => r.videoSource === 'Titan Radiology' && r.isPrimaryMaterial);
    
    // Pass 1b: Crack the Core Vol 1/2 readings
    schedulePairedResourcePass(state, t => t.videoSource === 'Titan Radiology', (r, anchor) => r.bookSource === 'Crack the Core');

    // Pass 1c: Crack the Core Case Companion cases
    schedulePairedResourcePass(state, t => t.videoSource === 'Titan Radiology' || t.bookSource === 'Crack the Core', r => r.bookSource === 'Case Companion');

    // Pass 1d: Qevlar focused questions
    schedulePairedResourcePass(state, t => t.videoSource === 'Titan Radiology' || t.bookSource === 'Crack the Core' || t.bookSource === 'Case Companion', r => r.bookSource === 'QEVLAR');

    // Pass 2a: Huda physics video lecture
    scheduleResourcePass(state, r => r.videoSource === 'Huda' && r.isPrimaryMaterial);
    // Pass 2b: Associated Huda physics QBank questions
    schedulePairedResourcePass(state, t => t.videoSource === 'Huda', r => r.bookSource === 'Huda Physics QB');
    // Pass 2c: Associated Huda physics text reading
    schedulePairedResourcePass(state, t => t.videoSource === 'Huda', r => r.bookSource === 'Review of Physics 5e');
    
    // Pass 3a: Nucs from Crack the Core or War Machine
    scheduleResourcePass(state, r => r.domain === Domain.NUCLEAR_MEDICINE && (r.bookSource === 'Crack the Core' || r.bookSource === 'War Machine') && r.isPrimaryMaterial);
    // Pass 3b: Nucs focused questions from Qevlar or Nucs app
    // FIX: A ScheduledTask does not have a 'domain' property; it has 'originalTopic'.
    schedulePairedResourcePass(state, t => t.originalTopic === Domain.NUCLEAR_MEDICINE, r => r.domain === Domain.NUCLEAR_MEDICINE && (r.bookSource === 'QEVLAR' || r.bookSource === 'NucApp'));

    // Pass 4a: RISC and NIS reading
    scheduleResourcePass(state, r => (r.domain === Domain.RISC || r.domain === Domain.NIS) && r.type.includes('READING'));
    // Pass 4c: NIS app questions
    // FIX: A ScheduledTask does not have a 'domain' property; it has 'originalTopic'.
    schedulePairedResourcePass(state, t => t.originalTopic === Domain.NIS, r => r.domain === Domain.NIS && r.type.includes('QUESTIONS'));
    
    // Pass 5: Board Vitals random questions
    scheduleCumulativeTopicBankPass(state, r => r.bookSource === 'Board Vitals' && r.isPrimaryMaterial, false);

    // --- PHASE 2 ---
    // Pass 1: Add Rad Discord lectures
    let coveredTopicsToday = new Set<Domain>();
    for (const day of state.schedule) {
        coveredTopicsToday.clear();
        day.tasks.forEach(t => coveredTopicsToday.add(t.originalTopic));
        if (day.isRestDay) continue;

        let availableTime = day.totalStudyTimeMinutes - day.tasks.reduce((sum, t) => sum + t.durationMinutes, 0);
        if (availableTime <= 15) continue;
        
        const discordLectures = state.resourcePool
            .filter(r => r.videoSource === 'Discord' && !state.scheduledResourceIds.has(r.id) && coveredTopicsToday.has(r.domain))
            .sort((a,b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999));

        for (const lecture of discordLectures) {
            const duration = calculateResourceDuration(lecture);
            if (availableTime >= duration) {
                day.tasks.push(resourceToTask(lecture, day.tasks.length, duration, true));
                state.scheduledResourceIds.add(lecture.id);
                availableTime -= duration;
            }
        }
    }

    // --- PHASE 3 ---
    // Pass 1: Optional Textbook Content (Core Radiology)
    scheduleCumulativeTopicBankPass(state, r => r.bookSource === 'Core Radiology', true);
    
    // Final Sorting and Cleanup
    state.schedule.forEach(day => {
        day.tasks.sort((a, b) => a.order - b.order); // Preserve initial order first
        day.tasks.sort((a, b) => (TASK_TYPE_PRIORITY[a.type] || 99) - (TASK_TYPE_PRIORITY[b.type] || 99)); // Then sort by type priority
        day.tasks.forEach((task, index) => task.order = index); // Re-assign order
    });
    
    const unscheduledPrimary = state.resourcePool.filter(r => r.isPrimaryMaterial && !state.scheduledResourceIds.has(r.id) && !state.splitResourceRemainders.has(r.id));
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
