import { describe, expect, it } from 'vitest';
import {
  historicalExceptionBlob,
  matchesHistoricalException,
} from '../../scripts/content-history-exceptions.mjs';

describe('historical content exceptions', () => {
  it('matches only the reviewed commit, file, finding, and blob', () => {
    const commit = 'a687a01bb2088169287daab220d37b49c4c6a127';
    expect(
      historicalExceptionBlob(commit, 'tests/unit/chatgpt-service.test.ts', 'possible secret'),
    ).toBe('889e33a52ab4e2ffd689245d50b3e6362f88420f');
    expect(
      historicalExceptionBlob(
        '0000000000000000000000000000000000000000',
        'tests/unit/chatgpt-service.test.ts',
        'possible secret',
      ),
    ).toBeUndefined();
    expect(
      historicalExceptionBlob(commit, 'tests/unit/chatgpt-service.test.ts', 'protected term'),
    ).toBeUndefined();
    expect(
      historicalExceptionBlob(commit, 'tests/unit/other.test.ts', 'possible secret'),
    ).toBeUndefined();
    expect(
      matchesHistoricalException(
        commit,
        'tests/unit/chatgpt-service.test.ts',
        'possible secret',
        '889e33a52ab4e2ffd689245d50b3e6362f88420f',
      ),
    ).toBe(true);
    expect(
      matchesHistoricalException(
        commit,
        'tests/unit/chatgpt-service.test.ts',
        'possible secret',
        '0000000000000000000000000000000000000000',
      ),
    ).toBe(false);
    expect(
      matchesHistoricalException(
        '0000000000000000000000000000000000000000',
        'tests/unit/chatgpt-service.test.ts',
        'possible secret',
        '889e33a52ab4e2ffd689245d50b3e6362f88420f',
      ),
    ).toBe(false);
  });
});
