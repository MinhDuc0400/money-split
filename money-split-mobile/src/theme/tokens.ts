export const lightColors = {
  primary: '#3D5AFE',
  primaryDark: '#2540C9',
  accent: '#00BFA6',
  owed: '#12A454',
  owes: '#E5484D',
  settled: '#8A93A6',
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#E4E7EC',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textDisabled: '#C1C7D0',
  error: '#E5484D',
} as const;

export const darkColors = {
  primary: '#7C93FF',
  primaryDark: '#5A75E0',
  accent: '#3ED9C0',
  owed: '#4ADE80',
  owes: '#F87171',
  settled: '#9CA6BC',
  background: '#0F1218',
  surface: '#1A1F29',
  surfaceRaised: '#232937',
  border: '#2A3142',
  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textDisabled: '#4B5563',
  error: '#F87171',
} as const;

export type ThemeColors = {
  [K in keyof typeof lightColors]: string;
};

export const spacing = { 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64 } as const;
export const radius = { chip: 8, card: 12, button: 10, sheet: 20 } as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const },
  h1: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  h2: { fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  h3: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '500' as const },
  currencyLarge: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as const },
  currencyInline: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as const },
};
