/** An empty snapshot: what a brand-new person has before anything is stored. */
import { CURRENT_SCHEMA } from './schemas';
import type { Snapshot } from './types';

export function emptySnapshot(): Snapshot {
  return {
    profile: null,
    habits: { schema: CURRENT_SCHEMA.habits, habits: [] },
    logs: {},
    seen: { schema: CURRENT_SCHEMA.seen, presentedStoryDay: 0, episodes: [], moments: [], records: [] },
    corrections: { schema: CURRENT_SCHEMA.corrections, log: [] },
  };
}
