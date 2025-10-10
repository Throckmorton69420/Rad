import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StudyPlan,
  StudyResource,
  DailySchedule,
  ScheduledTask,
  RebalanceOptions,
  Domain,
  ExceptionDateRule,
  ResourceType,
  ShowConfirmationOptions,
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
} from '../constants';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { addResourceToGlobalPool } from '../services/studyResources';

// FIX: This type was added to solve errors in App.tsx
type SystemNotification = {
  type: 'info' | 'error' | 'warning';
  message: string;
};

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


export const useStudyPlanManager = (showConfirmation: (options: ShowConfirmationOptions) => void) => {
  const [studyPlan, setStudyPlan] = usePersistentState<StudyPlan | null>('studyPlan', null);
  const [globalMasterResourcePool, setGlobalMasterResourcePool] = usePersistentState<StudyResource[]>('masterResourcePool', masterResourcePool);
  const [exceptions, setExceptions] = usePersistentState<ExceptionDateRule[]>('exceptionDates', EXCEPTION_DATES_CONFIG);
  
  const [previousStudyPlan, setPreviousStudyPlan] = useState<StudyPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [systemNotification, setSystemNotification] = useState<SystemNotification | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const updatePreviousStudyPlan = useCallback((plan: StudyPlan) => {
    setPreviousStudyPlan(JSON.parse(JSON.stringify(plan)));
  }, []);

  const setLoading = (loading: boolean, message = '') => {
    setIsLoading(loading);
  };
  
  const loadSchedule = useCallback(async (regenerate = false) => {
    setLoading(true, 'Generating initial study plan...');
    if (regenerate || !studyPlan) {
      try {
        const newSchedule = runClientSideScheduler(globalMasterResourcePool, STUDY_START_DATE, STUDY_END_DATE, exceptions);
        
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
      } catch (e) {
        console.error("Failed to generate study plan", e);
        setSystemNotification({ type: 'error', message: 'Could not generate study plan.'});
      } finally {
        setLoading(false);
      }
    } else {
        setLoading(false);
    }
  }, [studyPlan, globalMasterResourcePool, exceptions, setStudyPlan]);


  useEffect(() => {
    if (!localStorage.getItem('studyPlan')) {
        setIsNewUser(true);
    }
    loadSchedule();
  }, [loadSchedule]);


  const handleRebalance = useCallback(async (options: RebalanceOptions) => {
    setLoading(true, 'Rebalancing schedule...');
    updatePreviousStudyPlan(studyPlan!);
    
    // MOCK API Call
    try {
        const solveRes = await fetch('/api/solve', { method: 'POST', body: JSON.stringify({resources: globalMasterResourcePool, exceptions}) });
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
        .map(t => globalMasterResourcePool.find(r => r.id === (t.originalResourceId || t.resourceId)))
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
  }, [globalMasterResourcePool, exceptions, setStudyPlan, studyPlan, updatePreviousStudyPlan]);

  const handleTaskToggle = useCallback((taskId: string, date: string) => {
    setStudyPlan(plan => {
      if (!plan) return null;
      updatePreviousStudyPlan(plan);
      const newSchedule = plan.schedule.map(daily => {
        if (daily.date === date) {
          const taskIndex = daily.tasks.findIndex(t => t.id === taskId);
          if (taskIndex > -1) {
            const newTasks = [...daily.tasks];
            const currentStatus = newTasks[taskIndex].status;
            newTasks[taskIndex] = { ...newTasks[taskIndex], status: currentStatus === 'completed' ? 'pending' : 'completed' };
            return { ...daily, tasks: newTasks };
          }
        }
        return daily;
      });
      return { ...plan, schedule: newSchedule };
    });
  }, [setStudyPlan, updatePreviousStudyPlan]);

  const handleSaveModifiedDayTasks = useCallback((updatedTasks: ScheduledTask[], date: string) => {
      setStudyPlan(plan => {
          if (!plan) return null;
          updatePreviousStudyPlan(plan);
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
  }, [setStudyPlan, updatePreviousStudyPlan]);

  const handleUndo = useCallback(() => {
    if (previousStudyPlan) {
      setStudyPlan(previousStudyPlan);
      setPreviousStudyPlan(null);
      setSystemNotification({ type: 'info', message: 'Last change has been undone.' });
    }
  }, [previousStudyPlan, setStudyPlan]);

  const handleToggleRestDay = (date: string, isCurrentlyRestDay: boolean) => {
      setStudyPlan(plan => {
          if (!plan) return null;
          updatePreviousStudyPlan(plan);
          const dayIndex = plan.schedule.findIndex(d => d.date === date);
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
      handleRebalance({ type: 'standard' });
  };
  
  const handleAddOrUpdateException = (rule: ExceptionDateRule) => {
    updatePreviousStudyPlan(studyPlan!);
    setExceptions(prev => {
        const existingIndex = prev.findIndex(e => e.date === rule.date);
        if (existingIndex > -1) {
            const newExceptions = [...prev];
            newExceptions[existingIndex] = rule;
            return newExceptions;
        }
        return [...prev, rule];
    });
    setTimeout(() => handleRebalance({ type: 'standard' }), 100);
  };
  
  const handleUpdatePlanDates = (startDate: string, endDate: string) => {
    if (!studyPlan) return;
    updatePreviousStudyPlan(studyPlan);
    setStudyPlan(prev => ({...prev!, startDate, endDate}));
    loadSchedule(true);
  };

  const handleUpdateTopicOrderAndRebalance = (newOrder: Domain[]) => {
      if (!studyPlan) return;
      updatePreviousStudyPlan(studyPlan);
      setStudyPlan(p => ({...p!, topicOrder: newOrder}));
      handleRebalance({type: 'standard'});
  };

  const handleUpdateCramTopicOrderAndRebalance = (newOrder: Domain[]) => {
      if (!studyPlan) return;
      updatePreviousStudyPlan(studyPlan);
      setStudyPlan(p => ({...p!, cramTopicOrder: newOrder}));
      handleRebalance({type: 'standard'});
  };

  const handleToggleCramMode = (isActive: boolean) => {
    if (!studyPlan) return;
    updatePreviousStudyPlan(studyPlan);
    setStudyPlan(p => ({ ...p!, isCramModeActive: isActive }));
    handleRebalance({type: 'standard'});
  };
  
  const handleToggleSpecialTopicsInterleaving = (isActive: boolean) => {
    if (!studyPlan) return;
    updatePreviousStudyPlan(studyPlan);
    setStudyPlan(p => ({ ...p!, areSpecialTopicsInterleaved: isActive }));
    handleRebalance({type: 'standard'});
  };

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

  return {
    studyPlan: studyPlan ? { ...studyPlan, progressPerDomain } : null,
    setStudyPlan,
    previousStudyPlan,
    globalMasterResourcePool,
    setGlobalMasterResourcePool,
    isLoading,
    systemNotification,
    setSystemNotification,
    isNewUser,
    loadSchedule,
    handleRebalance,
    handleUpdatePlanDates,
    handleUpdateTopicOrderAndRebalance,
    handleUpdateCramTopicOrderAndRebalance,
    handleToggleCramMode,
    handleToggleSpecialTopicsInterleaving,
    handleTaskToggle,
    handleSaveModifiedDayTasks,
    handleUndo,
    updatePreviousStudyPlan,
    saveStatus,
    handleToggleRestDay,
    handleAddOrUpdateException,
  };
};
