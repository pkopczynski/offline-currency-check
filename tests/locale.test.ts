import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { preferredLocale } from '../src/locale.ts';

describe('preferredLocale', () => {
  test("picks the device's first preferred language", () => {
    assert.equal(preferredLocale({ languages: ['pl-PL', 'en-US'], language: 'en-US' }), 'pl-PL');
  });

  test('uses the single language when there is no list', () => {
    assert.equal(preferredLocale({ languages: [], language: 'de' }), 'de');
    assert.equal(preferredLocale({ language: 'tr-TR' }), 'tr-TR');
  });

  test('falls back to English when the device gives no language', () => {
    assert.equal(preferredLocale({}), 'en');
    assert.equal(preferredLocale({ languages: [''], language: '' }), 'en');
    assert.equal(preferredLocale(undefined), 'en');
  });
});
