/**
 * Domain enums shared by every client and the server. These mirror the Prisma
 * enums in packages/database/prisma/schema.prisma — keep them in sync.
 */

export const Priority = {
  NONE: 'NONE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
export const PRIORITIES: Priority[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const TaskStatus = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const PlanKey = {
  FREE: 'FREE',
  PREMIUM: 'PREMIUM',
  TEAM: 'TEAM',
} as const;
export type PlanKey = (typeof PlanKey)[keyof typeof PlanKey];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  PUSH: 'PUSH',
  DESKTOP: 'DESKTOP',
  WEB_PUSH: 'WEB_PUSH',
  EMAIL: 'EMAIL',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationEventType = {
  SCHEDULED: 'SCHEDULED',
  DELIVERED: 'DELIVERED',
  OPENED: 'OPENED',
  SNOOZED: 'SNOOZED',
  FAILED: 'FAILED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  COMPLETED: 'COMPLETED',
  STOPPED: 'STOPPED',
  SUPPRESSED: 'SUPPRESSED',
} as const;
export type NotificationEventType = (typeof NotificationEventType)[keyof typeof NotificationEventType];

export const DevicePlatform = {
  WEB: 'WEB',
  DESKTOP_MACOS: 'DESKTOP_MACOS',
  DESKTOP_WINDOWS: 'DESKTOP_WINDOWS',
  DESKTOP_LINUX: 'DESKTOP_LINUX',
  ANDROID: 'ANDROID',
  IOS: 'IOS',
  UNKNOWN: 'UNKNOWN',
} as const;
export type DevicePlatform = (typeof DevicePlatform)[keyof typeof DevicePlatform];

export const PairingStatus = {
  PENDING: 'PENDING',
  CLAIMED: 'CLAIMED',
  APPROVED: 'APPROVED',
  CONSUMED: 'CONSUMED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
} as const;
export type PairingStatus = (typeof PairingStatus)[keyof typeof PairingStatus];

export const RecurrenceMode = {
  /** Next occurrence is computed from the previous due date. */
  FROM_DUE: 'FROM_DUE',
  /** Next occurrence is computed from the moment the task was completed. */
  FROM_COMPLETION: 'FROM_COMPLETION',
} as const;
export type RecurrenceMode = (typeof RecurrenceMode)[keyof typeof RecurrenceMode];

export const ViewKind = {
  LIST: 'LIST',
  KANBAN: 'KANBAN',
  CALENDAR: 'CALENDAR',
  TIMELINE: 'TIMELINE',
  AGENDA: 'AGENDA',
  MATRIX: 'MATRIX',
} as const;
export type ViewKind = (typeof ViewKind)[keyof typeof ViewKind];

export const SmartList = {
  INBOX: 'inbox',
  TODAY: 'today',
  UPCOMING: 'upcoming',
  OVERDUE: 'overdue',
  ASSIGNED: 'assigned',
  COMPLETED: 'completed',
  FAVORITES: 'favorites',
  ARCHIVE: 'archive',
  TRASH: 'trash',
} as const;
export type SmartList = (typeof SmartList)[keyof typeof SmartList];

export const HabitFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
} as const;
export type HabitFrequency = (typeof HabitFrequency)[keyof typeof HabitFrequency];
