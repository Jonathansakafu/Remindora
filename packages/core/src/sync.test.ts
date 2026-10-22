import { describe, expect, it } from 'vitest';
import { coalesceOutbox, mergePatch } from './sync';

describe('field-level merge', () => {
  const current = { version: 5, fieldVersions: { title: 5, priority: 2 }, values: { title: 'Server title', priority: 'LOW' } };

  it('applies edits to fields untouched since the base version', () => {
    const r = mergePatch({ priority: 'HIGH' }, current, 3);
    expect(r.conflicts).toEqual([]);
    expect(r.apply).toEqual({ priority: 'HIGH' });
    expect(r.nextFieldVersions.priority).toBe(6);
  });

  it('flags fields changed concurrently', () => {
    const r = mergePatch({ title: 'Offline title', priority: 'HIGH' }, current, 3);
    expect(r.conflicts).toEqual(['title']);
    expect(r.apply).toEqual({ priority: 'HIGH' });
  });

  it('force overrides, identical values never conflict', () => {
    expect(mergePatch({ title: 'Offline' }, current, 3, true).apply).toEqual({ title: 'Offline' });
    expect(mergePatch({ title: 'Server title' }, current, 3).conflicts).toEqual([]);
  });

  it('coalesces consecutive patches keeping the oldest base', () => {
    const out = coalesceOutbox([
      { id: '1', createdAt: '', method: 'PATCH', path: '/tasks/a', entityKey: 'task:a', body: { title: 'x', baseVersion: 2 }, attempts: 0 },
      { id: '2', createdAt: '', method: 'PATCH', path: '/tasks/a', entityKey: 'task:a', body: { priority: 'HIGH', baseVersion: 3 }, attempts: 0 },
      { id: '3', createdAt: '', method: 'PATCH', path: '/tasks/b', entityKey: 'task:b', body: { title: 'y' }, attempts: 0 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.body).toEqual({ title: 'x', priority: 'HIGH', baseVersion: 2 });
  });
});
