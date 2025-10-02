import React, { useState, useEffect } from 'react';
import { Domain, AdvancedControlsProps, DeadlineSettings } from '../types';
import { Button } from './Button';
import TimeInputScroller from './TimeInputScroller';
import { parseDateString } from '../utils/timeFormatter';

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
        setLocalDeadlines(prev => ({ ...prev, [key]: value || undefined }));
    };

    const handleSave = () => {
        onUpdate(localDeadlines);
    };

    const isDirty = JSON.stringify(localDeadlines) !== JSON.stringify(deadlines);

    const DeadlineInput: React.FC<{ dKey: keyof DeadlineSettings, label: string }> = ({ dKey, label }) => (
        <div>
            <label htmlFor={`deadline-${dKey}`} className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{label}:</label>
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
        <div className="p-3 bg-[var(--background-tertiary)] rounded-lg mt-2 space-y-3 animate-fade-in">
            <h4 className="text-md font-semibold text-[var(--text-primary)]">Deadline Manager</h4>
            <p className="text-xxs text-[var(--text-secondary)] -mt-2">Set target completion dates for primary content. The scheduler will adjust daily hours to meet these goals.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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


// FIX: Changed component to use React.FC to resolve "Cannot find namespace 'JSX'" error and align with project conventions.
const AdvancedControls: React.FC<AdvancedControlsProps> = ({ 
    onRebalance, isLoading, selectedDate, isCramModeActive, onToggleCramMode,
    deadlines, onUpdateDeadlines 
}) => {
  const [showTopicTimeOptions, setShowTopicTimeOptions] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<Domain[]>([]);
  const [overallStudyTimeTotalMinutes, setOverallStudyTimeTotalMinutes] = useState<number>(240); 
  const [showDeadlineManager, setShowDeadlineManager] = useState(false);

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


  return (
    <div className="p-4 rounded-lg space-y-3 bg-[var(--background-tertiary)] interactive-glow-border">
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

      <div>
        <Button onClick={handleSimpleRebalance} className="w-full" variant="secondary" disabled={isLoading}>
          <i className="fas fa-calendar-day mr-2"></i> Standard Rebalance
        </Button>
        <p className="text-xxs text-[var(--text-secondary)] mt-1 px-1">Preserves past work and reschedules all future tasks.</p>
      </div>
      <div>
        <Button onClick={() => setShowTopicTimeOptions(!showTopicTimeOptions)} className="w-full" variant="secondary" disabled={isLoading}>
          <i className="fas fa-sliders-h mr-2"></i> Topic/Time Specific
        </Button>
        <p className="text-xxs text-[var(--text-secondary)] mt-1 px-1">Modifies a single day, then reschedules future tasks.</p>
      </div>
      <div>
        <Button onClick={() => setShowDeadlineManager(!showDeadlineManager)} className="w-full" variant="secondary" disabled={isLoading}>
            <i className="fas fa-flag-checkered mr-2"></i> Set Content Deadlines
        </Button>
        <p className="text-xxs text-[var(--text-secondary)] mt-1 px-1">Set target dates for content completion.</p>
      </div>


      {showTopicTimeOptions && (
        <div className="p-3 bg-[var(--background-tertiary)] rounded-lg mt-2 space-y-3 animate-fade-in">
           <p className="text-sm font-medium text-[var(--text-primary)]">
             For Day: <span className="font-bold">{parseDateString(selectedDate).toLocaleDateString()}</span>
           </p>
          <p className="text-sm font-medium text-[var(--text-primary)]">Select up to 4 topics (Not available)</p>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-[var(--text-primary)]">New Total Study Time for Day:</label>
            <TimeInputScroller valueInMinutes={overallStudyTimeTotalMinutes} onChange={setOverallStudyTimeTotalMinutes} maxHours={12} />
          </div>
          <Button onClick={handleTopicTimeRebalance} className="w-full" size="sm" disabled={isLoading || true}>Apply Topic/Time Rebalance</Button>
        </div>
      )}

      {showDeadlineManager && (
          <DeadlineManager deadlines={deadlines} onUpdate={onUpdateDeadlines} isLoading={isLoading} />
      )}
    </div>
  );
};

export default AdvancedControls;