import React from 'react';
// FIX: Corrected import path for types.
import { StudyPlan, DailySchedule } from '../types';
import { formatDuration, parseDateString } from '../utils/timeFormatter';

interface ScheduleReportProps {
  studyPlan: StudyPlan;
  schedule?: DailySchedule[]; // Optional override for printing subsets
}

const ScheduleReport: React.FC<ScheduleReportProps> = ({ studyPlan, schedule }) => {
  const scheduleToRender = schedule || studyPlan.schedule;
  const totalPlannedMinutes = scheduleToRender.reduce((acc, day) => acc + (day.isRestDay ? 0 : day.tasks.reduce((taskAcc, task) => taskAcc + task.durationMinutes, 0)), 0);

  return (
    <div className="p-4 md:p-8 font-sans text-black bg-white printable-report">
      <header className="mb-8 text-center border-b border-gray-300 pb-4">
        <div className="flex justify-between items-end print-header-footer">
          <span className="text-xs text-gray-500">Radiology Core Exam Study Planner</span>
          <span className="text-xs text-gray-500">{new Date().toLocaleString()}</span>
        </div>
        <div className="mt-4">
          <h1 className="text-2xl md:text-3xl font-bold">Radiology Core Exam - Study Schedule Report</h1>
          {scheduleToRender.length > 0 && (
            <>
              <p className="text-md md:text-lg text-gray-600">
                {parseDateString(scheduleToRender[0].date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })} - {parseDateString(scheduleToRender[scheduleToRender.length - 1].date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              <p className="text-sm md:text-md text-gray-500 mt-1">Total Planned Study Time: {formatDuration(totalPlannedMinutes)}</p>
            </>
          )}
        </div>
      </header>
      
      <main className="space-y-8">
        {scheduleToRender.map((day, index) => {
            const dayOfWeek = parseDateString(day.date).getUTCDay(); // Sunday = 0
            const isFirstDayOfWeek = dayOfWeek === 0;

            return (
              <div key={day.date} className={`print-no-break ${isFirstDayOfWeek && index > 0 ? 'print-page-break' : ''}`}>
                <h2 className="text-lg font-bold mb-3 border-b-2 border-gray-400 pb-2 text-gray-800">
                  {parseDateString(day.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                </h2>
                {day.isRestDay ? (
                  <p className="text-gray-500 italic px-2 py-4 bg-gray-50 rounded-md">Rest Day</p>
                ) : day.tasks.length === 0 ? (
                    <p className="text-gray-500 italic px-2 py-4 bg-gray-50 rounded-md">No tasks scheduled for a planned duration of {formatDuration(day.totalStudyTimeMinutes)}.</p>
                ) : (
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="border-b-2 border-gray-300 bg-gray-100">
                      <tr>
                        <th className="py-2 px-2 w-3/5 font-semibold text-gray-700">Task</th>
                        <th className="py-2 px-2 w-1/5 font-semibold text-gray-700 text-right">Duration</th>
                        <th className="py-2 px-2 w-1/5 font-semibold text-gray-700">Topic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.tasks.map(task => (
                        <tr key={task.id} className="border-b border-gray-200 print-no-break hover:bg-gray-50">
                          <td className="py-1.5 px-2">{task.title}</td>
                          <td className="py-1.5 px-2 text-right">{formatDuration(task.durationMinutes)}</td>
                          <td className="py-1.5 px-2 text-gray-600 text-xs">{task.originalTopic}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t-2 border-gray-300">
                            <td className="pt-2 font-bold text-right">Total Time:</td>
                            <td className="pt-2 px-2 font-bold text-right">{formatDuration(day.tasks.reduce((acc, t) => acc + t.durationMinutes, 0))}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            );
        })}
      </main>
      <footer className="mt-8 pt-4 border-t border-gray-300 text-center text-xs text-gray-500 print-header-footer">
        End of Report
      </footer>
    </div>
  );
};

export default ScheduleReport;
