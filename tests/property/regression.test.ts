/**
 * Regression: a fixed seed of 1,000 random histories is derived on every build. Any change in
 * output changes this hash; update the snapshot only with an explanation in the release notes
 * (build plan: Regression requirements).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import { historyArb } from '../fixtures/histories';

describe('regression', () => {
  it('1,000 seeded histories derive to the recorded hash', () => {
    const histories = fc.sample(historyArb, { seed: 20261012, numRuns: 1000 });
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (const h of histories) {
      const text = JSON.stringify(derive(h.snapshot, { date: h.today, ended: h.ended }));
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
      }
    }
    expect(`${a.toString(16)}-${b.toString(16)}-${histories.length}`).toMatchSnapshot();
  });
});
