// FIX: Imported Dispatch and SetStateAction to fix missing React namespace error.
import { useState, useEffect, useCallback, Dispatch, SetStateAction } from 'react';

export function usePersistentState<T>(key: string, initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
    const getInitialState = useCallback((): T => {
        try {
            const item = localStorage.getItem(key);
            if (item) {
                return JSON.parse(item);
            }
        } catch (error) {
            console.error(`Error reading localStorage key "${key}":`, error);
        }
        
        const value = initialValue instanceof Function ? initialValue() : initialValue;
        return value;

    }, [key, initialValue]);
    
    const [storedValue, setStoredValue] = useState<T>(getInitialState);

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(storedValue));
        } catch (error) {
            console.error(`Error setting localStorage key "${key}":`, error);
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue];
}