import type { NotificationPreference, ProjectNotificationOverride } from '@remindora/database';
import { resolvePrefs, type NotificationPrefs, type ProjectOverride } from '@remindora/notifications';

export function effectivePrefs(row: NotificationPreference | null, override: ProjectNotificationOverride | null, timezone: string) {
  const prefs: Partial<NotificationPrefs> = row
    ? {
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
      }
    : { timezone };
  const ov: ProjectOverride | null = override
    ? { muted: override.muted, channels: (override.channels as ProjectOverride['channels']) ?? null, criticalRepeatMinutes: override.criticalRepeatMinutes, highRepeatMinutes: override.highRepeatMinutes }
    : null;
  return resolvePrefs(prefs, ov);
}
