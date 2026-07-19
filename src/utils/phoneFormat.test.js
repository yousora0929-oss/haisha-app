import { describe, expect, it } from 'vitest';
import { formatPhoneNumberJP } from './phoneFormat.js';

describe('formatPhoneNumberJP', () => {
  it('formats mobile 11-digit numbers as 3-4-4', () => {
    expect(formatPhoneNumberJP('09012345678')).toBe('090-1234-5678');
    expect(formatPhoneNumberJP('08011112222')).toBe('080-1111-2222');
    expect(formatPhoneNumberJP('07099998888')).toBe('070-9999-8888');
    expect(formatPhoneNumberJP('05012345678')).toBe('050-1234-5678');
  });

  it('leaves insufficient-digit mobile/IP numbers unchanged', () => {
    expect(formatPhoneNumberJP('0501234567')).toBe('0501234567');
  });

  it('leaves already-hyphenated numbers unchanged', () => {
    expect(formatPhoneNumberJP('097-536-1111')).toBe('097-536-1111');
    expect(formatPhoneNumberJP('090-1111-2222')).toBe('090-1111-2222');
  });

  it('returns empty string for empty input', () => {
    expect(formatPhoneNumberJP('')).toBe('');
    expect(formatPhoneNumberJP(null)).toBe('');
    expect(formatPhoneNumberJP(undefined)).toBe('');
    expect(formatPhoneNumberJP('   ')).toBe('');
  });

  it('leaves numbers with symbols unchanged', () => {
    expect(formatPhoneNumberJP('090-1234-5678')).toBe('090-1234-5678');
    expect(formatPhoneNumberJP('(090)12345678')).toBe('(090)12345678');
    expect(formatPhoneNumberJP('+819012345678')).toBe('+819012345678');
  });

  it('formats toll-free numbers when digits-only', () => {
    expect(formatPhoneNumberJP('0120123456')).toBe('0120-123-456');
    expect(formatPhoneNumberJP('08001234567')).toBe('0800-123-4567');
  });

  it('does not format landline-like digit strings', () => {
    expect(formatPhoneNumberJP('0975361111')).toBe('0975361111');
  });
});
