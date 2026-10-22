/**
 * Realistic demo data. Dates are relative to "now" in each user's timezone so the
 * Today / Upcoming / Overdue views are always populated.
 *
 *   npm run db:seed
 *
 * Demo sign-in: avery@remindora.dev (Premium, owner of "Northwind Studio").
 * In development the API logs the 6-digit email code to the console.
 */
import { randomBytes, createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { PrismaClient, Prisma, type Priority, type Role } from '@prisma/client';
import { PLAN_DEFAULTS } from '@remindora/entitlements';
import { initialFireAt, resolvePrefs } from '@remindora/notifications';

const prisma = new PrismaClient();
const TZ = 'America/New_York';
const now = DateTime.now().setZone(TZ);

function at(dayOffset: number, hhmm?: string): Date {
  const d = now.plus({ days: dayOffset }).startOf('day');
  if (!hhmm) return d.toJSDate();
  const [h, m] = hhmm.split(':').map(Number);
  return d.set({ hour: h!, minute: m! }).toJSDate();
}

// Deterministic pseudo-random so seeds are stable between runs.
let state = 42;
function rand() {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
}

async function wipe() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  }
}

async function seedCatalog() {
  for (const [plan, def] of Object.entries(PLAN_DEFAULTS)) {
    for (const [key, limit] of Object.entries(def.limits)) {
      await prisma.entitlement.create({ data: { plan: plan as 'FREE', key, limit } });
    }
    for (const [key, enabled] of Object.entries(def.features)) {
      await prisma.entitlement.create({ data: { plan: plan as 'FREE', key, enabled } });
    }
  }
  await prisma.featureFlag.createMany({
    data: [
      { key: 'ai', description: 'AI planning assistant (kill switch)', enabled: true, rolloutPercent: 100, plans: ['PREMIUM', 'TEAM'] },
      { key: 'integrations', description: 'Third-party integrations', enabled: true, rolloutPercent: 100, plans: [] },
      { key: 'view.timeline', description: 'Timeline / Gantt view', enabled: true, rolloutPercent: 100, plans: [] },
      { key: 'reports', description: 'Productivity reports', enabled: true, rolloutPercent: 100, plans: [] },
    ],
  });
}

async function user(email: string, name: string, timezone = TZ) {
  return prisma.user.create({
    data: {
      email,
      name,
      timezone,
      emailVerifiedAt: new Date(),
      requireDeviceApproval: false,
      notificationPref: {
        create: { quietHoursEnabled: true, quietStart: '22:30', quietEnd: '07:00', morningDigestTime: '08:00', eveningPlanningEnabled: true },
      },
    },
  });
}

async function workspace(ownerId: string, name: string, slug: string, isPersonal: boolean, members: Array<{ userId: string; role: Role }> = []) {
  return prisma.workspace.create({
    data: {
      name,
      slug,
      isPersonal,
      ownerId,
      memberships: { create: [{ userId: ownerId, role: 'OWNER' }, ...members] },
    },
  });
}

async function project(workspaceId: string, createdById: string, name: string, opts: Partial<Prisma.ProjectUncheckedCreateInput> = {}) {
  return prisma.project.create({ data: { workspaceId, createdById, name, ...opts } });
}

interface TaskSeed {
  title: string;
  priority?: Priority;
  due?: Date | null;
  allDay?: boolean;
  start?: Date | null;
  duration?: number;
  tags?: string[];
  checklist?: Array<[string, boolean]>;
  done?: boolean;
  completedAt?: Date;
  section?: string;
  assignee?: string;
  description?: string;
  rrule?: string;
  reminders?: number[];
  favorite?: boolean;
  status?: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
  deleted?: boolean;
  archived?: boolean;
}

const tagCache = new Map<string, string>();
async function tagId(workspaceId: string, name: string) {
  const key = `${workspaceId}:${name}`;
  if (!tagCache.has(key)) {
    const colors = ['#60E9FF', '#A58CFF', '#FFBC5C', '#7CF3B0', '#FF7A9C'];
    const tag = await prisma.tag.create({ data: { workspaceId, name, color: colors[tagCache.size % colors.length]! } });
    tagCache.set(key, tag.id);
  }
  return tagCache.get(key)!;
}

async function tasks(
  p: { id: string; workspaceId: string },
  creatorId: string,
  items: TaskSeed[],
  sections: Record<string, string> = {},
) {
  const created = [];
  let order = 0;
  for (const t of items) {
    const done = t.done || t.status === 'DONE';
    const recurrence = t.rrule && t.due ? await prisma.recurrenceRule.create({ data: { rrule: t.rrule, dtstart: t.due, timezone: TZ } }) : null;
    const tagIds = await Promise.all((t.tags ?? []).map((n) => tagId(p.workspaceId, n)));
    const task = await prisma.task.create({
      data: {
        workspaceId: p.workspaceId,
        projectId: p.id,
        sectionId: t.section ? sections[t.section] : null,
        title: t.title,
        description: t.description ?? null,
        priority: t.priority ?? 'NONE',
        status: done ? 'DONE' : (t.status ?? 'TODO'),
        creatorId,
        assigneeId: t.assignee ?? null,
        dueAt: t.due ?? null,
        allDay: t.allDay ?? false,
        startAt: t.start ?? null,
        durationMinutes: t.duration ?? null,
        completedAt: done ? (t.completedAt ?? at(-Math.floor(rand() * 6), '15:00')) : null,
        completedById: done ? (t.assignee ?? creatorId) : null,
        sortOrder: order++,
        recurrenceId: recurrence?.id,
        deletedAt: t.deleted ? at(-1) : null,
        archived: t.archived ?? false,
        tags: { create: tagIds.map((id) => ({ tagId: id })) },
        subtasks: { create: (t.checklist ?? []).map(([title, d], i) => ({ title, done: d, sortOrder: i, completedAt: d ? at(-1) : null })) },
        favorites: t.favorite ? { create: { userId: creatorId } } : undefined,
      },
    });
    if (recurrence) await prisma.task.update({ where: { id: task.id }, data: { seriesId: task.id } });
    for (const offset of t.reminders ?? []) {
      const prefs = resolvePrefs({ timezone: TZ });
      const fire = done ? null : initialFireAt({ at: null, offsetMinutes: offset }, { dueAt: task.dueAt, allDay: task.allDay }, prefs, task.priority);
      await prisma.reminder.create({
        data: {
          taskId: task.id,
          userId: t.assignee ?? creatorId,
          offsetMinutes: offset,
          nextFireAt: fire && fire > new Date() ? fire : null,
          occurrenceAt: fire,
          state: done ? 'DONE' : 'ACTIVE',
        },
      });
    }
    await prisma.activityEvent.create({
      data: { workspaceId: p.workspaceId, actorId: creatorId, verb: 'created', entityType: 'task', entityId: task.id, projectId: p.id, data: { title: t.title }, createdAt: at(-8) },
    });
    if (done) {
      await prisma.activityEvent.create({
        data: { workspaceId: p.workspaceId, actorId: t.assignee ?? creatorId, verb: 'completed', entityType: 'task', entityId: task.id, projectId: p.id, data: {}, createdAt: task.completedAt! },
      });
    }
    created.push(task);
  }
  return created;
}

function fakeSession(userId: string, deviceId: string, daysAgo: number) {
  return prisma.session.create({
    data: {
      userId,
      deviceId,
      refreshTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      expiresAt: at(60),
      lastActiveAt: now.minus({ days: daysAgo, hours: 2 }).toJSDate(),
      createdAt: at(-40),
    },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    throw new Error('Refusing to wipe and seed a production database. Set ALLOW_SEED=true to override.');
  }
  await wipe();
  await seedCatalog();

  const avery = await user('avery@remindora.dev', 'Avery Chen');
  const priya = await user('priya@remindora.dev', 'Priya Raman', 'Europe/London');
  const jordan = await user('jordan@remindora.dev', 'Jordan Okafor', 'America/Chicago');
  const sam = await user('sam@remindora.dev', 'Sam Lindqvist', 'Europe/Stockholm');

  await prisma.subscription.create({
    data: { userId: avery.id, plan: 'PREMIUM', status: 'ACTIVE', provider: 'seed', currentPeriodEnd: at(300) },
  });

  // Devices so the Linked Devices center has content. Real sessions are created on sign-in.
  const mac = await prisma.device.create({ data: { userId: avery.id, name: 'Avery’s MacBook Pro', platform: 'DESKTOP_MACOS', osVersion: 'macOS 16.1', appVersion: '0.1.0', linkedVia: 'SEED', lastActiveAt: at(0, '09:10') } });
  const pixel = await prisma.device.create({ data: { userId: avery.id, name: 'Pixel 9 Pro', platform: 'ANDROID', osVersion: 'Android 17', appVersion: '0.1.0', linkedVia: 'SEED', lastActiveAt: at(-1, '21:40') } });
  await fakeSession(avery.id, mac.id, 0);
  await fakeSession(avery.id, pixel.id, 1);

  // ── Personal workspaces ──
  const personal = await workspace(avery.id, 'Avery’s Space', 'avery', true);
  for (const u of [priya, jordan, sam]) {
    const ws = await workspace(u.id, `${u.name!.split(' ')[0]}’s Space`, u.email.split('@')[0]!, true);
    await project(ws.id, u.id, 'Inbox', { isInbox: true, color: '#9DEFFF', icon: 'inbox' });
  }
  const life = await prisma.folder.create({ data: { workspaceId: personal.id, name: 'Life', sortOrder: 1 } });
  const inbox = await project(personal.id, avery.id, 'Inbox', { isInbox: true, color: '#9DEFFF', icon: 'inbox' });
  const work = await project(personal.id, avery.id, 'Work', { color: '#60E9FF', icon: 'briefcase', sortOrder: 1 });
  const home = await project(personal.id, avery.id, 'Personal', { color: '#FFBC5C', icon: 'home', folderId: life.id, sortOrder: 2 });
  const health = await project(personal.id, avery.id, 'Health', { color: '#7CF3B0', icon: 'heart', folderId: life.id, sortOrder: 3 });
  const reading = await project(personal.id, avery.id, 'Reading list', { color: '#A58CFF', icon: 'book', sortOrder: 4 });

  await tasks(inbox, avery.id, [
    { title: 'Reply to Maya about the conference panel', priority: 'MEDIUM', due: at(0, '11:00'), reminders: [15] },
    { title: 'Book dentist cleaning', due: at(2), allDay: true, tags: ['errands'] },
    { title: 'Idea: weekly async demo video for the team', tags: ['ideas'] },
    { title: 'Return library books', due: at(-2), allDay: true, priority: 'LOW', tags: ['errands'] },
    { title: 'Look into standing desk options', tags: ['ideas'], deleted: true },
  ]);

  await tasks(work, avery.id, [
    {
      title: 'Submit quarterly report',
      priority: 'HIGH',
      due: at(((5 - now.weekday + 7) % 7) || 7, '16:00'),
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
      tags: ['work', 'reporting'],
      reminders: [0, 60],
      description: '<p>Pull numbers from the <strong>Q4 dashboard</strong> and summarise risks.</p><ul><li>Revenue vs plan</li><li>Hiring</li><li>Launch readiness</li></ul>',
      checklist: [['Export metrics', true], ['Draft summary', false], ['Get Priya’s sign-off', false]],
    },
    { title: 'Fix production alert: payment webhook retries', priority: 'CRITICAL', due: at(0, '10:30'), tags: ['oncall'], reminders: [0], favorite: true, status: 'IN_PROGRESS' },
    { title: 'Prepare 1:1 notes for Jordan', priority: 'MEDIUM', due: at(1, '09:30'), duration: 30, start: at(1, '09:00'), tags: ['people'] },
    { title: 'Review hiring pipeline', priority: 'MEDIUM', due: at(3, '14:00'), duration: 45, start: at(3, '13:15') },
    { title: 'Write RFC: offline sync v2', priority: 'HIGH', due: at(6), allDay: true, tags: ['writing'], checklist: [['Problem statement', true], ['Conflict model', true], ['Migration plan', false], ['Open questions', false]] },
    { title: 'Expense report for October', priority: 'LOW', due: at(-1, '17:00'), tags: ['admin'], reminders: [0] },
    { title: 'Update team OKR tracker', priority: 'MEDIUM', due: at(-3), allDay: true },
    { title: 'Ship analytics dashboard v1', done: true, priority: 'HIGH', completedAt: at(-2, '16:20') },
    { title: 'Draft launch FAQ', done: true, completedAt: at(-1, '11:05') },
    { title: 'Clean up stale feature flags', done: true, completedAt: at(-4, '10:00'), priority: 'LOW' },
    { title: 'Plan Q1 offsite', priority: 'MEDIUM', due: at(14), allDay: true, tags: ['planning'] },
    { title: 'Archive: 2025 roadmap notes', archived: true },
  ]);

  await tasks(home, avery.id, [
    { title: 'Call mom', due: at(0, '19:00'), priority: 'MEDIUM', reminders: [10], rrule: 'FREQ=WEEKLY;BYDAY=SU' },
    { title: 'Pay rent', due: at(now.daysInMonth! - now.day + 1), allDay: true, priority: 'HIGH', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', reminders: [1440] },
    { title: 'Renew passport', due: at(21), allDay: true, priority: 'MEDIUM', checklist: [['Photos', false], ['Form DS-82', false], ['Check fee', false]] },
    { title: 'Groceries', due: at(1, '18:00'), tags: ['errands'], checklist: [['Oat milk', false], ['Spinach', false], ['Coffee beans', false], ['Lemons', true]] },
    { title: 'Water the plants', due: at(0), allDay: true, rrule: 'FREQ=DAILY;INTERVAL=3', priority: 'LOW' },
  ]);

  await tasks(health, avery.id, [
    { title: 'Long run — 14 km', due: at(2, '07:00'), duration: 80, start: at(2, '07:00'), priority: 'MEDIUM', tags: ['training'] },
    { title: 'Book physio follow-up', due: at(4), allDay: true, priority: 'MEDIUM' },
    { title: 'Meal prep for the week', due: at(((7 - now.weekday + 7) % 7) || 7, '16:00'), duration: 90, start: at(((7 - now.weekday + 7) % 7) || 7, '14:30') },
  ]);

  await tasks(reading, avery.id, [
    { title: '“Designing Data-Intensive Applications” ch. 7–8' },
    { title: '“The Creative Act”', done: true, completedAt: at(-6) },
    { title: '“Four Thousand Weeks”' },
  ]);

  // ── Team workspace ──
  const team = await workspace(avery.id, 'Northwind Studio', 'northwind', false, [
    { userId: priya.id, role: 'ADMIN' },
    { userId: jordan.id, role: 'MEMBER' },
    { userId: sam.id, role: 'VIEWER' },
  ]);
  const launch = await project(team.id, avery.id, 'Aurora Launch', { color: '#FFBC5C', icon: 'rocket', defaultView: 'KANBAN' });
  const sectionNames = ['Backlog', 'In progress', 'Review', 'Done'];
  const sections: Record<string, string> = {};
  for (const [i, name] of sectionNames.entries()) {
    sections[name] = (await prisma.section.create({ data: { projectId: launch.id, name, sortOrder: i } })).id;
  }
  const launchTasks = await tasks(
    launch,
    avery.id,
    [
      { title: 'Finalize pricing page copy', section: 'In progress', assignee: priya.id, priority: 'HIGH', due: at(1, '12:00'), tags: ['marketing'], status: 'IN_PROGRESS', reminders: [30] },
      { title: 'Record product walkthrough video', section: 'Backlog', assignee: jordan.id, priority: 'MEDIUM', due: at(5), allDay: true, tags: ['marketing'] },
      { title: 'Load test sync service (10k concurrent)', section: 'In progress', assignee: avery.id, priority: 'CRITICAL', due: at(2, '15:00'), tags: ['eng'], duration: 120, start: at(2, '13:00'), status: 'IN_PROGRESS' },
      { title: 'Android widget QA on low-memory devices', section: 'Review', assignee: jordan.id, priority: 'HIGH', due: at(-1, '16:00'), tags: ['eng', 'qa'], status: 'BLOCKED' },
      { title: 'Press kit + screenshots', section: 'Backlog', assignee: priya.id, priority: 'MEDIUM', due: at(9), allDay: true, tags: ['marketing'] },
      { title: 'Security review: QR device linking', section: 'Review', assignee: avery.id, priority: 'HIGH', due: at(3, '11:00'), tags: ['eng', 'security'], checklist: [['Token expiry', true], ['Replay protection', true], ['Logging redaction', false]] },
      { title: 'Beta feedback triage', section: 'Done', assignee: jordan.id, done: true, completedAt: at(-2, '14:00'), tags: ['research'] },
      { title: 'Set up status page', section: 'Done', assignee: avery.id, done: true, completedAt: at(-3, '10:00'), tags: ['eng'] },
      { title: 'Launch day run-of-show', section: 'Backlog', assignee: avery.id, priority: 'HIGH', due: at(18, '09:00'), tags: ['planning'] },
    ],
    sections,
  );
  // Dependencies: video depends on pricing copy; run-of-show depends on load test.
  await prisma.taskDependency.createMany({
    data: [
      { taskId: launchTasks[1]!.id, dependsOnId: launchTasks[0]!.id },
      { taskId: launchTasks[8]!.id, dependsOnId: launchTasks[2]!.id },
    ],
  });
  await prisma.comment.createMany({
    data: [
      { taskId: launchTasks[0]!.id, authorId: priya.id, body: 'First draft is in the doc — @Avery can you check the annual discount wording?', mentions: [avery.id], createdAt: at(-1, '15:12') },
      { taskId: launchTasks[0]!.id, authorId: avery.id, body: 'Looks great. Let’s say “2 months free” instead of 16%.', mentions: [], createdAt: at(-1, '16:40') },
      { taskId: launchTasks[3]!.id, authorId: jordan.id, body: 'Blocked on a Pixel 6a test device — ordered one, arriving Friday.', mentions: [], createdAt: at(-1, '10:05') },
    ],
  });

  const website = await project(team.id, priya.id, 'Website Refresh', { color: '#A58CFF', icon: 'globe', defaultView: 'TIMELINE', sortOrder: 1 });
  await tasks(website, priya.id, [
    { title: 'Information architecture', assignee: priya.id, start: at(-6), due: at(-2), allDay: true, done: true, completedAt: at(-2, '17:00') },
    { title: 'Visual design system', assignee: priya.id, start: at(-2), due: at(6), allDay: true, priority: 'HIGH', status: 'IN_PROGRESS' },
    { title: 'Build marketing pages', assignee: jordan.id, start: at(4), due: at(13), allDay: true, priority: 'MEDIUM' },
    { title: 'SEO + analytics', assignee: jordan.id, start: at(11), due: at(16), allDay: true },
    { title: 'Content migration', assignee: avery.id, start: at(8), due: at(15), allDay: true, priority: 'LOW' },
  ]);
  const research = await project(team.id, avery.id, 'Customer Research', { color: '#7CF3B0', icon: 'search', sortOrder: 2 });
  await tasks(research, avery.id, [
    { title: 'Interview: Leah (freelance designer)', due: at(1, '13:00'), duration: 45, start: at(1, '13:00'), assignee: avery.id, tags: ['interview'] },
    { title: 'Synthesize interview notes', due: at(4), allDay: true, assignee: jordan.id, priority: 'MEDIUM' },
    { title: 'Survey: notification fatigue', due: at(7), allDay: true, assignee: priya.id, tags: ['survey'] },
  ]);

  // ── Habits ──
  const habitDefs = [
    { name: 'Meditate 10 min', icon: 'sparkles', color: '#60E9FF', frequency: 'DAILY' as const, weekdays: [], rate: 0.85, reminderTime: '07:30' },
    { name: 'Read 20 pages', icon: 'book', color: '#A58CFF', frequency: 'DAILY' as const, weekdays: [], rate: 0.7, reminderTime: '21:30' },
    { name: 'Workout', icon: 'dumbbell', color: '#FFBC5C', frequency: 'WEEKLY' as const, weekdays: [], target: 3, rate: 0.5, reminderTime: null },
    { name: 'No phone after 10pm', icon: 'moon', color: '#7865FF', frequency: 'DAILY' as const, weekdays: [1, 2, 3, 4, 5], rate: 0.6, reminderTime: '21:55' },
    { name: 'Drink 2L water', icon: 'droplet', color: '#7CF3B0', frequency: 'DAILY' as const, weekdays: [], rate: 0.9, reminderTime: null },
  ];
  for (const [i, h] of habitDefs.entries()) {
    const habit = await prisma.habit.create({
      data: { userId: avery.id, name: h.name, icon: h.icon, color: h.color, frequency: h.frequency, weekdays: h.weekdays, targetPerPeriod: h.target ?? 1, reminderTime: h.reminderTime, sortOrder: i },
    });
    const checkIns = [];
    for (let d = 75; d >= 1; d--) {
      const day = now.minus({ days: d });
      if (h.weekdays.length && !h.weekdays.includes(day.weekday)) continue;
      // Recent days are more consistent so streaks are visible.
      const p = d < 8 ? Math.min(1, h.rate + 0.25) : h.rate;
      if (rand() < p) checkIns.push({ habitId: habit.id, date: day.toISODate()! });
    }
    await prisma.habitCheckIn.createMany({ data: checkIns });
  }

  // ── Focus sessions (last 3 weeks) ──
  const focusTargets = await prisma.task.findMany({ where: { projectId: { in: [work.id, launch.id] }, completedAt: null, deletedAt: null }, take: 5 });
  const focus = [];
  for (let d = 21; d >= 0; d--) {
    const n = Math.floor(rand() * 5);
    for (let k = 0; k < n; k++) {
      const startedAt = now.minus({ days: d }).startOf('day').plus({ hours: 9 + k * 1.5, minutes: Math.floor(rand() * 20) });
      if (startedAt > now) continue;
      const planned = 25;
      const completed = rand() > 0.15;
      focus.push({
        userId: avery.id,
        taskId: focusTargets[Math.floor(rand() * focusTargets.length)]?.id ?? null,
        kind: 'FOCUS' as const,
        startedAt: startedAt.toJSDate(),
        endedAt: startedAt.plus({ minutes: completed ? planned : 12 }).toJSDate(),
        plannedMinutes: planned,
        actualSeconds: (completed ? planned : 12) * 60,
        completed,
      });
    }
  }
  await prisma.focusSession.createMany({ data: focus });

  // ── Countdowns, filters, templates ──
  await prisma.countdown.createMany({
    data: [
      { userId: avery.id, title: 'Aurora launch day', targetAt: at(18, '09:00'), color: '#FFBC5C', icon: 'rocket' },
      { userId: avery.id, title: 'Mom’s birthday', targetAt: at(34), color: '#FF7A9C', icon: 'gift' },
      { userId: avery.id, title: 'Half marathon', targetAt: at(60, '08:00'), color: '#7CF3B0', icon: 'flag' },
    ],
  });
  await prisma.savedFilter.createMany({
    data: [
      { userId: avery.id, name: 'Hot this week', pinned: true, advanced: false, query: { match: 'all', rules: [{ field: 'priority', op: 'in', value: ['HIGH', 'CRITICAL'] }, { field: 'due', op: 'next7' }] } },
      { userId: avery.id, name: 'Errands', pinned: true, advanced: false, query: { match: 'all', rules: [{ field: 'tag', op: 'in', value: ['errands'] }] } },
      { userId: avery.id, name: 'Unassigned team work', pinned: false, advanced: true, query: { match: 'all', rules: [{ field: 'assignee', op: 'none', value: [] }, { field: 'project', op: 'in', value: [launch.id, website.id] }] } },
    ],
  });
  await prisma.template.createMany({
    data: [
      {
        userId: avery.id,
        kind: 'TASK',
        name: 'Weekly review',
        description: 'Friday wrap-up checklist',
        payload: { title: 'Weekly review', priority: 'MEDIUM', durationMinutes: 45, tags: ['planning'], checklist: ['Clear inbox to zero', 'Review calendar for next week', 'Update project statuses', 'Pick 3 priorities'] },
      },
      {
        userId: avery.id,
        kind: 'PROJECT',
        name: 'Product launch',
        description: 'Sections and starter tasks for a launch',
        payload: {
          name: 'New launch',
          color: '#FFBC5C',
          defaultView: 'KANBAN',
          sections: ['Backlog', 'In progress', 'Review', 'Done'],
          tasks: [
            { title: 'Define launch goals', section: 'Backlog', priority: 'HIGH' },
            { title: 'Write announcement', section: 'Backlog' },
            { title: 'QA pass', section: 'Backlog', priority: 'HIGH' },
          ],
        },
      },
    ],
  });

  // ── Notification center ──
  await prisma.notification.createMany({
    data: [
      { userId: avery.id, kind: 'MENTION', priority: 'MEDIUM', title: 'Priya mentioned you', body: 'Finalize pricing page copy — “can you check the annual discount wording?”', taskId: launchTasks[0]!.id, dedupeKey: `seed:${randomBytes(6).toString('hex')}`, createdAt: at(-1, '15:12') },
      { userId: avery.id, kind: 'ASSIGNMENT', priority: 'HIGH', title: 'You were assigned a task', body: 'Security review: QR device linking', taskId: launchTasks[5]!.id, dedupeKey: `seed:${randomBytes(6).toString('hex')}`, createdAt: at(-2, '09:00'), readAt: at(-2, '09:30') },
      { userId: avery.id, kind: 'DIGEST', priority: 'NONE', title: 'Good morning — 4 priorities today', body: 'Fix production alert, Reply to Maya, Submit quarterly report, Call mom', dedupeKey: `seed:${randomBytes(6).toString('hex')}`, silent: true, createdAt: new Date(Math.min(at(0, '08:00').getTime(), Date.now() - 3_600_000)) },
    ],
  });

  await prisma.auditLog.create({ data: { workspaceId: team.id, actorId: avery.id, action: 'workspace.seeded', targetType: 'workspace', targetId: team.id } });

  const counts = {
    users: await prisma.user.count(),
    tasks: await prisma.task.count(),
    habits: await prisma.habit.count(),
    checkIns: await prisma.habitCheckIn.count(),
    focus: await prisma.focusSession.count(),
    reminders: await prisma.reminder.count(),
  };
  console.log('Seeded', counts);
  console.log('Sign in as avery@remindora.dev (Premium) or jordan@remindora.dev (Free). Codes print in the API log in development.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
