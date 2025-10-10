import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  StudyPlan, DailySchedule, ScheduledTask, StudyResource, PomodoroSettings, 
  RebalanceOptions, ExceptionDateRule, ScheduleSlot, Domain, DeadlineSettings, ResourceType, 
  // FIX: Imported AddTaskModalProps to resolve missing type error.
  AddTaskModalProps
} from '../types';
import { usePersistentState } from './usePersistentState';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { addResourceToGlobalPool } from '../services/studyResources';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';
import { STUDY_START_DATE, STUDY_END_DATE, DEFAULT_TOPIC_ORDER, EXCEPTION_DATES_CONFIG, POMODORO_DEFAULT_STUDY_MINS, POMODORO_DEFAULT_REST_MINS } from '../constants';

const POLLING_INTERVAL = 5000; // 5 seconds
const MAX_POLLING_ATTEMPTS = 60; // 5 minutes max

// This function transforms the flat array of solved "slots" from the API into the nested structure the UI expects.
const transformSlotsToSchedule = (
  slots: ScheduleSlot[],
  startDate: string,
  endDate: string,
  allResources: StudyResource[],
  existingExceptions: ExceptionDateRule[]
): DailySchedule[] => {
  const scheduleMap = new Map<string, DailySchedule>();
  const resourceMap = new Map(allResources.map(r => [r.id, r]));
  const exceptionMap = new Map(existingExceptions.map(e => [e.date, e]));

  // Initialize all days in the range
  let currentDate = parseDateString(startDate);
  const finalDate = parseDateString(endDate);

  while (currentDate <= finalDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const exception = exceptionMap.get(dateStr);
    scheduleMap.set(dateStr, {
      date: dateStr,
      tasks: [],
      isRestDay: exception?.isRestDayOverride ?? false,
      totalStudyTimeMinutes: exception?.targetMinutes ?? 0,
      dayType: exception?.dayType ?? (currentDate.getUTCDay() === 0 || currentDate.getUTCDay() === 6 ? 'high-capacity' : 'workday'),
      dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      isManuallyModified: false,
    });
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  // Populate tasks from slots
  slots.forEach(slot => {
    const day = scheduleMap.get(slot.date);
    const resource = resourceMap.get(slot.resource_id);
    if (day && resource) {
      const newTask: ScheduledTask = {
        id: `${slot.date}-${slot.resource_id}`,
        resourceId: resource.id,
        title: resource.title,
        type: resource.type,
        originalTopic: resource.domain,
        durationMinutes: slot.end_minute - slot.start_minute,
        status: 'pending',
        order: day.tasks.length,
        bookSource: resource.bookSource,
        videoSource: resource.videoSource,
        pages: resource.pages,
        startPage: resource.startPage,
        endPage: resource.endPage,
        questionCount: resource.questionCount,
        chapterNumber: resource.chapterNumber,
        isPrimaryMaterial: resource.isPrimaryMaterial,
        isOptional: resource.isOptional,
        originalResourceId: resource.originalResourceId,
      };
      day.tasks.push(newTask);
      day.totalStudyTimeMinutes += newTask.durationMinutes;
    }
  });

  // Sort tasks within each day by start time and assign final order
  scheduleMap.forEach(day => {
    day.tasks.sort((a, b) => {
      const slotA = slots.find(s => s.date === day.date && s.resource_id === a.resourceId);
      const slotB = slots.find(s => s.date === day.date && s.resource_id === b.resourceId);
      return (slotA?.start_minute ?? 0) - (slotB?.start_minute ?? 0);
    });
    day.tasks.forEach((task, index) => {
      task.order = index;
    });
  });

  return Array.from(scheduleMap.values()).sort((a, b) => a.date.localeCompare(b.date));
};


export const useStudyPlanManager = () => {
    const [studyPlan, setStudyPlan] = usePersistentState<StudyPlan | null>('studyPlan', null);
    const [masterResources, setMasterResources] = usePersistentState<StudyResource[]>('masterResourcePool', initialMasterResourcePool);
    const [exceptionDates, setExceptionDates] = usePersistentState<ExceptionDateRule[]>('exceptionDates', EXCEPTION_DATES_CONFIG);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Initializing study plan...');
    const [pomodoroSettings, setPomodoroSettings] = usePersistentState<PomodoroSettings>('pomodoroSettings', {
        studyDuration: POMODORO_DEFAULT_STUDY_MINS,
        restDuration: POMODORO_DEFAULT_REST_MINS,
        isActive: false,
        isStudySession: true,
        timeLeft: POMODORO_DEFAULT_STUDY_MINS * 60,
    });
    const [currentPomodoroTaskId, setCurrentPomodoroTaskId] = usePersistentState<string | null>('currentPomodoroTaskId', null);

    const callSolverAPI = useCallback(async (body: object) => {
      const response = await fetch('/api/solve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
      });
      if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to start solver.');
      }
      return response.json();
    }, []);

    const pollRunStatus = useCallback(async (runId: string) => {
      let attempts = 0;
      while (attempts < MAX_POLLING_ATTEMPTS) {
          const res = await fetch(`/api/runs/${runId}`);
          if (!res.ok) {
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
            attempts++;
            continue;
          }
          const data = await res.json();
          if (data.status === 'COMPLETE') {
              return data;
          }
          if (data.status === 'FAILED') {
              throw new Error(`Solver failed: ${data.error_text || 'Unknown error'}`);
          }
          setLoadingMessage(`Solving... (${Math.round((attempts / MAX_POLLING_ATTEMPTS) * 100)}%)`);
          await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
          attempts++;
      }
      throw new Error('Solver timed out.');
    }, []);

    const generateAndSetStudyPlan = useCallback(async (options: { isInitial: boolean, rebalanceOptions?: RebalanceOptions }) => {
      setIsLoading(true);
      setLoadingMessage(options.isInitial ? 'Generating initial schedule...' : 'Rebalancing schedule...');
      
      try {
        // TODO: Pass all necessary data to the solver, including resources, exceptions, constraints, etc.
        const { run_id } = await callSolverAPI({ startDate: STUDY_START_DATE, endDate: STUDY_END_DATE });
        const result = await pollRunStatus(run_id);
        
        const newSchedule = transformSlotsToSchedule(result.slots, STUDY_START_DATE, STUDY_END_DATE, masterResources, exceptionDates);

        if (options.isInitial) {
          const newPlan: StudyPlan = {
            startDate: STUDY_START_DATE,
            endDate: STUDY_END_DATE,
            schedule: newSchedule,
            progressPerDomain: {},
            topicOrder: DEFAULT_TOPIC_ORDER,
            cramTopicOrder: [],
            deadlines: {},
            areSpecialTopicsInterleaved: true
          };
          setStudyPlan(newPlan);
        } else {
          // Rebalance logic would go here: merge new schedule with past progress
           setStudyPlan(prev => {
              if (!prev) return null;
              // A simple rebalance just replaces the whole schedule for now.
              // A more advanced version would preserve completed tasks from `prev`.
              return { ...prev, schedule: newSchedule };
          });
        }

      } catch (error) {
        console.error("Error generating study plan:", error);
        // In a real app, you'd want to set an error state to show the user.
      } finally {
        setIsLoading(false);
        setLoadingMessage('');
      }
    }, [callSolverAPI, pollRunStatus, masterResources, exceptionDates, setStudyPlan]);

    useEffect(() => {
        if (!studyPlan) {
            generateAndSetStudyPlan({ isInitial: true });
        } else {
            setIsLoading(false);
        }
    }, [studyPlan, generateAndSetStudyPlan]);

    const handleTaskToggle = useCallback((taskId: string) => {
      setStudyPlan(prevPlan => {
          if (!prevPlan) return null;
          const newSchedule = prevPlan.schedule.map(daily => {
              const taskIndex = daily.tasks.findIndex(t => t.id === taskId);
              if (taskIndex > -1) {
                  const newTasks = [...daily.tasks];
                  const task = newTasks[taskIndex];
                  newTasks[taskIndex] = { ...task, status: task.status === 'completed' ? 'pending' : 'completed' };
                  return { ...daily, tasks: newTasks };
              }
              return daily;
          });
          return { ...prevPlan, schedule: newSchedule };
      });
    }, [setStudyPlan]);
    
    const handlePomodoroSessionComplete = useCallback((sessionType: 'study' | 'rest', durationMinutes: number) => {
        if (sessionType === 'study' && currentPomodoroTaskId) {
            setStudyPlan(prevPlan => {
                if (!prevPlan) return null;
                const newSchedule = prevPlan.schedule.map(daily => {
                    const taskIndex = daily.tasks.findIndex(t => t.id === currentPomodoroTaskId);
                    if (taskIndex > -1) {
                        const newTasks = [...daily.tasks];
                        const task = newTasks[taskIndex];
                        const newActualTime = (task.actualStudyTimeMinutes || 0) + durationMinutes;
                        newTasks[taskIndex] = { ...task, actualStudyTimeMinutes: newActualTime };
                        return { ...daily, tasks: newTasks };
                    }
                    return daily;
                });
                return { ...prevPlan, schedule: newSchedule };
            });
        }
    }, [currentPomodoroTaskId, setStudyPlan]);

    const handlePomodoroTaskSelect = useCallback((taskId: string | null) => {
      setCurrentPomodoroTaskId(taskId);
      setPomodoroSettings(prev => ({
          ...prev,
          isActive: false,
          isStudySession: true,
          timeLeft: prev.studyDuration * 60,
      }));
    }, [setCurrentPomodoroTaskId, setPomodoroSettings]);

    const handleRebalance = useCallback(async (options: RebalanceOptions) => {
        // For now, any rebalance triggers a full regeneration.
        await generateAndSetStudyPlan({ isInitial: false, rebalanceOptions: options });
    }, [generateAndSetStudyPlan]);
    
    const handleAddTask = useCallback((taskData: Omit<Parameters<AddTaskModalProps['onSave']>[0], 'date'>, date: string) => {
        setStudyPlan(prevPlan => {
            if (!prevPlan) return null;
            const newSchedule = [...prevPlan.schedule];
            const dayIndex = newSchedule.findIndex(d => d.date === date);
            if (dayIndex > -1) {
                const day = { ...newSchedule[dayIndex] };
                const newTask: ScheduledTask = {
                    id: `custom_${Date.now()}`,
                    resourceId: `custom_${Date.now()}`,
                    title: taskData.title,
                    type: taskData.type,
                    originalTopic: taskData.domain,
                    durationMinutes: taskData.durationMinutes,
                    status: 'pending',
                    order: day.tasks.length,
                    isOptional: true,
                    pages: taskData.pages,
                    questionCount: taskData.questionCount,
                    chapterNumber: taskData.chapterNumber,
                };
                day.tasks = [...day.tasks, newTask];
                day.isManuallyModified = true;
                newSchedule[dayIndex] = day;
                return { ...prevPlan, schedule: newSchedule };
            }
            return prevPlan;
        });
    }, [setStudyPlan]);

    const handleModifyDayTasks = useCallback((date: string, updatedTasks: ScheduledTask[]) => {
        setStudyPlan(prev => {
            if (!prev) return null;
            const newSchedule = [...prev.schedule];
            const dayIndex = newSchedule.findIndex(d => d.date === date);
            if (dayIndex > -1) {
                const day = { ...newSchedule[dayIndex] };
                day.tasks = updatedTasks.map((t, i) => ({ ...t, order: i }));
                day.isManuallyModified = true;
                newSchedule[dayIndex] = day;
                return { ...prev, schedule: newSchedule };
            }
            return prev;
        });
        // A rebalance is needed after manual modification
        handleRebalance({ type: 'standard' });
    }, [setStudyPlan, handleRebalance]);

    // Dummy handlers for controls not fully implemented
    const handleSaveTopicOrder = (newOrder: Domain[]) => { setStudyPlan(p => p ? {...p, topicOrder: newOrder} : null); handleRebalance({type: 'standard'}); };
    const handleToggleCramMode = (isActive: boolean) => { setStudyPlan(p => p ? {...p, isCramModeActive: isActive} : null); handleRebalance({type: 'standard'}); };
    const handleUpdateDeadlines = (newDeadlines: DeadlineSettings) => { setStudyPlan(p => p ? {...p, deadlines: newDeadlines} : null); handleRebalance({type: 'standard'}); };
    const handleUpdateDates = (startDate: string, endDate: string) => { generateAndSetStudyPlan({isInitial: true}); };
    const handleToggleSpecialTopicsInterleaving = (isActive: boolean) => { setStudyPlan(p => p ? {...p, areSpecialTopicsInterleaved: isActive} : null); handleRebalance({type: 'standard'}); };
    const handleToggleRestDay = (date: string, isRest: boolean) => { /* Logic to make a day a rest day or study day */ handleRebalance({type: 'standard'}); };
    const handleUpdateTimeForDay = (date: string, newTotalMinutes: number) => { /* Logic to update day's time budget */ handleRebalance({type: 'standard'}); };
    
    const handleSaveResource = (resourceData: Omit<StudyResource, 'id' | 'isArchived'> & { id?: string, isArchived: boolean }) => {
        setMasterResources(prev => {
            if (resourceData.id) { // Editing existing
                return prev.map(r => r.id === resourceData.id ? { ...r, ...resourceData } as StudyResource : r);
            } else { // Adding new
                const newResource = addResourceToGlobalPool(resourceData);
                return [...prev, newResource];
            }
        });
        handleRebalance({ type: 'standard' });
    };

    const handleArchiveResource = (resourceId: string) => {
        setMasterResources(prev => prev.map(r => r.id === resourceId ? { ...r, isArchived: true } : r));
        handleRebalance({ type: 'standard' });
    };
    
    const handleRestoreResource = (resourceId: string) => {
        setMasterResources(prev => prev.map(r => r.id === resourceId ? { ...r, isArchived: false } : r));
        handleRebalance({ type: 'standard' });
    };
    
    const handlePermanentDeleteResource = (resourceId: string) => {
        setMasterResources(prev => prev.filter(r => r.id !== resourceId));
        handleRebalance({ type: 'standard' });
    };

    return {
        studyPlan,
        masterResources,
        isLoading,
        loadingMessage,
        pomodoroSettings,
        setPomodoroSettings,
        currentPomodoroTaskId,
        handleTaskToggle,
        handlePomodoroSessionComplete,
        handlePomodoroTaskSelect,
        handleRebalance,
        handleAddTask,
        handleModifyDayTasks,
        handleSaveTopicOrder,
        handleToggleCramMode,
        handleUpdateDeadlines,
        handleUpdateDates,
        handleToggleSpecialTopicsInterleaving,
        handleSaveResource,
        handleArchiveResource,
        handleRestoreResource,
        handlePermanentDeleteResource,
        // These need to be fleshed out or passed a date
        handleToggleRestDay: (isCurrentlyRestDay: boolean, date: string) => {},
        handleUpdateTimeForDay: (newTotalMinutes: number, date: string) => {}
    };
};