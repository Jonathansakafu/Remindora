import { aboutApp, creator } from '@remindora/ui/about';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Glass, Screen, SectionLabel } from '../src/components/ui';
import { colors } from '../src/lib/theme';
import { useSystemBottom } from '../src/lib/layout';

export default function About() {
  const systemBottom = useSystemBottom();
  const c = creator.contact;
  const channels = [
    { label: 'Email', value: c.email, url: `mailto:${c.email}` },
    { label: 'WhatsApp', value: c.whatsapp, url: `https://wa.me/${c.whatsapp.replace(/[^\d]/g, '')}` },
    { label: 'LinkedIn', value: 'jonathan-sakafu', url: c.linkedin },
    { label: 'GitHub', value: 'jonathansakafu', url: c.github },
    { label: 'Portfolio', value: 'View portfolio', url: c.portfolio },
  ];
  return (
    <Screen title="About" right={<Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={{ color: colors.cyan }}>Done</Text></Pressable>}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 + systemBottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Image source={require('../assets/images/icon.png')} style={{ width: 60, height: 60, borderRadius: 14 }} accessible={false} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{aboutApp.name}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>Version 0.1.0</Text>
          </View>
        </View>
        <Text style={{ color: colors.textMuted, marginTop: 12, lineHeight: 20 }}>{aboutApp.summary}</Text>

        <SectionLabel color={colors.violet}>Built by</SectionLabel>
        <Glass>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>{creator.name}</Text>
          <Text style={{ color: colors.cyan, marginTop: 2 }}>{creator.role}</Text>
          <Text style={{ color: colors.textMuted, marginTop: 10, lineHeight: 20 }}>{creator.bio}</Text>
          <Text style={{ color: colors.text, marginTop: 8, lineHeight: 20 }}>{creator.philosophy}</Text>
          {creator.highlights.map((h) => (
            <View key={h.title} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{h.title}</Text>
              <Text style={{ color: colors.textMuted, lineHeight: 19 }}>{h.text}</Text>
            </View>
          ))}
        </Glass>

        <SectionLabel>Skills</SectionLabel>
        <Glass>
          {creator.skills.map((g) => (
            <View key={g.category} style={{ marginBottom: 8 }}>
              <Text style={{ color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{g.category.toUpperCase()}</Text>
              <Text style={{ color: colors.text, marginTop: 2 }}>{g.items.join(' · ')}</Text>
            </View>
          ))}
        </Glass>

        <SectionLabel>Other projects</SectionLabel>
        <Glass>
          {creator.projects.map((p) => (
            <Pressable key={p.name} onPress={() => Linking.openURL(p.url)} accessibilityRole="link" style={{ paddingVertical: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{p.name} ↗</Text>
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>{p.tagline}</Text>
            </Pressable>
          ))}
        </Glass>

        <SectionLabel>Get in touch</SectionLabel>
        <Glass>
          {channels.map((ch) => (
            <Pressable key={ch.label} onPress={() => Linking.openURL(ch.url)} accessibilityRole="link" accessibilityLabel={`${ch.label}: ${ch.value}`} style={{ flexDirection: 'row', paddingVertical: 10 }}>
              <Text style={{ color: colors.textFaint, width: 90 }}>{ch.label}</Text>
              <Text style={{ color: colors.cyan, flex: 1 }}>{ch.value}</Text>
            </Pressable>
          ))}
        </Glass>
      </ScrollView>
    </Screen>
  );
}
