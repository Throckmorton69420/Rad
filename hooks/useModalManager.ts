import { useState, useCallback } from 'react';
import { StudyResource, ShowConfirmationOptions, ConfirmationModalProps, PrintModalProps } from '../types';

export interface ModalStates {
  isAddTaskModalOpen: boolean;
  isModifyDayTasksModalOpen: boolean;
  isResourceEditorOpen: boolean;
  isWelcomeModalOpen: boolean;
  isPrintModalOpen: boolean;
  confirmationState: ConfirmationModalProps;
}

export interface ModalData {
  editingResource: StudyResource | null;
}

export const useModalManager = () => {
  const [modalStates, setModalStates] = useState<ModalStates>({
    isAddTaskModalOpen: false,
    isModifyDayTasksModalOpen: false,
    isResourceEditorOpen: false,
    isWelcomeModalOpen: false,
    isPrintModalOpen: false,
    confirmationState: { isOpen: false, title: '', message: '', onConfirm: () => {}, onClose: () => {}},
  });

  const [modalData, setModalData] = useState<ModalData>({
    editingResource: null,
  });

  const openModal = useCallback((modalName: keyof Omit<ModalStates, 'confirmationState'>) => {
    setModalStates(prev => ({ ...prev, [modalName]: true }));
  }, []);

  const closeModal = useCallback((modalName: keyof Omit<ModalStates, 'confirmationState'>) => {
    setModalStates(prev => ({ ...prev, [modalName]: false }));
  }, []);

  const openResourceEditor = useCallback((resource: StudyResource | null) => {
    setModalData({ editingResource: resource });
    openModal('isResourceEditorOpen');
  }, [openModal]);

  const closeResourceEditor = useCallback(() => {
    closeModal('isResourceEditorOpen');
    setModalData({ editingResource: null });
  }, [closeModal]);
  
  const closeConfirmation = () => {
    setModalStates(p => ({ ...p, confirmationState: { ...p.confirmationState, isOpen: false }}));
  }

  const showConfirmation = useCallback((options: ShowConfirmationOptions) => {
    setModalStates(prev => ({
      ...prev,
      confirmationState: {
        isOpen: true,
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        confirmVariant: options.confirmVariant,
        cancelText: options.cancelText,
        onConfirm: () => {
          options.onConfirm();
          closeConfirmation();
        },
        onCancel: options.onCancel ? () => {
          options.onCancel!();
          closeConfirmation();
        } : undefined,
        onClose: closeConfirmation,
      }
    }));
  }, []);
  
  const handleConfirm = useCallback(() => {
    modalStates.confirmationState.onConfirm();
  }, [modalStates.confirmationState]);

  return {
    modalStates,
    modalData,
    openModal,
    closeModal,
    openResourceEditor,
    closeResourceEditor,
    showConfirmation,
    handleConfirm,
  };
};
