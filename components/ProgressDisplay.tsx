import React from 'react';
import { StudyPlan, Domain } from '../types';
import { getDomainColorStyle } from '../utils/timeFormatter';
import { formatDuration } from '../utils/timeFormatter';

interface ProgressDisplayProps {
  studyPlan: StudyPlan;
}

const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ studyPlan }) => {
  const { progressPerDomain } = studyPlan;

  // FIX: Add explicit types for 'domain' parameter in reduce callbacks to avoid it being inferred as 'unknown'.
  const totalCompletedMinutes = Object.values(progressPerDomain).reduce((acc, domain: { completedMinutes: number; } | undefined) => acc + (domain?.completedMinutes || 0), 0);
  const totalMinutes = Object.values(progressPerDomain).reduce((acc, domain: { totalMinutes: number; } | undefined) => acc + (domain?.totalMinutes || 0), 0);
  const overallProgress = totalMinutes > 0 ? (totalCompletedMinutes / totalMinutes) * 100 : 0;

  return (
    <div className="space-y-6 pb-24">
      <div className="p-4 glass-panel rounded-lg">
        <h3 className="text-xl font-bold text-white mb-2">Overall Progress</h3>
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          {formatDuration(totalCompletedMinutes)} / {formatDuration(totalMinutes)} completed
        </p>
        <div className="w-full bg-black/30 rounded-full h-4 progress-bar-track">
          <div className="progress-bar-fill h-4 rounded-full flex items-center justify-center text-xs font-bold text-black" style={{ width: `${overallProgress}%` }}>
             {overallProgress > 10 && `${Math.round(overallProgress)}%`}
          </div>
        </div>
      </div>
      
      <div className="p-4 glass-panel rounded-lg">
        <h3 className="text-xl font-bold text-white mb-4">Progress by Topic</h3>
        <div className="space-y-4">
          {Object.entries(progressPerDomain)
            .sort(([domainA], [domainB]) => domainA.localeCompare(domainB))
            // FIX: Add explicit type for 'progress' parameter in map callback to avoid it being inferred as 'unknown'.
            .map(([domain, progress]: [string, { completedMinutes: number; totalMinutes: number; } | undefined]) => {
            if (!progress || progress.totalMinutes === 0) return null;
            const percentage = (progress.completedMinutes / progress.totalMinutes) * 100;
            const colorStyle = getDomainColorStyle(domain as Domain);
            return (
              <div key={domain}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="font-semibold text-sm text-[var(--text-primary)]">{domain}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{formatDuration(progress.completedMinutes)} / {formatDuration(progress.totalMinutes)}</span>
                </div>
                <div className="w-full bg-black/30 rounded-full h-2.5 progress-bar-track">
                  <div className="h-2.5 rounded-full" style={{ width: `${percentage}%`, backgroundColor: colorStyle.backgroundColor }}></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ProgressDisplay;
