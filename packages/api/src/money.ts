import { AppError } from './errors.js';

/** Parse a decimal amount (number or string, max 2 decimals) into integer minor units. */
export function toMinor(value: unknown, field = 'amount'): number {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a non-negative decimal with at most 2 decimal places`);
  }
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

export function fromMinor(minor: number): number {
  return minor / 100;
}
