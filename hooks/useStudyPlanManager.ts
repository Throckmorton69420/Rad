/* Full file content begins */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  StudyPlan,
  RebalanceOptions,
  ExceptionDateRule,
  StudyResource,
  ScheduledTask,
  GeneratedStudyPlanOutcome,
  Domain,
  ResourceType,
  PlanDataBlob,
  DeadlineSettings,
  ShowConfirmationOptions
} from '../types';
import { generateInitialSchedule, rebalanceSchedule as localRebalanceSchedule } from '../services/scheduleGenerator';
import { masterResourcePool as initialMasterResourcePool } from '../services/studyResources';
import { supabase } from '../services/supabaseClient';
import { DEFAULT_TOPIC_ORDER, STUDY_END_DATE, STUDY_START_DATE } from '../constants';
import { getTodayInNewYork, parseDateString } from '../utils/timeFormatter';

/* ========= OR-Tools service config ========= */
const OR_TOOLS_SERVICE_URL =
  (import.meta as any)?.env?.VITE_ORTOOLS_BASE_URL ||
  'https://radiology-ortools-service-production.up.railway.app';

/* ========= Types for backend responses ========= */

interface OrDayWithResources {
  date: string;
  resources: Array<{
    id: string;
    title: string;
    type: string;
    domain: string;
    duration_minutes: number;
    sequence_order?: number;
    is_primary_material?: boolean;
    category?: string;
    priority?: number;
    pages?: number;
    case_count?: number;
    question_count?: number;
    chapter_number?: number;
    book_source?: string;
    video_source?: string;
  }>;
  total_minutes: number;
  total_hours?: number;
  board_vitals_suggestions?: {
    covered_topics: string[];
    suggested_questions: number;
    note: string;
  };
}

interface OrDayWithTasks {
  date: string;
  dayName?: string;
  tasks: Array<{
    id: string;
    resourceId: string;
    originalResourceId?: string;
    title: string;
    type: string;
    originalTopic: string;
    durationMinutes: number;
    status?: 'pending' | 'completed';
    order: number;
    isOptional?: boolean;
    isPrimaryMaterial?: boolean;
    pages?: number;
    startPage?: number;
    endPage?: number;
    caseCount?: number;
    questionCount?: number;
    chapterNumber?: number;
    bookSource?: string;
    videoSource?: string;
    sequenceOrder?: number;
    category?: string;
    priority?: number;
  }>;
  totalStudyTimeMinutes: number;
  isRestDay?: boolean;
  isManuallyModified?: boolean;
  dayName?: string;
  boardVitalsSuggestions?: {
    covered_topics: string[];
    suggested_questions: number;
    note: string;
  };
}

interface OrScheduleResponse {
  schedule: Array<OrDayWithResources | OrDayWithTasks>;
  summary?: {
    total_days?: number;
    total_resources?: number;
    primary_resources?: number;
    secondary_resources?: number;
    total_study_hours?: number;
    average_daily_hours?: number;
    date_range?: { start: string; end: string };
    scheduling_method?: string;
  };
}

/* ========= Progress tracking ========= */
export interface ProgressInfo {
  progress: number; // 0..1
  step: number;
  total_steps: number;
  current_task: string;
  elapsed_seconds: number;
  estimated_remaining_seconds: number;
}

/* ========= OR-Tools client ========= */

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${OR_TOOLS_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = isJson ? (payload?.detail || JSON.stringify(payload)) : String(payload);
    throw new Error(`${path} ${res.status}: ${detail}`);
  }
  return payload as T;
}

/* Accept both shapes: days with resources[] (older integration) or tasks[] (current backend) */
function adaptOrToolsToStudyPlan(resp: OrScheduleResponse, resourcePool: StudyResource[]): StudyPlan {
  const resourceMap = new Map(resourcePool.map(r => [r.id, r]));
  const schedule = resp.schedule.map((d: OrDayWithResources | OrDayWithTasks) => {
    const isTasksShape = (d as OrDayWithTasks).tasks !== undefined;

    if (isTasksShape) {
      const day = d as OrDayWithTasks;
      return {
        date: day.date,
        dayName: day.dayName || new Date(day.date).toLocaleDateString('en-US', { weekday: 'long' }),
        tasks: day.tasks.map(t => ({
          id: t.id,
          resourceId: t.resourceId,
          originalResourceId: t.originalResourceId || t.resourceId,
          title: t.title,
          type: t.type as any as ResourceType,
          originalTopic: t.originalTopic as any as Domain,
          durationMinutes: t.durationMinutes,
          status: t.status || 'pending',
          order: t.order,
          isOptional: t.isOptional,
          isPrimaryMaterial: t.isPrimaryMaterial,
          pages: t.pages,
          startPage: t.startPage,
          endPage: t.endPage,
          caseCount: t.caseCount,
          questionCount: t.questionCount,
          chapterNumber: t.chapterNumber,
          bookSource: t.bookSource,
          videoSource: t.videoSource,
          sequenceOrder: t.sequenceOrder,
          category: t.category,
          priority: t.priority
        })),
        totalStudyTimeMinutes: day.totalStudyTimeMinutes,
        isRestDay: Boolean(day.isRestDay),
        isManuallyModified: Boolean(day.isManuallyModified),
        boardVitalsSuggestions: day.boardVitalsSuggestions
      };
    }

    const day = d as OrDayWithResources;
    const tasks: ScheduledTask[] = (day.resources || []).map((r, idx) => {
      const full = resourceMap.get(r.id);
      return {
        id: `${day.date}_${r.id}_${idx}`,
        resourceId: r.id,
        originalResourceId: r.id,
        title: r.title,
        type: (r.type?.toUpperCase?.() || 'UNKNOWN') as ResourceType,
        originalTopic: (r.domain?.toUpperCase?.() || 'GENERAL') as Domain,
        durationMinutes: Math.max(1, Number(r.duration_minutes || 1)),
        status: 'pending',
        order: idx,
        isOptional: r.is_primary_material === false,
        isPrimaryMaterial: r.is_primary_material !== false,
        pages: full?.pages,
        caseCount: full?.caseCount,
        questionCount: full?.questionCount,
        chapterNumber: full?.chapterNumber,
        bookSource: (full?.bookSource as any) || (r as any).book_source,
        videoSource: (full?.videoSource as any) || (r as any).video_source,
        sequenceOrder: r.sequence_order ?? full?.sequenceOrder,
        category: r.category,
        priority: r.priority
      };
    });

    return {
      date: day.date,
      dayName: new Date(day.date).toLocaleDateString('en-US', { weekday: 'long' }),
      tasks,
      totalStudyTimeMinutes: Math.max(0, Number(day.total_minutes || 0)),
      isRestDay: Number(day.total_minutes || 0) === 0,
      isManuallyModified: false,
      boardVitalsSuggestions: day.board_vitals_suggestions
    };
  });

  // Compute per-domain totals
  const progressPerDomain: Partial<Record<Domain, { totalMinutes: number; completedMinutes: number }>> = {};
  Object.values(Domain).forEach(domain => {
    const mins = schedule
      .flatMap(x => x.tasks)
      .filter(t => t.originalTopic === domain)
      .reduce((s, t) => s + t.durationMinutes, 0);
    if (mins > 0) {
      progressPerDomain[domain] = { totalMinutes: mins, completedMinutes: 0 };
    }
  });

  const start = resp.summary?.date_range?.start || schedule[0]?.date || STUDY_START_DATE;
  const end = resp.summary?.date_range?.end || schedule[schedule.length - 1]?.date || STUDY_END_DATE;

  const totalMinutes = schedule.reduce((s, d) => s + d.totalStudyTimeMinutes, 0);
  const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
  const avgDaily = schedule.length ? Math.round((totalHours / schedule.length) * 100) / 100 : 0;

  return {
    startDate: start,
    endDate: end,
    firstPassEndDate: null,
    schedule,
    progressPerDomain,
    topicOrder: DEFAULT_TOPIC_ORDER,
    cramTopicOrder: DEFAULT_TOPIC_ORDER,
    deadlines: { allContent: STUDY_END_DATE },
    isCramModeActive: false,
    areSpecialTopicsInterleaved: true,
    schedulingMethod: resp.summary?.scheduling_method || 'OR-Tools CP-SAT',
    generatedAt: new Date().toISOString(),
    totalStudyHours: totalHours,
    averageDailyHours: avgDaily
  };
}

/* Simulated progress while waiting for backend response */
function startProgressTimer(onTick: (p: ProgressInfo) => void) {
  const t0 = Date.now();
  let pct = 0;
  const id = setInterval(() => {
    const elapsed = (Date.now() - t0) / 1000;
    pct = Math.min(0.95, pct + 0.06 + Math.random() * 0.04);
    const step = Math.min(6, Math.floor(pct * 6) + 1);
    const task =
      pct < 0.2 ? 'Fetching resources from database' :
      pct < 0.4 ? 'Analyzing and categorizing resources' :
      pct < 0.6 ? 'Building optimization model' :
      pct < 0.8 ? 'Solving with CP‑SAT' :
                   'Assembling final schedule';
    onTick({
      progress: pct,
      step,
      total_steps: 6,
      current_task: task,
      elapsed_seconds: elapsed,
      estimated_remaining_seconds: Math.max(2, 45 - elapsed)
    });
  }, 400);
  return () => clearInterval(id);
}

/* ========= Hook ========= */

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
  const [useORTools] = useState<boolean>(true);

  const isInitialLoadRef = useRef(true);
  const planStateRef = useRef({ studyPlan, userExceptions, globalMasterResourcePool });

  useEffect(() => {
    planStateRef.current = { studyPlan, userExceptions, globalMasterResourcePool };
  }, [studyPlan, userExceptions, globalMasterResourcePool]);

  /* ======= Load or generate initial plan ======= */
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

          if (!error && data?.plan_data) {
            const loadedData = data.plan_data as PlanDataBlob;
            if (loadedData.plan && Array.isArray(loadedData.plan.schedule)) {
              // Reconcile code pool with DB flags/custom resources
              const fresh = initialMasterResourcePool;
              const dbResources = loadedData.resources || [];
              const archived = new Set<string>();
              const custom: StudyResource[] = [];
              dbResources.forEach((r: StudyResource) => {
                if (r.isArchived) archived.add(r.id);
                if (r.id.startsWith('custom_')) custom.push(r);
              });
              const reconciled = fresh.map(r => ({ ...r, isArchived: archived.has(r.id) })).concat(custom);

              const plan = loadedData.plan;
              if (!plan.topicOrder) plan.topicOrder = DEFAULT_TOPIC_ORDER;
              if (!plan.cramTopicOrder) plan.cramTopicOrder = DEFAULT_TOPIC_ORDER;
              if (!plan.deadlines) plan.deadlines = {};
              if (plan.areSpecialTopicsInterleaved === undefined) plan.areSpecialTopicsInterleaved = true;
              if (!plan.startDate) plan.startDate = STUDY_START_DATE;
              if (!plan.endDate) plan.endDate = STUDY_END_DATE;

              setStudyPlan(plan);
              setGlobalMasterResourcePool(reconciled);
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
        } catch {
          /* ignore and fall through to generation */
        }
      }

      // Fallback: generate a fresh plan locally (only when OR-Tools disabled/unavailable)
      if (!useORTools) {
        const start = regenerate ? getTodayInNewYork() : STUDY_START_DATE;
        const end = STUDY_END_DATE;
        const outcome: GeneratedStudyPlanOutcome = await generateInitialSchedule(
          start, end, [], initialMasterResourcePool, DEFAULT_TOPIC_ORDER, { allContent: STUDY_END_DATE }, true
        );
        setStudyPlan(outcome.plan);
        setGlobalMasterResourcePool(initialMasterResourcePool);
        setIsLoading(false);
        isInitialLoadRef.current = false;
        return;
      }

      // When OR-Tools is enabled, don’t auto-generate here; user triggers it explicitly
      setIsLoading(false);
      isInitialLoadRef.current = false;
    } catch (e: any) {
      setSystemNotification({ type: 'error', message: `Failed to load schedule: ${e?.message || e}` });
      setIsLoading(false);
    }
  }, [useORTools]);

  /* ======= OR-Tools: generate from scratch ======= */
  const handleGenerateORToolsSchedule = useCallback(async () => {
    try {
      setOptimizationProgress({ progress: 0, step: 1, total_steps: 6, current_task: 'Initializing', elapsed_seconds: 0, estimated_remaining_seconds: 45 });
      const stop = startProgressTimer(setOptimizationProgress);

      const startDate = planStateRef.current.studyPlan?.startDate || getTodayInNewYork();
      const endDate = planStateRef.current.studyPlan?.endDate || STUDY_END_DATE;

      const resp = await postJson<OrScheduleResponse>('/generate-schedule', {
        startDate,
        endDate,
        dailyStudyMinutes: 840,
        includeOptional: true
      });

      stop();
      setOptimizationProgress({ progress: 1, step: 6, total_steps: 6, current_task: 'Schedule optimization complete!', elapsed_seconds: 0, estimated_remaining_seconds: 0 });

      const next = adaptOrToolsToStudyPlan(resp, planStateRef.current.globalMasterResourcePool);
      setStudyPlan(next);
      setTimeout(() => setOptimizationProgress(null), 600);
    } catch (e: any) {
      setOptimizationProgress(null);
      setSystemNotification({ type: 'error', message: `OR‑Tools generation failed: ${e?.message || e}` });
    }
  }, []);

  /* ======= OR-Tools: generate from scratch (backend progress) ======= */
  const handleGenerateORToolsScheduleBackend = useCallback(async () => {
    try {
      // Initialize HUD
      setOptimizationProgress({
        progress: 0,
        step: 1,
        total_steps: 6,
        current_task: 'Starting solver',
        elapsed_seconds: 0,
        estimated_remaining_seconds: 0
      });

      const startDate = planStateRef.current.studyPlan?.startDate || getTodayInNewYork();
      const endDate = planStateRef.current.studyPlan?.endDate || STUDY_END_DATE;

      // 1) start
      const startRes = await fetch(`${OR_TOOLS_SERVICE_URL}/schedule/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, dailyStudyMinutes: 840, includeOptional: true })
      });
      // Legacy fallback if /schedule/start is not deployed
      if (startRes.status === 404) {
        setOptimizationProgress({
          progress: 0.2,
          step: 2,
          total_steps: 6,
          current_task: 'Legacy path: generating',
          elapsed_seconds: 0,
          estimated_remaining_seconds: 0
        });
        const legacyRes = await fetch(`${OR_TOOLS_SERVICE_URL}/generate-schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate, endDate, dailyStudyMinutes: 840, includeOptional: true })
        });
        if (!legacyRes.ok) {
          const msg = await legacyRes.text().catch(() => `HTTP ${legacyRes.status}`);
          throw new Error(`Legacy generate-schedule failed: ${msg}`);
        }
        const legacy = await legacyRes.json() as OrScheduleResponse;
        const nextLegacy = adaptOrToolsToStudyPlan(legacy, planStateRef.current.globalMasterResourcePool);
        setStudyPlan(nextLegacy);
        setOptimizationProgress({
          progress: 1,
          step: 6,
          total_steps: 6,
          current_task: 'Schedule optimization complete!',
          elapsed_seconds: 0,
          estimated_remaining_seconds: 0
        });
        setTimeout(() => setOptimizationProgress(null), 800);
        return;
      }

      const { task_id } = await startRes.json();

      // 2) poll progress
      let done = false;
      while (!done) {
        await new Promise(r => setTimeout(r, 333));
        const progRes = await fetch(`${OR_TOOLS_SERVICE_URL}/schedule/progress/${task_id}`);
        if (!progRes.ok) {
          const msg = await progRes.text().catch(() => `HTTP ${progRes.status}`);
          throw new Error(`Progress failed: ${msg}`);
        }
        const p = await progRes.json() as { status: 'running'|'complete'|'error'; percent: number; elapsed_seconds: number; eta_seconds: number|null; message?: string };
        setOptimizationProgress({
          progress: Math.max(0, Math.min(1, (p.percent ?? 0) / 100)),
          step: Math.max(1, Math.min(6, Math.round(((p.percent ?? 0) / 100) * 6))),
          total_steps: 6,
          current_task: p.message || (p.status === 'complete' ? 'Finalizing' : 'Solving'),
          elapsed_seconds: p.elapsed_seconds ?? 0,
          estimated_remaining_seconds: p.eta_seconds ?? 0
        });
        if (p.status === 'complete') done = true;
        if (p.status === 'error') throw new Error('Backend error during solve');
      }

      // 3) fetch result
      const resultRes = await fetch(`${OR_TOOLS_SERVICE_URL}/schedule/result/${task_id}`);
      if (!resultRes.ok) {
        const msg = await resultRes.text().catch(() => `HTTP ${resultRes.status}`);
        throw new Error(`Result fetch failed: ${msg}`);
      }
      const result = await resultRes.json() as OrScheduleResponse;

      const next = adaptOrToolsToStudyPlan(result, planStateRef.current.globalMasterResourcePool);
      setStudyPlan(next);
      setOptimizationProgress({
        progress: 1,
        step: 6,
        total_steps: 6,
        current_task: 'Schedule optimization complete!',
        elapsed_seconds: 0,
        estimated_remaining_seconds: 0
      });
      setTimeout(() => setOptimizationProgress(null), 800);
    } catch (e: any) {
      setOptimizationProgress(null);
      setSystemNotification({ type: 'error', message: `OR‑Tools generation failed: ${e?.message || e}` });
    }
  }, []);

/* ======= OR-Tools: rebalance variants (preserve completed) ======= */
  const handleRebalance = useCallback(async (options: RebalanceOptions, planToUse?: StudyPlan) => {
    try {
      if (!useORTools) {
        // fallback to local rebalance if OR-Tools disabled
        const base = planToUse || planStateRef.current.studyPlan;
        if (!base) return;
        const out = await localRebalanceSchedule(base, options);
        setStudyPlan(out.plan);
        return;
      }

      setOptimizationProgress({ progress: 0, step: 1, total_steps: 6, current_task: 'Preparing rebalance', elapsed_seconds: 0, estimated_remaining_seconds: 45 });
      const stop = startProgressTimer(setOptimizationProgress);

      const base = planToUse || planStateRef.current.studyPlan;
      if (!base) throw new Error('No plan in memory');

      const completedTasks = base.schedule.flatMap(d => d.tasks).filter(t => t.status === 'completed').map(t => t.id);
      const payload: any = {
        startDate: base.startDate,
        endDate: base.endDate,
        dailyStudyMinutes: 840,
        rebalanceType: options.type === 'topic-time' ? 'topic-time' : 'standard',
        completedTasks,
        preserveCompletedDate: true
      };
      if ((options as any).topics) payload.topics = (options as any).topics;
      if ((options as any).totalTimeMinutes) payload.dayTotalMinutes = (options as any).totalTimeMinutes;

      const resp = await postJson<OrScheduleResponse>('/rebalance', payload);

      stop();
      setOptimizationProgress({ progress: 1, step: 6, total_steps: 6, current_task: 'Rebalance complete!', elapsed_seconds: 0, estimated_remaining_seconds: 0 });

      const next = adaptOrToolsToStudyPlan(resp, planStateRef.current.globalMasterResourcePool);
      // Re-insert completed tasks status at same date
      const completed = new Set(completedTasks);
      next.schedule = next.schedule.map(day => ({
        ...day,
        tasks: day.tasks.map(t => (completed.has(t.id) ? { ...t, status: 'completed' } : t))
      }));
      setStudyPlan(next);
      setTimeout(() => setOptimizationProgress(null), 600);
    } catch (e: any) {
      setOptimizationProgress(null);
      setSystemNotification({ type: 'error', message: `OR‑Tools rebalance failed: ${e?.message || e}` });
    }
  }, [useORTools]);

  /* ======= Other existing handlers preserved (update dates, topics, deadlines, exceptions, etc.) ======= */

  const handleUpdatePlanDates = useCallback(async (startDate: string, endDate: string) => {
    setStudyPlan(prev => (prev ? { ...prev, startDate, endDate } : prev));
    // “Save Dates & Rebalance” path uses OR-Tools rebalance
    await handleRebalance({ type: 'standard' });
  }, [handleRebalance]);

  const handleUpdateTopicOrderAndRebalance = useCallback(async (newOrder: Domain[]) => {
    setStudyPlan(prev => (prev ? { ...prev, topicOrder: newOrder } : prev));
    await handleRebalance({ type: 'standard' });
  }, [handleRebalance]);

  const handleUpdateCramTopicOrderAndRebalance = useCallback(async (newOrder: Domain[]) => {
    setStudyPlan(prev => (prev ? { ...prev, cramTopicOrder: newOrder } : prev));
    await handleRebalance({ type: 'standard' });
  }, [handleRebalance]);

  const handleToggleCramMode = useCallback((isActive: boolean) => {
    setStudyPlan(prev => (prev ? { ...prev, isCramModeActive: isActive } : prev));
  }, []);

  const handleToggleSpecialTopicsInterleaving = useCallback((isActive: boolean) => {
    setStudyPlan(prev => (prev ? { ...prev, areSpecialTopicsInterleaved: isActive } : prev));
  }, []);

  const handleTaskToggle = useCallback((taskId: string, onDate: string) => {
    setStudyPlan(prev => {
      if (!prev) return prev;
      const s = prev.schedule.map(day => {
        if (day.date !== onDate) return day;
        const tasks = day.tasks.map(t => (t.id === taskId ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' } : t));
        return { ...day, tasks };
      });
      return { ...prev, schedule: s };
    });
  }, []);

  const handleSaveModifiedDayTasks = useCallback((updatedTasks: ScheduledTask[], date: string) => {
    setStudyPlan(prev => {
      if (!prev) return prev;
      const s = prev.schedule.map(d => (d.date === date ? { ...d, tasks: updatedTasks } : d));
      return { ...prev, schedule: s };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setStudyPlan(prev => {
      if (!previousStudyPlan) return prev;
      return previousStudyPlan;
    });
  }, [previousStudyPlan]);

  const updatePreviousStudyPlan = useCallback((plan: StudyPlan) => {
    setPreviousStudyPlan(plan);
  }, []);

  const handleToggleRestDay = useCallback((date: string) => {
    setStudyPlan(prev => {
      if (!prev) return prev;
      const s = prev.schedule.map(d => (d.date === date ? { ...d, isRestDay: !d.isRestDay } : d));
      return { ...prev, schedule: s };
    });
  }, []);

  const handleAddOrUpdateException = useCallback((rule: ExceptionDateRule) => {
    setUserExceptions(prev => {
      const existing = prev.filter(r => r.date !== rule.date);
      return [...existing, rule];
    });
  }, []);

  const handleUpdateDeadlines = useCallback(async (newDeadlines: DeadlineSettings) => {
    setStudyPlan(prev => (prev ? { ...prev, deadlines: newDeadlines } : prev));
    await handleRebalance({ type: 'standard' });
  }, [handleRebalance]);

  /* ======= Exposed API from hook ======= */
  return {
    studyPlan,
    setStudyPlan,
    previousStudyPlan,
    globalMasterResourcePool,
    setGlobalMasterResourcePool,
    isLoading,
    systemNotification,
    setSystemNotification,
    isNewUser,
    setIsNewUser,
    loadSchedule,
    handleRebalance, // now OR‑Tools by default
    handleUpdatePlanDates, // rebalance with OR‑Tools
    handleUpdateTopicOrderAndRebalance,
    handleUpdateCramTopicOrderAndRebalance,
    handleToggleCramMode,
    handleToggleSpecialTopicsInterleaving,
    handleTaskToggle,
    handleSaveModifiedDayTasks,
    handleUndo,
    updatePreviousStudyPlan,
    saveStatus: 'idle' as const,
    handleToggleRestDay,
    handleAddOrUpdateException,
    handleUpdateDeadlines,
    handleGenerateORToolsSchedule: handleGenerateORToolsScheduleBackend, // used by “Generate Optimized Schedule”
    optimizationProgress // drives HUD
  };
};
/* Full file content ends */
