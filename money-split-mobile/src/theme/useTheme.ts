import { useColorScheme } from 'react-native';
import { lightColors, darkColors, spacing, radius, typography, ThemeColors } from './tokens';

export function useTheme() {
  const scheme = useColorScheme();
  const colors: ThemeColors = scheme === 'dark' ? darkColors : lightColors;
  return { colors, spacing, radius, typography };
}
