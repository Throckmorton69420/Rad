import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DailySchedule, StudyPlan, ScheduledTask, PomodoroSettings, ViewMode,
Domain, ResourceType, AddTaskModalProps, StudyResource, ResourceEditorModalProps,
ExceptionDateRule, DeadlineSettings, RebalanceOptions, ShowConfirmationOptions,
PrintOptions } from './types';
import { EXAM_DATE_START, APP_TITLE, ALL_DOMAINS, POMODORO_DEFAULT_STUDY_MINS,
POMODORO_DEFAULT_REST_MINS } from './constants';
import { addResourceToGlobalPool } from './services/studyResources';
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
  handlePomodoroSessionComplete: (sessionType: 'study' | 'rest',
durationMinutes: number) => void;
  currentPomodoroTask: ScheduledTask | null;
  studyPlan: StudyPlan;
  selectedDate: string;
  setSelectedDate: React.Dispatch<React.SetStateAction<string>>;
  isMobile: boolean;
  navigatePeriod: (direction: 'next' | 'prev', viewMode: 'Weekly' | 'Monthly')
=> void;
  highlightedDates: string[];
  todayInNewYork: string;
  handleRebalance: (options: RebalanceOptions) => void;
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
  pomodoroSettings, setPomodoroSettings, handlePomodoroSessionComplete,
  currentPomodoroTask,
  studyPlan, selectedDate, setSelectedDate, isMobile, navigatePeriod,
  highlightedDates,
  todayInNewYork, handleRebalance, isLoading, handleToggleCramMode,
  handleUpdateDeadlines,
  isSettingsOpen, setIsSettingsOpen, handleUpdateTopicOrderAndRebalance,
  handleUpdateCramTopicOrderAndRebalance,
  handleToggleSpecialTopicsInterleaving, handleAddOrUpdateException, handleUndo,
  previousStudyPlan,
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
              onNavigatePeriod={(dir) => navigatePeriod(dir, 'Monthly')}
              highlightedDates={highlightedDates}
              today={todayInNewYork}
            />
          </div>
          <AdvancedControls
            onRebalance={handleRebalance}
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
            <button onClick={() => setIsSettingsOpen(!isSettingsOpen)} className="w-full text-lg font-semibold text-left text-[var(--text-primary)] flex justify-between items-center py-2">
              <span>Settings</span>
              <i className={`fas fa-chevron-down transition-transform ${isSettingsOpen ? '' : 'rotate-180'}`}></i>
            </button>
            {isSettingsOpen && (
                <div className="animate-fade-in space-y-4">
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
                <AddExceptionDay onAddException={handleAddOrUpdateException} isLoading={isLoading} />
                <div className="p-4 rounded-lg space-y-3 glass-panel">
                    <h3 className="text-md font-semibold text-[var(--text-primary)]">Data & Danger Zone</h3>
                    <div className="space-y-2">
                        <Button onClick={handleUndo} variant="secondary" size="sm" className="w-full" disabled={!previousStudyPlan || isLoading}>
                        <i className="fas fa-undo mr-2"></i> Undo Last Action
                        </Button>
                         <Button onClick={() => showConfirmation({ title: 'Regenerate Schedule?', message: 'This will create a brand new schedule from scratch based on your resources and settings. All progress will be lost. This is irreversible.', confirmText: 'Regenerate', confirmVariant: 'danger', onConfirm: () => loadSchedule(true)})} variant="danger" size="sm" className="w-full" disabled={isLoading}>
                            <i className="fas fa-power-off mr-2"></i> Full Regeneration
                        </Button>
                        <Button onClick={() => showConfirmation({ title: 'Reset Progress?', message: 'This will mark all tasks as "pending" but will not change the schedule itself. Are you sure?', confirmText: 'Reset Progress', confirmVariant: 'danger', onConfirm: handleMasterResetTasks})} variant="danger" size="sm" className="w-full" disabled={isLoading}>
                        <i className="fas fa-history mr-2"></i> Reset All Task Progress
                        </Button>
                    </div>
                </div>
                </div>
            )}
            </div>
        </div>
      </div>
    </div>
  </aside>
));

const App: React.FC = () => {
  const [selectedDate, setSelectedDate] = usePersistentState<string>('radiology_selected_date', getTodayInNewYork());
  const [pomodoroSettings, setPomodoroSettings] = usePersistentState<PomodoroSettings>('radiology_pomodoro_settings', {
    studyDuration: POMODORO_DEFAULT_STUDY_MINS, restDuration: POMODORO_DEFAULT_REST_MINS,
    isActive: false, isStudySession: true, timeLeft: POMODORO_DEFAULT_STUDY_MINS * 60,
  });
  const [activeTab, setActiveTab] = usePersistentState<'schedule' | 'progress' | 'resources'>('active_main_tab', 'schedule');

  const { modalStates, modalData, openModal, closeModal, openResourceEditor, closeResourceEditor, showConfirmation } = useModalManager();

  const {
    studyPlan, setStudyPlan, previousStudyPlan,
    globalMasterResourcePool, setGlobalMasterResourcePool,
    isLoading, systemNotification, setSystemNotification, isNewUser,
    loadSchedule, handleRebalance, handleUpdatePlanDates, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
    handleToggleCramMode,
    handleToggleSpecialTopicsInterleaving,
    handleTaskToggle, handleSaveModifiedDayTasks, handleUndo,
    updatePreviousStudyPlan,
    handleToggleRestDay, handleAddOrUpdateException,
    handleUpdateDeadlines,
    handleMasterResetTasks,
  } = useStudyPlanManager(showConfirmation);

  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 1024);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [isPomodoroCollapsed, setIsPomodoroCollapsed] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentPomodoroTaskId, setCurrentPomodoroTaskId] = usePersistentState<string | null>('radiology_pomodoro_task_id', null);
  const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
  const todayInNewYork = useMemo(() => getTodayInNewYork(), []);
  
  const [isPrinting, setIsPrinting] = useState(false);
  const [printContent, setPrintContent] = useState<React.ReactNode>(null);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(true);
      else setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (isNewUser) {
        openModal('isWelcomeModalOpen');
    }
  }, [isNewUser, openModal]);
  
  useEffect(() => {
    if (systemNotification) {
      const timer = setTimeout(() => setSystemNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [systemNotification, setSystemNotification]);

  const dailySchedule = useMemo(() => {
    return studyPlan?.schedule.find(day => day.date === selectedDate);
  }, [studyPlan, selectedDate]);
  
  const currentPomodoroTask = useMemo(() => {
    if (!currentPomodoroTaskId || !studyPlan) return null;
    for (const day of studyPlan.schedule) {
        const task = day.tasks.find(t => t.id === currentPomodoroTaskId);
        if (task) return task;
    }
    return null;
  }, [currentPomodoroTaskId, studyPlan]);

  const navigateDay = useCallback((direction: 'next' | 'prev') => {
    const currentDate = parseDateString(selectedDate);
    if (direction === 'next') {
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    } else {
      currentDate.setUTCDate(currentDate.getUTCDate() - 1);
    }
    const newDateStr = currentDate.toISOString().split('T')[0];
    if (studyPlan && studyPlan.schedule.some(d => d.date === newDateStr)) {
      setSelectedDate(newDateStr);
    }
  }, [selectedDate, setSelectedDate, studyPlan]);
  
  const navigatePeriod = useCallback((direction: 'next' | 'prev', viewMode: 'Weekly' | 'Monthly') => {
      const currentDate = parseDateString(selectedDate);
      if (viewMode === 'Monthly') {
          currentDate.setUTCMonth(currentDate.getUTCMonth() + (direction === 'next' ? 1 : -1));
      } else {
          currentDate.setUTCDate(currentDate.getUTCDate() + (direction === 'next' ? 7 : -7));
      }
      setSelectedDate(currentDate.toISOString().split('T')[0]);
  }, [selectedDate, setSelectedDate]);

  const handlePomodoroSessionComplete = useCallback((sessionType: 'study' | 'rest', durationMinutes: number) => {
    if (sessionType === 'study' && currentPomodoroTaskId) {
      setStudyPlan(plan => {
        if (!plan) return null;
        updatePreviousStudyPlan(plan);
        const newSchedule = plan.schedule.map(day => ({
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
        return { ...plan, schedule: newSchedule };
      });
    }
  }, [currentPomodoroTaskId, setStudyPlan, updatePreviousStudyPlan]);

  const handlePomodoroTaskSelect = useCallback((taskId: string | null) => {
    setCurrentPomodoroTaskId(taskId);
    if (taskId) {
      const task = studyPlan?.schedule.flatMap(d => d.tasks).find(t => t.id === taskId);
      if (task) {
        setPomodoroSettings(prev => ({
          ...prev,
          isActive: false,
          isStudySession: true,
          timeLeft: task.durationMinutes * 60,
        }));
      }
    }
  }, [setCurrentPomodoroTaskId, setPomodoroSettings, studyPlan]);
  
  const handleTaskToggleForDay = (taskId: string) => handleTaskToggle(taskId, selectedDate);
  const handleToggleRestDayForDay = (isCurrentlyRestDay: boolean) => handleToggleRestDay(selectedDate, isCurrentlyRestDay);
  const handleUpdateTimeForDay = (newTotalMinutes: number) => {
      const exception: ExceptionDateRule = {
          date: selectedDate,
          targetMinutes: newTotalMinutes,
          dayType: 'workday-exception',
      };
      handleAddOrUpdateException(exception);
  };
  
  const handleSaveTask = (taskData: Parameters<AddTaskModalProps['onSave']>[0]) => {
    const newTask: ScheduledTask = {
      id: `manual_${Date.now()}`,
      resourceId: `manual_${Date.now()}`,
      originalResourceId: `manual_${Date.now()}`,
      title: taskData.title,
      type: taskData.type,
      originalTopic: taskData.domain,
      durationMinutes: taskData.durationMinutes,
      status: 'pending',
      order: (dailySchedule?.tasks.length || 0) + 1,
      isOptional: true,
      pages: taskData.pages,
      caseCount: taskData.caseCount,
      questionCount: taskData.questionCount,
      chapterNumber: taskData.chapterNumber,
    };
    setStudyPlan(plan => {
      if (!plan) return null;
      updatePreviousStudyPlan(plan);
      const newSchedule = plan.schedule.map(day => {
        if (day.date === selectedDate) {
          return { ...day, tasks: [...day.tasks, newTask], isManuallyModified: true };
        }
        return day;
      });
      return { ...plan, schedule: newSchedule };
    });
    closeModal('isAddTaskModalOpen');
  };
  
  const handleSaveResource = (resourceData: Parameters<ResourceEditorModalProps['onSave']>[0]) => {
    let updatedPool;
    if (resourceData.id) {
        updatedPool = globalMasterResourcePool.map(r => r.id === resourceData.id ? { ...r, ...resourceData } as StudyResource : r);
    } else {
        const newResource = addResourceToGlobalPool(resourceData);
        updatedPool = [...globalMasterResourcePool, newResource];
    }
    setGlobalMasterResourcePool(updatedPool);
    closeResourceEditor();
  };
  
  const handleArchiveResource = (resourceId: string) => {
    showConfirmation({
        title: "Archive Resource?",
        message: "This will remove the resource from future scheduling but keep it in an archived state. It will not be removed from days it's already scheduled on. You can restore it later.",
        confirmText: "Archive",
        confirmVariant: 'danger',
        onConfirm: () => {
            setGlobalMasterResourcePool(pool => pool.map(r => r.id === resourceId ? {...r, isArchived: true} : r));
        },
    });
  };

  const handleRestoreResource = (resourceId: string) => {
      setGlobalMasterResourcePool(pool => pool.map(r => r.id === resourceId ? {...r, isArchived: false} : r));
  };

  const handlePermanentDeleteResource = (resourceId: string) => {
    showConfirmation({
        title: "Permanently Delete Resource?",
        message: "This action is irreversible. The resource will be permanently removed from your library. It will remain on any days it is already scheduled.",
        confirmText: "Delete",
        confirmVariant: 'danger',
        onConfirm: () => {
             setGlobalMasterResourcePool(pool => pool.filter(r => r.id !== resourceId));
        },
    });
  };

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
  
  const findFirstDateForResource = (resourceId: string): string | null => {
    if (!studyPlan) return null;
    for (const day of studyPlan.schedule) {
      if (day.tasks.some(t => t.originalResourceId === resourceId)) {
        return day.date;
      }
    }
    return null;
  };
  
  const findAllDatesForResource = (resourceId: string): string[] => {
    if (!studyPlan) return [];
    const dates: string[] = [];
    studyPlan.schedule.forEach(day => {
        if (day.tasks.some(t => t.originalResourceId === resourceId)) {
            dates.push(day.date);
        }
    });
    return dates;
  }
  
  const handleGoToDate = (resourceId: string) => {
    const date = findFirstDateForResource(resourceId);
    if (date) {
        setSelectedDate(date);
        setActiveTab('schedule');
    } else {
        alert("This resource is not currently scheduled.");
    }
  };

  const handleHighlightDates = (resourceId: string) => {
    setHighlightedDates(findAllDatesForResource(resourceId));
  };
  
  const handleGenerateReport = (activeTab: 'schedule' | 'progress' | 'content', options: PrintOptions) => {
    let reportComponent: React.ReactNode = null;
    if (studyPlan) {
      if (activeTab === 'schedule') {
        const { reportType, startDate, endDate } = options.schedule;
        let scheduleSubset = studyPlan.schedule;
        if(reportType === 'range') scheduleSubset = studyPlan.schedule.filter(d => d.date >= startDate! && d.date <= endDate!);
        if(reportType === 'currentDay') scheduleSubset = studyPlan.schedule.filter(d => d.date === selectedDate);
        if(reportType === 'currentWeek') {
            const currentDay = parseDateString(selectedDate);
            const dayOfWeek = currentDay.getUTCDay(); // Sunday = 0
            const diff = currentDay.getUTCDate() - dayOfWeek;
            const weekStart = new Date(currentDay.setUTCDate(diff));
            const weekEnd = new Date(weekStart);
            weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
            const startDateStr = weekStart.toISOString().split('T')[0];
            const endDateStr = weekEnd.toISOString().split('T')[0];
            scheduleSubset = studyPlan.schedule.filter(d => d.date >= startDateStr && d.date <= endDateStr);
        }
        reportComponent = <ScheduleReport studyPlan={studyPlan} schedule={scheduleSubset} />;
      } else if (activeTab === 'progress') {
        reportComponent = <ProgressReport studyPlan={studyPlan} />;
      } else if (activeTab === 'content') {
        const resourcesWithStatus = globalMasterResourcePool.map(r => ({
            ...r,
            isScheduled: scheduledResourceIds.has(r.id),
            source: r.bookSource || r.videoSource || 'Custom',
        }));

        let filtered = resourcesWithStatus;
        if (options.content.filter !== 'all') {
            filtered = resourcesWithStatus.filter(r => {
                if(options.content.filter === 'archived') return r.isArchived;
                if(r.isArchived) return false;
                if(options.content.filter === 'scheduled') return r.isScheduled;
                if(options.content.filter === 'unscheduled') return !r.isScheduled;
                return true;
            });
        }
        
        filtered.sort((a,b) => {
            if(options.content.sortBy === 'title') return a.title.localeCompare(b.title);
            if(options.content.sortBy === 'domain') return a.domain.localeCompare(b.domain);
            if(options.content.sortBy === 'durationMinutesAsc') return a.durationMinutes - b.durationMinutes;
            if(options.content.sortBy === 'durationMinutesDesc') return b.durationMinutes - a.durationMinutes;
            return (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999);
        })
        
        const reportTitleMap = { all: 'All Resources', scheduled: 'Scheduled Resources', unscheduled: 'Unscheduled Resources', archived: 'Archived Resources' };

        reportComponent = <ContentReport resources={filtered} title={reportTitleMap[options.content.filter]}/>;
      }
    }
    
    if (reportComponent) {
      setPrintContent(reportComponent);
      setIsPrinting(true);
      closeModal('isPrintModalOpen');
      setTimeout(() => {
        window.print();
        setIsPrinting(false);
      }, 500);
    }
  };

  useEffect(() => {
    const { displacement, highlight } = generateGlassMaps({});
    document.documentElement.style.setProperty('--glass-displacement-map', `url(${displacement})`);
    document.documentElement.style.setProperty('--glass-highlight-map', `url(${highlight})`);
  }, []);
  
  if (!studyPlan) {
    return (
      <div className="flex items-center justify-center h-dvh bg-black text-white">
        <div className="text-center">
          <i className="fas fa-spinner fa-spin fa-3x mb-4"></i>
          <p>{systemNotification?.message || (isLoading ? 'Loading...' : 'Generating initial schedule...')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`app-container ${isPrinting ? 'is-printing' : ''}`}>
        <div className={`sidebar-container ${isSidebarOpen ? 'open' : ''}`}>
           <SidebarContent
             isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
             isPomodoroCollapsed={isPomodoroCollapsed} setIsPomodoroCollapsed={setIsPomodoroCollapsed}
             pomodoroSettings={pomodoroSettings} setPomodoroSettings={setPomodoroSettings}
             handlePomodoroSessionComplete={handlePomodoroSessionComplete}
             currentPomodoroTask={currentPomodoroTask}
             studyPlan={studyPlan}
             selectedDate={selectedDate} setSelectedDate={setSelectedDate}
             isMobile={isMobile}
             navigatePeriod={navigatePeriod}
             highlightedDates={highlightedDates}
             todayInNewYork={todayInNewYork}
             handleRebalance={handleRebalance}
             isLoading={isLoading}
             handleToggleCramMode={handleToggleCramMode}
             handleUpdateDeadlines={handleUpdateDeadlines}
             isSettingsOpen={isSettingsOpen} setIsSettingsOpen={setIsSettingsOpen}
             handleUpdateTopicOrderAndRebalance={handleUpdateTopicOrderAndRebalance}
             handleUpdateCramTopicOrderAndRebalance={handleUpdateCramTopicOrderAndRebalance}
             handleToggleSpecialTopicsInterleaving={handleToggleSpecialTopicsInterleaving}
             handleAddOrUpdateException={handleAddOrUpdateException}
             handleUndo={handleUndo}
             previousStudyPlan={previousStudyPlan}
             showConfirmation={showConfirmation}
             loadSchedule={loadSchedule}
             handleMasterResetTasks={handleMasterResetTasks}
             handleUpdatePlanDates={handleUpdatePlanDates}
           />
        </div>

        <main className="main-content">
          <header className="main-header">
            <div className="flex items-center space-x-2">
                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-xl text-[var(--text-primary)] hover:text-white lg:hidden" aria-label="Toggle menu">
                    <i className="fas fa-bars"></i>
                </button>
                <div>
                    <h1 className="text-lg font-bold text-white">{APP_TITLE}</h1>
                </div>
            </div>
            <CountdownTimer examDate={EXAM_DATE_START} />
          </header>
          
          <div className="p-1.5 sm:p-2.5 md:p-3.5 h-full overflow-y-auto">
            <div className="flex-shrink-0 bg-[var(--background-secondary)] rounded-lg p-1.5 inline-flex space-x-1.5 mb-3 w-full sm:w-auto">
              <Button onClick={() => setActiveTab('schedule')} variant={activeTab === 'schedule' ? 'primary' : 'secondary'} size="sm" className="flex-1 sm:flex-auto !px-3">
                  <i className="fas fa-calendar-day mr-2"></i> Daily Schedule
              </Button>
              <Button onClick={() => setActiveTab('progress')} variant={activeTab === 'progress' ? 'primary' : 'secondary'} size="sm" className="flex-1 sm:flex-auto !px-3">
                  <i className="fas fa-chart-line mr-2"></i> Progress
              </Button>
              <Button onClick={() => setActiveTab('resources')} variant={activeTab === 'resources' ? 'primary' : 'secondary'} size="sm" className="flex-1 sm:flex-auto !px-3">
                  <i className="fas fa-book mr-2"></i> Resources
              </Button>
              <Button onClick={() => openModal('isPrintModalOpen')} variant='secondary' size="sm" className="!px-3" title="Print Reports">
                  <i className="fas fa-print"></i>
              </Button>
            </div>
            {activeTab === 'schedule' && (
              <DailyTaskList
                dailySchedule={dailySchedule!}
                onTaskToggle={handleTaskToggleForDay}
                onOpenAddTaskModal={() => openModal('isAddTaskModalOpen')}
                onOpenModifyDayModal={() => openModal('isModifyDayTasksModalOpen')}
                currentPomodoroTaskId={currentPomodoroTaskId}
                onPomodoroTaskSelect={handlePomodoroTaskSelect}
                onNavigateDay={navigateDay}
                isPomodoroActive={pomodoroSettings.isActive}
                onToggleRestDay={handleToggleRestDayForDay}
                onUpdateTimeForDay={handleUpdateTimeForDay}
                isLoading={isLoading}
              />
            )}
            {activeTab === 'progress' && (
              <ProgressDisplay studyPlan={studyPlan} />
            )}
            {activeTab === 'resources' && (
                <MasterResourcePoolViewer 
                    resources={globalMasterResourcePool}
                    onOpenAddResourceModal={() => openResourceEditor(null)}
                    onEditResource={(res) => openResourceEditor(res)}
                    onArchiveResource={handleArchiveResource}
                    onRestoreResource={handleRestoreResource}
                    onPermanentDeleteResource={handlePermanentDeleteResource}
                    scheduledResourceIds={scheduledResourceIds}
                    onGoToDate={handleGoToDate}
                    onHighlightDates={handleHighlightDates}
                    onClearHighlights={() => setHighlightedDates([])}
                />
            )}
          </div>
        </main>
        
        {systemNotification && (
          <div className={`system-notification ${systemNotification.type}`}>
            {systemNotification.message}
            <button onClick={() => setSystemNotification(null)}>&times;</button>
          </div>
        )}
      </div>
      
      {/* Modals */}
      <AddTaskModal isOpen={modalStates.isAddTaskModalOpen} onClose={() => closeModal('isAddTaskModalOpen')} onSave={handleSaveTask} availableDomains={ALL_DOMAINS} selectedDate={selectedDate}/>
      <ResourceEditorModal 
        isOpen={modalStates.isResourceEditorOpen} 
        onClose={closeResourceEditor} 
        onSave={handleSaveResource} 
        onRequestArchive={handleArchiveResource}
        initialResource={modalData.editingResource} 
        availableDomains={ALL_DOMAINS}
        availableResourceTypes={Object.values(ResourceType)}
      />
      <ModifyDayTasksModal 
        isOpen={modalStates.isModifyDayTasksModalOpen}
        onClose={() => closeModal('isModifyDayTasksModalOpen')}
        onSave={(tasks) => {
            handleSaveModifiedDayTasks(tasks, selectedDate);
            closeModal('isModifyDayTasksModalOpen');
            handleRebalance({ type: 'standard' });
        }}
        tasksForDay={dailySchedule?.tasks || []}
        allResources={globalMasterResourcePool}
        selectedDate={selectedDate}
        showConfirmation={showConfirmation}
        onEditResource={(res) => openResourceEditor(res)}
        onArchiveResource={handleArchiveResource}
        onRestoreResource={handleRestoreResource}
        onPermanentDeleteResource={handlePermanentDeleteResource}
        openAddResourceModal={() => openResourceEditor(null)}
        isCramModeActive={studyPlan.isCramModeActive ?? false}
      />
      <PrintModal
        isOpen={modalStates.isPrintModalOpen}
        onClose={() => closeModal('isPrintModalOpen')}
        onGenerateReport={handleGenerateReport}
        studyPlan={studyPlan}
        currentDate={selectedDate}
        activeFilters={{ domain: 'all', type: 'all', source: 'all' }}
      />
      <ConfirmationModal {...modalStates.confirmationState} />
      <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => closeModal('isWelcomeModalOpen')} />
      
      {/* For Printing */}
      <div className="print-only-container">
        {printContent}
      </div>
    </>
  );
};

export default App;