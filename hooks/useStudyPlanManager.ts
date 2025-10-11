import { useState, useCallback, useRef, useEffect } from 'react';
import {
  StudyPlan, StudyResource, ExceptionDateRule, DailySchedule, ScheduledTask, RebalanceOptions,
  ShowConfirmationOptions, Domain, DeadlineSettings, PlanDataBlob, ScheduleSlot, Run
} from '../types';
import { usePersistentState } from './usePersistentState';
import { STUDY_START_DATE, STUDY_END_DATE, DEFAULT_TOPIC_ORDER, DEFAULT_DAILY_STUDY_MINS } from '../constants';

const POLLING_INTERVAL = 3000; // Poll every 3 seconds
const MAX_POLLING_ATTEMPTS = 120; // Max wait time of 6 minutes

const transformSolverSlotsToSchedule = (
    slots: ScheduleSlot[],
    resources: StudyResource[],
    startDate: string,
    endDate: string,
    allExceptionRules: ExceptionDateRule[]
): DailySchedule[] => {
    const resourceMap = new Map(resources.map(r => [r.id, r]));
    const scheduleMap = new Map<string, ScheduledTask[]>();

    for (const slot of slots) {
        const resource = resourceMap.get(slot.resource_id);
        if (!resource) continue;

        if (!scheduleMap.has(slot.date)) {
            scheduleMap.set(slot.date, []);
        }

        const task: ScheduledTask = {
            id: `${slot.date}-${resource.id}-${slot.start_minute}`,
            resourceId: resource.id,
            originalResourceId: resource.id,
            title: resource.title,
            type: resource.type,
            originalTopic: resource.domain,
            durationMinutes: slot.end_minute - slot.start_minute,
            status: 'pending',
            order: slot.start_minute,
            bookSource: resource.bookSource,
            videoSource: resource.videoSource,
            pages: resource.pages,
            questionCount: resource.questionCount,
            chapterNumber: resource.chapterNumber,
            isPrimaryMaterial: resource.isPrimaryMaterial,
        };
        scheduleMap.get(slot.date)!.push(task);
    }
    
    const fullSchedule: DailySchedule[] = [];
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const tasksForDay = scheduleMap.get(dateStr) || [];
        tasksForDay.sort((a, b) => a.order - b.order);

        const exception = allExceptionRules.find(e => e.date === dateStr);
        const totalStudyTimeMinutes = tasksForDay.reduce((sum, t) => sum + t.durationMinutes, 0);

        fullSchedule.push({
            date: dateStr,
            tasks: tasksForDay,
            totalStudyTimeMinutes: exception?.targetMinutes ?? totalStudyTimeMinutes,
            isRestDay: exception?.isRestDayOverride ?? (totalStudyTimeMinutes === 0 && tasksForDay.length === 0),
            dayType: exception?.dayType ?? (d.getUTCDay() % 6 === 0 ? 'high-capacity' : 'workday'),
            dayName: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        });
    }
    return fullSchedule;
};


export const useStudyPlanManager = (showConfirmation: (options: ShowConfirmationOptions) => void) => {
    const [studyPlan, setStudyPlan] = usePersistentState<StudyPlan | null>('radiology_study_plan', null);
    const [previousStudyPlan, setPreviousStudyPlan] = useState<StudyPlan | null>(null);
    const [globalMasterResourcePool, setGlobalMasterResourcePool] = usePersistentState<StudyResource[]>('radiology_master_resources', []);
    const [exceptionDates, setExceptionDates] = usePersistentState<ExceptionDateRule[]>('radiology_exception_dates', []);
    const [activeRunId, setActiveRunId] = usePersistentState<string | null>('radiology_active_run_id', null);
    const [isLoading, setIsLoading] = useState(false);
    const [systemNotification, setSystemNotification] = useState<{ type: 'info' | 'error', message: string } | null>(null);
    const [isNewUser, setIsNewUser] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState('');

    const pollingAttemptsRef = useRef(0);

    const updatePreviousStudyPlan = useCallback((plan: StudyPlan) => {
        setPreviousStudyPlan(JSON.parse(JSON.stringify(plan)));
    }, []);
    
    const stopPolling = useCallback((run_id_to_clear: string | null = null) => {
        setActiveRunId(currentId => {
            // Only clear the run ID if it's the one we intended to stop,
            // preventing race conditions where a new run starts before the old one stops.
            if (run_id_to_clear === null || currentId === run_id_to_clear) {
                return null;
            }
            return currentId;
        });
        pollingAttemptsRef.current = 0;
        setIsLoading(false);
    }, [setActiveRunId]);

    const pollRunStatus = useCallback(async (run_id: string) => {
        if (pollingAttemptsRef.current >= MAX_POLLING_ATTEMPTS) {
            setSystemNotification({ type: 'error', message: 'Solver timed out. The server is taking too long to respond. Please try again later.' });
            stopPolling(run_id);
            return;
        }
        pollingAttemptsRef.current++;

        try {
            const res = await fetch(`/api/runs/${run_id}`);
            if (!res.ok) throw new Error(`Server returned status ${res.status}`);
            
            const data: Run & { slots?: ScheduleSlot[] } = await res.json();
            
            const currentProgress = data.progress || 0;
            if(currentProgress >= 0) {
              setProgress(currentProgress);
            }

            if (data.status === 'SOLVING') {
                 if (currentProgress < 15) setProgressMessage('Analyzing resources and constraints...');
                 else if (currentProgress < 25) setProgressMessage('Building optimization model...');
                 else if (currentProgress < 85) setProgressMessage('Solving schedule... this is the longest step.');
                 else if (currentProgress < 95) setProgressMessage('Finalizing results...');
                 else setProgressMessage('Saving new schedule...');
            }
            
            if (data.status === 'COMPLETE' && data.slots) {
                stopPolling(run_id);
                setProgress(100);
                setProgressMessage('Schedule complete! Loading...');
                
                const startDate = data.start_date || studyPlan?.startDate || STUDY_START_DATE;
                const endDate = data.end_date || studyPlan?.endDate || STUDY_END_DATE;
                
                const newSchedule = transformSolverSlotsToSchedule(data.slots, globalMasterResourcePool, startDate, endDate, exceptionDates);
                
                setTimeout(() => {
                    setStudyPlan(plan => ({
                        ...(plan || {
                            startDate,
                            endDate,
                            progressPerDomain: {},
                            topicOrder: DEFAULT_TOPIC_ORDER,
                            cramTopicOrder: [],
                            deadlines: {},
                            areSpecialTopicsInterleaved: true,
                        }),
                        schedule: newSchedule,
                    }));
                    setSystemNotification({ type: 'info', message: 'New schedule generated successfully!' });
                }, 500); // Short delay for the "Loading..." message to show
            } else if (data.status === 'FAILED') {
                setSystemNotification({ type: 'error', message: `Solver failed: ${data.error_text || 'An unknown error occurred.'}` });
                stopPolling(run_id);
            }
        } catch (error: any) {
            setSystemNotification({ type: 'error', message: `Error checking status: ${error.message}` });
            stopPolling(run_id);
        }
    }, [setStudyPlan, stopPolling, globalMasterResourcePool, exceptionDates, studyPlan]);
    
    // This useEffect is the heart of the robust polling mechanism.
    // It automatically starts and stops the polling interval based on activeRunId.
    useEffect(() => {
        if (activeRunId) {
            const intervalId = setInterval(() => pollRunStatus(activeRunId), POLLING_INTERVAL);
            return () => clearInterval(intervalId);
        }
    }, [activeRunId, pollRunStatus]);


    const triggerSolver = useCallback(async (isInitialGeneration: boolean, startDate: string, endDate: string) => {
        setIsLoading(true);
        setProgress(0);
        setProgressMessage('Initiating solver service...');
        pollingAttemptsRef.current = 0;

        try {
            const res = await fetch('/api/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate })
            });

            if (!res.ok) throw new Error(`Server responded with ${res.status}`);
            
            const { run_id } = await res.json();
            setActiveRunId(run_id); // This will trigger the useEffect to start polling
            setProgressMessage(`Solver initiated... This may take several minutes.`);
        } catch (error: any) {
            setSystemNotification({ type: 'error', message: `Failed to start solver: ${error.message}` });
            setIsLoading(false);
            setActiveRunId(null);
        }
    }, [setActiveRunId]);

    const loadSchedule = useCallback(async (regenerate = false) => {
        setIsLoading(true);

        if (activeRunId && !regenerate) {
            setProgressMessage('Re-attaching to running solver job...');
            // The useEffect will handle the polling automatically.
            // We just need to ensure the UI is in a loading state.
            return;
        }

        if(regenerate) {
            triggerSolver(true, studyPlan?.startDate || STUDY_START_DATE, studyPlan?.endDate || STUDY_END_DATE);
            return;
        }

        try {
            const localPlan = localStorage.getItem('radiology_study_plan');
            if (localPlan) {
                setStudyPlan(JSON.parse(localPlan));
                setSystemNotification({ type: 'info', message: 'Loaded schedule from local storage.' });
                setIsLoading(false);
            } else {
                setIsNewUser(true);
                triggerSolver(true, STUDY_START_DATE, STUDY_END_DATE);
            }
        } catch (error: any) {
            setSystemNotification({ type: 'error', message: `Failed to load data: ${error.message}` });
            setIsLoading(false);
        }
    }, [triggerSolver, setStudyPlan, activeRunId, studyPlan]);
    
    const handleRebalance = useCallback(async (options: RebalanceOptions = { type: 'standard' }) => {
        showConfirmation({
            title: "Rebalance Schedule?",
            message: "This will re-calculate and overwrite all future, non-completed tasks based on your current progress and settings. Proceed?",
            confirmText: "Rebalance",
            onConfirm: () => triggerSolver(false, studyPlan?.startDate || STUDY_START_DATE, studyPlan?.endDate || STUDY_END_DATE)
        });
    }, [showConfirmation, triggerSolver, studyPlan]);
    
    const handleTaskToggle = useCallback((taskId: string, date: string) => {
        setStudyPlan(plan => {
            if (!plan) return null;
            updatePreviousStudyPlan(plan);
            const newSchedule = plan.schedule.map(day => {
                if (day.date === date) {
                    return {
                        ...day,
                        tasks: day.tasks.map(task => {
                            if (task.id === taskId) {
                                const newStatus = task.status === 'completed' ? 'pending' : 'completed';
                                return { ...task, status: newStatus as 'pending' | 'completed' };
                            }
                            return task;
                        })
                    };
                }
                return day;
            });
            return { ...plan, schedule: newSchedule };
        });
    }, [setStudyPlan, updatePreviousStudyPlan]);

    const handleSaveModifiedDayTasks = useCallback((updatedTasks: ScheduledTask[], date: string) => {
        setStudyPlan(plan => {
            if (!plan) return null;
            updatePreviousStudyPlan(plan);
            const newSchedule = plan.schedule.map(day => {
                if (day.date === date) {
                    return { ...day, tasks: updatedTasks, isManuallyModified: true };
                }
                return day;
            });
            return { ...plan, schedule: newSchedule };
        });
    }, [setStudyPlan, updatePreviousStudyPlan]);
    
    const handleUndo = useCallback(() => {
        if (previousStudyPlan) {
            setStudyPlan(previousStudyPlan);
            setPreviousStudyPlan(null); // Prevent multiple undos from the same state.
            setSystemNotification({ type: 'info', message: 'Last action undone.' });
        } else {
            setSystemNotification({ type: 'info', message: 'No action to undo.' });
        }
    }, [previousStudyPlan, setStudyPlan]);

    const handleUpdatePlanDates = useCallback((startDate: string, endDate: string) => {
        showConfirmation({
            title: "Regenerate with New Dates?",
            message: "Changing plan dates requires a full regeneration of the schedule. All progress will be reset. Are you sure?",
            confirmVariant: 'danger',
            confirmText: 'Regenerate',
            onConfirm: () => triggerSolver(true, startDate, endDate),
        })
    }, [showConfirmation, triggerSolver]);

    const handleUpdateTopicOrderAndRebalance = useCallback((newOrder: Domain[]) => {
        setStudyPlan(p => p ? {...p, topicOrder: newOrder} : null);
        handleRebalance();
    }, [handleRebalance, setStudyPlan]);

    const handleUpdateCramTopicOrderAndRebalance = useCallback((newOrder: Domain[]) => {
        setStudyPlan(p => p ? {...p, cramTopicOrder: newOrder} : null);
        handleRebalance();
    }, [handleRebalance, setStudyPlan]);

    const handleToggleCramMode = useCallback((isActive: boolean) => {
        setStudyPlan(p => p ? {...p, isCramModeActive: isActive} : null);
        handleRebalance();
    }, [handleRebalance, setStudyPlan]);

    const handleToggleSpecialTopicsInterleaving = useCallback((isActive: boolean) => {
        setStudyPlan(p => p ? {...p, areSpecialTopicsInterleaved: isActive} : null);
        handleRebalance();
    }, [handleRebalance, setStudyPlan]);

    const handleToggleRestDay = useCallback((date: string, isCurrentlyRestDay: boolean) => {
        const newRule: ExceptionDateRule = {
            date: date,
            dayType: 'specific-rest',
            isRestDayOverride: !isCurrentlyRestDay,
            targetMinutes: isCurrentlyRestDay ? DEFAULT_DAILY_STUDY_MINS : 0,
        };
        setExceptionDates(prev => [...prev.filter(r => r.date !== date), newRule]);
        handleRebalance();
    }, [handleRebalance, setExceptionDates]);

    const handleAddOrUpdateException = useCallback((rule: ExceptionDateRule) => {
        setExceptionDates(prev => [...prev.filter(r => r.date !== rule.date), rule]);
        handleRebalance();
    }, [handleRebalance, setExceptionDates]);

    const handleUpdateDeadlines = useCallback((newDeadlines: DeadlineSettings) => {
        setStudyPlan(p => p ? {...p, deadlines: newDeadlines} : null);
        handleRebalance();
    }, [handleRebalance, setStudyPlan]);
    
    const handleMasterResetTasks = useCallback(() => {
        setStudyPlan(plan => {
            if (!plan) return null;
            updatePreviousStudyPlan(plan);
            const newSchedule = plan.schedule.map(day => ({
                ...day,
                tasks: day.tasks.map(task => ({ ...task, status: 'pending' as const, actualStudyTimeMinutes: 0 }))
            }));
            return { ...plan, schedule: newSchedule };
        });
        setSystemNotification({type: 'info', message: 'All task progress has been reset.'});
    }, [setStudyPlan, updatePreviousStudyPlan]);

    return {
        studyPlan, setStudyPlan, previousStudyPlan,
        globalMasterResourcePool, setGlobalMasterResourcePool,
        isLoading, systemNotification, setSystemNotification,
        isNewUser, progress, progressMessage,
        loadSchedule, handleRebalance, handleUpdatePlanDates, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
        handleToggleCramMode,
        handleToggleSpecialTopicsInterleaving,
        handleTaskToggle, handleSaveModifiedDayTasks, handleUndo,
        updatePreviousStudyPlan,
        handleToggleRestDay,
        handleAddOrUpdateException,
        handleUpdateDeadlines,
        handleMasterResetTasks,
    };
};