'use client';
import { create } from 'zustand';
import { normalizeAlarmSound } from '@remindora/core';
import { isTauri } from './platform';

/**
 * Alarm-clock behaviour for due reminders: a full-screen alert with a looping sound
 * until the user stops, snoozes or completes it (or does so on another device).
 */
export interface RingingAlarm {
  notificationId: string;
  taskId: string | null;
  title: string;
  body: string;
  /** Chosen in the reminder form: alarm | bell | chime | digital | siren | silent. */
  sound?: string;
  /** Local preview from Settings → "Test alarm" (nothing to acknowledge on the server). */
  test?: boolean;
}

interface AlarmState {
  queue: RingingAlarm[];
  ring: (a: RingingAlarm) => void;
  dismiss: (notificationId: string) => void;
}

export const useAlarm = create<AlarmState>((set) => ({
  queue: [],
  ring: (a) => set((s) => (s.queue.some((x) => x.notificationId === a.notificationId) ? s : { queue: [...s.queue, a] })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((x) => x.notificationId !== id) })),
}));

let audio: HTMLAudioElement | null = null;
function sound() {
  if (typeof window === 'undefined') return null;
  audio ??= Object.assign(new Audio('/sounds/alarm.wav'), { loop: true, preload: 'auto' });
  return audio;
}

const soundUrl = (name: string) => `/sounds/${normalizeAlarmSound(name)}.wav`;

/** Browsers only allow sound after a user gesture: prime the player on the first click/tap. */
export function unlockAlarmSound() {
  const a = sound();
  if (!a) return;
  a.muted = true;
  void a
    .play()
    .then(() => {
      a.pause();
      a.currentTime = 0;
      a.muted = false;
    })
    .catch(() => {
      a.muted = false;
    });
}

export async function startAlarmSound(name = 'alarm'): Promise<boolean> {
  const a = sound();
  if (!a) return false;
  if (normalizeAlarmSound(name) === 'silent') {
    navigator.vibrate?.([800, 500, 800, 500, 800]);
    return true;
  }
  if (!a.src.endsWith(soundUrl(name))) a.src = soundUrl(name);
  a.muted = false;
  a.currentTime = 0;
  try {
    await a.play();
    return true;
  } catch {
    return false;
  }
}

let preview: HTMLAudioElement | null = null;
/** Plays a few seconds of a sound in the reminder form. */
export function previewAlarmSound(name: string) {
  preview?.pause();
  if (normalizeAlarmSound(name) === 'silent') {
    navigator.vibrate?.(400);
    return;
  }
  preview = new Audio(soundUrl(name));
  void preview.play().catch(() => undefined);
  setTimeout(() => preview?.pause(), 3000);
}

export function stopAlarmSound() {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

/** Desktop: bring the (possibly tray-hidden) window to the front so the alarm is seen. */
export async function surfaceWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  await w.unminimize().catch(() => undefined);
  await w.show().catch(() => undefined);
  await w.setFocus().catch(() => undefined);
}
