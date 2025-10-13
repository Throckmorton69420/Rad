import React, { useEffect, useState } from 'react';
// FIX: Corrected import path for types.
import { PomodoroSettings } from '../types';
import { Button } from './Button';
import TimeInputScroller from './TimeInputScroller';
import { formatDuration } from '../utils/timeFormatter';

interface PomodoroTimerProps {
  settings: PomodoroSettings;
  setSettings: React.Dispatch<React.SetStateAction<PomodoroSettings>>;
  onSessionComplete: (sessionType: 'study' | 'rest', durationMinutes: number) => void;
  linkedTaskTitle?: string | null;
}

const PomodoroTimer: React.FC<PomodoroTimerProps> = ({ settings, setSettings, onSessionComplete, linkedTaskTitle }) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  
  useEffect(() => {
    let timer: number | undefined;
    if (settings.isActive && settings.timeLeft > 0) {
      timer = window.setTimeout(() => {
        setSettings(prev => ({ ...prev, timeLeft: prev.timeLeft - 1 }));
      }, 1000);
    } else if (settings.isActive && settings.timeLeft <= 0) {
      const completedSessionType = settings.isStudySession ? 'study' : 'rest';
      const completedDuration = settings.isStudySession ? settings.studyDuration : settings.restDuration;
      
      onSessionComplete(completedSessionType, completedDuration);
      
      setSettings(prev => ({
        ...prev,
        isStudySession: !prev.isStudySession,
        timeLeft: (!prev.isStudySession ? prev.studyDuration : prev.restDuration) * 60,
      }));
    }
    return () => clearTimeout(timer);
  }, [settings.isActive, settings.timeLeft, setSettings, onSessionComplete]);

  const toggleTimer = () => {
    setSettings(prev => ({ ...prev, isActive: !prev.isActive }));
  };

  const resetTimer = () => {
    setSettings(prev => ({
      ...prev,
      isActive: false,
      timeLeft: prev.isStudySession ? prev.studyDuration * 60 : prev.restDuration * 60,
    }));
  };
  
  const handleDurationChange = (type: 'studyDuration' | 'restDuration', newTotalMinutes: number) => {
    setSettings(prev => {
      if (newTotalMinutes < 1) newTotalMinutes = 1;

      const updatedSettings = { ...prev, [type]: newTotalMinutes };

      if (!prev.isActive) {
        if ((type === 'studyDuration' && prev.isStudySession) || (type === 'restDuration' && !prev.isStudySession)) {
          updatedSettings.timeLeft = newTotalMinutes * 60;
        }
      }
      return updatedSettings;
    });
  };

  const addFiveMinutes = () => {
    setSettings(prev => ({
      ...prev,
      timeLeft: prev.timeLeft + 300,
    }));
  };

  const formatTime = (seconds: number) => {
    if (seconds < 0) seconds = 0;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="p-4 rounded-lg text-center text-[var(--text-primary)] glass-panel">
      <div className="text-3xl font-mono mb-2 text-white">
        {formatTime(settings.timeLeft)}
      </div>
      <div className="text-sm uppercase tracking-wider mb-1 text-[var(--text-secondary)]">
        {settings.isStudySession ? 'Study Session' : 'Rest Session'}
      </div>
      {linkedTaskTitle && (
          <div className="text-xs text-[var(--accent-purple)] mb-3 truncate px-2" title={linkedTaskTitle}>
            <i className="fas fa-link mr-1"></i>
            {linkedTaskTitle}
          </div>
      )}
      <div className="flex justify-center space-x-2 mb-4">
        <Button onClick={toggleTimer} variant={settings.isActive ? 'danger' : 'primary'} size="sm">
          {settings.isActive ? <i className="fas fa-pause mr-1"></i> : <i className="fas fa-play mr-1"></i>}
          {settings.isActive ? 'Pause' : 'Start'}
        </Button>
        <Button onClick={resetTimer} variant="secondary" size="sm">
          <i className="fas fa-redo mr-1"></i> Reset
        </Button>
        <Button onClick={addFiveMinutes} variant="secondary" size="sm" title="Add 5 minutes">
            +5m
        </Button>
        <Button onClick={() => setIsPickerOpen(!isPickerOpen)} variant="ghost" size="sm" className="!px-2">
          <i className="fas fa-cog"></i>
        </Button>
      </div>
      {isPickerOpen && (
        <div className="space-y-3 text-xs pt-3 border-t border-[var(--separator-secondary)]">
          <div>
            <label className="block mb-1.5 text-[var(--text-secondary)] font-medium">Study Duration: <span className="text-white font-bold">{formatDuration(settings.studyDuration)}</span></label>
            <TimeInputScroller 
              valueInMinutes={settings.studyDuration}
              onChange={(mins) => handleDurationChange('studyDuration', mins)}
              maxHours={4}
              disabled={settings.isActive}
            />
          </div>
          <div>
            <label className="block mb-1.5 text-[var(--text-secondary)] font-medium">Rest Duration: <span className="text-white font-bold">{formatDuration(settings.restDuration)}</span></label>
            <TimeInputScroller 
              valueInMinutes={settings.restDuration}
              onChange={(mins) => handleDurationChange('restDuration', mins)}
              maxHours={4}
              disabled={settings.isActive}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PomodoroTimer;
