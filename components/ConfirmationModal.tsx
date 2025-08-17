import React from 'react';
import { Button } from './Button';
import { ConfirmationModalProps } from '../types';
import FocusTrap from 'focus-trap-react';

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
}) => {
  if (!isOpen) return null;

  return (
    <FocusTrap active={isOpen}>
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[var(--z-notification)]" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
            <div className="modal-panel static-glow-border p-6 w-full max-w-md text-[var(--text-primary)]">
                <div className="flex justify-between items-center mb-4">
                <h2 id="confirmation-title" className="text-xl font-semibold text-[var(--text-primary)]">{title}</h2>
                <Button onClick={onClose} variant="ghost" size="sm" className="!p-1 !text-[var(--text-secondary)] hover:!text-[var(--text-primary)]" aria-label="Close confirmation dialog">
                    <i className="fas fa-times fa-lg"></i>
                </Button>
                </div>
                <div className="text-[var(--text-secondary)] mb-6">{message}</div>
                <div className="flex justify-end space-x-3">
                <Button onClick={onClose} variant="secondary">
                    {onCancel ? 'Dismiss' : cancelText}
                </Button>
                {onCancel && (
                    <Button onClick={onCancel} variant="secondary">
                        {cancelText}
                    </Button>
                )}
                <Button onClick={onConfirm} variant={confirmVariant}>
                    {confirmText}
                </Button>
                </div>
            </div>
        </div>
    </FocusTrap>
  );
};

export default ConfirmationModal;