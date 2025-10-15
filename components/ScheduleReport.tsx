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

  return (
    <div className="print-report">
      {/* Enhanced Print-specific CSS */}
      <style>{`
        .print-report {
          width: 100%;
          background: white;
          color: black;
          font-family: Arial, sans-serif;
          font-size: 12px;
          line-height: 1.4;
        }
        
        @media print {
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            color-adjust: exact;
          }
          
          html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: visible;
          }
          
          body * {
            visibility: hidden;
          }
          
          .print-report,
          .print-report * {
            visibility: visible;
          }
          
          .print-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: auto;
            background: white;
            color: black;
            font-family: Arial, sans-serif;
            font-size: 11px;
            line-height: 1.3;
            margin: 0;
            padding: 0;
          }
          
          .print-header {
            display: block;
            width: 100%;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 2px solid #000;
            page-break-after: avoid;
          }
          
          .print-title {
            display: block;
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            margin: 0 0 10px 0;
            color: #000;
          }
          
          .print-subtitle {
            display: block;
            font-size: 14px;
            text-align: center;
            margin: 0 0 8px 0;
            color: #333;
          }
          
          .print-summary {
            display: block;
            font-size: 12px;
            text-align: center;
            margin: 0;
            color: #666;
          }
          
          .day-section {
            display: block;
            width: 100%;
            margin-bottom: 20px;
            page-break-inside: avoid;
          }
          
          .day-header {
            display: block;
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 8px;
            padding: 6px 8px;
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #000;
          }
          
          .task-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 15px;
            display: table;
          }
          
          .task-table thead {
            display: table-header-group;
          }
          
          .task-table tbody {
            display: table-row-group;
          }
          
          .task-table tr {
            display: table-row;
          }
          
          .task-table th,
          .task-table td {
            display: table-cell;
            border: 1px solid #ccc;
            padding: 4px 6px;
            text-align: left;
            vertical-align: top;
            color: #000;
          }
          
          .task-table th {
            background: #f8f8f8;
            font-weight: bold;
            font-size: 10px;
          }
          
          .task-table td {
            font-size: 9px;
          }
          
          .day-total {
            font-weight: bold;
            text-align: right;
            background: #f0f0f0;
          }
          
          .no-content {
            display: block;
            text-align: center;
            color: #999;
            font-style: italic;
            padding: 15px;
          }
          
          .report-footer {
            display: block;
            margin-top: 30px;
            text-align: center;
            font-size: 10px;
            color: #666;
          }
          
          @page {
            margin: 0.75in;
            size: letter portrait;
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
          Total Planned Study Time: {formatDuration(totalPlannedTime)}
        </p>
      </div>

      {/* Daily Schedule Content */}
      {studyDays.length > 0 ? (
        studyDays.map((day) => {
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
        })
      ) : (
        <div className="no-content">No study days found in the selected range</div>
      )}

      {/* Footer */}
      <div className="report-footer">
        Generated on {new Date().toLocaleDateString('en-US')}
      </div>
    </div>
  );
};

export default ScheduleReport;