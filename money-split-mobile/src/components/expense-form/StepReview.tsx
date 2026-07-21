import { View, Text, StyleSheet } from 'react-native';
import { useWatch, Control } from 'react-hook-form';
import { useTheme } from '../../theme/useTheme';
import { GroupMember } from '../../types';
import { ExpenseFormData } from './types';

interface Props {
  control: Control<ExpenseFormData>;
  members: GroupMember[];
}

const SPLIT_LABELS: Record<string, string> = {
  EQUAL: 'Split equally',
  EXACT: 'Split by exact amounts',
  PERCENTAGE: 'Split by percentage',
  SHARES: 'Split by shares',
};

export function StepReview({ control, members }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { amount, description, payerId, splitType } = useWatch({ control });
  const payer = members.find(m => m.id === payerId);
  const memberCount = members.length;
  const perPerson = memberCount ? (parseFloat(amount || '0') / memberCount).toFixed(2) : '0.00';

  return (
    <View style={{ flex: 1, padding: spacing[16] }}>
      <Text style={[typography.h2, { color: colors.textPrimary, marginBottom: spacing[24], textAlign: 'center' }]}>Review</Text>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Description</Text>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{description || '—'}</Text>
      </View>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Amount</Text>
        <Text style={[typography.currencyInline, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>${parseFloat(amount || '0').toFixed(2)}</Text>
      </View>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Paid by</Text>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{payer?.name ?? '—'}</Text>
      </View>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Split</Text>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
          {splitType === 'EQUAL'
            ? `${SPLIT_LABELS.EQUAL} ($${perPerson}/person)`
            : SPLIT_LABELS[splitType ?? 'EQUAL']}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 0.5 },
});
