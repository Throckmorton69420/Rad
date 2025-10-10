import React, { useState, useMemo } from 'react';
import { StudyResource, Domain, ResourceType } from '../types';
import { Button } from './Button';
import { formatDuration, getDomainColorStyle } from '../utils/timeFormatter';
import { ALL_DOMAINS } from '../constants';
import CustomSelect from '../CustomSelect';

interface MasterResourcePoolViewerProps {
  resources: StudyResource[];
  onOpenAddResourceModal: () => void;
  onEditResource: (resource: StudyResource) => void;
  onArchiveResource: (resourceId: string) => void;
  onRestoreResource: (resourceId: string) => void;
  onPermanentDeleteResource: (resourceId: string) => void;
  scheduledResourceIds: Set<string>;
  onGoToDate: (resourceId: string) => void;
  onHighlightDates: (resourceId: string) => void;
  onClearHighlights: () => void;
}

type SortKey = 'title' | 'domain' | 'type' | 'durationMinutes' | 'sequenceOrder' | 'isScheduled' | 'source';
type SortConfig = { key: SortKey; direction: 'ascending' | 'descending'; };

const MasterResourcePoolViewer: React.FC<MasterResourcePoolViewerProps> = ({ 
  resources, onOpenAddResourceModal, onEditResource, onArchiveResource, 
  onRestoreResource, onPermanentDeleteResource, scheduledResourceIds,
  onGoToDate, onHighlightDates, onClearHighlights
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [domainFilter, setDomainFilter] = useState<Domain | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'unscheduled'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);
  
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'sequenceOrder', direction: 'ascending' });

  const resourcesWithStatus = useMemo(() => {
    return resources.map(r => ({
      ...r,
      isScheduled: scheduledResourceIds.has(r.id),
      source: r.bookSource || r.videoSource || 'Custom',
    }));
  }, [resources, scheduledResourceIds]);

  const unscheduledResources = useMemo(() => {
    return resourcesWithStatus.filter(r => !r.isScheduled && !r.isArchived);
  }, [resourcesWithStatus]);

  const groupedUnscheduled = useMemo(() => {
    const groups: Record<string, StudyResource[]> = {};
    unscheduledResources.forEach(resource => {
      const source = resource.source || 'Other Custom Tasks';
      if (!groups[source]) {
        groups[source] = [];
      }
      groups[source].push(resource);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [unscheduledResources]);

  const getResourceDetails = (resource: StudyResource) => {
    const details = [];
    details.push(formatDuration(resource.durationMinutes));
    if (resource.chapterNumber) details.push(`Ch. ${resource.chapterNumber}`);
    if (resource.pages) details.push(`${resource.pages} pgs`);
    if (resource.questionCount) details.push(`${resource.questionCount} q's`);
    return details.join(', ');
  };

  const filteredAndSortedResources = useMemo(() => {
    let filtered = resourcesWithStatus.filter(resource => {
      const isArchivedMatch = showArchived ? resource.isArchived : !resource.isArchived;
      if (!isArchivedMatch) return false;

      const statusMatch = statusFilter === 'all' || 
                          (statusFilter === 'scheduled' && resource.isScheduled) ||
                          (statusFilter === 'unscheduled' && !resource.isScheduled);
      if (!statusMatch) return false;
      
      const searchMatch = !searchTerm || resource.title.toLowerCase().includes(searchTerm.toLowerCase()) || resource.id.toLowerCase().includes(searchTerm.toLowerCase());
      const domainMatch = domainFilter === 'all' || resource.domain === domainFilter;
      const typeMatch = typeFilter === 'all' || resource.type === typeFilter;
      const sourceMatch = sourceFilter === 'all' || resource.source === sourceFilter;
      
      return searchMatch && domainMatch && typeMatch && sourceMatch;
    });

    filtered.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      let compareResult = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') compareResult = aVal - bVal;
      else if (typeof aVal === 'string' && typeof bVal === 'string') compareResult = aVal.localeCompare(bVal);
      else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') compareResult = aVal === bVal ? 0 : aVal ? -1 : 1;
      else compareResult = String(aVal).localeCompare(String(bVal));

      return sortConfig.direction === 'ascending' ? compareResult : -compareResult;
    });

    return filtered;
  }, [resourcesWithStatus, showArchived, statusFilter, searchTerm, domainFilter, typeFilter, sourceFilter, sortConfig]);

  const requestSort = (key: SortKey) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const typeOptions = useMemo(() => Array.from(new Set(resources.map(r => r.type))).sort().map(t => ({ value: t, label: t })), [resources]);
  const sourceOptions = useMemo(() => Array.from(new Set(resources.map(r => r.bookSource || r.videoSource).filter(Boolean) as string[])).sort().map(s => ({ value: s, label: s })), [resources]);

  return (
    <div className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="flex-shrink-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end mb-3">
          <input type="text" placeholder="Search resources..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-base !py-1.5 !text-sm"/>
          <CustomSelect value={domainFilter} onChange={v => setDomainFilter(v as Domain | 'all')} options={[{value: 'all', label: 'All Topics'}, ...ALL_DOMAINS.map(d => ({ value: d, label: d }))]}/>
          <CustomSelect value={typeFilter} onChange={v => setTypeFilter(v as ResourceType | 'all')} options={[{value: 'all', label: 'All Types'}, ...typeOptions]}/>
          <CustomSelect value={sourceFilter} onChange={v => setSourceFilter(v)} options={[{value: 'all', label: 'All Sources'}, ...sourceOptions]}/>
        </div>
        <div className="flex justify-between items-center space-x-3 mt-2 pt-2">
            <div className="flex items-center space-x-4">
              <CustomSelect value={statusFilter} onChange={v => setStatusFilter(v as any)} options={[ {value: 'all', label: 'All Statuses'}, {value: 'scheduled', label: 'Scheduled'}, {value: 'unscheduled', label: 'Unscheduled'} ]}/>
              <label className="flex items-center text-sm text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 text-[var(--accent-yellow)] border-gray-700 rounded bg-gray-800 focus:ring-[var(--accent-yellow)] mr-2"/>
                Show Archived
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Button onClick={onOpenAddResourceModal} variant="primary" size="sm" className="!text-xs !px-3 !py-1.5"><i className="fas fa-plus mr-1.5"></i> Add New</Button>
            </div>
        </div>
      </div>
      
      {unscheduledResources.length > 0 && !showArchived && (
        <div className="flex-shrink-0 my-4 p-3 rounded-lg glass-panel bg-red-900/20 border border-red-700/50">
          <button onClick={() => setIsSummaryExpanded(!isSummaryExpanded)} className="w-full flex justify-between items-center text-left">
            <h3 className="text-md font-semibold text-red-200">
              <i className="fas fa-exclamation-triangle mr-2"></i>
              Unscheduled Content Summary ({unscheduledResources.length} items)
            </h3>
            <i className={`fas fa-chevron-down transition-transform ${isSummaryExpanded ? 'rotate-180' : ''}`}></i>
          </button>
          {isSummaryExpanded && (
            <div className="mt-3 pt-3 border-t border-red-700/30 text-xs text-red-100/90 space-y-3 pr-2">
              {groupedUnscheduled.map(([source, items]) => (
                <div key={source}>
                  <p className="font-bold text-red-100 mb-1">{source}</p>
                  <ul className="list-disc list-inside pl-2 space-y-1">
                    {items.map(item => (
                      <li key={item.id}>
                        {item.title}
                        <span className="text-red-200/70 ml-2">
                          ({getResourceDetails(item)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2" onMouseLeave={onClearHighlights}>
        {filteredAndSortedResources.map((resource) => (
          <div key={resource.id} 
               className={`p-2 rounded-lg transition-colors duration-150 glass-panel interactive-glow-border ${resource.isArchived ? 'bg-black/50 opacity-60' : ''}`}
               onMouseEnter={() => onHighlightDates(resource.id)}
          >
            <div className="flex justify-between items-start gap-2">
              <div className="flex-grow min-w-0">
                <h4 className="font-bold text-sm text-[var(--text-primary)]">{resource.title}</h4>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                   <span className="text-xxs px-2 py-0.5 rounded-full font-semibold" style={getDomainColorStyle(resource.domain)}>{resource.domain}</span>
                   <span className="text-xxs px-2 py-0.5 rounded-full font-semibold text-white/90" style={{backgroundColor: 'hsl(210, 15%, 50%)'}}>{resource.type}</span>
                   <span className={`text-xxs px-2 py-0.5 rounded-full font-semibold ${resource.isScheduled ? 'bg-green-800/80 text-green-200' : 'bg-yellow-800/80 text-yellow-200'}`}>{resource.isScheduled ? 'Scheduled' : 'Unscheduled'}</span>
                </div>
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-xs text-[var(--text-secondary)]">
                    {resource.chapterNumber && <span><i className="fas fa-book-open mr-1 opacity-70"></i>Ch. {resource.chapterNumber}</span>}
                    {resource.pages && <span><i className="fas fa-file-alt mr-1 opacity-70"></i>{resource.pages} pgs</span>}
                    {resource.questionCount && <span><i className="fas fa-question-circle mr-1 opacity-70"></i>{resource.questionCount} q's</span>}
                    {resource.source && <span className="font-semibold max-w-full truncate" title={resource.source}><i className="fas fa-atlas mr-1 opacity-70"></i>{resource.source}</span>}
                </div>
              </div>
              <div className="flex-shrink-0 text-right flex flex-col items-end">
                 <p className="text-sm font-semibold text-[var(--text-primary)]">{formatDuration(resource.durationMinutes)}</p>
                 <div className="flex items-center justify-end space-x-1 mt-1">
                    {!resource.isArchived ? (
                      <>
                        {resource.isScheduled && <Button onClick={() => onGoToDate(resource.id)} variant="ghost" size="sm" className="!p-1.5 !text-[var(--text-secondary)] hover:!text-white" title="Go to first scheduled date"><i className="fas fa-calendar-day"></i></Button>}
                        <Button onClick={() => onEditResource(resource)} variant="ghost" size="sm" className="!p-1.5 !text-[var(--text-secondary)] hover:!text-white" title="Edit"><i className="fas fa-pencil-alt"></i></Button>
                        <Button onClick={() => onArchiveResource(resource.id)} variant="ghost" size="sm" className="!p-1.5 !text-[var(--accent-yellow)] hover:!text-white" title="Archive"><i className="fas fa-archive"></i></Button>
                      </>
                    ) : (
                      <>
                        <Button onClick={() => onRestoreResource(resource.id)} variant="ghost" size="sm" className="!p-1.5 !text-[var(--accent-green)] hover:!text-white" title="Restore"><i className="fas fa-undo"></i></Button>
                        <Button onClick={() => onPermanentDeleteResource(resource.id)} variant="ghost" size="sm" className="!p-1.5 !text-[var(--accent-red)] hover:!text-white" title="Delete Permanently"><i className="fas fa-trash-alt"></i></Button>
                      </>
                    )}
                 </div>
              </div>
            </div>
          </div>
        ))}
        {filteredAndSortedResources.length === 0 && (
          <div className="p-6 text-center text-[var(--text-secondary)] bg-black/20 rounded-lg border-2 border-dashed border-[var(--separator-secondary)]">
            <p className="font-semibold">No Resources Found</p>
            <p className="text-sm">Try adjusting your filters.</p>
          </div>
        )}
      </div>

     <p className="text-xs text-gray-500 text-right mt-2 pr-2 flex-shrink-0">Showing {filteredAndSortedResources.length} of {resources.length} total resources.</p>
    </div>
  );
};

export default MasterResourcePoolViewer;
