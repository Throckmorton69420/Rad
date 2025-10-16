import { useState, useCallback, useMemo } from 'react';
import { StudyPlan, StudyResource, ExceptionDateRule, GeneratedStudyPlanOutcome, RebalanceOptions, DeadlineSettings, Domain, ScheduledTask } from '../types';
import { generateInitialSchedule, rebalanceSchedule } from '../services/scheduleGenerator';
import { getTodayInNewYork, addDaysToDate } from '../utils/timeFormatter';

// Updated default dates and timing
const DEFAULT_END_DATE = '2025-11-07';  // Extended to 11/07
const DEFAULT_DAILY_MINUTES = 840;  // 14 hours

interface UseStudyPlanManagerProps {
  studyResources: StudyResource[];
  exceptionDateRules: ExceptionDateRule[];
}

export const useStudyPlanManager = ({ studyResources, exceptionDateRules }: UseStudyPlanManagerProps) => {
  const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notifications, setNotifications] = useState<Array<{type: 'error' | 'warning' | 'info', message: string}>>([]);

  // Try OR-Tools service first, fallback to local generator
  const generateScheduleWithService = useCallback(async (
    startDate: string,
    endDate: string = DEFAULT_END_DATE,
    dailyStudyMinutes: number = DEFAULT_DAILY_MINUTES
  ): Promise<GeneratedStudyPlanOutcome> => {
    
    // Try OR-Tools service first
    try {
      const serviceUrl = process.env.REACT_APP_ORTOOLS_SERVICE_URL || 'https://radiology-ortools-service-production.up.railway.app';
      
      const response = await fetch(`${serviceUrl}/generate-schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dailyStudyMinutes
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Convert service response to our format
        const plan: StudyPlan = {
          schedule: data.schedule.map((day: any) => ({
            date: day.date,
            dayName: new Date(day.date + 'T00:00:00.000Z').toLocaleDateString('en-US', { 
              weekday: 'long', 
              timeZone: 'UTC' 
            }),
            tasks: day.resources.map((resource: any, index: number) => ({
              id: resource.id,
              resourceId: resource.id.split('_')[0] || resource.id,
              originalResourceId: resource.id.split('_')[0] || resource.id,
              title: resource.title,
              type: resource.type,
              originalTopic: resource.domain,
              durationMinutes: resource.duration_minutes,
              status: 'pending' as const,
              order: index,
              isOptional: resource.is_primary_material === false,
              isPrimaryMaterial: resource.is_primary_material !== false,
              pages: resource.pages,
              caseCount: resource.case_count,
              questionCount: resource.question_count
            })),
            totalStudyTimeMinutes: day.total_minutes,
            isRestDay: day.total_minutes === 0,
            isManuallyModified: false,
            boardVitalsSuggestions: day.board_vitals_suggestions
          })),
          progressPerDomain: {},
          startDate,
          endDate,
          firstPassEndDate: null,
          topicOrder: Object.values(Domain),
          cramTopicOrder: Object.values(Domain),
          deadlines: {},
          isCramModeActive: false,
          areSpecialTopicsInterleaved: true
        };

        return {
          plan,
          notifications: [{ type: 'info', message: `OR-Tools service: ${data.summary.total_resources} resources, ${data.summary.total_study_hours} hours` }]
        };
      } else {
        console.warn('OR-Tools service failed, falling back to local generator');
      }
    } catch (error) {
      console.warn('OR-Tools service unavailable, falling back to local generator:', error);
    }

    // Fallback to local generator
    return generateInitialSchedule(
      studyResources,
      exceptionDateRules,
      Object.values(Domain),
      {},
      startDate,
      endDate,
      true
    );
  }, [studyResources, exceptionDateRules]);

  const generateInitialPlan = useCallback(async (
    startDate?: string,
    endDate?: string,
    topicOrder?: Domain[],
    deadlines?: DeadlineSettings,
    areSpecialTopicsInterleaved?: boolean
  ) => {
    setIsGenerating(true);
    setNotifications([]);
    
    try {
      const actualStartDate = startDate || getTodayInNewYork();
      const actualEndDate = endDate || DEFAULT_END_DATE;
      
      const result = await generateScheduleWithService(actualStartDate, actualEndDate, DEFAULT_DAILY_MINUTES);
      
      setStudyPlan(result.plan);
      setNotifications(result.notifications);
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setNotifications([{ type: 'error', message: `Failed to generate schedule: ${errorMessage}` }]);
      throw error;
    } finally {
      setIsGenerating(false);
    }
  }, [generateScheduleWithService]);

  const rebalancePlan = useCallback(async (options: RebalanceOptions) => {
    if (!studyPlan) {
      throw new Error('No study plan to rebalance');
    }

    setIsGenerating(true);
    setNotifications([]);
    
    try {
      const result = rebalanceSchedule(studyPlan, options, exceptionDateRules, studyResources);
      
      setStudyPlan(result.plan);
      setNotifications(result.notifications);
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setNotifications([{ type: 'error', message: `Failed to rebalance schedule: ${errorMessage}` }]);
      throw error;
    } finally {
      setIsGenerating(false);
    }
  }, [studyPlan, exceptionDateRules, studyResources]);

  const updateTaskStatus = useCallback((taskId: string, status: ScheduledTask['status']) => {
    if (!studyPlan) return;

    const updatedSchedule = studyPlan.schedule.map(day => ({
      ...day,
      tasks: day.tasks.map(task => 
        task.id === taskId ? { ...task, status } : task
      )
    }));

    setStudyPlan({
      ...studyPlan,
      schedule: updatedSchedule
    });
  }, [studyPlan]);

  const planStats = useMemo(() => {
    if (!studyPlan) return null;

    const totalTasks = studyPlan.schedule.reduce((sum, day) => sum + day.tasks.length, 0);
    const completedTasks = studyPlan.schedule.reduce(
      (sum, day) => sum + day.tasks.filter(task => task.status === 'completed').length, 
      0
    );
    const totalStudyTime = studyPlan.schedule.reduce((sum, day) => sum + day.totalStudyTimeMinutes, 0);
    const completedStudyTime = studyPlan.schedule.reduce(
      (sum, day) => sum + day.tasks
        .filter(task => task.status === 'completed')
        .reduce((taskSum, task) => taskSum + task.durationMinutes, 0),
      0
    );

    return {
      totalTasks,
      completedTasks,
      completionPercentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalStudyHours: Math.round(totalStudyTime / 60),
      completedStudyHours: Math.round(completedStudyTime / 60),
      studyTimePercentage: totalStudyTime > 0 ? Math.round((completedStudyTime / totalStudyTime) * 100) : 0
    };
  }, [studyPlan]);

  return {
    studyPlan,
    isGenerating,
    notifications,
    generateInitialPlan,
    rebalancePlan,
    updateTaskStatus,
    planStats,
    clearNotifications: () => setNotifications([])
  };
};
