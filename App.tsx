import React, { useState, useEffect, useMemo } from 'react';
import { useStudyPlanManager } from './hooks/useStudyPlanManager';
import { useModalManager } from './hooks/useModalManager';
import { ViewMode, StudyResource, ScheduledTask } from './types';

// Import Components
import DailyTaskList from './components/DailyTaskList';
import PomodoroTimer from './components/PomodoroTimer';
import CalendarView from './components/CalendarView';
import ProgressDisplay from './components/ProgressDisplay';
import AdvancedControls from './components/AdvancedControls';
import AddExceptionDay from './components/AddExceptionDay';
import TopicOrderManager from './components/TopicOrderManager';
import CountdownTimer from './components/CountdownTimer';
import MasterResourcePoolViewer from './components/MasterResourcePoolViewer';

// Import Modals
import WelcomeModal from './components/WelcomeModal';
import AddTaskModal from './components/AddTaskModal';
import ModifyDayTasksModal from './components/ModifyDayTasksModal';
import AddGlobalResourceModal from './components/AddGlobalResourceModal';
import ConfirmationModal from './components/ConfirmationModal';
import PrintModal from './components/PrintModal';

import { usePersistentState } from './hooks/usePersistentState';
import { getTodayInNewYork } from './utils/timeFormatter';
import { EXAM_DATE_START, ALL_DOMAINS } from './constants';
import { generateGlassMaps } from './utils/glassEffectGenerator';


function App() {
  const {
    studyPlan,
    dailySchedule,
    isLoading,
    loadingMessage,
    error,
    currentDate,
    setCurrentDate,
    pomodoroSettings,
    setPomodoroSettings,
    currentPomodoroTaskId,
    onPomodoroTaskSelect,
    onNavigateDay,
    onTaskToggle,
    onPomodoroSessionComplete,
    rebalanceSchedule,
    addOptionalTask,
    updateDayTasks,
    onToggleRestDay,
    onUpdateTimeForDay,
    resources,
    addResource,
    updateResource,
    archiveResource,
    restoreResource,
    permanentDeleteResource,
  } = useStudyPlanManager();

  const {
    modalStates,
    modalData,
    openModal,
    closeModal,
    openResourceEditor,
    closeResourceEditor,
    showConfirmation,
  } = useModalManager();

  const [hasSeenWelcome, setHasSeenWelcome] = usePersistentState('hasSeenWelcome', false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.DAILY);
  const [activeMobileTab, setActiveMobileTab] = useState<'schedule' | 'plan'>('schedule');
  const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
  
  useEffect(() => {
    if (!hasSeenWelcome) {
      openModal('isWelcomeModalOpen');
      setHasSeenWelcome(true);
    }
  }, [hasSeenWelcome, openModal, setHasSeenWelcome]);

  useEffect(() => {
    const { displacement, highlight } = generateGlassMaps({});
    document.documentElement.style.setProperty('--glass-displacement-map', `url(${displacement})`);
    document.documentElement.style.setProperty('--glass-highlight-map', `url(${highlight})`);
  }, []);

  const onNavigatePeriod = (direction: 'next' | 'prev') => {
    const newDate = new Date(currentDate + 'T12:00:00Z');
    const multiplier = direction === 'next' ? 1 : -1;

    if (viewMode === ViewMode.MONTHLY) {
      newDate.setUTCMonth(newDate.getUTCMonth() + multiplier);
    } else { // weekly
      newDate.setUTCDate(newDate.getUTCDate() + (7 * multiplier));
    }
    setCurrentDate(newDate.toISOString().split('T')[0]);
  };
  
  const scheduledResourceIds = useMemo(() => {
    if (!studyPlan) return new Set<string>();
    const ids = new Set<string>();
    studyPlan.schedule.forEach(day => {
        day.tasks.forEach(task => ids.add(task.originalResourceId || task.resourceId));
    });
    return ids;
  }, [studyPlan]);
  
  const findResourceDates = (resourceId: string): string[] => {
    if (!studyPlan) return [];
    return studyPlan.schedule
        .filter(day => day.tasks.some(task => (task.originalResourceId || task.resourceId) === resourceId))
        .map(day => day.date);
  };
  
  const handleHighlightDates = (resourceId: string) => {
    setHighlightedDates(findResourceDates(resourceId));
  };
  
  const handleGoToDate = (resourceId: string) => {
      const dates = findResourceDates(resourceId);
      if (dates.length > 0) {
          setCurrentDate(dates[0]);
          setViewMode(ViewMode.DAILY); // Switch to daily view to see the task
          setActiveMobileTab('schedule');
      }
  };

  if (isLoading && !studyPlan) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center text-center bg-[var(--background-primary)] text-white p-4">
        <i className="fas fa-brain fa-spin fa-3x mb-4 text-[var(--accent-purple)]"></i>
        <h1 className="text-2xl font-bold">Building Your Study Plan</h1>
        <p className="text-[var(--text-secondary)] mt-2">{loadingMessage}</p>
      </div>
    );
  }

  if (error) {
    return <div className="h-screen w-screen flex items-center justify-center bg-red-900/50 text-white">{error}</div>;
  }

  if (!studyPlan) {
    return <div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white">Could not load study plan.</div>;
  }
  
  const today = getTodayInNewYork();

  return (
    <>
      {isLoading && (
        <div className="fixed inset-0 bg-black/60 flex flex-col items-center justify-center z-[var(--z-loader)] text-white">
          <i className="fas fa-sync-alt fa-spin fa-2x mb-3"></i>
          <p className="font-semibold">{loadingMessage}</p>
        </div>
      )}
      
      <main className="max-w-7xl mx-auto p-2 md:p-4 text-[var(--text-primary)]">
        <header className="mb-3 md:mb-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center space-x-3">
                    <i className="fas fa-brain text-2xl text-[var(--accent-purple)]"></i>
                    <h1 className="text-xl font-bold text-white hidden sm:block">Radiology Exam Planner</h1>
                </div>
                 <div className="flex items-center space-x-2">
                    <CountdownTimer examDate={EXAM_DATE_START} />
                    <Button onClick={() => openModal('isPrintModalOpen')} variant="ghost" size="sm" className="!px-2.5" title="Print Reports">
                        <i className="fas fa-print"></i>
                    </Button>
                </div>
            </div>
        </header>

        {/* Mobile Tab Navigation */}
        <div className="md:hidden mb-3 sticky top-2 z-10 glass-chrome p-1 rounded-lg">
             <div className="inline-flex bg-[var(--background-secondary)] p-1 rounded-lg space-x-1 w-full">
              <button onClick={() => setActiveMobileTab('schedule')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeMobileTab === 'schedule' ? 'bg-[var(--glass-bg-active)] shadow' : 'hover:bg-white/10'}`}>Daily Schedule</button>
              <button onClick={() => setActiveMobileTab('plan')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeMobileTab === 'plan' ? 'bg-[var(--glass-bg-active)] shadow' : 'hover:bg-white/10'}`}>Plan & Progress</button>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 md:gap-4 lg:gap-6">
          
          {/* Left Column: Controls (Hidden on mobile) */}
          <div className="hidden md:block md:col-span-3 space-y-4">
             <AdvancedControls 
                onRebalance={rebalanceSchedule} 
                isLoading={isLoading} 
                selectedDate={currentDate}
                isCramModeActive={studyPlan.isCramModeActive || false}
                onToggleCramMode={() => {}}
                deadlines={studyPlan.deadlines}
                onUpdateDeadlines={() => {}}
                startDate={studyPlan.startDate}
                endDate={studyPlan.endDate}
                onUpdateDates={() => {}}
             />
             <AddExceptionDay onAddException={() => {}} isLoading={isLoading} />
             <TopicOrderManager 
                topicOrder={studyPlan.topicOrder} onSaveOrder={() => {}} 
                cramTopicOrder={studyPlan.cramTopicOrder} onSaveCramOrder={() => {}}
                isLoading={isLoading} isCramModeActive={studyPlan.isCramModeActive || false}
                areSpecialTopicsInterleaved={studyPlan.areSpecialTopicsInterleaved}
                onToggleSpecialTopicsInterleaving={() => {}}
            />
          </div>
          
          {/* Center Column: Main Content */}
          <div className={`md:col-span-6 space-y-4 ${activeMobileTab !== 'schedule' ? 'hidden md:block' : ''}`}>
            <div className="md:hidden">
                <Button onClick={() => setViewMode(ViewMode.DAILY)} variant={viewMode === ViewMode.DAILY ? 'primary' : 'secondary'} size="sm">Daily</Button>
                <Button onClick={() => setViewMode(ViewMode.MONTHLY)} variant={viewMode === ViewMode.MONTHLY ? 'primary' : 'secondary'} size="sm">Monthly</Button>
            </div>
            
            {viewMode === ViewMode.DAILY ? (
                <DailyTaskList
                    dailySchedule={dailySchedule!}
                    onTaskToggle={onTaskToggle}
                    onOpenAddTaskModal={() => openModal('isAddTaskModalOpen')}
                    onOpenModifyDayModal={() => openModal('isModifyDayTasksModalOpen')}
                    currentPomodoroTaskId={currentPomodoroTaskId}
                    onPomodoroTaskSelect={onPomodoroTaskSelect}
                    onNavigateDay={onNavigateDay}
                    isPomodoroActive={pomodoroSettings.isActive}
                    onToggleRestDay={onToggleRestDay}
                    onUpdateTimeForDay={onUpdateTimeForDay}
                    isLoading={isLoading}
                />
            ) : (
                <CalendarView 
                    schedule={studyPlan.schedule}
                    selectedDate={currentDate}
                    onDateSelect={(date) => { setCurrentDate(date); setViewMode(ViewMode.DAILY); }}
                    viewMode={ViewMode.MONTHLY}
                    currentDisplayDate={currentDate}
                    onNavigatePeriod={onNavigatePeriod}
                    highlightedDates={highlightedDates}
                    today={today}
                />
            )}
             
            {viewMode === ViewMode.DAILY && (
              <div className="md:hidden space-y-4">
                <PomodoroTimer settings={pomodoroSettings} setSettings={setPomodoroSettings} onSessionComplete={onPomodoroSessionComplete} linkedTaskTitle={dailySchedule?.tasks.find(t => t.id === currentPomodoroTaskId)?.title} />
                <ProgressDisplay studyPlan={studyPlan} />
              </div>
            )}
          </div>
          
          {/* Right Column: Status & Planning */}
          <div className={`md:col-span-3 space-y-4 ${activeMobileTab !== 'plan' ? 'hidden md:block' : ''}`}>
            <div className="hidden md:block">
               <PomodoroTimer settings={pomodoroSettings} setSettings={setPomodoroSettings} onSessionComplete={onPomodoroSessionComplete} linkedTaskTitle={dailySchedule?.tasks.find(t => t.id === currentPomodoroTaskId)?.title} />
            </div>
             <CalendarView
                schedule={studyPlan.schedule}
                selectedDate={currentDate}
                onDateSelect={setCurrentDate}
                viewMode={ViewMode.MONTHLY}
                currentDisplayDate={currentDate}
                onNavigatePeriod={onNavigatePeriod}
                highlightedDates={highlightedDates}
                today={today}
            />
            <ProgressDisplay studyPlan={studyPlan} />
            <MasterResourcePoolViewer 
                resources={resources}
                onOpenAddResourceModal={() => openResourceEditor(null)}
                onEditResource={openResourceEditor}
                onArchiveResource={(id) => showConfirmation({ title: 'Archive Resource?', message: 'This will remove the resource from future scheduling. It can be restored later.', onConfirm: () => archiveResource(id), confirmVariant: 'danger', confirmText: 'Archive' })}
                onRestoreResource={restoreResource}
                onPermanentDeleteResource={(id) => showConfirmation({ title: 'Delete Permanently?', message: 'This action is irreversible. The resource and its history will be gone forever.', onConfirm: () => permanentDeleteResource(id), confirmVariant: 'danger', confirmText: 'Delete' })}
                scheduledResourceIds={scheduledResourceIds}
                onGoToDate={handleGoToDate}
                onHighlightDates={handleHighlightDates}
                onClearHighlights={() => setHighlightedDates([])}
            />

             <div className="md:hidden space-y-4">
                <AdvancedControls 
                    onRebalance={rebalanceSchedule} 
                    isLoading={isLoading} 
                    selectedDate={currentDate}
                    isCramModeActive={studyPlan.isCramModeActive || false}
                    onToggleCramMode={() => {}}
                    deadlines={studyPlan.deadlines}
                    onUpdateDeadlines={() => {}}
                    startDate={studyPlan.startDate}
                    endDate={studyPlan.endDate}
                    onUpdateDates={() => {}}
                />
                 <AddExceptionDay onAddException={() => {}} isLoading={isLoading} />
                 <TopicOrderManager 
                    topicOrder={studyPlan.topicOrder} onSaveOrder={() => {}} 
                    cramTopicOrder={studyPlan.cramTopicOrder} onSaveCramOrder={() => {}}
                    isLoading={isLoading} isCramModeActive={studyPlan.isCramModeActive || false}
                    areSpecialTopicsInterleaved={studyPlan.areSpecialTopicsInterleaved}
                    onToggleSpecialTopicsInterleaving={() => {}}
                />
            </div>
          </div>
        </div>
      </main>
      
      {/* Modals */}
      <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => closeModal('isWelcomeModalOpen')} />
      <AddTaskModal isOpen={modalStates.isAddTaskModalOpen} onClose={() => closeModal('isAddTaskModalOpen')} onSave={addOptionalTask} availableDomains={ALL_DOMAINS} selectedDate={currentDate} />
      <ModifyDayTasksModal 
        isOpen={modalStates.isModifyDayTasksModalOpen}
        onClose={() => closeModal('isModifyDayTasksModalOpen')}
        onSave={(updatedTasks) => updateDayTasks(currentDate, updatedTasks)}
        tasksForDay={dailySchedule?.tasks || []}
        allResources={resources}
        selectedDate={currentDate}
        showConfirmation={showConfirmation}
        onEditResource={openResourceEditor}
        onArchiveResource={(id) => archiveResource(id)}
        onRestoreResource={restoreResource}
        onPermanentDeleteResource={(id) => permanentDeleteResource(id)}
        openAddResourceModal={() => openResourceEditor(null)}
        isCramModeActive={studyPlan.isCramModeActive || false}
      />
      <AddGlobalResourceModal
          isOpen={modalStates.isResourceEditorOpen}
          onClose={closeResourceEditor}
          onSave={(data) => {
              if (data.id) {
                  updateResource(data as StudyResource);
              } else {
                  addResource(data);
              }
              closeResourceEditor();
          }}
          onRequestArchive={(id) => {
            archiveResource(id);
            closeResourceEditor();
          }}
          initialResource={modalData.editingResource}
          availableDomains={ALL_DOMAINS}
          availableResourceTypes={Object.values(ResourceType)}
      />
      <ConfirmationModal {...modalStates.confirmationState} />
      <PrintModal 
        isOpen={modalStates.isPrintModalOpen} 
        onClose={() => closeModal('isPrintModalOpen')} 
        onGenerateReport={()=>{}} 
        studyPlan={studyPlan} 
        currentDate={currentDate} 
        activeFilters={{domain:'all', type: 'all', source: 'all'}} 
      />
    </>
  );
}

export default App;
