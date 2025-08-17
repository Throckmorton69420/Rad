import React, { useState, useMemo, useEffect } from 'react';
import { StudyResource, Domain, ResourceType } from '../types';
import { Button } from './Button';
import { formatDuration } from '../utils/timeFormatter';
import { ALL_DOMAINS } from '../constants';

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
  onResourceDragStart: (e: React.DragEvent<HTMLDivElement>, resourceId: string) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
}

type SortKey = keyof StudyResource | 'calculatedDuration' | 'source';

type SortConfig = {
  key: SortKey | null;
  direction: 'ascending' | 'descending';
};

const MasterResourcePoolViewer: React.FC<MasterResourcePoolViewerProps> = ({ 
  resources, onOpenAddResourceModal, onEditResource, onArchiveResource, 
  onRestoreResource, onPermanentDeleteResource, scheduledResourceIds,
  onGoToDate, onHighlightDates, onClearHighlights,
  onResourceDragStart, onDrop, onDragOver
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [domainFilter, setDomainFilter] = useState<Domain | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'sequenceOrder', direction: 'ascending' });
  const [highlightedPairedIds, setHighlightedPairedIds] = useState<string[]>([]);
  const [selectedResource, setSelectedResource] = useState<StudyResource | null>(null);

  const relevantResources = useMemo(() => {
    return resources.filter(r => {
      const isArchivedMatch = showArchived ? r.isArchived : !r.isArchived;
      return isArchivedMatch;
    });
  }, [resources, showArchived]);


  const availableResourceTypes = useMemo(() => {
    const types = new Set(relevantResources.map(r => r.type));
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [relevantResources]);

  const availableSources = useMemo(() => {
    const filteredForSource = relevantResources.filter(r => 
        (domainFilter === 'all' || r.domain === domainFilter) && 
        (typeFilter === 'all' || r.type === typeFilter)
    );
    const sources = new Set<string>();
    filteredForSource.forEach(r => {
      if (r.bookSource) sources.add(r.bookSource);
      if (r.videoSource) sources.add(r.videoSource);
    });
    return Array.from(sources).sort();
  }, [relevantResources, domainFilter, typeFilter]);

  
  const filteredResources = useMemo(() => {
    let filtered = relevantResources.filter(resource => {
      const searchMatch = resource.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (resource.bookSource && resource.bookSource.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          (resource.videoSource && resource.videoSource.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          resource.id.toLowerCase().includes(searchTerm.toLowerCase());
      const domainMatch = domainFilter === 'all' || resource.domain === domainFilter;
      const typeMatch = typeFilter === 'all' || resource.type === typeFilter;
      
      let sourceMatch = sourceFilter === 'all';
      if (sourceFilter !== 'all') {
        if (resource.bookSource === sourceFilter || resource.videoSource === sourceFilter) {
          sourceMatch = true;
        } else {
          sourceMatch = false;
        }
      }
      
      return searchMatch && domainMatch && typeMatch && sourceMatch;
    });

    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aValue, bValue;
        if (sortConfig.key === 'calculatedDuration') {
            aValue = a.durationMinutes;
            bValue = b.durationMinutes;
        } else if (sortConfig.key === 'source') {
            aValue = a.bookSource || a.videoSource || '';
            bValue = b.bookSource || b.videoSource || '';
        } else {
            aValue = a[sortConfig.key as keyof StudyResource];
            bValue = b[sortConfig.key as keyof StudyResource];
        }

        if (aValue === undefined && bValue === undefined) return 0;
        if (aValue === undefined) return sortConfig.direction === 'ascending' ? 1 : -1;
        if (bValue === undefined) return sortConfig.direction === 'ascending' ? -1 : 1;
        
        if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
            return sortConfig.direction === 'ascending' ? (aValue === bValue ? 0 : aValue ? -1 : 1) : (aValue === bValue ? 0 : aValue ? 1 : -1)
        }
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortConfig.direction === 'ascending' ? aValue - bValue : bValue - aValue;
        }
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'ascending' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
        }
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        return sortConfig.direction === 'ascending' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      });
    }
    return filtered;
  }, [relevantResources, searchTerm, domainFilter, typeFilter, sourceFilter, sortConfig]);

  useEffect(() => {
    setHighlightedPairedIds([]);
  }, [filteredResources]);
  
  const handleSelectResource = (resource: StudyResource) => {
    if (resource.pairedResourceIds && resource.pairedResourceIds.length > 0) {
      setHighlightedPairedIds([resource.id, ...resource.pairedResourceIds]);
    }
    setSelectedResource(resource);
  };

  const handleMouseLeaveList = () => {
    setHighlightedPairedIds([]);
    onClearHighlights();
    setSelectedResource(null);
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setDomainFilter('all');
    setTypeFilter('all');
    setSourceFilter('all');
    setSortConfig({ key: 'sequenceOrder', direction: 'ascending' });
  };


  return (
    <div 
      className="bg-[var(--background-secondary)] p-4 rounded-lg h-full flex flex-col static-glow-border"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onMouseLeave={handleMouseLeaveList}
      >
      <div className="flex-shrink-0">
          <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] mb-4">Resource Pool</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end mb-4">
              <div className="min-w-[150px]">
                  <label htmlFor="searchTerm" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Search</label>
                  <input type="text" id="searchTerm" placeholder="Title, source, ID..."
                      className="input-base text-sm"
                      value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
              <div className="min-w-[120px]">
                  <label htmlFor="domainFilter" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Domain</label>
                  <select id="domainFilter" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value as Domain | 'all')}
                      className="input-base text-sm">
                      <option value="all">All Domains</option>
                      {ALL_DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
              </div>
              <div className="min-w-[120px]">
                  <label htmlFor="typeFilter" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Type</label>
                  <select id="typeFilter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ResourceType | 'all')}
                      className="input-base text-sm">
                      <option value="all">All Types</option>
                      {availableResourceTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
              </div>
          </div>
           <div className="flex justify-between items-center space-x-3 mt-4 pt-3 border-t border-[var(--separator-primary)]">
                <label className="flex items-center text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} 
                            className="h-4 w-4 text-[var(--accent-yellow)] border-gray-700 rounded bg-gray-800 focus:ring-[var(--accent-yellow)] mr-2"/>
                    Show Archived
                </label>
              <div className="flex items-center space-x-2">
                <Button onClick={handleClearFilters} variant="secondary" size="sm">
                    <i className="fas fa-times mr-1.5"></i> Clear Filters
                </Button>
                <Button onClick={onOpenAddResourceModal} variant="primary" size="sm">
                    <i className="fas fa-plus mr-1.5"></i> Add Resource
                </Button>
              </div>
          </div>
      </div>
      
      <div className="flex-grow overflow-y-auto pr-2 -mr-2 mt-4 space-y-2" onMouseLeave={handleMouseLeaveList}>
        {filteredResources.map((resource) => {
            const isHighlighted = highlightedPairedIds.includes(resource.id);
            const baseCardClass = showArchived ? 'bg-black/50 opacity-60' : 'bg-[var(--background-tertiary)]';
            const finalCardClass = isHighlighted ? 'bg-zinc-700/80' : baseCardClass;

            return (
              <div key={resource.id} 
                   className={`p-3 rounded-lg transition-colors duration-150 ${finalCardClass} ${!showArchived ? 'cursor-grab' : ''} interactive-glow-border`}
                   onClick={() => handleSelectResource(resource)}
                   draggable={!showArchived}
                   onDragStart={(e) => onResourceDragStart(e, resource.id)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-grow min-w-0 pr-2">
                    <h4 className="font-bold text-sm text-[var(--text-primary)]">{resource.title}</h4>
                    <p className="text-xs text-[var(--text-secondary)]">{resource.domain} • {resource.type}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                     <p className="text-sm font-semibold text-[var(--text-primary)]">{formatDuration(resource.durationMinutes)}</p>
                     {resource.isArchived && <span title="Archived" className="text-xs text-[var(--accent-yellow)]">Archived</span>}
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-[var(--separator-secondary)] flex justify-end items-center">
                  <div className="flex items-center justify-end space-x-1">
                      {!resource.isArchived ? (
                        <>
                          <Button onClick={(e) => { e.stopPropagation(); onEditResource(resource); }} variant="ghost" size="sm" className="!p-1.5 !text-[var(--text-secondary)] hover:bg-[var(--background-tertiary-hover)] hover:!text-white" aria-label="Edit Resource"><i className="fas fa-pencil-alt"></i></Button>
                          <Button onClick={(e) => { e.stopPropagation(); onArchiveResource(resource.id); }} variant="ghost" size="sm" className="!p-1.5 !text-[var(--accent-yellow)] hover:!bg-yellow-700/50 hover:!text-white" aria-label="Archive Resource"><i className="fas fa-archive"></i></Button>
                        </>
                      ) : (
                        <>
                          <Button onClick={(e) => { e.stopPropagation(); onRestoreResource(resource.id); }} variant="ghost" size="sm" className="!p-1.5 !text-[var(--accent-green)] hover:!bg-green-700/50 hover:!text-white" aria-label="Restore Resource"><i className="fas fa-undo"></i></Button>
                          <Button onClick={(e) => { e.stopPropagation(); onPermanentDeleteResource(resource.id); }} variant="ghost" size="sm" className="!p-1.5 !text-[var(--accent-red)] hover:!bg-red-700/50 hover:!text-white" aria-label="Delete Permanently"><i className="fas fa-trash-alt"></i></Button>
                        </>
                      )}
                  </div>
                </div>
              </div>
            );
        })}
         {filteredResources.length === 0 && (
            <div className="p-4 text-center text-[var(--text-secondary)] bg-[var(--background-secondary)] rounded-lg border-2 border-dashed border-[var(--separator-secondary)]">
              {showArchived ? "No archived resources match your filters." : "No active, unscheduled resources match your filters."}
               {scheduledResourceIds.size > 0 && " Tasks can be dragged from the daily schedule back to this pool."}
            </div>
          )}
      </div>

     <p className="text-xs text-gray-500 text-right mt-2 pr-2 flex-shrink-0">Showing {filteredResources.length} of {relevantResources.length} resources.</p>
    </div>
  );
};

export default MasterResourcePoolViewer;