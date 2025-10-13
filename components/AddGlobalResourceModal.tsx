import React, { useState, useEffect } from 'react';
// FIX: Corrected import path for types.
import { Domain, ResourceType, ResourceEditorModalProps, StudyResource } from '../types';
import { Button } from './Button';
import TimeInputScroller from './TimeInputScroller';
import FocusTrap from 'focus-trap-react';
import CustomSelect from '../CustomSelect';

const ResourceEditorModal: React.FC<ResourceEditorModalProps> = ({ 
    isOpen, onClose, onSave, onRequestArchive, initialResource, availableDomains, availableResourceTypes 
}) => {
  const [title, setTitle] = useState('');
  const [totalMinutesDuration, setTotalMinutesDuration] = useState(30);
  const [selectedDomain, setSelectedDomain] = useState<Domain>(availableDomains[0] || Domain.PHYSICS);
  const [taskType, setTaskType] = useState<ResourceType>(availableResourceTypes[0] || ResourceType.READING_TEXTBOOK);
  
  const [pages, setPages] = useState<number | undefined>(undefined);
  const [startPage, setStartPage] = useState<number | undefined>(undefined);
  const [endPage, setEndPage] = useState<number | undefined>(undefined);
  const [questionCount, setQuestionCount] = useState<number | undefined>(undefined);
  const [bookSource, setBookSource] = useState<string | undefined>(undefined);
  const [videoSource, setVideoSource] = useState<string | undefined>(undefined);
  const [chapterNumber, setChapterNumber] = useState<number | undefined>(undefined);
  const [sequenceOrder, setSequenceOrder] = useState<number | undefined>(undefined);
  const [pairedResourceIdsStr, setPairedResourceIdsStr] = useState<string>('');
  const [isPrimaryMaterial, setIsPrimaryMaterial] = useState<boolean>(true);
  const [isSplittable, setIsSplittable] = useState<boolean>(true);

  const isEditMode = !!initialResource;

  const resetForm = () => {
    setTitle('');
    setTotalMinutesDuration(30);
    setSelectedDomain(availableDomains[0] || Domain.PHYSICS);
    setTaskType(availableResourceTypes[0] || ResourceType.READING_TEXTBOOK);
    setPages(undefined);
    setStartPage(undefined);
    setEndPage(undefined);
    setQuestionCount(undefined);
    setBookSource(undefined);
    setVideoSource(undefined);
    setChapterNumber(undefined);
    setSequenceOrder(undefined);
    setPairedResourceIdsStr('');
    setIsPrimaryMaterial(true);
    setIsSplittable(true);
  };

  useEffect(() => {
    if (isOpen) {
      if (initialResource) {
        setTitle(initialResource.title);
        setTotalMinutesDuration(initialResource.durationMinutes);
        setSelectedDomain(initialResource.domain);
        setTaskType(initialResource.type);
        setPages(initialResource.pages);
        setStartPage(initialResource.startPage);
        setEndPage(initialResource.endPage);
        setQuestionCount(initialResource.questionCount);
        setBookSource(initialResource.bookSource);
        setVideoSource(initialResource.videoSource);
        setChapterNumber(initialResource.chapterNumber);
        setSequenceOrder(initialResource.sequenceOrder);
        setPairedResourceIdsStr((initialResource.pairedResourceIds || []).join(', '));
        setIsPrimaryMaterial(initialResource.isPrimaryMaterial);
        setIsSplittable(initialResource.isSplittable ?? true);
      } else {
        resetForm();
      }
    }
  }, [initialResource, isOpen, availableDomains, availableResourceTypes]);

  useEffect(() => {
    if (startPage !== undefined && endPage !== undefined && endPage >= startPage) {
        setPages(endPage - startPage + 1);
    }
  }, [startPage, endPage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || totalMinutesDuration <= 0) {
      alert('Please provide a valid title and duration.');
      return;
    }
    const pairedResourceIds = pairedResourceIdsStr.split(',').map(id => id.trim()).filter(id => id);
    const finalSequenceOrder = sequenceOrder === undefined || isNaN(sequenceOrder) ? undefined : sequenceOrder;

    const resourceData: Omit<StudyResource, 'id'> & { id?: string } = {
        id: initialResource?.id,
        title, 
        durationMinutes: Math.round(totalMinutesDuration),
        domain: selectedDomain, 
        type: taskType,
        pages: pages || undefined,
        startPage: startPage || undefined,
        endPage: endPage || undefined,
        questionCount: questionCount || undefined,
        bookSource: bookSource || undefined,
        videoSource: videoSource || undefined,
        chapterNumber: chapterNumber || undefined,
        sequenceOrder: finalSequenceOrder,
        pairedResourceIds,
        isPrimaryMaterial,
        isSplittable,
        isArchived: initialResource?.isArchived || false,
    };
    onSave(resourceData);
  };
  
  const handleArchive = () => {
    if (initialResource) {
      onRequestArchive(initialResource.id);
    }
  };
  
  const domainOptions = availableDomains.map(d => ({ value: d, label: d }));
  const resourceTypeOptions = availableResourceTypes.map(rt => ({ value: rt, label: rt }));

  if (!isOpen) return null;

  return (
    <FocusTrap active={isOpen}>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[var(--z-modal)]" role="dialog" aria-modal="true" aria-labelledby="resource-editor-title">
        <div className="modal-panel p-6 w-full max-w-lg text-[var(--text-primary)] max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 id="resource-editor-title" className="text-xl font-semibold text-[var(--text-primary)]">
              {isEditMode ? 'Edit Resource' : 'Add New Resource'}
            </h2>
            <Button onClick={onClose} variant="ghost" size="sm" className="!p-1 !text-[var(--text-secondary)] hover:!text-[var(--text-primary)]" aria-label="Close resource editor">
              <i className="fas fa-times fa-lg"></i>
            </Button>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="globalResTitle" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Title:</label>
              <input type="text" id="globalResTitle" value={title} onChange={(e) => setTitle(e.target.value)}
                className="input-base text-sm" required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="globalResDomain" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Domain:</label>
                <CustomSelect id="globalResDomain" value={selectedDomain} onChange={(newValue) => setSelectedDomain(newValue as Domain)}
                  options={domainOptions} />
              </div>
              <div>
                <label htmlFor="globalResType" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Type:</label>
                <CustomSelect id="globalResType" value={taskType} onChange={(newValue) => setTaskType(newValue as ResourceType)}
                  options={resourceTypeOptions} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Duration:</label>
              <TimeInputScroller valueInMinutes={totalMinutesDuration} onChange={setTotalMinutesDuration} maxHours={10} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="globalResStartPage" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Start Pg (Opt.):</label>
                <input type="number" id="globalResStartPage" value={startPage || ''} onChange={(e) => setStartPage(parseInt(e.target.value) || undefined)} className="input-base text-sm" min="0"/>
              </div>
              <div>
                <label htmlFor="globalResEndPage" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">End Pg (Opt.):</label>
                <input type="number" id="globalResEndPage" value={endPage || ''} onChange={(e) => setEndPage(parseInt(e.target.value) || undefined)} className="input-base text-sm" min="0"/>
              </div>
              <div>
                  <label htmlFor="globalResPages" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Total Pgs (Opt.):</label>
                  <input type="number" id="globalResPages" value={pages || ''} onChange={(e) => setPages(parseInt(e.target.value) || undefined)}
                    className="input-base text-sm" min="0" disabled={startPage !== undefined && endPage !== undefined} />
              </div>
            </div>

            <div>
              <label htmlFor="globalResQs" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Questions (Opt.):</label>
              <input type="number" id="globalResQs" value={questionCount || ''} onChange={(e) => setQuestionCount(parseInt(e.target.value) || undefined)} className="input-base text-sm" min="0"/>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="globalResBookSource" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Book Source (Opt.):</label>
                <input type="text" id="globalResBookSource" value={bookSource || ''} onChange={(e) => setBookSource(e.target.value || undefined)}
                  className="input-base text-sm" />
              </div>
              <div>
                <label htmlFor="globalResVideoSource" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Video Source (Opt.):</label>
                <input type="text" id="globalResVideoSource" value={videoSource || ''} onChange={(e) => setVideoSource(e.target.value || undefined)}
                  className="input-base text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="globalResChapterNum" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Chapter # (Opt.):</label>
                <input type="number" id="globalResChapterNum" value={chapterNumber || ''} onChange={(e) => setChapterNumber(parseInt(e.target.value) || undefined)}
                  className="input-base text-sm" min="0" />
              </div>
              <div>
                <label htmlFor="globalResSeqOrder" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Sequence Order (Opt.):</label>
                <input type="number" id="globalResSeqOrder" value={sequenceOrder || ''} 
                      onChange={(e) => setSequenceOrder(e.target.value === '' ? undefined : parseInt(e.target.value))}
                  className="input-base text-sm" min="0" />
              </div>
            </div>

            <div>
              <label htmlFor="globalResPairedIds" className="block text-xs font-medium text-[var(--text-secondary)] mb-0.5">Paired Resource IDs (Opt., comma-sep.):</label>
              <input type="text" id="globalResPairedIds" value={pairedResourceIdsStr} onChange={(e) => setPairedResourceIdsStr(e.target.value)}
                className="input-base text-sm" placeholder="e.g., phys_002,breast_001"/>
            </div>
            
            <div className="flex items-center mt-2 justify-between">
              <label htmlFor="globalResIsPrimary" className="flex items-center text-xs text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" id="globalResIsPrimary" checked={isPrimaryMaterial} onChange={(e) => setIsPrimaryMaterial(e.target.checked)} 
                      className="h-3.5 w-3.5 text-[var(--accent-purple)] border-gray-700 rounded bg-gray-800 focus:ring-[var(--accent-purple)] mr-2"/>
                Primary Material
              </label>
              <label htmlFor="globalResIsSplittable" className="flex items-center text-xs text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" id="globalResIsSplittable" checked={isSplittable} onChange={(e) => setIsSplittable(e.target.checked)} 
                      className="h-3.5 w-3.5 text-[var(--accent-purple)] border-gray-700 rounded bg-gray-800 focus:ring-[var(--accent-purple)] mr-2"/>
                Splittable
              </label>
            </div>

            <div className="flex justify-between items-center pt-3">
              <div>
                  {isEditMode && (
                      <Button type="button" onClick={handleArchive} variant="danger" size="sm">
                          Archive
                      </Button>
                  )}
              </div>
              <div className="flex justify-end space-x-3">
                  <Button type="button" onClick={onClose} variant="secondary" size="sm">
                  Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm">
                  {isEditMode ? 'Update Resource' : 'Save Resource'}
                  </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </FocusTrap>
  );
};

export default ResourceEditorModal;
