import React, { useEffect, useRef } from 'react';
import { DailySchedule, ViewMode, Domain } from '../types';
import { Button } from './Button';
import { getDomainColorStyle, parseDateString } from '../utils/timeFormatter';

interface CalendarViewProps {
  schedule: DailySchedule[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
  viewMode: ViewMode.MONTHLY | ViewMode.WEEKLY;
  currentDisplayDate: string; 
  onNavigatePeriod: (direction: 'next' | 'prev') => void; 
  highlightedDates?: string[];
  today: string;
}

const CalendarView: React.FC<CalendarViewProps> = ({ schedule, selectedDate, onDateSelect, viewMode, currentDisplayDate, onNavigatePeriod, highlightedDates = [], today }) => {
  const displayDateObj = parseDateString(currentDisplayDate);
  const scheduleMap = new Map(schedule.map(day => [day.date, day]));
  const gridRef = useRef<HTMLDivElement>(null);

  const getMajorDomainForDay = (day: DailySchedule): Domain | null => {
    if (!day || day.isRestDay || day.tasks.length === 0) return null;

    const timeByDomain: Partial<Record<Domain, number>> = {};
    day.tasks.forEach(task => {
        timeByDomain[task.originalTopic] = (timeByDomain[task.originalTopic] || 0) + task.durationMinutes;
    });

    let majorDomain: Domain | null = null;
    let maxTime = 0;
    for (const domain in timeByDomain) {
        if (timeByDomain[domain as Domain]! > maxTime) {
            maxTime = timeByDomain[domain as Domain]!;
            majorDomain = domain as Domain;
        }
    }
    return majorDomain;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentDate = parseDateString(selectedDate);
    let newDate = new Date(currentDate);

    switch (e.key) {
      case 'ArrowUp':
        newDate.setDate(currentDate.getDate() - 7);
        break;
      case 'ArrowDown':
        newDate.setDate(currentDate.getDate() + 7);
        break;
      case 'ArrowLeft':
        newDate.setDate(currentDate.getDate() - 1);
        break;
      case 'ArrowRight':
        newDate.setDate(currentDate.getDate() + 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    onDateSelect(newDate.toISOString().split('T')[0]);
  };
  
  useEffect(() => {
    const selectedButton = gridRef.current?.querySelector(`[data-date="${selectedDate}"]`) as HTMLButtonElement;
    selectedButton?.focus();
  }, [selectedDate, viewMode, currentDisplayDate]);


  const renderCalendarGrid = (days: { dateStr: string; dayOfMonth: number; isCurrentMonth?: boolean }[]) => {
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    return (
        <div ref={gridRef} onKeyDown={handleKeyDown} className="grid grid-cols-7 gap-1" role="grid" aria-label="Calendar">
            {dayNames.map(name => (
                <div key={`header-${name}`} className="text-center font-medium text-xs text-[var(--text-secondary)]" role="columnheader">{name}</div>
            ))}
            {days.map(({ dateStr, dayOfMonth, isCurrentMonth = true }) => {
                const daySchedule = scheduleMap.get(dateStr);
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === today;
                const isHighlighted = highlightedDates.includes(dateStr);
                const majorDomain = daySchedule ? getMajorDomainForDay(daySchedule) : null;
                const domainColor = majorDomain ? getDomainColorStyle(majorDomain).backgroundColor : null;


                const buttonClasses = [
                    'p-1.5', 'rounded-md', 'text-xs', 'text-center', 'focus:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-[var(--accent-purple)]',
                    'h-14 md:h-16', 'flex', 'flex-col', 'justify-between', 'items-center', 'relative', 'transition-all',
                    isSelected ? 'bg-[var(--accent-purple)] text-white static-glow-border' : 'bg-[var(--background-tertiary)] hover:bg-[var(--background-tertiary-hover)] text-[var(--text-primary)] interactive-glow-border',
                    isToday && !isSelected ? 'ring-1 ring-[var(--text-secondary)]' : '',
                    isHighlighted ? 'is-highlighted' : '',
                    daySchedule?.isRestDay && !isSelected ? 'opacity-50' : '',
                    !isCurrentMonth ? 'opacity-30 bg-black' : ''
                ].filter(Boolean).join(' ');

                return (
                    <button
                        key={dateStr}
                        onClick={() => onDateSelect(dateStr)}
                        className={buttonClasses}
                        data-date={dateStr}
                        role="gridcell"
                        aria-selected={isSelected}
                        aria-label={`${parseDateString(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. ${daySchedule ? (daySchedule.isRestDay ? 'Rest Day' : `${Math.round(daySchedule.totalStudyTimeMinutes / 60)} hours assigned.`) : 'No tasks.'}`}
                    >
                        <span className={`${isSelected ? 'font-bold' : ''}`}>{dayOfMonth}</span>
                        {domainColor && !isSelected && !daySchedule?.isRestDay && (
                           <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: domainColor }}></div>
                        )}
                        {daySchedule?.isManuallyModified && !isSelected && <i className="fas fa-hand-paper text-xxs text-[var(--accent-yellow)] absolute top-1 right-1" title="Manually Modified"></i>}
                        {daySchedule && !daySchedule.isRestDay && daySchedule.totalStudyTimeMinutes > 0 && (
                            <span className={`mt-auto text-xxs px-1 py-0.5 rounded ${isSelected ? 'bg-black/30' : 'bg-[var(--background-secondary)]'}`}>
                                {Math.round(daySchedule.totalStudyTimeMinutes / 60)}h
                            </span>
                        )}
                        {daySchedule?.isRestDay && (
                            <i className="fas fa-coffee text-xxs self-center mt-auto text-gray-500"></i>
                        )}
                    </button>
                );
            })}
        </div>
    );
  };

  const renderMonthCalendar = () => {
    const year = displayDateObj.getFullYear();
    const month = displayDateObj.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();
    const startingDayOfWeek = firstDayOfMonth.getDay();

    const calendarDays: { dateStr: string; dayOfMonth: number; isCurrentMonth: boolean }[] = [];

    // Days from previous month
    const prevMonthLastDay = new Date(year, month, 0);
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthLastDay.getDate() - i;
        const date = new Date(year, month - 1, day);
        calendarDays.push({ dateStr: date.toISOString().split('T')[0], dayOfMonth: day, isCurrentMonth: false });
    }

    // Days of current month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        calendarDays.push({ dateStr, dayOfMonth: day, isCurrentMonth: true });
    }

    // Days from next month
    const totalCells = calendarDays.length;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remainingCells; i++) {
        const date = new Date(year, month + 1, i);
        calendarDays.push({ dateStr: date.toISOString().split('T')[0], dayOfMonth: i, isCurrentMonth: false });
    }

    return renderCalendarGrid(calendarDays);
  };
  
  const renderWeekCalendar = () => {
    const year = displayDateObj.getFullYear();
    const month = displayDateObj.getMonth();
    const dayInSelectedWeek = displayDateObj.getDate();
    
    const currentDayOfWeek = displayDateObj.getDay();
    const firstDayOfWeek = new Date(year, month, dayInSelectedWeek - currentDayOfWeek);

    const calendarDays: { dateStr: string; dayOfMonth: number; }[] = [];

    for(let i=0; i<7; i++) {
        const weekDay = new Date(firstDayOfWeek);
        weekDay.setDate(firstDayOfWeek.getDate() + i);
        calendarDays.push({ dateStr: weekDay.toISOString().split('T')[0], dayOfMonth: weekDay.getDate() });
    }
     return renderCalendarGrid(calendarDays);
  }

  return (
    <div className="p-3 md:p-4 rounded-lg bg-[var(--background-tertiary)] interactive-glow-border">
      <div className="flex justify-between items-center mb-3 gap-2">
        <Button onClick={() => onNavigatePeriod('prev')} variant="ghost" size="sm" className="!px-2" aria-label="Previous Period"><i className="fas fa-chevron-left"></i></Button>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] text-center flex-grow" aria-live="polite">
          {viewMode === ViewMode.MONTHLY 
            ? displayDateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
            : `Week of ${displayDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        </h3>
        <Button 
            onClick={() => onDateSelect(today)} 
            variant="secondary" size="sm" 
            className="!px-2.5 !text-sm flex-shrink-0"
            aria-label="Go to Today"
        >
            Today
        </Button>
        <Button onClick={() => onNavigatePeriod('next')} variant="ghost" size="sm" className="!px-2" aria-label="Next Period"><i className="fas fa-chevron-right"></i></Button>
      </div>
      {viewMode === ViewMode.MONTHLY ? renderMonthCalendar() : renderWeekCalendar()}
    </div>
  );
};

export default CalendarView;