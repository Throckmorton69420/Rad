import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './Button';

interface CustomSelectProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ options, value, onChange, id, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(opt => opt.value === value) || options[0];

  const handleToggle = () => setIsOpen(prev => !prev);
  
  const handleSelect = (newValue: string) => {
    onChange(newValue);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };
  
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, handleClickOutside]);

  return (
    <div ref={wrapperRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      <button
        id={id}
        type="button"
        className="input-base !py-1.5 !text-sm text-left flex items-center justify-between !rounded-lg w-full"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedOption?.label || 'Select...'}</span>
        <i className={`fas fa-chevron-down transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}></i>
      </button>

      {isOpen && (
        <div 
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto p-1.5 modal-panel"
          role="listbox"
        >
          {options.map(option => (
            <div
              key={option.value}
              className={`p-2 text-sm rounded-md cursor-pointer hover:bg-white/10 ${value === option.value ? 'bg-white/20' : 'bg-transparent'}`}
              onClick={() => handleSelect(option.value)}
              onKeyPress={e => { if (e.key === 'Enter') handleSelect(option.value); }}
              role="option"
              aria-selected={value === option.value}
              tabIndex={0}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomSelect;