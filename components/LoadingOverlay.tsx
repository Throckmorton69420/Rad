import React from 'react';

interface LoadingOverlayProps {
  progress: number;
  message: string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ progress, message }) => {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[var(--z-notification)] flex-col p-8 text-center transition-opacity duration-300">
      <div className="w-full max-w-md">
        <h2 className="text-2xl font-bold text-white mb-3">Generating Schedule</h2>
        <p className="text-base text-[var(--text-secondary)] mb-6 min-h-[40px]">{message || 'Please wait...'}</p>
        
        <div className="w-full bg-black/30 rounded-full h-4 progress-bar-track relative overflow-hidden">
          <div 
            className="progress-bar-fill h-4 rounded-full transition-all duration-300 ease-linear" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <p className="text-lg font-mono text-white mt-3">{Math.round(progress)}%</p>
      </div>
    </div>
  );
};

export default LoadingOverlay;
