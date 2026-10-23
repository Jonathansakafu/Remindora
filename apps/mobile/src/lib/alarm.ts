import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';
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
  test?: boolean;
}

export const useAlarm = create<{ queue: RingingAlarm[]; ring: (a: RingingAlarm) => void; dismiss: (id: string) => void }>((set) => ({
  queue: [],
  ring: (a) => set((s) => (s.queue.some((x) => x.notificationId === a.notificationId) ? s : { queue: [...s.queue, a] })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((x) => x.notificationId !== id) })),
}));

let player: AudioPlayer | null = null;

export async function startAlarm() {
  try {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix', shouldPlayInBackground: false });
    player ??= createAudioPlayer(require('../../assets/sounds/remindora_alarm.wav'));
    player.loop = true;
    player.volume = 1;
    await player.seekTo(0);
    player.play();
  } catch {
    /* the channel sound / vibration still alert the user */
  }
  Vibration.vibrate([0, 800, 500], true);
}

export function stopAlarm() {
  Vibration.cancel();
  try {
    player?.pause();
  } catch {
    /* already released */
  }
}
