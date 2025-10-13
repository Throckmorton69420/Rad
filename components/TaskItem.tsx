import React from 'react';
// FIX: Corrected import path for types.
import { ScheduledTask, Domain, ResourceType, TaskItemProps } from '../types';
import { Button } from './Button';
import { formatDuration } from '../utils/timeFormatter';
import { getDomainColorStyle, getSourceColorStyle } from '../utils/timeFormatter';

const getTypeColorDark = (type: ResourceType): string => {
    let hash = 0;
    for (let i = 0; i < type.length; i++) hash = type.charCodeAt(i) + ((hash << 3) - hash);
    return `hsl(${(hash % 360 + 60) % 360}, 50%, 40%)`; 
};

const TaskItem: React.FC<TaskItemProps> = ({ task, onToggle, isCurrentPomodoroTask, isPulsing, onSetPomodoro }) => {
  const isCompleted = task.status === 'completed';
  const sourceColorStyle = getSourceColorStyle(task.bookSource || task.videoSource);
  
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
  
  const containerClasses = [
    'p-1.5', 'rounded-lg', 'transition-all', 'duration-150', 'relative',
    'overflow-hidden', 'cursor-pointer', 'glass-panel', 'glass-panel-interactive',
    isCompleted ? 'opacity-60' : 'opacity-100',
    isCurrentPomodoroTask ? 'is-pomodoro-active' : ''
  ].filter(Boolean).join(' ');


  return (
    <div 
        onClick={() => onToggle(task.id)}
        className={containerClasses}
        role="group"
        aria-label={`Task: ${displayTitle}. Status is ${isCompleted ? 'completed' : 'pending'}. Click to toggle.`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: sourceColorStyle.backgroundColor }} title={task.bookSource || task.videoSource || 'Custom Task'}></div>
      <div className="ml-2">
        <div className="flex items-start">
          <button 
            onClick={(e) => { e.stopPropagation(); onToggle(task.id); }} 
            className="mr-2 ml-1 flex-shrink-0 cursor-pointer h-6 w-6 rounded-full flex items-center justify-center mt-1"
            aria-label={isCompleted ? "Mark task as pending" : "Mark task as complete"}
          >
            {isCompleted ? <i className="fas fa-check-circle text-[var(--accent-green)] text-2xl"></i> : <i className="far fa-circle text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-2xl"></i>}
          </button>

          <div className="flex-grow min-w-0 flex flex-col items-start">
            <h4 className={`text-base font-semibold ${titleColor} ${isCompleted ? 'line-through' : ''} leading-snug`} title={displayTitle}>
              {displayTitle}
            </h4>
            {(task.bookSource || task.videoSource) && (
              <span 
                  className="text-xs font-semibold px-2 py-0.5 rounded-md mt-1 max-w-full truncate"
                  style={{ backgroundColor: sourceColorStyle.backgroundColor, color: sourceColorStyle.color }}
                  title={task.bookSource || task.videoSource}
              >
                  {task.bookSource || task.videoSource}
              </span>
            )}
          </div>

          <div className="flex flex-col items-end justify-start ml-2 flex-shrink-0 min-w-[70px]">
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
        
        <div className="pl-9 mt-1.5 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs">
            <span 
                className="text-xxs px-2 py-0.5 rounded-full font-semibold"
                style={getDomainColorStyle(task.originalTopic)}
            >
                {task.originalTopic}
            </span>
            <span 
                className="text-xxs px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: getTypeColorDark(task.type), color: '#fff' }}
            >
                {task.type}
            </span>
            {task.isOptional && (
                <span className="text-xxs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'var(--separator-primary)', color: 'var(--text-primary)'}}>
                    OPTIONAL
                </span>
            )}
            {(task.pages || 0) > 0 && 
                <span className="flex items-center text-xxs text-[var(--text-secondary)]"><PageReferenceText /></span>
            }
            {task.questionCount !== undefined && <span className="flex items-center text-xxs text-[var(--text-secondary)]"><i className="fas fa-question-circle mr-1 opacity-70"></i>{task.questionCount} q's</span>}
        </div>
      </div>
    </div>
  );
};

export default TaskItem;
