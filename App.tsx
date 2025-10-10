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
import { formatDuration, getTodayInNewYork, parseDateString } from
'./utils/timeFormatter';

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
  // FIX: Updated signature to take RebalanceOptions.
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
            // FIX: Corrected onRebalance call to properly pass options to handleRebalance and fixed malformed comment that was breaking JSX parsing.
            onRebalance={(options) => { 
              handleRebalance(options); 
              if(options.type === 'topic-time') setSelectedDate(options.date); 
            }}
            isLoading={isLoading}
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
              {/* FIX: Corrected syntax for showConfirmation call by removing newlines inside the object literal. */}
              <Button onClick={() => showConfirmation({title: "Regenerate Schedule?", message: "This will regenerate the entire schedule from scratch based on the current resource pool and save it to the cloud. Are you sure?", confirmText: "Regenerate", confirmVariant: 'danger', onConfirm: () => loadSchedule(true)})} variant="danger" className="w-full" disabled={isLoading}>Regenerate Schedule</Button>
              {/* FIX: Corrected syntax for showConfirmation call by removing newlines inside the object literal. */}
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

  // FIX: Destructuring properties that are now correctly returned by the updated useStudyPlanManager hook.
  const {
    studyPlan, setStudyPlan, previousStudyPlan,
    globalMasterResourcePool, setGlobalMasterResourcePool,
    isLoading, systemNotification, setSystemNotification,
    isNewUser,
    loadSchedule, handleRebalance, handleUpdatePlanDates, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
    handleToggleCramMode,
    handleToggleSpecialTopicsInterleaving,
    handleTaskToggle, handleSaveModifiedDayTasks, handleUndo,
    updatePreviousStudyPlan,
    saveStatus,
    handleToggleRestDay,
    handleAddOrUpdateException,
  } = useStudyPlanManager(showConfirmation);

  const todayInNewYork = useMemo(() => getTodayInNewYork(), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayInNewYork);
  const [pomodoroSettings, setPomodoroSettings] =
usePersistentState<PomodoroSettings>('radiology_pomodoro_settings', {
    studyDuration: POMODORO_DEFAULT_STUDY_MINS,
    restDuration: POMODORO_DEFAULT_REST_MINS,
    isActive: false, isStudySession: true, timeLeft: POMODORO_DEFAULT_STUDY_MINS * 60,
  });
  const [currentPomodoroTaskId, setCurrentPomodoroTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'schedule' | 'progress' | 'content'>('schedule');
  const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
  const [isPomodoroCollapsed, setIsPomodoroCollapsed] =
usePersistentState('radiology_pomodoro_collapsed', true);

  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printableContent, setPrintableContent] = useState<React.ReactNode | null>(null);

  // Progress Tab Filter State Lifted from ProgressDisplay
  const [progressDomainFilter, setProgressDomainFilter] = useState<Domain | 'all'>('all');
  const [progressTypeFilter, setProgressTypeFilter] = useState<ResourceType | 'all'>('all');
  const [progressSourceFilter, setProgressSourceFilter] = useState<string | 'all'>('all');

  useEffect(() => {
    // Generate maps for a generic square size. This scales better across
    // different component aspect ratios.
    const { displacement, highlight } = generateGlassMaps({});

    const displacementEl = document.getElementById('displacementMapImage') as
unknown as SVGImageElement | null;
    const highlightEl = document.getElementById('specularHighlightImage') as
unknown as SVGImageElement | null;
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
    const currentDateObj = parseDateString(selectedDate);
    currentDateObj.setUTCDate(currentDateObj.getUTCDate() + (direction === 'next'
? 1 : -1));
    const newDateStr = currentDateObj.toISOString().split('T')[0];
    if (!studyPlan) return;
    if (newDateStr >= studyPlan.startDate && newDateStr <= studyPlan.endDate) {
      setSelectedDate(newDateStr);
    }
    setHighlightedDates([]);
  }, [selectedDate, studyPlan]);

  const navigatePeriod = useCallback((direction: 'next' | 'prev', viewMode: 'Weekly' | 'Monthly') => {
    const currentDateObj = parseDateString(selectedDate);
    if (viewMode === 'Weekly') {
      currentDateObj.setUTCDate(currentDateObj.getUTCDate() + (direction === 'next' ? 7 : -7));
    } else if (viewMode === 'Monthly') {
      const currentMonth = currentDateObj.getUTCMonth();
      currentDateObj.setUTCMonth(currentMonth + (direction === 'next' ? 1 : -1));
    }
    const newDateStr = currentDateObj.toISOString().split('T')[0];
    setSelectedDate(newDateStr);
    setHighlightedDates([]);
  }, [selectedDate]);

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
      setPomodoroSettings(prev => ({ ...prev, isActive: false, isStudySession:
true, timeLeft: prev.studyDuration * 60 }));
      setIsPomodoroCollapsed(false);
    }
  }, [setPomodoroSettings, setIsPomodoroCollapsed]);

  const handleSaveResource: ResourceEditorModalProps['onSave'] =
useCallback((resourceData) => {
    if (resourceData.id && modalData.editingResource) { // Update
      const fullResource = { ...modalData.editingResource, ...resourceData };
      setGlobalMasterResourcePool(prev => prev.map(r => r.id === fullResource.id ?
fullResource : r));
      setSystemNotification({type: 'info', message: "Resource updated. Rebalance your schedule to apply changes."});
    } else { // Add
      const newResource = addResourceToGlobalPool(resourceData);
      setGlobalMasterResourcePool(prev => [...prev, newResource]);
      setSystemNotification({type: 'info', message: "New resource added. Rebalance your schedule to include it."});
    }
    closeResourceEditor();
  }, [modalData.editingResource, setGlobalMasterResourcePool,
setSystemNotification, closeResourceEditor]);

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
        setSystemNotification({ type: 'info', message: `Resource "${resource.title}" archived.`});
      }
    });
  }, [globalMasterResourcePool, showConfirmation, setGlobalMasterResourcePool,
setSystemNotification]);

  const handleRestoreResource = useCallback((resourceId: string) => {
    setGlobalMasterResourcePool(p => p.map(r => r.id === resourceId ? {...r, isArchived: false } : r));
    setSystemNotification({ type: 'info', message: `Resource restored.`});
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
  }, [globalMasterResourcePool, showConfirmation, setGlobalMasterResourcePool,
setSystemNotification]);

  const handleMasterResetTasks = useCallback(() => {
    if (!studyPlan) return;
    updatePreviousStudyPlan(studyPlan);
    setStudyPlan(prev => prev ? ({ ...prev, schedule: prev.schedule.map(d => ({ ...d, tasks: d.tasks.map(t => ({...t, status: 'pending'})) }))}) : null);
  }, [studyPlan, updatePreviousStudyPlan, setStudyPlan]);

  const handleSaveOptionalTask: AddTaskModalProps['onSave'] =
useCallback((taskData) => {
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
    // FIX: Changed call to handleRebalance to pass a standard options object.
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
        setSystemNotification({ type: 'info', message: `Logged ${formatDuration(durationMinutes)} to "${task.title}".`});
        setTimeout(() => setSystemNotification (null), 4000);
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
      setTimeout(() => setSystemNotification(null), 3000);
    }
  }, [currentPomodoroTaskId, studyPlan, setStudyPlan, updatePreviousStudyPlan,
setSystemNotification, showConfirmation, handleTaskToggle, selectedDate]);

  const handleUpdateDeadlines = useCallback((newDeadlines: DeadlineSettings) => {
    if (!studyPlan) return;
    updatePreviousStudyPlan(studyPlan);
    const updatedPlan = { ...studyPlan, deadlines: newDeadlines };
    setStudyPlan(updatedPlan);
    // FIX: Passed a standard options object to handleRebalance.
    handleRebalance({ type: 'standard' });
  }, [studyPlan, updatePreviousStudyPlan, setStudyPlan, handleRebalance]);

  const scheduledResourceIds = useMemo(() => {
    if (!studyPlan) return new Set<string>();
    return new Set(studyPlan.schedule.flatMap(day => day.tasks.map(task => task.originalResourceId || task.resourceId)));
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
      const { reportType } = options.schedule;
      let scheduleSubset: DailySchedule[] = [];
      switch(reportType) {
        case 'full':
          scheduleSubset = studyPlan.schedule;
          break;
        case 'range':
          const { startDate, endDate } = options.schedule;
          scheduleSubset = studyPlan.schedule.filter(day => day.date >= (startDate || '0') && day.date <= (endDate || 'Z'));
          break;
        case 'currentDay':
          scheduleSubset = studyPlan.schedule.filter(day => day.date === selectedDate);
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
          break;
      }
      reportComponent = <ScheduleReport studyPlan={studyPlan} schedule={scheduleSubset} />;
    } else if (activeTab === 'progress') {
      reportComponent = <ProgressReport studyPlan={studyPlan} />;
    } else { // content
      const { filter, sortBy } = options.content;
      let resourcesToPrint = globalMasterResourcePool.map(r => ({
        ...r,
        isScheduled: scheduledResourceIds.has(r.id),
        source: r.bookSource || r.videoSource || 'Custom',
      }));
      let title = "All Resources";
      if (filter === 'scheduled') { resourcesToPrint = resourcesToPrint.filter(r => r.isScheduled); title = "Scheduled Resources"; }
      if (filter === 'unscheduled') { resourcesToPrint = resourcesToPrint.filter(r => !r.isScheduled && !r.isArchived); title = "Unscheduled Resources"; }
      if (filter === 'archived') { resourcesToPrint = resourcesToPrint.filter(r => r.isArchived); title = "Archived Resources"; }
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
  }, [studyPlan, globalMasterResourcePool, scheduledResourceIds, selectedDate]);

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

  if (isLoading && !studyPlan) {
    return <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4"><i className="fas fa-brain fa-spin fa-3x mb-6 text-[var(--accent-purple)]"></i><h1 className="text-2xl font-bold mb-3">{APP_TITLE}</h1><p className="text-lg mb-6">Connecting to the cloud...</p></div>;
  }

  if (!studyPlan) {
    return <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4"><i className="fas fa-exclamation-triangle fa-3x text-[var(--accent-red)] mb-4"></i><h1 className="text-2xl font-bold mb-2">Error</h1><p className="text-red-400 text-center mb-6">{systemNotification?.message || 'An unknown error occurred.'}</p><Button onClick={() => loadSchedule(true)} variant="primary">Try Again</Button></div>;
  }

  const selectedDaySchedule = studyPlan.schedule.find(day => day.date === selectedDate);
  const currentPomodoroTask = currentPomodoroTaskId ? studyPlan.schedule.flatMap(d => d.tasks).find(t => t.id === currentPomodoroTaskId) : null;

  const MainAppContent = (
    <div className="h-full w-full bg-transparent text-[var(--text-primary)] flex flex-col print:hidden">
      <div className={`lg:hidden fixed inset-y-0 left-0 z-[var(--z-sidebar-mobile)] transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <SidebarContent
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            isPomodoroCollapsed={isPomodoroCollapsed}
            setIsPomodoroCollapsed={setIsPomodoroCollapsed}
            pomodoroSettings={pomodoroSettings}
            setPomodoroSettings={setPomodoroSettings}
            handlePomodoroSessionComplete={handlePomodoroSessionComplete}
            currentPomodoroTask={currentPomodoroTask}
            studyPlan={studyPlan}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            isMobile={isMobile}
            navigatePeriod={navigatePeriod}
            highlightedDates={highlightedDates}
            todayInNewYork={todayInNewYork}
            handleRebalance={handleRebalance}
            isLoading={isLoading}
            handleToggleCramMode={handleToggleCramMode}
            handleUpdateDeadlines={handleUpdateDeadlines}
            isSettingsOpen={isSettingsOpen}
            setIsSettingsOpen={setIsSettingsOpen}
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
      <div className={`lg:hidden fixed inset-0 bg-black/60 z-[var(--z-sidebar-mobile-backdrop)] transition-opacity ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsSidebarOpen(false)} aria-hidden="true"></div>
      <div className="hidden lg:block fixed inset-y-0 left-0 z-30">
        <SidebarContent
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            isPomodoroCollapsed={isPomodoroCollapsed}
            setIsPomodoroCollapsed={setIsPomodoroCollapsed}
            pomodoroSettings={pomodoroSettings}
            setPomodoroSettings={setPomodoroSettings}
            handlePomodoroSessionComplete={handlePomodoroSessionComplete}
            currentPomodoroTask={currentPomodoroTask}
            studyPlan={studyPlan}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            isMobile={isMobile}
            navigatePeriod={navigatePeriod}
            highlightedDates={highlightedDates}
            todayInNewYork={todayInNewYork}
            handleRebalance={handleRebalance}
            isLoading={isLoading}
            handleToggleCramMode={handleToggleCramMode}
            handleUpdateDeadlines={handleUpdateDeadlines}
            isSettingsOpen={isSettingsOpen}
            setIsSettingsOpen={setIsSettingsOpen}
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
                <div className={`sm:hidden h-8 w-8 rounded-full flex items-center justify-center text-xs ${pomodoroSettings.isStudySession ? 'bg-[var(--accent-purple)] text-white' : 'bg-[var(--accent-green)] text-black'}`}>
                  <i className="fas fa-stopwatch"></i>
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
                {isLoading && <div className="flex flex-col items-center justify-center p-10"> <i className="fas fa-spinner fa-spin fa-2x text-[var(--accent-purple)] mb-3"></i> <span className="text-[var(--text-primary)]">Loading...</span> </div>}
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
                        onToggleRestDay={(isRest) => handleToggleRestDay(selectedDate, isRest)}
                        onUpdateTimeForDay={handleUpdateTimeForDay}
                        isLoading={isLoading}
                      /> : <div className="text-center text-[var(--text-secondary)] py-10">No schedule for this day.</div>
                    }
                  </div>
                )}
                {!isLoading && activeTab === 'progress' &&
                  <ProgressDisplay studyPlan={studyPlan} />}
                {!isLoading && activeTab === 'content' && (
                  <MasterResourcePoolViewer
                    resources={globalMasterResourcePool}
                    onOpenAddResourceModal={() => openResourceEditor(null)}
                    onEditResource={openResourceEditor}
                    onArchiveResource={handleRequestArchive}
                    onRestoreResource={handleRestoreResource}
                    onPermanentDeleteResource={handlePermanentDelete}
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
        {systemNotification && (
          <div
            className="flex-shrink-0 p-3 text-sm text-center flex justify-between items-center text-white border-t border-white/10 glass-chrome"
            style={{
              '--notification-color': systemNotification.type === 'error' ? 'var(--accent-red)' : 'var(--accent-purple)',
              backgroundColor: `color-mix(in srgb, var(--notification-color) 25%, var(--glass-bg-chrome))`,
            } as React.CSSProperties}
          >
            <span className="text-left"><i className={`fas ${systemNotification.type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-2`}></i>{systemNotification.message}</span>
            <button onClick={() => setSystemNotification(null)} className="ml-4 font-bold text-xl leading-none" aria-label="Dismiss notification">&times;</button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="main-app-container">{MainAppContent}</div>
      <div className="print-only-container">
        {printableContent}
      </div>

      {modalStates.isWelcomeModalOpen && <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => closeModal('isWelcomeModalOpen')} />}
      {modalStates.isAddTaskModalOpen && selectedDaySchedule && <AddTaskModal isOpen={modalStates.isAddTaskModalOpen} onClose={() => closeModal('isAddTaskModalOpen')} onSave={handleSaveOptionalTask} availableDomains={ALL_DOMAINS} selectedDate={selectedDate}/>}
      {modalStates.isModifyDayTasksModalOpen && selectedDaySchedule && <ModifyDayTasksModal isOpen={modalStates.isModifyDayTasksModalOpen} onClose={() => closeModal('isModifyDayTasksModalOpen')} onSave={onDayTasksSave} tasksForDay={selectedDaySchedule.tasks} allResources={globalMasterResourcePool} selectedDate={selectedDate} showConfirmation={showConfirmation} onEditResource={openResourceEditor} onArchiveResource={handleRequestArchive} onRestoreResource={handleRestoreResource} onPermanentDeleteResource={handlePermanentDelete} openAddResourceModal={() => openResourceEditor(null)} isCramModeActive={studyPlan.isCramModeActive ?? false} />}
      {modalStates.isResourceEditorOpen && <ResourceEditorModal isOpen={modalStates.isResourceEditorOpen} onClose={closeResourceEditor} onSave={handleSaveResource} onRequestArchive={handleRequestArchive} initialResource={modalData.editingResource} availableDomains={ALL_DOMAINS} availableResourceTypes={Object.values(ResourceType)}/>}
      <ConfirmationModal {...modalStates.confirmationState} onConfirm={handleConfirm} onClose={modalStates.confirmationState.onClose} />
      {isPrintModalOpen && <PrintModal isOpen={isPrintModalOpen} onClose={() => setIsPrintModalOpen(false)} onGenerateReport={handleGenerateReport} studyPlan={studyPlan} currentDate={selectedDate} activeFilters={{domain: progressDomainFilter, type: progressTypeFilter, source: progressSourceFilter}} />}
    </>
  );
};

export default App;
