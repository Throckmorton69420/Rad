import React, { useRef, useEffect } from 'react';
import { Button } from './Button';
import FocusTrap from 'focus-trap-react';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WelcomeModal: React.FC<WelcomeModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <FocusTrap active={isOpen}>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[150]" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="modal-panel p-6 w-full max-w-lg text-[var(--text-primary)]" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
          <div className="flex justify-between items-center mb-4">
            <h2 id="welcome-title" className="text-2xl font-bold text-[var(--text-primary)] flex items-center">
                <i className="fas fa-brain mr-3 text-[var(--accent-purple)]"></i> Welcome to the Planner!
            </h2>
          </div>
          <div className="text-[var(--text-secondary)] space-y-4 mb-6">
            <p>This is your interactive, day-by-day study planner designed to get you ready for the Radiology Core Exam.</p>
            <div>
                <h3 className="font-semibold text-[var(--text-primary)] mb-1">Key Features:</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><strong className="text-[var(--accent-purple)]">Dynamic Schedule:</strong> A full study plan is automatically generated for you.</li>
                    <li><strong className="text-[var(--accent-purple)]">Rebalance:</strong> Use the controls on the left to rebalance the future schedule after you complete tasks or if your availability changes.</li>
                    <li><strong className="text-[var(--accent-purple)]">Modify Days:</strong> Use the "Modify Schedule & Resources" button to open a powerful editor where you can drag-and-drop tasks for a specific day.</li>
                    <li><strong className="text-[var(--accent-purple)]">Resource Pool:</strong> Inside the day modifier, you have access to your entire resource pool with advanced filtering, sorting, and management tools.</li>
                </ul>
            </div>
            <p>Your progress is saved automatically to the cloud. Let's get started!</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose} variant="primary">
              Let's Go!
            </Button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
};

export default WelcomeModal;