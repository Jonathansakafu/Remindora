import type { NotificationPreference, ProjectNotificationOverride } from '@remindora/database';
import { resolvePrefs, type EffectivePrefs, type NotificationPrefs, type ProjectOverride } from '@remindora/notifications';

/** Converts DB rows into the policy engine's preference shape. */
export function prefsFromRow(row: NotificationPreference | null, timezone: string): Partial<NotificationPrefs> {
  if (!row) return { timezone };
  return {
    timezone,
    channels: row.channels as unknown as NotificationPrefs['channels'],
    criticalRepeatMinutes: row.criticalRepeatMinutes,
    highRepeatMinutes: row.highRepeatMinutes,
    mediumFollowUpMinutes: row.mediumFollowUpMinutes,
    maxRealerts: row.maxRealerts,
    criticalEmail: row.criticalEmail,
    quietHoursEnabled: row.quietHoursEnabled,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    criticalBypassQuietHours: row.criticalBypassQuietHours,
    weekendsEnabled: row.weekendsEnabled,
    lowPriorityMode: row.lowPriorityMode as 'inbox' | 'digest',
    morningDigestEnabled: row.morningDigestEnabled,
    morningDigestTime: row.morningDigestTime,
    eveningPlanningEnabled: row.eveningPlanningEnabled,
    eveningPlanningTime: row.eveningPlanningTime,
  };
}

export function overrideFromRow(row: ProjectNotificationOverride | null): ProjectOverride | null {
  if (!row) return null;
  return {
    muted: row.muted,
    channels: (row.channels as ProjectOverride['channels']) ?? null,
    criticalRepeatMinutes: row.criticalRepeatMinutes,
    highRepeatMinutes: row.highRepeatMinutes,
  };
}

export function effectivePrefs(row: NotificationPreference | null, override: ProjectNotificationOverride | null, timezone: string): EffectivePrefs {
  return resolvePrefs(prefsFromRow(row, timezone), overrideFromRow(override));
}
