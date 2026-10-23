import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, DESKTOP, signIn, startHarness, uniqueEmail, type Harness } from './harness';

let h: Harness;
let owner: { accessToken: string; user: { id: string } };
beforeAll(async () => {
  h = await startHarness();
  owner = await signIn(h, uniqueEmail('owner'), DESKTOP);
  await h.http().patch('/auth/me').set(auth(owner.accessToken)).send({ timezone: 'America/New_York' }).expect(200);
});
afterAll(async () => {
  await h?.close();
});

const premium = (token: string) => h.http().post('/billing/dev/activate').set(auth(token)).send({ plan: 'PREMIUM' }).expect(200);

describe('task creation', () => {
  it('creates a task in the Inbox with tags, checklist and default priority reminder', async () => {
    const due = DateTime.now().plus({ days: 1 }).set({ hour: 15, minute: 0 }).toUTC().toISO();
    const res = await h
      .http()
      .post('/tasks')
      .set(auth(owner.accessToken))
      .send({ title: 'Write launch post', priority: 'HIGH', dueAt: due, tags: ['Marketing', 'launch'], checklist: ['Outline', 'Draft'], description: '<p>Hi<script>alert(1)</script></p>' })
      .expect(201);
    expect(res.body).toMatchObject({ title: 'Write launch post', priority: 'HIGH', tags: ['launch', 'marketing'], version: 1 });
    expect(res.body.description).toBe('<p>Hi</p>'); // sanitized
    expect(res.body.subtasks.map((s: { title: string }) => s.title)).toEqual(['Outline', 'Draft']);
    expect(res.body.reminders).toHaveLength(1);
    expect(res.body.reminders[0].nextFireAt).toBe(new Date(due!).toISOString());

    const inbox = await h.http().get('/tasks?view=inbox').set(auth(owner.accessToken)).expect(200);
    expect(inbox.body.map((t: { id: string }) => t.id)).toContain(res.body.id);
  });

  it('natural-language quick add', async () => {
    const res = await h.http().post('/tasks/quick-add').set(auth(owner.accessToken)).send({ text: 'Submit report every Friday at 4pm #work !high' }).expect(201);
    const t = res.body.task;
    expect(t).toMatchObject({ title: 'Submit report', priority: 'HIGH', tags: ['work'], recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=FR', mode: 'FROM_DUE' } });
    const local = DateTime.fromISO(t.dueAt).setZone('America/New_York');
    expect(local.weekday).toBe(5);
    expect(local.toFormat('HH:mm')).toBe('16:00');
  });

  it('clientId makes offline replays idempotent', async () => {
    const clientId = crypto.randomUUID();
    const a = await h.http().post('/tasks').set(auth(owner.accessToken)).send({ title: 'Offline task', clientId }).expect(201);
    const b = await h.http().post('/tasks').set(auth(owner.accessToken)).send({ title: 'Offline task', clientId }).expect(201);
    expect(b.body.id).toBe(a.body.id);
  });

  it('completing a recurring task creates the next occurrence with a fresh checklist', async () => {
    const due = DateTime.now().setZone('America/New_York').plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    const created = await h
      .http()
      .post('/tasks')
      .set(auth(owner.accessToken))
      .send({ title: 'Daily standup notes', dueAt: due.toUTC().toISO(), recurrence: { rrule: 'FREQ=DAILY' }, checklist: ['Yesterday', 'Today'] })
      .expect(201);
    await h.http().patch(`/subtasks/${created.body.subtasks[0].id}`).set(auth(owner.accessToken)).send({ done: true }).expect(200);
    await h.http().post(`/tasks/${created.body.id}/complete`).set(auth(owner.accessToken)).expect(200);
    const all = await h.http().get('/tasks?q=Daily%20standup%20notes&includeCompleted=true').set(auth(owner.accessToken)).expect(200);
    const next = all.body.find((t: { completedAt: string | null }) => !t.completedAt);
    expect(DateTime.fromISO(next.dueAt).setZone('America/New_York').toISO()).toBe(due.plus({ days: 1 }).toISO());
    expect(next.subtasks.every((s: { done: boolean }) => !s.done)).toBe(true);
  });

  it('soft-deletes to Trash, restores, and purges only from Trash', async () => {
    const t = await h.http().post('/tasks').set(auth(owner.accessToken)).send({ title: 'Temporary' }).expect(201);
    await h.http().delete(`/tasks/${t.body.id}/permanent`).set(auth(owner.accessToken)).expect(400);
    await h.http().delete(`/tasks/${t.body.id}`).set(auth(owner.accessToken)).expect(200);
    const trash = await h.http().get('/tasks?view=trash').set(auth(owner.accessToken)).expect(200);
    expect(trash.body.map((x: { id: string }) => x.id)).toContain(t.body.id);
    await h.http().post(`/tasks/${t.body.id}/restore`).set(auth(owner.accessToken)).expect(200);
    await h.http().delete(`/tasks/${t.body.id}`).set(auth(owner.accessToken)).expect(200);
    await h.http().delete(`/tasks/${t.body.id}/permanent`).set(auth(owner.accessToken)).expect(200);
    await h.http().get(`/tasks/${t.body.id}`).set(auth(owner.accessToken)).expect(404);
  });

  it('detects concurrent edits per field and merges non-conflicting ones', async () => {
    const t = await h.http().post('/tasks').set(auth(owner.accessToken)).send({ title: 'Shared draft', priority: 'LOW' }).expect(201);
    const base = t.body.version;
    await h.http().patch(`/tasks/${t.body.id}`).set(auth(owner.accessToken)).send({ title: 'Renamed on laptop', baseVersion: base }).expect(200);
    // Phone edited from the same base: priority merges, title conflicts.
    const res = await h.http().patch(`/tasks/${t.body.id}`).set(auth(owner.accessToken)).send({ title: 'Renamed on phone', priority: 'HIGH', baseVersion: base });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('edit_conflict');
    expect(res.body.error.details.fields).toEqual(['title']);
    expect(res.body.error.details.server).toMatchObject({ title: 'Renamed on laptop', priority: 'HIGH' });
    // Keep mine.
    const forced = await h.http().patch(`/tasks/${t.body.id}`).set(auth(owner.accessToken)).send({ title: 'Renamed on phone', force: true }).expect(200);
    expect(forced.body.title).toBe('Renamed on phone');
  });

  it('validates input', async () => {
    const res = await h.http().post('/tasks').set(auth(owner.accessToken)).send({ title: '', priority: 'URGENT' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('workspace permissions', () => {
  it('enforces owner/member/viewer roles and hides other workspaces', async () => {
    const ws = await h.http().post('/workspaces').set(auth(owner.accessToken)).send({ name: 'Studio' }).expect(201);
    const project = await h.http().post('/projects').set(auth(owner.accessToken)).send({ workspaceId: ws.body.id, name: 'Launch' }).expect(201);

    const memberEmail = uniqueEmail('member');
    const viewerEmail = uniqueEmail('viewer');
    const member = await signIn(h, memberEmail);
    const viewer = await signIn(h, viewerEmail);
    const outsider = await signIn(h, uniqueEmail('outsider'));

    for (const [email, role] of [[memberEmail, 'MEMBER'], [viewerEmail, 'VIEWER']] as const) {
      await h.http().post(`/workspaces/${ws.body.id}/invites`).set(auth(owner.accessToken)).send({ email, role }).expect(201);
    }

    const notifs = await h.prisma.notification.findMany({ where: { kind: 'INVITE', userId: { in: [member.user.id, viewer.user.id] } } });
    for (const n of notifs) {
      const who = n.userId === member.user.id ? member : viewer;
      await h.http().post(`/invites/${(n.data as { inviteId: string }).inviteId}/accept`).set(auth(who.accessToken)).expect(200);
    }

    const task = await h.http().post('/tasks').set(auth(member.accessToken)).send({ title: 'Member task', projectId: project.body.id }).expect(201);
    await h.http().patch(`/tasks/${task.body.id}`).set(auth(member.accessToken)).send({ assigneeId: member.user.id }).expect(200);

    // Viewer: read yes, write no.
    await h.http().get(`/tasks?projectId=${project.body.id}`).set(auth(viewer.accessToken)).expect(200);
    const vw = await h.http().post('/tasks').set(auth(viewer.accessToken)).send({ title: 'Nope', projectId: project.body.id });
    expect(vw.status).toBe(403);
    await h.http().patch(`/tasks/${task.body.id}`).set(auth(viewer.accessToken)).send({ title: 'Nope' }).expect(403);
    await h.http().post(`/tasks/${task.body.id}/comments`).set(auth(viewer.accessToken)).send({ body: 'hi' }).expect(403);
    // Viewers can't be assigned.
    await h.http().patch(`/tasks/${task.body.id}`).set(auth(member.accessToken)).send({ assigneeId: viewer.user.id }).expect(400);

    // Member: cannot delete the project or change roles.
    await h.http().delete(`/projects/${project.body.id}`).set(auth(member.accessToken)).expect(403);
    await h.http().patch(`/workspaces/${ws.body.id}/members/${viewer.user.id}`).set(auth(member.accessToken)).send({ role: 'MEMBER' }).expect(403);

    // Outsider sees nothing (404, not 403).
    await h.http().get(`/tasks/${task.body.id}`).set(auth(outsider.accessToken)).expect(404);
    await h.http().get(`/workspaces/${ws.body.id}/members`).set(auth(outsider.accessToken)).expect(404);

    // Denials and role changes are audit-logged.
    await h.http().patch(`/workspaces/${ws.body.id}/members/${viewer.user.id}`).set(auth(owner.accessToken)).send({ role: 'MEMBER' }).expect(200);
    const audit = await h.http().get(`/workspaces/${ws.body.id}/audit`).set(auth(owner.accessToken)).expect(200);
    const actions = audit.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['member.role_changed', 'member.invited', 'member.joined', 'denied:task.create']));
    await h.http().get(`/workspaces/${ws.body.id}/audit`).set(auth(member.accessToken)).expect(403);
  });
});

describe('entitlements (everything free, server-enforced)', () => {
  it('free accounts get every feature and generous limits', async () => {
    const u = await signIn(h, uniqueEmail('free'));
    for (let i = 0; i < 12; i++) await h.http().post('/projects').set(auth(u.accessToken)).send({ name: `List ${i}` }).expect(201);
    const t = await h.http().post('/tasks').set(auth(u.accessToken)).send({ title: 'Block me' }).expect(201);
    await h.http().patch(`/tasks/${t.body.id}`).set(auth(u.accessToken)).send({ durationMinutes: 30 }).expect(200);
    await h.http().post('/templates').set(auth(u.accessToken)).send({ kind: 'TASK', name: 'x', payload: {} }).expect(201);
    const ent = await h.http().get('/me/entitlements').set(auth(u.accessToken)).expect(200);
    expect(ent.body).toMatchObject({ plan: 'FREE', limits: { 'lists.max': 999, 'remindersPerTask.max': 10 } });
    expect(Object.values(ent.body.features).every(Boolean)).toBe(true);
  });

  it('operators can still adjust limits at runtime without an app update', async () => {
    const u = await signIn(h, uniqueEmail('runtime'));
    const { EntitlementsService } = await import('../src/common/entitlements.service');
    const row = await h.prisma.entitlement.create({ data: { userId: u.user.id, key: 'lists.max', limit: 1 } });
    h.app.get(EntitlementsService).invalidate();
    try {
      await h.http().post('/projects').set(auth(u.accessToken)).send({ name: 'One' }).expect(201);
      const second = await h.http().post('/projects').set(auth(u.accessToken)).send({ name: 'Two' });
      expect(second.status).toBe(402);
      expect(second.body.error).toMatchObject({ code: 'plan_limit', details: { key: 'lists.max', limit: 1 } });
    } finally {
      await h.prisma.entitlement.delete({ where: { id: row.id } });
      h.app.get(EntitlementsService).invalidate();
    }
  });
});

describe('calendar scheduling', () => {
  it('time-blocks a task, returns it in range, and projects repeating occurrences', async () => {
    const u = await signIn(h, uniqueEmail('cal'));
    await h.http().patch('/auth/me').set(auth(u.accessToken)).send({ timezone: 'Europe/Berlin' }).expect(200);
    await premium(u.accessToken);
    const day = DateTime.now().setZone('Europe/Berlin').plus({ days: 2 }).startOf('day');

    const t = await h.http().post('/tasks').set(auth(u.accessToken)).send({ title: 'Deep work' }).expect(201);
    // Drag onto the calendar: 10:00–11:30 Berlin time.
    const start = day.set({ hour: 10 });
    const moved = await h
      .http()
      .patch(`/tasks/${t.body.id}`)
      .set(auth(u.accessToken))
      .send({ startAt: start.toUTC().toISO(), dueAt: start.plus({ minutes: 90 }).toUTC().toISO(), durationMinutes: 90 })
      .expect(200);
    expect(moved.body.durationMinutes).toBe(90);

    const weekly = await h
      .http()
      .post('/tasks')
      .set(auth(u.accessToken))
      .send({ title: 'Weekly review', dueAt: day.set({ hour: 17 }).toUTC().toISO(), recurrence: { rrule: 'FREQ=WEEKLY' } })
      .expect(201);

    const from = day.startOf('day').toUTC().toISO()!;
    const to = day.plus({ days: 21 }).endOf('day').toUTC().toISO()!;
    const cal = await h.http().get('/calendar').query({ from, to, view: 'week' }).set(auth(u.accessToken)).expect(200);
    const block = cal.body.tasks.find((x: { id: string }) => x.id === t.body.id);
    expect(DateTime.fromISO(block.startAt).setZone('Europe/Berlin').toFormat('HH:mm')).toBe('10:00');
    const ghosts = cal.body.occurrences.filter((o: { taskId: string }) => o.taskId === weekly.body.id);
    expect(ghosts.length).toBe(3);
    for (const g of ghosts) expect(DateTime.fromISO(g.at).setZone('Europe/Berlin').toFormat('ccc HH:mm')).toBe(day.toFormat('ccc') + ' 17:00');
  });

  it('free users get every calendar view', async () => {
    const u = await signIn(h, uniqueEmail('cal-free'));
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
    for (const view of ['month', 'year']) await h.http().get('/calendar').query({ from, to, view }).set(auth(u.accessToken)).expect(200);
  });
});

describe('invite links', () => {
  it('accepts via the emailed token link, single use, email-bound', async () => {
    const owner2 = await signIn(h, uniqueEmail('inv-owner'));
    const ws = await h.http().post('/workspaces').set(auth(owner2.accessToken)).send({ name: 'Linkers' }).expect(201);
    const email = uniqueEmail('inv-guest');
    const guest = await signIn(h, email);
    await h.http().post(`/workspaces/${ws.body.id}/invites`).set(auth(owner2.accessToken)).send({ email, role: 'MEMBER' }).expect(201);
    const token = h.outbox.filter((m) => m.to === email).pop()!.text.match(/invite\?t=([\w-]+)/)![1]!;
    const stranger = await signIn(h, uniqueEmail('inv-stranger'));
    await h.http().post('/invites/accept').set(auth(stranger.accessToken)).send({ token }).expect(403);
    await h.http().post('/invites/accept').set(auth(guest.accessToken)).send({ token }).expect(200);
    await h.http().post('/invites/accept').set(auth(guest.accessToken)).send({ token }).expect(410);
    const notif = await h.prisma.notification.findFirstOrThrow({ where: { userId: guest.user.id, kind: 'INVITE' } });
    expect(JSON.stringify(notif.data)).not.toContain(token);
  });
});
