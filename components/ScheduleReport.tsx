import React from 'react';
import { StudyPlan, DailySchedule } from '../types';
import { formatDuration, parseDateString } from '../utils/timeFormatter';

interface ScheduleReportProps {
  studyPlan: StudyPlan;
  schedule?: DailySchedule[];
}

const ScheduleReport: React.FC<ScheduleReportProps> = ({ studyPlan, schedule }) => {
  const scheduleToRender = schedule || studyPlan.schedule;
  const totalPlannedMinutes = scheduleToRender.reduce(
    (acc, day) =>
      acc +
      (day.isRestDay
        ? 0
        : day.tasks.reduce((taskAcc, task) => taskAcc + task.durationMinutes, 0)),
    0
  );

  return (
    <div className="printable-report" style={{ padding: '16px', fontFamily: 'serif', color: 'black', backgroundColor: 'white' }}>
      {/* Inline header - NO separate container */}
      <div style={{ textAlign: 'center', marginBottom: '24px', borderBottom: '1px solid #ddd', paddingBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666', marginBottom: '8px' }}>
          <span>Radiology Core Exam Study Planner</span>
          <span>{new Date().toLocaleString()}</span>
        </div>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '8px 0' }}>
          Radiology Core Exam - Study Schedule Report
        </h1>
        {scheduleToRender.length > 0 && (
          <>
            <p style={{ fontSize: '16px', color: '#666', margin: '4px 0' }}>
              {parseDateString(scheduleToRender[0].date).toLocaleDateString('en-US', {
                timeZone: 'UTC',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}{' '}
              -{' '}
              {parseDateString(
                scheduleToRender[scheduleToRender.length - 1].date
              ).toLocaleDateString('en-US', {
                timeZone: 'UTC',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
            <p style={{ fontSize: '14px', color: '#888', margin: '4px 0' }}>
              Total Planned Study Time: {formatDuration(totalPlannedMinutes)}
            </p>
          </>
        )}
      </div>

      {/* Schedule content starts IMMEDIATELY after header */}
      <main style={{ marginTop: 0 }}>
        {scheduleToRender.map((day) => (
          <div key={day.date} className="print-no-break" style={{ marginBottom: '32px' }}>
            <h2
              style={{
                fontSize: '18px',
                fontWeight: 'bold',
                marginBottom: '12px',
                borderBottom: '2px solid #666',
                paddingBottom: '8px',
                color: '#333',
              }}
            >
              {parseDateString(day.date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </h2>
            {day.isRestDay ? (
              <p style={{ fontStyle: 'italic', color: '#888', padding: '16px 8px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                Rest Day
              </p>
            ) : day.tasks.length === 0 ? (
              <p style={{ fontStyle: 'italic', color: '#888', padding: '16px 8px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                No tasks scheduled for a planned duration of{' '}
                {formatDuration(day.totalStudyTimeMinutes)}.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead style={{ borderBottom: '2px solid #ddd', backgroundColor: '#f3f3f3' }}>
                  <tr>
                    <th style={{ padding: '8px', textAlign: 'left', width: '60%', fontWeight: '600', color: '#555' }}>
                      Task
                    </th>
                    <th style={{ padding: '8px', textAlign: 'right', width: '15%', fontWeight: '600', color: '#555' }}>
                      Duration
                    </th>
                    <th style={{ padding: '8px', textAlign: 'left', width: '25%', fontWeight: '600', color: '#555' }}>
                      Topic
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {day.tasks.map((task, index) => (
                    <tr
                      key={task.id}
                      className="print-no-break"
                      style={{
                        borderBottom: '1px solid #eee',
                        backgroundColor: index % 2 !== 0 ? '#fafafa' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '6px 8px' }}>{task.title}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {formatDuration(task.durationMinutes)}
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '10px', color: '#666' }}>
                        {task.originalTopic}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #ddd' }}>
                    <td style={{ paddingTop: '8px', fontWeight: 'bold', textAlign: 'right' }}>
                      Total Time:
                    </td>
                    <td style={{ paddingTop: '8px', fontWeight: 'bold', textAlign: 'right', paddingRight: '8px' }}>
                      {formatDuration(
                        day.tasks.reduce((acc, t) => acc + t.durationMinutes, 0)
                      )}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        ))}
      </main>
      <footer style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid #ddd', textAlign: 'center', fontSize: '10px', color: '#888' }}>
        End of Report
      </footer>
    </div>
  );
};

export default ScheduleReport;
