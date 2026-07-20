import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../src/theme/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '../../src/store/hooks';
import { logout } from '../../src/store/slices/authSlice';
import { clearToken } from '../../src/lib/auth';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const router = useRouter();
  const user = useAppSelector((s) => s.auth.user);

  async function handleLogout() {
    await clearToken();
    dispatch(logout());
    router.replace('/login');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + spacing[16], paddingHorizontal: spacing[16] }}>
      <Text style={[typography.h1, { color: colors.textPrimary }]}>Profile</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing[8] }]}>{user?.name}</Text>
      <TouchableOpacity
        onPress={handleLogout}
        style={{ marginTop: spacing[32], padding: spacing[16], backgroundColor: colors.owes + '20', borderRadius: radius.button }}
      >
        <Text style={[typography.bodyMedium, { color: colors.owes, textAlign: 'center' }]}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}
