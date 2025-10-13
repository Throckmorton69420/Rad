import React from 'react';
import { StudyResource } from '../types';
import { formatDuration } from '../utils/timeFormatter';

interface ContentReportProps {
  resources: (StudyResource & { isScheduled: boolean, source: string })[];
  title: string;
}

const ContentReport: React.FC<ContentReportProps> = ({ resources, title }) => {
  return (
    <div className="p-8 font-sans text-black bg-white printable-report">
      <header className="mb-8 text-center border-b pb-4">
        <h1 className="text-3xl font-bold">Content Report: {title}</h1>
        <p className="text-lg text-gray-600">Generated on {new Date().toLocaleDateString()}</p>
      </header>
      
      <table className="w-full text-left text-sm border-collapse">
        <thead className="border-b-2 border-black">
          <tr>
            <th className="py-1 pr-2 w-2/5 font-semibold">Title</th>
            <th className="py-1 px-2 font-semibold">Status</th>
            <th className="py-1 px-2 font-semibold">Domain</th>
            <th className="py-1 px-2 font-semibold">Type</th>
            <th className="py-1 px-2 font-semibold">Source</th>
            <th className="py-1 pl-2 font-semibold">Duration</th>
          </tr>
        </thead>
        <tbody>
          {resources.map(resource => (
            <tr key={resource.id} className="border-b border-gray-200 print-no-break">
              <td className="py-1 pr-2">{resource.title}</td>
              <td className="py-1 px-2">{resource.isScheduled ? 'Scheduled' : 'Unscheduled'}</td>
              <td className="py-1 px-2">{resource.domain}</td>
              <td className="py-1 px-2">{resource.type}</td>
              <td className="py-1 px-2">{resource.source}</td>
              <td className="py-1 pl-2">{formatDuration(resource.durationMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="mt-8 pt-4 border-t text-center text-xs text-gray-500">
        End of Report
      </footer>
    </div>
  );
};

export default ContentReport;
