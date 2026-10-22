import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

export function Screen({ children, title, subtitle, right }: { children: ReactNode; title?: string; subtitle?: string; right?: ReactNode }) {
  return (
    <LinearGradient colors={['#0B1330', '#070D22', '#070D22']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {title ? (
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} accessibilityRole="header">{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {right}
          </View>
        ) : null}
        {children}
      </SafeAreaView>
    </LinearGradient>
  );
}

export function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.glassWrap, style]}>
      <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassInner}>{children}</View>
    </View>
  );
}

export function Button({ label, onPress, variant = 'secondary', disabled, busy, accessibilityLabel }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; busy?: boolean; accessibilityLabel?: string }) {
  const bg = variant === 'primary' ? colors.cyan : variant === 'danger' ? 'rgba(255,122,147,0.15)' : variant === 'ghost' ? 'transparent' : 'rgba(17,28,62,0.8)';
  const fg = variant === 'primary' ? '#06122E' : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderColor: variant === 'secondary' ? colors.border : 'transparent' }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
      {body ? <Text style={{ color: colors.textMuted, marginTop: 6, textAlign: 'center' }}>{body}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  return <Text style={{ color: color ?? colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 18, marginBottom: 6, marginHorizontal: 20 }}>{children}</Text>;
}

export const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  glassWrap: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(17,28,62,0.55)' },
  glassInner: { padding: 14 },
  button: { minHeight: 46, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(11,19,48,0.8)', color: colors.text, paddingHorizontal: 14, fontSize: 16 },
});
