import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { HistoryTransaction } from '../../types';

interface Props { item: HistoryTransaction; onPress: () => void }

export function ExpenseRow({ item, onPress }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const isSettlement = item.type === 'settlement';
  return (
    <TouchableOpacity onPress={onPress} style={[s.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, padding: spacing[16], marginBottom: spacing[8] }]}>
      <View style={[s.icon, { backgroundColor: isSettlement ? colors.owed + '20' : colors.primary + '20', borderRadius: radius.chip }]}>
        <Text style={{ fontSize: 18 }}>{isSettlement ? '✅' : '💳'}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: spacing[12] }}>
        <Text style={[typography.h3, { color: colors.textPrimary }]} numberOfLines={1}>{item.description ?? 'Settlement'}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>{item.payerName} · {new Date(item.date).toLocaleDateString()}</Text>
      </View>
      <Text style={[typography.currencyInline, { color: isSettlement ? colors.owed : colors.textPrimary }]}>
        ${item.amount.toFixed(2)}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
