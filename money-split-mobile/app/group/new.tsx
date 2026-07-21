import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/useTheme';
import { useAppDispatch } from '../../src/store/hooks';
import { fetchGroups } from '../../src/store/slices/groupSlice';
import { api } from '../../src/lib/api';
import { Group } from '../../src/types';

const CURRENCIES = ['USD', 'EUR', 'VND', 'GBP', 'SGD'];

export default function NewGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, typography, radius } = useTheme();
  const dispatch = useAppDispatch();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    setSaving(true);
    try {
      const group = await api.post<Group>('/groups', { name: name.trim(), currency });
      await dispatch(fetchGroups());
      router.replace(`/group/${group.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()}><ArrowLeft size={24} color={colors.textPrimary} /></TouchableOpacity>
          <Text style={[typography.h3, { color: colors.textPrimary }]}>New Group</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ padding: spacing[16] }}>
          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing[8], textTransform: 'uppercase' }]}>Group name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Weekend trip, Apartment, …" placeholderTextColor={colors.textDisabled}
            style={[s.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.chip }]} />
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing[20], marginBottom: spacing[8], textTransform: 'uppercase' }]}>Currency</Text>
          <View style={s.chips}>
            {CURRENCIES.map(c => (
              <TouchableOpacity key={c} onPress={() => setCurrency(c)}
                style={[s.chip, { backgroundColor: currency === c ? colors.primary : colors.surface, borderColor: currency === c ? colors.primary : colors.border, borderRadius: radius.chip }]}>
                <Text style={[typography.bodyMedium, { color: currency === c ? '#fff' : colors.textPrimary }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={handleCreate} disabled={saving}
            style={[{ backgroundColor: colors.primary, borderRadius: radius.button, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing[32] }]}>
            <Text style={[typography.bodyMedium, { color: '#fff' }]}>{saving ? 'Creating…' : 'Create Group'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/group/join')} style={{ marginTop: spacing[16], alignItems: 'center' }}>
            <Text style={[typography.body, { color: colors.primary }]}>Join with invite code instead</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5 },
  input: { borderWidth: 1, padding: 14, fontSize: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1 },
});
