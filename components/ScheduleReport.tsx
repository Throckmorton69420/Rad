import React from 'react';
import { StudyPlan, DailySchedule } from '../types';
import { formatDuration } from '../utils/timeFormatter';

interface ScheduleReportProps {
  studyPlan: StudyPlan;
  schedule?: DailySchedule[];
}

const ScheduleReport: React.FC<ScheduleReportProps> = ({ studyPlan, schedule }) => {
  // Use provided schedule or fall back to study plan schedule
  const scheduleToRender = schedule || studyPlan.schedule || [];
  const studyDays = scheduleToRender.filter(day => !day.isRestDay);
  
  const totalPlannedTime = studyDays.reduce((sum, day) => 
    sum + day.tasks.reduce((daySum, task) => daySum + task.durationMinutes, 0), 0
  );

  // Ensure we have content to render
  if (studyDays.length === 0) {
    return (
      <div className="print-report">
        <div className="print-header">
          <h1 className="print-title">Radiology Core Exam - Study Schedule Report</h1>
          <p className="print-error">No study days found in the selected range</p>
        </div>
      </div>
    );
  }

  return (
    <div className="print-report">
      {/* Print-specific CSS */}
      <style>{`
        @media print {
          * { box-sizing: border-box; }
          body { margin: 0; padding: 0; }
          body * { visibility: hidden; }
          .print-report, .print-report * { visibility: visible; }
          .print-report {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            background: white !important;
            color: black !important;
            font-family: 'Arial', sans-serif !important;
            font-size: 11px !important;
            line-height: 1.4 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print-header {
            margin: 0 0 20px 0 !important;
            padding: 0 0 15px 0 !important;
            border-bottom: 2px solid #333 !important;
            page-break-after: avoid !important;
          }
          .print-title {
            font-size: 22px !important;
            font-weight: bold !important;
            margin: 0 0 8px 0 !important;
            text-align: center !important;
            color: #000 !important;
          }
          .print-subtitle {
            font-size: 14px !important;
            margin: 0 0 8px 0 !important;
            text-align: center !important;
            color: #333 !important;
          }
          .print-summary {
            font-size: 12px !important;
            text-align: center !important;
            margin: 0 !important;
            color: #666 !important;
          }
          .day-section {
            margin: 0 0 20px 0 !important;
            page-break-inside: avoid !important;
          }
          .day-header {
            font-size: 14px !important;
            font-weight: bold !important;
            margin: 0 0 8px 0 !important;
            padding: 6px 8px !important;
            background: #f5f5f5 !important;
            border: 1px solid #ccc !important;
            color: #000 !important;
          }
          .task-table {
            width: 100% !important;
            border-collapse: collapse !important;
            margin: 0 0 10px 0 !important;
          }
          .task-table th,
          .task-table td {
            border: 1px solid #ccc !important;
            padding: 3px 5px !important;
            text-align: left !important;
            vertical-align: top !important;
            color: #000 !important;
          }
          .task-table th {
            background: #f8f8f8 !important;
            font-weight: bold !important;
            font-size: 10px !important;
          }
          .task-table td {
            font-size: 9px !important;
          }
          .day-total {
            font-weight: bold !important;
            text-align: right !important;
            background: #f0f0f0 !important;
          }
          .no-content {
            text-align: center !important;
            color: #999 !important;
            font-style: italic !important;
            padding: 15px !important;
          }
          @page {
            margin: 0.75in !important;
            size: letter portrait !important;
          }
          .print-error {
            color: #d00 !important;
            text-align: center !important;
            font-size: 14px !important;
            margin: 20px 0 !important;
          }
        }
        
        @media screen {
          .print-report {
            display: none;
          }
        }
      `}</style>

      {/* Report Header - Always Present */}
      <div className="print-header">
        <h1 className="print-title">Radiology Core Exam - Study Schedule Report</h1>
        <h2 className="print-subtitle">
          {studyPlan.startDate || 'Start Date'} - {studyPlan.endDate || 'End Date'}
        </h2>
        <p className="print-summary">
          Total Planned Study Time: {formatDuration(totalPlannedTime)}
        </p>
      </div>

      {/* Daily Schedule Content */}
      {studyDays.map((day) => {
        const dayTotalTime = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
        
        return (
          <div key={day.date} className="day-section">
            <div className="day-header">
              {day.dayName}, {new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', { 
                month: 'long', 
                day: 'numeric', 
                year: 'numeric',
                timeZone: 'UTC'
              })}
            </div>
            
            {day.tasks.length > 0 ? (
              <table className="task-table">
                <thead>
                  <tr>
                    <th style={{width: '55%'}}>Task</th>
                    <th style={{width: '15%'}}>Duration</th>
                    <th style={{width: '30%'}}>Topic</th>
                  </tr>
                </thead>
                <tbody>
                  {day.tasks.map((task) => (
                    <tr key={task.id}>
                      <td>{task.title}</td>
                      <td>{formatDuration(task.durationMinutes)}</td>
                      <td>{task.originalTopic.replace(/_/g, ' ')}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="day-total" colSpan={2}>
                      <strong>Total Time</strong>
                    </td>
                    <td className="day-total">
                      <strong>{formatDuration(dayTotalTime)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="no-content">No tasks scheduled for this day</div>
            )}
          </div>
        );
      })}

      {/* Footer */}
      <div style={{marginTop: '30px', textAlign: 'center', fontSize: '10px', color: '#666'}}>
        Generated on {new Date().toLocaleDateString('en-US')}
      </div>
    </div>
  );
};

export default ScheduleReport;
