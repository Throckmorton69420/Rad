import React, { useState, useEffect } from 'react';
import { DailyTaskListProps, ScheduledTask } from '../types';
import { Button } from './Button';
import TaskItem from './TaskItem';
import { formatDuration } from '../utils/timeFormatter';
import TimeInputScroller from './TimeInputScroller';
import { GoogleGenAI } from '@google/genai';

const DailyTaskList: React.FC<DailyTaskListProps> = ({
  dailySchedule,
  onTaskToggle,
  onOpenAddTaskModal,
  onOpenModifyDayModal,
  currentPomodoroTaskId,
  onPomodoroTaskSelect,
  isPomodoroActive,
  onToggleRestDay,
  onUpdateTimeForDay,
  isLoading
}) => {
  const [pulsingTaskId, setPulsingTaskId] = useState<string | null>(null);
  const [isTimeEditorOpen, setIsTimeEditorOpen] = useState(false);
  const [editedTime, setEditedTime] = useState(dailySchedule.totalStudyTimeMinutes);
  const [aiTips, setAiTips] = useState<string>('');
  const [isFetchingTips, setIsFetchingTips] = useState(false);

  const { date, tasks, totalStudyTimeMinutes, isRestDay } = dailySchedule;

  useEffect(() => {
    setEditedTime(dailySchedule.totalStudyTimeMinutes);
    setIsTimeEditorOpen(false);
    setAiTips(''); // Clear tips when date changes
  }, [date, dailySchedule.totalStudyTimeMinutes]);

  const handleSetPomodoro = (task: ScheduledTask) => {
    onPomodoroTaskSelect(task.id);
    setPulsingTaskId(task.id);
    setTimeout(() => setPulsingTaskId(null), 1000);
  };

  const handleSaveTime = () => {
    onUpdateTimeForDay(editedTime);
    setIsTimeEditorOpen(false);
  };

  const fetchStudyTips = async () => {
    setIsFetchingTips(true);
    setAiTips('');
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
        
        const topics = dailySchedule.tasks.map(t => t.originalTopic);
        const uniqueTopics = [...new Set(topics)];

        const prompt = uniqueTopics.length > 0 
            ? `You are an expert study coach for radiology residents. For a study day focusing on ${uniqueTopics.join(', ')}, provide:
1. One specific, actionable study tip for one of the topics.
2. A recommended focus technique (e.g., a variation of the Pomodoro technique).
3. A short, motivational quote.
Keep the entire response under 75 words. Format your response as plain text, using newlines to separate the three parts.`
            : `You are an expert study coach for radiology residents. Provide general, encouraging advice for a study day with no specific tasks scheduled. Include a motivational quote. Keep it under 50 words.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        
        setAiTips(response.text);
    } catch (error) {
        console.error("Error fetching study tips:", error);
        setAiTips("Couldn't fetch tips. Please check your connection or API key setup.");
    } finally {
        setIsFetchingTips(false);
    }
  };
  
  return (
    <div className="relative flex flex-col h-full text-[var(--text-primary)]">
      <div className="flex-shrink-0 space-y-4">
        <div className="p-3 glass-panel rounded-lg">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Total Planned Time</p>
              <p className="text-lg font-bold text-white">{formatDuration(totalStudyTimeMinutes)}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setIsTimeEditorOpen(!isTimeEditorOpen)}>
              <i className="fas fa-clock mr-2"></i> Adjust
            </Button>
          </div>
          {isTimeEditorOpen && (
            <div className="mt-3 pt-3 border-t border-[var(--separator-secondary)] space-y-3">
              <TimeInputScroller valueInMinutes={editedTime} onChange={setEditedTime} maxHours={12} disabled={isLoading} />
              <div className="flex justify-end space-x-2">
                <Button variant="secondary" size="sm" onClick={() => { setIsTimeEditorOpen(false); setEditedTime(totalStudyTimeMinutes); }}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSaveTime} disabled={isLoading || editedTime === totalStudyTimeMinutes}>
                  Save & Rebalance
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="p-3 glass-panel rounded-lg">
          <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">AI Study Coach</h3>
          {aiTips ? (
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap animate-fade-in">{aiTips}</p>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">Get personalized tips for today's tasks.</p>
          )}
          <Button variant="secondary" size="sm" onClick={fetchStudyTips} disabled={isFetchingTips} className="mt-3 w-full">
            {isFetchingTips ? <><i className="fas fa-spinner fa-spin mr-2"></i>Generating...</> : <><i className="fas fa-brain mr-2"></i>Get Study Tips</>}
          </Button>
        </div>
      </div>
      
      <div className="flex-grow mt-4">
        <div className="flex-grow min-h-[200px] transition-colors p-1 rounded-lg pb-32">
          {isRestDay ? (
            <div className="h-full flex flex-col justify-center items-center text-center p-6 glass-panel rounded-lg">
              <i className="fas fa-coffee fa-3x text-[var(--text-secondary)] mb-4"></i>
              <p className="text-xl font-semibold text-white">Rest Day</p>
              <p className="text-sm text-[var(--text-secondary)] mb-5">Take a well-deserved break!</p>
              <Button onClick={() => onToggleRestDay(true)} variant="secondary" size="sm">Make it a Study Day</Button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-center text-center p-6 glass-panel rounded-lg">
              <i className="fas fa-calendar-check fa-3x text-[var(--text-secondary)] mb-4"></i>
              <p className="text-xl font-semibold text-white">No Tasks Scheduled</p>
              <p className="text-sm text-[var(--text-secondary)] mb-5">You can add optional tasks or rebalance your schedule.</p>
               <Button onClick={onOpenAddTaskModal} variant="secondary" size="sm" className="mb-2"><i className="fas fa-plus mr-2"></i> Add Optional Task</Button>
              <Button onClick={() => onToggleRestDay(false)} variant="secondary" size="sm">Make it a Rest Day</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.sort((a, b) => a.order - b.order).map(task => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onToggle={onTaskToggle}
                  isCurrentPomodoroTask={currentPomodoroTaskId === task.id}
                  isPulsing={pulsingTaskId === task.id && !isPomodoroActive}
                  onSetPomodoro={() => handleSetPomodoro(task)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 pt-3 glass-chrome pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex space-x-2">
          <Button onClick={onOpenModifyDayModal} variant="primary" className="flex-grow">
            <i className="fas fa-edit mr-2"></i> Modify Schedule
          </Button>
          <Button onClick={onOpenAddTaskModal} variant="secondary" title="Add a quick custom task"><i className="fas fa-plus"></i></Button>
          <Button onClick={() => onToggleRestDay(false)} variant="secondary" title="Convert to Rest Day"><i className="fas fa-coffee"></i></Button>
        </div>
      </div>
    </div>
  );
};

export default DailyTaskList;