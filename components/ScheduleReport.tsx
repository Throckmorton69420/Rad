import React from 'react';
import { StudyPlan, DailySchedule } from '../types';
import { formatDuration } from '../utils/timeFormatter';

interface ScheduleReportProps {
  studyPlan: StudyPlan;
  schedule?: DailySchedule[];
}

const ScheduleReport: React.FC<ScheduleReportProps> = ({ studyPlan, schedule }) => {
  const scheduleToShow = schedule || studyPlan.schedule;
  const studyDays = scheduleToShow.filter(day => !day.isRestDay);
  
  const totalTime = studyDays.reduce((sum, day) => 
    sum + day.tasks.reduce((daySum, task) => daySum + task.durationMinutes, 0), 0
  );

  return (
    <div className="print-report">
      {/* Print Styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-report, .print-report * { visibility: visible; }
          .print-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white !important;
            color: black !important;
            font-family: Arial, sans-serif;
            font-size: 11px;
            line-height: 1.3;
          }
          .print-header {
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #333;
          }
          .print-title {
            font-size: 24px;
            font-weight: bold;
            margin: 0 0 10px 0;
            text-align: center;
          }
          .print-subtitle {
            font-size: 16px;
            margin: 0 0 5px 0;
            text-align: center;
          }
          .print-summary {
            font-size: 12px;
            text-align: center;
            margin: 0;
          }
          .day-section {
            margin-bottom: 25px;
            page-break-inside: avoid;
          }
          .day-header {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 8px;
            padding: 5px;
            background: #f0f0f0;
            border: 1px solid #ccc;
          }
          .task-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
          }
          .task-table th,
          .task-table td {
            border: 1px solid #ccc;
            padding: 4px 6px;
            text-align: left;
            vertical-align: top;
          }
          .task-table th {
            background: #f8f8f8;
            font-weight: bold;
            font-size: 10px;
          }
          .task-table td {
            font-size: 10px;
          }
          .day-total {
            font-weight: bold;
            text-align: right;
            background: #f0f0f0;
          }
          .no-tasks {
            text-align: center;
            color: #666;
            font-style: italic;
            padding: 20px;
          }
          @page {
            margin: 0.5in;
            size: letter;
          }
        }
      `}</style>

      {/* Report Header */}
      <div className="print-header">
        <h1 className="print-title">Radiology Core Exam - Study Schedule Report</h1>
        <h2 className="print-subtitle">
          {studyPlan.startDate} - {studyPlan.endDate}
        </h2>
        <p className="print-summary">
          Total Planned Study Time: {formatDuration(totalTime)}
        </p>
      </div>

      {/* Schedule Content */}
      {studyDays.length > 0 ? (
        studyDays.map((day) => {
          const dayTotal = day.tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
          
          return (
            <div key={day.date} className="day-section">
              <div className="day-header">
                {day.dayName}, {new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-US', { 
                  month: 'long', 
                  day: 'numeric', 
                  year: 'numeric',
                  timeZone: 'UTC'
                })}
              </div>
              
              {day.tasks.length > 0 ? (
                <>
                  <table className="task-table">
                    <thead>
                      <tr>
                        <th style={{width: '60%'}}>Task</th>
                        <th style={{width: '15%'}}>Duration</th>
                        <th style={{width: '25%'}}>Topic</th>
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
                          <strong>{formatDuration(dayTotal)}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              ) : (
                <div className="no-tasks">No tasks scheduled for this day</div>
              )}
            </div>
          );
        })
      ) : (
        <div className="no-tasks">No study days found in the selected range</div>
      )}
    </div>
  );
};

export default ScheduleReport;
