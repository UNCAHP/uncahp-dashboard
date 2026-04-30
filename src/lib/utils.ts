import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatGBP(value: number | null | undefined, opts: { decimals?: number } = {}) {
  if (value == null) return '—';
  const { decimals = 0 } = opts;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-GB').format(value);
}

export function formatPercent(value: number | null | undefined, decimals = 1) {
  if (value == null) return '—';
  return `${value.toFixed(decimals)}%`;
}
