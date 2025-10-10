import React from 'react';
import { StudyPlan, DailySchedule } from '../types';
import { formatDuration, parseDateString } from '../utils/timeFormatter';

interface ScheduleReportProps {
  studyPlan: StudyPlan;
  schedule?: DailySchedule[]; // Optional override for printing subsets
}

const ScheduleReport: React.FC<ScheduleReportProps> = ({ studyPlan, schedule }) => {
  const scheduleToRender = schedule || studyPlan.schedule;
  const totalPlannedMinutes = scheduleToRender.reduce((acc, day) => acc + (day.isRestDay ? 0 : day.totalStudyTimeMinutes), 0);

  return (
    <div className="p-8 font-sans text-black bg-white printable-report">
      <header className="mb-8 text-center border-b pb-4">
        <div className="flex justify-between items-end">
          <span className="text-sm text-gray-500">Radiology Core Exam Study Planner</span>
          <span className="text-sm text-gray-500">{new Date().toLocaleString()}</span>
        </div>
        <div className="mt-4">
          <h1 className="text-3xl font-bold">Radiology Core Exam - Study Schedule Report</h1>
          <p className="text-lg text-gray-600">
            {parseDateString(scheduleToRender[0].date).toLocaleDateString('en-US', { timeZone: 'UTC' })} - {parseDateString(scheduleToRender[scheduleToRender.length - 1].date).toLocaleDateString('en-US', { timeZone: 'UTC' })}
          </p>
          <p className="text-md text-gray-500 mt-1">Total Planned Study Time: {formatDuration(totalPlannedMinutes)}</p>
        </div>
      </header>
      
      <div className="space-y-6">
        {scheduleToRender.map((day, index) => {
            const dayOfWeek = parseDateString(day.date).getUTCDay(); // Sunday = 0
            const isFirstDayOfWeek = dayOfWeek === 0;

            return (
              <div key={day.date} className={`print-no-break ${isFirstDayOfWeek && index > 0 ? 'print-page-break' : ''}`}>
                <h2 className="text-xl font-semibold mb-3 border-b pb-2">
                  {parseDateString(day.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                </h2>
                {day.isRestDay ? (
                  <p className="text-gray-500 italic">Rest Day</p>
                ) : day.tasks.length === 0 ? (
                    <p className="text-gray-500 italic">No tasks scheduled for a planned duration of {formatDuration(day.totalStudyTimeMinutes)}.</p>
                ) : (
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="border-b-2 border-black">
                      <tr>
                        <th className="py-1 pr-2 w-3/5 font-semibold">Task</th>
                        <th className="py-1 px-2 w-1/5 font-semibold">Duration</th>
                        <th className="py-1 pl-2 w-1/5 font-semibold">Topic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.tasks.map(task => (
                        <tr key={task.id} className="border-b border-gray-200">
                          <td className="py-1 pr-2">{task.title}</td>
                          <td className="py-1 px-2">{formatDuration(task.durationMinutes)}</td>
                          <td className="py-1 pl-2">{task.originalTopic}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td className="pt-2 font-bold text-right">Total Time:</td>
                            <td className="pt-2 px-2 font-bold">{formatDuration(day.tasks.reduce((acc, t) => acc + t.durationMinutes, 0))}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            );
        })}
      </div>
      <footer className="mt-8 pt-4 border-t text-center text-xs text-gray-500">
        End of Report
      </footer>
    </div>
  );
};

export default ScheduleReport;
