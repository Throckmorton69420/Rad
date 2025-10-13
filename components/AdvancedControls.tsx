import React, { useState, useEffect } from 'react';
// FIX: Corrected import path for types.
import { Domain, AdvancedControlsProps, DeadlineSettings } from '../types';
import { Button } from './Button';
import TimeInputScroller from './TimeInputScroller';
import { parseDateString } from '../utils/timeFormatter';
import { ALL_DOMAINS } from '../constants';

const DeadlineManager: React.FC<{
    deadlines: DeadlineSettings;
    onUpdate: (newDeadlines: DeadlineSettings) => void;
    isLoading: boolean;
}> = ({ deadlines, onUpdate, isLoading }) => {
    const [localDeadlines, setLocalDeadlines] = useState(deadlines);

    useEffect(() => {
        setLocalDeadlines(deadlines);
    }, [deadlines]);

    const handleDateChange = (key: keyof DeadlineSettings, value: string) => {
        // FIX: Cast key to string to prevent "implicit conversion of a 'symbol' to a 'string'" error.
        setLocalDeadlines(prev => ({ ...prev, [key as string]: value || undefined }));
    };

    const handleSave = () => {
        onUpdate(localDeadlines);
    };

    const isDirty = JSON.stringify(localDeadlines) !== JSON.stringify(deadlines);

    const DeadlineInput: React.FC<{ dKey: keyof DeadlineSettings, label: string }> = ({ dKey, label }) => (
        <div>
            <label htmlFor={`deadline-${dKey}`} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{label}:</label>
            <input
                type="date"
                id={`deadline-${dKey}`}
                value={localDeadlines[dKey] || ''}
                onChange={(e) => handleDateChange(dKey, e.target.value)}
                className="input-base text-sm"
                disabled={isLoading}
            />
        </div>
    );

    return (
        <div className="p-3 glass-panel rounded-lg mt-2 space-y-3 animate-fade-in">
            <h4 className="text-md font-semibold text-[var(--text-primary)]">Deadline Manager</h4>
            <p className="text-xxs text-[var(--text-secondary)]">Set target completion dates for primary content. The scheduler will adjust daily hours to meet these goals.</p>
            <div className="grid grid-cols-2 gap-2">
                <DeadlineInput dKey="allContent" label="All Content" />
                <DeadlineInput dKey="physicsContent" label="Physics Content" />
                <DeadlineInput dKey="nucMedContent" label="Nuclear Med Content" />
                <DeadlineInput dKey="otherContent" label="Other Content" />
            </div>
            <Button onClick={handleSave} className="w-full" size="sm" disabled={isLoading || !isDirty}>
                Save Deadlines & Rebalance
            </Button>
        </div>
    );
};

const PlanDateManager: React.FC<{
    startDate: string;
    endDate: string;
    onUpdate: (startDate: string, endDate: string) => void;
    isLoading: boolean;
}> = ({ startDate, endDate, onUpdate, isLoading }) => {
    const [localStart, setLocalStart] = useState(startDate);
    const [localEnd, setLocalEnd] = useState(endDate);

    useEffect(() => {
        setLocalStart(startDate);
        setLocalEnd(endDate);
    }, [startDate, endDate]);

    const handleSave = () => {
        if (localStart >= localEnd) {
            alert("Start date must be before the end date.");
            return;
        }
        onUpdate(localStart, localEnd);
    };
    
    const isDirty = localStart !== startDate || localEnd !== endDate;

    return (
        <div className="p-3 glass-panel rounded-lg mt-2 space-y-3 animate-fade-in">
            <h4 className="text-md font-semibold text-[var(--text-primary)]">Plan Dates</h4>
            <p className="text-xxs text-[var(--text-secondary)]">Warning: Changing dates will regenerate the entire schedule from scratch and reset progress.</p>
            <div className="grid grid-cols-2 gap-2">
                 <div>
                    <label htmlFor="plan-start-date" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Start Date:</label>
                    <input type="date" id="plan-start-date" value={localStart} onChange={(e) => setLocalStart(e.target.value)} className="input-base text-sm" disabled={isLoading} />
                </div>
                <div>
                    <label htmlFor="plan-end-date" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">End Date:</label>
                    <input type="date" id="plan-end-date" value={localEnd} onChange={(e) => setLocalEnd(e.target.value)} className="input-base text-sm" disabled={isLoading} />
                </div>
            </div>
            <Button onClick={handleSave} className="w-full" size="sm" variant="danger" disabled={isLoading || !isDirty}>
                Save Dates & Regenerate Plan
            </Button>
        </div>
    );
};


const AdvancedControls: React.FC<AdvancedControlsProps> = ({ 
    onRebalance, isLoading, selectedDate, isCramModeActive, onToggleCramMode,
    deadlines, onUpdateDeadlines, startDate, endDate, onUpdateDates,
}) => {
  const [showTopicTimeOptions, setShowTopicTimeOptions] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<Domain[]>([]);
  const [overallStudyTimeTotalMinutes, setOverallStudyTimeTotalMinutes] = useState<number>(240); 
  const [showDeadlineManager, setShowDeadlineManager] = useState(false);
  const [showDateManager, setShowDateManager] = useState(false);

  const handleSimpleRebalance = () => {
    onRebalance({ type: 'standard' }); 
  };
  
  const handleTopicTimeRebalance = () => {
    if (selectedTopics.length === 0) {
      alert("Please select at least one topic.");
      return;
    }
    if (overallStudyTimeTotalMinutes < 30) {
        alert("Minimum overall study time is 30 minutes.");
        setOverallStudyTimeTotalMinutes(30);
        return;
    }
    onRebalance({
      type: 'topic-time',
      date: selectedDate,
      topics: selectedTopics,
      totalTimeMinutes: overallStudyTimeTotalMinutes
    });
    setShowTopicTimeOptions(false);
  };
  
  const handleTopicToggle = (domainToToggle: Domain) => {
    setSelectedTopics(prev => {
        const isSelected = prev.includes(domainToToggle);
        if (isSelected) {
            return prev.filter(d => d !== domainToToggle);
        } else {
            if (prev.length < 4) {
                return [...prev, domainToToggle];
            }
            alert("You can select up to 4 topics.");
            return prev;
        }
    });
};

  return (
    <div className="p-4 rounded-lg space-y-3 glass-panel">
      <h2 className="text-lg font-semibold mb-2 border-b border-[var(--separator-primary)] pb-2 text-[var(--text-primary)]">Advanced Controls</h2>
      
      <div className="p-3 bg-yellow-900/20 rounded-md space-y-2 border border-yellow-800/50">
          <label className="flex items-center justify-between text-sm text-yellow-200 cursor-pointer font-semibold">
              <span><i className="fas fa-bolt mr-2"></i> Cram Mode</span>
               <label className="ios-switch yellow">
                    <input type="checkbox" checked={isCramModeActive} onChange={(e) => onToggleCramMode(e.target.checked)} id="cram-mode-toggle"/>
                    <span className="slider"></span>
                </label>
          </label>
          <p className="text-xxs text-yellow-400/80 px-1">Prioritizes all Titan Radiology videos ASAP.</p>
      </div>
      
      <Button onClick={handleSimpleRebalance} variant="secondary" className="w-full" disabled={isLoading}><i className="fas fa-sync-alt mr-2"></i> Rebalance Future</Button>
      
      <Button onClick={() => setShowTopicTimeOptions(!showTopicTimeOptions)} variant="secondary" className="w-full" disabled={isLoading}>
        <i className={`fas fa-tasks mr-2`}></i> Rebalance Today by Topic/Time
      </Button>

      {showTopicTimeOptions && (
        <div className="p-3 glass-panel rounded-lg mt-2 space-y-3 animate-fade-in">
          <h4 className="text-md font-semibold">Rebalance for <span className="text-[var(--accent-purple)]">{parseDateString(selectedDate).toLocaleDateString()}</span></h4>
          
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">1. Select up to 4 priority topics:</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {ALL_DOMAINS.map(domain => (
                <button key={domain} onClick={() => handleTopicToggle(domain)}
                  className={`p-1.5 text-xxs font-semibold rounded-md transition-colors ${selectedTopics.includes(domain) ? 'bg-[var(--accent-purple)] text-white' : 'bg-black/40 hover:bg-black/60'}`}>
                  {domain}
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">2. Set total study time for the day:</label>
            <TimeInputScroller valueInMinutes={overallStudyTimeTotalMinutes} onChange={setOverallStudyTimeTotalMinutes} maxHours={14} />
          </div>
          
          <Button onClick={handleTopicTimeRebalance} className="w-full" disabled={isLoading || selectedTopics.length === 0}>
            Apply & Rebalance Rest of Plan
          </Button>
        </div>
      )}

      <Button onClick={() => setShowDeadlineManager(s => !s)} variant="secondary" className="w-full" disabled={isLoading}>
          <i className="fas fa-bullseye mr-2"></i> Manage Content Deadlines
      </Button>
      {showDeadlineManager && <DeadlineManager deadlines={deadlines} onUpdate={onUpdateDeadlines} isLoading={isLoading} />}
      
      <Button onClick={() => setShowDateManager(s => !s)} variant="secondary" className="w-full" disabled={isLoading}>
          <i className="fas fa-calendar-alt mr-2"></i> Change Plan Dates
      </Button>
      {showDateManager && <PlanDateManager startDate={startDate} endDate={endDate} onUpdate={onUpdateDates} isLoading={isLoading} />}
    </div>
  );
};

export default AdvancedControls;
