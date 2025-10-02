import React, { useState } from 'react';
import { ExceptionDateRule } from '../types';
import { Button } from './Button';
import CustomSelect from '../CustomSelect';
import { MOONLIGHTING_WEEKDAY_TARGET_MINS, MOONLIGHTING_WEEKEND_TARGET_MINS } from '../constants';

interface AddExceptionDayProps {
  onAddException: (rule: ExceptionDateRule) => void;
  isLoading: boolean;
}

type ExceptionType = 'free-day' | 'weekday-moonlighting' | 'weekend-moonlighting';

const AddExceptionDay: React.FC<AddExceptionDayProps> = ({ onAddException, isLoading }) => {
  const [date, setDate] = useState<string>('');
  const [type, setType] = useState<ExceptionType>('free-day');

  const handleSubmit = () => {
    if (!date) {
      alert('Please select a date for the exception.');
      return;
    }

    let rule: ExceptionDateRule;

    switch (type) {
      case 'free-day':
        rule = {
          date: date,
          dayType: 'specific-rest',
          isRestDayOverride: true,
          targetMinutes: 0,
        };
        break;
      case 'weekday-moonlighting':
        rule = {
          date: date,
          dayType: 'weekday-moonlighting',
          isRestDayOverride: false,
          targetMinutes: MOONLIGHTING_WEEKDAY_TARGET_MINS,
        };
        break;
      case 'weekend-moonlighting':
        rule = {
          date: date,
          dayType: 'weekend-moonlighting',
          isRestDayOverride: false,
          targetMinutes: MOONLIGHTING_WEEKEND_TARGET_MINS,
        };
        break;
    }
    
    onAddException(rule);
    setDate(''); // Reset date field
  };
  
  const exceptionOptions = [
    { value: 'free-day', label: 'Free/Off Day' },
    { value: 'weekday-moonlighting', label: 'Weekday Moonlighting (1-2hr study)' },
    { value: 'weekend-moonlighting', label: 'Weekend Moonlighting (3-4hr study)' },
  ];

  return (
    <div className="p-4 rounded-lg space-y-3 glass-panel">
        <h2 className="text-lg font-semibold mb-2 border-b border-[var(--separator-primary)] pb-2 text-[var(--text-primary)]">Add Exception Day</h2>
        <div>
            <label htmlFor="exception-date" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Date:</label>
            <input
                type="date"
                id="exception-date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input-base text-sm"
            />
        </div>
        <div>
            <label htmlFor="exception-type" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Type:</label>
            <CustomSelect
                id="exception-type"
                value={type}
                onChange={(newValue) => setType(newValue as ExceptionType)}
                options={exceptionOptions}
            />
        </div>
        <Button onClick={handleSubmit} className="w-full" variant="secondary" size="sm" disabled={isLoading || !date}>
            <i className="fas fa-plus mr-2"></i> Add & Rebalance
        </Button>
    </div>
  );
};

export default AddExceptionDay;