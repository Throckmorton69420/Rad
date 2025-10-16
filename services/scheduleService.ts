// services/scheduleService.ts - Remote Scheduler Service

import {
  StudyPlan,
  DailySchedule,
  ScheduledTask,
  StudyResource,
  Domain,
  ResourceType,
  ExceptionDateRule,
  GeneratedStudyPlanOutcome,
  RebalanceOptions,
  DeadlineSettings
} from '../types';

import { DEFAULT_TOPIC_ORDER } from '../constants';
import { getTodayInNewYork, parseDateString, isoDate } from '../utils/timeFormatter';

// Backend API configuration
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://radiology-ortools-service-production.up.railway.app';

// Types for backend communication
interface BackendScheduleRequest {
  startDate: string;
  endDate: string;
  dailyStudyMinutes?: number;
  includeOptional?: boolean;
}

interface BackendDayResource {
  id: string;
  title: string;
  type: string;
  domain: string;
  duration_minutes: number;
  sequence_order?: number;
  is_primary_material: boolean;
  category: string;
  priority: number;
  topic: string;
  order: number;
  pages?: number;
  case_count?: number;
  question_count?: number;
  video_source?: string;
  book_source?: string;
  covered_topics?: string[];
  note?: string;
}

interface BackendDaySchedule {
  date: string;
  resources: BackendDayResource[];
  total_minutes: number;
  total_hours: number;
  resource_count: number;
  utilization: number;
  step_breakdown?: Record<string, number>;
  board_vitals_suggestions: {
    covered_topics: string[];
    suggested_questions: number;
    note: string;
  };
}

interface BackendScheduleResponse {
  schedule: BackendDaySchedule[];
  summary: {
    total_days: number;
    total_resources: number;
    primary_resources: number;
    secondary_resources: number;
    total_study_hours: number;
    average_daily_hours: number;
    total_board_vitals_questions?: number;
    date_range: { start: string; end: string };
    scheduling_method: string;
    daily_template?: string[];
    solver_version: string;
  };
}

/**
 * Remote Schedule Service - replaces local WorkingScheduler
 * Calls the radiology-ortools-service backend for schedule generation
 */
export class RemoteScheduleService {
  private static async callBackend(
    endpoint: string,
    data: any,
    timeoutMs: number = 30000
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Backend request timed out - schedule generation taking too long');
      }
      throw error;
    }
  }

  private static mapBackendResourceToTask(
    resource: BackendDayResource,
    dayDate: string,
    taskCounter: number
  ): ScheduledTask {
    // Map backend categories to frontend ResourceType
    const typeMapping: Record<string, ResourceType> = {
      'VIDEO_LECTURE': ResourceType.VIDEO_LECTURE,
      'HIGH_YIELD_VIDEO': ResourceType.HIGH_YIELD_VIDEO,
      'READING_TEXTBOOK': ResourceType.READING_TEXTBOOK,
      'CASE_COMPANION': ResourceType.CASE_COMPANION,
      'QUESTIONS': ResourceType.QUESTIONS,
      'REVIEW_QUESTIONS': ResourceType.REVIEW_QUESTIONS,
      'PRACTICE_EXAM': ResourceType.PRACTICE_EXAM,
      'AUDIO': ResourceType.AUDIO,
      'OTHER': ResourceType.OTHER
    };

    // Map backend domains to frontend Domain enum
    const domainMapping: Record<string, Domain> = {
      'THORACIC_IMAGING': Domain.THORACIC,
      'CARDIOVASCULAR_IMAGING': Domain.CARDIAC,
      'GASTROINTESTINAL_IMAGING': Domain.GI,
      'GENITOURINARY_IMAGING': Domain.GU,
      'MUSCULOSKELETAL_IMAGING': Domain.MSK,
      'NEURORADIOLOGY': Domain.NEURO,
      'PEDIATRIC_RADIOLOGY': Domain.PEDS,
      'BREAST_IMAGING': Domain.BREAST,
      'NUCLEAR_MEDICINE': Domain.NUCLEAR_MEDICINE,
      'INTERVENTIONAL_RADIOLOGY': Domain.IR,
      'ULTRASOUND_IMAGING': Domain.ULTRASOUND,
      'PHYSICS': Domain.PHYSICS,
      'MIXED_REVIEW': Domain.MIXED_REVIEW,
      'GENERAL': Domain.HIGH_YIELD
    };

    const mappedType = typeMapping[resource.type] || ResourceType.OTHER;
    const mappedDomain = domainMapping[resource.domain] || Domain.HIGH_YIELD;

    return {
      id: `task_${resource.id}_${taskCounter}`,
      resourceId: resource.id,
      originalResourceId: resource.id.includes('_part_') ? resource.id.split('_part_')[0] : resource.id,
      title: resource.title,
      type: mappedType,
      originalTopic: mappedDomain,
      durationMinutes: resource.duration_minutes,
      status: 'pending',
      order: resource.order,
      isOptional: !resource.is_primary_material,
      isPrimaryMaterial: resource.is_primary_material,
      pages: resource.pages,
      startPage: undefined, // Not provided by backend
      endPage: undefined,   // Not provided by backend
      caseCount: resource.case_count,
      questionCount: resource.question_count,
      chapterNumber: undefined, // Not provided by backend
      bookSource: resource.book_source,
      videoSource: resource.video_source,
      // Additional metadata for Board Vitals tasks
      ...(resource.covered_topics && {
        metadata: {
          coveredTopics: resource.covered_topics,
          note: resource.note
        }
      })
    };
  }

  private static mapBackendScheduleToStudyPlan(
    backendResponse: BackendScheduleResponse,
    originalStartDate: string,
    originalEndDate: string,
    exceptionRules: ExceptionDateRule[]
  ): StudyPlan {
    const exceptionMap = new Map(exceptionRules.map(e => [e.date, e]));
    let taskCounter = 0;

    // Map backend schedule to frontend schedule
    const schedule: DailySchedule[] = backendResponse.schedule.map(day => {
      const exception = exceptionMap.get(day.date);
      
      const tasks = day.resources.map(resource => {
        taskCounter++;
        return RemoteScheduleService.mapBackendResourceToTask(resource, day.date, taskCounter);
      });

      // Calculate day name
      const date = new Date(day.date + 'T00:00:00.000Z');
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

      return {
        date: day.date,
        dayName,
        tasks,
        totalStudyTimeMinutes: exception?.targetMinutes ?? 840, // 14 hours default
        isRestDay: exception?.isRestDayOverride ?? false,
        isManuallyModified: !!exception
      };
    });

    // Fill in any missing days between start and end (rest days, etc.)
    const backendDates = new Set(schedule.map(d => d.date));
    const start = new Date(originalStartDate + 'T00:00:00.000Z');
    const end = new Date(originalEndDate + 'T00:00:00.000Z');
    const allDays: DailySchedule[] = [];

    for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      const dateStr = isoDate(date);
      const existingDay = schedule.find(d => d.date === dateStr);
      
      if (existingDay) {
        allDays.push(existingDay);
      } else {
        // Create rest day or zero-time day
        const exception = exceptionMap.get(dateStr);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
        
        allDays.push({
          date: dateStr,
          dayName,
          tasks: [],
          totalStudyTimeMinutes: exception?.targetMinutes ?? 0,
          isRestDay: exception?.isRestDayOverride ?? true,
          isManuallyModified: !!exception
        });
      }
    }

    // Calculate progress per domain
    const progressPerDomain: StudyPlan['progressPerDomain'] = {};
    
    for (const day of allDays) {
      for (const task of day.tasks) {
        const domain = task.originalTopic;
        if (!progressPerDomain[domain]) {
          progressPerDomain[domain] = {
            completedMinutes: 0,
            totalMinutes: 0
          };
        }
        
        progressPerDomain[domain].totalMinutes += task.durationMinutes;
        if (task.status === 'completed') {
          progressPerDomain[domain].completedMinutes += task.durationMinutes;
        }
      }
    }

    return {
      schedule: allDays,
      progressPerDomain,
      startDate: originalStartDate,
      endDate: originalEndDate,
      firstPassEndDate: null,
      topicOrder: DEFAULT_TOPIC_ORDER,
      cramTopicOrder: DEFAULT_TOPIC_ORDER.slice(),
      deadlines: {},
      isCramModeActive: false,
      areSpecialTopicsInterleaved: true
    };
  }

  /**
   * Generate initial schedule using the backend service
   */
  static async generateRemoteSchedule(
    resourcePool: StudyResource[],
    exceptionRules: ExceptionDateRule[],
    topicOrder: Domain[] | undefined,
    deadlines: DeadlineSettings | undefined,
    startDateStr: string,
    endDateStr: string,
    areSpecialTopicsInterleaved: boolean | undefined,
    dailyStudyMinutes: number = 840
  ): Promise<GeneratedStudyPlanOutcome> {
    try {
      console.log(`🚀 Generating remote schedule: ${startDateStr} to ${endDateStr} (${dailyStudyMinutes}min/day)`);
      
      const request: BackendScheduleRequest = {
        startDate: startDateStr,
        endDate: endDateStr,
        dailyStudyMinutes,
        includeOptional: true
      };

      // Call backend
      const backendResponse: BackendScheduleResponse = await RemoteScheduleService.callBackend(
        '/generate-schedule',
        request,
        60000 // 60 second timeout for schedule generation
      );

      console.log(`✅ Backend generated schedule: ${backendResponse.summary.total_days} days, ${backendResponse.summary.total_resources} resources`);

      // Map backend response to frontend format
      const plan = RemoteScheduleService.mapBackendScheduleToStudyPlan(
        backendResponse,
        startDateStr,
        endDateStr,
        exceptionRules
      );

      const notifications = [
        {
          type: 'info' as const,
          message: `Remote scheduler v${backendResponse.summary.solver_version}: ${backendResponse.summary.scheduling_method}`
        },
        {
          type: 'info' as const,
          message: `Generated ${backendResponse.summary.total_days} days with ${backendResponse.summary.total_resources} resources (${backendResponse.summary.primary_resources} primary, ${backendResponse.summary.secondary_resources} secondary)`
        },
        {
          type: 'info' as const,
          message: `Total study time: ${backendResponse.summary.total_study_hours} hours (avg ${backendResponse.summary.average_daily_hours}h/day)`
        }
      ];

      if (backendResponse.summary.total_board_vitals_questions) {
        notifications.push({
          type: 'info' as const,
          message: `Board Vitals: ${backendResponse.summary.total_board_vitals_questions} questions scheduled across all days`
        });
      }

      if (backendResponse.summary.daily_template) {
        notifications.push({
          type: 'info' as const,
          message: `Daily template: ${backendResponse.summary.daily_template.length} steps - ${backendResponse.summary.daily_template.slice(0, 6).join(' → ')}`
        });
      }

      return {
        plan,
        notifications
      };

    } catch (error) {
      console.error('❌ Remote schedule generation failed:', error);
      
      return {
        plan: {
          schedule: [],
          progressPerDomain: {},
          startDate: startDateStr,
          endDate: endDateStr,
          firstPassEndDate: null,
          topicOrder: DEFAULT_TOPIC_ORDER,
          cramTopicOrder: DEFAULT_TOPIC_ORDER.slice(),
          deadlines: {},
          isCramModeActive: false,
          areSpecialTopicsInterleaved: true
        },
        notifications: [
          {
            type: 'error' as const,
            message: `Remote scheduling failed: ${error.message}`
          },
          {
            type: 'warning' as const,
            message: 'Falling back to empty schedule. Please check backend service availability.'
          }
        ]
      };
    }
  }
}

/**
 * Generate initial schedule - NEW API using remote backend
 */
export const generateInitialSchedule = (
  resourcePool: StudyResource[],
  exceptionRules: ExceptionDateRule[],
  topicOrder: Domain[] | undefined,
  deadlines: DeadlineSettings | undefined,
  startDateStr: string,
  endDateStr: string,
  areSpecialTopicsInterleaved: boolean | undefined
): Promise<GeneratedStudyPlanOutcome> => {
  return RemoteScheduleService.generateRemoteSchedule(
    resourcePool,
    exceptionRules,
    topicOrder,
    deadlines,
    startDateStr,
    endDateStr,
    areSpecialTopicsInterleaved,
    840 // 14 hours daily limit
  );
};

/**
 * Rebalance schedule - can remain local for now or call remote with shifted dates
 */
export const rebalanceSchedule = (
  currentPlan: StudyPlan,
  options: RebalanceOptions,
  exceptionRules: ExceptionDateRule[],
  resourcePool: StudyResource[]
): Promise<GeneratedStudyPlanOutcome> => {
  const today = getTodayInNewYork();
  
  let rebalanceStart: string;
  if (options.type === 'standard') {
    rebalanceStart = (options.rebalanceDate && options.rebalanceDate > today) 
      ? options.rebalanceDate : today;
  } else {
    rebalanceStart = options.date;
  }
  
  rebalanceStart = Math.max(rebalanceStart, currentPlan.startDate);
  rebalanceStart = Math.min(rebalanceStart, currentPlan.endDate);
  
  // For rebalancing, we'll call the remote service with the new date range
  // The backend will handle excluding already completed resources
  return RemoteScheduleService.generateRemoteSchedule(
    resourcePool,
    exceptionRules,
    currentPlan.topicOrder,
    currentPlan.deadlines,
    rebalanceStart,
    currentPlan.endDate,
    currentPlan.areSpecialTopicsInterleaved,
    840
  ).then(result => {
    // Preserve past schedule before rebalance start
    const pastSchedule = currentPlan.schedule.filter(day => day.date < rebalanceStart);
    result.plan.schedule = [...pastSchedule, ...result.plan.schedule];
    result.plan.startDate = currentPlan.startDate;
    
    return result;
  });
};

/**
 * Test backend connectivity
 */
export const testBackendConnection = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Backend health check:', data);
      return data.status === 'healthy';
    }
    
    return false;
  } catch (error) {
    console.warn('⚠️ Backend connectivity test failed:', error.message);
    return false;
  }
};
