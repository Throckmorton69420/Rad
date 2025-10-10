import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, ScheduledTask, GeneratedStudyPlanOutcome, Domain, ResourceType, PlanDataBlob, DeadlineSettings, ShowConfirmationOptions, DailySchedule, ScheduleSlot } from '../types';
import { supabase } from '../services/supabaseClient';
import { DEFAULT_TOPIC_ORDER, STUDY_END_DATE, STUDY_START_DATE } from '../constants';

const processSolverResults = (slots: ScheduleSlot[], planShell: StudyPlan): StudyPlan => {
    const scheduleMap = new Map<string, DailySchedule>();
    planShell.schedule.forEach(day => {
        scheduleMap.set(day.date, { ...day, tasks: [], totalStudyTimeMinutes: 0 });
    });

    slots.forEach(slot => {
        const day = scheduleMap.get(slot.date);
        if (day) {
            const duration = slot.end_minute - slot.start_minute;
            const task: ScheduledTask = {
                id: `task_${slot.resource_id}_${slot.start_minute}`,
                resourceId: slot.resource_id,
                title: slot.title,
                type: slot.type,
                originalTopic: slot.domain,
                durationMinutes: duration,
                status: 'pending',
                order: slot.start_minute,
            };
            day.tasks.push(task);
            day.totalStudyTimeMinutes += duration;
        }
    });

    const finalSchedule = Array.from(scheduleMap.values());
    finalSchedule.forEach(day => day.tasks.sort((a, b) => a.order - b.order));

    return { ...planShell, schedule: finalSchedule };
};

export const useStudyPlanManager = (showConfirmation: (options: ShowConfirmationOptions) => void) => {
    const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
    const [previousStudyPlan, setPreviousStudyPlan] = useState<StudyPlan | null>(null);
    const [globalMasterResourcePool, setGlobalMasterResourcePool] = useState<StudyResource[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [loadingMessage, setLoadingMessage] = useState<string>('Initializing...');
    const [systemNotification, setSystemNotification] = useState<{ type: 'error' | 'warning' | 'info', message: string } | null>(null);
    const [isNewUser, setIsNewUser] = useState(false);
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    
    const pollingIntervalRef = useRef<number | null>(null);

    const updatePreviousStudyPlan = useCallback((plan: StudyPlan | null) => {
        if (plan) setPreviousStudyPlan(JSON.parse(JSON.stringify(plan)));
    }, []);

    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, []);
    
    const pollForScheduleResults = useCallback((runId: string) => {
        stopPolling();
        setLoadingMessage('Solver is working... Awaiting results.');
        setIsLoading(true);

        pollingIntervalRef.current = window.setInterval(async () => {
            try {
                const { data: run, error } = await supabase.from('runs').select('status, error_text').eq('id', runId).single();
                if (error) throw error;
                
                if (run.status === 'COMPLETE') {
                    stopPolling();
                    setLoadingMessage('Processing final schedule...');
                    const { data: slots, error: slotsError } = await supabase.from('schedule_slots').select('*').eq('run_id', runId);
                    if (slotsError) throw slotsError;

                    setStudyPlan(prevPlan => {
                        if (!prevPlan) return null;
                        const finalPlan = processSolverResults(slots, prevPlan);
                        updatePreviousStudyPlan(finalPlan);
                        return finalPlan;
                    });
                    setSystemNotification({ type: 'info', message: 'Schedule generated successfully!' });
                    setIsLoading(false);
                    setActiveRunId(null);
                } else if (run.status === 'FAILED') {
                    stopPolling();
                    setSystemNotification({ type: 'error', message: `Schedule generation failed: ${run.error_text || 'Unknown solver error.'}` });
                    setIsLoading(false);
                    setActiveRunId(null);
                }
            } catch (error: any) {
                stopPolling();
                setSystemNotification({ type: 'error', message: `Error checking schedule status: ${error.message}` });
                setIsLoading(false);
                setActiveRunId(null);
            }
        }, 5000); // Poll every 5 seconds

    }, [stopPolling, updatePreviousStudyPlan]);

    const requestScheduleGeneration = useCallback(async () => {
        if (isLoading) return;
        setIsLoading(true);
        setLoadingMessage('Requesting new schedule from solver...');
        setSystemNotification(null);
        if (studyPlan) updatePreviousStudyPlan(studyPlan);

        try {
            const res = await fetch('/api/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate: STUDY_START_DATE, endDate: STUDY_END_DATE }),
            });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to start schedule generation.');
            }
            const { run_id } = await res.json();
            setActiveRunId(run_id);
            pollForScheduleResults(run_id);
        } catch (error: any) {
            setSystemNotification({ type: 'error', message: error.message });
            setIsLoading(false);
        }
    }, [isLoading, studyPlan, updatePreviousStudyPlan, pollForScheduleResults]);

    const loadSchedule = useCallback(async (regenerate = false) => {
        setIsLoading(true);
        setLoadingMessage('Connecting to the cloud...');
        
        try {
            // Fetch resources first, always
            const { data: resources, error: resourcesError } = await supabase.from('resources').select('*');
            if (resourcesError) throw resourcesError;
            setGlobalMasterResourcePool(resources || []);

            // Then check for an existing plan
            const { data: planData, error: planError } = await supabase.from('study_plans').select('plan_data').eq('id', 1).single();
            if (planError && planError.code !== 'PGRST116') throw planError;
            
            if (planData?.plan_data && !regenerate) {
                setStudyPlan(planData.plan_data as StudyPlan);
                setIsNewUser(false);
            } else {
                setIsNewUser(true);
                setStudyPlan(null); // Triggers the "Generate" screen
            }
        } catch (err: any) {
            setSystemNotification({ type: 'error', message: err.message || "Failed to load initial data." });
            setStudyPlan(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // FIX: Updated handleRebalance to accept optional options to fix signature mismatches.
    const handleRebalance = useCallback((options?: RebalanceOptions) => {
        showConfirmation({
            title: "Rebalance Schedule?",
            message: "This will request a new schedule from the solver based on current settings and data. Are you sure?",
            confirmText: "Yes, Rebalance",
            onConfirm: requestScheduleGeneration,
        });
    }, [showConfirmation, requestScheduleGeneration]);

    // FIX: Added explicit type to newStatus to prevent incorrect type inference to 'string'.
    const handleTaskToggle = (taskId: string, date: string) => {
        setStudyPlan(plan => {
            if (!plan) return null;
            const newSchedule = plan.schedule.map(day => {
                if (day.date === date) {
                    return { ...day, tasks: day.tasks.map(task => task.id === taskId ? { ...task, status: task.status === 'completed' ? 'pending' : 'completed' } : task) };
                }
                return day;
            });
            return { ...plan, schedule: newSchedule };
        });
    };
    
    const handleUndo = useCallback(() => {
        if(previousStudyPlan) {
            setStudyPlan(previousStudyPlan);
            setPreviousStudyPlan(null); // Can only undo once
        }
    }, [previousStudyPlan]);

    useEffect(() => {
        return () => stopPolling();
    }, [stopPolling]);

    // FIX: Implemented state-modifying handlers to replace incorrect aliases.
    const handleUpdatePlanDates = useCallback(() => {
        handleRebalance();
    }, [handleRebalance]);

    const handleUpdateTopicOrderAndRebalance = useCallback((newOrder: Domain[]) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        setStudyPlan(p => (p ? { ...p, topicOrder: newOrder } : null));
        handleRebalance();
    }, [studyPlan, updatePreviousStudyPlan, handleRebalance]);

    const handleUpdateCramTopicOrderAndRebalance = useCallback((newOrder: Domain[]) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        setStudyPlan(p => (p ? { ...p, cramTopicOrder: newOrder } : null));
        handleRebalance();
    }, [studyPlan, updatePreviousStudyPlan, handleRebalance]);
    
    const handleToggleCramMode = useCallback((isActive: boolean) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        setStudyPlan(p => (p ? { ...p, isCramModeActive: isActive } : null));
        handleRebalance();
    }, [studyPlan, updatePreviousStudyPlan, handleRebalance]);
    
    const handleToggleSpecialTopicsInterleaving = useCallback((isActive: boolean) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        setStudyPlan(p => (p ? { ...p, areSpecialTopicsInterleaved: isActive } : null));
        handleRebalance();
      }, [studyPlan, updatePreviousStudyPlan, handleRebalance]);

    const handleAddOrUpdateException = useCallback((rule: ExceptionDateRule) => {
        handleRebalance();
    }, [handleRebalance]);

    const handleSaveModifiedDayTasks = useCallback((updatedTasks: ScheduledTask[], date: string) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        setStudyPlan(p => {
            if (!p) return null;
            const newSchedule = p.schedule.map(day => {
                if (day.date === date) {
                    const reorderedTasks = updatedTasks.map((task, index) => ({...task, order: index}));
                    return {...day, tasks: reorderedTasks, isManuallyModified: true };
                }
                return day;
            });
            return { ...p, schedule: newSchedule };
        });
        handleRebalance();
    }, [studyPlan, updatePreviousStudyPlan, handleRebalance]);

    const handleMasterResetTasks = useCallback(() => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        setStudyPlan(prev => prev ? ({ ...prev, schedule: prev.schedule.map(d => ({ ...d, tasks: d.tasks.map(t => ({...t, status: 'pending'})) }))}) : null);
    }, [studyPlan, updatePreviousStudyPlan]);
    
    const handleUpdateDeadlines = useCallback((newDeadlines: DeadlineSettings) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        setStudyPlan(p => (p ? { ...p, deadlines: newDeadlines } : null));
        handleRebalance();
    }, [studyPlan, updatePreviousStudyPlan, handleRebalance]);
    
    const handleToggleRestDay = useCallback((date: string, isCurrentlyRestDay: boolean) => {
        handleRebalance();
    }, [handleRebalance]);

    return {
        studyPlan, setStudyPlan, previousStudyPlan,
        globalMasterResourcePool, setGlobalMasterResourcePool,
        isLoading, loadingMessage, systemNotification, setSystemNotification,
        isNewUser,
        loadSchedule,
        handleRebalance,
        handleTaskToggle,
        handleUndo,
        handleUpdatePlanDates,
        handleUpdateTopicOrderAndRebalance,
        handleUpdateCramTopicOrderAndRebalance,
        handleToggleCramMode,
        handleToggleSpecialTopicsInterleaving,
        handleAddOrUpdateException,
        handleSaveModifiedDayTasks,
        handleMasterResetTasks,
        handleUpdateDeadlines,
        handleToggleRestDay,
        updatePreviousStudyPlan,
    };
};
