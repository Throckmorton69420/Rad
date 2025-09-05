import React from 'react';
import { DailySchedule, ScheduledTask, Domain } from '../types';
import TaskItem from './TaskItem';
import { Button } from './Button';
import { formatDuration } from '../utils/timeFormatter';

interface DailyTaskListProps {
  dailySchedule: DailySchedule;
  onTaskToggle: (taskId: string) => void;
  onOpenAddTaskModal: () => void;
  onOpenModifyDayModal: () => void;
  currentPomodoroTaskId: string | null;
  onPomodoroTaskSelect: (taskId: string | null) => void;
  onNavigateDay: (direction: 'next' | 'prev') => void;
  isPomodoroActive: boolean;
  onTaskDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onTaskDragStart: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void;
  onToggleRestDay: (isCurrentlyRestDay: boolean) => void;
}

const DailyTaskList: React.FC<DailyTaskListProps> = ({ 
    dailySchedule, 
    onTaskToggle, 
    onOpenAddTaskModal,
    onOpenModifyDayModal,
    currentPomodoroTaskId,
    onPomodoroTaskSelect,
    onNavigateDay,
    isPomodoroActive,
    onTaskDrop,
    onDragOver,
    onTaskDragStart,
    onToggleRestDay,
}) => {
  if (!dailySchedule) {
    return <div className="text-center text-[var(--text-secondary)] py-10">No schedule for this day.</div>;
  }

  const tasksByTopic: Record<string, ScheduledTask[]> = dailySchedule.tasks.reduce((acc, task) => {
    const topic = task.originalTopic || 'Uncategorized';
    if (!acc[topic]) {
      acc[topic] = [];
    }
    acc[topic].push(task);
    return acc;
  }, {} as Record<string, ScheduledTask[]>);

  const totalAssignedMinutes = dailySchedule.tasks.reduce((acc, t) => acc + t.durationMinutes, 0);
  const completedMinutes = dailySchedule.tasks.filter(t => t.status === 'completed').reduce((acc, t) => acc + t.durationMinutes, 0);
  const progressPercentage = totalAssignedMinutes > 0 ? (completedMinutes / totalAssignedMinutes) * 100 : 0;


  return (
    <div className="relative">
      <div 
        className="pb-24"
        onDrop={onTaskDrop}
        onDragOver={onDragOver}
      >
        <div className="flex justify-between items-center mb-2">
            <Button onClick={() => onNavigateDay('prev')} variant="ghost" size="sm" className="!px-2">
                <i className="fas fa-chevron-left"></i>
            </Button>
            <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] text-center">
                {dailySchedule.dayName || new Date(dailySchedule.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h2>
            <Button onClick={() => onNavigateDay('next')} variant="ghost" size="sm" className="!px-2">
                <i className="fas fa-chevron-right"></i>
            </Button>
        </div>
         <p className="text-sm text-[var(--text-secondary)] font-medium text-center mb-4">
            {dailySchedule.isRestDay ? 'Rest Day' : `Assigned: ${formatDuration(totalAssignedMinutes)}`}
        </p>
        {!dailySchedule.isRestDay && dailySchedule.tasks.length > 0 && (
            <div className="mb-2 mt-6 px-1">
              <div className="flex justify-between text-sm text-[var(--text-secondary)] mb-2">
                  <span>Daily Progress ({Math.round(progressPercentage)}%)</span>
                  <span>{formatDuration(completedMinutes)} / {formatDuration(totalAssignedMinutes)}</span>
              </div>
              <div className="w-full bg-[var(--background-tertiary)] rounded-full h-2.5 progress-bar-track static-glow-border">
                  <div className="progress-bar-fill" style={{ width: `${progressPercentage}%` }}></div>
              </div>
            </div>
        )}

        <div className="space-y-4 mt-4">
          {dailySchedule.isRestDay ? (
            <div className="text-center py-10 bg-[var(--background-tertiary)] rounded-lg">
              <p className="text-lg text-[var(--text-secondary)]">Enjoy your rest day! <i className="fas fa-coffee ml-1"></i></p>
            </div>
          ) : Object.keys(tasksByTopic).length > 0 ? (
            Object.entries(tasksByTopic).map(([topic, tasks]) => (
              <div key={topic}>
                <h3 className="text-md font-semibold text-[var(--text-primary)] mb-2 border-b border-[var(--separator-secondary)] pb-2">{topic}</h3>
                <div className="space-y-2">
                  {tasks.sort((a,b) => a.order - b.order).map(task => (
                    <TaskItem 
                      key={task.id} 
                      task={task} 
                      onToggle={onTaskToggle} 
                      isCurrentPomodoroTask={task.id === currentPomodoroTaskId}
                      isPulsing={isPomodoroActive && task.id === currentPomodoroTaskId}
                      onSetPomodoro={() => onPomodoroTaskSelect(task.id === currentPomodoroTaskId ? null : task.id)}
                      onDragStart={(e) => onTaskDragStart(e, task.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-10 bg-[var(--background-tertiary)] rounded-lg border-2 border-dashed border-[var(--separator-secondary)]">
              <p className="text-[var(--text-secondary)]">Your schedule for this day is empty.</p>
              <p className="text-[var(--text-secondary)] text-sm mt-1">Use the "Modify Schedule" button below to add tasks.</p>
            </div>
          )}
        </div>
      </div>
      
      <div className="sticky bottom-0 -mx-4 px-4 pt-3 bg-[var(--glass-background-panel)] backdrop-blur-[24px] border-t border-t-[var(--separator-primary)] pb-[calc(3rem+env(safe-area-inset-bottom))]">
        <div className="flex space-x-2">
            <Button onClick={onOpenModifyDayModal} variant="primary" className="flex-grow" disabled={dailySchedule.isRestDay}>
              <i className="fas fa-edit mr-2"></i> Modify Schedule
            </Button>
            <Button onClick={onOpenAddTaskModal} variant="secondary" title="Add a quick custom task" disabled={dailySchedule.isRestDay}>
              <i className="fas fa-plus"></i>
            </Button>
            {dailySchedule.isRestDay ? (
              <Button onClick={() => onToggleRestDay(true)} variant="secondary" title="Convert to Study Day" className="!px-3">
                  <i className="fas fa-book-open"></i>
              </Button>
            ) : (
              <Button onClick={() => onToggleRestDay(false)} variant="secondary" title="Convert to Rest Day" className="!px-3">
                  <i className="fas fa-coffee"></i>
              </Button>
            )}
        </div>
      </div>
    </div>
  );
};

export default DailyTaskList;