import { describe, expect, it } from 'vitest';
import { timezoneToAdopt } from './timezone-sync';

describe('timezoneToAdopt', () => {
  it('replaces the UTC default with the device zone', () => {
    expect(timezoneToAdopt('UTC', 'Africa/Dar_es_Salaam')).toBe('Africa/Dar_es_Salaam');
    expect(timezoneToAdopt(null, 'Europe/London')).toBe('Europe/London');
  });
  it('keeps a zone the user chose, and ignores UTC devices', () => {
    expect(timezoneToAdopt('Europe/Paris', 'Africa/Dar_es_Salaam')).toBeNull();
    expect(timezoneToAdopt('UTC', 'UTC')).toBeNull();
    expect(timezoneToAdopt('UTC', undefined)).toBeNull();
  });
});
