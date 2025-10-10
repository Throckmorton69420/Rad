import React, { useState } from 'react';
import { PrintModalProps, PrintOptions, StudyPlan } from '../types';
import { Button } from './Button';
import FocusTrap from 'focus-trap-react';
import CustomSelect from '../CustomSelect';

const PrintModal: React.FC<PrintModalProps> = ({ isOpen, onClose, onGenerateReport, studyPlan, currentDate, activeFilters }) => {
  const [activeTab, setActiveTab] = useState<'schedule' | 'progress' | 'content'>('schedule');
  const [printOptions, setPrintOptions] = useState<PrintOptions>({
    schedule: { reportType: 'full', pageBreakPerWeek: true, startDate: studyPlan.startDate, endDate: studyPlan.endDate },
    progress: { includeSummary: true, includeDeadlines: true, includeTopic: true, includeType: true, includeSource: true },
    content: { filter: 'all', sortBy: 'sequenceOrder' },
  });

  const handleGenerate = () => {
    onGenerateReport(activeTab, printOptions);
  };
  
  const getWeekStartEnd = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00Z');
    const day = date.getUTCDay();
    const diffStart = date.getUTCDate() - day;
    const diffEnd = diffStart + 6;
    const weekStart = new Date(date.setUTCDate(diffStart));
    const weekEnd = new Date(date.setUTCDate(diffEnd));
    return {
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0],
    };
  };

  if (!isOpen) return null;

  return (
    <FocusTrap active={isOpen}>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[var(--z-modal)]" role="dialog" aria-modal="true" aria-labelledby="print-modal-title">
        <div className="modal-panel p-0 w-full max-w-lg text-[var(--text-primary)] max-h-[90vh] flex flex-col">
          <header className="flex justify-between items-center p-4 border-b border-[var(--separator-primary)]">
            <h2 id="print-modal-title" className="text-xl font-semibold">Print Options</h2>
            <Button onClick={onClose} variant="ghost" size="sm" className="!p-1" aria-label="Close">
              <i className="fas fa-times fa-lg"></i>
            </Button>
          </header>

          <div className="p-2 bg-black/20 border-b border-[var(--separator-primary)]">
            <div className="inline-flex bg-[var(--background-secondary)] p-1 rounded-lg space-x-1 w-full">
              <button onClick={() => setActiveTab('schedule')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'schedule' ? 'bg-[var(--glass-bg-active)] shadow' : 'hover:bg-white/10'}`}>Schedule</button>
              <button onClick={() => setActiveTab('progress')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'progress' ? 'bg-[var(--glass-bg-active)] shadow' : 'hover:bg-white/10'}`}>Progress</button>
              <button onClick={() => setActiveTab('content')} className={`py-1.5 px-4 font-semibold text-sm rounded-md flex-1 transition-colors ${activeTab === 'content' ? 'bg-[var(--glass-bg-active)] shadow' : 'hover:bg-white/10'}`}>Content</button>
            </div>
          </div>
          
          <main className="p-4 overflow-y-auto space-y-4">
            {activeTab === 'schedule' && (
              <div className="space-y-4">
                <h3 className="font-semibold">Schedule Report Options</h3>
                <CustomSelect
                  value={printOptions.schedule.reportType}
                  onChange={(val) => {
                    const type = val as PrintOptions['schedule']['reportType'];
                    const { start, end } = getWeekStartEnd(currentDate);
                    setPrintOptions(p => ({...p, schedule: {...p.schedule, reportType: type,
                        startDate: type === 'full' ? studyPlan.startDate : type === 'currentDay' ? currentDate : type === 'currentWeek' ? start : p.schedule.startDate,
                        endDate: type === 'full' ? studyPlan.endDate : type === 'currentDay' ? currentDate : type === 'currentWeek' ? end : p.schedule.endDate,
                    }}));
                  }}
                  options={[
                    { value: 'full', label: 'Full Schedule' },
                    { value: 'range', label: 'Custom Date Range' },
                    { value: 'currentDay', label: 'Current Day Only' },
                    { value: 'currentWeek', label: 'Current Week Only' },
                  ]}
                />
                {printOptions.schedule.reportType === 'range' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[var(--text-secondary)]">Start Date</label>
                      <input type="date" value={printOptions.schedule.startDate} onChange={e => setPrintOptions(p => ({...p, schedule: {...p.schedule, startDate: e.target.value}}))} className="input-base text-sm"/>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)]">End Date</label>
                      <input type="date" value={printOptions.schedule.endDate} onChange={e => setPrintOptions(p => ({...p, schedule: {...p.schedule, endDate: e.target.value}}))} className="input-base text-sm"/>
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeTab === 'progress' && (
              <div className="space-y-2">
                 <h3 className="font-semibold">Progress Report Options</h3>
                 <p className="text-xs text-[var(--text-secondary)]">Report will reflect currently active filters on the main Progress tab.</p>
              </div>
            )}
            {activeTab === 'content' && (
              <div className="space-y-4">
                <h3 className="font-semibold">Content Report Options</h3>
                <div>
                  <label className="text-xs text-[var(--text-secondary)]">Filter by Status</label>
                  <CustomSelect value={printOptions.content.filter} onChange={v => setPrintOptions(p => ({...p, content: {...p.content, filter: v as any}}))}
                    options={[
                      {value: 'all', label: 'All Resources'},
                      {value: 'scheduled', label: 'Scheduled Only'},
                      {value: 'unscheduled', label: 'Unscheduled Only'},
                      {value: 'archived', label: 'Archived Only'},
                    ]}
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-secondary)]">Sort By</label>
                  <CustomSelect value={printOptions.content.sortBy} onChange={v => setPrintOptions(p => ({...p, content: {...p.content, sortBy: v as any}}))}
                    options={[
                      {value: 'sequenceOrder', label: 'Default Order'},
                      {value: 'title', label: 'Title (A-Z)'},
                      {value: 'domain', label: 'Domain'},
                      {value: 'durationMinutesAsc', label: 'Duration (Shortest First)'},
                      {value: 'durationMinutesDesc', label: 'Duration (Longest First)'},
                    ]}
                  />
                </div>
              </div>
            )}
          </main>
          
          <footer className="flex justify-end space-x-3 p-4 border-t border-[var(--separator-primary)]">
            <Button type="button" onClick={onClose} variant="secondary">Cancel</Button>
            <Button type="button" onClick={handleGenerate} variant="primary">Generate & Print</Button>
          </footer>
        </div>
      </div>
    </FocusTrap>
  );
};

export default PrintModal;
