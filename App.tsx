import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useStudyPlanManager } from './hooks/useStudyPlanManager';
import { useModalManager } from './hooks/useModalManager';
import { getTodayInNewYork } from './utils/timeFormatter';
import { EXAM_DATE_START, POMODORO_DEFAULT_REST_MINS, POMODORO_DEFAULT_STUDY_MINS } from './constants';
import { PomodoroSettings, StudyResource, ViewMode, ScheduledTask, AddTaskModalProps, ResourceEditorModalProps, Omit, ResourceType } from './types';
import { usePersistentState } from './hooks/usePersistentState';
import DailyTaskList from './components/DailyTaskList';
import CalendarView from './components/CalendarView';
import PomodoroTimer from './components/PomodoroTimer';
import ProgressDisplay from './components/ProgressDisplay';
import AddTaskModal from './components/AddTaskModal';
import ModifyDayTasksModal from './components/ModifyDayTasksModal';
import ResourceEditorModal from './components/AddGlobalResourceModal';
import WelcomeModal from './components/WelcomeModal';
import ConfirmationModal from './components/ConfirmationModal';
import AdvancedControls from './components/AdvancedControls';
import TopicOrderManager from './components/TopicOrderManager';
import MasterResourcePoolViewer from './components/MasterResourcePoolViewer';
import CountdownTimer from './components/CountdownTimer';
import { generateGlassMaps } from './utils/glassEffectGenerator';
import { Button } from './components/Button';
import { parseDateString } from './utils/timeFormatter';

const App: React.FC = () => {
    // A one-time check to show the welcome modal to new users.
    const [isFirstVisit, setIsFirstVisit] = usePersistentState('is_first_visit_v2', true);

    const [viewMode, setViewMode] = usePersistentState<ViewMode | 'RESOURCES' | 'PROGRESS'>('app_view_mode_v2', ViewMode.DAILY);
    const [selectedDate, setSelectedDate] = useState(getTodayInNewYork());
    const [currentPomodoroTaskId, setCurrentPomodoroTaskId] = usePersistentState<string | null>('pomodoro_task_id_v2', null);
    const [pomodoroSettings, setPomodoroSettings] = usePersistentState<PomodoroSettings>('pomodoro_settings_v2', {
        studyDuration: POMODORO_DEFAULT_STUDY_MINS,
        restDuration: POMODORO_DEFAULT_REST_MINS,
        isActive: false,
        isStudySession: true,
        timeLeft: POMODORO_DEFAULT_STUDY_MINS * 60,
    });
    const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const { modalStates, modalData, openModal, closeModal, openResourceEditor, closeResourceEditor, showConfirmation } = useModalManager();
    
    const { 
        studyPlan, setStudyPlan, isLoading, loadingMessage, handleRebalance, 
        handleTaskToggle, handleSaveModifiedDayTasks, masterResources, 
        setGlobalMasterResourcePool, handleArchiveResource, handleRestoreResource, 
        handlePermanentDeleteResource, handleUpdateTopicOrderAndRebalance, handleUpdateCramTopicOrderAndRebalance,
        handleToggleCramMode, handleToggleSpecialTopicsInterleaving, handleUpdateDeadlines, handleUpdatePlanDates, handleAddOrUpdateException
    } = useStudyPlanManager(showConfirmation);

    useEffect(() => {
        if (isFirstVisit) {
            openModal('isWelcomeModalOpen');
            setIsFirstVisit(false);
        }
    }, [isFirstVisit, openModal, setIsFirstVisit]);
    
    // Glass effect generation
    useEffect(() => {
        const { displacement, highlight } = generateGlassMaps({ borderRadius: 12, bezelWidth: 10 });
        document.documentElement.style.setProperty('--glass-displacement-map', `url(${displacement})`);
        document.documentElement.style.setProperty('--glass-highlight-map', `url(${highlight})`);
    }, []);

    const today = getTodayInNewYork();
    const dailyScheduleForSelectedDate = useMemo(() => {
        return studyPlan?.schedule.find(d => d.date === selectedDate) || null;
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
        studyPlan.schedule.forEach(day => day.tasks.forEach(task => ids.add(task.resourceId)));
        return ids;
    }, [studyPlan]);

    const handleNavigateDay = useCallback((direction: 'next' | 'prev') => {
        const currentDate = parseDateString(selectedDate);
        currentDate.setUTCDate(currentDate.getUTCDate() + (direction === 'next' ? 1 : -1));
        setSelectedDate(currentDate.toISOString().split('T')[0]);
    }, [selectedDate]);

    const handlePomodoroSessionComplete = useCallback((sessionType: 'study' | 'rest', durationMinutes: number) => {
        if (sessionType === 'study' && currentPomodoroTaskId) {
            if (!studyPlan) return;
            const newSchedule = studyPlan.schedule.map(day => ({
                ...day,
                tasks: day.tasks.map(task => {
                    if (task.id === currentPomodoroTaskId) {
                        return { ...task, actualStudyTimeMinutes: (task.actualStudyTimeMinutes || 0) + durationMinutes };
                    }
                    return task;
                })
            }));
            setStudyPlan(prev => prev ? { ...prev, schedule: newSchedule } : null);
        }
        // Notification for rest completion can be added here if needed
    }, [currentPomodoroTaskId, studyPlan, setStudyPlan]);

    const handleUpdateTimeForDay = useCallback((newTotalMinutes: number) => {
        // This functionality is now handled by the backend solver. We pass an exception.
        const rule = { date: selectedDate, targetMinutes: newTotalMinutes, dayType: 'workday-exception' as const };
        handleAddOrUpdateException(rule);
    }, [selectedDate, handleAddOrUpdateException]);

    const handleToggleRestDay = useCallback((isCurrentlyRestDay: boolean) => {
        const rule = { date: selectedDate, dayType: 'specific-rest' as const, isRestDayOverride: !isCurrentlyRestDay };
        handleAddOrUpdateException(rule);
    }, [selectedDate, handleAddOrUpdateException]);

    const handleAddOptionalTask = useCallback((taskData: Parameters<AddTaskModalProps['onSave']>[0]) => {
        const newResource: Omit<StudyResource, 'id' | 'isArchived'> & { id?: string } = {
            title: taskData.title,
            type: taskData.type,
            domain: taskData.domain,
            durationMinutes: taskData.durationMinutes,
            pages: taskData.pages,
            questionCount: taskData.questionCount,
            chapterNumber: taskData.chapterNumber,
            isPrimaryMaterial: false,
            isSplittable: false,
            isOptional: true,
            schedulingPriority: 'medium',
        };
        const newResourceId = `custom_${Date.now()}`;
        setGlobalMasterResourcePool(prev => [...prev, { ...newResource, id: newResourceId, isArchived: false }]);
        
        // Directly add to the day and then rebalance
        if(studyPlan) {
            const newSchedule = studyPlan.schedule.map(day => {
                if(day.date === selectedDate) {
                    const newTask: ScheduledTask = {
                        id: `manual_${newResourceId}`,
                        resourceId: newResourceId,
                        title: newResource.title,
                        type: newResource.type,
                        originalTopic: newResource.domain,
                        durationMinutes: newResource.durationMinutes,
                        status: 'pending',
                        order: day.tasks.length,
                        isOptional: true,
                        pages: newResource.pages,
                        questionCount: newResource.questionCount,
                        chapterNumber: newResource.chapterNumber,
                        originalResourceId: newResourceId,
                        isPrimaryMaterial: newResource.isPrimaryMaterial
                    };
                    return { ...day, tasks: [...day.tasks, newTask], isManuallyModified: true };
                }
                return day;
            });
            setStudyPlan(prev => prev ? ({ ...prev, schedule: newSchedule }) : null);
            handleRebalance();
        }
        
        closeModal('isAddTaskModalOpen');
    }, [closeModal, setGlobalMasterResourcePool, handleRebalance, selectedDate, studyPlan, setStudyPlan]);

    const handleSaveResource = (resourceData: Parameters<ResourceEditorModalProps['onSave']>[0]) => {
        if (resourceData.id) { // Editing existing resource
            setGlobalMasterResourcePool(prev => prev.map(r => r.id === resourceData.id ? { ...r, ...resourceData } as StudyResource : r));
        } else { // Adding new resource
            const newResourceId = `custom_${Date.now()}`;
            setGlobalMasterResourcePool(prev => [...prev, { ...resourceData, id: newResourceId } as StudyResource]);
        }
        closeResourceEditor();
        handleRebalance();
    };
    
    const handleHighlightDatesForResource = useCallback((resourceId: string) => {
        if (!studyPlan) return;
        const dates = studyPlan.schedule.filter(day => day.tasks.some(t => t.resourceId === resourceId)).map(d => d.date);
        setHighlightedDates(dates);
    }, [studyPlan]);

    const handleGoToDateForResource = useCallback((resourceId: string) => {
        if (!studyPlan) return;
        const firstDay = studyPlan.schedule.find(day => day.tasks.some(t => t.resourceId === resourceId));
        if (firstDay) {
            setSelectedDate(firstDay.date);
            setViewMode(ViewMode.DAILY);
        } else {
            alert('This resource is not currently scheduled.');
        }
    }, [studyPlan]);


    if (isLoading) {
        return (
            <div className="w-screen h-screen flex flex-col justify-center items-center bg-gray-900 text-white">
                <i className="fas fa-brain fa-spin fa-3x text-[var(--accent-purple)] mb-4"></i>
                <p className="text-lg">{loadingMessage}</p>
            </div>
        );
    }
    
    if (!studyPlan) {
        return (
            <div className="w-screen h-screen flex flex-col justify-center items-center bg-gray-900 text-white">
                <p>Could not load study plan. Please try refreshing the page.</p>
            </div>
        );
    }

    const SidebarContent = () => (
        <>
            <div className="p-3 md:p-4 space-y-4">
                <PomodoroTimer 
                    settings={pomodoroSettings} 
                    setSettings={setPomodoroSettings} 
                    onSessionComplete={handlePomodoroSessionComplete}
                    linkedTaskTitle={currentPomodoroTask?.title}
                />
                <AdvancedControls 
                    onRebalance={handleRebalance}
                    isLoading={isLoading}
                    selectedDate={selectedDate}
                    isCramModeActive={studyPlan.isCramModeActive || false}
                    onToggleCramMode={handleToggleCramMode}
                    deadlines={studyPlan.deadlines}
                    onUpdateDeadlines={handleUpdateDeadlines}
                    startDate={studyPlan.startDate}
                    endDate={studyPlan.endDate}
                    onUpdateDates={handleUpdatePlanDates}
                />
                <TopicOrderManager 
                    topicOrder={studyPlan.topicOrder}
                    onSaveOrder={handleUpdateTopicOrderAndRebalance}
                    cramTopicOrder={studyPlan.cramTopicOrder}
                    onSaveCramOrder={handleUpdateCramTopicOrderAndRebalance}
                    isLoading={isLoading}
                    isCramModeActive={!!studyPlan.isCramModeActive}
                    areSpecialTopicsInterleaved={!!studyPlan.areSpecialTopicsInterleaved}
                    onToggleSpecialTopicsInterleaving={handleToggleSpecialTopicsInterleaving}
                />
            </div>
        </>
    );

    return (
        <div className="h-screen w-screen bg-gray-900/40 text-[var(--text-primary)] flex flex-col font-sans overflow-hidden antialiased">
            {/* Header */}
            <header className="flex-shrink-0 flex items-center justify-between p-3 border-b border-[var(--separator-primary)] glass-chrome z-20">
                <div className="flex items-center space-x-2">
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="md:hidden p-2 -ml-2 text-xl">
                        <i className="fas fa-bars"></i>
                    </button>
                    <h1 className="text-md sm:text-lg font-bold text-white flex items-center">
                        <i className="fas fa-brain mr-2 text-[var(--accent-purple)]"></i> Radiology Planner
                    </h1>
                </div>
                <div className="hidden sm:flex items-center space-x-1 glass-panel p-1 rounded-lg">
                    <Button onClick={() => setViewMode(ViewMode.DAILY)} variant={viewMode === ViewMode.DAILY ? 'secondary' : 'ghost'} size="sm" className="!px-3 !py-1 !text-xs">Daily</Button>
                    <Button onClick={() => setViewMode(ViewMode.MONTHLY)} variant={viewMode === ViewMode.MONTHLY ? 'secondary' : 'ghost'} size="sm" className="!px-3 !py-1 !text-xs">Calendar</Button>
                    <Button onClick={() => setViewMode('PROGRESS')} variant={viewMode === 'PROGRESS' ? 'secondary' : 'ghost'} size="sm" className="!px-3 !py-1 !text-xs">Progress</Button>
                    <Button onClick={() => setViewMode('RESOURCES')} variant={viewMode === 'RESOURCES' ? 'secondary' : 'ghost'} size="sm" className="!px-3 !py-1 !text-xs">Resources</Button>
                </div>
                <div className="hidden lg:block">
                     <CountdownTimer examDate={EXAM_DATE_START} />
                </div>
            </header>

            {/* Main Content */}
            <div className="flex flex-grow min-h-0">
                {/* Sidebar */}
                 <aside className={`absolute md:static top-0 left-0 h-full z-30 transition-transform transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:w-80 lg:w-96 flex-shrink-0 bg-[var(--background-primary)] border-r border-[var(--separator-primary)] glass-chrome overflow-y-auto no-scrollbar`}>
                    <SidebarContent />
                </aside>
                {isSidebarOpen && <div onClick={() => setIsSidebarOpen(false)} className="absolute inset-0 bg-black/50 z-20 md:hidden"></div>}

                {/* Main View */}
                <main className="flex-grow overflow-y-auto p-3 md:p-4">
                    {viewMode === ViewMode.DAILY && (
                        <DailyTaskList 
                            dailySchedule={dailyScheduleForSelectedDate!}
                            onTaskToggle={(taskId) => handleTaskToggle(taskId, selectedDate)}
                            onOpenAddTaskModal={() => openModal('isAddTaskModalOpen')}
                            onOpenModifyDayModal={() => openModal('isModifyDayTasksModalOpen')}
                            currentPomodoroTaskId={currentPomodoroTaskId}
                            onPomodoroTaskSelect={setCurrentPomodoroTaskId}
                            onNavigateDay={handleNavigateDay}
                            isPomodoroActive={pomodoroSettings.isActive}
                            onToggleRestDay={handleToggleRestDay}
                            onUpdateTimeForDay={handleUpdateTimeForDay}
                            isLoading={isLoading}
                        />
                    )}
                    {(viewMode === ViewMode.WEEKLY || viewMode === ViewMode.MONTHLY) && (
                        <CalendarView 
                            schedule={studyPlan.schedule}
                            selectedDate={selectedDate}
                            onDateSelect={(date) => { setSelectedDate(date); setViewMode(ViewMode.DAILY); }}
                            viewMode={viewMode}
                            currentDisplayDate={selectedDate}
                            onNavigatePeriod={handleNavigateDay} 
                            highlightedDates={highlightedDates}
                            today={today}
                        />
                    )}
                     {viewMode === 'PROGRESS' && (
                        <ProgressDisplay studyPlan={studyPlan} />
                    )}
                    {viewMode === 'RESOURCES' && (
                        <MasterResourcePoolViewer 
                            resources={masterResources}
                            onOpenAddResourceModal={() => openResourceEditor(null)}
                            onEditResource={openResourceEditor}
                            onArchiveResource={handleArchiveResource}
                            onRestoreResource={handleRestoreResource}
                            onPermanentDeleteResource={handlePermanentDeleteResource}
                            scheduledResourceIds={scheduledResourceIds}
                            onGoToDate={handleGoToDateForResource}
                            onHighlightDates={handleHighlightDatesForResource}
                            onClearHighlights={() => setHighlightedDates([])}
                        />
                    )}
                </main>
            </div>
            
             {/* Bottom Nav on Mobile */}
            <nav className="sm:hidden flex-shrink-0 flex items-center justify-around p-2 border-t border-[var(--separator-primary)] glass-chrome pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                <Button onClick={() => setViewMode(ViewMode.DAILY)} variant="ghost" size="sm" className={`flex-col !h-14 ${viewMode === ViewMode.DAILY ? 'text-[var(--accent-purple)]' : 'text-[var(--text-secondary)]'}`}><i className="fas fa-tasks text-lg mb-1"></i><span className="text-xxs">Daily</span></Button>
                <Button onClick={() => setViewMode(ViewMode.MONTHLY)} variant="ghost" size="sm" className={`flex-col !h-14 ${viewMode === ViewMode.MONTHLY ? 'text-[var(--accent-purple)]' : 'text-[var(--text-secondary)]'}`}><i className="fas fa-calendar-alt text-lg mb-1"></i><span className="text-xxs">Calendar</span></Button>
                <Button onClick={() => setViewMode('PROGRESS')} variant="ghost" size="sm" className={`flex-col !h-14 ${viewMode === 'PROGRESS' ? 'text-[var(--accent-purple)]' : 'text-[var(--text-secondary)]'}`}><i className="fas fa-chart-line text-lg mb-1"></i><span className="text-xxs">Progress</span></Button>
                <Button onClick={() => setViewMode('RESOURCES')} variant="ghost" size="sm" className={`flex-col !h-14 ${viewMode === 'RESOURCES' ? 'text-[var(--accent-purple)]' : 'text-[var(--text-secondary)]'}`}><i className="fas fa-book text-lg mb-1"></i><span className="text-xxs">Resources</span></Button>
            </nav>

            {/* Modals */}
            <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => closeModal('isWelcomeModalOpen')} />
            <ConfirmationModal {...modalStates.confirmationState} />
            {studyPlan && (
                <>
                    <AddTaskModal 
                        isOpen={modalStates.isAddTaskModalOpen}
                        onClose={() => closeModal('isAddTaskModalOpen')}
                        onSave={handleAddOptionalTask}
                        availableDomains={studyPlan.topicOrder}
                        selectedDate={selectedDate}
                    />
                    <ModifyDayTasksModal
                        isOpen={modalStates.isModifyDayTasksModalOpen}
                        onClose={() => closeModal('isModifyDayTasksModalOpen')}
                        onSave={(tasks) => handleSaveModifiedDayTasks(tasks, selectedDate)}
                        tasksForDay={dailyScheduleForSelectedDate?.tasks || []}
                        allResources={masterResources}
                        selectedDate={selectedDate}
                        showConfirmation={showConfirmation}
                        onEditResource={openResourceEditor}
                        onArchiveResource={handleArchiveResource}
                        onRestoreResource={handleRestoreResource}
                        onPermanentDeleteResource={handlePermanentDeleteResource}
                        openAddResourceModal={() => openResourceEditor(null)}
                        isCramModeActive={!!studyPlan.isCramModeActive}
                    />
                    <ResourceEditorModal 
                        isOpen={modalStates.isResourceEditorOpen}
                        onClose={closeResourceEditor}
                        onSave={handleSaveResource}
                        onRequestArchive={handleArchiveResource}
                        initialResource={modalData.editingResource}
                        availableDomains={studyPlan.topicOrder}
                        availableResourceTypes={Object.values(ResourceType)}
                    />
                </>
            )}
        </div>
    );
}

export default App;
