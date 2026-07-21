import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Control, Controller, useWatch } from 'react-hook-form';
import { useTheme } from '../../theme/useTheme';
import { GroupMember, SplitType } from '../../types';
import { ExpenseFormData } from './types';

const SPLIT_TYPES: { key: SplitType; label: string }[] = [
  { key: 'EQUAL', label: 'Equal' },
  { key: 'EXACT', label: 'Exact $' },
  { key: 'PERCENTAGE', label: '%' },
  { key: 'SHARES', label: 'Shares' },
];

interface Props {
  control: Control<ExpenseFormData>;
  members: GroupMember[];
}

export function StepSplit({ control, members }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const splitType = useWatch({ control, name: 'splitType' });

  const fieldFor = (t: SplitType): 'amount' | 'percentage' | 'share' | null => {
    if (t === 'EXACT') return 'amount';
    if (t === 'PERCENTAGE') return 'percentage';
    if (t === 'SHARES') return 'share';
    return null;
  };
  const activeField = fieldFor(splitType);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing[16] }}>
      <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing[8], textTransform: 'uppercase' }]}>Paid by</Text>
      <Controller
        control={control}
        name="payerId"
        render={({ field: { value, onChange } }) => (
          <View style={s.memberRow}>
            {members.filter(m => m.userId).map(m => (
              <TouchableOpacity
                key={m.id}
                onPress={() => onChange(m.id)}
                style={[s.memberChip, { backgroundColor: value === m.id ? colors.primary : colors.surface, borderColor: value === m.id ? colors.primary : colors.border, borderRadius: radius.chip }]}
              >
                <Text style={[typography.caption, { color: value === m.id ? '#fff' : colors.textPrimary }]}>{m.name.split(' ')[0]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />

      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing[20], marginBottom: spacing[8], textTransform: 'uppercase' }]}>Split type</Text>
      <Controller
        control={control}
        name="splitType"
        render={({ field: { value, onChange } }) => (
          <View style={s.splitRow}>
            {SPLIT_TYPES.map(t => (
              <TouchableOpacity
                key={t.key}
                onPress={() => onChange(t.key)}
                style={[s.splitChip, { backgroundColor: value === t.key ? colors.primary : colors.surface, borderColor: value === t.key ? colors.primary : colors.border, borderRadius: radius.chip }]}
              >
                <Text style={[typography.caption, { color: value === t.key ? '#fff' : colors.textPrimary }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />

      {activeField && (
        <View style={{ marginTop: spacing[20] }}>
          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing[8], textTransform: 'uppercase' }]}>
            {splitType === 'EXACT' ? 'Exact amounts' : splitType === 'PERCENTAGE' ? 'Percentages' : 'Shares'}
          </Text>
          {members.map((m, index) => (
            <View key={m.id} style={[s.inputRow, { borderColor: colors.border }]}>
              <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>{m.name}</Text>
              <Controller
                control={control}
                name={`splits.${index}.${activeField}` as const}
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value ?? ''}
                    onChangeText={onChange}
                    keyboardType="decimal-pad"
                    placeholder={splitType === 'SHARES' ? '1' : '0'}
                    placeholderTextColor={colors.textDisabled}
                    style={[s.memberInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.chip, fontVariant: ['tabular-nums'] }]}
                  />
                )}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberChip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  splitRow: { flexDirection: 'row', gap: 8 },
  splitChip: { flex: 1, paddingVertical: 10, alignItems: 'center', borderWidth: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5 },
  memberInput: { width: 90, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, textAlign: 'right' },
});
