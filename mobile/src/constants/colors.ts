// T_SHOP Mobile Color Tokens - Aligned with Web Design System
export const Colors = {
  // Brand & Primary
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primarySubtle: '#eff6ff',
  primaryLight: '#eff6ff',
  primaryBorder: '#bfdbfe',

  // Status & Feedback
  success: '#16a34a',
  successSubtle: '#f0fdf4',
  successBorder: '#bbf7d0',

  warning: '#d97706',
  warningSubtle: '#fffbeb',
  warningBorder: '#fde68a',

  danger: '#dc2626',
  dangerSubtle: '#fef2f2',
  dangerBorder: '#fecaca',

  // Neutrals & Surfaces
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  card: '#ffffff',

  // Borders
  border: '#e2e8f0',
  borderSubtle: '#e2e8f0',
  borderStrong: '#cbd5e1',

  // Typography
  text: '#0f172a',
  textPrimary: '#0f172a',
  textSecondary: '#64748b',
  textMain: '#0f172a',
  textMuted: '#64748b',
  textSubtle: '#94a3b8',
  textInverse: '#ffffff',

  // Online / Offline Indicators
  offlineBannerBg: '#fff7ed',
  offlineBannerBorder: '#ffedd5',
  offlineBannerText: '#c2410c',

  onlineBannerBg: '#f0fdf4',
  onlineBannerBorder: '#dcfce7',
  onlineBannerText: '#15803d',
} as const;

export type ColorName = keyof typeof Colors;
export default Colors;
