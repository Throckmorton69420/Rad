import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, ScheduledTask, GeneratedStudyPlanOutcome, Domain, ResourceType, PlanDataBlob, DeadlineSettings, ShowConfirmationOptions } from '../types';
import { generateInitialSchedule, rebalanceSchedule } from '../services/scheduleGenerator';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { supabase } from '../services/supabaseClient';
import { DEFAULT_TOPIC_ORDER, STUDY_END_DATE, STUDY_START_DATE } from '../constants';
import { getTodayInNewYork } from '../utils/timeFormatter';

// OR-Tools Service Integration
const OR_TOOLS_SERVICE_URL = 'http://localhost:8001';

interface ORToolsScheduleRequest {
    startDate: string;
    endDate: string;
    dailyStudyMinutes?: number;
    includeOptional?: boolean;
}

interface ORToolsScheduleResponse {
    schedule: Array<{
        date: string;
        resources: Array<{
            id: string;
            title: string;
            type: string;
            domain: string;
            duration_minutes: number;
            sequence_order: number;
            is_primary_material: boolean;
            category: string;
            priority: number;
        }>;
        total_minutes: number;
        total_hours: number;
        board_vitals_suggestions: {
            covered_topics: string[];
            suggested_questions: number;
            note: string;
        };
    }>;
    summary: {
        total_days: number;
        total_resources: number;
        primary_resources: number;
        secondary_resources: number;
        total_study_hours: number;
        average_daily_hours: number;
        date_range: {
            start: string;
            end: string;
        };
        scheduling_method: string;
    };
}

async function generateORToolsSchedule(request: ORToolsScheduleRequest): Promise<ORToolsScheduleResponse> {
    try {
        const response = await fetch(`${OR_TOOLS_SERVICE_URL}/generate-schedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new Error(errorData?.detail || `OR-Tools service error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to generate OR-Tools schedule: ${error.message}`);
        }
        throw new Error('Failed to connect to OR-Tools scheduling service');
    }
}

function convertORToolsToStudyPlan(orToolsResponse: ORToolsScheduleResponse, resourcePool: StudyResource[]): StudyPlan {
    // Create a map of resource IDs to full resource objects
    const resourceMap = new Map(resourcePool.map(r => [r.id, r]));
    
    const schedule = orToolsResponse.schedule.map(day => {
        const tasks: ScheduledTask[] = day.resources.map((resource, index) => {
            const fullResource = resourceMap.get(resource.id);
            
            return {
                id: `${day.date}_${resource.id}_${index}`,
                resourceId: resource.id,
                originalResourceId: resource.id,
                title: resource.title,
                type: resource.type as ResourceType,
                originalTopic: resource.domain as Domain,
                durationMinutes: resource.duration_minutes,
                status: 'pending' as const,
                order: index,
                isOptional: !resource.is_primary_material,
                pages: fullResource?.pages,
                caseCount: fullResource?.caseCount,
                questionCount: fullResource?.questionCount,
                chapterNumber: fullResource?.chapterNumber,
                sequenceOrder: resource.sequence_order,
                category: resource.category,
                priority: resource.priority
            };
        });

        return {
            date: day.date,
            dayName: new Date(day.date).toLocaleDateString('en-US', { weekday: 'long' }),
            tasks,
            totalStudyTimeMinutes: day.total_minutes,
            isRestDay: day.total_minutes === 0,
            isManuallyModified: false,
            boardVitalsSuggestions: day.board_vitals_suggestions
        };
    });

    // Calculate progress per domain
    const progressPerDomain: Partial<Record<Domain, { totalMinutes: number; completedMinutes: number }>> = {};
    
    Object.values(Domain).forEach(domain => {
        const domainTasks = schedule.flatMap(day => 
            day.tasks.filter(task => task.originalTopic === domain)
        );
        
        if (domainTasks.length > 0) {
            progressPerDomain[domain] = {
                totalMinutes: domainTasks.reduce((sum, task) => sum + task.durationMinutes, 0),
                completedMinutes: 0 // All start as pending
            };
        }
    });

    return {
        startDate: orToolsResponse.summary.date_range.start,
        endDate: orToolsResponse.summary.date_range.end,
        firstPassEndDate: null,
        schedule,
        progressPerDomain,
        topicOrder: DEFAULT_TOPIC_ORDER,
        cramTopicOrder: DEFAULT_TOPIC_ORDER,
        deadlines: {
            allContent: STUDY_END_DATE
        },
        isCramModeActive: false,
        areSpecialTopicsInterleaved: true,
        schedulingMethod: orToolsResponse.summary.scheduling_method,
        generatedAt: new Date().toISOString(),
        totalStudyHours: orToolsResponse.summary.total_study_hours,
        averageDailyHours: orToolsResponse.summary.average_daily_hours
    };
}

export const useStudyPlanManager = (showConfirmation: (options: ShowConfirmationOptions) => void) => {
    const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
    const [previousStudyPlan, setPreviousStudyPlan] = useState<StudyPlan | null>(null);
    const [globalMasterResourcePool, setGlobalMasterResourcePool] = useState<StudyResource[]>(initialMasterResourcePool);
    const [userExceptions, setUserExceptions] = useState<ExceptionDateRule[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [systemNotification, setSystemNotification] = useState<{ type: 'error' | 'warning' | 'info', message: string } | null>(null);
    const [isNewUser, setIsNewUser] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [useORTools, setUseORTools] = useState<boolean>(true);
    
    const isInitialLoadRef = useRef(true);
    const debounceTimerRef = useRef<number | null>(null);

    const planStateRef = useRef({ studyPlan, userExceptions, globalMasterResourcePool });
    useEffect(() => {
        planStateRef.current = { studyPlan, userExceptions, globalMasterResourcePool };
    }, [studyPlan, userExceptions, globalMasterResourcePool]);

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
                
                const loadedData = data ? (data as any).plan_data as PlanDataBlob | null : null;
                
                if (loadedData && loadedData.plan && Array.isArray(loadedData.plan.schedule)) {
                    const freshCodePool = initialMasterResourcePool;
                    const dbResources = loadedData.resources || [];
                    
                    const archivedIds = new Set<string>();
                    const customResources: StudyResource[] = [];

                    dbResources.forEach((res: StudyResource) => {
                        if (res.isArchived) {
                            archivedIds.add(res.id);
                        }
                        if (res.id.startsWith('custom_')) {
                            customResources.push(res);
                        }
                    });

                    let reconciledPool = freshCodePool.map(codeRes => ({
                        ...codeRes,
                        isArchived: archivedIds.has(codeRes.id),
                    }));
                    
                    reconciledPool.push(...customResources);

                    const loadedPlan = loadedData.plan;
                    if (!loadedPlan.topicOrder) loadedPlan.topicOrder = DEFAULT_TOPIC_ORDER;
                    if (!loadedPlan.cramTopicOrder) loadedPlan.cramTopicOrder = DEFAULT_TOPIC_ORDER;
                    if (!loadedPlan.deadlines) loadedPlan.deadlines = {};
                    if (loadedPlan.areSpecialTopicsInterleaved === undefined) {
                        loadedPlan.areSpecialTopicsInterleaved = true;
                    }
                    if (!loadedPlan.startDate) loadedPlan.startDate = STUDY_START_DATE;
                    if (!loadedPlan.endDate) loadedPlan.endDate = STUDY_END_DATE;
                    
                    setStudyPlan(loadedPlan);
                    setGlobalMasterResourcePool(reconciledPool);
                    setUserExceptions(loadedData.exceptions || []);
                    
                    setIsNewUser(false);
                    setSystemNotification({ type: 'info', message: 'Welcome back! Your plan has been restored.' });
                    setTimeout(() => setSystemNotification(null), 3000);
                    setSaveStatus('saved');
                    setTimeout(() => setSaveStatus('idle'), 2000);
                    setIsLoading(false);
                    isInitialLoadRef.current = false;
                    return;
                }
            }

            const poolForGeneration = regenerate ? initialMasterResourcePool.map(r => ({...r})) : planStateRef.current.globalMasterResourcePool.map(r => ({...r}));
            const exceptionsForGeneration = regenerate ? [] : planStateRef.current.userExceptions;
            if (regenerate) {
                setUserExceptions([]);
                setGlobalMasterResourcePool(initialMasterResourcePool); 
            }
            
            const generationStartDate = regenerate ? getTodayInNewYork() : STUDY_START_DATE;
            const currentTopicOrder = planStateRef.current.studyPlan?.topicOrder || DEFAULT_TOPIC_ORDER;
            const areTopicsInterleaved = planStateRef.current.studyPlan?.areSpecialTopicsInterleaved ?? true;
            const defaultDeadlines: DeadlineSettings = {
                allContent: '2025-11-05',
            };

            // Try OR-Tools first, fallback to original algorithm
            if (useORTools) {
                try {
                    setSystemNotification({ type: 'info', message: 'Generating optimized schedule using OR-Tools...' });
                    
                    const orToolsRequest: ORToolsScheduleRequest = {
                        startDate: generationStartDate,
                        endDate: STUDY_END_DATE,
                        dailyStudyMinutes: 840, // 14 hours
                        includeOptional: true
                    };

                    const orToolsResponse = await generateORToolsSchedule(orToolsRequest);
                    const optimizedPlan = convertORToolsToStudyPlan(orToolsResponse, poolForGeneration);
                    
                    setStudyPlan(optimizedPlan);
                    setPreviousStudyPlan(null);
                    setSystemNotification({ 
                        type: 'info', 
                        message: `✨ Optimized schedule generated! ${orToolsResponse.summary.total_resources} resources across ${orToolsResponse.summary.total_days} days using advanced constraint solving.` 
                    });
                    setIsNewUser(!regenerate);
                    setIsLoading(false);
                    isInitialLoadRef.current = false;
                    return;
                    
                } catch (orToolsError) {
                    console.warn('OR-Tools failed, falling back to original algorithm:', orToolsError);
                    setSystemNotification({ 
                        type: 'warning', 
                        message: 'Advanced optimizer unavailable, using standard algorithm...' 
                    });
                }
            }

            // Fallback to original algorithm
            const outcome: GeneratedStudyPlanOutcome = generateInitialSchedule(poolForGeneration, exceptionsForGeneration, currentTopicOrder, defaultDeadlines, generationStartDate, STUDY_END_DATE, areTopicsInterleaved);

            setStudyPlan(outcome.plan);
            setPreviousStudyPlan(null);

            if (outcome.notifications && outcome.notifications.length > 0) {
                setSystemNotification(outcome.notifications[0]);
            } else {
                setSystemNotification({ type: 'info', message: regenerate ? 'The study plan has been regenerated!' : 'A new study plan has been generated for you!' });
            }
            
            setIsNewUser(!regenerate);

        } catch (err: any) {
            console.error("Error loading/generating data:", err);
            setSystemNotification({ type: 'error', message: err.message || "Failed to load or generate data." });
            setStudyPlan(null);
        } finally {
            setIsLoading(false);
            isInitialLoadRef.current = false;
        }
    }, [useORTools]);

    useEffect(() => {
        if (isInitialLoadRef.current || isLoading) return;
        
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        setSaveStatus('saving');

        debounceTimerRef.current = window.setTimeout(async () => {
            if (!studyPlan) return;
            const stateToSave: PlanDataBlob = {
                plan: studyPlan,
                resources: globalMasterResourcePool,
                exceptions: userExceptions,
            };
            const { error } = await supabase.from('study_plans').upsert([{ id: 1, plan_data: stateToSave }] as any);
            if (error) {
                console.error("Supabase save error:", error);
                setSystemNotification({ type: 'error', message: "Failed to save progress to the cloud." });
                setSaveStatus('error');
            } else {
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
                const poolForRebalance = globalMasterResourcePool.map(r => ({...r}));
                const outcome = rebalanceSchedule(plan, options, userExceptions, poolForRebalance);
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

    const handleRebalance = (options: RebalanceOptions, planToUse?: StudyPlan) => {
        const planForRebalance = planToUse || studyPlan;
        if (!planForRebalance) return;
        updatePreviousStudyPlan(planForRebalance);
        triggerRebalance(planForRebalance, options);
    };

    const handleGenerateORToolsSchedule = useCallback(async () => {
        if (!studyPlan) return;
        
        showConfirmation({
            title: "Generate Optimized Schedule?",
            message: "This will create a new schedule using advanced OR-Tools constraint solving. Your progress will be preserved but the schedule structure will be optimized for your exact requirements.",
            confirmText: "Generate Optimized Schedule",
            confirmVariant: 'primary',
            onConfirm: async () => {
                setIsLoading(true);
                updatePreviousStudyPlan(studyPlan);
                
                try {
                    setSystemNotification({ type: 'info', message: 'Generating optimized schedule with OR-Tools...' });
                    
                    const orToolsRequest: ORToolsScheduleRequest = {
                        startDate: studyPlan.startDate,
                        endDate: studyPlan.endDate,
                        dailyStudyMinutes: 840, // 14 hours
                        includeOptional: true
                    };

                    const orToolsResponse = await generateORToolsSchedule(orToolsRequest);
                    const optimizedPlan = convertORToolsToStudyPlan(orToolsResponse, globalMasterResourcePool);
                    
                    // Preserve completed task status from current plan
                    const preservedSchedule = optimizedPlan.schedule.map(newDay => {
                        const existingDay = studyPlan.schedule.find(d => d.date === newDay.date);
                        if (!existingDay) return newDay;
                        
                        const preservedTasks = newDay.tasks.map(newTask => {
                            const existingTask = existingDay.tasks.find(t => 
                                t.resourceId === newTask.resourceId || t.originalResourceId === newTask.originalResourceId
                            );
                            
                            if (existingTask && existingTask.status === 'completed') {
                                return { ...newTask, status: 'completed' as const };
                            }
                            return newTask;
                        });
                        
                        return { ...newDay, tasks: preservedTasks };
                    });
                    
                    const finalPlan = { ...optimizedPlan, schedule: preservedSchedule };
                    setStudyPlan(finalPlan);
                    
                    setSystemNotification({ 
                        type: 'info', 
                        message: `✨ Schedule optimized! ${orToolsResponse.summary.total_resources} resources scheduled across ${orToolsResponse.summary.total_days} days with perfect constraint satisfaction.` 
                    });
                    
                } catch (error: any) {
                    console.error('OR-Tools optimization failed:', error);
                    setSystemNotification({ 
                        type: 'error', 
                        message: `Optimization failed: ${error.message}. Please try again or use standard scheduling.` 
                    });
                } finally {
                    setIsLoading(false);
                }
            }
        });
    }, [studyPlan, globalMasterResourcePool, showConfirmation]);

    const handleAddOrUpdateException = useCallback((newRule: ExceptionDateRule) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);

        const newExceptions = [...userExceptions.filter(r => r.date !== newRule.date), newRule];
        setUserExceptions(newExceptions);

        setIsLoading(true);
        setSystemNotification({ type: 'info', message: 'Adding exception and rebalancing...' });
        
        setTimeout(() => {
            try {
                const poolForRebalance = globalMasterResourcePool.map(r => ({...r}));
                const outcome = rebalanceSchedule(studyPlan, { type: 'standard' }, newExceptions, poolForRebalance);
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
            if (existingExceptionIndex > -1) {
                newExceptions.splice(existingExceptionIndex, 1);
            }
        } else {
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
                const poolForRebalance = globalMasterResourcePool.map(r => ({...r}));
                const outcome = rebalanceSchedule(studyPlan, { type: 'standard' }, newExceptions, poolForRebalance);
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

    const handleUpdatePlanDates = useCallback((newStartDate: string, newEndDate: string) => {
        showConfirmation({
            title: "Regenerate Entire Schedule?",
            message: "Changing the study dates will erase all current progress and regenerate the plan from scratch using the current resource pool. Are you sure you want to continue?",
            confirmText: "Yes, Regenerate",
            confirmVariant: 'danger',
            onConfirm: () => {
                setIsLoading(true);
                setSystemNotification({ type: 'info', message: 'Regenerating schedule with new dates...' });
                setTimeout(() => {
                    const outcome = generateInitialSchedule(
                        globalMasterResourcePool.map(r => ({...r})),
                        userExceptions,
                        studyPlan?.topicOrder,
                        studyPlan?.deadlines,
                        newStartDate,
                        newEndDate,
                        studyPlan?.areSpecialTopicsInterleaved
                    );
                    setStudyPlan(outcome.plan);
                    setPreviousStudyPlan(null);
                    if (outcome.notifications && outcome.notifications.length > 0) {
                        setSystemNotification(outcome.notifications[0]);
                    } else {
                         setSystemNotification({ type: 'info', message: `Plan regenerated for ${newStartDate} to ${newEndDate}.` });
                    }
                    setIsLoading(false);
                }, 50);
            }
        });
    }, [showConfirmation, globalMasterResourcePool, userExceptions, studyPlan]);

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
        setStudyPlan(updatedPlan); 
        triggerRebalance(updatedPlan, { type: 'standard' });
        setSystemNotification({ type: 'info', message: `Cram mode ${isActive ? 'activated' : 'deactivated'}. Rebalancing schedule.` });
    };

    const handleToggleSpecialTopicsInterleaving = (isActive: boolean) => {
        if (!studyPlan || isLoading) return;
        updatePreviousStudyPlan(studyPlan);
        const updatedPlan = { ...studyPlan, areSpecialTopicsInterleaved: isActive };
        setStudyPlan(updatedPlan);
        triggerRebalance(updatedPlan, { type: 'standard' });
        setSystemNotification({ type: 'info', message: `Interleaving is now ${isActive ? 'ON' : 'OFF'}. Rebalancing...` });
    };

    const handleUpdateDeadlines = (newDeadlines: DeadlineSettings) => {
        if (!studyPlan) return;
        updatePreviousStudyPlan(studyPlan);
        const updatedPlan = { ...studyPlan, deadlines: newDeadlines };
        setStudyPlan(updatedPlan);
        triggerRebalance(updatedPlan, { type: 'standard' });
        setSystemNotification({ type: 'info', message: `Deadlines updated. Rebalancing schedule.` });
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
        setIsNewUser,
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
        handleUpdateDeadlines,
        handleGenerateORToolsSchedule,
        useORTools,
        setUseORTools,
    };
};