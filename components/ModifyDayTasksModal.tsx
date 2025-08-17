import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ModifyDayTasksModalProps, ScheduledTask, StudyResource, Domain, ResourceType } from '../types';
import { Button } from './Button';
import { formatDuration } from '../utils/timeFormatter';
import FocusTrap from 'focus-trap-react';
import { useDragSelect } from '../hooks/useDragSelect';
import { ALL_DOMAINS } from '../constants';
import CustomSelect from './CustomSelect'; // Import new component

const ResourceCard = React.memo(({
    resource,
    isSelected,
    isHighlighted,
    onMouseEnter,
    onTouchStart,
    onMouseDown,
}: {
    resource: StudyResource;
    isSelected: boolean;
    isHighlighted: boolean;
    onMouseEnter: (resourceId: string | null) => void;
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void;
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
    const cardClasses = [
        'p-1.5', 'md:p-2', 'rounded-lg', 'transition-all', 'duration-150', 'select-none',
        'resource-card', 'interactive-glow-border',
        isSelected ? 'is-selected' : 'border-transparent bg-[var(--background-tertiary)]',
        isHighlighted && !isSelected ? 'is-highlighted' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            data-resource-id={resource.id}
            className={cardClasses}
            onMouseEnter={() => onMouseEnter(resource.id)}
            onMouseLeave={() => onMouseEnter(null)}
            onTouchStart={onTouchStart}
            onMouseDown={onMouseDown}
        >
            <div className="flex justify-between items-start pointer-events-none">
                <div className="flex-grow min-w-0 pr-2">
                    <h4 className="font-bold text-xs md:text-sm truncate" title={resource.title}>{resource.title}</h4>
                    <p className="text-xxs md:text-xs text-[var(--text-secondary)]">{resource.domain} &bull; {resource.type}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                    <p className="text-xs md:text-sm font-semibold">{formatDuration(resource.durationMinutes)}</p>
                </div>
            </div>
        </div>
    );
});


const ModifyDayTasksModal: React.FC<ModifyDayTasksModalProps> = ({
    isOpen, onClose, onSave, tasksForDay, allResources, selectedDate, openAddResourceModal
}) => {
    const [stagedTasks, setStagedTasks] = useState<ScheduledTask[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

    const [isScheduledVisible, setIsScheduledVisible] = useState(false);
    const [isAvailableVisible, setIsAvailableVisible] = useState(true);

    const [domainFilter, setDomainFilter] = useState<Domain | 'all'>('all');
    const [typeFilter, setTypeFilter] = useState<ResourceType | 'all'>('all');
    const [sourceFilter, setSourceFilter] = useState<string | 'all'>('all');

    const { 
        selection: selectedForAdding, 
        setSelection: setSelectedForAdding, 
        hoveredId,
        listRef, 
        handleTouchStart,
        handleMouseDown
    } = useDragSelect();

    const allResourcesMap = useMemo(() => new Map(allResources.map(r => [r.id, r])), [allResources]);
    const stagedResourceIds = useMemo(() => new Set(stagedTasks.map(t => t.originalResourceId || t.resourceId)), [stagedTasks]);
    
    // Base pool of available resources for this modal
    const availableResources = useMemo(() => allResources.filter(res => !stagedResourceIds.has(res.id) && !res.isArchived), [allResources, stagedResourceIds]);
    
    // --- Intelligent Hierarchical Filtering ---
    
    // 1. Filtered list of resources based on all active filters
    const filteredAndSortedResources = useMemo(() => {
        const sTerm = searchTerm.trim().toLowerCase();
        return availableResources.filter(resource => {
            const domainMatch = domainFilter === 'all' || resource.domain === domainFilter;
            const typeMatch = typeFilter === 'all' || resource.type === typeFilter;
            const source = resource.bookSource || resource.videoSource;
            const sourceMatch = sourceFilter === 'all' || source === sourceFilter;
            const searchMatch = !sTerm || (
                resource.title.toLowerCase().includes(sTerm) || resource.id.toLowerCase().includes(sTerm) ||
                resource.domain.toLowerCase().includes(sTerm) || (source && source.toLowerCase().includes(sTerm))
            );
            return domainMatch && typeMatch && sourceMatch && searchMatch;
        }).sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999) || a.title.localeCompare(b.title));
    }, [availableResources, domainFilter, typeFilter, sourceFilter, searchTerm]);

    // 2. Dynamically determine available options for each dropdown based on *other* filters
    const availableDomains = useMemo(() => {
        const tasksForDomainFilter = availableResources.filter(r =>
            (typeFilter === 'all' || r.type === typeFilter) &&
            (sourceFilter === 'all' || (r.bookSource || r.videoSource) === sourceFilter)
        );
        return Array.from(new Set(tasksForDomainFilter.map(t => t.domain))).sort((a,b) => ALL_DOMAINS.indexOf(a) - ALL_DOMAINS.indexOf(b));
    }, [availableResources, typeFilter, sourceFilter]);

    const availableResourceTypes = useMemo(() => {
        const tasksForTypeFilter = availableResources.filter(r =>
            (domainFilter === 'all' || r.domain === domainFilter) &&
            (sourceFilter === 'all' || (r.bookSource || r.videoSource) === sourceFilter)
        );
        return Array.from(new Set(tasksForTypeFilter.map(t => t.type))).sort();
    }, [availableResources, domainFilter, sourceFilter]);

    const availableSources = useMemo(() => {
        const tasksForSourceFilter = availableResources.filter(r =>
            (domainFilter === 'all' || r.domain === domainFilter) &&
            (typeFilter === 'all' || r.type === typeFilter)
        );
        const sources = new Set<string>();
        tasksForSourceFilter.forEach(r => {
            const source = r.bookSource || r.videoSource;
            if (source) sources.add(source);
        });
        return Array.from(sources).sort();
    }, [availableResources, domainFilter, typeFilter]);
    
    // 3. Effects to reset a filter if its current selection becomes invalid
    useEffect(() => { if (!availableDomains.includes(domainFilter as Domain)) setDomainFilter('all'); }, [availableDomains, domainFilter]);
    useEffect(() => { if (!availableResourceTypes.includes(typeFilter as ResourceType)) setTypeFilter('all'); }, [availableResourceTypes, typeFilter]);
    useEffect(() => { if (!availableSources.includes(sourceFilter)) setSourceFilter('all'); }, [availableSources, sourceFilter]);

    // ------------------------------------------

    const [localHoveredId, setLocalHoveredId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setStagedTasks(JSON.parse(JSON.stringify(tasksForDay.sort((a, b) => a.order - b.order))));
            setSearchTerm('');
            setDomainFilter('all');
            setTypeFilter('all');
            setSourceFilter('all');
            setSelectedForAdding(new Set());
            setLocalHoveredId(null);
            setIsScheduledVisible(window.innerWidth >= 768);
            setIsAvailableVisible(true);
        }
    }, [isOpen, tasksForDay, setSelectedForAdding]);

    const finalHoveredId = hoveredId || localHoveredId;

    const highlightedIds = useMemo(() => {
        const finalIds = new Set<string>();
        if (finalHoveredId) {
            const resource = allResourcesMap.get(finalHoveredId);
             if (resource) {
                finalIds.add(resource.id);
                resource.pairedResourceIds?.forEach(pairedId => { if (allResourcesMap.has(pairedId)) finalIds.add(pairedId); });
            }
        }
        return finalIds;
    }, [finalHoveredId, allResourcesMap]);
    
    const handleStagedTaskDragStart = (e: React.DragEvent<HTMLDivElement>, task: ScheduledTask) => setDraggedTaskId(task.id);
    const handleStagedTaskDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();
    const handleStagedTaskDragEnd = () => setDraggedTaskId(null);

    const handleStagedTaskDrop = (e: React.DragEvent<HTMLDivElement>, targetTask: ScheduledTask) => {
        if (!draggedTaskId || draggedTaskId === targetTask.id) return;
        setStagedTasks(currentTasks => {
            const draggedIndex = currentTasks.findIndex(t => t.id === draggedTaskId);
            const targetIndex = currentTasks.findIndex(t => t.id === targetTask.id);
            if (draggedIndex > -1 && targetIndex > -1) {
                const newTasks = [...currentTasks];
                const [draggedItem] = newTasks.splice(draggedIndex, 1);
                newTasks.splice(targetIndex, 0, draggedItem);
                return newTasks;
            }
            return currentTasks;
        });
    };
    
    const addSelectedResources = () => {
        const resourcesToAdd = filteredAndSortedResources.filter(r => selectedForAdding.has(r.id));
        const newTasks: ScheduledTask[] = resourcesToAdd.map(res => ({
            id: `manual_${res.id}`, resourceId: res.id, title: res.title, type: res.type,
            originalTopic: res.domain, durationMinutes: res.durationMinutes, status: 'pending',
            order: 0, pages: res.pages, questionCount: res.questionCount,
            chapterNumber: res.chapterNumber, originalResourceId: res.id, isPrimaryMaterial: res.isPrimaryMaterial,
            bookSource: res.bookSource, videoSource: res.videoSource
        }));
        setStagedTasks(prev => [...prev, ...newTasks]);
        setSelectedForAdding(new Set());
    };
    
    const removeStagedTask = (taskId: string) => setStagedTasks(prev => prev.filter(t => t.id !== taskId));
    const handleSaveAndClose = () => onSave(stagedTasks);
    
    const domainOptions = [{ value: 'all', label: 'All Topics' }, ...availableDomains.map(d => ({ value: d, label: d }))];
    const typeOptions = [{ value: 'all', label: 'All Types' }, ...availableResourceTypes.map(t => ({ value: t, label: t }))];
    const sourceOptions = [{ value: 'all', label: 'All Sources' }, ...availableSources.map(s => ({ value: s, label: s }))];

    if (!isOpen) return null;
    const totalStagedTime = stagedTasks.reduce((acc, t) => acc + t.durationMinutes, 0);

    return (
        <FocusTrap active={isOpen}>
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-2 md:p-4 z-[var(--z-modal)]" role="dialog" aria-modal="true" aria-labelledby="modify-day-title">
                <div className="modal-panel static-glow-border w-full max-w-6xl text-[var(--text-primary)] flex flex-col max-h-[90vh]">
                    <header className="flex justify-between items-center p-3 md:p-4 flex-shrink-0 translucent-header">
                        <h2 id="modify-day-title" className="text-lg md:text-xl font-semibold">Modify Day: {new Date(selectedDate + 'T00:00:00').toLocaleDateString()}</h2>
                        <Button onClick={onClose} variant="ghost" size="sm" className="!p-1 !text-[var(--text-secondary)] hover:!text-[var(--text-primary)]" aria-label="Close">
                            <i className="fas fa-times fa-lg"></i>
                        </Button>
                    </header>
                    
                    <div className="flex-grow flex flex-col md:flex-row min-h-0">
                        <div className="w-full md:w-1/2 p-2 md:p-3 flex flex-col border-b md:border-b-0 md:border-r border-[var(--separator-primary)] min-h-0">
                             <button className="flex items-center justify-between py-1 flex-shrink-0 md:hidden" onClick={() => setIsScheduledVisible(v => !v)}>
                                <h3 className="text-base font-semibold text-[var(--text-primary)]">Scheduled ({formatDuration(totalStagedTime)})</h3>
                                <i className={`fas fa-chevron-down transition-transform ${isScheduledVisible ? 'rotate-180' : ''}`}></i>
                            </button>
                             <div className="hidden md:flex items-center justify-between mb-2 flex-shrink-0">
                                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Scheduled ({formatDuration(totalStagedTime)})</h3>
                                <Button variant="secondary" size="sm" onClick={() => setStagedTasks([])} disabled={stagedTasks.length === 0} className="!px-3 !py-1.5 !text-xs"><i className="fas fa-trash-alt mr-2"></i>Clear</Button>
                            </div>
                            <div className={`flex-grow overflow-y-auto space-y-2 pr-1 md:pr-2 -mr-1 md:-mr-2 min-h-0 ${isScheduledVisible ? 'block' : 'hidden'} md:block`}>
                                {stagedTasks.length > 0 ? stagedTasks.map(task => (
                                    <div key={task.id} className={`flex items-center p-1.5 md:p-2 rounded-lg bg-[var(--background-tertiary)] interactive-glow-border ${draggedTaskId === task.id ? 'opacity-50' : ''}`}
                                        draggable onDragStart={(e) => handleStagedTaskDragStart(e, task)} onDragOver={handleStagedTaskDragOver} onDrop={(e) => handleStagedTaskDrop(e, task)} onDragEnd={handleStagedTaskDragEnd}>
                                        <i className="fas fa-grip-vertical text-[var(--text-secondary)] mr-2 md:mr-3 cursor-grab"></i>
                                        <div className="flex-grow min-w-0">
                                            <p className="text-xs md:text-sm font-medium truncate" title={task.title}>{task.title}</p>
                                            <p className="text-xxs md:text-xs text-[var(--text-secondary)]">{task.originalTopic}</p>
                                        </div>
                                        <span className="text-xs md:text-sm font-semibold mx-2">{formatDuration(task.durationMinutes)}</span>
                                        <Button onClick={() => removeStagedTask(task.id)} variant="ghost" size="sm" className="!p-1 !text-red-400 hover:!bg-red-900/50"><i className="fas fa-times"></i></Button>
                                    </div>
                                )) : <div className="text-center p-8 text-gray-500 bg-black/20 rounded-lg">Add resources from the right</div>}
                            </div>
                        </div>

                        <div className="w-full md:w-1/2 p-2 md:p-3 flex flex-col min-h-0">
                            <button className="flex items-center justify-between py-1 flex-shrink-0 md:hidden" onClick={() => setIsAvailableVisible(v => !v)}>
                                <h3 className="text-base font-semibold text-[var(--text-primary)]">Available Resources</h3>
                                <i className={`fas fa-chevron-down transition-transform ${isAvailableVisible ? 'rotate-180' : ''}`}></i>
                            </button>
                             <div className={`flex-grow flex flex-col min-h-0 ${isAvailableVisible ? 'flex' : 'hidden'} md:flex`}>
                                <div className="space-y-2 md:space-y-3 mb-2 md:mb-3 flex-shrink-0">
                                    <h3 className="hidden md:block text-lg font-semibold text-[var(--text-primary)]">Available Resources</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        <CustomSelect value={domainFilter} onChange={val => setDomainFilter(val as Domain | 'all')} options={domainOptions} />
                                        <CustomSelect value={typeFilter} onChange={val => setTypeFilter(val as ResourceType | 'all')} options={typeOptions} />
                                        <CustomSelect value={sourceFilter} onChange={val => setSourceFilter(val as string | 'all')} options={sourceOptions} />
                                    </div>
                                    <input type="text" placeholder="Search resources..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-base !py-1.5 !text-sm" />
                                    <div className="flex items-center justify-between">
                                        <Button variant="primary" size="sm" onClick={addSelectedResources} disabled={selectedForAdding.size === 0} className="!px-3 !py-1.5 !text-xs"><i className="fas fa-plus mr-1 md:mr-2"></i>Add ({selectedForAdding.size})</Button>
                                        <Button variant="secondary" size="sm" onClick={openAddResourceModal} className="!px-3 !py-1.5 !text-xs"><i className="fas fa-plus-circle mr-1 md:mr-2"></i>New</Button>
                                    </div>
                                </div>
                                <div ref={listRef}
                                     className="resource-list-container flex-grow overflow-y-auto space-y-1.5 pr-1 md:pr-2 -mr-1 md:-mr-2 min-h-0"
                                     style={{ overscrollBehaviorY: 'contain' }}
                                     >
                                    {filteredAndSortedResources.length > 0 ? filteredAndSortedResources.map(res => (
                                        <ResourceCard 
                                            key={res.id} 
                                            resource={res} 
                                            isSelected={selectedForAdding.has(res.id)} 
                                            isHighlighted={highlightedIds.has(res.id)}
                                            onMouseEnter={setLocalHoveredId}
                                            onTouchStart={handleTouchStart}
                                            onMouseDown={handleMouseDown}
                                        />
                                    )) : <div className="text-center p-8 text-gray-500">No matching resources found.</div>}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <footer className="flex-shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3 border-t border-[var(--separator-primary)]">
                        <p className="text-xxs md:text-xs text-[var(--text-secondary)] text-center md:text-left flex-grow">
                           <strong>Select:</strong> Double-tap (Mobile) / Click (Desktop). <strong>Multi-Select:</strong> Long-press (Mobile) / Drag (Desktop).
                        </p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <Button variant="secondary" onClick={onClose}>Cancel</Button>
                            <Button variant="primary" onClick={handleSaveAndClose}>Save Changes & Rebalance</Button>
                        </div>
                    </footer>
                </div>
            </div>
        </FocusTrap>
    );
};

export default ModifyDayTasksModal;