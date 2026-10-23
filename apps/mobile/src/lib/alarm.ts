import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';
import { normalizeAlarmSound, type AlarmSound } from '@remindora/core';
import { create } from 'zustand';

/**
 * Alarm-clock behaviour while the app is open: a full-screen alarm with a looping
 * sound and vibration until Stop / Snooze / Done. When the app is closed, Android
 * rings the "Alarms" notification channel (its own alarm sound) instead.
 */
export interface RingingAlarm {
  notificationId: string;
  taskId: string | null;
  title: string;
  body: string;
  /** alarm | bell | chime | digital | siren | silent */
  sound?: string;
  test?: boolean;
}

export const useAlarm = create<{ queue: RingingAlarm[]; ring: (a: RingingAlarm) => void; dismiss: (id: string) => void }>((set) => ({
  queue: [],
  ring: (a) => set((s) => (s.queue.some((x) => x.notificationId === a.notificationId) ? s : { queue: [...s.queue, a] })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((x) => x.notificationId !== id) })),
}));

const SOUND_FILES: Record<Exclude<AlarmSound, 'silent'>, number> = {
  alarm: require('../../assets/sounds/remindora_alarm.wav'),
  bell: require('../../assets/sounds/remindora_bell.wav'),
  chime: require('../../assets/sounds/remindora_chime.wav'),
  digital: require('../../assets/sounds/remindora_digital.wav'),
  siren: require('../../assets/sounds/remindora_siren.wav'),
};

let player: AudioPlayer | null = null;
let playerSound: string | null = null;

function playerFor(sound: Exclude<AlarmSound, 'silent'>) {
  if (player && playerSound === sound) return player;
  player?.remove();
  player = createAudioPlayer(SOUND_FILES[sound]);
  playerSound = sound;
  return player;
}

/** Plays a few seconds of a sound in the reminder form. */
export async function previewAlarm(name: string) {
  const sound = normalizeAlarmSound(name);
  if (sound === 'silent') return Vibration.vibrate(400);
  await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix', shouldPlayInBackground: false }).catch(() => undefined);
  const p = playerFor(sound);
  p.loop = false;
  await p.seekTo(0);
  p.play();
  setTimeout(() => p.pause(), 3000);
}

export async function startAlarm(name = 'alarm') {
  const sound = normalizeAlarmSound(name);
  Vibration.vibrate([0, 800, 500], true);
  if (sound === 'silent') return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix', shouldPlayInBackground: false });
    const p = playerFor(sound);
    p.loop = true;
    p.volume = 1;
    await p.seekTo(0);
    p.play();
  } catch {
    /* the channel sound / vibration still alert the user */
  }
}

export function stopAlarm() {
  Vibration.cancel();
  try {
    player?.pause();
  } catch {
    /* already released */
  }
}
