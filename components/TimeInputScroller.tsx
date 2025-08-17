import React, { useMemo, useRef, useEffect } from 'react';

interface TimeInputScrollerProps {
  valueInMinutes: number;
  onChange: (totalMinutes: number) => void;
  maxHours?: number;
  disabled?: boolean;
}

const ITEM_HEIGHT = 32; // Corresponds to h-8 in Tailwind

const TimeInputScroller: React.FC<TimeInputScrollerProps> = ({ 
  valueInMinutes, 
  onChange, 
  maxHours = 12,
  disabled = false
}) => {
  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);

  const isProgrammaticScrollHours = useRef(false);
  const isProgrammaticScrollMinutes = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const hours = useMemo(() => Array.from({ length: maxHours + 1 }, (_, i) => i), [maxHours]);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);

  const extendedHours = useMemo(() => [...hours, ...hours, ...hours], [hours]);
  const extendedMinutes = useMemo(() => [...minutes, ...minutes, ...minutes], [minutes]);

  useEffect(() => {
    const initialHour = Math.floor(valueInMinutes / 60);
    const initialMinute = valueInMinutes % 60;

    if (hoursRef.current) {
        isProgrammaticScrollHours.current = true;
        hoursRef.current.scrollTop = (hours.length + initialHour) * ITEM_HEIGHT;
        setTimeout(() => { isProgrammaticScrollHours.current = false; }, 150);
    }
    if (minutesRef.current) {
        isProgrammaticScrollMinutes.current = true;
        minutesRef.current.scrollTop = (minutes.length + initialMinute) * ITEM_HEIGHT;
        setTimeout(() => { isProgrammaticScrollMinutes.current = false; }, 150);
    }
  }, [valueInMinutes, hours.length, minutes.length]);

  const handleScroll = (type: 'hours' | 'minutes') => {
    const ref = type === 'hours' ? hoursRef : minutesRef;
    const isProgrammaticRef = type === 'hours' ? isProgrammaticScrollHours : isProgrammaticScrollMinutes;
    const list = type === 'hours' ? hours : minutes;
    
    if (isProgrammaticRef.current || !ref.current) return;

    const { scrollTop } = ref.current;
    
    // Teleport scroll to maintain infinite illusion
    if (scrollTop < ITEM_HEIGHT * list.length * 0.5) {
      isProgrammaticRef.current = true;
      ref.current.scrollTop += list.length * ITEM_HEIGHT;
      setTimeout(() => { isProgrammaticRef.current = false; }, 50);
    } else if (scrollTop >= ITEM_HEIGHT * list.length * 2.5) {
      isProgrammaticRef.current = true;
      ref.current.scrollTop -= list.length * ITEM_HEIGHT;
      setTimeout(() => { isProgrammaticRef.current = false; }, 50);
    }

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    scrollTimeoutRef.current = window.setTimeout(() => {
        if(!ref.current) return;
        const scrollIndex = Math.round(ref.current.scrollTop / ITEM_HEIGHT);
        const value = (type === 'hours' ? extendedHours : extendedMinutes)[scrollIndex];
        
        const currentHours = Math.floor(valueInMinutes / 60);
        const currentMinutes = valueInMinutes % 60;
        
        const newTotalMinutes = type === 'hours' 
            ? value * 60 + currentMinutes
            : currentHours * 60 + value;
            
        if (newTotalMinutes !== valueInMinutes) {
          onChange(newTotalMinutes);
        }
    }, 150);
  };

  const containerClasses = `flex justify-center items-center h-40 bg-[var(--background-tertiary)] rounded-lg overflow-hidden relative static-glow-border ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
  const highlightClasses = "absolute top-1/2 -translate-y-1/2 h-8 w-full bg-white/10 border-y border-[var(--accent-purple)] rounded-lg pointer-events-none scroller-highlight-glow";
  
  const scrollContainerClasses = "w-1/2 h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar";

  return (
    <div className={containerClasses}>
       {disabled && <div className="absolute inset-0 z-10"></div>}
      <div className={highlightClasses}></div>
      <div 
        ref={hoursRef}
        onScroll={() => handleScroll('hours')}
        className={scrollContainerClasses}
      >
        <div className="pt-[calc(50%-16px)] pb-[calc(50%-16px)]">
          {extendedHours.map((h, i) => (
            <div key={`hr-${i}`} className="h-8 flex items-center justify-center text-lg snap-center flex-shrink-0 text-[var(--text-primary)]">
              {h}
            </div>
          ))}
        </div>
      </div>
      <span className="text-lg font-bold text-[var(--text-secondary)] -mt-0.5">:</span>
      <div 
        ref={minutesRef}
        onScroll={() => handleScroll('minutes')}
        className={scrollContainerClasses}
      >
        <div className="pt-[calc(50%-16px)] pb-[calc(50%-16px)]">
          {extendedMinutes.map((m, i) => (
            <div key={`min-${i}`} className="h-8 flex items-center justify-center text-lg snap-center flex-shrink-0 text-[var(--text-primary)]">
              {String(m).padStart(2, '0')}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TimeInputScroller;