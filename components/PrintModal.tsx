import React, { useState } from 'react';
import { StudyPlan, Domain, ResourceType, PrintOptions, PrintModalProps } from '../types';
import { Button } from './Button';
import { parseDateString } from '../utils/timeFormatter';
import CustomSelect from '../CustomSelect';
import { ALL_DOMAINS } from '../constants';

const PrintModal: React.FC<PrintModalProps> = ({ 
  isOpen, 
  onClose, 
  onGenerateReport, 
  studyPlan, 
  currentDate, 
  activeFilters,
  initialTab 
}) => {
  const [activeTab, setActiveTab] = useState<'schedule' | 'progress' | 'content'>(initialTab);
  
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

  const handleGenerateReport = () => {
    const printOptions: PrintOptions = {
      schedule: {
        reportType: scheduleOptions.reportType,
        pageBreakPerWeek: scheduleOptions.pageBreakPerWeek,
        startDate: scheduleOptions.startDate,
        endDate: scheduleOptions.endDate
      },
      progress: progressOptions,
      content: contentOptions
    };
    
    onGenerateReport(activeTab, printOptions);
  };

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

        {/* Tab Content */}
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
              
              <div className="pt-3 border-t border-[var(--separator-primary)]">
                <label className="flex items-center space-x-2">
                  <input 
                    type="checkbox"
                    checked={scheduleOptions.pageBreakPerWeek}
                    onChange={(e) => setScheduleOptions({...scheduleOptions, pageBreakPerWeek: e.target.checked})}
                    className="text-[var(--accent-purple)]"
                  />
                  <span className="text-sm text-[var(--text-secondary)]">
                    Insert page breaks between weeks (for printing)
                  </span>
                </label>
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
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-[var(--text-primary)] mb-3">Include Sections</h4>
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2">
                      <input 
                        type="checkbox"
                        checked={progressOptions.includeSummary}
                        onChange={(e) => setProgressOptions({...progressOptions, includeSummary: e.target.checked})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">Overall Progress Summary</span>
                    </label>
                    
                    <label className="flex items-center space-x-2">
                      <input 
                        type="checkbox"
                        checked={progressOptions.includeDeadlines}
                        onChange={(e) => setProgressOptions({...progressOptions, includeDeadlines: e.target.checked})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">Deadlines & Milestones</span>
                    </label>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-[var(--text-primary)] mb-3">Breakdown By</h4>
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2">
                      <input 
                        type="checkbox"
                        checked={progressOptions.includeTopic}
                        onChange={(e) => setProgressOptions({...progressOptions, includeTopic: e.target.checked})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">By Topic/Domain</span>
                    </label>
                    
                    <label className="flex items-center space-x-2">
                      <input 
                        type="checkbox"
                        checked={progressOptions.includeType}
                        onChange={(e) => setProgressOptions({...progressOptions, includeType: e.target.checked})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">By Resource Type</span>
                    </label>
                    
                    <label className="flex items-center space-x-2">
                      <input 
                        type="checkbox"
                        checked={progressOptions.includeSource}
                        onChange={(e) => setProgressOptions({...progressOptions, includeSource: e.target.checked})}
                        className="text-[var(--accent-purple)]"
                      />
                      <span className="text-sm">By Content Source</span>
                    </label>
                  </div>
                </div>
              </div>
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
              
              <div className="bg-[var(--background-secondary)] p-4 rounded-lg">
                <h4 className="font-medium text-[var(--text-primary)] mb-2">
                  Current Active Filters
                </h4>
                <div className="text-sm text-[var(--text-secondary)] space-y-1">
                  <div>Domain: <span className="font-medium">{activeFilters.domain === 'all' ? 'All Domains' : activeFilters.domain}</span></div>
                  <div>Type: <span className="font-medium">{activeFilters.type === 'all' ? 'All Types' : activeFilters.type}</span></div>
                  <div>Source: <span className="font-medium">{activeFilters.source === 'all' ? 'All Sources' : activeFilters.source}</span></div>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-2">
                  Note: The report will use your current Content tab filters. Adjust them before printing if needed.
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Content Status Filter
                  </label>
                  <CustomSelect 
                    value={contentOptions.filter}
                    onChange={(value) => setContentOptions({...contentOptions, filter: value as any})}
                    options={[
                      { value: 'all', label: 'All Active Resources' },
                      { value: 'scheduled', label: 'Scheduled Only' },
                      { value: 'unscheduled', label: 'Unscheduled Only' },
                      { value: 'archived', label: 'Archived Only' }
                    ]}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Sort Order
                  </label>
                  <CustomSelect 
                    value={contentOptions.sortBy}
                    onChange={(value) => setContentOptions({...contentOptions, sortBy: value as any})}
                    options={[
                      { value: 'sequenceOrder', label: 'Sequence Order' },
                      { value: 'title', label: 'Title (A-Z)' },
                      { value: 'domain', label: 'Domain' },
                      { value: 'durationMinutesAsc', label: 'Duration (Shortest First)' },
                      { value: 'durationMinutesDesc', label: 'Duration (Longest First)' }
                    ]}
                  />
                </div>
              </div>
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