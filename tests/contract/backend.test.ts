/**
 * Adapter contract suite: the same tests run against every Backend
 * (build plan M6: "adapter contract tests run the same suite against the memory adapter and
 * the artifact database adapter").
 */
import { describe, expect, it } from 'vitest';
import { ArtifactDbBackend } from '../../src/data/adapters/artifactDb';
import { MemoryBackend } from '../../src/data/adapters/memory';
import type { Backend } from '../../src/data/backend';
import { FakeDb } from '../fixtures/fakeDb';

const makers: Array<[string, () => Backend]> = [
  ['memory', () => new MemoryBackend()],
  ['artifact db', () => new ArtifactDbBackend(new FakeDb(), 'user1')],
];

describe.each(makers)('Backend contract: %s', (_name, make) => {
  it('starts empty', async () => {
    const b = make();
    expect(await b.readAll()).toEqual({ single: {}, logs: [] });
  });

  it('round-trips an entry, creating the month document on first write', async () => {
    const b = make();
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'Q', { v: 30, at: 5, dev: 'devA' });
    expect(await b.getEntry('2026-10', 'devA', '2026-10-12', 'Q')).toEqual({ v: 30, at: 5, dev: 'devA' });
    await b.putEntry('2026-10', 'devA', '2026-10-13', 'R', { skip: 'sick', at: 6, dev: 'devA' });
    const all = await b.readAll();
    expect(all.logs).toHaveLength(1);
    expect(all.logs[0]).toMatchObject({ month: '2026-10', dev: 'devA' });
  });

  it('an undo replaces the value instead of merging into it', async () => {
    const b = make();
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'R', { v: 1, at: 5, dev: 'devA' });
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'R', { at: 6, dev: 'devA' });
    expect(await b.getEntry('2026-10', 'devA', '2026-10-12', 'R')).toEqual({ at: 6, dev: 'devA' });
  });

  it('keeps other habits and days when one entry changes', async () => {
    const b = make();
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'Q', { v: 30, at: 5, dev: 'devA' });
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'R', { v: 1, at: 6, dev: 'devA' });
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'Q', { v: 50, at: 7, dev: 'devA' });
    expect(await b.getEntry('2026-10', 'devA', '2026-10-12', 'R')).toEqual({ v: 1, at: 6, dev: 'devA' });
    expect(await b.getEntry('2026-10', 'devA', '2026-10-12', 'Q')).toEqual({ v: 50, at: 7, dev: 'devA' });
  });

  it('keeps each device in its own month document', async () => {
    const b = make();
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'R', { v: 1, at: 5, dev: 'devA' });
    await b.putEntry('2026-10', 'devB', '2026-10-12', 'R', { at: 6, dev: 'devB' });
    const all = await b.readAll();
    expect(all.logs.map((l) => l.dev).sort()).toEqual(['devA', 'devB']);
    expect(await b.getEntry('2026-10', 'devA', '2026-10-12', 'R')).toEqual({ v: 1, at: 5, dev: 'devA' });
  });

  it('replaces whole single documents', async () => {
    const b = make();
    await b.putDoc('seen', { schema: 1, presentedStoryDay: 2, episodes: [1, 2], moments: [], records: [] });
    await b.putDoc('seen', { schema: 1, presentedStoryDay: 3, episodes: [3], moments: [], records: [] });
    expect((await b.readAll()).single.seen).toEqual({ schema: 1, presentedStoryDay: 3, episodes: [3], moments: [], records: [] });
  });

  it('notifies subscribers of changes', async () => {
    const b = make();
    let n = 0;
    const off = b.subscribe(() => n++);
    await new Promise((r) => setTimeout(r, 0));
    await b.putEntry('2026-10', 'devA', '2026-10-12', 'R', { v: 1, at: 5, dev: 'devA' });
    await new Promise((r) => setTimeout(r, 0));
    expect(n).toBeGreaterThanOrEqual(1);
    off();
  });
});
