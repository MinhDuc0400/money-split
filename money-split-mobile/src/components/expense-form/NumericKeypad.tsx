import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export function NumericKeypad({ value, onChange }: Props) {
  const { colors, typography } = useTheme();

  function press(key: string) {
    if (key === '⌫') {
      onChange(value.slice(0, -1) || '0');
      return;
    }
    if (key === '.' && value.includes('.')) return;
    if (value === '0' && key !== '.') {
      onChange(key);
      return;
    }
    const next = value + key;
    const parts = next.split('.');
    if (parts[1] && parts[1].length > 2) return;
    onChange(next);
  }

  return (
    <View style={s.grid}>
      {KEYS.map(k => (
        <TouchableOpacity
          key={k}
          onPress={() => press(k)}
          style={[s.key, { backgroundColor: colors.surface }]}
        >
          <Text style={[typography.h2, { color: k === '⌫' ? colors.owes : colors.textPrimary }]}>{k}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  key: { width: '33.33%', height: 60, alignItems: 'center', justifyContent: 'center' },
});
