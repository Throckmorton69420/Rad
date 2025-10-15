import React, { useState } from 'react';
import { StudyPlan } from '../types';
import ScheduleReport from './ScheduleReport';
import ProgressReport from './ProgressReport';
import ContentReport from './ContentReport';
import { createPortal } from 'react-dom';
import { parseDateString } from '../utils/timeFormatter';
import { Button } from './Button';

interface PrintModalProps {
  studyPlan: StudyPlan;
  onClose: () => void;
}

type ReportType = 'schedule' | 'progress' | 'content';
type PrintOption = 'full' | 'range' | 'day' | 'week';

const PrintModal: React.FC<PrintModalProps> = ({ studyPlan, onClose }) => {
  const [reportType, setReportType] = useState<ReportType>('schedule');
  const [printOption, setPrintOption] = useState<PrintOption>('full');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [singleDayDate, setSingleDayDate] = useState('');
  const [weekStartDate, setWeekStartDate] = useState('');
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [includePending, setIncludePending] = useState(true);

  const handlePrint = () => {
    let filteredSchedule = studyPlan.schedule;

    if (reportType === 'schedule') {
      if (printOption === 'range' && customStartDate && customEndDate) {
        filteredSchedule = studyPlan.schedule.filter((day) => {
          const dayDate = parseDateString(day.date);
          const start = parseDateString(customStartDate);
          const end = parseDateString(customEndDate);
          return dayDate >= start && dayDate <= end;
        });
      } else if (printOption === 'day' && singleDayDate) {
        filteredSchedule = studyPlan.schedule.filter((day) => day.date === singleDayDate);
      } else if (printOption === 'week' && weekStartDate) {
        const start = parseDateString(weekStartDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        filteredSchedule = studyPlan.schedule.filter((day) => {
          const dayDate = parseDateString(day.date);
          return dayDate >= start && dayDate <= end;
        });
      }

      if (!includeCompleted || !includePending) {
        filteredSchedule = filteredSchedule.map((day) => ({
          ...day,
          tasks: day.tasks.filter((task) => {
            if (!includeCompleted && task.status === 'completed') return false;
            if (!includePending && task.status === 'pending') return false;
            return true;
          }),
        }));
      }
    }

    const printContainer = document.createElement('div');
    printContainer.className = 'print-only-container';
    document.body.appendChild(printContainer);

    const root = createRoot(printContainer);

    if (reportType === 'schedule') {
      root.render(<ScheduleReport studyPlan={studyPlan} schedule={filteredSchedule} />);
    } else if (reportType === 'progress') {
      root.render(<ProgressReport studyPlan={studyPlan} />);
    } else if (reportType === 'content') {
      root.render(<ContentReport studyPlan={studyPlan} />);
    }

    // CRITICAL FIX: Defer print to next frame to allow layout to complete
    requestAnimationFrame(() => {
      window.print();
      
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(printContainer);
      }, 100);
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="modal-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-2xl font-bold mb-4">Print Options</h2>

        <div className="space-y-6">
          {/* Report Type Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Report Type</label>
            <div className="flex gap-2">
              <Button
                variant={reportType === 'schedule' ? 'primary' : 'secondary'}
                onClick={() => setReportType('schedule')}
              >
                Schedule
              </Button>
              <Button
                variant={reportType === 'progress' ? 'primary' : 'secondary'}
                onClick={() => setReportType('progress')}
              >
                Progress
              </Button>
              <Button
                variant={reportType === 'content' ? 'primary' : 'secondary'}
                onClick={() => setReportType('content')}
              >
                Content
              </Button>
            </div>
          </div>

          {reportType === 'schedule' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2">Print Range</label>
                <div className="flex flex-col gap-2">
                  <Button
                    variant={printOption === 'full' ? 'primary' : 'secondary'}
                    onClick={() => setPrintOption('full')}
                  >
                    Full Schedule
                  </Button>
                  <Button
                    variant={printOption === 'range' ? 'primary' : 'secondary'}
                    onClick={() => setPrintOption('range')}
                  >
                    Date Range
                  </Button>
                  <Button
                    variant={printOption === 'day' ? 'primary' : 'secondary'}
                    onClick={() => setPrintOption('day')}
                  >
                    Single Day
                  </Button>
                  <Button
                    variant={printOption === 'week' ? 'primary' : 'secondary'}
                    onClick={() => setPrintOption('week')}
                  >
                    Week
                  </Button>
                </div>
              </div>

              {printOption === 'range' && (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium mb-2">Start Date</label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="input-base"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium mb-2">End Date</label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="input-base"
                    />
                  </div>
                </div>
              )}

              {printOption === 'day' && (
                <div>
                  <label className="block text-sm font-medium mb-2">Select Date</label>
                  <input
                    type="date"
                    value={singleDayDate}
                    onChange={(e) => setSingleDayDate(e.target.value)}
                    className="input-base"
                  />
                </div>
              )}

              {printOption === 'week' && (
                <div>
                  <label className="block text-sm font-medium mb-2">Week Starting</label>
                  <input
                    type="date"
                    value={weekStartDate}
                    onChange={(e) => setWeekStartDate(e.target.value)}
                    className="input-base"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Include Tasks</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeCompleted}
                      onChange={(e) => setIncludeCompleted(e.target.checked)}
                    />
                    <span>Completed</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includePending}
                      onChange={(e) => setIncludePending(e.target.checked)}
                    />
                    <span>Pending</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {reportType === 'progress' && (
            <p className="text-sm text-[var(--text-secondary)]">
              This report provides a high-level summary of your completed study time versus the total
              scheduled time, broken down by topic.
            </p>
          )}

          {reportType === 'content' && (
            <p className="text-sm text-[var(--text-secondary)]">
              This report lists all study materials organized by topic, showing their status and duration.
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="primary" onClick={handlePrint}>
            Print
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

// Missing import - add this at the top with other imports
import { createRoot } from 'react-dom/client';

export default PrintModal;
