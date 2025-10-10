import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  StudyPlan, DailySchedule, ScheduledTask, StudyResource, PomodoroSettings, 
  RebalanceOptions, ExceptionDateRule, ScheduleSlot, Domain, DeadlineSettings, 
  AddTaskModalProps, ShowConfirmationOptions
} from '../types';
import { usePersistentState } from './usePersistentState';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { addResourceToGlobalPool } from '../services/studyResources';
import { parseDateString } from '../utils/timeFormatter';
// FIX: Import EXCEPTION_DATES_CONFIG from constants.
import { STUDY_START_DATE, STUDY_END_DATE, DEFAULT_TOPIC_ORDER, EXCEPTION_DATES_CONFIG } from '../constants';
import { supabase } from '../services/supabaseClient';

const POLLING_INTERVAL = 2500; // 2.5 seconds
const MAX_POLLING_ATTEMPTS = 60; // 2.5 minutes max

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

  slots.forEach(slot => {
    const day = scheduleMap.get(slot.date);
    const resource = resourceMap.get(slot.resource_id);
    if (day) {
      const taskResource = resource || {
          id: slot.resource_id,
          title: slot.title,
          type: slot.type,
          domain: slot.domain,
          durationMinutes: slot.end_minute - slot.start_minute,
          isPrimaryMaterial: false,
          isOptional: true,
      } as StudyResource

      const newTask: ScheduledTask = {
        id: `${slot.date}-${taskResource.id}`,
        resourceId: taskResource.id,
        title: taskResource.title,
        type: taskResource.type,
        originalTopic: taskResource.domain,
        durationMinutes: slot.end_minute - slot.start_minute,
        status: 'pending',
        order: day.tasks.length,
        bookSource: taskResource.bookSource,
        videoSource: taskResource.videoSource,
        pages: taskResource.pages,
        startPage: taskResource.startPage,
        endPage: taskResource.endPage,
        questionCount: taskResource.questionCount,
        chapterNumber: taskResource.chapterNumber,
        isPrimaryMaterial: taskResource.isPrimaryMaterial,
        isOptional: taskResource.isOptional,
        originalResourceId: taskResource.originalResourceId,
      };
      day.tasks.push(newTask);
    }
  });

  scheduleMap.forEach(day => {
    const slotsForDay = slots.filter(s => s.date === day.date);
    day.tasks.sort((a, b) => {
      const slotA = slotsForDay.find(s => s.resource_id === a.resourceId);
      const slotB = slotsForDay.find(s => s.resource_id === b.resourceId);
      return (slotA?.start_minute ?? 0) - (slotB?.start_minute ?? 0);
    });
    day.tasks.forEach((task, index) => { task.order = index; });
    day.totalStudyTimeMinutes = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
  });

  return Array.from(scheduleMap.values()).sort((a, b) => a.date.localeCompare(b.date));
};


export const useStudyPlanManager = (showConfirmation: (options: ShowConfirmationOptions) => void) => {
    const [studyPlan, setStudyPlan] = usePersistentState<StudyPlan | null>('studyPlan', null);
    const [masterResources, setMasterResources] = usePersistentState<StudyResource[]>('masterResourcePool', initialMasterResourcePool);
    const [exceptionDates, setExceptionDates] = usePersistentState<ExceptionDateRule[]>('exceptionDates', EXCEPTION_DATES_CONFIG);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Initializing...');
    const [dbCheck, setDbCheck] = useState<{ checked: boolean, isSeeded: boolean }>({ checked: false, isSeeded: false });
    const [systemNotification, setSystemNotification] = useState<{type: 'info' | 'error', message: string} | null>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    useEffect(() => {
        const checkDB = async () => {
            setLoadingMessage('Connecting to database...');
            const { count, error } = await supabase.from('resources').select('*', { count: 'exact', head: true });
            
            if (error) {
                console.error("Error checking database:", error);
                setDbCheck({ checked: true, isSeeded: false });
                return;
            }

            setDbCheck({ checked: true, isSeeded: count !== null && count > 0 });
        };
        checkDB();
    }, []);

    const seedDatabase = useCallback(async () => {
      setIsLoading(true);
      setLoadingMessage('Seeding database with master resource list...');
      try {
        const chunkSize = 500;
        for (let i = 0; i < initialMasterResourcePool.length; i += chunkSize) {
            const chunk = initialMasterResourcePool.slice(i, i + chunkSize);
            const { error } = await supabase.from('resources').insert(chunk.map(r => ({...r, durationMinutes: r.durationMinutes || 0})));
            if (error) throw error;
        }
        setMasterResources(initialMasterResourcePool);
        setDbCheck({ checked: true, isSeeded: true });
        await generateAndSetStudyPlan({ isInitial: true });
      } catch (error) {
        console.error("Error seeding database:", error);
        setLoadingMessage(`Database seeding failed: ${(error as Error).message}`);
        setIsLoading(false);
      }
    }, [setMasterResources]);


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
          if (data.status === 'COMPLETE') return data;
          if (data.status === 'FAILED') throw new Error(`Solver failed: ${data.error_text || 'Unknown error'}`);
          
          setLoadingMessage(`Generating schedule... (${Math.round(((attempts+1) / MAX_POLLING_ATTEMPTS) * 100)}%)`);
          await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
          attempts++;
      }
      throw new Error('Solver timed out.');
    }, []);

    const generateAndSetStudyPlan = useCallback(async (options: { isInitial: boolean, rebalanceOptions?: RebalanceOptions }) => {
      setIsLoading(true);
      setLoadingMessage(options.isInitial ? 'Generating initial schedule...' : 'Rebalancing schedule...');
      
      try {
        const { run_id } = await callSolverAPI({ startDate: STUDY_START_DATE, endDate: STUDY_END_DATE, options: options.rebalanceOptions });
        const result = await pollRunStatus(run_id);
        
        const newSchedule = transformSlotsToSchedule(result.slots, STUDY_START_DATE, STUDY_END_DATE, masterResources, exceptionDates);

        setStudyPlan(prev => {
            const basePlan = prev ?? {
                startDate: STUDY_START_DATE,
                endDate: STUDY_END_DATE,
                schedule: [],
                progressPerDomain: {},
                topicOrder: DEFAULT_TOPIC_ORDER,
                cramTopicOrder: [],
                deadlines: {},
                areSpecialTopicsInterleaved: true
            };
            
            const progressPerDomain = {} as StudyPlan['progressPerDomain'];
            newSchedule.forEach(day => {
                day.tasks.forEach(task => {
                    if (!progressPerDomain[task.originalTopic]) {
                        progressPerDomain[task.originalTopic] = { completedMinutes: 0, totalMinutes: 0 };
                    }
                    progressPerDomain[task.originalTopic]!.totalMinutes += task.durationMinutes;
                });
            });

            return { ...basePlan, schedule: newSchedule, progressPerDomain };
        });

      } catch (error) {
        console.error("Error generating study plan:", error);
        setLoadingMessage(`Error: ${(error as Error).message}`);
      } finally {
        setIsLoading(false);
        setLoadingMessage('');
      }
    }, [callSolverAPI, pollRunStatus, masterResources, exceptionDates, setStudyPlan]);
    
    const loadSchedule = useCallback(async (regenerate = false) => {
        if (dbCheck.checked && dbCheck.isSeeded) {
            if (!studyPlan || regenerate) {
                await generateAndSetStudyPlan({ isInitial: !studyPlan });
            } else {
                setIsLoading(false);
            }
        } else if (dbCheck.checked && !dbCheck.isSeeded) {
            setIsLoading(false);
        }
    }, [dbCheck, studyPlan, generateAndSetStudyPlan]);


    useEffect(() => {
        loadSchedule();
    }, [loadSchedule]);

    const handleTaskToggle = useCallback((taskId: string, date: string) => {
      setStudyPlan(prevPlan => {
          if (!prevPlan) return null;
          const newSchedule = prevPlan.schedule.map(daily => {
              if (daily.date === date) {
                  const newTasks = daily.tasks.map(t => t.id === taskId ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' } : t);
                  return { ...daily, tasks: newTasks };
              }
              return daily;
          });
          return { ...prevPlan, schedule: newSchedule };
      });
    }, [setStudyPlan]);
    
    // FIX: Use `as const` to ensure TypeScript infers the correct literal type for 'status', preventing a type mismatch error.
    const handleMasterResetTasks = useCallback(() => {
        setStudyPlan(prevPlan => {
            if (!prevPlan) return null;
            return {
                ...prevPlan,
                schedule: prevPlan.schedule.map(d => ({
                    ...d,
                    tasks: d.tasks.map(t => ({ ...t, status: 'pending' as const })),
                })),
            };
        });
    }, [setStudyPlan]);

    const handleSaveModifiedDayTasks = useCallback((updatedTasks: ScheduledTask[], date: string) => {
        setStudyPlan(prev => {
            if (!prev) return null;
            const newSchedule = prev.schedule.map(day => {
                if (day.date === date) {
                    return { ...day, tasks: updatedTasks, isManuallyModified: true };
                }
                return day;
            });
            return { ...prev, schedule: newSchedule };
        });
    }, [setStudyPlan]);

    const handleRebalance = useCallback((options?: RebalanceOptions) => {
        generateAndSetStudyPlan({ isInitial: false, rebalanceOptions: options });
    }, [generateAndSetStudyPlan]);

    const handleUpdateTopicOrderAndRebalance = (newOrder: Domain[]) => { setStudyPlan(p => p ? {...p, topicOrder: newOrder} : null); handleRebalance(); };
    const handleUpdateCramTopicOrderAndRebalance = (newOrder: Domain[]) => { setStudyPlan(p => p ? {...p, cramTopicOrder: newOrder} : null); handleRebalance(); };
    const handleToggleCramMode = (isActive: boolean) => { setStudyPlan(p => p ? {...p, isCramModeActive: isActive} : null); handleRebalance(); };
    const handleUpdateDeadlines = (newDeadlines: DeadlineSettings) => { setStudyPlan(p => p ? {...p, deadlines: newDeadlines} : null); handleRebalance(); };
    const handleUpdatePlanDates = (startDate: string, endDate: string) => { generateAndSetStudyPlan({ isInitial: true }); };
    const handleToggleSpecialTopicsInterleaving = (isActive: boolean) => { setStudyPlan(p => p ? {...p, areSpecialTopicsInterleaved: isActive} : null); handleRebalance(); };

    const handleAddOrUpdateException = (rule: ExceptionDateRule) => {
        setExceptionDates(prev => {
            const existingIndex = prev.findIndex(e => e.date === rule.date);
            if (existingIndex > -1) {
                const newRules = [...prev];
                newRules[existingIndex] = rule;
                return newRules;
            }
            return [...prev, rule];
        });
        handleRebalance();
    };

    const handleArchiveResource = useCallback((resourceId: string) => {
        setMasterResources(prev =>
            prev.map(r => (r.id === resourceId ? { ...r, isArchived: true } : r))
        );
        handleRebalance();
    }, [setMasterResources, handleRebalance]);

    const handleRestoreResource = useCallback((resourceId: string) => {
        setMasterResources(prev =>
            prev.map(r => (r.id === resourceId ? { ...r, isArchived: false } : r))
        );
    }, [setMasterResources]);

    const handlePermanentDeleteResource = useCallback((resourceId: string) => {
        setMasterResources(prev => prev.filter(r => r.id !== resourceId));
        handleRebalance();
    }, [setMasterResources, handleRebalance]);
    
    return {
        studyPlan,
        setStudyPlan,
        masterResources,
        setGlobalMasterResourcePool: setMasterResources,
        isLoading,
        loadingMessage,
        systemNotification,
        setSystemNotification,
        dbCheck,
        seedDatabase,
        loadSchedule,
        generateAndSetStudyPlan,
        handleRebalance,
        handleUpdatePlanDates,
        handleUpdateTopicOrderAndRebalance,
        handleUpdateCramTopicOrderAndRebalance,
        handleToggleCramMode,
        handleToggleSpecialTopicsInterleaving,
        handleTaskToggle,
        handleSaveModifiedDayTasks,
        saveStatus,
        handleAddOrUpdateException,
        handleMasterResetTasks,
        handleUpdateDeadlines,
        handleArchiveResource,
        handleRestoreResource,
        handlePermanentDeleteResource,
    };
};
