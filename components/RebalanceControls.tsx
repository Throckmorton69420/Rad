import React, { useState } from 'react';
import { Domain, RebalanceControlsProps } from '../types';
import { Button } from './Button';
import { ALL_DOMAINS } from '../constants';
import TimeInputScroller from './TimeInputScroller';

const RebalanceControls = ({ onRebalance, isLoading, selectedDate, isCramModeActive, onToggleCramMode }: RebalanceControlsProps): JSX.Element => {
  const [showTopicTimeOptions, setShowTopicTimeOptions] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<Domain[]>([]);
  const [overallStudyTimeTotalMinutes, setOverallStudyTimeTotalMinutes] = useState<number>(240); 

  const handleSimpleRebalance = () => {
    onRebalance({ type: 'standard' }); 
  };

  const handleTopicSelect = (topic: Domain) => {
    setSelectedTopics(prev => 
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic].slice(0, 4) 
    );
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

  const nonSelectableDomains: Domain[] = [
    Domain.MIXED_REVIEW, 
    Domain.FINAL_REVIEW, 
    Domain.QUESTION_BANK_CATCHUP, 
    Domain.WEAK_AREA_REVIEW, 
    Domain.LIGHT_REVIEW
  ];

  return (
    <div className="p-4 rounded-lg space-y-3 bg-[var(--background-tertiary)] interactive-glow-border">
      <h2 className="text-lg font-semibold mb-2 border-b border-[var(--separator-primary)] pb-2 text-[var(--text-primary)]">Rebalance Schedule</h2>
      
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


      {showTopicTimeOptions && (
        <div className="p-3 bg-[var(--background-tertiary)] rounded-lg mt-2 space-y-3 animate-fade-in">
           <p className="text-sm font-medium text-[var(--text-primary)]">
             For Day: <span className="font-bold">{new Date(selectedDate + 'T00:00:00').toLocaleDateString()}</span>
           </p>
          <p className="text-sm font-medium text-[var(--text-primary)]">Select up to 4 topics:</p>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
            {ALL_DOMAINS.filter(d => !nonSelectableDomains.includes(d)).map(domain => (
              <label key={domain} className="flex items-center space-x-2 p-1.5 bg-[var(--background-tertiary-hover)] rounded-md text-xs hover:bg-zinc-600 cursor-pointer text-[var(--text-primary)]">
                <input 
                  type="checkbox" 
                  checked={selectedTopics.includes(domain)} 
                  onChange={() => handleTopicSelect(domain)}
                  className="form-checkbox h-3 w-3 text-[var(--accent-purple)] rounded border-gray-600 bg-gray-800 focus:ring-[var(--accent-purple)]"
                />
                <span>{domain}</span>
              </label>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-[var(--text-primary)]">New Total Study Time for Day:</label>
            <TimeInputScroller valueInMinutes={overallStudyTimeTotalMinutes} onChange={setOverallStudyTimeTotalMinutes} maxHours={12} />
          </div>
          <Button onClick={handleTopicTimeRebalance} className="w-full" size="sm" disabled={isLoading}>Apply Topic/Time Rebalance</Button>
        </div>
      )}
    </div>
  );
};

export default RebalanceControls;