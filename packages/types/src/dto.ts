import type {
  DevicePlatform,
  HabitFrequency,
  NotificationChannel,
  PlanKey,
  Priority,
  RecurrenceMode,
  Role,
  TaskStatus,
} from './enums';

/** Wire shapes returned by the API. Dates are ISO-8601 UTC strings. */

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  weekStartsOn: 0 | 1 | 6;
  theme: string;
  createdAt: string;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  role: Role;
  memberCount: number;
}

export interface MemberDTO {
  userId: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

export interface FolderDTO {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
}

export interface ProjectDTO {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  color: string;
  icon: string | null;
  isInbox: boolean;
  defaultView: string;
  archived: boolean;
  sortOrder: number;
  taskCount: number;
  sections: SectionDTO[];
}

export interface SectionDTO {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
}

export interface SubtaskDTO {
  id: string;
  title: string;
  done: boolean;
  sortOrder: number;
  remindAt: string | null;
}

export interface ReminderDTO {
  id: string;
  offsetMinutes: number | null;
  at: string | null;
  constant: boolean;
  subtaskId: string | null;
  nextFireAt: string | null;
  attempt: number;
  state: 'ACTIVE' | 'SNOOZED' | 'ACKNOWLEDGED' | 'STOPPED' | 'DONE';
}

export interface RecurrenceDTO {
  rrule: string;
  mode: RecurrenceMode;
  until: string | null;
  timezone: string;
}

export interface TaskDTO {
  id: string;
  projectId: string;
  workspaceId: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  priority: Priority;
  status: TaskStatus;
  tags: string[];
  assigneeId: string | null;
  creatorId: string;
  startAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  durationMinutes: number | null;
  completedAt: string | null;
  isFavorite: boolean;
  archived: boolean;
  deletedAt: string | null;
  sortOrder: number;
  version: number;
  syncSeq: string;
  subtasks: SubtaskDTO[];
  reminders: ReminderDTO[];
  recurrence: RecurrenceDTO | null;
  dependsOn: string[];
  attachmentCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskConflictDTO {
  taskId: string;
  fields: string[];
  server: TaskDTO;
}

export interface CommentDTO {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
}

export interface ActivityDTO {
  id: string;
  actorId: string | null;
  actorName: string | null;
  verb: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AttachmentDTO {
  id: string;
  taskId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string | null;
  createdAt: string;
}

export interface DeviceDTO {
  id: string;
  sessionId: string | null;
  name: string;
  platform: DevicePlatform;
  osVersion: string | null;
  appVersion: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
  pushEnabled: boolean;
}

export interface NotificationDTO {
  id: string;
  taskId: string | null;
  reminderId: string | null;
  kind: string;
  priority: Priority;
  title: string;
  body: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  actions: Array<'snooze' | 'complete' | 'reschedule' | 'stop' | 'open'>;
  /** Kind-specific payload (e.g. { challengeId } for DEVICE_APPROVAL). Never contains secrets. */
  data: Record<string, unknown>;
}

export interface NotificationPreferenceDTO {
  timezone: string;
  channels: Record<'push' | 'desktop' | 'webPush' | 'email' | 'inApp', boolean>;
  criticalRepeatMinutes: number;
  highRepeatMinutes: number;
  mediumFollowUpMinutes: number | null;
  maxRealerts: number;
  criticalEmail: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  criticalBypassQuietHours: boolean;
  weekendsEnabled: boolean;
  lowPriorityMode: 'inbox' | 'digest';
  morningDigestEnabled: boolean;
  morningDigestTime: string;
  eveningPlanningEnabled: boolean;
  eveningPlanningTime: string;
  projectOverrides: ProjectNotificationOverrideDTO[];
}

export interface ProjectNotificationOverrideDTO {
  projectId: string;
  muted: boolean;
  channels: Partial<Record<'push' | 'desktop' | 'webPush' | 'email' | 'inApp', boolean>> | null;
  criticalRepeatMinutes: number | null;
  highRepeatMinutes: number | null;
}

export interface HabitDTO {
  id: string;
  name: string;
  icon: string | null;
  color: string;
  frequency: HabitFrequency;
  /** For WEEKLY habits: ISO weekdays (1=Mon..7=Sun) the habit is scheduled for. */
  weekdays: number[];
  targetPerPeriod: number;
  reminderTime: string | null;
  archived: boolean;
  currentStreak: number;
  bestStreak: number;
  checkIns: string[];
}

export interface FocusSessionDTO {
  id: string;
  taskId: string | null;
  kind: 'FOCUS' | 'SHORT_BREAK' | 'LONG_BREAK';
  startedAt: string;
  endedAt: string | null;
  plannedMinutes: number;
  actualSeconds: number;
  completed: boolean;
}

export interface CountdownDTO {
  id: string;
  title: string;
  targetAt: string;
  color: string;
  icon: string | null;
}

export interface SavedFilterDTO {
  id: string;
  name: string;
  query: unknown;
  advanced: boolean;
  pinned: boolean;
}

export interface TemplateDTO {
  id: string;
  kind: 'TASK' | 'PROJECT';
  name: string;
  description: string | null;
  payload: unknown;
}

export interface EntitlementsDTO {
  plan: PlanKey;
  status: string;
  currentPeriodEnd: string | null;
  limits: Record<string, number>;
  features: Record<string, boolean>;
}

export interface SyncChangesDTO {
  cursor: string;
  hasMore: boolean;
  tasks: TaskDTO[];
  projects: ProjectDTO[];
}

export interface AnalyticsSummaryDTO {
  range: { from: string; to: string };
  completed: number;
  created: number;
  completionRate: number;
  overdue: number;
  focusMinutes: number;
  habitConsistency: number;
  byPriority: Record<Priority, number>;
  byProject: Array<{ projectId: string; name: string; color: string; completed: number; open: number }>;
  daily: Array<{ date: string; completed: number; created: number; focusMinutes: number }>;
  premium?: {
    bestHour: number | null;
    averageCompletionHours: number | null;
    streakDays: number;
    weekOverWeek: number | null;
  };
}

export interface AuthTokensDTO {
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Returned to native clients only; web receives it as an httpOnly cookie. */
  refreshToken?: string;
  sessionId: string;
  deviceId: string;
  user: UserDTO;
}

export interface PairingCreatedDTO {
  pairingId: string;
  /** Opaque, encrypted, single-use token — encode into the QR as remindora://link?t=<token>. */
  qrToken: string;
  deepLink: string;
  expiresAt: string;
}

export interface PairingClaimDTO {
  claimId: string;
  claimSecret: string;
  verificationCode: string;
  initiatorDeviceName: string;
  expiresAt: string;
}

export type NotificationChannelSet = Partial<Record<NotificationChannel, boolean>>;
