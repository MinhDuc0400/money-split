import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useAppDispatch } from '../../src/store/hooks';
import { setCredentials } from '../../src/store/slices/authSlice';
import { saveToken, decodeJwtPayload } from '../../src/lib/auth';
import { useTheme } from '../../src/theme/useTheme';

export default function AuthCallback() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { colors } = useTheme();
  const url = Linking.useURL();

  useEffect(() => {
    if (!url) return;
    const { queryParams } = Linking.parse(url);
    const token = queryParams?.token as string | undefined;
    if (!token) {
      router.replace('/login');
      return;
    }

    saveToken(token).then(() => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace('/(tabs)' as any);
    });
  }, [url]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}
