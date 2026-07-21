import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useAppDispatch } from '../src/store/hooks';
import { setCredentials } from '../src/store/slices/authSlice';
import { useTheme } from '../src/theme/useTheme';
import { startGoogleLogin, saveToken, decodeJwtPayload } from '../src/lib/auth';

export default function LoginScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const [loading, setLoading] = useState(false);
  const dispatch = useAppDispatch();
  const router = useRouter();

  async function handleGoogleLogin() {
    setLoading(true);
    try {
      const result = await startGoogleLogin();
      if (result.type !== 'success' || !result.url) return;
      const token = new URL(result.url).searchParams.get('token');
      if (!token) return;
      await saveToken(token);
      const payload = decodeJwtPayload(token);
      dispatch(setCredentials({
        token,
        user: {
          id: payload.sub as string,
          name: payload.name as string,
          email: payload.email as string,
          avatarUrl: (payload.avatarUrl as string | undefined) ?? null,
        },
      }));
      router.replace('/(tabs)' as any);
    } catch (e: any) {
      Alert.alert('Login error', e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, padding: spacing[16] }]}>
      <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card }]}>
        <View style={[s.logoBox, { backgroundColor: colors.primary + '20', borderRadius: radius.card }]}>
          <Text style={{ fontSize: 40 }}>💰</Text>
        </View>
        <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing[16] }]}>
          Split Money
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing[8], marginBottom: spacing[32] }]}>
          Track shared expenses with friends and family
        </Text>
        <TouchableOpacity
          onPress={handleGoogleLogin}
          disabled={loading}
          style={[s.btn, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.button }]}
        >
          {loading ? <ActivityIndicator color={colors.primary} /> : (
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Continue with Google</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  card: { padding: 24, alignItems: 'center', borderWidth: 1 },
  logoBox: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  btn: { width: '100%', height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
