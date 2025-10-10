import React, { useState, useMemo, useEffect } from 'react';
import { useStudyPlanManager } from './hooks/useStudyPlanManager';
import { useModalManager } from './hooks/useModalManager';
import { getTodayInNewYork, parseDateString } from './utils/timeFormatter';
import { ViewMode, ScheduledTask, StudyResource, Domain, ResourceType } from './types';

// Import Components
import DailyTaskList from './components/DailyTaskList';
import CalendarView from './components/CalendarView';
import PomodoroTimer from './components/PomodoroTimer';
import ProgressDisplay from './components/ProgressDisplay';
import AdvancedControls from './components/AdvancedControls';
import TopicOrderManager from './components/TopicOrderManager';
import AddTaskModal from './components/AddTaskModal';
import ModifyDayTasksModal from './components/ModifyDayTasksModal';
import ResourceEditorModal from './components/AddGlobalResourceModal';
import WelcomeModal from './components/WelcomeModal';
import ConfirmationModal from './components/ConfirmationModal';
import MasterResourcePoolViewer from './components/MasterResourcePoolViewer';
import AddExceptionDay from './components/AddExceptionDay';
import CountdownTimer from './components/CountdownTimer';
import { EXAM_DATE_START, ALL_DOMAINS } from './constants';
import { Button } from './components/Button';

const App: React.FC = () => {
    const {
        studyPlan,
        masterResources,
        isLoading,
        loadingMessage,
        pomodoroSettings,
        setPomodoroSettings,
        currentPomodoroTaskId,
        handleTaskToggle,
        handlePomodoroSessionComplete,
        handlePomodoroTaskSelect,
        handleRebalance,
        handleAddTask,
        handleModifyDayTasks,
        handleSaveTopicOrder,
        handleToggleCramMode,
        handleUpdateDeadlines,
        handleUpdateDates,
        handleToggleSpecialTopicsInterleaving,
        handleSaveResource,
        handleArchiveResource,
        handleRestoreResource,
        handlePermanentDeleteResource,
        handleToggleRestDay,
        handleUpdateTimeForDay,
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

    const today = useMemo(() => getTodayInNewYork(), []);
    const [selectedDate, setSelectedDate] = useState<string>(today);
    const [currentView, setCurrentView] = useState<'schedule' | 'progress' | 'resources'>('schedule');
    const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
    
    const [calendarDisplayDate, setCalendarDisplayDate] = useState(selectedDate);
    
    useEffect(() => {
        if (!modalStates.isWelcomeModalOpen && !localStorage.getItem('hasSeenWelcome')) {
            openModal('isWelcomeModalOpen');
            localStorage.setItem('hasSeenWelcome', 'true');
        }
    }, [modalStates.isWelcomeModalOpen, openModal]);
    
    const dailyScheduleForSelectedDate = useMemo(() => {
        return studyPlan?.schedule.find(d => d.date === selectedDate) || null;
    }, [studyPlan, selectedDate]);

    const linkedPomodoroTask = useMemo(() => {
        if (!currentPomodoroTaskId || !studyPlan) return null;
        for (const day of studyPlan.schedule) {
            const task = day.tasks.find(t => t.id === currentPomodoroTaskId);
            if (task) return task;
        }
        return null;
    }, [currentPomodoroTaskId, studyPlan]);

    const navigateDay = (direction: 'next' | 'prev') => {
        if (!studyPlan) return;
        const currentDateIndex = studyPlan.schedule.findIndex(d => d.date === selectedDate);
        if (currentDateIndex === -1) return;

        const newIndex = direction === 'next' ? currentDateIndex + 1 : currentDateIndex - 1;
        if (newIndex >= 0 && newIndex < studyPlan.schedule.length) {
            const newDate = studyPlan.schedule[newIndex].date;
            setSelectedDate(newDate);
            setCalendarDisplayDate(newDate);
        }
    };
    
    const navigatePeriod = (direction: 'next' | 'prev') => {
        const d = parseDateString(calendarDisplayDate);
        d.setUTCMonth(d.getUTCMonth() + (direction === 'next' ? 1 : -1));
        setCalendarDisplayDate(d.toISOString().split('T')[0]);
    };

    const handleGoToDateForResource = (resourceId: string) => {
        const firstOccurrence = studyPlan?.schedule.find(day => day.tasks.some(t => t.resourceId === resourceId));
        if (firstOccurrence) {
            setSelectedDate(firstOccurrence.date);
            setCalendarDisplayDate(firstOccurrence.date);
            setCurrentView('schedule');
        } else {
            showConfirmation({ title: 'Not Scheduled', message: 'This resource is not currently in the schedule.', onConfirm: () => {} });
        }
    };

    const handleHighlightDatesForResource = (resourceId: string) => {
        if (!studyPlan) return;
        const dates = studyPlan.schedule.filter(day => day.tasks.some(t => t.resourceId === resourceId)).map(day => day.date);
        setHighlightedDates(dates);
    };

    if (isLoading || !studyPlan) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-[var(--background-primary)] text-white">
                <div className="loader"></div>
                <p className="mt-4 text-lg font-semibold animate-pulse">{loadingMessage}</p>
            </div>
        );
    }
    
    const allResourceTypes = useMemo(() => Array.from(new Set(masterResources.map(r => r.type))), [masterResources]);
    const scheduledResourceIds = useMemo(() => new Set(studyPlan.schedule.flatMap(day => day.tasks.map(task => task.resourceId))), [studyPlan.schedule]);
    
    // FIX: Added a valid JSX return to the function component, resolving the type error.
    return (
        <>
            <main className="min-h-screen bg-[var(--background-primary)] text-[var(--text-primary)] font-sans antialiased relative">
                <div className="container mx-auto p-2 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    {/* Left Sidebar */}
                    <aside className="lg:col-span-4 space-y-4 sticky top-4">
                         <div className="flex justify-between items-center">
                            <h1 className="text-xl font-bold">Radiology Planner</h1>
                             <CountdownTimer examDate={EXAM_DATE_START} />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                             <Button onClick={() => setCurrentView('schedule')} variant={currentView === 'schedule' ? 'primary' : 'secondary'} size="sm">Schedule</Button>
                             <Button onClick={() => setCurrentView('progress')} variant={currentView === 'progress' ? 'primary' : 'secondary'} size="sm">Progress</Button>
                             <Button onClick={() => setCurrentView('resources')} variant={currentView === 'resources' ? 'primary' : 'secondary'} size="sm">Resources</Button>
                        </div>
                        {currentView === 'schedule' && (
                             <CalendarView
                                schedule={studyPlan.schedule}
                                selectedDate={selectedDate}
                                onDateSelect={(date) => {setSelectedDate(date); setCalendarDisplayDate(date);}}
                                viewMode={ViewMode.MONTHLY}
                                currentDisplayDate={calendarDisplayDate}
                                onNavigatePeriod={navigatePeriod}
                                highlightedDates={highlightedDates}
                                today={today}
                            />
                        )}
                         <PomodoroTimer
                            settings={pomodoroSettings}
                            setSettings={setPomodoroSettings}
                            onSessionComplete={handlePomodoroSessionComplete}
                            linkedTaskTitle={linkedPomodoroTask?.title}
                        />
                         {currentView !== 'schedule' && currentView !== 'progress' && (
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
                                onUpdateDates={handleUpdateDates}
                            />
                         )}
                         {currentView === 'progress' && <TopicOrderManager
                            topicOrder={studyPlan.topicOrder}
                            onSaveOrder={handleSaveTopicOrder}
                            cramTopicOrder={studyPlan.cramTopicOrder}
                            onSaveCramOrder={(newOrder) => {
                                // This logic could be moved to the hook if it grows
                                setStudyPlan(p => p ? {...p, cramTopicOrder: newOrder} : null);
                                handleRebalance({type: 'standard'});
                            }}
                            isLoading={isLoading}
                            isCramModeActive={studyPlan.isCramModeActive || false}
                            areSpecialTopicsInterleaved={studyPlan.areSpecialTopicsInterleaved}
                            onToggleSpecialTopicsInterleaving={handleToggleSpecialTopicsInterleaving}
                         />}
                    </aside>

                    {/* Main Content */}
                    <section className="lg:col-span-8">
                        {currentView === 'schedule' && (
                            <DailyTaskList
                                dailySchedule={dailyScheduleForSelectedDate!}
                                onTaskToggle={handleTaskToggle}
                                onOpenAddTaskModal={() => openModal('isAddTaskModalOpen')}
                                onOpenModifyDayModal={() => openModal('isModifyDayTasksModalOpen')}
                                currentPomodoroTaskId={currentPomodoroTaskId}
                                onPomodoroTaskSelect={handlePomodoroTaskSelect}
                                onNavigateDay={navigateDay}
                                isPomodoroActive={pomodoroSettings.isActive}
                                onToggleRestDay={(isRest) => handleToggleRestDay(selectedDate, isRest)}
                                onUpdateTimeForDay={(mins) => handleUpdateTimeForDay(selectedDate, mins)}
                                isLoading={isLoading}
                            />
                        )}
                        {currentView === 'progress' && (
                            <ProgressDisplay studyPlan={studyPlan} />
                        )}
                        {currentView === 'resources' && (
                           <MasterResourcePoolViewer 
                                resources={masterResources}
                                onOpenAddResourceModal={() => openResourceEditor(null)}
                                onEditResource={(res) => openResourceEditor(res)}
                                onArchiveResource={(id) => showConfirmation({ title: 'Archive Resource?', message: 'Archiving will remove this from future scheduling unless restored.', onConfirm: () => handleArchiveResource(id), confirmVariant: 'danger', confirmText: 'Archive' })}
                                onRestoreResource={handleRestoreResource}
                                onPermanentDeleteResource={(id) => showConfirmation({ title: 'Delete Resource?', message: 'This is permanent and cannot be undone.', onConfirm: () => handlePermanentDeleteResource(id), confirmVariant: 'danger', confirmText: 'Delete' })}
                                scheduledResourceIds={scheduledResourceIds}
                                onGoToDate={handleGoToDateForResource}
                                onHighlightDates={handleHighlightDatesForResource}
                                onClearHighlights={() => setHighlightedDates([])}
                           />
                        )}
                    </section>
                </div>
            </main>
            
            {/* Modals */}
             <WelcomeModal isOpen={modalStates.isWelcomeModalOpen} onClose={() => closeModal('isWelcomeModalOpen')} />
            <AddTaskModal 
                isOpen={modalStates.isAddTaskModalOpen}
                onClose={() => closeModal('isAddTaskModalOpen')}
                onSave={(taskData) => {
                    handleAddTask(taskData, selectedDate);
                    closeModal('isAddTaskModalOpen');
                }}
                availableDomains={ALL_DOMAINS}
                selectedDate={selectedDate}
            />
             <ModifyDayTasksModal
                isOpen={modalStates.isModifyDayTasksModalOpen}
                onClose={() => closeModal('isModifyDayTasksModalOpen')}
                onSave={(tasks) => {
                    handleModifyDayTasks(selectedDate, tasks);
                    closeModal('isModifyDayTasksModalOpen');
                }}
                tasksForDay={dailyScheduleForSelectedDate?.tasks || []}
                allResources={masterResources}
                selectedDate={selectedDate}
                showConfirmation={showConfirmation}
                onEditResource={(res) => openResourceEditor(res)}
                onArchiveResource={handleArchiveResource}
                onRestoreResource={handleRestoreResource}
                onPermanentDeleteResource={handlePermanentDeleteResource}
                openAddResourceModal={() => openResourceEditor(null)}
                isCramModeActive={studyPlan.isCramModeActive || false}
            />
            <ResourceEditorModal 
                isOpen={modalStates.isResourceEditorOpen}
                onClose={closeResourceEditor}
                onSave={(resData) => {
                    handleSaveResource(resData);
                    closeResourceEditor();
                }}
                onRequestArchive={(id) => showConfirmation({ title: 'Archive Resource?', message: 'Are you sure you want to archive this resource?', onConfirm: () => { handleArchiveResource(id); closeResourceEditor(); }, confirmVariant: 'danger', confirmText: 'Archive' })}
                initialResource={modalData.editingResource}
                availableDomains={ALL_DOMAINS}
                availableResourceTypes={allResourceTypes}
            />
            <ConfirmationModal {...modalStates.confirmationState} />
        </>
    );
};

export default App;
