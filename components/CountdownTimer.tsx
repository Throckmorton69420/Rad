import React, { useState, useEffect } from 'react';

interface CountdownTimerProps {
  examDate: string; // YYYY-MM-DD
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ examDate }) => {
  const calculateTimeLeft = () => {
    const difference = +new Date(examDate) - +new Date();
    let timeLeft = {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      months: 0,
      weeks: 0,
    };

    if (difference > 0) {
      timeLeft = {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
        months: 0, // More complex calculation needed for accurate months/weeks
        weeks: 0,
      };
      // Approximate months and weeks
      timeLeft.months = Math.floor(timeLeft.days / 30.44); // Average days in a month
      timeLeft.weeks = Math.floor((timeLeft.days % 30.44) / 7);
      timeLeft.days = Math.floor(timeLeft.days % 7); // Remaining days after weeks
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
      <div className="text-xs text-slate-400">Time Until Exam (Nov 12-14, 2025)</div>
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