// utils/timeFormatter.ts
// FIX: Corrected import path for types.
import { Domain } from '../types';

/**
 * Robustly parses a 'YYYY-MM-DD' string into a Date object at midnight UTC.
 * This avoids timezone issues and parsing inconsistencies across browsers.
 * @param dateStr The date string to parse.
 * @returns A Date object.
 */
export const parseDateString = (dateStr: string): Date => {
    const [year, month, day] = dateStr.split('-').map(Number);
    // Month is 0-indexed in JS Date constructor (e.g., January is 0)
    // Using Date.UTC ensures the date is parsed as UTC, avoiding timezone shifts.
    return new Date(Date.UTC(year, month - 1, day));
};


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

const domainColorMap: Record<Domain, {bg: string, text: string}> = {
    [Domain.PHYSICS]: { bg: 'hsl(210, 60%, 55%)', text: '#FFFFFF' }, // Blue
    [Domain.BREAST_IMAGING]: { bg: 'hsl(350, 80%, 70%)', text: '#000000' }, // Pink
    [Domain.GASTROINTESTINAL_IMAGING]: { bg: 'hsl(35, 100%, 60%)', text: '#000000' }, // Orange
    [Domain.NUCLEAR_MEDICINE]: { bg: 'hsl(100, 50%, 55%)', text: '#000000' }, // Green
    [Domain.GENITOURINARY_IMAGING]: { bg: 'hsl(25, 80%, 50%)', text: '#FFFFFF' }, // Brown-Orange
    [Domain.NEURORADIOLOGY]: { bg: 'hsl(265, 60%, 65%)', text: '#FFFFFF' }, // Purple
    [Domain.PEDIATRIC_RADIOLOGY]: { bg: 'hsl(330, 90%, 70%)', text: '#000000' }, // Bright Pink
    [Domain.THORACIC_IMAGING]: { bg: 'hsl(200, 70%, 60%)', text: '#000000' }, // Cyan-Blue
    [Domain.CARDIOVASCULAR_IMAGING]: { bg: 'hsl(10, 85%, 60%)', text: '#FFFFFF' }, // Red-Orange
    [Domain.MUSCULOSKELETAL_IMAGING]: { bg: 'hsl(160, 60%, 45%)', text: '#FFFFFF' }, // Teal
    [Domain.INTERVENTIONAL_RADIOLOGY]: { bg: 'hsl(45, 90%, 55%)', text: '#000000' }, // Gold
    [Domain.ULTRASOUND_IMAGING]: { bg: 'hsl(55, 100%, 65%)', text: '#000000' }, // Yellow
    [Domain.NIS]: { bg: 'hsl(220, 15%, 65%)', text: '#000000' }, // Slate Gray
    [Domain.RISC]: { bg: 'hsl(210, 15%, 50%)', text: '#FFFFFF' }, // Darker Slate
    [Domain.HIGH_YIELD]: { bg: 'hsl(50, 100%, 50%)', text: '#000000' }, // Bright Yellow
    [Domain.MIXED_REVIEW]: { bg: 'hsl(0, 0%, 55%)', text: '#FFFFFF' }, // Gray
    [Domain.WEAK_AREA_REVIEW]: { bg: 'hsl(340, 70%, 55%)', text: '#FFFFFF' }, // Magenta
    [Domain.QUESTION_BANK_CATCHUP]: { bg: 'hsl(180, 30%, 50%)', text: '#FFFFFF' }, // Muted Teal
    [Domain.FINAL_REVIEW]: { bg: 'hsl(0, 0%, 90%)', text: '#000000' }, // Light Gray
    [Domain.LIGHT_REVIEW]: { bg: 'hsl(205, 50%, 75%)', text: '#000000' }, // Light Blue
};

// Function to get background color and appropriate text color
export const getDomainColorStyle = (domain: Domain): { backgroundColor: string; color: string } => {
  const colors = domainColorMap[domain] || domainColorMap[Domain.MIXED_REVIEW];
  return { backgroundColor: colors.bg, color: colors.text };
};

const sourceColorMap: Record<string, {bg: string, text: string}> = {
  'Titan Radiology': { bg: 'hsl(160, 60%, 45%)', text: '#FFFFFF' }, // Teal
  'Crack the Core': { bg: 'hsl(210, 60%, 55%)', text: '#FFFFFF' }, // Blue
  'Core Radiology': { bg: 'hsl(265, 60%, 65%)', text: '#FFFFFF' }, // Purple
  'War Machine': { bg: 'hsl(10, 85%, 60%)', text: '#FFFFFF' }, // Red-Orange
  'Huda': { bg: 'hsl(25, 80%, 50%)', text: '#FFFFFF' }, // Brown-Orange
  'Physics Review': { bg: 'hsl(35, 100%, 60%)', text: '#000000' }, // Orange
  'QEVLAR': { bg: 'hsl(55, 100%, 65%)', text: '#000000' }, // Yellow
  'Board Vitals': { bg: 'hsl(200, 70%, 60%)', text: '#000000' }, // Cyan-Blue
  'NucApp': { bg: 'hsl(100, 50%, 55%)', text: '#000000' }, // Green
  'Case Companion': { bg: 'hsl(180, 30%, 50%)', text: '#FFFFFF' }, // Muted Teal
  'Discord': { bg: 'hsl(240, 80%, 70%)', text: '#000000' }, // Blurple-ish
  'Guide': { bg: 'hsl(0, 0%, 55%)', text: '#FFFFFF' }, // Gray
  'Qbank': { bg: 'hsl(220, 15%, 65%)', text: '#000000' }, // Slate Gray
};

const defaultSourceColor = { bg: 'hsl(0, 0%, 30%)', text: '#FFFFFF' }; // A dark grey for unknown/custom sources

export const getSourceColorStyle = (source: string | undefined): { backgroundColor: string; color: string } => {
  if (!source) {
    return { backgroundColor: defaultSourceColor.bg, color: defaultSourceColor.text };
  }
  for (const key in sourceColorMap) {
    if (source.includes(key)) {
      const colors = sourceColorMap[key];
      return { backgroundColor: colors.bg, color: colors.text };
    }
  }
  return { backgroundColor: defaultSourceColor.bg, color: defaultSourceColor.text };
};
