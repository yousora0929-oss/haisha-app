import { describe, expect, it } from 'vitest';
import {
  formatPhoneAsYouType,
  formatPhoneJP,
  formatPhoneNumberJP,
  isSamePhone,
  phoneDigits,
} from './phoneFormat.js';

describe('formatPhoneJP', () => {
  it('formats Oita, Beppu, mobile, and toll-free numbers', () => {
    expect(formatPhoneJP('0975288666')).toBe('097-528-8666');
    expect(formatPhoneJP('0977221234')).toBe('0977-22-1234');
    expect(formatPhoneJP('09012345678')).toBe('090-1234-5678');
    expect(formatPhoneJP('08011112222')).toBe('080-1111-2222');
    expect(formatPhoneJP('07099998888')).toBe('070-9999-8888');
    expect(formatPhoneJP('0120123456')).toBe('0120-123-456');
    expect(formatPhoneJP('08001234567')).toBe('0800-123-4567');
    expect(formatPhoneJP('05012345678')).toBe('050-1234-5678');
  });

  it('accepts hyphens and fullwidth digits', () => {
    expect(formatPhoneJP('097-528-8666')).toBe('097-528-8666');
    expect(formatPhoneJP('０９０１２３４５６７８')).toBe('090-1234-5678');
    expect(formatPhoneJP('090-1234-5678')).toBe('090-1234-5678');
  });

  it('leaves login ids and empty values unchanged', () => {
    expect(formatPhoneJP('kanda005')).toBe('kanda005');
    expect(formatPhoneJP('')).toBe('');
    expect(formatPhoneJP(null)).toBe('');
    expect(formatPhoneJP(undefined)).toBe('');
    expect(formatPhoneJP('   ')).toBe('');
  });

  it('does not drop a leading zero from an incomplete number', () => {
    expect(formatPhoneJP('0501234567')).toBe('0501234567');
  });

  it('keeps the previous helper name', () => {
    expect(formatPhoneNumberJP('09012345678')).toBe('090-1234-5678');
  });
});

describe('phoneDigits and isSamePhone', () => {
  it('strips hyphens and fullwidth characters', () => {
    expect(phoneDigits('０９０-１２３４-５６７８')).toBe('09012345678');
    expect(phoneDigits('kanda005')).toBe('005');
    expect(phoneDigits('')).toBe('');
  });

  it('compares digit sequences and rejects empty values', () => {
    expect(isSamePhone('090-1234-5678', '09012345678')).toBe(true);
    expect(isSamePhone('０９０１２３４５６７８', '090-1234-5678')).toBe(true);
    expect(isSamePhone('09012345678', '08012345678')).toBe(false);
    expect(isSamePhone('', '09012345678')).toBe(false);
    expect(isSamePhone('kanda', '')).toBe(false);
  });
});

describe('formatPhoneAsYouType', () => {
  it('inserts hyphens while typing a mobile number', () => {
    expect(formatPhoneAsYouType('09012345678')).toBe('090-1234-5678');
    expect(formatPhoneAsYouType('0975288666')).toBe('097-528-8666');
    expect(formatPhoneAsYouType('0977221234')).toBe('0977-22-1234');
  });

  it('does not hyphenate a login id', () => {
    expect(formatPhoneAsYouType('kanda005')).toBe('kanda005');
    expect(formatPhoneAsYouType('')).toBe('');
  });
});
