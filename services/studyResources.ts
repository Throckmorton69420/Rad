import { StudyResource, Domain, ResourceType } from '../types';
import resourceData from './studyResources.json';

// By explicitly casting the imported JSON, we ensure type safety
// while completely avoiding the TypeScript error caused by a large array literal.
export const masterResourcePool: StudyResource[] = resourceData as StudyResource[];

/**
 * Adds a new resource to the global resource pool.
 * This is a factory function to ensure all properties are correctly initialized,
 * especially for custom resources created by the user.
 * 
 * @param resourceData - The data for the new resource, omitting the 'id' and other auto-generated fields.
 * @returns The fully-formed StudyResource object with a new unique ID.
 */
export const addResourceToGlobalPool = (resourceData: Omit<StudyResource, 'id' | 'isArchived'>): StudyResource => {
  const newResource: StudyResource = {
    ...resourceData,
    id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    isArchived: false, // Custom resources are never archived by default.
  };
  
  // Note: This function only creates the object. The calling logic is responsible
  // for updating the state (e.g., adding it to a stateful version of the resource pool).
  return newResource;
};
