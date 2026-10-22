'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Phase = 'FOCUS' | 'SHORT_BREAK' | 'LONG_BREAK';

interface FocusState {
  focusMinutes: number;
  shortBreak: number;
  longBreak: number;
  cyclesBeforeLong: number;
  autoStartBreaks: boolean;
  phase: Phase;
  cycle: number;
  running: boolean;
  /** Epoch ms when the current phase ends (while running). */
  endsAt: number | null;
  /** Remaining ms when paused. */
  remainingMs: number;
  sessionId: string | null;
  taskId: string | null;
  sound: 'off' | 'rain' | 'brown' | 'white';
  configure: (p: Partial<Pick<FocusState, 'focusMinutes' | 'shortBreak' | 'longBreak' | 'cyclesBeforeLong' | 'autoStartBreaks' | 'sound' | 'taskId'>>) => void;
  set: (p: Partial<FocusState>) => void;
}

export const useFocus = create<FocusState>()(
  persist(
    (set) => ({
      focusMinutes: 25,
      shortBreak: 5,
      longBreak: 15,
      cyclesBeforeLong: 4,
      autoStartBreaks: true,
      phase: 'FOCUS',
      cycle: 1,
      running: false,
      endsAt: null,
      remainingMs: 25 * 60_000,
      sessionId: null,
      taskId: null,
      sound: 'off',
      configure: (p) => set((s) => ({ ...p, ...(!s.running && s.phase === 'FOCUS' && p.focusMinutes ? { remainingMs: p.focusMinutes * 60_000 } : {}) })),
      set: (p) => set(p),
    }),
    { name: 'remindora.focus' },
  ),
);

export function phaseMinutes(s: Pick<FocusState, 'focusMinutes' | 'shortBreak' | 'longBreak'>, phase: Phase) {
  return phase === 'FOCUS' ? s.focusMinutes : phase === 'SHORT_BREAK' ? s.shortBreak : s.longBreak;
}

/** Ambient sound generated in WebAudio (no audio assets needed). */
let ctx: AudioContext | null = null;
let node: AudioBufferSourceNode | null = null;
export function playAmbient(kind: 'off' | 'rain' | 'brown' | 'white') {
  node?.stop();
  node = null;
  if (kind === 'off' || typeof window === 'undefined') return;
  ctx ??= new AudioContext();
  const len = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') data[i] = white * 0.12;
    else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * (kind === 'rain' ? 2.2 : 3.2) + (kind === 'rain' && Math.random() < 0.0008 ? (Math.random() - 0.5) * 0.6 : 0);
    }
  }
  node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0.35;
  node.connect(gain).connect(ctx.destination);
  void ctx.resume();
  node.start();
}
