export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const TypographyTokens = {
  fontSize: {
    xs: 11,
    sm: 13,
    md: 14,
    base: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },
} as const;

export const Typography = {
  fontSize: TypographyTokens.fontSize,
  fontWeight: TypographyTokens.fontWeight,
  lineHeight: TypographyTokens.lineHeight,

  titleLarge: {
    fontSize: TypographyTokens.fontSize.xxl,
    fontWeight: TypographyTokens.fontWeight.bold,
  },
  titleMedium: {
    fontSize: TypographyTokens.fontSize.xl,
    fontWeight: TypographyTokens.fontWeight.semibold,
  },
  titleSmall: {
    fontSize: TypographyTokens.fontSize.lg,
    fontWeight: TypographyTokens.fontWeight.semibold,
  },
  bodyLarge: {
    fontSize: TypographyTokens.fontSize.base,
    fontWeight: TypographyTokens.fontWeight.regular,
  },
  bodyMedium: {
    fontSize: TypographyTokens.fontSize.md,
    fontWeight: TypographyTokens.fontWeight.regular,
  },
  bodySmall: {
    fontSize: TypographyTokens.fontSize.sm,
    fontWeight: TypographyTokens.fontWeight.regular,
  },
  bodySm: {
    fontSize: TypographyTokens.fontSize.sm,
    fontWeight: TypographyTokens.fontWeight.regular,
  },
  caption: {
    fontSize: TypographyTokens.fontSize.xs,
    fontWeight: TypographyTokens.fontWeight.medium,
  },
} as const;

export const BorderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
} as const;

export default {
  Spacing,
  Typography,
  TypographyTokens,
  BorderRadius,
  Shadows,
};
