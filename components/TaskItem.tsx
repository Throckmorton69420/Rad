import React from 'react';
import { ScheduledTask, Domain, ResourceType, TaskItemProps } from '../types';
import { Button } from './Button';
import { formatDuration } from '../utils/timeFormatter';

const getDomainColorDark = (domain: Domain): string => {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${hash % 360}, 65%, 45%)`; 
};

const getTypeColorDark = (type: ResourceType): string => {
    let hash = 0;
    for (let i = 0; i < type.length; i++) hash = type.charCodeAt(i) + ((hash << 3) - hash);
    return `hsl(${(hash % 360 + 60) % 360}, 50%, 40%)`; 
};

const TaskItem: React.FC<TaskItemProps> = ({ task, onToggle, isCurrentPomodoroTask, isPulsing, onSetPomodoro, onDragStart }) => {
  const isCompleted = task.status === 'completed';
  const baseBg = isCurrentPomodoroTask ? 'bg-[var(--glass-background-active)]' : 'bg-[var(--background-tertiary)]';
  const taskBgColor = isCompleted ? baseBg : `${baseBg} hover:bg-[var(--background-tertiary-hover)]`;
  const taskOpacity = isCompleted ? 'opacity-60' : 'opacity-100';
  
  const cleanTitleForDisplay = (title: string, taskType: ResourceType) => {
    if (taskType === ResourceType.QUESTIONS || taskType === ResourceType.QUESTION_REVIEW) {
      return title;
    }
    const parts = title.split(' - ');
    if (parts.length > 1) return parts[parts.length -1];
    return title;
  }
  
  let displayTitle = cleanTitleForDisplay(task.title, task.type);
  if (task.chapterNumber) {
    displayTitle = `Ch. ${task.chapterNumber}: ${displayTitle}`;
  }
  if (task.isSplitPart && task.partNumber && task.totalParts) {
    displayTitle += ` (Part ${task.partNumber}/${task.totalParts})`;
  }
  
  const titleColor = 'text-[var(--text-primary)]';

  const PageReferenceText: React.FC = () => {
    if (task.pages !== undefined && task.pages > 0) {
      if (task.startPage && task.endPage && task.startPage !== task.endPage) {
        return <><i className="fas fa-file-alt mr-1 opacity-70"></i>pp. {task.startPage}-{task.endPage} ({task.pages})</>;
      }
      return <><i className="fas fa-file-alt mr-1 opacity-70"></i>{task.pages} pages</>;
    }
    return null;
  };

  return (
    <div 
        className={`p-1.5 rounded-lg shadow-sm transition-all duration-150 relative ${taskBgColor} ${taskOpacity} interactive-glow-border backdrop-blur-lg`}
        onDragStart={onDragStart}
        draggable={!isCompleted}
        role="group"
    >
      <div className="flex items-center">
        <button 
          onClick={() => onToggle(task.id)} 
          className="mr-2 ml-1 flex-shrink-0 cursor-pointer h-6 w-6 rounded-full flex items-center justify-center"
          aria-label={isCompleted ? "Mark task as pending" : "Mark task as complete"}
        >
          {isCompleted ? <i className="fas fa-check-circle text-[var(--accent-green)] text-2xl"></i> : <i className="far fa-circle text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-2xl"></i>}
        </button>

        <div className="group relative flex-grow min-w-0 cursor-pointer" onClick={() => !isCompleted && onToggle(task.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') onToggle(task.id)}}>
          <h4 className={`text-sm font-semibold ${titleColor} truncate ${isCompleted ? 'line-through' : ''} leading-snug`} title={displayTitle}>
            {displayTitle}
          </h4>
          {(task.bookSource || task.videoSource) && (
            <p className="text-xs text-[var(--text-secondary)] truncate leading-snug" title={task.bookSource || task.videoSource}>
              {task.bookSource || task.videoSource}
            </p>
          )}
          <div className="task-tooltip pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="font-semibold">{displayTitle}</div>
            {(task.bookSource || task.videoSource) && <div className="text-sm text-[var(--text-secondary)]">{task.bookSource || task.videoSource}</div>}
          </div>
        </div>

        <div className="flex flex-col items-end justify-center ml-2 flex-shrink-0 min-w-[70px]">
          <div className="text-sm text-[var(--text-primary)] font-medium">
             {(task.actualStudyTimeMinutes !== undefined && task.actualStudyTimeMinutes > 0) ? (
                  <span className="text-[var(--accent-green)]" title={`Logged: ${formatDuration(task.actualStudyTimeMinutes)}`}>{formatDuration(task.durationMinutes)}</span>
              ) : (
                  <span>{formatDuration(task.durationMinutes)}</span>
              )}
          </div>
          <Button 
            onClick={(e) => { e.stopPropagation(); onSetPomodoro(); }} 
            variant={isCurrentPomodoroTask ? "primary" : "ghost"} 
            size="sm"
            className={`!text-xxs !py-0.5 !px-1.5 mt-1`}
            disabled={isCompleted}
            title="Set Pomodoro Timer for this task"
          >
            <i className="fas fa-stopwatch mr-1"></i> Set
          </Button>
        </div>
      </div>
      
      <div className="pl-9 mt-1.5 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-white">
          <span 
              className="text-xxs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: getDomainColorDark(task.originalTopic) }}
          >
              {task.originalTopic}
          </span>
          <span 
              className="text-xxs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: getTypeColorDark(task.type) }}
          >
              {task.type}
          </span>
           {(task.pages || 0) > 0 && 
              <span className="flex items-center text-xxs text-[var(--text-secondary)]"><PageReferenceText /></span>
           }
          {task.questionCount !== undefined && <span className="flex items-center text-xxs text-[var(--text-secondary)]"><i className="fas fa-question-circle mr-1 opacity-70"></i>{task.questionCount} q's</span>}
      </div>
    </div>
  );
};

export default TaskItem;