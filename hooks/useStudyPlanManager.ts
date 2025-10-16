import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { StudyPlan, RebalanceOptions, ExceptionDateRule, StudyResource, ScheduledTask, GeneratedStudyPlanOutcome, Domain, ResourceType, PlanDataBlob, DeadlineSettings, ShowConfirmationOptions } from '../types';
import { generateInitialSchedule, rebalanceSchedule } from '../services/scheduleGenerator';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { supabase } from '../services/supabaseClient';
import { DEFAULT_TOPIC_ORDER, STUDY_END_DATE, STUDY_START_DATE } from '../constants';
import { getTodayInNewYork } from '../utils/timeFormatter';

// OR-Tools Service Integration
const OR_TOOLS_SERVICE_URL = 'https://radiology-ortools-service-production.up.railway.app';

// Check if running in development (localhost) vs production (vercel)
const isLocalDevelopment = () => {
  try {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  } catch {
    return false;
  }
};

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

// Progress tracking interface
interface ProgressInfo {
    progress: number;  // 0-1
    step: number;
    total_steps: number;
    current_task: string;
    elapsed_seconds: number;
    estimated_remaining_seconds: number;
}

async function generateORToolsSchedule(
    request: ORToolsScheduleRequest, 
    onProgress?: (progress: ProgressInfo) => void
): Promise<ORToolsScheduleResponse> {
    try {
        // Start progress tracking
        let startTime = Date.now();
        let progressInterval: NodeJS.Timeout | null = null;
        
        if (onProgress) {
            // Simulate progress updates during the request
            progressInterval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const progress = Math.min(elapsed / 45, 0.95); // Estimate 45 seconds max
                const remaining = Math.max(45 - elapsed, 2);
                
                onProgress({
                    progress,
                    step: Math.floor(progress * 6) + 1,
                    total_steps: 6,
                    current_task: progress < 0.2 ? 'Fetching resources from database' :
                                 progress < 0.4 ? 'Analyzing and categorizing resources' :
                                 progress < 0.6 ? 'Building optimization model' :
                                 progress < 0.8 ? 'Solving with CP-SAT algorithm' :
                                 'Generating final schedule',
                    elapsed_seconds: elapsed,
                    estimated_remaining_seconds: remaining
                });
            }, 1000);
        }
        
        const response = await fetch(`${OR_TOOLS_SERVICE_URL}/generate-schedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request)
        });
        
        // Clear progress interval
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        
        // Final progress update
        if (onProgress) {
            const totalElapsed = (Date.now() - startTime) / 1000;
            onProgress({
                progress: 1.0,
                step: 6,
                total_steps: 6,
                current_task: 'Schedule optimization complete!',
                elapsed_seconds: totalElapsed,
                estimated_remaining_seconds: 0
            });
        }

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
    const [optimizationProgress, setOptimizationProgress] = useState<ProgressInfo | null>(null);
    
    // Enable OR-Tools for all environments now that it's deployed
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
        setOptimizationProgress(null);
        isInitialLoadRef.current = true;

        try {
            if (!regenerate) {
                try {
                    const { data, error } = await supabase
                        .from('study_plans')
                        .select('plan_data')
                        .eq('id', 1)
                        .single();

                    if (!error && data && data.plan_data) {
                        const loadedData = data.plan_data as PlanDataBlob;
                        
                        if (loadedData.plan && Array.isArray(loadedData.plan.schedule)) {
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
                } catch (supabaseError) {
                    console.warn('Supabase load failed, generating new plan:', supabaseError);
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
                allContent: STUDY_END_DATE,
            };

            if (useORTools) {
                try {
                    setSystemNotification({ type: 'info', message: '🚀 Initializing advanced optimization engine...' });
                    
                    const orToolsRequest: ORToolsScheduleRequest = {
                        startDate: generationStartDate,
                        endDate: STUDY_END_DATE,
                        dailyStudyMinutes: 840,
                        includeOptional: true
                    };

                    const orToolsResponse = await generateORToolsSchedule(
                        orToolsRequest, 
                        (progress) => {
                            setOptimizationProgress(progress);
                            setSystemNotification({
                                type: 'info',
                                message: `🔄 ${progress.current_task} (${Math.round(progress.progress * 100)}% - ${Math.round(progress.elapsed_seconds)}s elapsed)`
                            });
                        }
                    );
                    
                    const optimizedPlan = convertORToolsToStudyPlan(orToolsResponse, poolForGeneration);
                    
                    setStudyPlan(optimizedPlan);
                    setPreviousStudyPlan(null);
                    setOptimizationProgress(null);
                    setSystemNotification({ 
                        type: 'info', 
                        message: `✨ Optimization complete! ${orToolsResponse.summary.total_resources} resources perfectly scheduled across ${orToolsResponse.summary.total_days} days using constraint solving.` 
                    });
                    setIsNewUser(!regenerate);
                    setIsLoading(false);
                    isInitialLoadRef.current = false;
                    return;
                    
                } catch (orToolsError) {
                    console.warn('OR-Tools failed, falling back to original algorithm:', orToolsError);
                    setOptimizationProgress(null);
                    setSystemNotification({ 
                        type: 'warning', 
                        message: 'Advanced optimizer unavailable, using standard algorithm...' 
                    });
                }
            }

            const outcome: GeneratedStudyPlanOutcome = generateInitialSchedule(
              poolForGeneration, 
              exceptionsForGeneration, 
              currentTopicOrder, 
              defaultDeadlines, 
              generationStartDate, 
              STUDY_END_DATE, 
              areTopicsInterleaved
            );

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
            setOptimizationProgress(null);
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
            try {
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
            } catch (saveError) {
                console.error("Save failed:", saveError);
                setSaveStatus('error');
                setSystemNotification({ type: 'error', message: "Failed to save progress to the cloud." });
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
                setOptimizationProgress(null);
                updatePreviousStudyPlan(studyPlan);
                
                try {
                    setSystemNotification({ type: 'info', message: '🚀 Initializing advanced optimization engine...' });
                    
                    const orToolsRequest: ORToolsScheduleRequest = {
                        startDate: studyPlan.startDate,
                        endDate: studyPlan.endDate,
                        dailyStudyMinutes: 840,
                        includeOptional: true
                    };

                    const orToolsResponse = await generateORToolsSchedule(
                        orToolsRequest,
                        (progress) => {
                            setOptimizationProgress(progress);
                            setSystemNotification({
                                type: 'info',
                                message: `🔄 ${progress.current_task} (${Math.round(progress.progress * 100)}% - ${Math.round(progress.elapsed_seconds)}s elapsed)`
                            });
                        }
                    );
                    
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
                    setOptimizationProgress(null);
                    
                    setSystemNotification({ 
                        type: 'info', 
                        message: `✨ Optimization complete! ${orToolsResponse.summary.total_resources} resources perfectly scheduled across ${orToolsResponse.summary.total_days} days with constraint satisfaction.` 
                    });
                    
                } catch (error: any) {
                    console.error('OR-Tools optimization failed:', error);
                    setOptimizationProgress(null);
                    setSystemNotification({ 
                        type: 'error', 
                        message: `Optimization failed: ${error.message}. Using standard algorithm instead.` 
                    });
                    // Fall back to standard regeneration
                    setTimeout(() => loadSchedule(true), 1000);
                } finally {
                    setIsLoading(false);
                }
            }
        });
    }, [studyPlan, globalMasterResourcePool, showConfirmation, loadSchedule]);

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
