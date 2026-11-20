/** Your mark and expedition name: schema, migration from nothing, and the backup round trip. */
import { describe, expect, it } from 'vitest';
import { load } from '../../src/core/model/migrations';
import { exportJson, parseBackup } from '../../src/data/backup/backup';
import { Q, R, withHabits } from '../fixtures/build';

const D = '2026-10-05';

describe('expedition', () => {
  it('a doc from before versioning migrates to the current schema', () => {
    const r = load('expedition', { symbol: 'pine' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ schema: 1, symbol: 'pine' });
  });

  it('rejects an unknown symbol, an unknown colour and a name over the limit', () => {
    expect(load('expedition', { schema: 1, symbol: 'skull' }).ok).toBe(false);
    expect(load('expedition', { schema: 1, accent: 'neon' }).ok).toBe(false);
    expect(load('expedition', { schema: 1, name: 'x'.repeat(41) }).ok).toBe(false);
    expect(load('expedition', { schema: 1, name: 'The long winter', symbol: 'star', accent: 'glacier', introOn: D }).ok).toBe(true);
  });

  it('travels with the backup', () => {
    const s = withHabits(Q(D), R(D));
    s.expedition = { schema: 1, name: 'The long winter', symbol: 'flame', accent: 'ember', introOn: D };
    const parsed = parseBackup(exportJson(s, '0.1.0', 1_800_000_000_000));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.snapshot.expedition).toEqual(s.expedition);
  });

  it('a backup made before marks existed still imports, with no mark', () => {
    const s = withHabits(Q(D), R(D));
    const file = JSON.parse(exportJson(s, '0.1.0', 1_800_000_000_000)) as { docs: Record<string, unknown> };
    delete file.docs.expedition;
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.snapshot.expedition).toEqual({ schema: 1 });
  });
});
