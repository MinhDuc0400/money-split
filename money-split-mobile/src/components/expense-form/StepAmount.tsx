import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Control, Controller } from 'react-hook-form';
import { useTheme } from '../../theme/useTheme';
import { NumericKeypad } from './NumericKeypad';
import { ExpenseFormData } from './types';

interface Props {
  control: Control<ExpenseFormData>;
}

export function StepAmount({ control }: Props) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Controller
        control={control}
        name="amount"
        render={({ field: { value, onChange } }) => (
          <>
            <View style={[s.amountBox, { paddingVertical: spacing[24] }]}>
              <Text style={[typography.display, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>
                <Text style={{ color: colors.textSecondary }}>$</Text>
                {value || '0'}
              </Text>
            </View>
            <NumericKeypad value={value} onChange={onChange} />
          </>
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field: { value, onChange, onBlur } }) => (
          <TextInput
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="What's this for?"
            placeholderTextColor={colors.textDisabled}
            style={[s.descInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface }]}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  amountBox: { alignItems: 'center' },
  descInput: { marginHorizontal: 16, marginTop: 16, padding: 14, borderWidth: 1, borderRadius: 10, fontSize: 15 },
});
