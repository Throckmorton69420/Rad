import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, ScheduledTask, Domain, ResourceType, PlanDataBlob, DeadlineSettings, ShowConfirmationOptions, DailySchedule, ScheduleSlot } from '../types';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { supabase } from '../services/supabaseClient';
import { DEFAULT_TOPIC_ORDER, STUDY_END_DATE, STUDY_START_DATE } from '../constants';
import { getTodayInNewYork } from '../utils/timeFormatter';

// This function transforms the flat list of schedule slots from the solver
// into the nested structure the UI components expect.
const processSolverResults = (slots: ScheduleSlot[], existingPlanShell: StudyPlan): StudyPlan => {
    const scheduleMap = new Map<string, DailySchedule>();
    const resourceMap = new Map<string, StudyResource>();
    
    // Create a temporary map for quick resource lookup
    // This is a placeholder; in a real scenario, you'd fetch this from your global pool
    // or the solver would return all necessary data.
    slots.forEach(slot => {
        resourceMap.set(slot.resource_id, {
            id: slot.resource_id,
            title: slot.title,
            domain: slot.domain,
            type: slot.type,
            // Add other default/placeholder properties for StudyResource if needed
            durationMinutes: slot.end_minute - slot.start_minute,
            isPrimaryMaterial: false,
            isArchived: false,
        });
    });


    // Initialize schedule days from the existing plan shell
    existingPlanShell.schedule.forEach(day => {
        scheduleMap.set(day.date, { ...day, tasks: [], totalStudyTimeMinutes: 0, isManuallyModified: false });
    });

    slots.forEach(slot => {
        const day = scheduleMap.get(slot.date);
        if (day) {
            const resource = resourceMap.get(slot.resource_id);
            const task: ScheduledTask = {
                id: `task_${slot.resource_id}_${slot.date}`,
                resourceId: slot.resource_id,
                title: slot.title,
                type: slot.type as ResourceType,
                originalTopic: slot.domain as Domain,
                durationMinutes: slot.end_minute - slot.start_minute,
                status: 'pending', // All new tasks from the solver are pending
                order: slot.start_minute,
                bookSource: resource?.bookSource,
                videoSource: resource?.videoSource,
                isPrimaryMaterial: resource?.isPrimaryMaterial,
                schedulingPriority: resource?.schedulingPriority,
                isOptional: resource?.isOptional,
                chapterNumber: resource?.chapterNumber,
                pages: resource?.pages,
                questionCount: resource?.questionCount,
                originalResourceId: resource?.originalResourceId || resource?.id,
            };
            day.tasks.push(task);
            day.totalStudyTimeMinutes += task.durationMinutes;
        }
    });

    const finalSchedule = Array.from(scheduleMap.values());
    finalSchedule.forEach(day => {
        day.tasks.sort((a, b) => a.order - b.order);
        // Re-assign order based on sorted position for UI stability
        day.tasks.forEach((task, index) => task.order = index);
    });

    return { ...existingPlanShell, schedule: finalSchedule };
};


export const useStudyPlanManager = (showConfirmation: (options: ShowConfirmationOptions) => void) => {
    const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
    const [previousStudyPlan, setPreviousStudyPlan] = useState<StudyPlan | null>(null);
    const [globalMasterResourcePool, setGlobalMasterResourcePool] = useState<StudyResource[]>(initialMasterResourcePool);
    const [userExceptions, setUserExceptions] = useState<ExceptionDateRule[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [loadingMessage, setLoadingMessage] = useState<string>('Connecting to the cloud...');
    const [systemNotification, setSystemNotification] = useState<{ type: 'error' | 'warning' | 'info', message: string } | null>(null);
    const [isNewUser, setIsNewUser] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    
    const isInitialLoadRef = useRef(true);
    const debounceTimerRef = useRef<number | null>(null);
    const pollingIntervalRef = useRef<number | null>(null);

    const planStateRef = useRef({ studyPlan, userExceptions, globalMasterResourcePool });
    useEffect(() => {
        planStateRef.current = { studyPlan, userExceptions, globalMasterResourcePool };
    }, [studyPlan, userExceptions, globalMasterResourcePool]);

    const updatePreviousStudyPlan = useCallback((plan: StudyPlan) => {
        setPreviousStudyPlan(JSON.parse(JSON.stringify(plan)));
    }, []);

    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, []);

    const processAndSetFinalPlan = useCallback((runResult: any) => {
        setStudyPlan(prevPlan => {
            if (!prevPlan) return null;
            const finalPlan = processSolverResults(runResult.slots, prevPlan);
            
            const newProgressPerDomain = { ...finalPlan.progressPerDomain };
            Object.keys(newProgressPerDomain).forEach(domainKey => {
                const domain = domainKey as Domain;
                if (newProgressPerDomain[domain]) {
                    newProgressPerDomain[domain]!.completedMinutes = finalPlan.schedule.reduce((sum, day) => 
                        sum + day.tasks.reduce((taskSum, task) => 
                            (task.originalTopic === domain && task.status === 'completed') ? taskSum + task.durationMinutes : taskSum, 0), 0);
                }
            });
            return { ...finalPlan, progressPerDomain: newProgressPerDomain };
        });
        setSystemNotification({ type: 'info', message: 'Schedule generated successfully!' });
        setTimeout(() => setSystemNotification(null), 3000);
    }, []);
    
    const pollForScheduleResults = useCallback((runId: string) => {
        stopPolling();
        setLoadingMessage('Solver is working... Polling for results.');

        pollingIntervalRef.current = window.setInterval(async () => {
            try {
                const res = await fetch(`/api/runs/${runId}`);
                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`Failed to fetch run status: ${res.status} ${errorText}`);
                }
                const result = await res.json();
                
                if (result.status === 'COMPLETE') {
                    stopPolling();
                    setLoadingMessage('Processing final schedule...');
                    processAndSetFinalPlan(result);
                    setIsLoading(false);
                    setActiveRunId(null);
                } else if (result.status === 'FAILED') {
                    stopPolling();
                    setSystemNotification({ type: 'error', message: `Schedule generation failed: ${result.error_text || 'Unknown solver error.'}` });
                    setIsLoading(false);
                    setActiveRunId(null);
                }
            } catch (error: any) {
                console.error('Polling error:', error);
                stopPolling();
                setSystemNotification({ type: 'error', message: `Error checking schedule status: ${error.message}` });
                setIsLoading(false);
                setActiveRunId(null);
            }
        }, 3000);

    }, [processAndSetFinalPlan, stopPolling]);

    const requestScheduleGeneration = useCallback(async (options: { startDate: string, endDate: string }) => {
        setIsLoading(true);
        setLoadingMessage('Requesting new schedule from solver...');
        setSystemNotification(null);
        setActiveRunId(null);
        stopPolling(); // Ensure no old pollers are running

        try {
            const res = await fetch('/api/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to start schedule generation.');
            }

            const { run_id } = await res.json();
            setActiveRunId(run_id);
            pollForScheduleResults(run_id);

        } catch (error: any) {
            console.error("Error requesting schedule generation:", error);
            setSystemNotification({ type: 'error', message: error.message });
            setIsLoading(false);
        }
    }, [pollForScheduleResults, stopPolling]);

    const loadSchedule = useCallback(async (regenerate = false) => {
        setIsLoading(true);
        setLoadingMessage('Connecting to the cloud...');
        setSystemNotification(null);
        isInitialLoadRef.current = true;
    
        if (regenerate) {
            showConfirmation({
                title: "Regenerate Entire Schedule?",
                message: "This will erase all local progress and generate a new plan from scratch using the server-side solver. Are you sure?",
                confirmText: "Yes, Regenerate",
                confirmVariant: 'danger',
                onConfirm: () => requestScheduleGeneration({ startDate: STUDY_START_DATE, endDate: STUDY_END_DATE }),
                onCancel: () => setIsLoading(false)
            });
            return;
        }
    
        try {
            const { data, error } = await supabase.from('study_plans').select('plan_data').eq('id', 1).single();
            if (error && error.code !== 'PGRST116') throw new Error(error.message);
    
            // FIX: Check for data existence before accessing its properties to prevent runtime errors on `null` data.
            if (data && data.plan_data) {
                 // FIX: Cast the loaded JSON data to the specific PlanDataBlob type for use in the application.
                 const loadedData = data.plan_data as PlanDataBlob;
                 setStudyPlan(loadedData.plan);
                 setGlobalMasterResourcePool(loadedData.resources || initialMasterResourcePool);
                 setUserExceptions(loadedData.exceptions || []);
                 setIsNewUser(false);
                 setSystemNotification({ type: 'info', message: 'Welcome back! Your plan has been restored.' });
            } else {
                 setIsNewUser(true);
                 setStudyPlan(null);
            }
        } catch (err: any) {
            console.error("Error loading data:", err);
            setSystemNotification({ type: 'error', message: err.message || "Failed to load data." });
            setStudyPlan(null);
        } finally {
            setIsLoading(false);
            isInitialLoadRef.current = false;
        }
    }, [requestScheduleGeneration, showConfirmation]);

    useEffect(() => {
        if (isInitialLoadRef.current || isLoading || activeRunId) return;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        setSaveStatus('saving');
        debounceTimerRef.current = window.setTimeout(async () => {
            if (!planStateRef.current.studyPlan) return;
            const stateToSave: PlanDataBlob = { plan: planStateRef.current.studyPlan, resources: planStateRef.current.globalMasterResourcePool, exceptions: planStateRef.current.userExceptions };
            // FIX: The argument now correctly matches the expected type from the Supabase client after updating the DB interface.
            const { error } = await supabase.from('study_plans').upsert({ id: 1, plan_data: stateToSave });
            if (error) {
                setSystemNotification({ type: 'error', message: `Failed to save progress: ${error.message}` });
                setSaveStatus('error');
            } else {
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);
            }
        }, 1500);
        return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
    }, [studyPlan, globalMasterResourcePool, userExceptions, isLoading, activeRunId]);
    
    useEffect(() => () => stopPolling(), [stopPolling]);

    const handleRebalance = useCallback(() => {
        showConfirmation({
            title: "Rebalance Schedule?",
            message: "This will request a new schedule from the solver based on current settings. Progress on completed tasks will be preserved. Continue?",
            confirmText: "Yes, Rebalance",
            onConfirm: () => requestScheduleGeneration({ startDate: STUDY_START_DATE, endDate: STUDY_END_DATE }),
        });
    }, [showConfirmation, requestScheduleGeneration]);

    const handleUpdatePlanDates = useCallback((startDate: string, endDate: string) => {
        showConfirmation({
            title: "Regenerate with New Dates?",
            message: "Changing plan dates requires a full regeneration and will reset all progress. Are you sure?",
            confirmText: "Yes, Regenerate",
            confirmVariant: 'danger',
            onConfirm: () => requestScheduleGeneration({ startDate, endDate }),
        });
    }, [showConfirmation, requestScheduleGeneration]);

    const createAndTriggerRebalance = useCallback((updateFn: (plan: StudyPlan) => StudyPlan) => {
        const currentPlan = planStateRef.current.studyPlan;
        if (!currentPlan) return;
        updatePreviousStudyPlan(currentPlan);
        const updatedPlan = updateFn(currentPlan);
        setStudyPlan(updatedPlan);
        handleRebalance();
    }, [updatePreviousStudyPlan, handleRebalance]);

    const handleUpdateTopicOrderAndRebalance = useCallback((newOrder: Domain[]) => createAndTriggerRebalance(p => ({ ...p, topicOrder: newOrder })), [createAndTriggerRebalance]);
    const handleUpdateCramTopicOrderAndRebalance = useCallback((newOrder: Domain[]) => createAndTriggerRebalance(p => ({ ...p, cramTopicOrder: newOrder })), [createAndTriggerRebalance]);
    const handleToggleCramMode = useCallback((isActive: boolean) => createAndTriggerRebalance(p => ({ ...p, isCramModeActive: isActive })), [createAndTriggerRebalance]);
    const handleToggleSpecialTopicsInterleaving = useCallback((isActive: boolean) => createAndTriggerRebalance(p => ({ ...p, areSpecialTopicsInterleaved: isActive })), [createAndTriggerRebalance]);
    
    const handleTaskToggle = (taskId: string, selectedDate: string) => {
        setStudyPlan((prevPlan): StudyPlan | null => {
            if (!prevPlan) return null;
            const newSchedule = prevPlan.schedule.map(day => {
                if (day.date === selectedDate) {
                    const newTasks = day.tasks.map(task => {
                        if (task.id === taskId) {
                            const updatedTask: ScheduledTask = { ...task, status: task.status === 'completed' ? 'pending' : 'completed' };
                            return updatedTask;
                        }
                        return task;
                    });
                    return { ...day, tasks: newTasks };
                }
                return day;
            });
            const newProgressPerDomain = { ...prevPlan.progressPerDomain };
            Object.keys(newProgressPerDomain).forEach(domainKey => {
                const domain = domainKey as Domain;
                if (newProgressPerDomain[domain]) {
                    newProgressPerDomain[domain]!.completedMinutes = newSchedule.reduce((sum, day) => sum + day.tasks.reduce((taskSum, task) => (task.originalTopic === domain && task.status === 'completed') ? taskSum + task.durationMinutes : taskSum, 0), 0);
                }
            });
            return { ...prevPlan, schedule: newSchedule, progressPerDomain: newProgressPerDomain };
        });
    };

    const handleSaveModifiedDayTasks = (updatedTasks: ScheduledTask[], selectedDate: string) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        const reorderedTasks = updatedTasks.map((task, index) => ({ ...task, order: index }));
        
        const newSchedule = studyPlan.schedule.map(day => 
            day.date === selectedDate ? { ...day, tasks: reorderedTasks, isManuallyModified: true } : day
        );
        setStudyPlan({ ...studyPlan, schedule: newSchedule });
        handleRebalance();
    };

    const handleAddOrUpdateException = useCallback((rule: ExceptionDateRule) => {
        setUserExceptions(prev => {
            const existingIndex = prev.findIndex(e => e.date === rule.date);
            const newExceptions = [...prev];
            if (existingIndex > -1) newExceptions[existingIndex] = rule;
            else newExceptions.push(rule);
            return newExceptions.sort((a, b) => a.date.localeCompare(b.date));
        });
        handleRebalance();
    }, [handleRebalance]);

    const handleToggleRestDay = useCallback((date: string, isCurrentlyRestDay: boolean) => {
        const newRule: ExceptionDateRule = {
            date: date,
            dayType: isCurrentlyRestDay ? 'workday-exception' : 'specific-rest',
            isRestDayOverride: !isCurrentlyRestDay,
            targetMinutes: isCurrentlyRestDay ? 330 : 0,
        };
        handleAddOrUpdateException(newRule);
    }, [handleAddOrUpdateException]);

    const handleUndo = () => {
        if (previousStudyPlan) {
            showConfirmation({
                title: "Undo Last Change?",
                message: "This will revert your last schedule modification. Are you sure?",
                confirmText: "Undo",
                onConfirm: () => {
                    setStudyPlan(previousStudyPlan);
                    setPreviousStudyPlan(null); // Can only undo once
                }
            });
        }
    };

    return {
        studyPlan, setStudyPlan, previousStudyPlan,
        globalMasterResourcePool, setGlobalMasterResourcePool, userExceptions,
        isLoading, loadingMessage, systemNotification, setSystemNotification,
        isNewUser, loadSchedule, requestScheduleGeneration, handleRebalance, handleUpdatePlanDates,
        handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
        handleToggleCramMode, handleToggleSpecialTopicsInterleaving,
        handleTaskToggle, handleSaveModifiedDayTasks, handleUndo, updatePreviousStudyPlan,
        saveStatus, handleToggleRestDay, handleAddOrUpdateException,
    };
};