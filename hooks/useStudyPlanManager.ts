import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StudyPlan,
  StudyResource,
  DailySchedule,
  ScheduledTask,
  PomodoroSettings,
  RebalanceOptions,
  Domain,
  ExceptionDateRule,
  ResourceType,
} from '../types';
import { usePersistentState } from './usePersistentState';
import { masterResourcePool } from '../services/studyResources';
import {
  STUDY_START_DATE,
  STUDY_END_DATE,
  DEFAULT_DAILY_STUDY_MINS,
  DEFAULT_TOPIC_ORDER,
  POMODORO_DEFAULT_STUDY_MINS,
  POMODORO_DEFAULT_REST_MINS,
  EXCEPTION_DATES_CONFIG,
  MOONLIGHTING_WEEKDAY_TARGET_MINS,
  MOONLIGHTING_WEEKEND_TARGET_MINS,
} from '../constants';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { addResourceToGlobalPool } from '../services/studyResources';

const generateDateRange = (start: string, end: string): string[] => {
  const startDate = parseDateString(start);
  const endDate = parseDateString(end);
  const dates: string[] = [];
  let currentDate = startDate;
  while (currentDate <= endDate) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
  return dates;
};

// This is a simplified, client-side scheduler to make the app functional.
// In a real scenario, this logic would be on the server, driven by a CP-SAT solver.
const runClientSideScheduler = (
  resources: StudyResource[],
  startDate: string,
  endDate: string,
  exceptions: ExceptionDateRule[]
): DailySchedule[] => {
  const dateStrings = generateDateRange(startDate, endDate);
  const exceptionMap = new Map(exceptions.map(e => [e.date, e]));

  const schedule: DailySchedule[] = dateStrings.map(dateStr => {
    const exception = exceptionMap.get(dateStr);
    if (exception) {
      return {
        date: dateStr,
        tasks: [],
        totalStudyTimeMinutes: exception.targetMinutes ?? 0,
        isRestDay: exception.isRestDayOverride ?? false,
        dayType: exception.dayType,
        isManuallyModified: false,
      };
    }
    const dayOfWeek = parseDateString(dateStr).getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    return {
      date: dateStr,
      tasks: [],
      totalStudyTimeMinutes: DEFAULT_DAILY_STUDY_MINS,
      isRestDay: isWeekend, // Default rest days to weekends
      dayType: isWeekend ? 'high-capacity' : 'workday',
      isManuallyModified: false,
    };
  });
  
  const tasksToSchedule = resources
    .filter(r => !r.isArchived && !r.isOptional)
    .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999));
  
  let taskIndex = 0;
  
  schedule.forEach(day => {
    if (day.isRestDay || taskIndex >= tasksToSchedule.length) return;

    let remainingTime = day.totalStudyTimeMinutes;
    let orderInDay = 0;

    while (remainingTime > 0 && taskIndex < tasksToSchedule.length) {
      const resource = tasksToSchedule[taskIndex];
      if (resource.durationMinutes <= remainingTime) {
        const task: ScheduledTask = {
          id: `${day.date}-${resource.id}`,
          resourceId: resource.id,
          title: resource.title,
          type: resource.type,
          originalTopic: resource.domain,
          durationMinutes: resource.durationMinutes,
          status: 'pending',
          order: orderInDay++,
          originalResourceId: resource.id,
          isPrimaryMaterial: resource.isPrimaryMaterial,
          bookSource: resource.bookSource,
          videoSource: resource.videoSource,
          pages: resource.pages,
          questionCount: resource.questionCount,
          chapterNumber: resource.chapterNumber,
        };
        day.tasks.push(task);
        remainingTime -= resource.durationMinutes;
        taskIndex++;
      } else {
        // Simple strategy: if it doesn't fit, move to the next day.
        // A more complex solver would split tasks.
        break;
      }
    }
  });

  return schedule;
};


export const useStudyPlanManager = () => {
  const [studyPlan, setStudyPlan] = usePersistentState<StudyPlan | null>('studyPlan', null);
  const [resources, setResources] = usePersistentState<StudyResource[]>('masterResourcePool', masterResourcePool);
  const [exceptions, setExceptions] = usePersistentState<ExceptionDateRule[]>('exceptionDates', EXCEPTION_DATES_CONFIG);

  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);

  const [currentDate, setCurrentDate] = useState(getTodayInNewYork());
  
  const [pomodoroSettings, setPomodoroSettings] = usePersistentState<PomodoroSettings>('pomodoroSettings', {
    studyDuration: POMODORO_DEFAULT_STUDY_MINS,
    restDuration: POMODO_DEFAULT_REST_MINS,
    isActive: false,
    isStudySession: true,
    timeLeft: POMODORO_DEFAULT_STUDY_MINS * 60,
  });

  const [currentPomodoroTaskId, setCurrentPomodoroTaskId] = usePersistentState<string | null>('currentPomodoroTaskId', null);

  const setLoading = (loading: boolean, message = '') => {
    setIsLoading(loading);
    setLoadingMessage(message);
  };

  const generateNewStudyPlan = useCallback(() => {
    setLoading(true, 'Generating initial study plan...');
    try {
      const newSchedule = runClientSideScheduler(resources, STUDY_START_DATE, STUDY_END_DATE, exceptions);
      
      const newPlan: StudyPlan = {
        startDate: STUDY_START_DATE,
        endDate: STUDY_END_DATE,
        schedule: newSchedule,
        progressPerDomain: {},
        topicOrder: DEFAULT_TOPIC_ORDER,
        cramTopicOrder: [],
        deadlines: {},
        areSpecialTopicsInterleaved: true,
      };
      setStudyPlan(newPlan);
      setError(null);
    } catch (e) {
      console.error("Failed to generate study plan", e);
      setError("Could not generate study plan. Please try refreshing the page.");
    } finally {
      setLoading(false);
    }
  }, [resources, exceptions, setStudyPlan]);

  useEffect(() => {
    if (!studyPlan) {
      generateNewStudyPlan();
    } else {
      setLoading(false);
    }
  }, [studyPlan, generateNewStudyPlan]);


  const rebalanceSchedule = useCallback(async (options: RebalanceOptions) => {
    setLoading(true, 'Rebalancing schedule...');
    
    // MOCK API Call
    try {
        const solveRes = await fetch('/api/solve', { method: 'POST', body: JSON.stringify({resources, exceptions}) });
        if (!solveRes.ok) throw new Error("Failed to start solver job.");
        const { run_id } = await solveRes.json();
        
        let status = 'PENDING';
        let retries = 0;
        while ((status === 'PENDING' || status === 'SOLVING') && retries < 30) {
            await new Promise(res => setTimeout(res, 2000)); // Poll every 2 seconds
            const runRes = await fetch(`/api/runs/${run_id}`);
            const runData = await runRes.json();
            status = runData.status;
            if (status === 'FAILED') throw new Error(runData.error_text || 'Solver failed.');
            retries++;
        }
    } catch (e) {
        console.warn("Mock solver API call failed, proceeding with client-side logic.", e);
    }

    // Since mock API returns no slots, we run client-side logic.
    setStudyPlan(prevPlan => {
      if (!prevPlan) return null;

      const today = getTodayInNewYork();
      const todayIndex = prevPlan.schedule.findIndex(d => d.date >= today);
      if (todayIndex === -1) return prevPlan; // Plan is in the past

      const pastSchedule = prevPlan.schedule.slice(0, todayIndex);
      const futureScheduleTemplate = prevPlan.schedule.slice(todayIndex);

      const incompleteTasks = prevPlan.schedule
        .slice(todayIndex)
        .flatMap(d => d.tasks)
        .filter(t => t.status !== 'completed')
        .map(t => resources.find(r => r.id === (t.originalResourceId || t.resourceId)))
        .filter((r): r is StudyResource => !!r);

      const newFutureSchedule = runClientSideScheduler(
        incompleteTasks,
        futureScheduleTemplate[0].date,
        prevPlan.endDate,
        exceptions
      );

      return { ...prevPlan, schedule: [...pastSchedule, ...newFutureSchedule] };
    });
    
    setLoading(false);
  }, [resources, exceptions, setStudyPlan]);

  const updateTaskStatus = useCallback((taskId: string, newStatus: 'pending' | 'completed') => {
    setStudyPlan(plan => {
      if (!plan) return null;
      const newSchedule = plan.schedule.map(daily => {
        const taskIndex = daily.tasks.findIndex(t => t.id === taskId);
        if (taskIndex > -1) {
          const newTasks = [...daily.tasks];
          newTasks[taskIndex] = { ...newTasks[taskIndex], status: newStatus };
          return { ...daily, tasks: newTasks };
        }
        return daily;
      });
      return { ...plan, schedule: newSchedule };
    });
  }, [setStudyPlan]);

  const onTaskToggle = useCallback((taskId: string) => {
    const task = studyPlan?.schedule.flatMap(d => d.tasks).find(t => t.id === taskId);
    if (task) {
      updateTaskStatus(taskId, task.status === 'completed' ? 'pending' : 'completed');
    }
  }, [studyPlan, updateTaskStatus]);
  
  const addOptionalTask = useCallback((taskData: { title: string; durationMinutes: number; domain: Domain; type: ResourceType; pages?: number, questionCount?: number, chapterNumber?: number }) => {
    setStudyPlan(plan => {
      if (!plan) return null;
      
      const newResourceId = `manual_${Date.now()}`;
      const newResource: StudyResource = {
        id: newResourceId,
        title: taskData.title,
        type: taskData.type,
        domain: taskData.domain,
        durationMinutes: taskData.durationMinutes,
        pages: taskData.pages,
        questionCount: taskData.questionCount,
        chapterNumber: taskData.chapterNumber,
        isPrimaryMaterial: false,
        isArchived: false,
        isOptional: true,
        schedulingPriority: 'low',
      };
      setResources(prev => [...prev, newResource]);

      const dayIndex = plan.schedule.findIndex(d => d.date === currentDate);
      if (dayIndex === -1) return plan;

      const newSchedule = [...plan.schedule];
      const dayToModify = { ...newSchedule[dayIndex] };
      
      const newTask: ScheduledTask = {
        id: `task_${newResourceId}`,
        resourceId: newResourceId,
        originalResourceId: newResourceId,
        title: newResource.title,
        type: newResource.type,
        originalTopic: newResource.domain,
        durationMinutes: newResource.durationMinutes,
        status: 'pending',
        order: dayToModify.tasks.length,
        isOptional: true,
        pages: newResource.pages,
        questionCount: newResource.questionCount,
        chapterNumber: newResource.chapterNumber,
      };

      dayToModify.tasks = [...dayToModify.tasks, newTask];
      dayToModify.totalStudyTimeMinutes += newTask.durationMinutes;
      dayToModify.isManuallyModified = true;
      newSchedule[dayIndex] = dayToModify;

      return { ...plan, schedule: newSchedule };
    });
  }, [setStudyPlan, currentDate, setResources]);
  
  const updateDayTasks = useCallback((date: string, updatedTasks: ScheduledTask[]) => {
      setStudyPlan(plan => {
          if (!plan) return null;
          const dayIndex = plan.schedule.findIndex(d => d.date === date);
          if (dayIndex === -1) return plan;
          
          const newSchedule = [...plan.schedule];
          const totalStudyTimeMinutes = updatedTasks.reduce((sum, task) => sum + task.durationMinutes, 0);

          newSchedule[dayIndex] = {
              ...newSchedule[dayIndex],
              tasks: updatedTasks.map((task, index) => ({ ...task, order: index })),
              totalStudyTimeMinutes,
              isManuallyModified: true,
          };
          
          return { ...plan, schedule: newSchedule };
      });
      rebalanceSchedule({ type: 'standard' });
  }, [setStudyPlan, rebalanceSchedule]);

  const onPomodoroSessionComplete = useCallback((sessionType: 'study' | 'rest', durationMinutes: number) => {
    if (sessionType === 'study' && currentPomodoroTaskId) {
        setStudyPlan(plan => {
            if (!plan) return null;
            const newSchedule = plan.schedule.map(day => ({
                ...day,
                tasks: day.tasks.map(task => {
                    if (task.id === currentPomodoroTaskId) {
                        return {
                            ...task,
                            actualStudyTimeMinutes: (task.actualStudyTimeMinutes || 0) + durationMinutes,
                        };
                    }
                    return task;
                })
            }));
            return { ...plan, schedule: newSchedule };
        });
    }
  }, [currentPomodoroTaskId, setStudyPlan]);

  const onNavigateDay = (direction: 'next' | 'prev') => {
      const currentDateObj = parseDateString(currentDate);
      if (direction === 'next') {
          currentDateObj.setUTCDate(currentDateObj.getUTCDate() + 1);
      } else {
          currentDateObj.setUTCDate(currentDateObj.getUTCDate() - 1);
      }
      setCurrentDate(currentDateObj.toISOString().split('T')[0]);
  };

  const onPomodoroTaskSelect = (taskId: string | null) => {
      const task = studyPlan?.schedule.flatMap(day => day.tasks).find(t => t.id === taskId);
      setCurrentPomodoroTaskId(taskId);
      setPomodoroSettings(prev => ({
          ...prev,
          isActive: false,
          isStudySession: true,
          timeLeft: (task ? task.durationMinutes : prev.studyDuration) * 60,
      }));
  };

  const onToggleRestDay = (isCurrentlyRestDay: boolean) => {
      setStudyPlan(plan => {
          if (!plan) return null;
          const dayIndex = plan.schedule.findIndex(d => d.date === currentDate);
          if (dayIndex === -1) return plan;

          const newSchedule = [...plan.schedule];
          const day = newSchedule[dayIndex];
          newSchedule[dayIndex] = {
              ...day,
              isRestDay: !isCurrentlyRestDay,
              isManuallyModified: true,
              totalStudyTimeMinutes: isCurrentlyRestDay ? DEFAULT_DAILY_STUDY_MINS : 0
          };
          return { ...plan, schedule: newSchedule };
      });
      rebalanceSchedule({ type: 'standard' });
  };
  
  const onUpdateTimeForDay = (newTotalMinutes: number) => {
       setStudyPlan(plan => {
          if (!plan) return null;
          const dayIndex = plan.schedule.findIndex(d => d.date === currentDate);
          if (dayIndex === -1) return plan;
          
          const newSchedule = [...plan.schedule];
          newSchedule[dayIndex] = { ...newSchedule[dayIndex], totalStudyTimeMinutes: newTotalMinutes, isManuallyModified: true };
          return { ...plan, schedule: newSchedule };
       });
       rebalanceSchedule({ type: 'standard' });
  };

  const addResource = useCallback((resourceData: Omit<StudyResource, 'id' | 'isArchived'> & { id?: string }) => {
    const newResource = addResourceToGlobalPool(resourceData);
    setResources(prev => [...prev, newResource]);
  }, [setResources]);
  
  const updateResource = useCallback((resourceData: StudyResource) => {
    setResources(prev => prev.map(r => r.id === resourceData.id ? resourceData : r));
    // A rebalance might be needed if duration or other key properties changed
    rebalanceSchedule({ type: 'standard' });
  }, [setResources, rebalanceSchedule]);
  
  const archiveResource = useCallback((resourceId: string) => {
    setResources(prev => prev.map(r => r.id === resourceId ? { ...r, isArchived: true } : r));
    rebalanceSchedule({ type: 'standard' });
  }, [setResources, rebalanceSchedule]);
  
  const restoreResource = useCallback((resourceId: string) => {
    setResources(prev => prev.map(r => r.id === resourceId ? { ...r, isArchived: false } : r));
    rebalanceSchedule({ type: 'standard' });
  }, [setResources, rebalanceSchedule]);

  const permanentDeleteResource = useCallback((resourceId: string) => {
    setResources(prev => prev.filter(r => r.id !== resourceId));
    rebalanceSchedule({ type: 'standard' });
  }, [setResources, rebalanceSchedule]);
  
  const progressPerDomain = useMemo(() => {
    if (!studyPlan) return {};
    const progress: Partial<Record<Domain, { completedMinutes: number; totalMinutes: number }>> = {};
    for (const domain of Object.values(Domain)) {
      progress[domain] = { completedMinutes: 0, totalMinutes: 0 };
    }
    studyPlan.schedule.forEach(day => {
      day.tasks.forEach(task => {
        const domain = task.originalTopic;
        if (progress[domain]) {
          progress[domain]!.totalMinutes += task.durationMinutes;
          if (task.status === 'completed') {
            progress[domain]!.completedMinutes += task.durationMinutes;
          }
        }
      });
    });
    return progress;
  }, [studyPlan]);

  const dailySchedule = useMemo(() => {
    return studyPlan?.schedule.find(d => d.date === currentDate);
  }, [studyPlan, currentDate]);


  return {
    studyPlan: studyPlan ? { ...studyPlan, progressPerDomain } : null,
    dailySchedule,
    isLoading,
    loadingMessage,
    error,
    currentDate,
    setCurrentDate,
    pomodoroSettings,
    setPomodoroSettings,
    currentPomodoroTaskId,
    onPomodoroTaskSelect,
    onNavigateDay,
    onTaskToggle,
    onPomodoroSessionComplete,
    rebalanceSchedule,
    addOptionalTask,
    updateDayTasks,
    onToggleRestDay,
    onUpdateTimeForDay,
    resources,
    addResource,
    updateResource,
    archiveResource,
    restoreResource,
    permanentDeleteResource,
  };
};
