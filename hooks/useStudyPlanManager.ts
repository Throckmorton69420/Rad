import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, ScheduledTask, GeneratedStudyPlanOutcome, Domain, ResourceType, PlanDataBlob } from '../types';
import { generateInitialSchedule, rebalanceSchedule } from '../services/scheduleGenerator';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { supabase } from '../services/supabaseClient';
import { DEFAULT_TOPIC_ORDER } from '../constants';


export const useStudyPlanManager = () => {
    const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
    const [previousStudyPlan, setPreviousStudyPlan] = useState<StudyPlan | null>(null);
    const [globalMasterResourcePool, setGlobalMasterResourcePool] = useState<StudyResource[]>(initialMasterResourcePool);
    const [userExceptions, setUserExceptions] = useState<ExceptionDateRule[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [systemNotification, setSystemNotification] = useState<{ type: 'error' | 'warning' | 'info', message: string } | null>(null);
    const [isNewUser, setIsNewUser] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    
    const isInitialLoadRef = useRef(true);
    const debounceTimerRef = useRef<number | null>(null);

    const loadSchedule = useCallback(async (regenerate = false) => {
        setIsLoading(true);
        setSystemNotification(null);
        isInitialLoadRef.current = true;

        try {
            if (!regenerate) {
                const { data, error } = await supabase
                    .from('study_plans')
                    .select('plan_data')
                    .eq('id', 1)
                    .single();

                if (error && error.code !== 'PGRST116') {
                    throw new Error(error.message);
                }
                if (data && data.plan_data) {
                    const loadedData = data.plan_data as PlanDataBlob;
                    const loadedPlan = loadedData.plan;
                    
                    if (!loadedPlan.topicOrder) loadedPlan.topicOrder = DEFAULT_TOPIC_ORDER;
                    if (!loadedPlan.cramTopicOrder) loadedPlan.cramTopicOrder = DEFAULT_TOPIC_ORDER;
                    if (!loadedPlan.deadlines) loadedPlan.deadlines = {};

                    setStudyPlan(loadedPlan);
                    setGlobalMasterResourcePool(loadedData.resources);
                    setUserExceptions(loadedData.exceptions);
                    setIsNewUser(false);
                    setSystemNotification({ type: 'info', message: 'Welcome back! Your plan has been restored from the cloud.' });
                    setTimeout(() => setSystemNotification(null), 3000);
                    setIsLoading(false);
                    isInitialLoadRef.current = false;
                    setSaveStatus('saved');
                    setTimeout(() => setSaveStatus('idle'), 2000);
                    return;
                }
            }
            
            let poolForGeneration = regenerate ? globalMasterResourcePool : initialMasterResourcePool;
            
            if (regenerate) {
                const updatedPool = JSON.parse(JSON.stringify(globalMasterResourcePool)).map((resource: StudyResource) => {
                    if (resource.type === ResourceType.QUESTIONS && resource.questionCount) resource.durationMinutes = Math.round(resource.questionCount * 1.1);
                    else if (resource.type === ResourceType.QUESTION_REVIEW && resource.questionCount) resource.durationMinutes = Math.round(resource.questionCount * 0.6);
                    return resource;
                });
                poolForGeneration = updatedPool;
                setGlobalMasterResourcePool(updatedPool);
            }
            
            const outcome: GeneratedStudyPlanOutcome = generateInitialSchedule(poolForGeneration, userExceptions, studyPlan?.topicOrder, { allContent: '2025-11-03' });
            
            setStudyPlan(outcome.plan);
            if (!regenerate) {
                setGlobalMasterResourcePool(initialMasterResourcePool);
                setUserExceptions([]);
            }
            setIsNewUser(!regenerate);
            setPreviousStudyPlan(null);
            
            if(outcome.notifications && outcome.notifications.length > 0) {
                setSystemNotification(outcome.notifications[0]);
            } else {
                 setSystemNotification({ type: 'info', message: regenerate ? 'The study plan has been regenerated!' : 'A new study plan has been generated for you!' });
            }
            
        } catch (err: any) {
            console.error("Error loading data:", err);
            setSystemNotification({ type: 'error', message: err.message || "Failed to load data from the cloud." });
            setStudyPlan(null);
        } finally {
            setIsLoading(false);
            isInitialLoadRef.current = false;
        }
    }, [studyPlan?.topicOrder, globalMasterResourcePool, userExceptions]);

    useEffect(() => {
        if (isInitialLoadRef.current || isLoading) return;
        
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        setSaveStatus('saving');

        debounceTimerRef.current = window.setTimeout(async () => {
            if (!studyPlan) return;
            console.log("Saving state to Supabase...");
            const stateToSave: PlanDataBlob = {
                plan: studyPlan,
                resources: globalMasterResourcePool,
                exceptions: userExceptions,
            };
            const { error } = await supabase.from('study_plans').upsert({ id: 1, plan_data: stateToSave as any });
            if (error) {
                console.error("Supabase save error:", error);
                setSystemNotification({ type: 'error', message: "Failed to save progress to the cloud." });
                setSaveStatus('error');
            } else {
                console.log("State saved successfully.");
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);
            }
        }, 1500);

        return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
    }, [studyPlan, globalMasterResourcePool, userExceptions, isLoading]);


    const updatePreviousStudyPlan = (currentPlan: StudyPlan | null) => {
        if (currentPlan) setPreviousStudyPlan(JSON.parse(JSON.stringify(currentPlan)));
    };

    const triggerRebalance = (plan: StudyPlan, options: RebalanceOptions) => {
        setIsLoading(true);
        setSystemNotification({ type: 'info', message: 'Rebalancing schedule... This will preserve past completed work.' });
        
        setTimeout(() => {
            try {
                const outcome = rebalanceSchedule(plan, options, userExceptions, globalMasterResourcePool);
                setStudyPlan(outcome.plan);

                if (outcome.notifications && outcome.notifications.length > 0) {
                     setSystemNotification(outcome.notifications[0]);
                } else {
                    setSystemNotification({ type: 'info', message: 'Rebalance complete!' });
                    setTimeout(() => setSystemNotification(null), 3000);
                }
            } catch (err) {
                const error = err as any;
                console.error("Error during rebalance:", error);
                setSystemNotification({ type: 'error', message: error.message || "Failed to rebalance." });
            } finally {
                setIsLoading(false);
            }
        }, 50);
    };

    const handleRebalance = (options: RebalanceOptions) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        triggerRebalance(studyPlan, options);
    };

    const handleAddOrUpdateException = useCallback((newRule: ExceptionDateRule) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);

        const newExceptions = [...userExceptions.filter(r => r.date !== newRule.date), newRule];
        setUserExceptions(newExceptions);

        setIsLoading(true);
        setSystemNotification({ type: 'info', message: 'Adding exception and rebalancing...' });
        
        setTimeout(() => {
            try {
                const outcome = rebalanceSchedule(studyPlan, { type: 'standard' }, newExceptions, globalMasterResourcePool);
                setStudyPlan(outcome.plan);
                setSystemNotification({ type: 'info', message: 'Schedule updated with exception!' });
                setTimeout(() => setSystemNotification(null), 3000);
            } catch (err: any) {
                console.error("Error during exception rebalance:", err);
                setSystemNotification({ type: 'error', message: err.message || "Failed to update schedule." });
            } finally {
                setIsLoading(false);
            }
        }, 50);
    }, [studyPlan, userExceptions, globalMasterResourcePool]);

    const handleToggleRestDay = useCallback((date: string, isCurrentlyRestDay: boolean) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
    
        const newExceptions = [...userExceptions];
        const existingExceptionIndex = newExceptions.findIndex(ex => ex.date === date);
    
        if (isCurrentlyRestDay) {
            // Make it a study day by removing the exception
            if (existingExceptionIndex > -1) {
                newExceptions.splice(existingExceptionIndex, 1);
            }
        } else {
            // Make it a rest day by adding/updating an exception
            const newException: ExceptionDateRule = {
                date: date,
                dayType: 'specific-rest',
                isRestDayOverride: true,
                targetMinutes: 0,
            };
            if (existingExceptionIndex > -1) {
                newExceptions[existingExceptionIndex] = newException;
            } else {
                newExceptions.push(newException);
            }
        }
        
        setUserExceptions(newExceptions);
    
        setIsLoading(true);
        setSystemNotification({ type: 'info', message: 'Updating day status and rebalancing...' });
        
        setTimeout(() => {
            try {
                const outcome = rebalanceSchedule(studyPlan, { type: 'standard' }, newExceptions, globalMasterResourcePool);
                setStudyPlan(outcome.plan);
                setSystemNotification({ type: 'info', message: 'Schedule updated successfully!' });
                setTimeout(() => setSystemNotification(null), 3000);
            } catch (err: any) {
                console.error("Error during day toggle rebalance:", err);
                setSystemNotification({ type: 'error', message: err.message || "Failed to update schedule." });
            } finally {
                setIsLoading(false);
            }
        }, 50);
    }, [studyPlan, userExceptions, globalMasterResourcePool]);
    

    const handleUpdateTopicOrderAndRebalance = (newOrder: Domain[]) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        const updatedPlan = { ...studyPlan, topicOrder: newOrder };
        setStudyPlan(updatedPlan);
        triggerRebalance(updatedPlan, { type: 'standard' });
    };
    
    const handleUpdateCramTopicOrderAndRebalance = (newOrder: Domain[]) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        const updatedPlan = { ...studyPlan, cramTopicOrder: newOrder };
        setStudyPlan(updatedPlan);
        triggerRebalance(updatedPlan, { type: 'standard' });
    };

    const handleToggleCramMode = (isActive: boolean) => {
        if (!studyPlan || isLoading) return;
        updatePreviousStudyPlan(studyPlan);
        const updatedPlan = { ...studyPlan, isCramModeActive: isActive };
        setStudyPlan(updatedPlan); // Set the state immediately so the UI updates
        triggerRebalance(updatedPlan, { type: 'standard' }); // Then trigger the rebalance with the new state
        setSystemNotification({ type: 'info', message: `Cram mode ${isActive ? 'activated' : 'deactivated'}. Rebalancing schedule.` });
    };

    const handleTaskToggle = (taskId: string, selectedDate: string) => {
        setStudyPlan((prevPlan): StudyPlan | null => {
            if (!prevPlan) return null;
            updatePreviousStudyPlan(prevPlan);
            const newSchedule = prevPlan.schedule.map(day => {
                if (day.date === selectedDate) {
                    const newTasks = day.tasks.map(task => {
                        if (task.id !== taskId) {
                            return task;
                        }
                        const newStatus: 'pending' | 'completed' = task.status === 'completed' ? 'pending' : 'completed';
                        return { ...task, status: newStatus };
                    });
                    return { ...day, tasks: newTasks };
                }
                return day;
            });
            const updatedPlan = { ...prevPlan, schedule: newSchedule };
            const newProgressPerDomain = { ...prevPlan.progressPerDomain };
            Object.keys(newProgressPerDomain).forEach(domainKey => {
                const domain = domainKey as Domain;
                if (newProgressPerDomain[domain]) {
                    newProgressPerDomain[domain]!.completedMinutes = newSchedule.reduce((sum, day) => sum + day.tasks.reduce((taskSum, task) => (task.originalTopic === domain && task.status === 'completed') ? taskSum + task.durationMinutes : taskSum, 0), 0);
                }
            });
            return { ...updatedPlan, progressPerDomain: newProgressPerDomain };
        });
    };
    
    const handleSaveModifiedDayTasks = (updatedTasks: ScheduledTask[], selectedDate: string) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        const reorderedTasks = updatedTasks.map((task, index) => ({ ...task, order: index }));
        const newTotalTime = reorderedTasks.reduce((sum, t) => sum + t.durationMinutes, 0);

        const newSchedule = studyPlan.schedule.map(day => {
            if (day.date === selectedDate) {
                return {
                    ...day,
                    tasks: reorderedTasks,
                    totalStudyTimeMinutes: newTotalTime,
                    isRestDay: reorderedTasks.length === 0,
                    isManuallyModified: true,
                };
            }
            return day;
        });
        const updatedPlan = { ...studyPlan, schedule: newSchedule };
        setStudyPlan(updatedPlan);
        triggerRebalance(updatedPlan, { type: 'standard' });
        setSystemNotification({ type: 'info', message: `Tasks for ${selectedDate} updated. Rebalancing future days.` });
    };

    const handleUndo = () => {
        if (previousStudyPlan) {
            setStudyPlan(JSON.parse(JSON.stringify(previousStudyPlan)));
            setPreviousStudyPlan(null);
            setSystemNotification(null);
        }
    };

    return {
        studyPlan,
        setStudyPlan,
        previousStudyPlan,
        globalMasterResourcePool,
        setGlobalMasterResourcePool,
        userExceptions,
        isLoading,
        systemNotification,
        setSystemNotification,
        isNewUser,
        loadSchedule,
        handleRebalance,
        handleUpdateTopicOrderAndRebalance,
        handleUpdateCramTopicOrderAndRebalance,
        handleToggleCramMode,
        handleTaskToggle,
        handleSaveModifiedDayTasks,
        handleUndo,
        updatePreviousStudyPlan,
        saveStatus,
        handleToggleRestDay,
        handleAddOrUpdateException,
    };
};