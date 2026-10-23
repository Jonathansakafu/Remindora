'use client';
import { timezoneToAdopt } from '@remindora/core';
import type { UserDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';
import { keys, useMe } from './queries';
import { useSession } from './session';

/** Moves a UTC (default) account to this device's time zone so due times and reminders match local time. */
export function useTimezoneSync() {
  const { data: me } = useMe();
  const setUser = useSession((s) => s.setUser);
  const qc = useQueryClient();
  useEffect(() => {
    const zone = timezoneToAdopt(me?.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (!zone) return;
    api<UserDTO>('/auth/me', { method: 'PATCH', body: { timezone: zone } })
      .then((user) => {
        setUser(user);
        qc.invalidateQueries({ queryKey: keys.me });
        qc.invalidateQueries({ queryKey: ['tasks'] });
      })
      .catch(() => undefined);
  }, [me?.timezone, setUser, qc]);
}
