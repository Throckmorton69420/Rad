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

// Default group order as requested by user
const SOURCE_RANK: Record<string, number> = {
  'Titan Radiology': 1,
  'Crack the Core': 2,
  'Case Companion': 3,
  'Core Radiology': 4,
  'Board Vitals': 5,
  'Huda Text': 6,
  'Huda Gbank': 7,
  'Qevlar': 8,
  'Nuclear Medicine': 9,
  'Discord': 10,
  'NIS / RISC': 11,
  'RadPrimer': 12,
  'Other': 999,
  'Custom Task': 1000,
};

const getSourceRank = (sourceName: string) => SOURCE_RANK[sourceName] ?? 998;

const DailyTaskList: React.FC<DailyTaskListProps> = ({
  day,
  onToggleTask,
  onOpenModify,
  onReorderTasks,
}) => {
  // Maintain on-screen order for DnD; reset whenever tasks change
  const [ordered, setOrdered] = React.useState<ScheduledTask[]>(day.tasks);
  React.useEffect(() => setOrdered(day.tasks), [day.tasks]);

  // Build groups by source; sort groups by preferred rank
  const groups = React.useMemo(() => {
    const m = new Map<string, ScheduledTask[]>();
    for (const t of ordered) {
      const key = normalizeSource(t);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    // sort groups by rank, but keep tasks within group in current order
    const sortedEntries = Array.from(m.entries()).sort((a, b) => getSourceRank(a[0]) - getSourceRank(b[0]));
    return new Map(sortedEntries);
  }, [ordered]);

  // Collapsed by default: start with no expanded groups
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggleGroup = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalMinutes = React.useMemo(
    () => ordered.reduce((s, t) => s + t.durationMinutes, 0),
    [ordered]
  );

  // Native drag-and-drop for tasks across entire day
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
          <div id={`task-group-${key}`} className="mt-2 space-y-1.5 pl-4">
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

      <div>
        {Array.from(groups.entries()).map(([sourceName, tasks]) => renderGroup(sourceName, tasks))}
      </div>
    </div>
  );
};

export default DailyTaskList;