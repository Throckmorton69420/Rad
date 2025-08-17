import { Domain, Constraints, ExceptionDateRule, ResourceType } from './types'; 
import { getTodayInNewYork } from './utils/timeFormatter';

export const EXAM_DATE_START = "2025-11-12";

// Use today's date for planning, correctly handled for timezone.
const ACTUAL_TODAY_FOR_PLANNING = getTodayInNewYork();
const CONFIGURED_STUDY_START_DATE = "2025-06-13"; 

// The schedule starts from today if today is after the original configured start date.
const effectiveStartDate = ACTUAL_TODAY_FOR_PLANNING > CONFIGURED_STUDY_START_DATE
                            ? ACTUAL_TODAY_FOR_PLANNING
                            : CONFIGURED_STUDY_START_DATE;

export const STUDY_START_DATE = effectiveStartDate;
export const STUDY_END_DATE = "2025-11-11"; 

// Aligned with "Strict Daily Time Budgets" from Project Vision PDF (page 3)
export const WORKDAY_TARGET_MINS_MIN = 180; // 3 hours
export const WORKDAY_TARGET_MINS_MAX = 240; // 4 hours
export const HIGH_CAPACITY_TARGET_MINS_MIN = 360; // 6 hours
export const HIGH_CAPACITY_TARGET_MINS_MAX = 420; // 7 hours
export const WEEKDAY_QUESTION_BLOCK_OVERFLOW_MINUTES = 45; // Allow Q&R block to exceed daily budget on weekdays
export const WEEKEND_QUESTION_BLOCK_OVERFLOW_MINUTES = 90; // Allow Q&R block to exceed daily budget on weekends


// Per user request for new exception types
export const MOONLIGHTING_WEEKDAY_TARGET_MINS = 90; // 1.5 hours
export const MOONLIGHTING_WEEKEND_TARGET_MINS = 210; // 3.5 hours

export const POMODORO_DEFAULT_STUDY_MINS = 45;
export const POMODORO_DEFAULT_REST_MINS = 10;

export const ALL_DOMAINS: Domain[] = Object.values(Domain);

export const PROGRESS_UPDATE_INTERVAL_MS = 250; // Made faster for a better UI feel

export const APP_TITLE = "Radiology Core Exam Planner";

// Default order for studying topics. Physics is foundational.
export const DEFAULT_TOPIC_ORDER: Domain[] = [
    Domain.PHYSICS,
    Domain.BREAST_IMAGING,
    Domain.GASTROINTESTINAL_IMAGING,
    Domain.GENITOURINARY_IMAGING,
    Domain.THORACIC_IMAGING,
    Domain.CARDIOVASCULAR_IMAGING,
    Domain.MUSCULOSKELETAL_IMAGING,
    Domain.NEURORADIOLOGY,
    Domain.PEDIATRIC_RADIOLOGY,
    Domain.NUCLEAR_MEDICINE,
    Domain.ULTRASOUND_IMAGING,
    Domain.INTERVENTIONAL_RADIOLOGY,
    Domain.NIS,
    Domain.RISC,
];


// From Project Vision PDF (page 3) and user feedback
const rawExceptionRules: ExceptionDateRule[] = [
  // Corrected and added rest days per user request
  { date: "2025-06-28", dayType: 'specific-rest', isRestDayOverride: true, targetMinutes: 0 },
  { date: "2025-08-06", dayType: 'specific-rest', isRestDayOverride: true, targetMinutes: 0 },
  { date: "2025-08-09", dayType: 'specific-rest', isRestDayOverride: true, targetMinutes: 0 },
  { date: "2025-08-14", dayType: 'specific-rest', isRestDayOverride: true, targetMinutes: 0 },
  { date: "2025-09-15", dayType: 'specific-rest', isRestDayOverride: true, targetMinutes: 0 },
  
  // Workday Exceptions (target 3-4 hours, use max for budget)
  ...["2025-06-10", "2025-06-11", "2025-06-12", "2025-06-13"].map((date): ExceptionDateRule => ({ date, dayType: 'workday-exception', targetMinutes: WORKDAY_TARGET_MINS_MAX })),
  ...["2025-06-15", "2025-06-16", "2025-06-17", "2025-06-18", "2025-06-19", "2025-06-20", "2025-06-21", "2025-06-22"].map((date): ExceptionDateRule => ({ date, dayType: 'workday-exception', targetMinutes: WORKDAY_TARGET_MINS_MAX })), // Extended from Python script
  ...["2025-10-11", "2025-10-12", "2025-10-13", "2025-10-14", "2025-10-15", "2025-10-16", "2025-10-17", "2025-10-18", "2025-10-19"].map((date): ExceptionDateRule => ({ date, dayType: 'workday-exception', targetMinutes: WORKDAY_TARGET_MINS_MAX })),
  
  // High-Capacity Exceptions (target 6-7 hours, use max for budget)
  { date: "2025-06-14", dayType: 'high-capacity-exception', targetMinutes: HIGH_CAPACITY_TARGET_MINS_MAX },

  // FINAL REVIEW WEEK (User request)
  // Rest Days Nov 2-8
  ...["2025-11-02", "2025-11-03", "2025-11-04", "2025-11-05", "2025-11-06", "2025-11-07", "2025-11-08"].map((date): ExceptionDateRule => ({ date, dayType: 'specific-rest', isRestDayOverride: true, targetMinutes: 0 })),
  // High-Yield Review Days Nov 9-11 (10 hours)
  ...["2025-11-09", "2025-11-10", "2025-11-11"].map((date): ExceptionDateRule => ({ date, dayType: 'final-review', targetMinutes: 600 })),
  
  // Default rest days (Sundays) will be handled by day of week logic, unless overridden by an exception.
];

export const EXCEPTION_DATES_CONFIG: ExceptionDateRule[] = rawExceptionRules.filter((value, index, self) =>
    index === self.findIndex((t) => (
      t.date === value.date
    ))
); // De-duplicate dates, giving priority to the dynamic 'tomorrow' if it overlaps.


export const DEFAULT_CONSTRAINTS: Constraints = {
  dailyTimeBudgetRangeWorkday: [WORKDAY_TARGET_MINS_MIN, WORKDAY_TARGET_MINS_MAX],
  dailyTimeBudgetRangeWeekend: [HIGH_CAPACITY_TARGET_MINS_MIN, HIGH_CAPACITY_TARGET_MINS_MAX],
  physicsFrequencyDays: 2, // "every two days or in small amounts every single day" - using 2 for simple heuristic
  exceptionDates: EXCEPTION_DATES_CONFIG, 
};

// For proactive splitting, split if task exceeds a normal workday's max budget.
export const MAX_TASK_DURATION_BEFORE_SPLIT_CONSIDERATION = WORKDAY_TARGET_MINS_MAX; 
export const MIN_DURATION_for_SPLIT_PART = 30;