import { View, Text } from 'react-native';
import { useTheme } from '../../src/theme/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ActivityScreen() {
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + spacing[16], paddingHorizontal: spacing[16] }}>
      <Text style={[typography.h1, { color: colors.textPrimary }]}>Activity</Text>
    </View>
  );
}
