import React, { useState, useEffect, useRef } from 'react';
import { Domain, ResourceType, AddTaskModalProps } from '../types';
import { Button } from './Button';
import TimeInputScroller from './TimeInputScroller';
import FocusTrap from 'focus-trap-react';
import CustomSelect from '../CustomSelect';
import { parseDateString } from '../utils/timeFormatter';

const AddTaskModal: React.FC<AddTaskModalProps> = ({ isOpen, onClose, onSave, availableDomains, selectedDate }) => {
  const [title, setTitle] = useState('');
  const [totalMinutesDuration, setTotalMinutesDuration] = useState(30);
  const [selectedDomain, setSelectedDomain] = useState<Domain>(availableDomains[0] || Domain.PHYSICS);
  const [taskType, setTaskType] = useState<ResourceType>(ResourceType.READING_TEXTBOOK);
  const [pages, setPages] = useState<number | undefined>(undefined);
  const [caseCount, setCaseCount] = useState<number | undefined>(undefined);
  const [questionCount, setQuestionCount] = useState<number | undefined>(undefined);
  const [chapterNumber, setChapterNumber] = useState<number | undefined>(undefined);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPages(undefined);
    setCaseCount(undefined);
    setQuestionCount(undefined);
    setChapterNumber(undefined);
  }, [taskType]);

  const resetForm = () => {
    setTitle('');
    setTotalMinutesDuration(30);
    setSelectedDomain(availableDomains[0] || Domain.PHYSICS);
    setTaskType(ResourceType.READING_TEXTBOOK);
    setPages(undefined);
    setCaseCount(undefined);
    setQuestionCount(undefined);
    setChapterNumber(undefined);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || totalMinutesDuration <= 0) {
      alert('Please provide a valid title and duration.');
      return;
    }
    onSave({ 
      title, 
      durationMinutes: Math.round(totalMinutesDuration), 
      domain: selectedDomain, 
      type: taskType,
      pages: taskType === ResourceType.READING_TEXTBOOK || taskType === ResourceType.READING_GUIDE ? pages : undefined,
      caseCount: taskType === ResourceType.CASES ? caseCount : undefined,
      questionCount: taskType === ResourceType.QUESTIONS || taskType === ResourceType.REVIEW_QUESTIONS ? questionCount : undefined,
      chapterNumber: chapterNumber || undefined,
    });
    resetForm();
  };
  
  const resourceTypeOptions = Object.values(ResourceType).map(type => ({ value: type, label: type }));
  const domainOptions = availableDomains.map(domain => ({ value: domain, label: domain }));

  if (!isOpen) return null;

  return (
    <FocusTrap active={isOpen}>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[var(--z-modal)]" role="dialog" aria-modal="true" aria-labelledby="add-task-title">
        <div className="modal-panel static-glow-border p-6 w-full max-w-lg text-[var(--text-primary)] max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 id="add-task-title" className="text-xl font-semibold text-[var(--text-primary)]">Add Optional Task</h2>
            <Button onClick={onClose} ref={closeButtonRef} variant="ghost" size="sm" className="!p-1 !text-[var(--text-secondary)] hover:!text-[var(--text-primary)]" aria-label="Close add task modal">
              <i className="fas fa-times fa-lg"></i>
            </Button>
          </div>
          {selectedDate && <p className="text-sm text-[var(--text-secondary)] mb-4">For: {parseDateString(selectedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="taskTitle" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Task Title:</label>
              <input
                type="text"
                id="taskTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-base"
                required
              />
            </div>

            <div>
              <label htmlFor="taskType" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Task Type:</label>
              <CustomSelect
                id="taskType"
                value={taskType}
                onChange={(newValue) => setTaskType(newValue as ResourceType)}
                options={resourceTypeOptions}
              />
            </div>

             <div>
                <label htmlFor="taskChapter" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Chapter # (Optional):</label>
                <input
                  type="number"
                  id="taskChapter"
                  value={chapterNumber || ''}
                  onChange={(e) => setChapterNumber(parseInt(e.target.value, 10) || undefined)}
                  className="input-base"
                  min="1"
                  step="1"
                />
              </div>

            {(taskType === ResourceType.READING_TEXTBOOK || taskType === ResourceType.READING_GUIDE) && (
              <div>
                <label htmlFor="taskPages" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Number of Pages (Optional):</label>
                <input
                  type="number"
                  id="taskPages"
                  value={pages || ''}
                  onChange={(e) => setPages(parseInt(e.target.value, 10) || undefined)}
                  className="input-base"
                  min="1"
                  step="1"
                />
              </div>
            )}

            {taskType === ResourceType.CASES && (
              <div>
                <label htmlFor="taskCaseCount" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Number of Cases (Optional):</label>
                <input
                  type="number"
                  id="taskCaseCount"
                  value={caseCount || ''}
                  onChange={(e) => setCaseCount(parseInt(e.target.value, 10) || undefined)}
                  className="input-base"
                  min="1"
                  step="1"
                />
              </div>
            )}

            {(taskType === ResourceType.QUESTIONS || taskType === ResourceType.REVIEW_QUESTIONS) && (
              <div>
                <label htmlFor="taskQuestionCount" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Number of Questions (Optional):</label>
                <input
                  type="number"
                  id="taskQuestionCount"
                  value={questionCount || ''}
                  onChange={(e) => setQuestionCount(parseInt(e.target.value, 10) || undefined)}
                  className="input-base"
                  min="1"
                  step="1"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Estimated Duration:</label>
              <TimeInputScroller valueInMinutes={totalMinutesDuration} onChange={setTotalMinutesDuration} maxHours={8} />
            </div>

            <div>
              <label htmlFor="taskDomain" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Topic/Domain:</label>
              <CustomSelect
                id="taskDomain"
                value={selectedDomain}
                onChange={(newValue) => setSelectedDomain(newValue as Domain)}
                options={domainOptions}
              />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <Button type="button" onClick={() => { resetForm(); onClose();}} variant="secondary">
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Add Task
              </Button>
            </div>
          </form>
        </div>
      </div>
    </FocusTrap>
  );
};

export default AddTaskModal;