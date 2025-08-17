// utils/timeFormatter.ts
export const formatDuration = (totalMinutes: number | undefined | null): string => {
  if (totalMinutes == null || isNaN(totalMinutes) || totalMinutes < 0) {
    return '0 min';
  }

  const roundedMinutes = Math.round(totalMinutes);

  if (roundedMinutes === 0) {
    // Show something for very small positive durations that round to 0.
    if (totalMinutes > 0) {
      return '< 1 min';
    }
    return '0 min';
  }

  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  }

  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`);
  }

  if (parts.length === 0) {
     return '0 min'; // Fallback for cases like totalMinutes=0
  }

  return parts.join(' ');
};

export const getMinuteInputDisplayValue = (val: number): string => {
    return (val % 1 === 0) ? val.toString() : val.toFixed(1);
};

/**
 * Gets the current date in 'YYYY-MM-DD' format for the 'America/New_York' timezone.
 * This ensures consistency regardless of the user's local system time.
 */
export const getTodayInNewYork = (): string => {
  const today = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/New_York',
  });

  const parts = formatter.formatToParts(today);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  
  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }

  // Fallback for rare cases where Intl.DateTimeFormat might fail or return unexpected parts
  console.warn("Could not determine New York date from Intl.DateTimeFormat, falling back to local date.");
  const localDate = new Date();
  const y = localDate.getFullYear();
  const m = String(localDate.getMonth() + 1).padStart(2, '0');
  const d = String(localDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};