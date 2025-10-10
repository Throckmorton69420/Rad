import { StudyResource, Omit } from '../types';

/**
 * Creates a new study resource object with a unique ID.
 * This function is used when adding a new resource to the master pool.
 * @param resourceData - The resource data without an ID.
 * @returns A full StudyResource object with a new unique ID.
 */
export const addResourceToGlobalPool = (resourceData: Omit<StudyResource, 'id'>): StudyResource => {
  // Generate a reasonably unique ID. For a real app, a proper UUID library would be better.
  const newId = `${(resourceData.domain || 'custom').slice(0, 4).toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  return {
    ...resourceData,
    id: newId,
  };
};
