/**
 * Field-level optimistic concurrency for offline-first editing.
 *
 * Every task carries `version` (bumped on each write) and `fieldVersions`
 * ({ field: versionAtWhichItLastChanged }). A client edit made against
 * `baseVersion` only conflicts on fields someone else changed after that base;
 * edits to different fields of the same task merge cleanly.
 */

export type FieldVersions = Record<string, number>;

export interface MergeResult<T extends Record<string, unknown>> {
  /** Fields safe to apply. */
  apply: Partial<T>;
  /** Fields changed concurrently on the server since `baseVersion`. */
  conflicts: string[];
  nextVersion: number;
  nextFieldVersions: FieldVersions;
}

export function mergePatch<T extends Record<string, unknown>>(
  patch: Partial<T>,
  current: { version: number; fieldVersions: FieldVersions; values: Partial<T> },
  baseVersion: number | undefined,
  force = false,
): MergeResult<T> {
  const conflicts: string[] = [];
  const apply: Partial<T> = {};
  const nextVersion = current.version + 1;
  const nextFieldVersions: FieldVersions = { ...current.fieldVersions };

  for (const key of Object.keys(patch) as Array<keyof T & string>) {
    const changedAt = current.fieldVersions[key] ?? 0;
    const concurrent = baseVersion !== undefined && changedAt > baseVersion;
    const sameValue = JSON.stringify(current.values[key]) === JSON.stringify(patch[key]);
    if (concurrent && !force && !sameValue) {
      conflicts.push(key);
      continue;
    }
    if (sameValue) continue;
    apply[key] = patch[key];
    nextFieldVersions[key] = nextVersion;
  }
  return { apply, conflicts, nextVersion, nextFieldVersions };
}

/** Outbox entry persisted by offline clients and replayed in order once online. */
export interface OutboxEntry {
  id: string;
  createdAt: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Entity the mutation targets, used to coalesce repeated edits. */
  entityKey?: string;
  attempts: number;
}

/** Collapses consecutive PATCHes to the same entity so replays stay small. */
export function coalesceOutbox(entries: OutboxEntry[]): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (prev && e.method === 'PATCH' && prev.method === 'PATCH' && e.entityKey && prev.entityKey === e.entityKey) {
      const prevBody = (prev.body ?? {}) as Record<string, unknown>;
      const nextBody = (e.body ?? {}) as Record<string, unknown>;
      // Keep the oldest baseVersion so conflict detection still sees the original base.
      out[out.length - 1] = { ...prev, body: { ...prevBody, ...nextBody, baseVersion: prevBody.baseVersion ?? nextBody.baseVersion } };
      continue;
    }
    out.push(e);
  }
  return out;
}
