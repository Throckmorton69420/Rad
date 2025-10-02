import React, { useState, useEffect } from 'react';
import { parseDateString } from '../utils/timeFormatter';

interface CountdownTimerProps {
  examDate: string; // YYYY-MM-DD
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ examDate }) => {
  const calculateTimeLeft = () => {
    const targetDate = parseDateString(examDate); // Safely parse as UTC midnight
    const difference = +targetDate - +new Date(); // Difference from now (local) to target

    let timeLeft = {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      months: 0,
      weeks: 0,
    };

    if (difference > 0) {
      const totalDays = Math.floor(difference / (1000 * 60 * 60 * 24));
      
      // Approximate breakdown for display
      timeLeft.months = Math.floor(totalDays / 30.44);
      const remainingDaysAfterMonths = totalDays - Math.floor(timeLeft.months * 30.44);
      timeLeft.weeks = Math.floor(remainingDaysAfterMonths / 7);
      timeLeft.days = remainingDaysAfterMonths % 7;
      
      // Exact time part
      timeLeft.hours = Math.floor((difference / (1000 * 60 * 60)) % 24);
      timeLeft.minutes = Math.floor((difference / 1000 / 60) % 60);
      timeLeft.seconds = Math.floor((difference / 1000) % 60);
    }
    return timeLeft;
  };

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  useEffect(() => {
    const timer = setTimeout(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);
    return () => clearTimeout(timer);
  });

  const formatPlural = (value: number, unit: string) => `${value} ${unit}${value !== 1 ? 's' : ''}`;

  return (
    <div className="text-right">
      <div className="text-xs text-slate-400">Time Until Exam (Nov 11, 2025)</div>
      {timeLeft.months > 0 || timeLeft.weeks > 0 || timeLeft.days > 0 || timeLeft.hours > 0 || timeLeft.minutes > 0 || timeLeft.seconds > 0 ? (
        <div className="text-sm font-medium">
          {timeLeft.months > 0 && `${formatPlural(timeLeft.months, 'Month')} `}
          {timeLeft.weeks > 0 && `${formatPlural(timeLeft.weeks, 'Week')} `}
          {timeLeft.days > 0 && `${formatPlural(timeLeft.days, 'Day')} `}
          {`${String(timeLeft.hours).padStart(2, '0')}:${String(timeLeft.minutes).padStart(2, '0')}:${String(timeLeft.seconds).padStart(2, '0')}`}
        </div>
      ) : (
        <span className="text-sm font-medium">Exam Time! Good Luck!</span>
      )}
    </div>
  );
};

export default CountdownTimer;