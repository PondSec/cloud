import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(value: number): string {
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** index;
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const ONLYOFFICE_EXTENSIONS = new Set([
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'pdf',
  'xls',
  'xlsx',
  'ods',
  'csv',
  'ppt',
  'pptx',
  'odp',
]);

export function isOnlyOfficeSupportedFileName(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return false;
  }
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return ONLYOFFICE_EXTENSIONS.has(ext);
}
