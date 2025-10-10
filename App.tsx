import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DailySchedule, StudyPlan, ScheduledTask, PomodoroSettings, ViewMode, Domain, ResourceType, AddTaskModalProps, StudyResource, ResourceEditorModalProps, ExceptionDateRule, DeadlineSettings, RebalanceOptions, ShowConfirmationOptions, PrintOptions } from './types';
import { EXAM_DATE_START, APP_TITLE, ALL_DOMAINS, POMODORO_DEFAULT_STUDY_MINS, POMODORO_DEFAULT_REST_MINS } from './constants';
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
    navigatePeriod: (direction: 'next' | 'prev', viewMode: 'Monthly') => void;
    highlightedDates: string[];
    todayInNewYork: string;
    // FIX: Updated `handleRebalance` to accept optional RebalanceOptions.
    handleRebalance: (options?: RebalanceOptions) => void;
    isLoading: boolean;
    handleToggleCramMode: (isActive: boolean) => void;
    handleUpdateDeadlines: (newDeadlines: DeadlineSettings) => void;
    isSettingsOpen: boolean;
    setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleUpdateTopicOrderAndRebalance: (newOrder: Domain[]) => void;
    handleUpdateCramTopicOrderAndRebalance: (newOrder: Domain[]) => void;
    handleToggleSpecialTopicsInterleaving: (isActive: boolean) => void;
    handleAddOrUpdateException: (rule: ExceptionDateRule) => void;
    showConfirmation: (options: ShowConfirmationOptions) => void;
    generateAndSetStudyPlan: (options: { isInitial: boolean; rebalanceOptions?: RebalanceOptions | undefined; }) => Promise<void>;
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
    handleToggleSpecialTopicsInterleaving, handleAddOrUpdateException,
    showConfirmation, generateAndSetStudyPlan, handleMasterResetTasks, handleUpdatePlanDates
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
                            onNavigatePeriod={(dir) => navigatePeriod(dir, 'Monthly')} 
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
                            <Button onClick={() => showConfirmation({title: "Regenerate Schedule?", message: "This will regenerate the entire schedule from scratch based on the current settings. Are you sure?", confirmText: "Regenerate", confirmVariant: 'danger', onConfirm: () => generateAndSetStudyPlan({isInitial: true})})} variant="danger" className="w-full" disabled={isLoading}>Regenerate Schedule</Button>
                            <Button onClick={() => showConfirmation({title: "Reset All Progress?", message: "Are you sure you want to mark all tasks as 'pending'?", confirmText: "Reset Progress", confirmVariant: 'danger', onConfirm: handleMasterResetTasks})} variant="danger" className="w-full" disabled={isLoading}>Reset Task Progress</Button>
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
    studyPlan, setStudyPlan,
    masterResources, setGlobalMasterResourcePool,
    isLoading, loadingMessage, systemNotification, setSystemNotification,
    dbCheck, seedDatabase,
    generateAndSetStudyPlan,
    // FIX: Destructure missing functions from the hook.
    handleRebalance, handleUpdatePlanDates, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
    handleToggleCramMode,
    handleToggleSpecialTopicsInterleaving,
    handleTaskToggle, handleSaveModifiedDayTasks,
    saveStatus,
    handleAddOrUpdateException, handleMasterResetTasks,
    handleUpdateDeadlines,
    handleArchiveResource,
    handleRestoreResource,
    handlePermanentDeleteResource,
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
  
  // FIX: Implement the missing function to handle highlighting dates for a resource.
  const handleHighlightDatesForResource = useCallback((resourceId: string) => {
    if (!studyPlan) {
        setHighlightedDates([]);
        return;
    }
    const dates = studyPlan.schedule
        .filter(day => day.tasks.some(task => (task.originalResourceId || task.resourceId) === resourceId))
        .map(day => day.date);
    setHighlightedDates(dates);
  }, [studyPlan]);

  useEffect(() => {
    const { displacement, highlight } = generateGlassMaps({});
    const displacementEl = document.getElementById('displacementMapImage') as unknown as SVGImageElement | null;
    const highlightEl = document.getElementById('specularHighlightImage') as unknown as SVGImageElement | null;
    if (displacementEl) displacementEl.setAttribute('href', displacement);
    if (highlightEl) highlightEl.setAttribute('href', highlight);
  }, []);

  useEffect(() => {
    if (dbCheck.isSeeded && !localStorage.getItem('hasSeenWelcome')) {
      openModal('isWelcomeModalOpen');
      localStorage.setItem('hasSeenWelcome', 'true');
    }
  }, [dbCheck.isSeeded, openModal]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const navigateDate = useCallback((direction: 'next' | 'prev') => {
    const currentDateObj = parseDateString(selectedDate);
    currentDateObj.setUTCDate(currentDateObj.getUTCDate() + (direction === 'next' ? 1 : -1));
    const newDateStr = currentDateObj.toISOString().split('T')[0];
    if (!studyPlan) return;
    if (newDateStr >= studyPlan.startDate && newDateStr <= studyPlan.endDate) {
      setSelectedDate(newDateStr);
    }
  }, [selectedDate, studyPlan]);
  
  const navigatePeriod = useCallback((direction: 'next' | 'prev', viewMode: 'Monthly') => {
    const currentDateObj = parseDateString(selectedDate);
    const currentMonth = currentDateObj.getUTCMonth();
    currentDateObj.setUTCMonth(currentMonth + (direction === 'next' ? 1 : -1));
    setSelectedDate(currentDateObj.toISOString().split('T')[0]);
  }, [selectedDate]);

  const handlePomodoroTaskSelect = useCallback((taskId: string | null) => {
    setCurrentPomodoroTaskId(taskId);
    if (taskId) {
      setPomodoroSettings(prev => ({ ...prev, isActive: false, isStudySession: true, timeLeft: prev.studyDuration * 60 }));
      setIsPomodoroCollapsed(false);
    }
  }, [setPomodoroSettings, setIsPomodoroCollapsed]);
  
  const handlePomodoroSessionComplete = useCallback((sessionType: 'study' | 'rest', durationMinutes: number) => {
    // This logic now correctly resides inside App.tsx which has access to setStudyPlan
      if (sessionType === 'study' && currentPomodoroTaskId) {
          setStudyPlan(prevPlan => {
              if (!prevPlan) return null;
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
      }
  }, [currentPomodoroTaskId, setStudyPlan]);

  const onDayTasksSave = useCallback((updatedTasks: ScheduledTask[]) => {
    handleSaveModifiedDayTasks(updatedTasks, selectedDate);
    closeModal('isModifyDayTasksModalOpen');
    setTimeout(() => handleRebalance(), 100);
  }, [handleSaveModifiedDayTasks, selectedDate, closeModal, handleRebalance]);

  const scheduledResourceIds = useMemo(() => {
    if (!studyPlan) return new Set<string>();
    return new Set(studyPlan.schedule.flatMap(day => day.tasks.map(task => task.originalResourceId || task.resourceId)));
  }, [studyPlan?.schedule]);

  const handleGoToDateForResource = useCallback((resourceId: string) => {
    if (!studyPlan) return;
    const firstDay = studyPlan.schedule.find(day => day.tasks.some(task => (task.originalResourceId || task.resourceId) === resourceId));
    if (firstDay) {
        setSelectedDate(firstDay.date);
        setActiveTab('schedule');
        if (isMobile) setIsSidebarOpen(false);
    }
  }, [studyPlan, isMobile]);

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

  if (!dbCheck.checked || (isLoading && !studyPlan)) {
    return <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4"><div className="loader"></div><p className="text-lg mt-4">{loadingMessage}</p></div>;
  }
  
  if (!dbCheck.isSeeded) {
      return (
        <div className="w-screen h-screen flex items-center justify-center bg-[var(--background-primary)] p-4">
            <div className="text-center max-w-lg">
                <i className="fas fa-database fa-3x text-[var(--accent-purple)] mb-4"></i>
                <h1 className="text-3xl font-bold text-white mb-2">One-Time Setup</h1>
                <p className="text-[var(--text-secondary)] mb-6">
                    To get started, the app needs to populate your database with the master list of study resources.
                </p>
                <Button onClick={seedDatabase} variant="primary" size="lg" disabled={isLoading}>
                    {isLoading ? <><i className="fas fa-spinner fa-spin mr-2"></i> Seeding...</> : <><i className="fas fa-magic mr-2"></i> Setup & Seed Database</>}
                </Button>
                {loadingMessage.startsWith('Database seeding failed') && <p className="text-red-400 mt-4">{loadingMessage}</p>}
            </div>
        </div>
      );
  }
  
  if (!studyPlan) {
     return <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4"><i className="fas fa-exclamation-triangle fa-3x text-[var(--accent-red)] mb-4"></i><h1 className="text-2xl font-bold mb-2">Error Generating Plan</h1><p className="text-red-400 text-center mb-6">{loadingMessage || 'An unknown error occurred.'}</p><Button onClick={() => generateAndSetStudyPlan({isInitial: true})} variant="primary">Try Again</Button></div>;
  }

  const selectedDaySchedule = studyPlan.schedule.find(day => day.date === selectedDate);
  const currentPomodoroTask = currentPomodoroTaskId ? studyPlan.schedule.flatMap(d => d.tasks).find(t => t.id === currentPomodoroTaskId) : null;
  
  return (
    <>
      <div className="main-app-container">
        <div className="h-full w-full bg-transparent text-[var(--text-primary)] flex flex-col print:hidden">
            <div className={`lg:hidden fixed inset-y-0 left-0 z-[var(--z-sidebar-mobile)] transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <SidebarContent 
                    isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} isPomodoroCollapsed={isPomodoroCollapsed} setIsPomodoroCollapsed={setIsPomodoroCollapsed}
                    pomodoroSettings={pomodoroSettings} setPomodoroSettings={setPomodoroSettings} handlePomodoroSessionComplete={handlePomodoroSessionComplete} currentPomodoroTask={currentPomodoroTask}
                    studyPlan={studyPlan} selectedDate={selectedDate} setSelectedDate={setSelectedDate} isMobile={isMobile} navigatePeriod={navigatePeriod} highlightedDates={highlightedDates}
                    todayInNewYork={todayInNewYork} handleRebalance={handleRebalance} isLoading={isLoading} handleToggleCramMode={handleToggleCramMode} handleUpdateDeadlines={handleUpdateDeadlines}
                    isSettingsOpen={isSettingsOpen} setIsSettingsOpen={setIsSettingsOpen} handleUpdateTopicOrderAndRebalance={handleUpdateTopicOrderAndRebalance}
                    handleUpdateCramTopicOrderAndRebalance={handleUpdateCramTopicOrderAndRebalance} handleToggleSpecialTopicsInterleaving={handleToggleSpecialTopicsInterleaving}
                    handleAddOrUpdateException={handleAddOrUpdateException} showConfirmation={showConfirmation}
                    generateAndSetStudyPlan={generateAndSetStudyPlan} handleMasterResetTasks={handleMasterResetTasks} handleUpdatePlanDates={handleUpdatePlanDates}
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
                    handleAddOrUpdateException={handleAddOrUpdateException} showConfirmation={showConfirmation}
                    generateAndSetStudyPlan={generateAndSetStudyPlan} handleMasterResetTasks={handleMasterResetTasks} handleUpdatePlanDates={handleUpdatePlanDates}
                />
            </div>

            <div className="flex-grow lg:pl-80 flex flex-col min-h-0">
              <div className={`relative flex-1 overflow-y-auto min-h-0 ${isMobile && isSidebarOpen ? 'overflow-hidden' : ''}`}>
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
                
                <main>
                    <div className="pt-3 md:pt-6 pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))]">
                      <div className="mb-6 px-3 md:px-6">
                            <div className="inline-flex bg-[var(--background-secondary)] p-1 rounded-lg space-x-1">
                                <button onClick={() => setActiveTab('schedule')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'schedule' ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                                    <i className="fa-regular fa-calendar-days mr-2"></i> Schedule
                                </button>
                                <button onClick={() => setActiveTab('progress')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'progress' ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                                    <i className="fa-solid fa-chart-pie mr-2"></i> Progress
                                </button>
                                <button onClick={() => setActiveTab('content')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'content' ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                                    <i className="fa-solid fa-book-bookmark mr-2"></i> Content
                                </button>
                            </div>
                        </div>

                        <div className="px-3 md:px-6">
                            {isLoading && <div className="flex flex-col items-center justify-center p-10"> <i className="fas fa-spinner fa-spin fa-2x text-[var(--accent-purple)] mb-3"></i> <span className="text-[var(--text-primary)]">{loadingMessage}</span> </div>}
                            
                            {!isLoading && activeTab === 'schedule' && (
                              <div>
                                  {selectedDaySchedule ?
                                    <DailyTaskList 
                                        dailySchedule={selectedDaySchedule} 
                                        onTaskToggle={(taskId) => handleTaskToggle(taskId, selectedDate)} 
                                        onOpenAddTaskModal={() => openModal('isAddTaskModalOpen')} 
                                        onOpenModifyDayModal={() => openModal('isModifyDayTasksModalOpen')}
                                        currentPomodoroTaskId={currentPomodoroTaskId} 
                                        onPomodoroTaskSelect={handlePomodoroTaskSelect} 
                                        onNavigateDay={navigateDate} 
                                        isPomodoroActive={pomodoroSettings.isActive}
                                        onToggleRestDay={(isRest) => handleAddOrUpdateException({date: selectedDate, dayType: 'specific-rest', isRestDayOverride: !isRest})}
                                        onUpdateTimeForDay={(mins) => handleAddOrUpdateException({date: selectedDate, dayType: 'exception', targetMinutes: mins, isRestDayOverride: mins === 0})}
                                        isLoading={isLoading}
                                    /> : <div className="text-center text-[var(--text-secondary)] py-10">No schedule for this day.</div>
                                  }
                              </div>
                            )}
                            
                            {!isLoading && activeTab === 'progress' && <ProgressDisplay studyPlan={studyPlan} />}

                            {!isLoading && activeTab === 'content' && (
                                <MasterResourcePoolViewer 
                                    resources={masterResources}
                                    onOpenAddResourceModal={() => openResourceEditor(null)}
                                    onEditResource={openResourceEditor}
                                    onArchiveResource={(id) => showConfirmation({ title: 'Archive?', message: 'This will remove the resource from future scheduling.', confirmText: 'Archive', onConfirm: () => handleArchiveResource(id)})}
                                    onRestoreResource={handleRestoreResource}
                                    onPermanentDeleteResource={(id) => showConfirmation({ title: 'Delete?', message: 'This cannot be undone.', confirmText: 'Delete', confirmVariant: 'danger', onConfirm: () => handlePermanentDeleteResource(id)})}
                                    scheduledResourceIds={scheduledResourceIds}
                                    onGoToDate={handleGoToDateForResource}
                                    onHighlightDates={handleHighlightDatesForResource}
                                    onClearHighlights={() => setHighlightedDates([])}
                                />
                            )}
                        </div>
                    </div>
                </main>
              </div>
            </div>
            {modalStates.isWelcomeModalOpen && <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => closeModal('isWelcomeModalOpen')} />}
          </div>
      </div>

       {/* Modals rendered outside main container for stacking context */}
        {modalStates.isAddTaskModalOpen && <AddTaskModal isOpen={modalStates.isAddTaskModalOpen} onClose={() => closeModal('isAddTaskModalOpen')} onSave={(taskData) => {}} availableDomains={ALL_DOMAINS} selectedDate={selectedDate}/>}
        {modalStates.isModifyDayTasksModalOpen && selectedDaySchedule && <ModifyDayTasksModal isOpen={modalStates.isModifyDayTasksModalOpen} onClose={() => closeModal('isModifyDayTasksModalOpen')} onSave={onDayTasksSave} tasksForDay={selectedDaySchedule.tasks} allResources={masterResources} selectedDate={selectedDate} showConfirmation={showConfirmation} onEditResource={openResourceEditor} onArchiveResource={(id) => {}} onRestoreResource={(id) => {}} onPermanentDeleteResource={(id) => {}} openAddResourceModal={() => openResourceEditor(null)} isCramModeActive={studyPlan.isCramModeActive ?? false} />}
        {modalStates.isResourceEditorOpen && <ResourceEditorModal isOpen={modalStates.isResourceEditorOpen} onClose={closeResourceEditor} onSave={(res) => {}} onRequestArchive={(id) => {}} initialResource={modalData.editingResource} availableDomains={ALL_DOMAINS} availableResourceTypes={Object.values(ResourceType)}/>}
        <ConfirmationModal {...modalStates.confirmationState} onConfirm={handleConfirm} onClose={modalStates.confirmationState.onClose} />
        {isPrintModalOpen && <PrintModal isOpen={isPrintModalOpen} onClose={() => setIsPrintModalOpen(false)} onGenerateReport={(tab, opts) => {}} studyPlan={studyPlan} currentDate={selectedDate} activeFilters={{domain: 'all', type: 'all', source: 'all'}} />}
    </>
  );
};

export default App;
