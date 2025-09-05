import React, { useState } from 'react';
import { DailyTaskListProps, ScheduledTask } from '../types';
import { Button } from './Button';
import TaskItem from './TaskItem';
import { formatDuration } from '../utils/timeFormatter';

const DailyTaskList: React.FC<DailyTaskListProps> = ({
  dailySchedule,
  onTaskToggle,
  onOpenAddTaskModal,
  onOpenModifyDayModal,
  currentPomodoroTaskId,
  onPomodoroTaskSelect,
  onNavigateDay,
  isPomodoroActive,
  onDragOver,
  onTaskDrop,
  onTaskDragStart,
  onToggleRestDay
}) => {
  const [draggedOver, setDraggedOver] = useState(false);
  const [pulsingTaskId, setPulsingTaskId] = useState<string | null>(null);

  const { date, tasks, totalStudyTimeMinutes, isRestDay, dayName } = dailySchedule;

  const totalCompletedMinutes = tasks.reduce((acc, task) => {
    return task.status === 'completed' ? acc + task.durationMinutes : acc;
  }, 0);

  const handleSetPomodoro = (task: ScheduledTask) => {
    onPomodoroTaskSelect(task.id);
    setPulsingTaskId(task.id);
    setTimeout(() => setPulsingTaskId(null), 1000);
  };
  
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggedOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggedOver(false);
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    onTaskDrop(e);
    setDraggedOver(false);
  };

  const dropZoneClasses = `flex-grow min-h-[200px] transition-colors p-1 rounded-lg ${draggedOver ? 'bg-purple-900/40' : ''}`;

  return (
    <div className="relative flex flex-col h-full text-[var(--text-primary)]">
      <div className="flex-shrink-0">
        <div className="flex justify-between items-center mb-1">
          <Button onClick={() => onNavigateDay('prev')} variant="ghost" size="sm" className="!px-2.5" aria-label="Previous Day"><i className="fas fa-chevron-left"></i></Button>
          <div className="text-center">
            <h2 className="text-xl font-bold text-white">{dayName ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : '...'}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <Button onClick={() => onNavigateDay('next')} variant="ghost" size="sm" className="!px-2.5" aria-label="Next Day"><i className="fas fa-chevron-right"></i></Button>
        </div>
        <div className="text-center text-xs text-[var(--text-secondary)] mb-4">
          <span>Total Planned: <strong className="text-[var(--text-primary)]">{formatDuration(totalStudyTimeMinutes)}</strong></span>
          <span className="mx-2">|</span>
          <span>Completed: <strong className="text-[var(--accent-green)]">{formatDuration(totalCompletedMinutes)}</strong></span>
        </div>
      </div>
      
      <div className="flex-grow">
        <div 
          className={`${dropZoneClasses} pb-32`}
          onDragOver={onDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isRestDay ? (
            <div className="h-full flex flex-col justify-center items-center text-center p-6 bg-[var(--background-tertiary)] rounded-lg interactive-glow-border">
              <i className="fas fa-coffee fa-2x text-[var(--text-secondary)] mb-3"></i>
              <p className="text-lg font-semibold">Rest Day</p>
              <p className="text-sm text-[var(--text-secondary)] mb-4">Take a well-deserved break!</p>
              <Button onClick={() => onToggleRestDay(true)} variant="secondary" size="sm">Make it a Study Day</Button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-center text-center p-6 bg-[var(--background-tertiary)] rounded-lg interactive-glow-border">
              <i className="fas fa-calendar-check fa-2x text-[var(--text-secondary)] mb-3"></i>
              <p className="text-lg font-semibold">No Tasks Scheduled</p>
              <p className="text-sm text-[var(--text-secondary)] mb-4">You can add optional tasks or rebalance your schedule.</p>
               <Button onClick={onOpenAddTaskModal} variant="secondary" size="sm" className="mb-2"><i className="fas fa-plus mr-2"></i> Add Optional Task</Button>
              <Button onClick={() => onToggleRestDay(false)} variant="secondary" size="sm">Make it a Rest Day</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.sort((a, b) => a.order - b.order).map(task => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onToggle={onTaskToggle}
                  isCurrentPomodoroTask={currentPomodoroTaskId === task.id}
                  isPulsing={pulsingTaskId === task.id && !isPomodoroActive}
                  onSetPomodoro={() => handleSetPomodoro(task)}
                  onDragStart={(e) => onTaskDragStart(e, task.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 px-4 pt-3 bg-[var(--glass-background-panel)] backdrop-blur-[24px] border-t border-[var(--separator-primary)] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex space-x-2">
          <Button onClick={onOpenModifyDayModal} variant="primary" className="flex-grow">
            <i className="fas fa-edit mr-2"></i> Modify Schedule
          </Button>
          <Button onClick={onOpenAddTaskModal} variant="secondary" title="Add a quick custom task"><i className="fas fa-plus"></i></Button>
          <Button onClick={() => onToggleRestDay(false)} variant="secondary" title="Convert to Rest Day"><i className="fas fa-coffee"></i></Button>
        </div>
      </div>
    </div>
  );
};

export default DailyTaskList;