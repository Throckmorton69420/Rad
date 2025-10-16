import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DailySchedule, StudyPlan, ScheduledTask, PomodoroSettings, ViewMode, Domain, ResourceType, AddTaskModalProps, StudyResource, ResourceEditorModalProps, ExceptionDateRule, DeadlineSettings, RebalanceOptions, ShowConfirmationOptions, PrintOptions } from './types';
import { EXAM_DATE_START, APP_TITLE, ALL_DOMAINS, POMODORO_DEFAULT_STUDY_MINS, POMODORO_DEFAULT_REST_MINS, STUDY_START_DATE, STUDY_END_DATE } from './constants';
import { generateGlassMaps } from './utils/glassEffectGenerator';

import { usePersistentState } from './hooks/usePersistentState';
import { useStudyPlanManager } from './hooks/useStudyPlanManager';
import { useModalManager } from './hooks/useModalManager';

import CountdownTimer from './components/CountdownTimer';
import PomodoroTimerComponent from './components/PomodoroTimer';
import DailyTaskList from './components/DailyTaskList';
import CalendarView from './components/CalendarView';
import ProgressDisplay from './components/ProgressDisplay';
import { Button } from './components/Button';
import AddTaskModal from './components/AddTaskModal';
import ResourceEditorModal from './components/AddGlobalResourceModal';
import AdvancedControls from './components/AdvancedControls';
import AddExceptionDay from './components/AddExceptionDay';
import ConfirmationModal from './components/ConfirmationModal';
import WelcomeModal from './components/WelcomeModal';
import TopicOrderManager from './components/TopicOrderManager';
import ModifyDayTasksModal from './components/ModifyDayTasksModal';
import MasterResourcePoolViewer from './components/MasterResourcePoolViewer';
import ScheduleReport from './components/ScheduleReport';
import PrintModal from './components/PrintModal';
import ProgressReport from './components/ProgressReport';
import ParametersPanel from './components/ParametersPanel';

import { formatDuration, getTodayInNewYork, parseDateString } from './utils/timeFormatter';
import { addResourceToGlobalPool } from './services/studyResources';

// FIX: Define the shape of the content UI filters to be shared between components.
export interface ContentUiFilters {
    searchTerm: string;
    domain: Domain | 'all';
    type: ResourceType | 'all';
    source: string | 'all';
    status: 'all' | 'scheduled' | 'unscheduled';
    showArchived: boolean;
}

interface SidebarContentProps {
    isSidebarOpen: boolean;
    setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isPomodoroCollapsed: boolean;
    setIsPomodoroCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    pomodoroSettings: PomodoroSettings;
    setPomodoroSettings: React.Dispatch<React.SetStateAction<PomodoroSettings>>;
    handlePomodoroSessionComplete: (sessionType: 'study' | 'rest', durationMinutes: number) => void;
    currentPomodoroTask: ScheduledTask | null;
    studyPlan: StudyPlan;
    selectedDate: string;
    setSelectedDate: React.Dispatch<React.SetStateAction<string>>;
    isMobile: boolean;
    navigatePeriod: (direction: 'next' | 'prev') => void;
    highlightedDates: string[];
    todayInNewYork: string;
    handleRebalance: (options: RebalanceOptions, planToUse?: StudyPlan) => void;
    isLoading: boolean;
    handleToggleCramMode: (isActive: boolean) => void;
    handleUpdateDeadlines: (newDeadlines: DeadlineSettings) => void;
    isSettingsOpen: boolean;
    setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleUpdateTopicOrderAndRebalance: (newOrder: Domain[]) => void;
    handleUpdateCramTopicOrderAndRebalance: (newOrder: Domain[]) => void;
    handleToggleSpecialTopicsInterleaving: (isActive: boolean) => void;
    handleAddOrUpdateException: (rule: ExceptionDateRule) => void;
    handleUndo: () => void;
    previousStudyPlan: StudyPlan | null;
    showConfirmation: (options: ShowConfirmationOptions) => void;
    loadSchedule: (regenerate?: boolean) => Promise<void>;
    handleMasterResetTasks: () => void;
    handleUpdatePlanDates: (startDate: string, endDate: string) => void;
    handleGenerateORToolsSchedule: () => void;
}

// Memoized Sidebar to prevent re-renders from the Pomodoro timer
const SidebarContent = React.memo(({ 
    setIsSidebarOpen, isPomodoroCollapsed, setIsPomodoroCollapsed, 
    pomodoroSettings, setPomodoroSettings, handlePomodoroSessionComplete, currentPomodoroTask,
    studyPlan, selectedDate, setSelectedDate, isMobile, navigatePeriod, highlightedDates, 
    todayInNewYork, handleRebalance, isLoading, handleToggleCramMode, handleUpdateDeadlines,
    isSettingsOpen, setIsSettingsOpen, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
    handleToggleSpecialTopicsInterleaving, handleAddOrUpdateException, handleUndo, previousStudyPlan,
    showConfirmation, loadSchedule, handleMasterResetTasks, handleUpdatePlanDates, handleGenerateORToolsSchedule
}: SidebarContentProps) => (
    <aside className={`w-80 text-[var(--text-secondary)] flex flex-col h-dvh isolated-scroll glass-chrome`}>
        <div className="flex-grow flex flex-col min-h-0">
            <div className="flex-grow overflow-y-auto isolated-scroll sidebar-content-area">
                <div className="space-y-4">
                    <div className="flex justify-end -mr-2 -mt-2 lg:hidden">
                        <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-[var(--text-primary)] hover:text-white" aria-label="Close menu">
                            <i className="fas fa-times fa-lg"></i>
                        </button>
                    </div>
                    <div>
                        <button onClick={() => setIsPomodoroCollapsed(!isPomodoroCollapsed)} className="w-full text-lg font-semibold text-left text-[var(--text-primary)] flex justify-between items-center py-2">
                            <span>Pomodoro Timer</span>
                            <i className={`fas fa-chevron-down transition-transform ${isPomodoroCollapsed ? '' : 'rotate-180'}`}></i>
                        </button>
                        {!isPomodoroCollapsed && (
                            <div className="animate-fade-in">
                                <PomodoroTimerComponent settings={pomodoroSettings} setSettings={setPomodoroSettings} onSessionComplete={handlePomodoroSessionComplete} linkedTaskTitle={currentPomodoroTask?.title}/>
                            </div>
                        )}
                    </div>

                    <div className="border-b border-[var(--separator-primary)] my-2"></div>
                    
                    <div>
                        <h2 className="text-lg font-semibold mb-3 border-b border-[var(--separator-primary)] pb-2 text-[var(--text-primary)]">Calendar</h2>
                        <CalendarView 
                            schedule={studyPlan.schedule} 
                            selectedDate={selectedDate} 
                            onDateSelect={(d) => {setSelectedDate(d); if (isMobile) setIsSidebarOpen(false);}} 
                            viewMode={ViewMode.MONTHLY}
                            currentDisplayDate={selectedDate} 
                            onNavigatePeriod={navigatePeriod} 
                            highlightedDates={highlightedDates} 
                            today={todayInNewYork}
                        />
                    </div>
                    
                    <AdvancedControls
                        onRebalance={(options) => { handleRebalance(options); if(options.type === 'topic-time') setSelectedDate(options.date); }} 
                        isLoading={isLoading} 
                        selectedDate={selectedDate} 
                        isCramModeActive={studyPlan.isCramModeActive ?? false}
                        onToggleCramMode={handleToggleCramMode}
                        deadlines={studyPlan.deadlines}
                        onUpdateDeadlines={handleUpdateDeadlines}
                        startDate={studyPlan.startDate}
                        endDate={studyPlan.endDate}
                        onUpdateDates={handleUpdatePlanDates}
                    />

                    <div className="space-y-3">
                        <button onClick={() => setIsSettingsOpen(!isSettingsOpen)} className="w-full text-lg font-semibold text-left text-[var(--text-primary)] flex justify-between items-center">
                            <span>Schedule Settings</span>
                            <i className={`fas fa-chevron-down transition-transform ${isSettingsOpen ? 'rotate-180' : ''}`}></i>
                        </button>
                        {isSettingsOpen && (
                            <div className="animate-fade-in pl-1">
                                <TopicOrderManager 
                                    topicOrder={studyPlan.topicOrder} 
                                    onSaveOrder={handleUpdateTopicOrderAndRebalance} 
                                    cramTopicOrder={studyPlan.cramTopicOrder}
                                    onSaveCramOrder={handleUpdateCramTopicOrderAndRebalance}
                                    isLoading={isLoading} 
                                    isCramModeActive={studyPlan.isCramModeActive ?? false}
                                    areSpecialTopicsInterleaved={studyPlan.areSpecialTopicsInterleaved}
                                />
                            </div>
                        )}
                    </div>

                    <AddExceptionDay onAddException={handleAddOrUpdateException} isLoading={isLoading} />
                    
                    <div>
                        <h2 className="text-lg font-semibold mb-3 border-b border-[var(--separator-primary)] pb-2 text-[var(--text-primary)]">Actions</h2>
                        <div className="space-y-2">
                            <Button onClick={handleUndo} variant="secondary" className="w-full" disabled={!previousStudyPlan || isLoading}>
                                <i className="fas fa-undo mr-2"></i> Undo Last Plan Change
                            </Button>
                            
                            <Button onClick={handleGenerateORToolsSchedule} variant="primary" className="w-full" disabled={isLoading}>
                                <i className="fas fa-robot mr-2"></i> Generate Optimized Schedule
                            </Button>
                            
                            <Button onClick={() => showConfirmation({
                                title: "Regenerate Full Schedule?",
                                message: "This will erase your entire schedule and all progress, creating a new plan from scratch using the current resource pool. This action cannot be undone.",
                                confirmText: "Yes, Regenerate",
                                confirmVariant: 'danger',
                                onConfirm: () => loadSchedule(true)
                            })} variant="danger" className="w-full" disabled={isLoading}>
                                <i className="fas fa-redo-alt mr-2"></i> Regenerate Schedule
                            </Button>
                            <Button onClick={() => showConfirmation({
                                title: "Reset All Progress?",
                                message: "This will mark all tasks as 'pending' without changing the schedule itself. Are you sure?",
                                confirmText: "Reset Progress",
                                confirmVariant: 'danger',
                                onConfirm: handleMasterResetTasks
                            })} variant="danger" className="w-full" disabled={isLoading}>
                                <i className="fas fa-tasks mr-2"></i> Reset Task Progress
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </aside>
));

const App: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  const {
    modalStates, modalData,
    openModal, closeModal,
    openResourceEditor, closeResourceEditor,
    showConfirmation, handleConfirm,
  } = useModalManager();

  const {
    studyPlan, setStudyPlan, previousStudyPlan,
    globalMasterResourcePool, setGlobalMasterResourcePool,
    isLoading, systemNotification, setSystemNotification,
    isNewUser,
    setIsNewUser,
    loadSchedule, handleRebalance, handleUpdatePlanDates, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
    handleToggleCramMode,
    handleToggleSpecialTopicsInterleaving,
    handleTaskToggle, handleSaveModifiedDayTasks, handleUndo,
    updatePreviousStudyPlan,
    saveStatus,
    handleToggleRestDay,
    handleAddOrUpdateException,
    handleUpdateDeadlines,
    handleGenerateORToolsSchedule,
    optimizationProgress
  } = useStudyPlanManager(showConfirmation);

  const todayInNewYork = useMemo(() => getTodayInNewYork(), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayInNewYork);
  const [pomodoroSettings, setPomodoroSettings] = usePersistentState<PomodoroSettings>('radiology_pomodoro_settings', {
    studyDuration: POMODORO_DEFAULT_STUDY_MINS,
    restDuration: POMODORO_DEFAULT_REST_MINS,
    isActive: false, isStudySession: true, timeLeft: POMODORO_DEFAULT_STUDY_MINS * 60,
  });
  const [currentPomodoroTaskId, setCurrentPomodoroTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'schedule' | 'progress' | 'content' | 'params'>('schedule');

  const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
  const [isPomodoroCollapsed, setIsPomodoroCollapsed] = usePersistentState('radiology_pomodoro_collapsed', true);
  
  // FIX: Lifted state from MasterResourcePoolViewer to be shared with PrintModal and report generation.
  const [contentUiFilters, setContentUiFilters] = useState<ContentUiFilters>({
    searchTerm: '',
    domain: 'all',
    type: 'all',
    source: 'all',
    status: 'all',
    showArchived: false,
  });

  const [solverParams, setSolverParams] = React.useState({
    MIN_CHUNK_MINUTES: 15,
    TARGET_CHUNK_MINUTES: 30,
    DAILY_CAP_MINUTES: 840,
    MAX_TASKS_PER_DAY: 18,
    TIER1_WEEKLY_SHARE: 0.6,
    PHYSICS_WEEKLY_SHARE: 0.2,
    QB_NIS_WEEKLY_CEIL: 0.2,
    W_LATE_TIER1: 1000,
    W_LATE_PHYS: 250,
    W_UNSCHED: 500,
    W_FRAG: 1.5,
    W_LONGTASK: 0.01,
    ORTOOLS_WORKERS: 8,
    ORTOOLS_MAX_TIME: 180,
  });

  const handleReorderTasks = React.useCallback((date: string, tasks: ScheduledTask[]) => {
    setStudyPlan(prev => {
      if (!prev) return prev;
      const updatedSchedule = prev.schedule.map(d =>
        d.date === date ? { ...d, tasks } : d
      );
      return { ...prev, schedule: updatedSchedule };
    });
  }, [setStudyPlan]);

  useEffect(() => {
    const { displacement, highlight } = generateGlassMaps({});
    const displacementEl = document.getElementById('displacementMapImage') as unknown as SVGImageElement | null;
    const highlightEl = document.getElementById('specularHighlightImage') as unknown as SVGImageElement | null;
    if (displacementEl) displacementEl.setAttribute('href', displacement);
    if (highlightEl) highlightEl.setAttribute('href', highlight);
  }, []);

  useEffect(() => {
    if (isNewUser) {
      openModal('isWelcomeModalOpen');
    }
  }, [isNewUser, openModal]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);
  
  useEffect(() => {
    if (studyPlan) {
      const { startDate, endDate } = studyPlan;
      if (selectedDate < startDate || selectedDate > endDate) {
        if (todayInNewYork >= startDate && todayInNewYork <= endDate) {
          setSelectedDate(todayInNewYork);
        } else {
          setSelectedDate(startDate);
        }
      }
    }
  }, [studyPlan?.startDate, studyPlan?.endDate, selectedDate, todayInNewYork]);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (printableContent) {
      const handleAfterPrint = () => {
        setPrintableContent(null);
        window.removeEventListener('afterprint', handleAfterPrint);
      };
      window.addEventListener('afterprint', handleAfterPrint);
      
      setTimeout(() => window.print(), 100);
    }
  }, [printableContent]);

  const navigateDate = useCallback((direction: 'next' | 'prev') => {
    if (!studyPlan) return;
    const { startDate, endDate } = studyPlan;
    
    setSelectedDate(currentSelectedDate => {
        const currentDateObj = parseDateString(currentSelectedDate);
        currentDateObj.setUTCDate(currentDateObj.getUTCDate() + (direction === 'next' ? 1 : -1));
        const newDateStr = currentDateObj.toISOString().split('T')[0];
        
        if (newDateStr >= startDate && newDateStr <= endDate) {
          return newDateStr;
        }
        return currentSelectedDate; // Return original date if out of bounds
    });
    setHighlightedDates([]);
  }, [studyPlan, setSelectedDate, setHighlightedDates]);
  
  const navigatePeriod = useCallback((direction: 'next' | 'prev') => {
    setSelectedDate(currentSelectedDate => {
        const currentDateObj = parseDateString(currentSelectedDate);
        // Set date to 1 to prevent month-skipping bugs (e.g., going from Oct 31 to Dec 1)
        currentDateObj.setUTCDate(1);
        currentDateObj.setUTCMonth(currentDateObj.getUTCMonth() + (direction === 'next' ? 1 : -1));
        
        if (studyPlan) {
            const startDate = parseDateString(studyPlan.startDate);
            const endDate = parseDateString(studyPlan.endDate);
            if (currentDateObj < startDate) return studyPlan.startDate;
            if (currentDateObj > endDate) return studyPlan.endDate;
        }
        
        return currentDateObj.toISOString().split('T')[0];
    });
    setHighlightedDates([]);
  }, [setSelectedDate, setHighlightedDates, studyPlan]);

  const handleUpdateTimeForDay = useCallback((newTotalMinutes: number) => {
    const newRule: ExceptionDateRule = {
      date: selectedDate,
      dayType: 'exception',
      isRestDayOverride: newTotalMinutes === 0,
      targetMinutes: newTotalMinutes,
    };
    handleAddOrUpdateException(newRule);
  }, [selectedDate, handleAddOrUpdateException]);

  const handlePomodoroTaskSelect = useCallback((taskId: string | null) => {
    setCurrentPomodoroTaskId(taskId);
    if (taskId) {
      setPomodoroSettings(prev => ({ ...prev, isActive: false, isStudySession: true, timeLeft: prev.studyDuration * 60 }));
      setIsPomodoroCollapsed(false);
    }
  }, [setPomodoroSettings, setIsPomodoroCollapsed]);

  const handleSaveResource: ResourceEditorModalProps['onSave'] = useCallback((resourceData) => {
    if (resourceData.id && modalData.editingResource) { // Update
      const fullResource = { ...modalData.editingResource, ...resourceData };
      setGlobalMasterResourcePool(prev => prev.map(r => r.id === fullResource.id ? fullResource : r));
      setSystemNotification({type: 'info', message: "Resource updated. Rebalance your schedule to apply changes."});
    } else { // Add
      const newResource = addResourceToGlobalPool(resourceData);
      setGlobalMasterResourcePool(prev => [...prev, newResource]);
      setSystemNotification({type: 'info', message: "New resource added. Rebalance your schedule to include it."});
    }
    closeResourceEditor();
  }, [modalData.editingResource, setGlobalMasterResourcePool, setSystemNotification, closeResourceEditor]);
  
  const handleRequestArchive = useCallback((resourceId: string) => {
    const resource = globalMasterResourcePool.find(r => r.id === resourceId);
    if (!resource) return;
    showConfirmation({
        title: "Archive Resource?",
        message: `Are you sure you want to archive "${resource.title}"? It will be removed from future scheduling unless restored. This won't affect past completed tasks.`,
        confirmText: "Archive",
        confirmVariant: 'danger',
        onConfirm: () => {
          setGlobalMasterResourcePool(p => p.map(r => r.id === resourceId ? {...r, isArchived: true} : r));
          setSystemNotification({ type: 'info', message: `Resource "${resource.title}" archived.` });
        }
    });
  }, [globalMasterResourcePool, showConfirmation, setGlobalMasterResourcePool, setSystemNotification]);

  const handleRestoreResource = useCallback((resourceId: string) => {
    setGlobalMasterResourcePool(p => p.map(r => r.id === resourceId ? {...r, isArchived: false} : r));
    setSystemNotification({ type: 'info', message: `Resource restored.` });
  }, [setGlobalMasterResourcePool, setSystemNotification]);
  
  const handlePermanentDelete = useCallback((resourceId: string) => {
    const resource = globalMasterResourcePool.find(r => r.id === resourceId);
    if (!resource) return;
    showConfirmation({
        title: "Delete Permanently?",
        message: <span>Are you sure you want to permanently delete "{resource.title}"? <strong className='text-red-400'>This cannot be undone.</strong></span>,
        confirmText: "Delete Permanently",
        confirmVariant: 'danger',
        onConfirm: () => {
          setGlobalMasterResourcePool(p => p.filter(r => r.id !== resourceId));
          setSystemNotification({ type: 'info', message: `Resource "${resource.title}" deleted.` });
        }
    });
  }, [globalMasterResourcePool, showConfirmation, setGlobalMasterResourcePool, setSystemNotification]);

  const handleMasterResetTasks = useCallback(() => {
    if (!studyPlan) return;
    updatePreviousStudyPlan(studyPlan);
    setStudyPlan(prev => prev ? ({ ...prev, schedule: prev.schedule.map(d => ({ ...d, tasks: d.tasks.map(t => ({...t, status: 'pending'})) }))}) : null);
  }, [studyPlan, updatePreviousStudyPlan, setStudyPlan]);

  const handleSaveOptionalTask: AddTaskModalProps['onSave'] = useCallback((taskData) => {
    setStudyPlan(prevPlan => {
        if (!prevPlan) return null;
        updatePreviousStudyPlan(prevPlan);
        const newSchedule = prevPlan.schedule.map(day => {
            if (day.date === selectedDate) {
                const newTask: ScheduledTask = {
                    id: `optional_${Date.now()}`,
                    resourceId: `optional_${Date.now()}`,
                    title: taskData.title,
                    type: taskData.type,
                    originalTopic: taskData.domain,
                    durationMinutes: taskData.durationMinutes,
                    status: 'pending',
                    order: day.tasks.length,
                    isOptional: true,
                    pages: taskData.pages,
                    caseCount: taskData.caseCount,
                    questionCount: taskData.questionCount,
                    chapterNumber: taskData.chapterNumber,
                };
                return { ...day, tasks: [...day.tasks, newTask] };
            }
            return day;
        });
        return { ...prevPlan, schedule: newSchedule };
    });
    closeModal('isAddTaskModalOpen');
  }, [selectedDate, setStudyPlan, updatePreviousStudyPlan, closeModal]);

  const onDayTasksSave = useCallback((updatedTasks: ScheduledTask[]) => {
    handleSaveModifiedDayTasks(updatedTasks, selectedDate);
    closeModal('isModifyDayTasksModalOpen');
    setTimeout(() => handleRebalance({ type: 'standard' }), 100);
  }, [handleSaveModifiedDayTasks, selectedDate, closeModal, handleRebalance]);
  
  const handlePomodoroSessionComplete = useCallback((sessionType: 'study' | 'rest', durationMinutes: number) => {
      if (sessionType === 'study' && currentPomodoroTaskId) {
          const task = studyPlan?.schedule.flatMap(d => d.tasks).find(t => t.id === currentPomodoroTaskId);
          setStudyPlan(prevPlan => {
              if (!prevPlan) return null;
              updatePreviousStudyPlan(prevPlan);
              const newSchedule = prevPlan.schedule.map(day => {
                  const taskIndex = day.tasks.findIndex(t => t.id === currentPomodoroTaskId);
                  if (taskIndex > -1) {
                      const updatedTask = { ...day.tasks[taskIndex] };
                      updatedTask.actualStudyTimeMinutes = (updatedTask.actualStudyTimeMinutes || 0) + durationMinutes;
                      const newTasks = [...day.tasks];
                      newTasks[taskIndex] = updatedTask;
                      return { ...day, tasks: newTasks };
                  }
                  return day;
              });
              return { ...prevPlan, schedule: newSchedule };
          });
          
          if (task) {
              setSystemNotification({ type: 'info', message: `Logged ${formatDuration(durationMinutes)} to "${task.title}".` });

              showConfirmation({
                  title: 'Session Complete!',
                  message: `Your study time has been logged. Would you also like to mark "${task.title}" as complete?`,
                  confirmText: 'Mark Complete',
                  onConfirm: () => {
                      if (currentPomodoroTaskId) {
                          handleTaskToggle(currentPomodoroTaskId, selectedDate);
                          setCurrentPomodoroTaskId(null);
                      }
                  }
              });
          }
      } else if (sessionType === 'rest') {
          setSystemNotification({ type: 'info', message: 'Break is over. Time to get back to it!' });
      }
  }, [currentPomodoroTaskId, studyPlan, setStudyPlan, updatePreviousStudyPlan, setSystemNotification, showConfirmation, handleTaskToggle, selectedDate]);
  
  const scheduledResourceIds = useMemo(() => {
    if (!studyPlan) return new Set<string>();
    const ids = studyPlan.schedule
      .flatMap(day => day.tasks.map(task => task.originalResourceId || task.resourceId))
      .filter((id): id is string => !!id);
    return new Set(ids);
  }, [studyPlan?.schedule]);

  const handleHighlightDatesForResource = useCallback((resourceId: string) => {
      if (!studyPlan) return;
      const dates = studyPlan.schedule
          .filter(day => day.tasks.some(task => (task.originalResourceId || task.resourceId) === resourceId))
          .map(day => day.date);
      setHighlightedDates(dates);
  }, [studyPlan]);

  const handleGoToDateForResource = useCallback((resourceId: string) => {
    if (!studyPlan) return;
    const firstDay = studyPlan.schedule.find(day => day.tasks.some(task => (task.originalResourceId || task.resourceId) === resourceId));
    if (firstDay) {
        setSelectedDate(firstDay.date);
        setActiveTab('schedule');
        if (isMobile) setIsSidebarOpen(false);
    }
  }, [studyPlan, isMobile]);
  
  const handleGenerateReport = useCallback((activeTab: 'schedule' | 'progress' | 'content', options: PrintOptions) => {
    if (!studyPlan) return;
    setIsPrintModalOpen(false);

    let reportComponent = null;

    if (activeTab === 'schedule') {
        let scheduleSubset: DailySchedule[] = [];
        let title = "Full Study Schedule";
        
        switch(options.schedule.reportType) {
            case 'full':
                scheduleSubset = studyPlan.schedule;
                break;
            case 'range':
                const { startDate, endDate } = options.schedule;
                scheduleSubset = studyPlan.schedule.filter(day => day.date >= (startDate || '0') && day.date <= (endDate || 'Z'));
                title = `Schedule from ${startDate} to ${endDate}`;
                break;
            case 'currentDay':
                scheduleSubset = studyPlan.schedule.filter(day => day.date === selectedDate);
                title = `Schedule for ${selectedDate}`;
                break;
            case 'currentWeek':
                const date = parseDateString(selectedDate);
                const dayOfWeek = date.getUTCDay();
                const firstDayOfWeek = new Date(date);
                firstDayOfWeek.setUTCDate(date.getUTCDate() - dayOfWeek);
                const weekDates = Array.from({length: 7}, (_, i) => {
                    const d = new Date(firstDayOfWeek);
                    d.setUTCDate(firstDayOfWeek.getUTCDate() + i);
                    return d.toISOString().split('T')[0];
                });
                scheduleSubset = studyPlan.schedule.filter(day => weekDates.includes(day.date));
                title = `Schedule for Week of ${weekDates[0]}`;
                break;
        }

        reportComponent = <ScheduleReport studyPlan={studyPlan} schedule={scheduleSubset} />;

    } else if (activeTab === 'progress') {
        reportComponent = <ProgressReport studyPlan={studyPlan} />;
    } else { // content
        const { filter: statusFilter, sortBy } = options.content;
        
        let resourcesToPrint = globalMasterResourcePool.map(r => ({
          ...r,
          isScheduled: scheduledResourceIds.has(r.id),
          source: r.bookSource || r.videoSource || 'Custom',
        }));

        let title = "All Resources";
        
        // FIX: Apply active UI filters (search, domain, type, source) before status filtering from print options.
        const { searchTerm, domain, type, source } = contentUiFilters;
        if (searchTerm.trim() || domain !== 'all' || type !== 'all' || source !== 'all') {
            const sTerm = searchTerm.trim().toLowerCase();
            resourcesToPrint = resourcesToPrint.filter(resource => {
                const domainMatch = domain === 'all' || resource.domain === domain;
                const typeMatch = type === 'all' || resource.type === type;
                const resourceSource = resource.bookSource || resource.videoSource || 'Custom';
                const sourceMatch = source === 'all' || resourceSource === source;
                const searchMatch = !sTerm || (
                    resource.title.toLowerCase().includes(sTerm) || resource.id.toLowerCase().includes(sTerm) ||
                    resource.domain.toLowerCase().includes(sTerm) || (resourceSource && resourceSource.toLowerCase().includes(sTerm))
                );
                return domainMatch && typeMatch && sourceMatch && searchMatch;
            });
        }
        
        if (statusFilter === 'scheduled') { resourcesToPrint = resourcesToPrint.filter(r => r.isScheduled); title = "Scheduled Resources"; }
        else if (statusFilter === 'unscheduled') { resourcesToPrint = resourcesToPrint.filter(r => !r.isScheduled && !r.isArchived); title = "Unscheduled Resources"; }
        else if (statusFilter === 'archived') { resourcesToPrint = resourcesToPrint.filter(r => r.isArchived); title = "Archived Resources"; }
        else { resourcesToPrint = resourcesToPrint.filter(r => !r.isArchived); title = "All Active Resources"; }

        resourcesToPrint.sort((a, b) => {
          switch (sortBy) {
            case 'title': return a.title.localeCompare(b.title);
            case 'domain': return a.domain.localeCompare(b.domain);
            case 'durationMinutesAsc': return a.durationMinutes - b.durationMinutes;
            case 'durationMinutesDesc': return b.durationMinutes - a.durationMinutes;
            case 'sequenceOrder':
            default: return (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999);
          }
        });

        reportComponent = <ContentReport resources={resourcesToPrint} title={title} />;
    }

    setPrintableContent(reportComponent);
  }, [studyPlan, globalMasterResourcePool, scheduledResourceIds, selectedDate, contentUiFilters]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const SaveStatusIndicator: React.FC = () => {
    switch (saveStatus) {
      case 'saving': return <div className="text-xs text-[var(--accent-yellow)] flex items-center"><i className="fas fa-sync fa-spin mr-1.5"></i> Saving...</div>;
      case 'saved': return <div className="text-xs text-[var(--accent-green)] flex items-center"><i className="fas fa-check-circle mr-1.5"></i> Saved</div>;
      case 'error': return <div className="text-xs text-[var(--accent-red)] flex items-center"><i className="fas fa-exclamation-triangle mr-1.5"></i> Error</div>;
      default: return <div className="text-xs text-[var(--text-secondary)] flex items-center"><i className="fas fa-cloud mr-1.5"></i> Synced</div>;
    }
  };

  const selectedDaySchedule = studyPlan ? studyPlan.schedule.find(day => day.date === selectedDate) : null;
  const currentPomodoroTask = currentPomodoroTaskId && studyPlan ? studyPlan.schedule.flatMap(d => d.tasks).find(t => t.id === currentPomodoroTaskId) : null;
  
  if (isLoading && !studyPlan) {
    return <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4"><i className="fas fa-brain fa-spin fa-3x mb-6 text-[var(--accent-purple)]"></i><h1 className="text-3xl font-bold mb-3">{APP_TITLE}</h1><p className="text-lg mb-6">Connecting to the cloud...</p></div>;
  }
  
  if (!studyPlan) {
     return (
       <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4">
         <i className="fas fa-exclamation-triangle fa-3x text-[var(--accent-red)] mb-4"></i>
         <h1 className="text-2xl font-bold mb-2">No Plan Loaded</h1>
         <p className="text-purple-200 text-center mb-6">
           {systemNotification?.message || 'No saved plan was found. You can generate an optimized schedule with OR‑Tools or regenerate a local plan.'}
         </p>
         <div className="flex gap-3 flex-wrap justify-center">
           <Button onClick={handleGenerateORToolsSchedule} variant="primary">Generate Optimized Schedule</Button>
           <Button onClick={() => loadSchedule(true)} variant="secondary">Regenerate Schedule</Button>
         </div>
       </div>
     );
  }

  const MainAppContent = (
      <div className="h-full w-full bg-transparent text-[var(--text-primary)] flex flex-col print:hidden">
        <div className={`lg:hidden fixed inset-y-0 left-0 z-[var(--z-sidebar-mobile)] transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <SidebarContent 
                isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} isPomodoroCollapsed={isPomodoroCollapsed} setIsPomodoroCollapsed={setIsPomodoroCollapsed}
                pomodoroSettings={pomodoroSettings} setPomodoroSettings={setPomodoroSettings} handlePomodoroSessionComplete={handlePomodoroSessionComplete} currentPomodoroTask={currentPomodoroTask}
                studyPlan={studyPlan} selectedDate={selectedDate} setSelectedDate={setSelectedDate} isMobile={isMobile} navigatePeriod={navigatePeriod} highlightedDates={highlightedDates}
                todayInNewYork={todayInNewYork} handleRebalance={handleRebalance} isLoading={isLoading} handleToggleCramMode={handleToggleCramMode} handleUpdateDeadlines={handleUpdateDeadlines}
                isSettingsOpen={isSettingsOpen} setIsSettingsOpen={setIsSettingsOpen} handleUpdateTopicOrderAndRebalance={handleUpdateTopicOrderAndRebalance}
                handleUpdateCramTopicOrderAndRebalance={handleUpdateCramTopicOrderAndRebalance} handleToggleSpecialTopicsInterleaving={handleToggleSpecialTopicsInterleaving}
                handleAddOrUpdateException={handleAddOrUpdateException} handleUndo={handleUndo} previousStudyPlan={previousStudyPlan} showConfirmation={showConfirmation}
                loadSchedule={loadSchedule} handleMasterResetTasks={handleMasterResetTasks} handleUpdatePlanDates={handleUpdatePlanDates}
                handleGenerateORToolsSchedule={handleGenerateORToolsSchedule}
            />
        </div>
        <div className={`lg:hidden fixed inset-0 bg-black/60 z-[var(--z-sidebar-mobile-backdrop)] transition-opacity ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsSidebarOpen(false)} aria-hidden="true"></div>
        <div className="hidden lg:block fixed inset-y-0 left-0 z-30">
          <SidebarContent 
                isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} isPomodoroCollapsed={isPomodoroCollapsed} setIsPomodoroCollapsed={setIsPomodoroCollapsed}
                pomodoroSettings={pomodoroSettings} setPomodoroSettings={setPomodoroSettings} handlePomodoroSessionComplete={handlePomodoroSessionComplete} currentPomodoroTask={currentPomodoroTask}
                studyPlan={studyPlan} selectedDate={selectedDate} setSelectedDate={setSelectedDate} isMobile={isMobile} navigatePeriod={navigatePeriod} highlightedDates={highlightedDates}
                todayInNewYork={todayInNewYork} handleRebalance={handleRebalance} isLoading={isLoading} handleToggleCramMode={handleToggleCramMode} handleUpdateDeadlines={handleUpdateDeadlines}
                isSettingsOpen={isSettingsOpen} setIsSettingsOpen={setIsSettingsOpen} handleUpdateTopicOrderAndRebalance={handleUpdateTopicOrderAndRebalance}
                handleUpdateCramTopicOrderAndRebalance={handleUpdateCramTopicOrderAndRebalance} handleToggleSpecialTopicsInterleaving={handleToggleSpecialTopicsInterleaving}
                handleAddOrUpdateException={handleAddOrUpdateException} handleUndo={handleUndo} previousStudyPlan={previousStudyPlan} showConfirmation={showConfirmation}
                loadSchedule={loadSchedule} handleMasterResetTasks={handleMasterResetTasks} handleUpdatePlanDates={handleUpdatePlanDates}
                handleGenerateORToolsSchedule={handleGenerateORToolsSchedule}
            />
        </div>

        <div className="flex-grow lg:pl-80 flex flex-col min-h-0">
            <header className="flex-shrink-0 text-[var(--text-primary)] px-3 md:px-4 pb-3 md:pb-4 flex justify-between items-center sticky top-0 z-[var(--z-header)] pt-[calc(0.75rem+env(safe-area-inset-top))] md:pt-[calc(1rem+env(safe-area-inset-top))] pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))] glass-chrome">
              <div className="flex items-center">
                  <button className="lg:hidden p-2 -ml-2 mr-2 text-[var(--text-primary)] hover:bg-[var(--background-tertiary-hover)] rounded-full" onClick={() => setIsSidebarOpen(p => !p)} aria-label="Toggle menu">
                      <i className="fas fa-bars fa-lg"></i>
                  </button>
                  <h1 className="text-base sm:text-lg md:text-xl font-bold flex items-center"><i className="fas fa-brain mr-2 text-[var(--accent-purple)]"></i> {APP_TITLE}</h1>
              </div>
              
              {pomodoroSettings.isActive && (
                  <div className="absolute left-1/2 -translate-x-1/2 flex items-center flex-col pointer-events-none">
                      <div className={`hidden sm:block text-xs uppercase tracking-wider ${pomodoroSettings.isStudySession ? 'text-[var(--accent-purple)]' : 'text-[var(--accent-green)]'}`}>{pomodoroSettings.isStudySession ? 'Study Time' : 'Break Time'}</div>
                      <div className="text-2xl font-mono font-bold text-[var(--text-primary)] hidden sm:block">
                          {formatTime(pomodoroSettings.timeLeft)}
                      </div>
                  </div>
              )}
              <div className="flex items-center space-x-2 md:space-x-4">
                  <div className="hidden sm:block">
                      <SaveStatusIndicator />
                  </div>
                  <Button onClick={() => setIsPrintModalOpen(true)} variant="secondary" size="sm" className="!px-2.5 !text-sm" aria-label="Print Reports">
                    <i className="fas fa-print"></i>
                  </Button>
                  <div className="p-2 rounded-lg flex flex-col md:flex-row md:items-center md:space-x-4 gap-y-1">
                    {studyPlan.firstPassEndDate && (
                      <div className="text-right">
                        <div className="text-xs text-slate-400">First Pass Ends</div>
                        <div className="text-sm font-medium text-[var(--accent-purple)] interactive-glow-border">
                          {parseDateString(studyPlan.firstPassEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                        </div>
                      </div>
                    )}
                    <CountdownTimer examDate={EXAM_DATE_START} />
                  </div>
              </div>
            </header>
            
            <main className="flex-grow overflow-y-auto isolated-scroll p-3 md:p-6 pr-[calc(0.75rem+env(safe-area-inset-right))] pl-[calc(0.75rem+env(safe-area-inset-left))]">
                <div className="max-w-4xl mx-auto w-full">
                  <div className="mb-6">
                        <div className="inline-flex bg-[var(--background-secondary)] p-1 rounded-lg space-x-1">
                            <button onClick={() => setActiveTab('schedule')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'schedule' ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                                <i className="fa-regular fa-calendar-days mr-2"></i> Schedule
                            </button>
                            <button onClick={() => setActiveTab('progress')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'progress' ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                                <i className="fa-solid fa-chart-pie mr-2"></i> Progress
                            </button>
                            <button onClick={() => setActiveTab('params')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'params' ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                                <i className="fa-solid fa-sliders mr-2"></i> Parameters
                            </button>

                        </div>
                    </div>

                    <div>
                        {isLoading && <div className="flex flex-col items-center justify-center p-10"> <i className="fas fa-spinner fa-spin fa-2x text-[var(--accent-purple)] mb-3"></i> <span className="text-[var(--text-primary)]">Loading...</span> </div>}
                        
                        <div className={activeTab !== 'schedule' ? 'hidden' : ''}>
                          {(() => {
                            const dayObj = studyPlan?.schedule?.find(d => d.date === selectedDate) ?? null;
                            if (!dayObj) {
                              return <div className="text-center text-[var(--text-secondary)] py-10">No schedule for this day.</div>;
                            }
                            return (
                              <DailyTaskList
                                day={dayObj}
                                onToggleTask={(taskId) => handleTaskToggle(dayObj.date, taskId)}
                                onOpenModify={(date) => openModal('isModifyDayTasksModalOpen', { date })}
                                onReorderTasks={handleReorderTasks}
                              />
                            );
                          })()
                        }
                        </div>
                        
                        <div className={activeTab !== 'progress' ? 'hidden' : ''}>
                            {studyPlan && <ProgressDisplay studyPlan={studyPlan} />}
                        </div>

                        <div className={activeTab !== 'params' ? 'hidden' : ''}>
                          <ParametersPanel
                            params={solverParams}
                            onChange={(p) => setSolverParams(prev => ({...prev, ...p}))}
                            onApply={() => {
                              // Send params to backend via environment-like header
                              // The service reads env; for runtime overrides, pass through query headers the server can optionally read.
                              // For now, just call OR-Tools with current dates; the service uses its env and can be extended later to accept overrides.
                              handleGenerateORToolsSchedule();
                            }}
                          />
                        </div>
                    </div>
                </div>
            </main>
        </div>
        
        {modalStates.isWelcomeModalOpen && <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => { closeModal('isWelcomeModalOpen'); setIsNewUser(false); }} />}
        {modalStates.isAddTaskModalOpen && selectedDaySchedule && <AddTaskModal isOpen={modalStates.isAddTaskModalOpen} onClose={() => closeModal('isAddTaskModalOpen')} onSave={handleSaveOptionalTask} availableDomains={ALL_DOMAINS} selectedDate={selectedDate}/>}
        {modalStates.isModifyDayTasksModalOpen && selectedDaySchedule && <ModifyDayTasksModal isOpen={modalStates.isModifyDayTasksModalOpen} onClose={() => closeModal('isModifyDayTasksModalOpen')} onSave={onDayTasksSave} tasksForDay={selectedDaySchedule.tasks} allResources={globalMasterResourcePool} selectedDate={selectedDate} showConfirmation={showConfirmation} onEditResource={openResourceEditor} onArchiveResource={handleRequestArchive} onRestoreResource={handleRestoreResource} onPermanentDeleteResource={handlePermanentDelete} openAddResourceModal={() => openResourceEditor(null)} isCramModeActive={studyPlan.isCramModeActive ?? false} />}
        {modalStates.isResourceEditorOpen && <ResourceEditorModal isOpen={modalStates.isResourceEditorOpen} onClose={closeResourceEditor} onSave={handleSaveResource} onRequestArchive={handleRequestArchive} initialResource={modalData.editingResource} availableDomains={ALL_DOMAINS} availableResourceTypes={Object.values(ResourceType)}/>}
        <ConfirmationModal {...modalStates.confirmationState} onConfirm={handleConfirm} onClose={modalStates.confirmationState.onClose} />
        {isPrintModalOpen && <PrintModal isOpen={isPrintModalOpen} onClose={() => setIsPrintModalOpen(false)} onGenerateReport={handleGenerateReport} studyPlan={studyPlan} currentDate={selectedDate} activeFilters={{ domain: contentUiFilters.domain, type: contentUiFilters.type, source: contentUiFilters.source }} initialTab={activeTab} />}

        {systemNotification && (
            <div 
              className={`toast toast-${systemNotification.type}`}
              role="alert"
            >
              <div className="flex items-start">
                  <i className={`fas ${systemNotification.type === 'error' ? 'fa-exclamation-circle' : systemNotification.type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'} mr-3 mt-1`}></i>
                  <div className="flex-grow">
                      <p className="font-bold capitalize">{systemNotification.type}</p>
                      <p className="text-sm">{systemNotification.message}</p>
                  </div>
                  <button onClick={() => setSystemNotification(null)} className="ml-4 -mt-1 -mr-1 p-1 rounded-full hover:bg-white/20"><i className="fas fa-times"></i></button>
              </div>
            </div>
        )}
      </div>
  );
  
  return (
    <>
      <div className="main-app-container">{MainAppContent}</div>
      <div className="print-only-container">
        {printableContent}
      </div>

      {optimizationProgress && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55">
          <div className="w-72 max-w-[85vw] rounded-2xl p-5 bg-gradient-to-br from-purple-700/40 to-indigo-700/40 border border-white/15 shadow-2xl">
            <div className="text-white font-semibold text-base mb-1">Optimizing with OR‑Tools</div>
            <div className="text-purple-200 text-xs mb-3">{optimizationProgress.current_task}</div>
            <div className="w-full h-2 rounded bg-white/15 overflow-hidden mb-2">
              <div className="h-full bg-white/85 transition-all" style={{ width: `${Math.round(optimizationProgress.progress * 100)}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-purple-200/85">
              <div>Step {optimizationProgress.step} / {optimizationProgress.total_steps}</div>
              <div>{Math.round(optimizationProgress.progress * 100)}%</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default App;
