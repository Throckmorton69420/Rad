import React from 'react';

export const ProgressHUD: React.FC<{
  title: string;
  percent: number;
}> = ({ title, percent }) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[9999]">
      <div className="w-64 h-64 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 relative flex items-center justify-center shadow-2xl">
        <div className="absolute inset-3 rounded-full bg-black/85" />
        <div className="relative z-10 text-center">
          <div className="text-white text-base font-semibold mb-1">{title}</div>
          <div className="text-purple-200 text-sm">{Math.min(100, Math.max(0, Math.round(percent)))}% complete</div>
          <div className="mt-3 w-40 h-2 bg-white/15 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-white/80" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};
