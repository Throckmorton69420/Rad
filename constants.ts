import { Domain } from './types';

// Study planning constants
export const DEFAULT_DAILY_STUDY_MINS = 840;  // 14 hours
export const MIN_DURATION_for_SPLIT_PART = 90;
export const MAX_HOURS_PER_DAY = 14;

// New timing constants to match backend
export const MINUTES_PER_PAGE = 0.75;
export const MINUTES_PER_CASE = 1.0;
export const MINUTES_PER_QUESTION = 0.75;

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

// Task type priority for sorting
export const TASK_TYPE_PRIORITY = {
  'VIDEO_LECTURE': 1,
  'HIGH_YIELD_VIDEO': 2,
  'READING_TEXTBOOK': 3,
  'READING_HIGH_YIELD': 4,
  'CASE_COMPANION': 5,
  'QUESTIONS': 6,
  'FLASHCARDS': 7
};

// Date defaults
export const DEFAULT_START_DATE = '2025-10-15';
export const DEFAULT_END_DATE = '2025-11-07';  // Extended window

// Board Vitals estimation
export const ESTIMATED_TOTAL_BV_QUESTIONS = 2000;
export const BV_QUESTIONS_PER_MINUTE = 1 / MINUTES_PER_QUESTION;  // ~1.33 questions per minute at 0.75 min/Q
