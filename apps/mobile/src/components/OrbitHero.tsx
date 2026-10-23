import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View } from 'react-native';
import { colors } from '../lib/theme';

/**
 * The home "orbit": a glowing core with planets circling on tilted orbits. Depth comes from
 * scale and opacity following each planet around its ellipse (front = bigger, brighter).
 * Uses the native driver only (transform/opacity), so it stays smooth and cheap.
 */

const SAMPLES = 48;
const STEPS = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES);

function Planet({ progress, rx, ry, size, color, phase }: { progress: Animated.Value; rx: number; ry: number; size: number; color: string; phase: number }) {
  const angle = (t: number) => 2 * Math.PI * (t + phase);
  const x = progress.interpolate({ inputRange: STEPS, outputRange: STEPS.map((t) => rx * Math.cos(angle(t))) });
  const y = progress.interpolate({ inputRange: STEPS, outputRange: STEPS.map((t) => ry * Math.sin(angle(t))) });
  const scale = progress.interpolate({ inputRange: STEPS, outputRange: STEPS.map((t) => 0.7 + 0.35 * (1 + Math.sin(angle(t))) / 2) });
  const opacity = progress.interpolate({ inputRange: STEPS, outputRange: STEPS.map((t) => 0.45 + 0.55 * (1 + Math.sin(angle(t))) / 2) });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        left: '50%',
        top: '50%',
        borderRadius: size / 2,
        backgroundColor: color,
        shadowColor: color,
        shadowOpacity: 0.9,
        shadowRadius: 8,
        elevation: 6,
        opacity,
        transform: [{ translateX: x }, { translateY: y }, { scale }],
      }}
    />
  );
}

function Ring({ rx, ry, tilt }: { rx: number; ry: number; tilt: string }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: '50%', top: '50%', width: rx * 2, height: rx * 2, marginLeft: -rx, marginTop: -rx, borderRadius: rx, borderWidth: 1, borderColor: 'rgba(165,140,255,0.35)', transform: [{ rotate: tilt }, { scaleY: ry / rx }] }}
    />
  );
}

export function OrbitHero({ remindersToday, checklistDone, checklistTotal, nextLabel }: { remindersToday: number; checklistDone: number; checklistTotal: number; nextLabel: string | null }) {
  const slow = useRef(new Animated.Value(0)).current;
  const mid = useRef(new Animated.Value(0)).current;
  const fast = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduced) return;
    const loops = [
      [slow, 24000],
      [mid, 15000],
      [fast, 9000],
    ].map(([v, ms]) => Animated.loop(Animated.timing(v as Animated.Value, { toValue: 1, duration: ms as number, easing: Easing.linear, useNativeDriver: true })));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduced, slow, mid, fast]);

  // Little background stars, placed once.
  const stars = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, o: 0.15 + ((i * 7) % 10) / 30 })), []);

  return (
    <View accessibilityRole="summary" accessibilityLabel={`${remindersToday} reminders today. Checklist ${checklistDone} of ${checklistTotal} done.${nextLabel ? ` Next: ${nextLabel}.` : ''}`} style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <LinearGradient colors={['#121E47', '#0A1230']} style={{ height: 190 }}>
        {stars.map((s, i) => (
          <View key={i} style={{ position: 'absolute', left: s.left as `${number}%`, top: s.top as `${number}%`, width: 2, height: 2, borderRadius: 1, backgroundColor: '#fff', opacity: s.o }} />
        ))}
        <Ring rx={130} ry={34} tilt="-10deg" />
        <Ring rx={92} ry={26} tilt="8deg" />
        {/* Core */}
        <View style={{ position: 'absolute', left: '50%', top: '50%', width: 64, height: 64, marginLeft: -32, marginTop: -32, borderRadius: 32, backgroundColor: 'rgba(96,233,255,0.18)' }} />
        <LinearGradient colors={['#B6F6FF', '#60E9FF', '#3B7BFF']} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.9, y: 0.9 }} style={{ position: 'absolute', left: '50%', top: '50%', width: 40, height: 40, marginLeft: -20, marginTop: -20, borderRadius: 20 }} />
        <Planet progress={slow} rx={130} ry={34} size={14} color={colors.violet} phase={0.1} />
        <Planet progress={mid} rx={92} ry={26} size={12} color={colors.amber} phase={0.55} />
        <Planet progress={fast} rx={110} ry={30} size={9} color={colors.success} phase={0.3} />
      </LinearGradient>
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(17,28,62,0.85)', paddingVertical: 10, paddingHorizontal: 12, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.cyan, fontSize: 18, fontWeight: '800' }}>{remindersToday}</Text>
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>reminders today</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.amber, fontSize: 18, fontWeight: '800' }}>
            {checklistDone}/{checklistTotal}
          </Text>
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>checklist done</Text>
        </View>
        <View style={{ flex: 1.6 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
            {nextLabel ?? 'Nothing coming up'}
          </Text>
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>next reminder</Text>
        </View>
      </View>
    </View>
  );
}
