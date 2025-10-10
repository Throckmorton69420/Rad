import React from 'react';
import { ScheduledTask } from '../types';
import { formatDuration, getSourceColorStyle } from '../utils/timeFormatter';

interface TaskGroupItemProps {
  groupKey: string;
  sourceName: string;
  tasks: ScheduledTask[];
  isExpanded: boolean;
  onToggle: () => void;
}

const TaskGroupItem: React.FC<TaskGroupItemProps> = ({ groupKey, sourceName, tasks, isExpanded, onToggle }) => {
  const totalDuration = tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
  const completedCount = tasks.filter(task => task.status === 'completed').length;
  const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
  
  const sourceColorStyle = getSourceColorStyle(sourceName);

  return (
    <div 
      className="p-1.5 rounded-lg transition-all duration-150 relative overflow-hidden cursor-pointer glass-panel glass-panel-interactive"
      onClick={onToggle}
      role="button"
      aria-expanded={isExpanded}
      aria-controls={`task-group-${groupKey}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: sourceColorStyle.backgroundColor }}></div>
      <div className="ml-3.5 flex items-center justify-between">
        <div className="flex-grow min-w-0">
          <h3 className="font-bold text-base text-[var(--text-primary)] truncate" title={sourceName}>
            {sourceName}
          </h3>
          <div className="text-xs text-[var(--text-secondary)] mt-1">
            {tasks.length} tasks &bull; {formatDuration(totalDuration)}
          </div>
        </div>
        <div className="flex items-center space-x-3 flex-shrink-0 ml-2">
           <div className="text-right">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">{completedCount} / {tasks.length}</span>
                <div className="w-16 bg-black/30 rounded-full h-1.5 progress-bar-track mt-1">
                    <div className="progress-bar-fill h-1.5 rounded-full" style={{ width: `${progress}%`, backgroundColor: sourceColorStyle.backgroundColor }}></div>
                </div>
            </div>
          <i className={`fas fa-chevron-down text-[var(--text-secondary)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}></i>
        </div>
      </div>
    </div>
  );
};

export default TaskGroupItem;