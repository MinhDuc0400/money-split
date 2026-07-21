import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SettlementSuggestion } from '../../types';

interface Props {
  suggestions: SettlementSuggestion[];
  onSettle: (suggestion: SettlementSuggestion) => void;
  myMemberId: string;
}

export function SettlementList({ suggestions, onSettle, myMemberId }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  if (!suggestions.length) return (
    <View style={{ padding: spacing[32], alignItems: 'center' }}>
      <Text style={{ fontSize: 40 }}>🎉</Text>
      <Text style={[typography.h3, { color: colors.textPrimary, marginTop: spacing[12], textAlign: 'center' }]}>All settled up!</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing[8], textAlign: 'center' }]}>Nothing left to pay.</Text>
    </View>
  );

  return (
    <View>
      {suggestions.map((s, i) => {
        const isMe = s.from.memberId === myMemberId;
        return (
          <View key={i} style={[style.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, padding: spacing[16], marginBottom: spacing[8] }]}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.h3, { color: colors.textPrimary }]}>
                {isMe ? 'You' : s.from.name} → {s.to.name}
              </Text>
              <Text style={[typography.currencyInline, { color: colors.owes, marginTop: 4 }]}>${s.amount.toFixed(2)}</Text>
            </View>
            {isMe && (
              <TouchableOpacity onPress={() => onSettle(s)}
                style={[{ backgroundColor: colors.accent, borderRadius: radius.button, paddingHorizontal: spacing[16], paddingVertical: spacing[8] }]}>
                <Text style={[typography.bodyMedium, { color: '#fff' }]}>Pay</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

const style = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 } });
