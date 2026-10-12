/**
 * The remote side of the store: where documents live on the person's account.
 *
 * Logs are stored one document per month per device, and each device writes only its own
 * documents. That removes every create race and arrival-order overwrite: replicas fold all
 * devices' documents with the core merge rule (later write time wins), so every device
 * converges on the same record whatever order writes arrive in.
 */
import type { DateKey, Entry, HabitId } from '../core/model/types';

export type DocKindSingle = 'profile' | 'habits' | 'seen' | 'corrections';

export interface DeviceLog {
  /** 'YYYY-MM'. */
  month: string;
  dev: string;
  /** Raw body, validated by the caller. */
  body: unknown;
}

export interface RemoteDocs {
  single: Partial<Record<DocKindSingle, unknown>>;
  logs: DeviceLog[];
}

export interface Backend {
  /** Every document in this person's space. */
  readAll(): Promise<RemoteDocs>;
  /** Merge one habit-day entry into this device's month document. */
  putEntry(month: string, dev: string, date: DateKey, habit: HabitId, e: Entry): Promise<void>;
  /** Read one entry back from this device's month document (write confirmation). */
  getEntry(month: string, dev: string, date: DateKey, habit: HabitId): Promise<Entry | undefined>;
  /** Replace a whole single document. */
  putDoc(kind: DocKindSingle, body: object): Promise<void>;
  /** Called whenever anything changes remotely (or locally, echoed). */
  subscribe(onChange: () => void): () => void;
}

/** A backend error that retrying cannot fix (bad body, quota). */
export class PermanentBackendError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PermanentBackendError';
  }
}
