// FIX: Imported React to resolve namespace errors.
import * as React from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';

interface InteractionState {
  mode: 'idle' | 'pending' | 'scrolling' | 'dragging';
  isDeselectDrag: boolean;
  longPressTimeout: number | null;
  autoScrollInterval: number | null;
  anchorId: string | null;
  startX: number;
  startY: number;
  lastTapTimestamp: number;
}

export const useDragSelect = () => {
  const [selection, setSelection] = useState(new Set<string>());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const state = useRef<InteractionState>({
    mode: 'idle',
    isDeselectDrag: false,
    longPressTimeout: null,
    autoScrollInterval: null,
    anchorId: null,
    startX: 0,
    startY: 0,
    lastTapTimestamp: 0,
  }).current;

  const getResourceIdFromTarget = (target: EventTarget | null): string | null => {
    return (target as HTMLElement)?.closest('[data-resource-id]')?.getAttribute('data-resource-id') || null;
  };

  const stopAutoScroll = useCallback(() => {
    if (state.autoScrollInterval) {
      clearInterval(state.autoScrollInterval);
      state.autoScrollInterval = null;
    }
  }, [state]);

  const endInteraction = useCallback(() => {
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    window.removeEventListener('touchcancel', handleTouchEnd);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    
    if (state.longPressTimeout) clearTimeout(state.longPressTimeout);
    stopAutoScroll();

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    
    setHoveredId(null);
    state.mode = 'idle';
  }, [state, stopAutoScroll]);

  const startDragSelection = useCallback((resourceId: string) => {
    if (state.mode !== 'pending') return;

    document.documentElement.style.overflow = 'hidden';

    state.mode = 'dragging';
    state.anchorId = resourceId;

    setSelection(prev => {
      state.isDeselectDrag = prev.has(resourceId);
      const newSet = new Set(prev);
      if (state.isDeselectDrag) newSet.delete(resourceId);
      else newSet.add(resourceId);
      return newSet;
    });

  }, [state]);

  const dragSelectionMove = useCallback((x: number, y: number) => {
      const listEl = listRef.current;
      if (!listEl) return;

      const listRect = listEl.getBoundingClientRect();
      const scrollZone = 60;
      let scrollSpeed = 0;
      if (y < listRect.top + scrollZone) scrollSpeed = -10;
      else if (y > listRect.bottom - scrollZone) scrollSpeed = 10;
      
      if (scrollSpeed !== 0 && !state.autoScrollInterval) {
        state.autoScrollInterval = window.setInterval(() => listEl.scrollTop += scrollSpeed, 50);
      } else if (scrollSpeed === 0) {
        stopAutoScroll();
      }

      const currentElement = document.elementFromPoint(x, y);
      const currentId = getResourceIdFromTarget(currentElement);
      
      if (currentId && state.anchorId) {
        const children = Array.from(listEl.children);
        // FIX: Add explicit 'Element' type to child to resolve getAttribute error on type 'unknown'.
        const visibleIds = children.map((child: Element) => child.getAttribute('data-resource-id')!);
        const anchorIndex = visibleIds.indexOf(state.anchorId);
        const currentIndex = visibleIds.indexOf(currentId);

        if (anchorIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(anchorIndex, currentIndex);
          const end = Math.max(anchorIndex, currentIndex);
          const idsToModify = new Set(visibleIds.slice(start, end + 1));
          
          setSelection(prev => {
            const newSet = new Set(prev);
            idsToModify.forEach(id => {
              if (state.isDeselectDrag) newSet.delete(id);
              else newSet.add(id);
            });
            return newSet;
          });
        }
      }
  }, [state, stopAutoScroll]);

  // FIX: Added native TouchEvent type to resolve type errors.
  const handleTouchMove = (e: TouchEvent) => {
    if (state.mode === 'pending') {
      const dx = Math.abs(e.touches[0].clientX - state.startX);
      const dy = Math.abs(e.touches[0].clientY - state.startY);
      if (dx > 10 || dy > 10) {
        if (state.longPressTimeout) clearTimeout(state.longPressTimeout);
        state.mode = 'scrolling';
      }
    }
    if (state.mode === 'dragging') {
      e.preventDefault();
      dragSelectionMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  // FIX: Added native MouseEvent type to resolve type errors.
  const handleMouseMove = (e: MouseEvent) => {
    if (state.mode === 'pending') {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx > 10 || dy > 10) {
        if (state.longPressTimeout) clearTimeout(state.longPressTimeout);
        startDragSelection(state.anchorId!);
      }
    }
    if (state.mode === 'dragging') {
      e.preventDefault();
      dragSelectionMove(e.clientX, e.clientY);
    }
  };

  // FIX: Added native TouchEvent type to resolve type errors.
  const handleTouchEnd = (e: TouchEvent) => {
      const resourceId = getResourceIdFromTarget(e.changedTouches[0].target);
      if (state.mode === 'pending' && resourceId) {
        const now = Date.now();
        if (now - state.lastTapTimestamp < 300) {
          setSelection(prev => {
            const newSet = new Set(prev);
            if (newSet.has(resourceId)) newSet.delete(resourceId);
            else newSet.add(resourceId);
            return newSet;
          });
        }
        state.lastTapTimestamp = now;
      }
      endInteraction();
  };

  // FIX: Added native MouseEvent type to resolve type errors.
  const handleMouseUp = (e: MouseEvent) => {
      const resourceId = getResourceIdFromTarget(e.target);
      if (state.mode === 'pending' && resourceId) {
        setSelection(prev => {
            const newSet = new Set(prev);
            if (newSet.has(resourceId)) newSet.delete(resourceId);
            else newSet.add(resourceId);
            return newSet;
        });
      }
      endInteraction();
  };
  
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const resourceId = getResourceIdFromTarget(e.target as EventTarget);
    if (!resourceId) return;
    
    state.mode = 'pending';
    state.startX = e.touches[0].clientX;
    state.startY = e.touches[0].clientY;
    state.anchorId = resourceId;

    setHoveredId(resourceId);

    state.longPressTimeout = window.setTimeout(() => startDragSelection(resourceId), 400);

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
  }, [state, startDragSelection]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const resourceId = getResourceIdFromTarget(e.target as EventTarget);
    if (!resourceId) return;
    
    e.preventDefault();
    state.mode = 'pending';
    state.startX = e.clientX;
    state.startY = e.clientY;
    state.anchorId = resourceId;

    setHoveredId(resourceId);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [state]);

  useEffect(() => {
    return () => endInteraction();
  }, [endInteraction]);

  return { selection, setSelection, hoveredId, listRef, handleTouchStart, handleMouseDown };
};