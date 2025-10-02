import React from 'react';

export enum ResourceType {
  READING_TEXTBOOK = 'Textbook Reading',
  READING_GUIDE = 'Study Guide Reading',
  VIDEO_LECTURE = 'Video Lecture',
  CASES = 'Case Review',
  QUESTIONS = 'Question Bank',
  REVIEW_QUESTIONS = 'Review Questions',
  QUESTION_REVIEW = 'Question Review',
  EXAM_SIM = 'Exam Simulation',
  HIGH_YIELD_VIDEO = 'High-Yield Video',
  PERSONAL_NOTES = 'Personal Notes Review',
  FLIP_THROUGH = 'Visual Flip-Through',
  PRACTICE_TOPIC = 'Practice Topic',
}

export enum Domain {
  PHYSICS = 'Physics',
  BREAST_IMAGING = 'Breast Imaging',
  GASTROINTESTINAL_IMAGING = 'GI Imaging',
  NUCLEAR_MEDICINE = 'Nuclear Medicine',
  GENITOURINARY_IMAGING = 'GU Imaging',
  NEURORADIOLOGY = 'Neuroradiology',
  PEDIATRIC_RADIOLOGY = 'Pediatric Radiology',
  THORACIC_IMAGING = 'Thoracic Imaging',
  CARDIOVASCULAR_IMAGING = 'Cardiac & Vascular',
  MUSCULOSKELETAL_IMAGING = 'MSK Imaging',
  INTERVENTIONAL_RADIOLOGY = 'IR',
  ULTRASOUND_IMAGING = 'Ultrasound Imaging',
  NIS = 'NIS',
  RISC = 'RISC',
  HIGH_YIELD = 'High Yield',
  MIXED_REVIEW = 'Mixed Review',
  WEAK_AREA_REVIEW = 'Weak Area Review',
  QUESTION_BANK_CATCHUP = 'Question Bank Catchup',
  FINAL_REVIEW = 'Final Review',
  LIGHT_REVIEW = 'Light Review'
}

export interface StudyResource {
  id: string;
  title: string;
  type: ResourceType;
  domain: Domain;
  durationMinutes: number;
  sequenceOrder?: number;
  pages?: number;
  startPage?: number;
  endPage?: number;
  questionCount?: number;
  bookSource?: string;
  chapterNumber?: number;
  videoSource?: string;
  pairedResourceIds?: string[];
  isPrimaryMaterial: boolean;
  isSplittable?: boolean;
  isSplitSource?: boolean; 
  sourceDocument?: string;
  specificDetail?: string;
  initialPass?: boolean; 
  reviewPass?: boolean;  
  baseResourceId?: string; 
  requiresImmediateReview?: boolean; 
  originalResourceId?: string; 
  partNumber?: number; 
  totalParts?: number;
  isArchived: boolean;
}

export interface ScheduledTask {
  id: string;
  resourceId: string;
  title: string;
  type: ResourceType;
  originalTopic: Domain; 
  durationMinutes: number;
  status: 'pending' | 'completed' | 'in-progress';
  order: number; 
  startTime?: string;
  isOptional?: boolean;
  actualStudyTimeMinutes?: number;
  pages?: number;
  startPage?: number;
  endPage?: number;
  caseCount?: number;
  questionCount?: number;
  chapterNumber?: number;
  originalResourceId?: string; 
  partNumber?: number;
  totalParts?: number;
  isSplitPart?: boolean;     
  isPrimaryMaterial?: boolean;
  bookSource?: string;
  videoSource?: string;
}

export interface DailySchedule {
  date: string;
  tasks: ScheduledTask[];
  totalStudyTimeMinutes: number;
  isRestDay: boolean;
  dayType: 'workday' | 'high-capacity' | 'exception' | 'rest' | 'holiday' | 'exam-day' | 'workday-exception' | 'high-capacity-exception' | 'rest-exception' | 'specific-rest' | 'weekday-moonlighting' | 'weekend-moonlighting' | 'final-review';
  dayName?: string;
  isManuallyModified?: boolean;
}

export interface DailyTaskListProps {
  dailySchedule: DailySchedule;
  onTaskToggle: (taskId: string) => void;
  onOpenAddTaskModal: () => void;
  onOpenModifyDayModal: () => void;
  currentPomodoroTaskId: string | null;
  onPomodoroTaskSelect: (taskId: string | null) => void;
  onNavigateDay: (direction: 'next' | 'prev') => void;
  isPomodoroActive: boolean;
  onTaskDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onTaskDragStart: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void;
  onToggleRestDay: (isCurrentlyRestDay: boolean) => void;
  onUpdateTimeForDay: (newTotalMinutes: number) => void;
  isLoading: boolean;
}

export interface TaskItemProps {
  task: ScheduledTask;
  onToggle: (taskId: string) => void;
  isCurrentPomodoroTask: boolean;
  onSetPomodoro: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  isPulsing: boolean;
}

export interface DeadlineSettings {
  allContent?: string; // YYYY-MM-DD
  physicsContent?: string;
  nucMedContent?: string;
  otherContent?: string;
}

export interface StudyPlan {
  startDate: string;
  endDate: string;
  schedule: DailySchedule[];
  progressPerDomain: Partial<Record<Domain, { completedMinutes: number; totalMinutes: number }>>;
  firstPassEndDate?: string;
  topicOrder: Domain[];
  cramTopicOrder: Domain[];
  isPhysicsInTopicOrder: boolean;
  isCramModeActive?: boolean;
  isCramPhysicsInterleaved: boolean;
  deadlines: DeadlineSettings;
}

export interface ExceptionDateRule {
  date: string;
  targetMinutes?: number;
  dayType: 'workday-exception' | 'high-capacity-exception' | 'rest-exception' | 'specific-rest' | 'weekday-moonlighting' | 'weekend-moonlighting' | 'final-review' | 'exception';
  isRestDayOverride?: boolean;
}

export interface Constraints {
  dailyTimeBudget: [number, number]; 
  physicsFrequencyDays: number; 
  exceptionDates?: ExceptionDateRule[];
}

export interface PomodoroSettings {
  studyDuration: number;
  restDuration: number;
  isActive: boolean;
  isStudySession: boolean;
  timeLeft: number;
}

export interface AddTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (taskData: {
    title: string;
    durationMinutes: number;
    domain: Domain;
    type: ResourceType;
    pages?: number;
    caseCount?: number;
    questionCount?: number;
    chapterNumber?: number;
  }) => void;
  availableDomains: Domain[];
  selectedDate?: string;
}

export interface ModifyDayTasksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedTasks: ScheduledTask[]) => void;
  tasksForDay: ScheduledTask[];
  allResources: StudyResource[];
  selectedDate: string;
  showConfirmation: (options: ShowConfirmationOptions) => void;
  onEditResource: (resource: StudyResource) => void;
  onArchiveResource: (resourceId: string) => void;
  onRestoreResource: (resourceId: string) => void;
  onPermanentDeleteResource: (resourceId: string) => void;
  openAddResourceModal: () => void;
  isCramModeActive: boolean;
}

export interface ResourceEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (resourceData: Omit<StudyResource, 'id' | 'isArchived'> & { id?: string, isArchived: boolean }) => void;
  onRequestArchive: (resourceId: string) => void;
  initialResource?: StudyResource | null;
  availableDomains: Domain[];
  availableResourceTypes: ResourceType[];
}

export type RebalanceOptions =
  | { type: 'standard' }
  | {
      type: 'topic-time';
      date: string; 
      topics: Domain[];
      totalTimeMinutes: number;
    };


export enum ViewMode {
  DAILY = 'Daily',
  WEEKLY = 'Weekly',
  MONTHLY = 'Monthly',
}

export interface DailyStats {
  actualStudyMinutes: number;
  actualBreakMinutes: number;
}

export interface GeneratedStudyPlanOutcome {
  plan: StudyPlan;
  notifications?: { type: 'warning' | 'info', message: string }[];
}


export interface StudyBlock {
  id: string;
  domain: Domain;
  totalDuration: number;
  tasks: StudyResource[];
  sequenceOrder: number;
}

export interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    onCancel?: () => void;
    title: string;
    message: string | React.ReactElement;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'primary' | 'danger';
}

export interface ShowConfirmationOptions {
    title: string;
    message: string | React.ReactElement;
    onConfirm: () => void;
    cancelText?: string;
    onCancel?: () => void;
    confirmText?: string;
    confirmVariant?: 'primary' | 'danger';
}

export interface TopicOrderManagerProps {
  topicOrder: Domain[];
  onSaveOrder: (newOrder: Domain[]) => void;
  cramTopicOrder?: Domain[];
  onSaveCramOrder?: (newOrder: Domain[]) => void;
  isLoading: boolean;
  isPhysicsInTopicOrder: boolean;
  onTogglePhysicsManagement: (isManaged: boolean) => void;
  isCramModeActive: boolean;
  isCramPhysicsInterleaved: boolean;
  onToggleCramPhysicsManagement: (isInterleaved: boolean) => void;
}

export interface AdvancedControlsProps {
  onRebalance: (options: RebalanceOptions) => void;
  isLoading: boolean;
  selectedDate: string;
  isCramModeActive: boolean;
  onToggleCramMode: (isActive: boolean) => void;
  deadlines: DeadlineSettings;
  onUpdateDeadlines: (newDeadlines: DeadlineSettings) => void;
}


export interface PlanDataBlob {
  plan: StudyPlan;
  resources: StudyResource[];
  exceptions: ExceptionDateRule[];
}
