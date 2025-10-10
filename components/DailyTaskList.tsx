import React, { useState, useEffect, useMemo } from 'react';
import { DailyTaskListProps, ScheduledTask } from '../types';
import { Button } from './Button';
import TaskItem from './TaskItem';
import TaskGroupItem from './TaskGroupItem';
import { formatDuration } from '../utils/timeFormatter';
import TimeInputScroller from './TimeInputScroller';
import { parseDateString } from '../utils/timeFormatter';

const DailyTaskList: React.FC<DailyTaskListProps> = ({
  dailySchedule,
  onTaskToggle,
  onOpenAddTaskModal,
  onOpenModifyDayModal,
  currentPomodoroTaskId,
  onPomodoroTaskSelect,
  onNavigateDay,
  isPomodoroActive,
  onToggleRestDay,
  onUpdateTimeForDay,
  isLoading
}) => {
  const [pulsingTaskId, setPulsingTaskId] = useState<string | null>(null);
  const [isTimeEditorOpen, setIsTimeEditorOpen] = useState(false);
  const [editedTime, setEditedTime] = useState(dailySchedule.totalStudyTimeMinutes);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const { date, tasks, totalStudyTimeMinutes, isRestDay, dayName } = dailySchedule;
  const displayDate = parseDateString(date);

  useEffect(() => {
    setEditedTime(dailySchedule.totalStudyTimeMinutes);
    setIsTimeEditorOpen(false);
  }, [date, dailySchedule.totalStudyTimeMinutes]);

  const handleSetPomodoro = (task: ScheduledTask) => {
    onPomodoroTaskSelect(task.id);
    setPulsingTaskId(task.id);
    setTimeout(() => setPulsingTaskId(null), 1000);
  };

  const handleSaveTime = () => {
    onUpdateTimeForDay(editedTime);
    setIsTimeEditorOpen(false);
  };
  
  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const groupedAndSortedTasks = useMemo(() => {
    const sortedTasks = [...tasks].sort((a, b) => a.order - b.order);
    const result: (ScheduledTask | { isGroup: true; id: string; source: string; tasks: ScheduledTask[] })[] = [];
    let i = 0;
    while (i < sortedTasks.length) {
      const task = sortedTasks[i];
      const source = task.bookSource || task.videoSource;
      if (source) {
        let group: ScheduledTask[] = [task];
        let j = i + 1;
        while (j < sortedTasks.length && (sortedTasks[j].bookSource || sortedTasks[j].videoSource) === source) {
          group.push(sortedTasks[j]);
          j++;
        }
        if (group.length >= 3) {
          result.push({ isGroup: true, id: `${date}-${source}`, source, tasks: group });
          i = j;
          continue;
        }
      }
      result.push(task);
      i++;
    }
    return result;
  }, [tasks, date]);

  return (
    <div className="relative flex flex-col">
      <div className="flex-shrink-0">
        <div className="flex justify-between items-center mb-1">
          <Button onClick={() => onNavigateDay('prev')} variant="ghost" size="sm" className="!px-2.5" aria-label="Previous Day"><i className="fas fa-chevron-left"></i></Button>
          <div className="text-center">
            <h2 className="text-xl font-bold text-white">{dayName ? displayDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : '...'}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{displayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>
          </div>
          <Button onClick={() => onNavigateDay('next')} variant="ghost" size="sm" className="!px-2.5" aria-label="Next Day"><i className="fas fa-chevron-right"></i></Button>
        </div>
        
        <div className="mt-4 mb-4 p-3 glass-panel rounded-lg">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Total Planned Time</p>
              <p className="text-lg font-bold text-white">{formatDuration(totalStudyTimeMinutes)}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setIsTimeEditorOpen(!isTimeEditorOpen)}>
              <i className="fas fa-clock mr-2"></i> Adjust
            </Button>
          </div>
          {isTimeEditorOpen && (
            <div className="mt-3 pt-3 border-t border-[var(--separator-secondary)] space-y-3">
              <TimeInputScroller valueInMinutes={editedTime} onChange={setEditedTime} maxHours={14} disabled={isLoading} />
              <div className="flex justify-end space-x-2">
                <Button variant="secondary" size="sm" onClick={() => { setIsTimeEditorOpen(false); setEditedTime(totalStudyTimeMinutes); }}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSaveTime} disabled={isLoading || editedTime === totalStudyTimeMinutes}>
                  Save & Rebalance
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex-grow">
        <div className="flex-grow min-h-[200px] transition-colors p-1 rounded-lg pb-32">
          {isRestDay ? (
            <div className="h-full flex flex-col justify-center items-center text-center p-6 glass-panel rounded-lg">
              <i className="fas fa-coffee fa-2x text-[var(--text-secondary)] mb-3"></i>
              <p className="text-lg font-semibold">Rest Day</p>
              <p className="text-sm text-[var(--text-secondary)] mb-4">Take a well-deserved break!</p>
              <Button onClick={() => onToggleRestDay(true)} variant="secondary" size="sm">Make it a Study Day</Button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-center text-center p-6 glass-panel rounded-lg">
              <i className="fas fa-calendar-check fa-2x text-[var(--text-secondary)] mb-3"></i>
              <p className="text-lg font-semibold">No Tasks Scheduled</p>
              <p className="text-sm text-[var(--text-secondary)] mb-4">You can add optional tasks or rebalance your schedule.</p>
               <Button onClick={onOpenAddTaskModal} variant="secondary" size="sm" className="mb-2"><i className="fas fa-plus mr-2"></i> Add Optional Task</Button>
              <Button onClick={() => onToggleRestDay(false)} variant="secondary" size="sm">Make it a Rest Day</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {groupedAndSortedTasks.map((item, index) => {
                if ('isGroup' in item) {
                  const isExpanded = !!expandedGroups[item.id];
                  return (
                    <div key={item.id}>
                      <TaskGroupItem 
                        groupKey={item.id}
                        sourceName={item.source} 
                        tasks={item.tasks}
                        isExpanded={isExpanded}
                        onToggle={() => toggleGroup(item.id)}
                      />
                      {isExpanded && (
                        <div className="pl-4 border-l-2 border-[var(--separator-primary)] ml-3 space-y-2 pt-2">
                          {item.tasks.map(task => (
                            <TaskItem
                              key={task.id}
                              task={task}
                              onToggle={onTaskToggle}
                              isCurrentPomodoroTask={currentPomodoroTaskId === task.id}
                              isPulsing={pulsingTaskId === task.id && !isPomodoroActive}
                              onSetPomodoro={() => handleSetPomodoro(task)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <TaskItem
                    key={item.id}
                    task={item}
                    onToggle={onTaskToggle}
                    isCurrentPomodoroTask={currentPomodoroTaskId === item.id}
                    isPulsing={pulsingTaskId === item.id && !isPomodoroActive}
                    onSetPomodoro={() => handleSetPomodoro(item)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 pt-3 glass-chrome pb-[calc(1rem+env(safe-area-inset-bottom))]">
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