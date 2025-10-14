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
import ContentReport from './components/ContentReport';
import { formatDuration, getTodayInNewYork, parseDateString } from './utils/timeFormatter';
import { addResourceToGlobalPool } from './services/studyResources';

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
}

// Memoized Sidebar to prevent re-renders from the Pomodoro timer
const SidebarContent = React.memo(({ 
    setIsSidebarOpen, isPomodoroCollapsed, setIsPomodoroCollapsed, 
    pomodoroSettings, setPomodoroSettings, handlePomodoroSessionComplete, currentPomodoroTask,
    studyPlan, selectedDate, setSelectedDate, isMobile, navigatePeriod, highlightedDates, 
    todayInNewYork, handleRebalance, isLoading, handleToggleCramMode, handleUpdateDeadlines,
    isSettingsOpen, setIsSettingsOpen, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
    handleToggleSpecialTopicsInterleaving, handleAddOrUpdateException, handleUndo, previousStudyPlan,
    showConfirmation, loadSchedule, handleMasterResetTasks, handleUpdatePlanDates
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
                            onNavigatePeriod={(dir) => navigatePeriod(dir)} 
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
                                    onToggleSpecialTopicsInterleaving={handleToggleSpecialTopicsInterleaving}
                                />
                            </div>
                        )}
                    </div>

                    <AddExceptionDay onAddException={handleAddOrUpdateException} isLoading={isLoading} />
                    
                    <div>
                        <h2 className="text-lg font-semibold mb-3 border-b border-[var(--separator-primary)] pb-2 text-[var(--text-primary)]">Actions</h2>
                        <div className="space-y-2">
                            <Button onClick={handleUndo} variant="secondary" className="w-full" disabled={!previousStudyPlan || isLoading}><i className="fas fa-undo mr-2"></i> Undo Last Plan Change</Button>
                            <Button onClick={() => showConfirmation({
                                title: "Regenerate Full Schedule?",
                                message: "This will erase your entire schedule and all progress, creating a new plan from scratch starting from today. This action cannot be undone.",
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
    // FIX: Destructure setIsNewUser to manage the welcome modal state.
    setIsNewUser,
    loadSchedule, handleRebalance, handleUpdatePlanDates, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
    handleToggleCramMode,
    handleToggleSpecialTopicsInterleaving,
    handleTaskToggle, handleSaveModifiedDayTasks, handleUndo,
    updatePreviousStudyPlan,
    saveStatus,
    handleToggleRestDay,
    handleAddOrUpdateException,
    // FIX: Destructure handleUpdateDeadlines to pass to children.
    handleUpdateDeadlines,
  } = useStudyPlanManager(showConfirmation);

  const todayInNewYork = useMemo(() => getTodayInNewYork(), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayInNewYork);
  const [pomodoroSettings, setPomodoroSettings] = usePersistentState<PomodoroSettings>('radiology_pomodoro_settings', {
    studyDuration: POMODORO_DEFAULT_STUDY_MINS,
    restDuration: POMODORO_DEFAULT_REST_MINS,
    isActive: false, isStudySession: true, timeLeft: POMODORO_DEFAULT_STUDY_MINS * 60,
  });
  const [currentPomodoroTaskId, setCurrentPomodoroTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'schedule' | 'progress' | 'content'>('schedule');
  const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
  const [isPomodoroCollapsed, setIsPomodoroCollapsed] = usePersistentState('radiology_pomodoro_collapsed', true);
  
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printableContent, setPrintableContent] = useState<React.ReactNode | null>(null);
  
  const [contentFilters, setContentFilters] = useState({
    domain: 'all' as Domain | 'all',
    type: 'all' as ResourceType | 'all',
    source: 'all' as string | 'all',
  });
  
  const [printModalInitialTab, setPrintModalInitialTab] = useState<'schedule' | 'progress' | 'content'>('schedule');

  useEffect(() => {
    const checkSize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);
  
  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (printableContent) {
      setTimeout(() => window.print(), 100);
    }
  }, [printableContent]);

  useEffect(() => {
    const { displacement, highlight } = generateGlassMaps({});
    const dispImg = document.getElementById('displacementMapImage') as any;
    const specImg = document.getElementById('specularHighlightImage') as any;
    if (dispImg) dispImg.setAttribute('href', displacement);
    if (specImg) specImg.setAttribute('href', highlight);
  }, []);

  // FIX: Add useEffect to open the welcome modal when a new user is detected.
  useEffect(() => {
    if (isNewUser) {
      openModal('isWelcomeModalOpen');
    }
  }, [isNewUser, openModal]);

  const handleTaskToggleAndProgressUpdate = useCallback((taskId: string) => {
    if (!studyPlan) return;
    handleTaskToggle(taskId, selectedDate);
  }, [studyPlan, selectedDate, handleTaskToggle]);

  const handlePomodoroSessionComplete = useCallback((sessionType: 'study' | 'rest', durationMinutes: number) => {
    new Notification(sessionType === 'study' ? 'Study session complete!' : 'Break is over!', {
      body: sessionType === 'study' ? `Time to take a ${formatDuration(pomodoroSettings.restDuration)} break.` : "Time to get back to it!",
    });
    if (sessionType === 'study' && currentPomodoroTaskId && studyPlan) {
      setStudyPlan(prevPlan => {
        if (!prevPlan) return null;
        const newSchedule = prevPlan.schedule.map(day => ({
          ...day,
          tasks: day.tasks.map(task => {
            if (task.id === currentPomodoroTaskId) {
              return {
                ...task,
                actualStudyTimeMinutes: (task.actualStudyTimeMinutes || 0) + durationMinutes,
              };
            }
            return task;
          }),
        }));
        return { ...prevPlan, schedule: newSchedule };
      });
    }
  }, [currentPomodoroTaskId, studyPlan, pomodoroSettings.restDuration, setStudyPlan]);

  const navigateDay = (direction: 'next' | 'prev') => {
    if (!studyPlan) return;
    const currentDateIndex = studyPlan.schedule.findIndex(d => d.date === selectedDate);
    if (currentDateIndex === -1) return;

    const newIndex = direction === 'next' ? currentDateIndex + 1 : currentDateIndex - 1;

    if (newIndex >= 0 && newIndex < studyPlan.schedule.length) {
      setSelectedDate(studyPlan.schedule[newIndex].date);
    }
  };

  const navigatePeriod = (direction: 'next' | 'prev') => {
    const currentDate = parseDateString(selectedDate);
    const newDate = new Date(currentDate);
    newDate.setUTCMonth(currentDate.getUTCMonth() + (direction === 'next' ? 1 : -1));
    
    if (studyPlan) {
        const startDate = parseDateString(studyPlan.startDate);
        const endDate = parseDateString(studyPlan.endDate);
        if (newDate < startDate) newDate.setUTCFullYear(startDate.getUTCFullYear(), startDate.getUTCMonth());
        if (newDate > endDate) newDate.setUTCFullYear(endDate.getUTCFullYear(), endDate.getUTCMonth());
    }

    setSelectedDate(newDate.toISOString().split('T')[0]);
  };
  
  const handleSaveTask = (taskData: Parameters<AddTaskModalProps['onSave']>[0]) => {
    const newResource = addResourceToGlobalPool({
      ...taskData,
      isPrimaryMaterial: false,
      isSplittable: true,
      isOptional: true,
      sequenceOrder: 99999, // Ensure it's at the end
    });
    setGlobalMasterResourcePool(prev => [...prev, newResource]);

    const newTask: ScheduledTask = {
      id: `manual_${newResource.id}`,
      resourceId: newResource.id,
      originalResourceId: newResource.id,
      title: taskData.title,
      type: taskData.type,
      originalTopic: taskData.domain,
      durationMinutes: taskData.durationMinutes,
      status: 'pending',
      order: (dailySchedule?.tasks.length || 0),
      isOptional: true,
      isPrimaryMaterial: false,
      pages: taskData.pages,
      questionCount: taskData.questionCount,
      caseCount: taskData.caseCount,
      chapterNumber: taskData.chapterNumber,
    };
    
    if (studyPlan) {
      updatePreviousStudyPlan(studyPlan);
      const newSchedule = studyPlan.schedule.map(d => {
        if (d.date === selectedDate) {
          return { ...d, tasks: [...d.tasks, newTask], isManuallyModified: true };
        }
        return d;
      });
      handleRebalance({type: 'standard'}, { ...studyPlan, schedule: newSchedule });
    }
    closeModal('isAddTaskModalOpen');
  };

  const handleMasterResetTasks = () => {
    if (!studyPlan) return;
    updatePreviousStudyPlan(studyPlan);
    const newSchedule = studyPlan.schedule.map(day => ({
        ...day,
        tasks: day.tasks.map(task => ({
            ...task,
            // FIX: Explicitly cast status to satisfy the strict 'pending' | 'completed' type.
            status: 'pending' as 'pending' | 'completed',
            actualStudyTimeMinutes: 0
        }))
    }));
    const newProgress = { ...studyPlan.progressPerDomain };
    Object.keys(newProgress).forEach(domain => {
        if (newProgress[domain as Domain]) {
            newProgress[domain as Domain]!.completedMinutes = 0;
        }
    });
    setStudyPlan({ ...studyPlan, schedule: newSchedule, progressPerDomain: newProgress });
  };
  
  const handleSaveResource = (resourceData: Omit<StudyResource, 'id'> & { id?: string }) => {
    if (resourceData.id) { // Update existing
      setGlobalMasterResourcePool(prev => prev.map(r => r.id === resourceData.id ? { ...r, ...resourceData } as StudyResource : r));
    } else { // Add new
      const newResource = addResourceToGlobalPool(resourceData as Omit<StudyResource, 'id' | 'isArchived'>);
      setGlobalMasterResourcePool(prev => [...prev, newResource]);
    }
    if(studyPlan) handleRebalance({type: 'standard'});
    closeResourceEditor();
  };
  
  const handleArchiveResource = (resourceId: string) => {
     showConfirmation({
        title: "Archive Resource?",
        message: "Archiving will remove this item from the pool for future schedule generations. It will remain in past days if already scheduled. You can restore it later.",
        confirmText: "Archive",
        confirmVariant: 'danger',
        onConfirm: () => {
          setGlobalMasterResourcePool(prev => prev.map(r => r.id === resourceId ? { ...r, isArchived: true } : r));
          if(studyPlan) handleRebalance({type: 'standard'});
        }
    });
  };
  
  const handleRestoreResource = (resourceId: string) => {
    setGlobalMasterResourcePool(prev => prev.map(r => r.id === resourceId ? { ...r, isArchived: false } : r));
    if(studyPlan) handleRebalance({type: 'standard'});
  };
  
  const handlePermanentDeleteResource = (resourceId: string) => {
     showConfirmation({
        title: "Permanently Delete?",
        message: "This action is irreversible and will remove the resource completely.",
        confirmText: "Delete Forever",
        confirmVariant: 'danger',
        onConfirm: () => {
          setGlobalMasterResourcePool(prev => prev.filter(r => r.id !== resourceId));
          if(studyPlan) handleRebalance({type: 'standard'});
        }
    });
  };

  const handleGenerateReport = (activeTab: 'schedule' | 'progress' | 'content', options: PrintOptions) => {
    setIsPrintModalOpen(false);
    if (!studyPlan) return;
  
    if (activeTab === 'schedule') {
        let scheduleSubset = studyPlan.schedule;
        if (options.schedule.reportType !== 'full') {
            const start = options.schedule.startDate!;
            const end = options.schedule.endDate!;
            scheduleSubset = studyPlan.schedule.filter(d => d.date >= start && d.date <= end);
        }
        setPrintableContent(<ScheduleReport studyPlan={studyPlan} schedule={scheduleSubset} />);
    } else if (activeTab === 'progress') {
        setPrintableContent(<ProgressReport studyPlan={studyPlan} />);
    } else if (activeTab === 'content') {
        const resourcesWithStatus = globalMasterResourcePool.map(r => ({ ...r, isScheduled: scheduledResourceIds.has(r.id), source: r.bookSource || r.videoSource || 'Custom' }));
        let filtered = resourcesWithStatus;
        if (options.content.filter !== 'all') {
            if (options.content.filter === 'archived') filtered = filtered.filter(r => r.isArchived);
            else if (options.content.filter === 'scheduled') filtered = filtered.filter(r => r.isScheduled && !r.isArchived);
            else if (options.content.filter === 'unscheduled') filtered = filtered.filter(r => !r.isScheduled && !r.isArchived);
        }
        // ... sorting logic ...
        setPrintableContent(<ContentReport resources={filtered} title={`Filtered by: ${options.content.filter}`} />);
    }
  };


  const dailySchedule = useMemo(() => {
    return studyPlan?.schedule.find(d => d.date === selectedDate);
  }, [studyPlan, selectedDate]);

  const currentPomodoroTask = useMemo(() => {
    if (!currentPomodoroTaskId || !studyPlan) return null;
    for (const day of studyPlan.schedule) {
      const task = day.tasks.find(t => t.id === currentPomodoroTaskId);
      if (task) return task;
    }
    return null;
  }, [currentPomodoroTaskId, studyPlan]);
  
  const scheduledResourceIds = useMemo(() => {
    if (!studyPlan) return new Set<string>();
    const ids = new Set<string>();
    studyPlan.schedule.forEach(day => {
        day.tasks.forEach(task => {
            if (task.originalResourceId) ids.add(task.originalResourceId);
        });
    });
    return ids;
  }, [studyPlan]);
  
  const findResourceDate = (resourceId: string): string | null => {
    if (!studyPlan) return null;
    for(const day of studyPlan.schedule) {
        if (day.tasks.some(t => t.originalResourceId === resourceId)) {
            return day.date;
        }
    }
    return null;
  }

  const findResourceDates = (resourceId: string): string[] => {
    if (!studyPlan) return [];
    const dates: string[] = [];
    studyPlan.schedule.forEach(day => {
        if (day.tasks.some(t => t.originalResourceId === resourceId)) {
            dates.push(day.date);
        }
    });
    return dates;
  }

  if (isLoading || !studyPlan || !dailySchedule) {
    return <div className="flex justify-center items-center h-screen bg-black"><div className="text-white">Loading Study Plan...</div></div>;
  }
  
  const availableResourceTypes = Object.values(ResourceType);

  return (
    <div className="main-app-container flex h-full">
      <div className={`fixed inset-0 bg-black/50 z-[var(--z-sidebar-mobile-backdrop)] transition-opacity lg:hidden ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsSidebarOpen(false)}></div>
      <div className={`fixed top-0 left-0 h-full transition-transform duration-300 ease-in-out z-[var(--z-sidebar-mobile)] lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <SidebarContent 
              {...{
                  isSidebarOpen, setIsSidebarOpen, isPomodoroCollapsed, setIsPomodoroCollapsed, pomodoroSettings, 
                  setPomodoroSettings, handlePomodoroSessionComplete, currentPomodoroTask, studyPlan, selectedDate, 
                  setSelectedDate, isMobile, navigatePeriod, highlightedDates, todayInNewYork, handleRebalance, 
                  isLoading, handleToggleCramMode, handleUpdateDeadlines, isSettingsOpen, setIsSettingsOpen, 
                  handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance, handleToggleSpecialTopicsInterleaving,
                  handleAddOrUpdateException, handleUndo, previousStudyPlan, showConfirmation, loadSchedule,
                  handleMasterResetTasks, handleUpdatePlanDates
              }} 
          />
      </div>

      <div className="flex-1 flex flex-col h-dvh min-w-0">
        <header className="flex-shrink-0 flex items-center justify-between p-2.5 glass-chrome border-b border-[var(--separator-primary)] pl-[calc(0.5rem+env(safe-area-inset-left))] pr-[calc(0.5rem+env(safe-area-inset-right))] pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <Button onClick={() => setIsSidebarOpen(true)} variant="ghost" size="sm" className="lg:hidden !px-2.5">
            <i className="fas fa-bars"></i>
          </Button>
          <div className="hidden lg:block">
            <h1 className="text-lg font-semibold text-white">{APP_TITLE}</h1>
          </div>
          <div className="flex items-center space-x-2">
              <span className={`text-xs font-semibold transition-opacity ${saveStatus === 'saving' ? 'opacity-100' : 'opacity-0'}`}><i className="fas fa-sync fa-spin mr-1"></i>Saving...</span>
              <span className={`text-xs font-semibold text-[var(--accent-green)] transition-opacity ${saveStatus === 'saved' ? 'opacity-100' : 'opacity-0'}`}><i className="fas fa-check-circle mr-1"></i>Saved</span>
              <span className={`text-xs font-semibold text-[var(--accent-red)] transition-opacity ${saveStatus === 'error' ? 'opacity-100' : 'opacity-0'}`}><i className="fas fa-exclamation-triangle mr-1"></i>Error</span>
          </div>
          <CountdownTimer examDate={EXAM_DATE_START} />
        </header>

        <main className="flex-grow overflow-y-auto isolated-scroll">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-0 xl:gap-6 max-w-7xl mx-auto w-full">
                <div className="xl:col-span-1 p-3 md:p-4 pr-[calc(0.75rem+env(safe-area-inset-right))] pl-[calc(0.75rem+env(safe-area-inset-left))]">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-1">
                            <Button onClick={() => setActiveTab('schedule')} variant={activeTab === 'schedule' ? 'primary' : 'secondary'} size="sm">Schedule</Button>
                            <Button onClick={() => setActiveTab('progress')} variant={activeTab === 'progress' ? 'primary' : 'secondary'} size="sm">Progress</Button>
                            <Button onClick={() => { setActiveTab('content'); setPrintModalInitialTab('content');}} variant={activeTab === 'content' ? 'primary' : 'secondary'} size="sm">Content</Button>
                        </div>
                        <Button onClick={() => setIsPrintModalOpen(true)} variant="ghost" size="sm" className="!px-2.5"><i className="fas fa-print mr-2"></i> Print</Button>
                    </div>
                     <div className={activeTab !== 'schedule' ? 'hidden' : ''}>
                        <DailyTaskList 
                            dailySchedule={dailySchedule} 
                            onTaskToggle={handleTaskToggleAndProgressUpdate}
                            onOpenAddTaskModal={() => openModal('isAddTaskModalOpen')}
                            onOpenModifyDayModal={() => openModal('isModifyDayTasksModalOpen')}
                            currentPomodoroTaskId={currentPomodoroTaskId}
                            onPomodoroTaskSelect={setCurrentPomodoroTaskId}
                            onNavigateDay={navigateDay}
                            isPomodoroActive={pomodoroSettings.isActive}
                            onToggleRestDay={(isRest) => handleToggleRestDay(selectedDate, isRest)}
                            // FIX: Correctly call the handler from the hook instead of trying to manipulate state directly.
                            onUpdateTimeForDay={(newTime) => {
                                handleAddOrUpdateException({
                                    date: selectedDate,
                                    dayType: 'exception',
                                    isRestDayOverride: newTime === 0,
                                    targetMinutes: newTime,
                                });
                            }}
                            isLoading={isLoading}
                        />
                    </div>
                    <div className={activeTab !== 'progress' ? 'hidden' : ''}>
                        <ProgressDisplay studyPlan={studyPlan} />
                    </div>
                     <div className={activeTab !== 'content' ? 'hidden' : ''}>
                        <MasterResourcePoolViewer 
                            resources={globalMasterResourcePool}
                            onOpenAddResourceModal={() => openResourceEditor(null)}
                            onEditResource={openResourceEditor}
                            onArchiveResource={handleArchiveResource}
                            onRestoreResource={handleRestoreResource}
                            onPermanentDeleteResource={handlePermanentDeleteResource}
                            scheduledResourceIds={scheduledResourceIds}
                            onGoToDate={(resId) => { const date = findResourceDate(resId); if (date) { setActiveTab('schedule'); setSelectedDate(date); } }}
                            onHighlightDates={(resId) => { setHighlightedDates(findResourceDates(resId)); }}
                            onClearHighlights={() => setHighlightedDates([])}
                        />
                    </div>
                </div>
            </div>
        </main>
      </div>
      
      {/* --- Modals --- */}
      {/* FIX: Correctly call setIsNewUser(false) on modal close. */}
      {isNewUser && <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => {closeModal('isWelcomeModalOpen'); setIsNewUser(false);}}/>}
      <AddTaskModal isOpen={modalStates.isAddTaskModalOpen} onClose={() => closeModal('isAddTaskModalOpen')} onSave={handleSaveTask} availableDomains={ALL_DOMAINS} selectedDate={selectedDate}/>
      <ModifyDayTasksModal 
        isOpen={modalStates.isModifyDayTasksModalOpen} 
        onClose={() => closeModal('isModifyDayTasksModalOpen')} 
        onSave={(tasks) => {handleSaveModifiedDayTasks(tasks, selectedDate); closeModal('isModifyDayTasksModalOpen');}}
        tasksForDay={dailySchedule.tasks}
        allResources={globalMasterResourcePool}
        selectedDate={selectedDate}
        showConfirmation={showConfirmation}
        openAddResourceModal={() => openResourceEditor(null)}
        onEditResource={openResourceEditor}
        onArchiveResource={handleArchiveResource}
        onRestoreResource={handleRestoreResource}
        onPermanentDeleteResource={handlePermanentDeleteResource}
        isCramModeActive={studyPlan.isCramModeActive}
      />
      <ResourceEditorModal 
          isOpen={modalStates.isResourceEditorOpen} 
          onClose={closeResourceEditor}
          onSave={handleSaveResource}
          onRequestArchive={handleArchiveResource}
          initialResource={modalData.editingResource}
          availableDomains={ALL_DOMAINS}
          availableResourceTypes={availableResourceTypes}
      />
      <ConfirmationModal {...modalStates.confirmationState} />
      <PrintModal 
          isOpen={isPrintModalOpen} 
          onClose={() => setIsPrintModalOpen(false)} 
          onGenerateReport={handleGenerateReport} 
          studyPlan={studyPlan} 
          currentDate={selectedDate}
          activeFilters={contentFilters}
          initialTab={printModalInitialTab}
      />
      
      {/* System Notification */}
      {systemNotification && (
          <div className={`fixed bottom-4 right-4 z-[var(--z-notification)] p-4 rounded-lg shadow-lg text-white max-w-sm animate-fade-in-out ${systemNotification.type === 'error' ? 'bg-red-800/80' : systemNotification.type === 'warning' ? 'bg-yellow-800/80' : 'bg-blue-800/80'}`}>
              <div className="flex items-start">
                  <i className={`fas ${systemNotification.type === 'error' ? 'fa-exclamation-circle' : systemNotification.type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'} mr-3 mt-1`}></i>
                  <div>
                      <p className="font-bold capitalize">{systemNotification.type}</p>
                      <p className="text-sm">{systemNotification.message}</p>
                  </div>
                  <button onClick={() => setSystemNotification(null)} className="ml-4 -mt-1 -mr-1 p-1 rounded-full hover:bg-white/20"><i className="fas fa-times"></i></button>
              </div>
          </div>
      )}

      {/* Print Container */}
      <div className="print-only-container">
        {printableContent}
      </div>
    </div>
  );
};

export default App;
