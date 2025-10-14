import React, { useMemo, useState, useEffect } from 'react';
import { DailySchedule, ScheduledTask } from '../types';
import { formatDuration, parseDateString } from '../utils/timeFormatter';
import { Button } from './Button';
import { getCategoryRankFromTask, sortTasksByGlobalPriority, CATEGORY_LABEL } from '../utils/taskPriority';

interface DailyTaskListProps {
  day: DailySchedule;
  onToggleTask: (taskId: string) => void;
  onOpenModify: (date: string) => void;
  onReorderTasks?: (date: string, tasks: ScheduledTask[]) => void;
}

// Build grouped tabs from tasks in canonical (global) order
const useGroupedTabs = (tasks: ScheduledTask[]) => {
  const canonical = useMemo(() => [...tasks].sort(sortTasksByGlobalPriority), [tasks]);

  const grouped = useMemo(() => {
    const map = new Map<number, ScheduledTask[]>();
    canonical.forEach(t => {
      const c = getCategoryRankFromTask(t);
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(t);
    });
    return map;
  }, [canonical]);

  const defaultTabOrder = useMemo(() => Array.from(grouped.keys()).sort((a, b) => a - b), [grouped]);

  return { canonical, grouped, defaultTabOrder };
};

const DailyTaskList: React.FC<DailyTaskListProps> = ({ day, onToggleTask, onOpenModify, onReorderTasks }) => {
  // Group by category rank
  const { canonical, grouped, defaultTabOrder } = useGroupedTabs(day.tasks);

  // Local state for tab order + per-tab item orders
  const [tabOrder, setTabOrder] = useState<number[]>(defaultTabOrder);
  const [itemsByTab, setItemsByTab] = useState<Record<number, ScheduledTask[]>>(() => {
    const rec: Record<number, ScheduledTask[]> = {};
    defaultTabOrder.forEach(k => (rec[k] = grouped.get(k)!));
    return rec;
  });

  // Track what’s being dragged (tab or task)
  const [dragTab, setDragTab] = useState<number | null>(null);
  const [dragTask, setDragTask] = useState<{ cat: number; id: string } | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<number>(defaultTabOrder[0] ?? 1);

  // Sync when external tasks change
  useEffect(() => {
    setTabOrder(defaultTabOrder);
    const rec: Record<number, ScheduledTask[]> = {};
    defaultTabOrder.forEach(k => (rec[k] = grouped.get(k)!));
    setItemsByTab(rec);
    setActiveTab(defaultTabOrder[0] ?? 1);
  }, [canonical, grouped, defaultTabOrder]);

  // Helpers
  const totalTime = useMemo(
    () => Object.values(itemsByTab).flat().reduce((s, t) => s + t.durationMinutes, 0),
    [itemsByTab]
  );

  const flattenedCurrentOrder = useMemo(() => {
    // Flatten respecting current tab order then each tab’s item order
    const list: ScheduledTask[] = [];
    tabOrder.forEach(cat => {
      const arr = itemsByTab[cat] ?? [];
      arr.forEach(item => list.push(item));
    });
    return list;
  }, [tabOrder, itemsByTab]);

  // Drag handlers for tabs
  const onTabDragStart = (cat: number) => setDragTab(cat);
  const onTabDragOver = (e: React.DragEvent) => e.preventDefault();
  const onTabDrop = (targetCat: number) => {
    if (dragTab == null || dragTab === targetCat) return;
    setTabOrder(prev => {
      const next = [...prev];
      const from = next.indexOf(dragTab);
      const to = next.indexOf(targetCat);
      if (from < 0 || to < 0) return prev;
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
    setDragTab(null);
  };

  // Drag handlers for items inside a tab (no cross-tab moves)
  const onItemDragStart = (cat: number, id: string) => setDragTask({ cat, id });
  const onItemDragOver = (e: React.DragEvent) => e.preventDefault();
  const onItemDrop = (cat: number, targetId: string) => {
    if (!dragTask || dragTask.cat !== cat) return;
    setItemsByTab(prev => {
      const arr = prev[cat] ? [...prev[cat]] : [];
      const from = arr.findIndex(t => t.id === dragTask.id);
      const to = arr.findIndex(t => t.id === targetId);
      if (from < 0 || to < 0) return prev;
      const next = { ...prev };
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      next[cat] = arr;
      return next;
    });
    setDragTask(null);
  };

  // Persist: renumber order and send up
  const persist = () => {
    const reindexed = flattenedCurrentOrder.map((t, i) => ({ ...t, order: i }));
    onReorderTasks?.(day.date, reindexed);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {parseDateString(day.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-80">{formatDuration(totalTime)}</span>
          <Button size="sm" variant="secondary" onClick={() => onOpenModify(day.date)}>
            <i className="fas fa-edit mr-2" /> Modify
          </Button>
          {onReorderTasks && (
            <Button size="sm" variant="primary" onClick={persist}>
              <i className="fas fa-save mr-2" /> Save Order
            </Button>
          )}
        </div>
      </div>

      {/* Tab bar with drag handles */}
      <div className="flex flex-wrap gap-1">
        {tabOrder.map(cat => {
          const count = (itemsByTab[cat] ?? []).length;
          const isActive = cat === activeTab;
          return (
            <button
              key={cat}
              draggable
              onDragStart={() => onTabDragStart(cat)}
              onDragOver={onTabDragOver}
              onDrop={() => onTabDrop(cat)}
              onClick={() => setActiveTab(cat)}
              className={`px-2.5 py-1 rounded-md text-xs transition ${
                isActive ? 'bg-[var(--accent-purple)] text-white' : 'glass-panel glass-panel-interactive'
              }`}
              aria-pressed={isActive}
              title="Drag to reorder tabs; click to activate"
            >
              <i className="fas fa-grip-lines mr-1 opacity-70" />
              {CATEGORY_LABEL[cat] || `Cat ${cat}`} • {count}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="rounded-lg glass-panel p-2">
        {(itemsByTab[activeTab] ?? []).map(task => (
          <div
            key={task.id}
            className={`flex items-center p-2 rounded-lg glass-panel glass-panel-interactive mb-2 ${
              dragTask?.id === task.id ? 'opacity-50' : ''
            }`}
            draggable
            onDragStart={() => onItemDragStart(activeTab, task.id)}
            onDragOver={onItemDragOver}
            onDrop={() => onItemDrop(activeTab, task.id)}
            onDragEnd={() => setDragTask(null)}
          >
            <i className="fas fa-grip-vertical mr-3 cursor-grab text-[var(--text-secondary)]" />
            <div className="flex-grow min-w-0">
              <div className="text-sm font-medium truncate" title={task.title}>{task.title}</div>
              <div className="text-xs opacity-70">{task.originalTopic}</div>
            </div>
            <div className="ml-3 text-sm font-semibold">{formatDuration(task.durationMinutes)}</div>
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => onToggleTask(task.id)}>
              <i className={`fas ${task.status === 'completed' ? 'fa-check-circle text-green-400' : 'fa-circle text-[var(--text-secondary)]'}`} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DailyTaskList;