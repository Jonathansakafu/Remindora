import { z } from 'zod';
import { PRIORITIES } from './enums';

/** Input validation schemas shared by the API (server-side enforcement) and clients (form hints). */

const isoDate = z.iso.datetime({ offset: true });
const ianaTimezone = z.string().min(1).max(64).refine(isValidTimezone, 'Unknown IANA timezone');

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const priorityInput = z.enum(PRIORITIES as [string, ...string[]]);

export const recurrenceInput = z.object({
  rrule: z.string().min(5).max(500),
  mode: z.enum(['FROM_DUE', 'FROM_COMPLETION']).default('FROM_DUE'),
  until: isoDate.nullish(),
});

export const reminderInput = z.object({
  /** Minutes before the due date (0 = at due time). Ignored when `at` is supplied. */
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  at: isoDate.optional(),
  constant: z.boolean().optional(),
  subtaskId: z.uuid().optional(),
});

export const createTaskInput = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(50_000).nullish(),
  projectId: z.uuid().optional(),
  sectionId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  priority: priorityInput.default('NONE'),
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).default('TODO'),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  assigneeId: z.uuid().nullish(),
  startAt: isoDate.nullish(),
  dueAt: isoDate.nullish(),
  allDay: z.boolean().default(false),
  durationMinutes: z.number().int().min(1).max(60 * 24 * 14).nullish(),
  recurrence: recurrenceInput.nullish(),
  /** Omit to get priority-based default reminders; pass [] for none. */
  reminders: z.array(reminderInput).max(10).optional(),
  checklist: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  dependsOn: z.array(z.uuid()).max(50).default([]),
  isFavorite: z.boolean().default(false),
  /** Client-generated id so offline-created tasks keep their identity once synced. */
  clientId: z.uuid().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const updateTaskInput = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(50_000).nullable(),
    projectId: z.uuid(),
    sectionId: z.uuid().nullable(),
    priority: priorityInput,
    status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']),
    assigneeId: z.uuid().nullable(),
    startAt: isoDate.nullable(),
    dueAt: isoDate.nullable(),
    allDay: z.boolean(),
    durationMinutes: z.number().int().min(1).max(60 * 24 * 14).nullable(),
    isFavorite: z.boolean(),
    archived: z.boolean(),
    sortOrder: z.number(),
    tags: z.array(z.string().trim().min(1).max(50)).max(30),
    recurrence: recurrenceInput.nullable(),
    dependsOn: z.array(z.uuid()).max(50),
  })
  .partial()
  .extend({
    /** Version the client based its edit on. Enables field-level conflict detection. */
    baseVersion: z.number().int().min(0).optional(),
    /** Resolve detected conflicts by overwriting the server value. */
    force: z.boolean().optional(),
  });
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;

export const bulkTaskInput = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  action: z.enum(['complete', 'reopen', 'delete', 'restore', 'archive', 'move', 'priority', 'tag']),
  projectId: z.uuid().optional(),
  priority: priorityInput.optional(),
  tag: z.string().trim().min(1).max(50).optional(),
});

export const taskQueryInput = z.object({
  view: z.enum(['inbox', 'today', 'upcoming', 'overdue', 'assigned', 'completed', 'favorites', 'archive', 'trash', 'all']).optional(),
  projectId: z.uuid().optional(),
  workspaceId: z.uuid().optional(),
  q: z.string().max(200).optional(),
  tags: z.array(z.string()).optional(),
  priorities: z.array(priorityInput).optional(),
  assigneeId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  includeCompleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).default(500),
});
export type TaskQueryInput = z.infer<typeof taskQueryInput>;

/** Saved smart filter definition. Stored as JSON on SavedFilter.query. */
export const filterQuery = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z
    .array(
      z.discriminatedUnion('field', [
        z.object({ field: z.literal('priority'), op: z.enum(['in', 'notIn']), value: z.array(priorityInput) }),
        z.object({ field: z.literal('tag'), op: z.enum(['in', 'notIn']), value: z.array(z.string()) }),
        z.object({ field: z.literal('project'), op: z.enum(['in', 'notIn']), value: z.array(z.uuid()) }),
        z.object({ field: z.literal('assignee'), op: z.enum(['in', 'notIn', 'me', 'none']), value: z.array(z.uuid()).default([]) }),
        z.object({ field: z.literal('due'), op: z.enum(['overdue', 'today', 'next7', 'none', 'before', 'after']), value: isoDate.optional() }),
        z.object({ field: z.literal('status'), op: z.enum(['in', 'notIn']), value: z.array(z.string()) }),
        z.object({ field: z.literal('text'), op: z.literal('contains'), value: z.string().max(200) }),
      ]),
    )
    .max(20),
});
export type FilterQuery = z.infer<typeof filterQuery>;

export const notificationPreferenceInput = z.object({
  timezone: ianaTimezone.optional(),
  channels: z
    .object({
      push: z.boolean(),
      desktop: z.boolean(),
      webPush: z.boolean(),
      email: z.boolean(),
      inApp: z.boolean(),
    })
    .partial()
    .optional(),
  criticalRepeatMinutes: z.number().int().min(5).max(24 * 60).optional(),
  highRepeatMinutes: z.number().int().min(5).max(24 * 60).optional(),
  mediumFollowUpMinutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
  maxRealerts: z.number().int().min(0).max(50).optional(),
  criticalEmail: z.boolean().optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  criticalBypassQuietHours: z.boolean().optional(),
  weekendsEnabled: z.boolean().optional(),
  morningDigestEnabled: z.boolean().optional(),
  morningDigestTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  eveningPlanningEnabled: z.boolean().optional(),
  eveningPlanningTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInput>;

export const deviceInfoInput = z.object({
  name: z.string().trim().min(1).max(80),
  platform: z.enum(['WEB', 'DESKTOP_MACOS', 'DESKTOP_WINDOWS', 'DESKTOP_LINUX', 'ANDROID', 'IOS', 'UNKNOWN']),
  osVersion: z.string().max(60).optional(),
  appVersion: z.string().max(30).optional(),
});
export type DeviceInfoInput = z.infer<typeof deviceInfoInput>;

export const emailStartInput = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  device: deviceInfoInput,
  redirectTo: z.string().max(500).optional(),
});

export const emailVerifyInput = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/).optional(),
  token: z.string().min(20).max(200).optional(),
}).refine((v) => Boolean(v.code) !== Boolean(v.token), 'Provide exactly one of code or token');
