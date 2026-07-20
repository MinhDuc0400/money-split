import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme/useTheme';
import { BalanceBadge } from './BalanceBadge';
import { Group } from '../../types';

interface Props {
  group: Group;
  balance: number;
  onPress: () => void;
}

export function GroupRow({ group, balance, onPress }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        s.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.card,
          padding: spacing[16],
          marginBottom: spacing[8],
        },
      ]}
    >
      <View style={[s.avatar, { backgroundColor: colors.primary + '20', borderRadius: radius.card }]}>
        <Text style={{ fontSize: 20 }}>👥</Text>
      </View>
      <View style={{ flex: 1, marginLeft: spacing[12] }}>
        <Text style={[typography.h3, { color: colors.textPrimary }]} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          {group.members.length} members · {group.currency}
        </Text>
      </View>
      <BalanceBadge amount={balance} />
      <ChevronRight size={16} color={colors.textDisabled} style={{ marginLeft: spacing[4] }} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
