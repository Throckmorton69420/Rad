// types.ts

export enum Domain {
  PHYSICS = 'PHYSICS',
  BREAST_IMAGING = 'BREAST_IMAGING',
  GASTROINTESTINAL_IMAGING = 'GASTROINTESTINAL_IMAGING',
  NUCLEAR_MEDICINE = 'NUCLEAR_MEDICINE',
  GENITOURINARY_IMAGING = 'GENITOURINARY_IMAGING',
  NEURORADIOLOGY = 'NEURORADIOLOGY',
  PEDIATRIC_RADIOLOGY = 'PEDIATRIC_RADIOLOGY',
  THORACIC_IMAGING = 'THORACIC_IMAGING',
  CARDIOVASCULAR_IMAGING = 'CARDIOVASCULAR_IMAGING',
  MUSCULOSKELETAL_IMAGING = 'MUSCULOSKELETAL_IMAGING',
  INTERVENTIONAL_RADIOLOGY = 'INTERVENTIONAL_RADIOLOGY',
  ULTRASOUND_IMAGING = 'ULTRASOUND_IMAGING',
  NIS = 'NIS',
  RISC = 'RISC',
  HIGH_YIELD = 'HIGH_YIELD',
  MIXED_REVIEW = 'MIXED_REVIEW',
  WEAK_AREA_REVIEW = 'WEAK_AREA_REVIEW',
  QUESTION_BANK_CATCHUP = 'QUESTION_BANK_CATCHUP',
  FINAL_REVIEW = 'FINAL_REVIEW',
  LIGHT_REVIEW = 'LIGHT_REVIEW',
}

export enum ResourceType {
  READING_TEXTBOOK = 'READING_TEXTBOOK',
  READING_GUIDE = 'READING_GUIDE',
  VIDEO_LECTURE = 'VIDEO_LECTURE',
  HIGH_YIELD_VIDEO = 'HIGH_YIELD_VIDEO',
  QUESTIONS = 'QUESTIONS',
  QUESTION_REVIEW = 'QUESTION_REVIEW',
  CASES = 'CASES',
  REVIEW_QUESTIONS = 'REVIEW_QUESTIONS',
  EXAM_SIM = 'EXAM_SIM',
  PRACTICE_TOPIC = 'PRACTICE_TOPIC',
  FLIP_THROUGH = 'FLIP_THROUGH',
  PERSONAL_NOTES = 'PERSONAL_NOTES',
}

export interface StudyResource {
  id: string;
  title: string;
  type: ResourceType;
  domain: Domain;
  durationMinutes: number;
  isPrimaryMaterial: boolean;
  isSplittable: boolean;
  isArchived: boolean;
  isOptional?: boolean;
  schedulingPriority?: 'high' | 'medium' | 'low';
  pages?: number;
  startPage?: number;
  endPage?: number;
  questionCount?: number;
  caseCount?: number;
  bookSource?: string;
  videoSource?: string;
  chapterNumber?: number;
  sequenceOrder?: number;
  pairedResourceIds?: string[];
  dependencies?: string[];
  priorityTier?: 1 | 2 | 3;
}

export interface ScheduledTask {
  id: string;
  resourceId: string;
  originalResourceId?: string;
  title: string;
  type: ResourceType;
  originalTopic: Domain;
  durationMinutes: number;
  status: 'pending' | 'completed';
  order: number;
  isOptional?: boolean;
  isPrimaryMaterial?: boolean;
  actualStudyTimeMinutes?: number;
  pages?: number;
  startPage?: number;
  endPage?: number;
  caseCount?: number;
  questionCount?: number;
  chapterNumber?: number;
  bookSource?: string;
  videoSource?: string;
}

export interface DailySchedule {
  date: string; // YYYY-MM-DD
  dayName: string;
  tasks: ScheduledTask[];
  totalStudyTimeMinutes: number;
  isRestDay: boolean;
  isManuallyModified: boolean;
}

export interface DeadlineSettings {
  allContent?: string;
  physicsContent?: string;
  nucMedContent?: string;
  otherContent?: string;
}

export interface StudyPlan {
  schedule: DailySchedule[];
  progressPerDomain: Partial<Record<Domain, { completedMinutes: number; totalMinutes: number }>>;
  startDate: string;
  endDate: string;
  firstPassEndDate: string | null;
  topicOrder: Domain[];
  cramTopicOrder: Domain[];
  deadlines: DeadlineSettings;
  isCramModeActive: boolean;
  areSpecialTopicsInterleaved: boolean;
}

export interface PomodoroSettings {
  studyDuration: number;
  restDuration: number;
  isActive: boolean;
  isStudySession: boolean;
  timeLeft: number;
}

export enum ViewMode {
  DAILY = 'Daily',
  WEEKLY = 'Weekly',
  MONTHLY = 'Monthly',
}

export interface ExceptionDateRule {
    date: string;
    dayType: 'specific-rest' | 'weekday-moonlighting' | 'weekend-moonlighting' | 'exception';
    isRestDayOverride: boolean;
    targetMinutes?: number;
}

export interface Constraints {
    dailyTimeBudget: [number, number];
    physicsFrequencyDays: number;
    exceptionDates: ExceptionDateRule[];
}

export interface GeneratedStudyPlanOutcome {
    plan: StudyPlan;
    notifications: { type: 'error' | 'warning' | 'info', message: string }[];
}

export type RebalanceType = 'standard' | 'topic-time';
export interface StandardRebalanceOptions {
    type: 'standard';
    rebalanceDate?: string;
}
export interface TopicTimeRebalanceOptions {
    type: 'topic-time';
    date: string;
    topics: Domain[];
    totalTimeMinutes: number;
}
export type RebalanceOptions = StandardRebalanceOptions | TopicTimeRebalanceOptions;

export interface PlanDataBlob {
  plan: StudyPlan;
  resources: StudyResource[];
  exceptions: ExceptionDateRule[];
}

// Component Prop Types
export interface DailyTaskListProps {
  dailySchedule: DailySchedule;
  onTaskToggle: (taskId: string) => void;
  onOpenAddTaskModal: () => void;
  onOpenModifyDayModal: () => void;
  currentPomodoroTaskId: string | null;
  onPomodoroTaskSelect: (taskId: string | null) => void;
  onNavigateDay: (direction: 'next' | 'prev') => void;
  isPomodoroActive: boolean;
  onToggleRestDay: (isCurrentlyRestDay: boolean) => void;
  onUpdateTimeForDay: (newTotalMinutes: number) => void;
  isLoading: boolean;
}

export interface AddTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (taskData: { 
    title: string; 
    durationMinutes: number; 
    domain: Domain; 
    type: ResourceType,
    pages?: number;
    caseCount?: number;
    questionCount?: number;
    chapterNumber?: number;
  }) => void;
  availableDomains: Domain[];
  selectedDate: string;
}

export interface TaskItemProps {
  task: ScheduledTask;
  onToggle: (taskId: string) => void;
  isCurrentPomodoroTask: boolean;
  isPulsing: boolean;
  onSetPomodoro: () => void;
}

export interface ResourceEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (resourceData: Omit<StudyResource, 'id'> & { id?: string }) => void;
  onRequestArchive: (resourceId: string) => void;
  initialResource: StudyResource | null;
  availableDomains: Domain[];
  availableResourceTypes: ResourceType[];
}

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCancel?: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export interface ModifyDayTasksModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (updatedTasks: ScheduledTask[]) => void;
    tasksForDay: ScheduledTask[];
    allResources: StudyResource[];
    selectedDate: string;
    showConfirmation: (options: ShowConfirmationOptions) => void;
    openAddResourceModal: () => void;
    onEditResource: (resource: StudyResource) => void;
    onArchiveResource: (resourceId: string) => void;
    onRestoreResource: (resourceId: string) => void;
    onPermanentDeleteResource: (resourceId: string) => void;
    isCramModeActive: boolean;
}

export interface ShowConfirmationOptions extends Omit<ConfirmationModalProps, 'isOpen' | 'onClose'> { }

export interface TopicOrderManagerProps {
  topicOrder: Domain[];
  onSaveOrder: (newOrder: Domain[]) => void;
  cramTopicOrder?: Domain[];
  onSaveCramOrder?: (newOrder: Domain[]) => void;
  isLoading: boolean;
  isCramModeActive: boolean;
  areSpecialTopicsInterleaved: boolean;
  onToggleSpecialTopicsInterleaving: (isActive: boolean) => void;
}

export interface AdvancedControlsProps {
    onRebalance: (options: RebalanceOptions) => void;
    isLoading: boolean;
    selectedDate: string;
    isCramModeActive: boolean;
    onToggleCramMode: (isActive: boolean) => void;
    deadlines: DeadlineSettings;
    onUpdateDeadlines: (newDeadlines: DeadlineSettings) => void;
    startDate: string;
    endDate: string;
    onUpdateDates: (startDate: string, endDate: string) => void;
}

export interface PrintOptions {
  schedule: {
    reportType: 'full' | 'range' | 'currentDay' | 'currentWeek';
    pageBreakPerWeek: boolean;
    startDate?: string;
    endDate?: string;
  };
  progress: {
    includeSummary: boolean;
    includeDeadlines: boolean;
    includeTopic: boolean;
    includeType: boolean;
    includeSource: boolean;
  };
  content: {
    filter: 'all' | 'scheduled' | 'unscheduled' | 'archived';
    sortBy: 'sequenceOrder' | 'title' | 'domain' | 'durationMinutesAsc' | 'durationMinutesDesc';
  };
}

export interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateReport: (activeTab: 'schedule' | 'progress' | 'content', options: PrintOptions) => void;
  studyPlan: StudyPlan;
  currentDate: string;
  activeFilters: {
    domain: Domain | 'all';
    type: ResourceType | 'all';
    source: string | 'all';
  };
  initialTab: 'schedule' | 'progress' | 'content';
}