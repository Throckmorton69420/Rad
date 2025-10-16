// FIX: Corrected import path for types.
import { Domain, Constraints, ExceptionDateRule, ResourceType } from './types'; 
import { getTodayInNewYork } from './utils/timeFormatter';

export const EXAM_DATE_START = "2025-11-11";

// The study period is now fixed. The rebalance logic handles scheduling from "today" onwards,
// while the initial generation will always create a plan for the full period.
// This prevents errors if the app is opened after the study period has ended.
export const STUDY_START_DATE = "2025-10-16";
export const STUDY_END_DATE = "2025-11-07"; 

export const DEFAULT_DAILY_STUDY_MINS = 840; // 14 hours baseline
export const MIN_DURATION_for_SPLIT_PART = 90;
export const MAX_HOURS_PER_DAY = 14;

// New timing constants to match backend
export const MINUTES_PER_PAGE = 0.75;
export const MINUTES_PER_CASE = 1.0;
export const MINUTES_PER_QUESTION = 0.75;

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

// Default topic order (Titan sequence)
export const DEFAULT_TOPIC_ORDER: Domain[] = [
  Domain.GASTROINTESTINAL_IMAGING,
  Domain.GENITOURINARY_IMAGING,
  Domain.THORACIC_IMAGING,
  Domain.NEURORADIOLOGY,
  Domain.MUSCULOSKELETAL_IMAGING,
  Domain.PEDIATRIC_RADIOLOGY,
  Domain.CARDIOVASCULAR_IMAGING,
  Domain.BREAST_IMAGING,
  Domain.NUCLEAR_MEDICINE,
  Domain.INTERVENTIONAL_RADIOLOGY,
  Domain.PHYSICS,
  Domain.NIS,
  Domain.RISC
];

export const TASK_TYPE_PRIORITY: Record<ResourceType, number> = {
    [ResourceType.VIDEO_LECTURE]: 1,
    [ResourceType.HIGH_YIELD_VIDEO]: 2,
    [ResourceType.READING_TEXTBOOK]: 2,
    [ResourceType.READING_GUIDE]: 2,
    [ResourceType.READING_HIGH_YIELD]: 2,
    [ResourceType.CASES]: 3,
    [ResourceType.QUESTIONS]: 4,
    [ResourceType.REVIEW_QUESTIONS]: 5,
    [ResourceType.QUESTION_REVIEW]: 5,
    [ResourceType.EXAM_SIM]: 6,
    [ResourceType.PRACTICE_TOPIC]: 7,
    [ResourceType.FLIP_THROUGH]: 8,
    [ResourceType.PERSONAL_NOTES]: 9,
};


// Per user request, all default exception/rest days are removed.
const rawExceptionRules: ExceptionDateRule[] = [
    // All dedicated review days have been removed as per user request.
];

export const EXCEPTION_DATES_CONFIG: ExceptionDateRule[] = rawExceptionRules.filter((value, index, self) =>
    index === self.findIndex((t) => (
      t.date === value.date
    ))
); // De-duplicate dates, giving priority to the dynamic 'tomorrow' if it overlaps.


export const DEFAULT_CONSTRAINTS: Constraints = {
  dailyTimeBudget: [DEFAULT_DAILY_STUDY_MINS, DEFAULT_DAILY_STUDY_MINS],
  exceptionDates: EXCEPTION_DATES_CONFIG, 
};

// Board Vitals estimation
export const ESTIMATED_TOTAL_BV_QUESTIONS = 2000;
export const BV_QUESTIONS_PER_MINUTE = 1 / MINUTES_PER_QUESTION;  // ~1.33 questions per minute at 0.75 min/Q
