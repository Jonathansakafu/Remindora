import { decodeKey } from '@remindora/auth';
import { loadServerEnv } from '@remindora/config';
import { QUEUES, type DismissPushJob } from '@remindora/notifications';
import { Emitter } from '@socket.io/redis-emitter';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../workers/src/deps';
import { processDismiss } from '../../workers/src/processors';
import { fireReminder, sweepDueReminders, type Scheduler } from '../../workers/src/reminders/fire';
import { auth, connectSocket, DESKTOP, nextEvent, PHONE, signIn, startHarness, uniqueEmail, type Harness } from './harness';

let h: Harness;
let redis: Redis;
let deps: Deps;
const pushes: Array<{ token: string; msg: unknown }> = [];
const scheduled: Array<{ reminderId: string; fireAt: Date; attempt: number }> = [];
const scheduler: Scheduler = { schedule: async (reminderId, fireAt, attempt) => void scheduled.push({ reminderId, fireAt, attempt }) };

beforeAll(async () => {
  h = await startHarness();
  const env = loadServerEnv({ ...process.env });
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  deps = {
    env,
    prisma: h.prisma,
    redis,
    emitter: new Emitter(redis),
    email: { send: async () => ({ id: null }) },
    push: {
      fcm: null,
      webPush: null,
      expo: async (token, msg) => {
        pushes.push({ token, msg });
        return `expo-${pushes.length}`;
      },
    },
    keys: { encryption: decodeKey(env.ENCRYPTION_KEY) },
    log: pino({ level: 'silent' }),
  };
});
afterAll(async () => {
  redis?.disconnect();
  await h?.close();
});

async function twoDevices() {
  const email = uniqueEmail('multi');
  const desktop = await signIn(h, email, DESKTOP);
  await h.http().patch('/auth/me').set(auth(desktop.accessToken)).send({ requireDeviceApproval: false, timezone: 'UTC' }).expect(200);
  const phone = await signIn(h, email, PHONE);
  await h.http().post('/devices/current/push').set(auth(phone.accessToken)).send({ provider: 'expo', token: `ExponentPushToken[${phone.deviceId}]` }).expect(200);
  return { desktop, phone, desktopSocket: await connectSocket(h, desktop.accessToken), phoneSocket: await connectSocket(h, phone.accessToken) };
}

async function dueTask(token: string, priority: string) {
  const res = await h.http().post('/tasks').set(auth(token)).send({ title: `${priority} alert`, priority, dueAt: new Date().toISOString() }).expect(201);
  return { taskId: res.body.id as string, reminderId: res.body.reminders[0].id as string };
}

async function drainDismissJobs() {
  const queue = new Queue<DismissPushJob>(QUEUES.push, { connection: redis });
  const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
  for (const j of jobs.filter((x) => x.name === 'dismiss')) {
    await processDismiss(deps, j.data);
    await j.remove();
  }
  await queue.close();
}

describe('priority notification engine', () => {
  it('critical alert reaches every device; acknowledging on one dismisses it everywhere and stops re-alerts', async () => {
    const { desktop, phone, desktopSocket, phoneSocket } = await twoDevices();
    const { reminderId } = await dueTask(desktop.accessToken, 'CRITICAL');

    const onPhone = nextEvent<{ notification: { id: string; priority: string }; alert: { desktop: boolean } }>(phoneSocket, 'notification.created');
    const onDesktop = nextEvent<{ alert: { desktop: boolean } }>(desktopSocket, 'notification.created');
    const outcome = await fireReminder(deps, { reminderId, fireAt: new Date().toISOString() }, scheduler);
    expect(outcome.status).toBe('fired');
    if (outcome.status !== 'fired') return;
    expect(outcome.channels).toEqual(['IN_APP', 'PUSH', 'DESKTOP', 'WEB_PUSH']);

    const created = await onPhone;
    expect(created.notification.priority).toBe('CRITICAL');
    expect((await onDesktop).alert.desktop).toBe(true);
    expect(pushes.some((p) => p.token.includes(phone.deviceId))).toBe(true);

    // Default critical re-alert: 30 minutes.
    const next = scheduled.find((s) => s.reminderId === reminderId)!;
    expect(Math.round((next.fireAt.getTime() - Date.now()) / 60_000)).toBe(30);
    expect(next.attempt).toBe(1);

    // Acknowledge on the desktop → the phone hears about it instantly and its tray copy is cleared.
    const resolved = nextEvent<{ notificationId: string; resolution: string }>(phoneSocket, 'notification.resolved');
    await h.http().post(`/notifications/${outcome.notificationId}/action`).set(auth(desktop.accessToken)).send({ action: 'acknowledge' }).expect(200);
    expect(await resolved).toMatchObject({ notificationId: outcome.notificationId, resolution: 'acknowledge' });

    const before = pushes.length;
    await drainDismissJobs();
    const dismiss = pushes.slice(before);
    expect(dismiss).toHaveLength(1);
    expect(dismiss[0]).toMatchObject({ token: expect.stringContaining(phone.deviceId), msg: { dataOnly: { type: 'dismiss', notificationId: outcome.notificationId } } });

    const reminder = await h.prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    expect(reminder).toMatchObject({ state: 'ACKNOWLEDGED', nextFireAt: null });
    // The already-queued re-alert job is now a no-op.
    expect((await fireReminder(deps, { reminderId, fireAt: next.fireAt.toISOString() }, scheduler, next.fireAt)).status).toBe('skipped');

    const events = await h.http().get('/notifications/events').set(auth(desktop.accessToken)).expect(200);
    const types = new Set(events.body.map((e: { type: string }) => e.type));
    for (const t of ['SCHEDULED', 'DELIVERED', 'ACKNOWLEDGED']) expect(types.has(t)).toBe(true);
    desktopSocket.disconnect();
    phoneSocket.disconnect();
  });

  it('concurrent workers deliver an occurrence once', async () => {
    const { desktop, desktopSocket, phoneSocket } = await twoDevices();
    const { reminderId } = await dueTask(desktop.accessToken, 'HIGH');
    const results = await Promise.all([1, 2, 3].map(() => fireReminder(deps, { reminderId, fireAt: new Date().toISOString() }, scheduler)));
    expect(results.filter((r) => r.status === 'fired')).toHaveLength(1);
    expect(await h.prisma.notification.count({ where: { reminderId } })).toBe(1);
    desktopSocket.disconnect();
    phoneSocket.disconnect();
  });

  it('snooze defers, Mark Complete resolves, and the sweeper recovers lost jobs', async () => {
    const { phone, desktopSocket, phoneSocket } = await twoDevices();
    const { taskId, reminderId } = await dueTask(phone.accessToken, 'HIGH');
    const first = await fireReminder(deps, { reminderId, fireAt: new Date().toISOString() }, scheduler);
    if (first.status !== 'fired') throw new Error('expected fire');

    await h.http().post(`/notifications/${first.notificationId}/action`).set(auth(phone.accessToken)).send({ action: 'snooze', snoozeMinutes: 10 }).expect(200);
    let r = await h.prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    expect(r.state).toBe('SNOOZED');
    expect(Math.round((r.nextFireAt!.getTime() - Date.now()) / 60_000)).toBe(10);

    // Simulate Redis losing the delayed job: the sweeper re-queues from the DB once it's due.
    const later = new Date(r.nextFireAt!.getTime() + 1000);
    scheduled.length = 0;
    expect(await sweepDueReminders(deps, scheduler, later)).toBeGreaterThanOrEqual(1);
    expect(scheduled.some((s) => s.reminderId === reminderId)).toBe(true);

    const second = await fireReminder(deps, { reminderId, fireAt: later.toISOString() }, scheduler, later);
    expect(second.status).toBe('fired');
    if (second.status !== 'fired') return;

    await h.http().post(`/notifications/${second.notificationId}/action`).set(auth(phone.accessToken)).send({ action: 'complete' }).expect(200);
    const task = await h.http().get(`/tasks/${taskId}`).set(auth(phone.accessToken)).expect(200);
    expect(task.body.completedAt).not.toBeNull();
    r = await h.prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    expect(r.state).toBe('DONE');
    const log = await h.prisma.notificationEvent.findMany({ where: { reminderId }, select: { type: true } });
    expect(log.map((e) => e.type)).toEqual(expect.arrayContaining(['SNOOZED', 'COMPLETED']));
    desktopSocket.disconnect();
    phoneSocket.disconnect();
  });

  it('honours user intervals, maximum re-alert count, and low-priority silence', async () => {
    const { desktop, desktopSocket, phoneSocket } = await twoDevices();
    await h.http().patch('/notifications/preferences').set(auth(desktop.accessToken)).send({ highRepeatMinutes: 45, maxRealerts: 1 }).expect(200);
    const { reminderId } = await dueTask(desktop.accessToken, 'HIGH');
    scheduled.length = 0;
    const a = await fireReminder(deps, { reminderId, fireAt: new Date().toISOString() }, scheduler);
    expect(a.status === 'fired' && a.nextFireAt && Math.round((a.nextFireAt.getTime() - Date.now()) / 60_000)).toBe(45);
    const at = (a as { nextFireAt: Date }).nextFireAt;
    const b = await fireReminder(deps, { reminderId, fireAt: at.toISOString() }, scheduler, at);
    expect(b).toMatchObject({ status: 'fired', nextFireAt: null }); // 1 re-alert max

    const low = await h.http().post('/tasks').set(auth(desktop.accessToken)).send({ title: 'Low thing', priority: 'LOW', dueAt: new Date().toISOString(), reminders: [{ offsetMinutes: 0 }] }).expect(201);
    const c = await fireReminder(deps, { reminderId: low.body.reminders[0].id, fireAt: new Date().toISOString() }, scheduler);
    expect(c).toMatchObject({ status: 'fired', channels: ['IN_APP'], nextFireAt: null });
    desktopSocket.disconnect();
    phoneSocket.disconnect();
  });
});

describe('cross-device sync', () => {
  it('pushes edits to other devices in real time and serves an incremental change feed with tombstones', async () => {
    const { desktop, phone, desktopSocket, phoneSocket } = await twoDevices();

    const upserted = nextEvent<{ task: { title: string }; originSessionId: string }>(phoneSocket, 'task.upserted');
    const created = await h.http().post('/tasks').set(auth(desktop.accessToken)).send({ title: 'Made on laptop' }).expect(201);
    const evt = await upserted;
    expect(evt.task.title).toBe('Made on laptop');
    expect(evt.originSessionId).toBe(desktop.sessionId); // lets the origin ignore its own echo

    const initial = await h.http().get('/sync/changes').query({ cursor: '0' }).set(auth(phone.accessToken)).expect(200);
    expect(initial.body.tasks.map((t: { id: string }) => t.id)).toContain(created.body.id);
    expect(initial.body.projects.some((p: { isInbox: boolean }) => p.isInbox)).toBe(true);
    const cursor = initial.body.cursor;

    const updated = nextEvent<{ task: { title: string } }>(phoneSocket, 'task.upserted');
    await h.http().patch(`/tasks/${created.body.id}`).set(auth(desktop.accessToken)).send({ title: 'Edited on laptop' }).expect(200);
    expect((await updated).task.title).toBe('Edited on laptop');
    const deleted = nextEvent<{ taskId: string; hard: boolean }>(phoneSocket, 'task.deleted');
    await h.http().delete(`/tasks/${created.body.id}`).set(auth(desktop.accessToken)).expect(200);
    expect(await deleted).toMatchObject({ taskId: created.body.id, hard: false });

    const delta = await h.http().get('/sync/changes').query({ cursor }).set(auth(phone.accessToken)).expect(200);
    expect(BigInt(delta.body.cursor)).toBeGreaterThan(BigInt(cursor));
    expect(delta.body.hasMore).toBe(false);
    const tomb = delta.body.tasks.find((t: { id: string }) => t.id === created.body.id);
    expect(tomb.title).toBe('Edited on laptop');
    expect(tomb.deletedAt).not.toBeNull();
    const empty = await h.http().get('/sync/changes').query({ cursor: delta.body.cursor }).set(auth(phone.accessToken)).expect(200);
    expect(empty.body.tasks).toEqual([]);
    desktopSocket.disconnect();
    phoneSocket.disconnect();
  });

  it('workspace members receive teammates’ changes; outsiders do not', async () => {
    const a = await signIn(h, uniqueEmail('teamA'));
    const bEmail = uniqueEmail('teamB');
    const b = await signIn(h, bEmail);
    const outsider = await signIn(h, uniqueEmail('teamC'));
    const ws = await h.http().post('/workspaces').set(auth(a.accessToken)).send({ name: 'Crew' }).expect(201);
    const project = await h.http().post('/projects').set(auth(a.accessToken)).send({ workspaceId: ws.body.id, name: 'Shared' }).expect(201);
    await h.http().post(`/workspaces/${ws.body.id}/invites`).set(auth(a.accessToken)).send({ email: bEmail, role: 'MEMBER' }).expect(201);
    const invite = await h.prisma.notification.findFirstOrThrow({ where: { userId: b.user.id, kind: 'INVITE' } });
    const bSocket = await connectSocket(h, b.accessToken);
    const outSocket = await connectSocket(h, outsider.accessToken);
    await h.http().post(`/invites/${(invite.data as { inviteId: string }).inviteId}/accept`).set(auth(b.accessToken)).expect(200);

    let leaked = false;
    outSocket.on('task.upserted', () => (leaked = true));
    const got = nextEvent<{ task: { title: string } }>(bSocket, 'task.upserted');
    await h.http().post('/tasks').set(auth(a.accessToken)).send({ title: 'Team task', projectId: project.body.id }).expect(201);
    expect((await got).task.title).toBe('Team task');
    await new Promise((r) => setTimeout(r, 300));
    expect(leaked).toBe(false);
    bSocket.disconnect();
    outSocket.disconnect();
  });
});
