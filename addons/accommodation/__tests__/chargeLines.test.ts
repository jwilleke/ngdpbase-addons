import { describe, expect, test } from 'vitest';
import { chargeLinesFrom, splitIntoLines } from '../managers/chargeLines.js';

const FAIRWAYS = [{ description: 'Reserve Contribution', percent: 61.49 }, { description: 'Operating Contribution' }];

describe('charge lines (#44)', () => {
  test("The Fairways' lines: reserve 61.49% to the nearest cent, operating the rest, adding up exactly", () => {
    const rules = chargeLinesFrom(FAIRWAYS);
    expect(splitIntoLines(33800, rules, 'A Model')).toEqual([{ description: 'Reserve Contribution', amount: 20784 }, { description: 'Operating Contribution', amount: 13016 }]);
    expect(splitIntoLines(41000, rules, 'C Model')).toEqual([{ description: 'Reserve Contribution', amount: 25211 }, { description: 'Operating Contribution', amount: 15789 }]);
    expect(splitIntoLines(58400, rules, 'D Model')).toEqual([{ description: 'Reserve Contribution', amount: 35910 }, { description: 'Operating Contribution', amount: 22490 }]);
    expect(splitIntoLines(0, rules, 'Clubhouse')).toEqual([{ description: 'Reserve Contribution', amount: 0 }, { description: 'Operating Contribution', amount: 0 }]);
  });

  test('with no lines set, an assessment is one line named after its category', () => {
    expect(chargeLinesFrom(undefined)).toEqual([]);
    expect(chargeLinesFrom([])).toEqual([]);
    expect(splitIntoLines(41000, [], 'C Model')).toEqual([{ description: 'C Model', amount: 41000 }]);
  });

  test.each([
    [{}, 'must be a list'],
    [[{ percent: 50 }, { description: 'Rest' }], 'needs a description'],
    [[{ description: 'A', percent: 0 }, { description: 'B' }], 'above 0 and below 100'],
    [[{ description: 'A', percent: 61.495 }, { description: 'B' }], 'at most two decimals'],
    [[{ description: 'A', percent: 60 }, { description: 'B', percent: 40 }], 'exactly one line with no percent'],
    [[{ description: 'A' }, { description: 'B' }], 'exactly one line with no percent'],
    [[{ description: 'A', percent: 60 }, { description: 'B', percent: 45 }, { description: 'C' }], 'leaving nothing for the rest'],
    [[{ description: 'A', percent: 50 }, { description: 'A' }], 'its own description']
  ])('a malformed list is refused, naming it: %o', (config, message) => {
    expect(() => chargeLinesFrom(config)).toThrow(message);
  });
});
