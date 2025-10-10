import { useState, useEffect, useCallback } from 'react';
import { 
  StudyPlan, 
  StudyResource, 
  DailySchedule, 
  ScheduledTask, 
  ExceptionDateRule, 
  ShowConfirmationOptions, 
  RebalanceOptions, 
  ScheduleSlot, 
  Run, 
  Domain, 
  DeadlineSettings,
  PlanDataBlob 
} from '../types';
import { usePersistentState } from './usePersistentState';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { supabase } from '../services/supabaseClient';
import { STUDY_START_DATE, STUDY_END_DATE, DEFAULT_TOPIC_ORDER } from '../constants';
import { parseDateString } from '../utils/timeFormatter';

// Debounce helper
function debounce<T extends (...args: any[]) => void>(func: T, delay: number) {
  let timeout: ReturnType<typeof setTimeout>;
  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

export const useStudyPlanManager = (showConfirmation: (options: ShowConfirmationOptions) => void) => {
  const [studyPlan, setStudyPlan] = usePersistentState<StudyPlan | null>('radiology_study_plan_v3', null);
  const [masterResources, setGlobalMasterResourcePool] = usePersistentState<StudyResource[]>('radiology_master_resources_v3', initialMasterResourcePool);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing...');
  const [dbCheck, setDbCheck] = useState({ checked: false, isSeeded: false });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [systemNotification, setSystemNotification] = useState<{ type: 'info' | 'warning' | 'error', message: string } | null>(null);

  // --- Utility/Helper Functions ---
  const calculateProgress = (schedule: DailySchedule[]): StudyPlan['progressPerDomain'] => {
    const progress: StudyPlan['progressPerDomain'] = {};
    const allTasks = schedule.flatMap(day => day.tasks);

    for (const domain of Object.values(Domain)) {
      progress[domain] = { completedMinutes: 0, totalMinutes: 0 };
    }

    allTasks.forEach(task => {
      const domain = task.originalTopic;
      if (progress[domain]) {
        progress[domain]!.totalMinutes += task.durationMinutes;
        if (task.status === 'completed') {
          progress[domain]!.completedMinutes += task.durationMinutes;
        }
      }
    });
    return progress;
  };

  const transformSlotsToSchedule = useCallback((
    slots: ScheduleSlot[],
    startDate: string,
    endDate: string,
    exceptions: ExceptionDateRule[],
    existingPlan?: StudyPlan | null
  ): DailySchedule[] => {
      const scheduleMap = new Map<string, DailySchedule>();
      const existingTasksStatus = new Map<string, 'pending' | 'completed' | 'in-progress'>();
      
      if (existingPlan) {
          existingPlan.schedule.forEach(day => {
              day.tasks.forEach(task => {
                  existingTasksStatus.set(task.id, task.status);
              });
          });
      }

      let currentDate = parseDateString(startDate);
      const end = parseDateString(endDate);

      while (currentDate <= end) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const exception = exceptions.find(e => e.date === dateStr);
          scheduleMap.set(dateStr, {
              date: dateStr,
              tasks: [],
              totalStudyTimeMinutes: exception?.targetMinutes ?? 0,
              isRestDay: exception?.isRestDayOverride ?? false,
              dayType: exception?.dayType ?? 'workday',
              dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
              isManuallyModified: false,
          });
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
      
      slots.forEach(slot => {
          const day = scheduleMap.get(slot.date);
          if (day) {
              const resource = masterResources.find(r => r.id === slot.resource_id);
              if (resource) {
                  const taskId = `${slot.date}-${slot.resource_id}`;
                  const newTask: ScheduledTask = {
                      id: taskId,
                      resourceId: resource.id,
                      title: resource.title,
                      type: resource.type,
                      originalTopic: resource.domain,
                      durationMinutes: slot.end_minute - slot.start_minute,
                      status: existingTasksStatus.get(taskId) || 'pending',
                      order: slot.start_minute,
                      startTime: `${String(Math.floor(slot.start_minute / 60)).padStart(2, '0')}:${String(slot.start_minute % 60).padStart(2, '0')}`,
                      originalResourceId: resource.id,
                      bookSource: resource.bookSource,
                      videoSource: resource.videoSource,
                      chapterNumber: resource.chapterNumber,
                      pages: resource.pages,
                      questionCount: resource.questionCount,
                      isPrimaryMaterial: resource.isPrimaryMaterial,
                  };
                  day.tasks.push(newTask);
              }
          }
      });

      scheduleMap.forEach(day => {
          day.tasks.sort((a, b) => a.order - b.order);
          day.totalStudyTimeMinutes = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
      });

      return Array.from(scheduleMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [masterResources]);
  
  // --- DB Interactions ---
  const savePlanToDb = useCallback(debounce(async (plan: StudyPlan | null) => {
    if (!plan) return;
    setSaveStatus('saving');
    try {
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) {
            // Silently fail if not logged in, as localStorage works.
            setSaveStatus('idle');
            return;
        };
        
        const blob: PlanDataBlob = { plan, resources: masterResources, exceptions: [] };
        
        const { error } = await supabase.from('study_plans').upsert({ id: user.user.id, data: blob }, { onConflict: 'id' });
        
        if (error) throw error;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error: any) {
        console.error('Error saving plan to DB:', error);
        setSaveStatus('error');
    }
  }, 2000), [masterResources]);
  
  useEffect(() => {
    if (studyPlan) {
      savePlanToDb(studyPlan);
    }
  }, [studyPlan, savePlanToDb]);

  const seedDatabase = useCallback(async () => {
    setIsLoading(true);
    setLoadingMessage('Seeding database with resources...');
    try {
      const { error } = await supabase.from('resources').insert(initialMasterResourcePool);
      if (error && error.code !== '23505') { 
        throw error;
      }
      setDbCheck({ checked: true, isSeeded: true });
      setLoadingMessage('Database seeded successfully!');
    } catch (error: any) {
      console.error('Database seeding failed:', error);
      setLoadingMessage(`Database seeding failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkDbSeeded = useCallback(async () => {
    setLoadingMessage('Checking database...');
    try {
      const { count } = await supabase.from('resources').select('*', { count: 'exact', head: true });
      const isSeeded = (count ?? 0) > 0;
      setDbCheck({ checked: true, isSeeded });
      if (!isSeeded) {
          setLoadingMessage('Database needs to be seeded.');
      } else {
          setLoadingMessage('Database ready.');
      }
    } catch (error: any) {
      console.error('DB check failed:', error);
      setLoadingMessage('Could not connect to the database.');
    }
  }, []);

  useEffect(() => {
    checkDbSeeded();
  }, [checkDbSeeded]);

  // --- Core Scheduling Logic ---
  const generateAndSetStudyPlan = useCallback(async (options: { isInitial: boolean; rebalanceOptions?: RebalanceOptions }) => {
    setIsLoading(true);
    setLoadingMessage('Requesting new schedule from solver...');

    try {
        const res = await fetch('/api/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startDate: STUDY_START_DATE, endDate: STUDY_END_DATE }),
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start solver.');

        const { run_id } = data;
        setLoadingMessage('Solver is working... This may take a minute.');

        let runStatus: Run | null = null;
        const pollInterval = 5000;
        const maxAttempts = 60;
        let attempts = 0;

        while (attempts < maxAttempts) {
            attempts++;
            const runRes = await fetch(`/api/runs/${run_id}`);
            const runData = await runRes.json();
            
            if (!runRes.ok) throw new Error(runData.error || 'Failed to get run status.');
            
            runStatus = runData as Run;
            if (runStatus.status === 'COMPLETE' || runStatus.status === 'FAILED') {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        if (!runStatus || runStatus.status !== 'COMPLETE') {
            throw new Error(runStatus?.error_text || 'Solver timed out or failed.');
        }

        setLoadingMessage('Schedule received! Finalizing plan...');
        
        const newSchedule = transformSlotsToSchedule(
            (runStatus as any).slots, 
            STUDY_START_DATE, 
            STUDY_END_DATE, 
            [],
            options.isInitial ? null : studyPlan
        );
        
        const newPlan: StudyPlan = {
            startDate: STUDY_START_DATE,
            endDate: STUDY_END_DATE,
            schedule: newSchedule,
            progressPerDomain: calculateProgress(newSchedule),
            topicOrder: studyPlan?.topicOrder || DEFAULT_TOPIC_ORDER,
            cramTopicOrder: studyPlan?.cramTopicOrder || [],
            deadlines: studyPlan?.deadlines || {},
            isCramModeActive: studyPlan?.isCramModeActive || false,
            areSpecialTopicsInterleaved: studyPlan?.areSpecialTopicsInterleaved ?? true
        };
        
        setStudyPlan(newPlan);

    } catch (err: any) {
        console.error('Failed to generate study plan:', err);
        setLoadingMessage(`Error: ${err.message}`);
    } finally {
        setIsLoading(false);
    }
  }, [setStudyPlan, transformSlotsToSchedule, studyPlan]);
  
  useEffect(() => {
    if (dbCheck.isSeeded && !studyPlan) {
      generateAndSetStudyPlan({ isInitial: true, rebalanceOptions: { type: 'standard' } });
    } else if (studyPlan) {
      setIsLoading(false);
    }
  }, [dbCheck.isSeeded, studyPlan, generateAndSetStudyPlan]);

  const handleRebalance = useCallback(async (options: RebalanceOptions = { type: 'standard' }) => {
    await generateAndSetStudyPlan({ isInitial: false, rebalanceOptions: options });
  }, [generateAndSetStudyPlan]);
  
  const updatePlanAndProgress = (newSchedule: DailySchedule[]) => {
      setStudyPlan(prev => prev ? ({ ...prev, schedule: newSchedule, progressPerDomain: calculateProgress(newSchedule) }) : null);
  };
  
  const handleTaskToggle = useCallback((taskId: string, date: string) => {
    if (!studyPlan) return;
    const newSchedule = studyPlan.schedule.map(day => {
        if (day.date === date) {
            return {
                ...day,
                tasks: day.tasks.map(task => {
                    if (task.id === taskId) {
                        // FIX: Destructuring status from task to prevent TypeScript from widening the
                        // 'status' property to `string` when using the spread operator on an object
                        // that comes from JSON.parse(). This ensures the new object has a correctly
                        // typed 'status' property.
                        const { status, ...restOfTask } = task;
                        return { ...restOfTask, status: status === 'completed' ? 'pending' : 'completed' };
                    }
                    return task;
                })
            };
        }
        return day;
    });
    updatePlanAndProgress(newSchedule);
  }, [studyPlan]);

  const handleSaveModifiedDayTasks = useCallback((updatedTasks: ScheduledTask[], date: string) => {
    if (!studyPlan) return;
    const newSchedule = studyPlan.schedule.map(day => {
        if (day.date === date) {
            const reorderedTasks = updatedTasks.map((task, index) => ({ ...task, order: index }));
            return { ...day, tasks: reorderedTasks, isManuallyModified: true };
        }
        return day;
    });
    updatePlanAndProgress(newSchedule);
  }, [studyPlan]);
  
  const handleUpdatePlanDates = (startDate: string, endDate: string) => {
      showConfirmation({
          title: 'Confirm Date Change',
          message: 'Changing plan dates will regenerate the entire schedule and reset all progress. This action cannot be undone.',
          confirmText: 'Regenerate',
          confirmVariant: 'danger',
          onConfirm: async () => {
              setStudyPlan(null); 
              await generateAndSetStudyPlan({ isInitial: true, rebalanceOptions: { type: 'standard' } });
          }
      });
  };
  
  const handleUpdateTopicOrderAndRebalance = (newOrder: Domain[]) => {
      setStudyPlan(p => p ? {...p, topicOrder: newOrder} : null);
      handleRebalance();
  };
  const handleUpdateCramTopicOrderAndRebalance = (newOrder: Domain[]) => {
      setStudyPlan(p => p ? {...p, cramTopicOrder: newOrder} : null);
      handleRebalance();
  };
  const handleToggleCramMode = (isActive: boolean) => {
      setStudyPlan(p => p ? {...p, isCramModeActive: isActive} : null);
      handleRebalance();
  };
  const handleToggleSpecialTopicsInterleaving = (isActive: boolean) => {
      setStudyPlan(p => p ? {...p, areSpecialTopicsInterleaved: isActive} : null);
      handleRebalance();
  };

  const handleAddOrUpdateException = (rule: ExceptionDateRule) => {
      console.log('Adding exception and rebalancing:', rule);
      handleRebalance();
  };
  
  const handleMasterResetTasks = () => {
      if (!studyPlan) return;
      const newSchedule = studyPlan.schedule.map(day => ({
          ...day,
          tasks: day.tasks.map(t => {
            // FIX: Destructuring status from task to prevent TypeScript from widening the
            // 'status' property to `string` when using the spread operator on an object
            // that comes from JSON.parse(). This ensures the new object has a correctly
            // typed 'status' property.
            const { status, ...restOfTask } = t;
            return {...restOfTask, status: 'pending', actualStudyTimeMinutes: 0};
          })
      }));
      updatePlanAndProgress(newSchedule);
  };
  
  const handleUpdateDeadlines = (newDeadlines: DeadlineSettings) => {
      setStudyPlan(p => p ? {...p, deadlines: newDeadlines} : null);
      handleRebalance();
  };
  
  const handleArchiveResource = (resourceId: string) => {
    setGlobalMasterResourcePool(prev => prev.map(r => r.id === resourceId ? {...r, isArchived: true} : r));
  };

  const handleRestoreResource = (resourceId: string) => {
    setGlobalMasterResourcePool(prev => prev.map(r => r.id === resourceId ? {...r, isArchived: false} : r));
  };
  
  const handlePermanentDeleteResource = (resourceId: string) => {
    setGlobalMasterResourcePool(prev => prev.filter(r => r.id !== resourceId));
  };

  return {
    studyPlan, setStudyPlan,
    masterResources, setGlobalMasterResourcePool,
    isLoading, loadingMessage, systemNotification, setSystemNotification,
    dbCheck, seedDatabase,
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
    handlePermanentDeleteResource
  };
};
