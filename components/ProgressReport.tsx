import React from 'react';
import { StudyPlan, Domain, ResourceType } from '../types';
import { formatDuration, parseDateString } from '../utils/timeFormatter';

interface ProgressReportProps {
  studyPlan: StudyPlan;
}

const ProgressReport: React.FC<ProgressReportProps> = ({ studyPlan }) => {
  const allTasks = studyPlan.schedule.flatMap(day => day.tasks);
  
  const { totalScheduledMinutes, totalCompletedMinutes } = allTasks.reduce(
    (acc, task) => {
      acc.totalScheduledMinutes += task.durationMinutes;
      if (task.status === 'completed') {
        acc.totalCompletedMinutes += task.durationMinutes;
      }
      return acc;
    },
    { totalScheduledMinutes: 0, totalCompletedMinutes: 0 }
  );

  const overallPercentage = totalScheduledMinutes > 0 ? (totalCompletedMinutes / totalScheduledMinutes) * 100 : 0;

  const progressByTopic = Object.values(Domain).map(domain => {
    const tasksInDomain = allTasks.filter(t => t.originalTopic === domain);
    if (tasksInDomain.length === 0) return null;
    const total = tasksInDomain.reduce((sum, t) => sum + t.durationMinutes, 0);
    const completed = tasksInDomain.filter(t => t.status === 'completed').reduce((sum, t) => sum + t.durationMinutes, 0);
    return { name: domain, total, completed };
  }).filter(Boolean);

  return (
    <div className="p-8 font-sans text-black bg-white printable-report">
      <header className="mb-8 text-center border-b pb-4">
        <h1 className="text-3xl font-bold">Study Progress Report</h1>
        <p className="text-lg text-gray-600">Generated on {new Date().toLocaleDateString()}</p>
      </header>

      <section className="mb-8 print-no-break">
        <h2 className="text-2xl font-semibold mb-3">Overall Progress</h2>
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr>
              <th className="py-1 pr-2 w-1/3 font-semibold">Metric</th>
              <th className="py-1 pl-2 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="py-1 pr-2 font-semibold">Total Completion</td>
              <td className="py-1 pl-2">{Math.round(overallPercentage)}%</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-1 pr-2 font-semibold">Time Completed</td>
              <td className="py-1 pl-2">{formatDuration(totalCompletedMinutes)}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-1 pr-2 font-semibold">Total Time Scheduled</td>
              <td className="py-1 pl-2">{formatDuration(totalScheduledMinutes)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-8 print-no-break">
        <h2 className="text-2xl font-semibold mb-3">Progress by Topic</h2>
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr>
              <th className="py-1 pr-2 w-1/3 font-semibold">Topic</th>
              <th className="py-1 px-2 font-semibold">Progress</th>
              <th className="py-1 pl-2 font-semibold">Time (Completed / Total)</th>
            </tr>
          </thead>
          <tbody>
            {progressByTopic.map(p => p && (
              <tr key={p.name} className="border-b border-gray-200">
                <td className="py-1 pr-2">{p.name}</td>
                <td className="py-1 px-2">{p.total > 0 ? `${Math.round((p.completed / p.total) * 100)}%` : 'N/A'}</td>
                <td className="py-1 pl-2">{formatDuration(p.completed)} / {formatDuration(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="mt-8 pt-4 border-t text-center text-xs text-gray-500">
        End of Report
      </footer>
    </div>
  );
};

export default ProgressReport;
