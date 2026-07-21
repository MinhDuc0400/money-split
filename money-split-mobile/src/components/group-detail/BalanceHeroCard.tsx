import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface Props { myBalance: number }

export function BalanceHeroCard({ myBalance }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const isOwed = myBalance > 0;
  const bgColor = myBalance === 0 ? colors.settled : isOwed ? colors.owed : colors.owes;
  const label = myBalance === 0 ? 'All settled up 🎉' : isOwed ? 'You are owed' : 'You owe';
  const amount = `$${Math.abs(myBalance).toFixed(2)}`;

  return (
    <View style={[s.card, { backgroundColor: bgColor, borderRadius: radius.card, padding: spacing[20], margin: spacing[16] }]}>
      <Text style={[typography.caption, { color: '#fff', opacity: 0.85 }]}>{label}</Text>
      {myBalance !== 0 && (
        <Text style={[typography.currencyLarge, { color: '#fff', marginTop: spacing[4] }]}>{amount}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({ card: {} });
