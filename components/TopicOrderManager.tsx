import React, { useState, useEffect, useRef } from 'react';
import { Domain, TopicOrderManagerProps } from '../types';
import { Button } from './Button';

const TopicOrderManager: React.FC<TopicOrderManagerProps> = ({ 
  topicOrder, onSaveOrder, 
  cramTopicOrder = [], onSaveCramOrder,
  isLoading, 
  isCramModeActive,
  areSpecialTopicsInterleaved,
  onToggleSpecialTopicsInterleaving
}) => {
  const [localOrder, setLocalOrder] = useState<Domain[]>(topicOrder);
  const [draggedDomain, setDraggedDomain] = useState<Domain | null>(null);
  const dragItem = useRef<Domain | null>(null);

  const nonDraggableBaseTopics: Domain[] = [
      Domain.MIXED_REVIEW, 
      Domain.FINAL_REVIEW, 
      Domain.QUESTION_BANK_CATCHUP, 
      Domain.WEAK_AREA_REVIEW, 
      Domain.LIGHT_REVIEW
  ];

  useEffect(() => {
    setLocalOrder(isCramModeActive ? cramTopicOrder : topicOrder);
  }, [topicOrder, cramTopicOrder, isCramModeActive]);

  useEffect(() => {
    if (draggedDomain) {
      document.body.classList.add('is-dragging-item');
    } else {
      document.body.classList.remove('is-dragging-item');
    }
    return () => {
      document.body.classList.remove('is-dragging-item');
    };
  }, [draggedDomain]);
  
  const handleDragStart = (e: React.DragEvent, domain: Domain) => {
    dragItem.current = domain;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => setDraggedDomain(domain), 0);
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const overEl = (e.target as HTMLElement).closest('[data-domain]');
    if (!overEl || !dragItem.current) return;

    const overDomain = overEl.getAttribute('data-domain') as Domain;
    if (dragItem.current !== overDomain) {
      const dragItemIndex = localOrder.indexOf(dragItem.current);
      const overItemIndex = localOrder.indexOf(overDomain);
      if (dragItemIndex !== -1 && overItemIndex !== -1) {
        const newOrder = [...localOrder];
        const [removed] = newOrder.splice(dragItemIndex, 1);
        newOrder.splice(overItemIndex, 0, removed);
        setLocalOrder(newOrder);
      }
    }
  };

  const handleDragEnd = () => {
    dragItem.current = null;
    setDraggedDomain(null);
  };

  const handleTouchStart = (e: React.TouchEvent, domain: Domain) => {
    // e.preventDefault() is critical to stop scrolling AND text selection.
    e.preventDefault();
    e.stopPropagation(); 
    dragItem.current = domain;
    setDraggedDomain(domain);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragItem.current) return;
    
    const touch = e.touches[0];
    const overEl = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-domain]');
    
    if (overEl && overEl.getAttribute('data-domain')) {
      const overDomain = overEl.getAttribute('data-domain') as Domain;
      const dragDomain = dragItem.current;

      if (overDomain !== dragDomain) {
          const newOrder = [...localOrder];
          const dragIndex = newOrder.indexOf(dragDomain);
          const overIndex = newOrder.indexOf(overDomain);

          if (dragIndex > -1 && overIndex > -1) {
              const [draggedItem] = newOrder.splice(dragIndex, 1);
              newOrder.splice(overIndex, 0, draggedItem);
              setLocalOrder(newOrder);
          }
      }
    }
  };

  const handleTouchEnd = () => {
    dragItem.current = null;
    setDraggedDomain(null);
  };

  const handleSave = () => {
    if (isCramModeActive && onSaveCramOrder) {
      onSaveCramOrder(localOrder);
    } else {
      onSaveOrder(localOrder);
    }
  };
  
  const isDirty = JSON.stringify(localOrder) !== JSON.stringify(isCramModeActive ? cramTopicOrder : topicOrder);

  return (
    <div className="p-4 rounded-lg space-y-3 bg-[var(--background-tertiary)] interactive-glow-border">
      <h3 className="text-md font-semibold mb-1 text-[var(--text-primary)]">
        {isCramModeActive ? 'Cram Mode Topic Order' : 'Topic Order Manager'}
      </h3>
      <p className="text-xs text-[var(--text-secondary)] mb-2">Drag to set your study order. Disabling interleaving will schedule Physics/Nucs in large blocks based on their order below.</p>
      
      <div className="p-3 bg-purple-900/20 rounded-md space-y-2 border border-purple-800/50">
          <label className="flex items-center justify-between text-sm text-purple-200 cursor-pointer font-semibold">
              <span><i className="fas fa-random mr-2"></i> Interleave Physics & Nucs</span>
               <label className="ios-switch">
                    <input type="checkbox" checked={areSpecialTopicsInterleaved} onChange={(e) => onToggleSpecialTopicsInterleaving(e.target.checked)} id="interleave-toggle"/>
                    <span className="slider"></span>
                </label>
          </label>
          <p className="text-xxs text-purple-400/80 px-1">Recommended. Schedules topics in smaller, regular chunks.</p>
      </div>
      
      <ul onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        {localOrder.map((domain) => {
          const isSpecialInterleavedTopic = areSpecialTopicsInterleaved && (domain === Domain.PHYSICS || domain === Domain.NUCLEAR_MEDICINE);
          const isDraggable = !nonDraggableBaseTopics.includes(domain) && !isSpecialInterleavedTopic;
          const isDragging = draggedDomain === domain;

          return (
            <li
              key={domain}
              data-domain={domain}
              className={`topic-list-item flex items-center p-1.5 rounded-md backdrop-blur-lg relative interactive-glow-border ${isDraggable ? 'bg-[var(--background-tertiary)]' : 'bg-black/20 opacity-70'} ${isDragging ? 'is-dragging' : ''}`}
              onDragOver={(e) => isDraggable && handleDragOver(e)}
            >
              <div 
                className={`drag-handle ${isDraggable ? 'cursor-grab' : 'cursor-not-allowed'}`}
                draggable={isDraggable}
                onDragStart={(e) => isDraggable && handleDragStart(e, domain)}
                onDragEnd={isDraggable ? handleDragEnd : undefined}
                onTouchStart={(e) => isDraggable && handleTouchStart(e, domain)}
              >
                  <i className={`fas ${isDraggable ? 'fa-grip-vertical text-[var(--text-secondary)]' : 'fa-lock text-gray-500'}`}></i>
              </div>
              <span className={`flex-grow text-sm font-medium ${isDraggable ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{domain}</span>
            </li>
          );
        })}
      </ul>
      <Button onClick={handleSave} className="w-full mt-3" variant="primary" size="sm" disabled={isLoading || !isDirty}>
        <i className="fas fa-save mr-2"></i> Save Order & Rebalance
      </Button>
    </div>
  );
};

export default TopicOrderManager;