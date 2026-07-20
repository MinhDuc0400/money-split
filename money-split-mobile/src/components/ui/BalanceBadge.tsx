import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface Props {
  amount: number;
}

export function BalanceBadge({ amount }: Props) {
  const { colors, typography, spacing } = useTheme();
  if (amount === 0) {
    return <Text style={[typography.caption, { color: colors.settled }]}>Settled</Text>;
  }
  const color = amount > 0 ? colors.owed : colors.owes;
  const label = amount > 0 ? `+$${amount.toFixed(2)}` : `-$${Math.abs(amount).toFixed(2)}`;
  return (
    <View style={[s.badge, { backgroundColor: color + '20', paddingHorizontal: spacing[8], paddingVertical: spacing[4] }]}>
      <Text style={[typography.currencyInline, { color }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({ badge: { borderRadius: 20 } });
