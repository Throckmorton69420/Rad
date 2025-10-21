import React, { useState } from 'react';
import { StudyPlan, Domain, ResourceType, PrintOptions, PrintModalProps } from '../types';
import { Button } from './Button';
import { parseDateString } from '../utils/timeFormatter';
import CustomSelect from '../CustomSelect';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || (window as any).NEXT_PUBLIC_API_BASE || '';

const PrintModal: React.FC<PrintModalProps> = ({ 
  isOpen, 
  onClose, 
  onGenerateReport, 
  studyPlan, 
  currentDate, 
  activeFilters,
  initialTab 
}) => {
  const [activeTab, setActiveTab] = useState<'schedule' | 'progress' | 'content'>(initialTab || 'content');
  
  // Schedule options
  const [scheduleOptions, setScheduleOptions] = useState({
    reportType: 'full' as 'full' | 'range' | 'currentDay' | 'currentWeek',
    pageBreakPerWeek: false,
    startDate: currentDate,
    endDate: studyPlan.endDate
  });
  
  // Progress options
  const [progressOptions, setProgressOptions] = useState({
    includeSummary: true,
    includeDeadlines: true,
    includeTopic: true,
    includeType: true,
    includeSource: true
  });
  
  // Content options
  const [contentOptions, setContentOptions] = useState({
    filter: 'all' as 'all' | 'scheduled' | 'unscheduled' | 'archived',
    sortBy: 'sequenceOrder' as 'sequenceOrder' | 'title' | 'domain' | 'durationMinutesAsc' | 'durationMinutesDesc'
  });

  const getWeekRange = (date: string) => {
    const d = parseDateString(date);
    const dayOfWeek = d.getUTCDay();
    const firstDayOfWeek = new Date(d);
    firstDayOfWeek.setUTCDate(d.getUTCDate() - dayOfWeek);
    const lastDayOfWeek = new Date(firstDayOfWeek);
    lastDayOfWeek.setUTCDate(firstDayOfWeek.getUTCDate() + 6);
    return {
      start: firstDayOfWeek.toISOString().split('T')[0],
      end: lastDayOfWeek.toISOString().split('T')[0]
    };
  };

  if (!isOpen) return null;

  async function defaultGenerateReport(tab: 'schedule'|'progress'|'content', opts: PrintOptions) {
    // Build a minimal schedule slice for server-side HTML (works for printing)
    const inRange = (dateStr: string) => {
      if (opts.schedule.reportType === 'currentDay') return dateStr === currentDate;
      if (opts.schedule.reportType === 'currentWeek') {
        const { start, end } = getWeekRange(currentDate);
        return dateStr >= start && dateStr <= end;
      }
      if (opts.schedule.reportType === 'range') {
        return dateStr >= (opts.schedule.startDate || studyPlan.startDate)
            && dateStr <= (opts.schedule.endDate || studyPlan.endDate);
      }
      return true; // full
    };

    const days = (studyPlan.days || []).filter(d => inRange(d.date)).map(d => ({
      date: d.date,
      totalStudyTimeMinutes: d.totalStudyTimeMinutes,
      tasks: (d.tasks || []).map(t => ({
        title: t.title,
        durationMinutes: t.durationMinutes,
        category: t.category,
        topic: t.originalTopic || (t as any).topic || ''
      }))
    }));

    const resp = await fetch(`${API_BASE}/generate_report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: days, format: 'html' })
    });
    const html = await resp.text();

    // Open printable window immediately when the HTML is ready
    const w = window.open('', '_blank', 'noopener,noreferrer,width=1000,height=800');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    // Allow paint, then trigger print
    setTimeout(() => { try { w.print(); } catch {} }, 250);
  }

  const handleGenerateReport = () => {
    const printOptions: PrintOptions = {
      schedule: {
        reportType: scheduleOptions.reportType,
        pageBreakPerWeek: scheduleOptions.pageBreakPerWeek,
        startDate: scheduleOptions.startDate,
        endDate: scheduleOptions.endDate
      },
      progress: progressOptions,
      content: { ...contentOptions, activeFilters }
    };
    if (onGenerateReport) {
      onGenerateReport(activeTab, printOptions);
    } else {
      void defaultGenerateReport(activeTab, printOptions);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="modal-panel w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            <i className="fas fa-print mr-3 text-[var(--accent-purple)]"></i>
            Print & Export Reports
          </h2>
          <button 
            onClick={onClose}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-full hover:bg-[var(--background-tertiary)]"
          >
            <i className="fas fa-times fa-lg"></i>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="inline-flex bg-[var(--background-secondary)] p-1 rounded-lg space-x-1">
            <button 
              onClick={() => setActiveTab('schedule')}
              className={`py-2 px-4 font-semibold text-sm rounded-md transition-colors ${
                activeTab === 'schedule' 
                  ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <i className="fa-regular fa-calendar-days mr-2"></i>Schedule Report
            </button>
            <button 
              onClick={() => setActiveTab('progress')}
              className={`py-2 px-4 font-semibold text-sm rounded-md transition-colors ${
                activeTab === 'progress' 
                  ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <i className="fa-solid fa-chart-pie mr-2"></i>Progress Report
            </button>
            <button 
              onClick={() => setActiveTab('content')}
              className={`py-2 px-4 font-semibold text-sm rounded-md transition-colors ${
                activeTab === 'content' 
                  ? 'bg-[var(--glass-bg-active)] shadow text-[var(--text-primary)]' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <i className="fa-solid fa-book-bookmark mr-2"></i>Content Report
            </button>
          </div>
        </div>

        {/* Tab Content (keep your existing options) */}
        <div className="space-y-6">
          {activeTab === 'schedule' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
                  Schedule Report Options
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Generate a detailed schedule report showing your daily study tasks and time allocation.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Report Scope
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2">
                      <input 
                        type="radio" 
                        name="scheduleReportType" 
                        value="full"
                        checked={scheduleOptions.reportType === 'full'}
                        onChange={(e) => setScheduleOptions({...scheduleOptions, reportType: e.target.value as any})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">Full Schedule ({studyPlan.startDate} to {studyPlan.endDate})</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input 
                        type="radio" 
                        name="scheduleReportType" 
                        value="range"
                        checked={scheduleOptions.reportType === 'range'}
                        onChange={(e) => setScheduleOptions({...scheduleOptions, reportType: e.target.value as any})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">Custom Date Range</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input 
                        type="radio" 
                        name="scheduleReportType" 
                        value="currentDay"
                        checked={scheduleOptions.reportType === 'currentDay'}
                        onChange={(e) => setScheduleOptions({...scheduleOptions, reportType: e.target.value as any})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">Current Day ({currentDate})</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input 
                        type="radio" 
                        name="scheduleReportType" 
                        value="currentWeek"
                        checked={scheduleOptions.reportType === 'currentWeek'}
                        onChange={(e) => setScheduleOptions({...scheduleOptions, reportType: e.target.value as any})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">Current Week ({getWeekRange(currentDate).start} to {getWeekRange(currentDate).end})</span>
                    </label>
                  </div>
                </div>
                {scheduleOptions.reportType === 'range' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                        Start Date
                      </label>
                      <input 
                        type="date" 
                        value={scheduleOptions.startDate}
                        min={studyPlan.startDate}
                        max={studyPlan.endDate}
                        onChange={(e) => setScheduleOptions({...scheduleOptions, startDate: e.target.value})}
                        className="input-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                        End Date
                      </label>
                      <input 
                        type="date" 
                        value={scheduleOptions.endDate}
                        min={scheduleOptions.startDate}
                        max={studyPlan.endDate}
                        onChange={(e) => setScheduleOptions({...scheduleOptions, endDate: e.target.value})}
                        className="input-base"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'progress' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
                  Progress Report Options
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Generate a comprehensive progress report showing completion statistics and breakdowns.
                </p>
              </div>
              {/* Keep your existing checkboxes here */}
            </div>
          )}

          {activeTab === 'content' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
                  Content Report Options
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Generate a detailed content report with your current filters applied.
                </p>
              </div>
              {/* Keep your existing content filter UI here */}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-8 pt-6 border-t border-[var(--separator-primary)]">
          <div className="text-sm text-[var(--text-secondary)]">
            <i className="fas fa-info-circle mr-2"></i>
            Reports will open in a new print dialog
          </div>
          <div className="flex space-x-3">
            <Button 
              onClick={onClose}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleGenerateReport}
              variant="primary"
            >
              <i className="fas fa-print mr-2"></i>
              Generate Report
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintModal;
