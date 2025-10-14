import React from 'react';
import { DailySchedule, ScheduledTask } from '../types';
import { parseDateString, formatDuration } from '../utils/timeFormatter';
import { Button } from './Button';
import TaskGroupItem from './TaskGroupItem';
import TaskItem from './TaskItem';
import { getCategoryRankFromTask, CATEGORY_LABEL } from '../utils/taskPriority';

interface DailyTaskListProps {
  day: DailySchedule;
  onToggleTask: (taskId: string) => void;
  onOpenModify: (date: string) => void;
  onReorderTasks?: (date: string, tasks: ScheduledTask[]) => void;
}

type DragState = { fromId: string | null };

const DailyTaskList: React.FC<DailyTaskListProps> = ({
  day,
  onToggleTask,
  onOpenModify,
  onReorderTasks,
}) => {
  // Preserve the exact on-screen order locally for DnD; reset when day.tasks changes
  const [ordered, setOrdered] = React.useState<ScheduledTask[]>(day.tasks);
  React.useEffect(() => setOrdered(day.tasks), [day.tasks]);

  // Compute total minutes for header
  const totalMinutes = React.useMemo(
    () => ordered.reduce((sum, t) => sum + t.durationMinutes, 0),
    [ordered]
  );

  // Group by your 12-tier categories, but keep the user’s current order
  const groups = React.useMemo(() => {
    const byCat = new Map<number, ScheduledTask[]>();
    for (const t of ordered) {
      const cat = getCategoryRankFromTask(t) || 12;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(t);
    }
    return byCat;
  }, [ordered]);

  // Track which groups are expanded; default: groups that have tasks are expanded
  const initialExpanded = React.useMemo(() => {
    const exp = new Set<number>();
    for (let cat = 1; cat <= 12; cat++) {
      if ((groups.get(cat) ?? []).length > 0) exp.add(cat);
    }
    return exp;
  }, [groups]);

  const [expandedCats, setExpandedCats] = React.useState<Set<number>>(initialExpanded);
  React.useEffect(() => setExpandedCats(initialExpanded), [initialExpanded]);

  const toggleCat = (cat: number) =>
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  // Native DnD across the entire day (keeps styling intact on each TaskItem)
  const dragRef = React.useRef<DragState>({ fromId: null });

  const onTaskDragStart = (taskId: string) => {
    dragRef.current.fromId = taskId;
  };

  const onTaskDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onTaskDrop = (targetId: string) => {
    const fromId = dragRef.current.fromId;
    if (!fromId || fromId === targetId) return;

    setOrdered((prev) => {
      const next = [...prev];
      const from = next.findIndex((t) => t.id === fromId);
      const to = next.findIndex((t) => t.id === targetId);
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

  const renderGroup = (cat: number) => {
    const tasks = groups.get(cat) ?? [];
    if (tasks.length === 0) return null;

    const groupKey = `cat-${cat}`;
    const label = CATEGORY_LABEL[cat] || `Category ${cat}`;
    const isExpanded = expandedCats.has(cat);

    return (
      <div key={groupKey} className="mb-3">
        <TaskGroupItem
          groupKey={groupKey}
          sourceName={label}
          tasks={tasks}
          isExpanded={isExpanded}
          onToggle={() => toggleCat(cat)}
        />
        {isExpanded && (
          <div id={`task-group-${groupKey}`} className="mt-2 space-y-1.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                draggable
                onDragStart={() => onTaskDragStart(task.id)}
                onDragOver={onTaskDragOver}
                onDrop={() => onTaskDrop(task.id)}
                // DO NOT change styling; TaskItem keeps your original look
              >
                <TaskItem
                  task={task}
                  onToggle={onToggleTask}
                  isCurrentPomodoroTask={false}
                  isPulsing={false}
                  onSetPomodoro={() => { /* no-op here; your existing wiring handles this elsewhere */ }}
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
      {/* Header - unchanged */}
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

      {/* Category sections in 12‑tier order (original look preserved) */}
      <div>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((cat) => renderGroup(cat))}
      </div>
    </div>
  );
};

export default DailyTaskList;
