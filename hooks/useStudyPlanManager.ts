import { useState, useCallback, useRef, useEffect } from 'react';
import {
  StudyPlan, StudyResource, ExceptionDateRule, DailySchedule, ScheduledTask, RebalanceOptions,
  ShowConfirmationOptions, Domain, DeadlineSettings, PlanDataBlob, ScheduleSlot
} from '../types';
import { usePersistentState } from './usePersistentState';
import { supabase } from '../services/supabaseClient';
import { STUDY_START_DATE, STUDY_END_DATE, DEFAULT_TOPIC_ORDER, DEFAULT_DAILY_STUDY_MINS } from '../constants';

const POLLING_INTERVAL = 5000; // 5 seconds
const MAX_POLLING_ATTEMPTS = 60; // 5 minutes max

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
    const [isLoading, setIsLoading] = useState(true);
    const [systemNotification, setSystemNotification] = useState<{ type: 'info' | 'error', message: string } | null>(null);
    const [isNewUser, setIsNewUser] = useState(false);
    const pollingRef = useRef<number | null>(null);
    const pollingAttemptsRef = useRef(0);

    const updatePreviousStudyPlan = useCallback((plan: StudyPlan) => {
        setPreviousStudyPlan(JSON.parse(JSON.stringify(plan)));
    }, []);

    const saveDataToCloud = useCallback(async (plan: StudyPlan, resources: StudyResource[], exceptions: ExceptionDateRule[]) => {
        const dataBlob: PlanDataBlob = { plan, resources, exceptions };
        const { error } = await supabase.from('user_data').upsert({ id: 1, data: dataBlob }, { onConflict: 'id' });
        if (error) {
            setSystemNotification({ type: 'error', message: `Cloud sync failed: ${error.message}` });
        }
    }, []);

    const handleUndo = useCallback(() => {
        if (previousStudyPlan) {
            setStudyPlan(previousStudyPlan);
            setPreviousStudyPlan(null);
            setSystemNotification({ type: 'info', message: 'Last change undone.' });
        }
    }, [previousStudyPlan, setStudyPlan]);

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
                                const newStatus: ScheduledTask['status'] = task.status === 'completed' ? 'pending' : 'completed';
                                return { ...task, status: newStatus };
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
    
    const pollRunStatus = useCallback(async (run_id: string, resources: StudyResource[], exceptions: ExceptionDateRule[], startDate: string, endDate: string) => {
        if (pollingAttemptsRef.current >= MAX_POLLING_ATTEMPTS) {
            setSystemNotification({ type: 'error', message: 'Solver timed out. Please try again later.' });
            setIsLoading(false);
            if(pollingRef.current) clearInterval(pollingRef.current);
            return;
        }
        pollingAttemptsRef.current++;

        try {
            const res = await fetch(`/api/runs/${run_id}`);
            const data = await res.json();
            
            if(data.status === 'COMPLETE') {
                if(pollingRef.current) clearInterval(pollingRef.current);
                const newSchedule = transformSolverSlotsToSchedule(data.slots, resources, startDate, endDate, exceptions);
                const newPlan: StudyPlan = {
                    startDate,
                    endDate,
                    schedule: newSchedule,
                    progressPerDomain: {},
                    topicOrder: DEFAULT_TOPIC_ORDER,
                    cramTopicOrder: [],
                    deadlines: {},
                    areSpecialTopicsInterleaved: true,
                };
                setStudyPlan(newPlan);
                setSystemNotification({ type: 'info', message: 'New schedule generated successfully!' });
                setIsLoading(false);
            } else if (data.status === 'FAILED') {
                if(pollingRef.current) clearInterval(pollingRef.current);
                setSystemNotification({ type: 'error', message: `Solver failed: ${data.error_text}` });
                setIsLoading(false);
            }
        } catch (error: any) {
            if(pollingRef.current) clearInterval(pollingRef.current);
            setSystemNotification({ type: 'error', message: `Error checking status: ${error.message}` });
            setIsLoading(false);
        }
    }, [setStudyPlan]);

    const triggerSolver = useCallback(async (isInitialGeneration: boolean, startDate: string, endDate: string) => {
        setIsLoading(true);
        setSystemNotification({ type: 'info', message: 'Requesting a new schedule from the solver...'});
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingAttemptsRef.current = 0;

        try {
            const res = await fetch('/api/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate })
            });

            if (!res.ok) throw new Error(`Server responded with ${res.status}`);
            
            const { run_id } = await res.json();
            setSystemNotification({ type: 'info', message: `Solver is working (ID: ${run_id.slice(0,8)})... This may take a few minutes.`});
            pollingRef.current = window.setInterval(() => pollRunStatus(run_id, globalMasterResourcePool, exceptionDates, startDate, endDate), POLLING_INTERVAL);
        } catch (error: any) {
            setSystemNotification({ type: 'error', message: `Failed to start solver: ${error.message}` });
            setIsLoading(false);
        }
    }, [globalMasterResourcePool, exceptionDates, pollRunStatus]);


    const loadSchedule = useCallback(async (regenerate = false) => {
        setIsLoading(true);
        if(regenerate) {
            triggerSolver(true, studyPlan?.startDate || STUDY_START_DATE, studyPlan?.endDate || STUDY_END_DATE);
            return;
        }

        try {
            const { data, error } = await supabase.from('user_data').select('data').single();
            if (error || !data) {
                setIsNewUser(true);
                // This is where you might load default resources
                // For now, we assume user adds them.
                triggerSolver(true, STUDY_START_DATE, STUDY_END_DATE);
            } else {
                const planData = data.data as PlanDataBlob;
                setStudyPlan(planData.plan);
                setGlobalMasterResourcePool(planData.resources);
                setExceptionDates(planData.exceptions);
                setSystemNotification({ type: 'info', message: 'Loaded schedule from the cloud.' });
            }
        } catch (error: any) {
            setSystemNotification({ type: 'error', message: `Failed to load data: ${error.message}` });
        } finally {
            setIsLoading(false);
        }
    }, [triggerSolver, studyPlan, setStudyPlan, setGlobalMasterResourcePool, setExceptionDates]);

    const handleRebalance = useCallback(async (options: RebalanceOptions = { type: 'standard' }) => {
        showConfirmation({
            title: "Rebalance Schedule?",
            message: "This will re-calculate and overwrite all future, non-completed tasks based on your current progress and settings. Proceed?",
            confirmText: "Rebalance",
            onConfirm: () => triggerSolver(false, studyPlan?.startDate || STUDY_START_DATE, studyPlan?.endDate || STUDY_END_DATE)
        });
    }, [showConfirmation, triggerSolver, studyPlan]);
    
    // Placeholder implementations for other handlers
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

    useEffect(() => {
      if (studyPlan && globalMasterResourcePool && exceptionDates) {
        saveDataToCloud(studyPlan, globalMasterResourcePool, exceptionDates);
      }
    }, [studyPlan, globalMasterResourcePool, exceptionDates, saveDataToCloud]);

    return {
        studyPlan, setStudyPlan, previousStudyPlan,
        globalMasterResourcePool, setGlobalMasterResourcePool,
        isLoading, systemNotification, setSystemNotification,
        isNewUser,
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