import React from 'react';
import { DailySchedule, ScheduledTask } from '../types';
import { parseDateString, formatDuration } from '../utils/timeFormatter';
import { Button } from './Button';
import TaskGroupItem from './TaskGroupItem';
import TaskItem from './TaskItem';

interface DailyTaskListProps {
  day: DailySchedule;
  onToggleTask: (taskId: string) => void;
  onOpenModify: (date: string) => void;
  onReorderTasks?: (date: string, tasks: ScheduledTask[]) => void;
}

type DragState = { fromId: string | null };

const normalizeSource = (t: ScheduledTask) =>
  (t.bookSource || t.videoSource || 'Custom Task').trim();

const DailyTaskList: React.FC<DailyTaskListProps> = ({
  day,
  onToggleTask,
  onOpenModify,
  onReorderTasks,
}) => {
  // Maintain on-screen order for DnD; reset when day changes
  const [ordered, setOrdered] = React.useState<ScheduledTask[]>(day.tasks);
  React.useEffect(() => setOrdered(day.tasks), [day.tasks]);

  // Build grouped view by source, preserving current order
  const groups = React.useMemo(() => {
    const m = new Map<string, ScheduledTask[]>();
    for (const t of ordered) {
      const key = normalizeSource(t);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return m;
  }, [ordered]);

  // Expanded state per source; default expand sources that have tasks
  const initialExpanded = React.useMemo(() => {
    const s = new Set<string>();
    for (const k of groups.keys()) s.add(k);
    return s;
  }, [groups]);

  const [expanded, setExpanded] = React.useState<Set<string>>(initialExpanded);
  React.useEffect(() => setExpanded(initialExpanded), [initialExpanded]);

  const toggleGroup = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Total time for header
  const totalMinutes = React.useMemo(
    () => ordered.reduce((s, t) => s + t.durationMinutes, 0),
    [ordered]
  );

  // Native drag-and-drop across entire day, no style changes
  const dragRef = React.useRef<DragState>({ fromId: null });
  const onTaskDragStart = (id: string) => (dragRef.current.fromId = id);
  const onTaskDragOver = (e: React.DragEvent) => e.preventDefault();
  const onTaskDrop = (targetId: string) => {
    const fromId = dragRef.current.fromId;
    if (!fromId || fromId === targetId) return;
    setOrdered(prev => {
      const next = [...prev];
      const from = next.findIndex(t => t.id === fromId);
      const to = next.findIndex(t => t.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    dragRef.current.fromId = null;
  };

  const persist = () => {
    const reindexed = ordered.map((t, i) => ({ ...t, order: i }));
    onReorderTasks?.(day.date, reindexed);
  };

  // Render a single grouped section (source name, color, tasks)
  const renderGroup = (sourceName: string, tasks: ScheduledTask[]) => {
    const key = sourceName || 'Custom Task';
    const isExpanded = expanded.has(key);
    return (
      <div key={key} className="mb-3">
        <TaskGroupItem
          groupKey={key}
          sourceName={sourceName}
          tasks={tasks}
          isExpanded={isExpanded}
          onToggle={() => toggleGroup(key)}
        />
        {isExpanded && (
          <div id={`task-group-${key}`} className="mt-2 space-y-1.5">
            {tasks.map(task => (
              <div
                key={task.id}
                draggable
                onDragStart={() => onTaskDragStart(task.id)}
                onDragOver={onTaskDragOver}
                onDrop={() => onTaskDrop(task.id)}
              >
                <TaskItem
                  task={task}
                  onToggle={onToggleTask}
                  isCurrentPomodoroTask={false}
                  isPulsing={false}
                  onSetPomodoro={() => {}}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header (unchanged) */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {parseDateString(day.date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          })}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-80">{formatDuration(totalMinutes)}</span>
          <Button size="sm" variant="secondary" onClick={() => onOpenModify(day.date)}>
            <i className="fas fa-edit mr-2" />
            Modify
          </Button>
          {onReorderTasks && (
            <Button size="sm" variant="primary" onClick={persist}>
              <i className="fas fa-save mr-2" />
              Save Order
            </Button>
          )}
        </div>
      </div>

      {/* Grouped by source (original look) */}
      <div>
        {Array.from(groups.entries()).map(([sourceName, tasks]) =>
          renderGroup(sourceName, tasks)
        )}
      </div>
    </div>
  );
};

export default DailyTaskList;
