import React, { useMemo, useState, useEffect } from 'react';
import { StudyPlan, Domain, ResourceType } from '../types';
import { ALL_DOMAINS } from '../constants'; 
import { formatDuration, parseDateString } from '../utils/timeFormatter';
import CustomSelect from '../CustomSelect';
import { getDomainColorStyle } from '../utils/timeFormatter';
import { Button } from './Button';

interface ProgressDisplayProps {
  studyPlan: StudyPlan;
}

const ProgressItem: React.FC<{label: string; percentage: number; completed: number; total: number; color?: string;}> = ({ label, percentage, completed, total, color }) => (
  <div className="p-3 rounded-lg glass-panel">
    <div className="flex justify-between items-baseline mb-3">
      <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
      <p className="text-xs font-semibold text-[var(--text-secondary)]">{Math.round(percentage)}%</p>
    </div>
    <div className="w-full bg-black/30 rounded-full h-2.5 progress-bar-track">
      <div className="progress-bar-fill" style={{ width: `${percentage}%`, backgroundImage: color ? 'none' : undefined, backgroundColor: color }}></div>
    </div>
    <p className="text-xs text-[var(--text-secondary)] mt-1 text-right">
      {formatDuration(completed)} / {formatDuration(total)}
    </p>
  </div>
);

const DeadlineItem: React.FC<{ label: string; deadline?: string; projected: string | null; onTrack: boolean }> = ({ label, deadline, projected, onTrack }) => (
    <div className="flex justify-between items-center text-sm py-1.5 border-b border-[var(--separator-secondary)]">
        <span className="text-[var(--text-primary)]">{label}</span>
        <div className="text-right">
            <span className={`font-bold ${onTrack ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`} title="Projected Completion Date">
              {projected ? parseDateString(projected).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : 'N/A'}
            </span>
            {deadline && (
              <span className="text-xs text-[var(--text-secondary)] ml-2" title="Your Target Deadline">
                (Target: {parseDateString(deadline).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })})
              </span>
            )}
        </div>
    </div>
);


const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ studyPlan }) => {
  const [selectedDomain, setSelectedDomain] = useState<Domain | 'all'>('all');
  const [selectedType, setSelectedType] = useState<ResourceType | 'all'>('all');
  const [selectedSource, setSelectedSource] = useState<string | 'all'>('all');

  const { deadlines } = studyPlan;
  
  const allTasks = useMemo(() => studyPlan.schedule.flatMap(day => day.tasks), [studyPlan.schedule]);

  const { totalScheduledMinutes, totalCompletedMinutes } = useMemo(() => {
    let scheduled = 0;
    let completed = 0;
    allTasks.forEach(task => {
        scheduled += task.durationMinutes;
        if (task.status === 'completed') {
            completed += task.durationMinutes;
        }
    });
    return { totalScheduledMinutes: scheduled, totalCompletedMinutes: completed };
  }, [allTasks]);
  const overallProgressPercentage = totalScheduledMinutes > 0 ? (totalCompletedMinutes / totalScheduledMinutes) * 100 : 0;

  const projectedDates = useMemo(() => {
    const findLastDate = (filterFn: (task: any) => boolean): string | null => {
        for (let i = studyPlan.schedule.length - 1; i >= 0; i--) {
            if (studyPlan.schedule[i].tasks.some(filterFn)) {
                return studyPlan.schedule[i].date; // Return full YYYY-MM-DD string
            }
        }
        return null;
    };

    return {
      allContent: findLastDate(t => t.isPrimaryMaterial),
      physics: findLastDate(t => t.isPrimaryMaterial && t.originalTopic === Domain.PHYSICS),
      nucMed: findLastDate(t => t.isPrimaryMaterial && t.originalTopic === Domain.NUCLEAR_MEDICINE),
      other: findLastDate(t => t.isPrimaryMaterial && t.originalTopic !== Domain.PHYSICS && t.originalTopic !== Domain.NUCLEAR_MEDICINE),
    };
  }, [studyPlan.schedule]);

  const isOnTrack = (deadline?: string, projected?: string | null) => {
    if (!deadline || !projected) return true;
    return parseDateString(projected) <= parseDateString(deadline);
  };
  
  // --- Intelligent Hierarchical Filtering ---
  
  // 1. Filtered list of tasks based on all active filters
  const filteredTasks = useMemo(() => {
    return allTasks.filter(task => {
      const domainMatch = selectedDomain === 'all' || task.originalTopic === selectedDomain;
      const typeMatch = selectedType === 'all' || task.type === selectedType;
      const source = task.bookSource || task.videoSource;
      const sourceMatch = selectedSource === 'all' || source === selectedSource;
      return domainMatch && typeMatch && sourceMatch;
    });
  }, [allTasks, selectedDomain, selectedType, selectedSource]);

  // 2. Dynamically determine available options for each dropdown based on *other* filters
  const availableDomains = useMemo(() => {
      const tasksForDomainFilter = allTasks.filter(t =>
          (selectedType === 'all' || t.type === selectedType) &&
          (selectedSource === 'all' || (t.bookSource || t.videoSource) === selectedSource)
      );
      const domains = new Set(tasksForDomainFilter.map(t => t.originalTopic));
      return ALL_DOMAINS.filter(d => domains.has(d));
  }, [allTasks, selectedType, selectedSource]);

  const availableResourceTypes = useMemo(() => {
      const tasksForTypeFilter = allTasks.filter(t =>
          (selectedDomain === 'all' || t.originalTopic === selectedDomain) &&
          (selectedSource === 'all' || (t.bookSource || t.videoSource) === selectedSource)
      );
      return Array.from(new Set(tasksForTypeFilter.map(t => t.type))).sort();
  }, [allTasks, selectedDomain, selectedSource]);

  const availableSources = useMemo(() => {
      const tasksForSourceFilter = allTasks.filter(t =>
          (selectedDomain === 'all' || t.originalTopic === selectedDomain) &&
          (selectedType === 'all' || t.type === selectedType)
      );
      const sources = new Set<string>();
      tasksForSourceFilter.forEach(t => {
          const source = t.bookSource || t.videoSource;
          if (source) sources.add(source);
      });
      return Array.from(sources).sort();
  }, [allTasks, selectedDomain, selectedType]);

  // 3. Effects to reset a filter if its current selection becomes invalid
  useEffect(() => { if (!availableDomains.includes(selectedDomain as Domain)) setSelectedDomain('all'); }, [availableDomains, selectedDomain]);
  useEffect(() => { if (!availableResourceTypes.includes(selectedType as ResourceType)) setSelectedType('all'); }, [availableResourceTypes, selectedType]);
  useEffect(() => { if (!availableSources.includes(selectedSource)) setSelectedSource('all'); }, [availableSources, selectedSource]);
  
  // --- Data aggregation based on filtered tasks ---

  const progressByTopic = useMemo(() => {
    const progress: Partial<Record<Domain, { completedMinutes: number; totalMinutes: number }>> = {};
    filteredTasks.forEach(task => {
      if (!progress[task.originalTopic]) progress[task.originalTopic] = { completedMinutes: 0, totalMinutes: 0 };
      progress[task.originalTopic]!.totalMinutes += task.durationMinutes;
      if (task.status === 'completed') progress[task.originalTopic]!.completedMinutes += task.durationMinutes;
    });
    return Object.entries(progress)
      .filter((entry): entry is [Domain, { completedMinutes: number; totalMinutes: number }] => !!entry[1] && entry[1].totalMinutes > 0)
      .sort(([domainA], [domainB]) => ALL_DOMAINS.indexOf(domainA) - ALL_DOMAINS.indexOf(domainB));
  }, [filteredTasks]);

  const progressByResourceType = useMemo(() => {
    const progress: Partial<Record<ResourceType, { completedMinutes: number; totalMinutes: number }>> = {};
    filteredTasks.forEach(task => {
        if (!progress[task.type]) progress[task.type] = { completedMinutes: 0, totalMinutes: 0 };
        progress[task.type]!.totalMinutes += task.durationMinutes;
        if (task.status === 'completed') progress[task.type]!.completedMinutes += task.durationMinutes;
    });
    const typedEntries: [ResourceType, { completedMinutes: number; totalMinutes: number }][] =
        (Object.keys(progress) as ResourceType[]).map(key => [key, progress[key]!]);

    return typedEntries
        .filter(([, data]) => data.totalMinutes > 0)
        .sort(([typeA], [typeB]) => typeA.localeCompare(typeB));
  }, [filteredTasks]);
  
  const progressBySource = useMemo(() => {
    const progress: Record<string, { completedMinutes: number; totalMinutes: number }> = {};
    filteredTasks.forEach(task => {
      const source = task.bookSource || task.videoSource || 'Other Custom Tasks';
      if (!progress[source]) progress[source] = { completedMinutes: 0, totalMinutes: 0 };
      progress[source]!.totalMinutes += task.durationMinutes;
      if (task.status === 'completed') progress[source]!.completedMinutes += task.durationMinutes;
    });

    const entries: [string, { completedMinutes: number; totalMinutes: number }][] = Object.entries(progress);

    return entries
      .filter(([, data]) => data.totalMinutes > 0)
      .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB));
  }, [filteredTasks]);
  
  const domainOptions = [{ value: 'all', label: 'All Topics' }, ...availableDomains.map(d => ({ value: d, label: d }))];
  const typeOptions = [{ value: 'all', label: 'All Types' }, ...availableResourceTypes.map(t => ({ value: t, label: t }))];
  const sourceOptions = [{ value: 'all', label: 'All Sources' }, ...availableSources.map(s => ({ value: s, label: s }))];


  return (
    <div className="text-[var(--text-primary)] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="flex justify-between items-center border-b border-[var(--separator-primary)] pb-3">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Study Progress</h2>
        <Button onClick={() => window.print()} variant="secondary" size="sm">
          <i className="fas fa-print mr-2"></i> Print Report
        </Button>
      </div>
      
      <div className="mt-8">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Overall Progress</h3>
          <div className='mt-2 p-4 glass-panel rounded-lg'>
              <div className="flex justify-between items-baseline mb-3">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">Total Completion</span>
                  <span className="text-sm font-bold text-[var(--text-primary)]">{Math.round(overallProgressPercentage)}%</span>
              </div>
              <div className="w-full bg-black/40 rounded-full h-4 progress-bar-track mt-2">
                  <div className="progress-bar-fill" style={{ width: `${overallProgressPercentage}%` }}></div>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mt-1 text-right">{formatDuration(totalCompletedMinutes)} / {formatDuration(totalScheduledMinutes)} completed</p>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-[var(--text-primary)] mt-8">Deadlines & Projections</h3>
        <div className="mt-2 p-4 glass-panel rounded-lg">
            <DeadlineItem label="All Content" deadline={deadlines.allContent} projected={projectedDates.allContent} onTrack={isOnTrack(deadlines.allContent, projectedDates.allContent)} />
            <DeadlineItem label="Physics" deadline={deadlines.physicsContent} projected={projectedDates.physics} onTrack={isOnTrack(deadlines.physicsContent, projectedDates.physics)} />
            <DeadlineItem label="Nuclear Medicine" deadline={deadlines.nucMedContent} projected={projectedDates.nucMed} onTrack={isOnTrack(deadlines.nucMedContent, projectedDates.nucMed)} />
            <DeadlineItem label="Other Topics" deadline={deadlines.otherContent} projected={projectedDates.other} onTrack={isOnTrack(deadlines.otherContent, projectedDates.other)} />
        </div>
        
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mt-8">Detailed Progress</h3>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Filter by Topic</label>
                <CustomSelect value={selectedDomain} onChange={val => setSelectedDomain(val as Domain | 'all')} options={domainOptions} />
            </div>
            <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Filter by Type</label>
                <CustomSelect value={selectedType} onChange={val => setSelectedType(val as ResourceType | 'all')} options={typeOptions} />
            </div>
            <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Filter by Source</label>
                <CustomSelect value={selectedSource} onChange={val => setSelectedSource(val)} options={sourceOptions} />
            </div>
        </div>


        {filteredTasks.length === 0 ? (
          <div className="text-center p-6 mt-8">
            <p className="text-[var(--text-secondary)]">No tasks match the current filter criteria.</p>
          </div>
        ) : (
          <>
            {progressByTopic.length > 0 && (
              <>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mt-8">Progress by Topic</h3>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {progressByTopic.map(([domain, data]) => (
                          <ProgressItem 
                              key={domain} 
                              label={domain} 
                              percentage={(data.completedMinutes / data.totalMinutes) * 100} 
                              completed={data.completedMinutes} 
                              total={data.totalMinutes}
                              color={getDomainColorStyle(domain).backgroundColor}
                          />
                      ))}
                  </div>
              </>
            )}

            {progressByResourceType.length > 0 && (
              <>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mt-8">Progress by Resource Type</h3>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {progressByResourceType.map(([type, data]) => (
                          <ProgressItem key={type} label={type} percentage={(data.completedMinutes / data.totalMinutes) * 100} completed={data.completedMinutes} total={data.totalMinutes} />
                      ))}
                  </div>
              </>
            )}
            
            {progressBySource.length > 0 && (
              <>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mt-8">Progress by Source</h3>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {progressBySource.map(([source, data], index) => (
                          <ProgressItem key={`${source}-${index}`} label={source} percentage={(data.completedMinutes / data.totalMinutes) * 100} completed={data.completedMinutes} total={data.totalMinutes} />
                      ))}
                  </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ProgressDisplay;