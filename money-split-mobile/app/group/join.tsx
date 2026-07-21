import { View, Text, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/useTheme';
import { useAppDispatch } from '../../src/store/hooks';
import { fetchGroups } from '../../src/store/slices/groupSlice';
import { api } from '../../src/lib/api';
import { Group } from '../../src/types';

export default function JoinGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, spacing, typography, radius } = useTheme();
  const dispatch = useAppDispatch();
  const [code, setCode] = useState(params.code ?? '');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (code.trim().length !== 8) { Alert.alert('Enter the 8-character invite code'); return; }
    setLoading(true);
    try {
      const group = await api.post<Group>('/groups/join', { inviteCode: code.trim().toUpperCase() });
      await dispatch(fetchGroups());
      router.replace(`/group/${group.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()}><ArrowLeft size={24} color={colors.textPrimary} /></TouchableOpacity>
          <Text style={[typography.h3, { color: colors.textPrimary }]}>Join Group</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ padding: spacing[16] }}>
          <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing[20] }]}>
            Enter the 8-character invite code shared by the group owner.
          </Text>
          <TextInput value={code} onChangeText={t => setCode(t.toUpperCase())} placeholder="ABCD1234"
            autoCapitalize="characters" maxLength={8} autoFocus
            placeholderTextColor={colors.textDisabled}
            style={[s.codeInput, { color: colors.textPrimary, borderColor: colors.primary, backgroundColor: colors.surface, borderRadius: radius.chip }]} />
          <TouchableOpacity onPress={handleJoin} disabled={loading}
            style={[{ backgroundColor: colors.primary, borderRadius: radius.button, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing[24] }]}>
            <Text style={[typography.bodyMedium, { color: '#fff' }]}>{loading ? 'Joining…' : 'Join Group'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5 },
  codeInput: { borderWidth: 2, padding: 16, fontSize: 28, textAlign: 'center', letterSpacing: 6, fontWeight: '700' },
});
