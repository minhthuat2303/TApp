import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Colors } from '../../constants/colors';
import { Spacing, BorderRadius, Typography } from '../../constants/layout';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'primary' | 'neutral';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'neutral',
  style,
  textStyle,
}) => {
  return (
    <View style={[styles.badge, styles[variant], style]}>
      <Text style={[styles.text, styles[`text_${variant}`], textStyle]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  success: {
    backgroundColor: Colors.successSubtle,
    borderColor: Colors.successBorder,
  },
  warning: {
    backgroundColor: Colors.warningSubtle,
    borderColor: Colors.warningBorder,
  },
  danger: {
    backgroundColor: Colors.dangerSubtle,
    borderColor: Colors.dangerBorder,
  },
  primary: {
    backgroundColor: Colors.primarySubtle,
    borderColor: Colors.primaryBorder,
  },
  neutral: {
    backgroundColor: Colors.surfaceAlt,
    borderColor: Colors.borderSubtle,
  },

  text: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
  },
  text_success: {
    color: Colors.success,
  },
  text_warning: {
    color: Colors.warning,
  },
  text_danger: {
    color: Colors.danger,
  },
  text_primary: {
    color: Colors.primary,
  },
  text_neutral: {
    color: Colors.textMuted,
  },
});

export default Badge;
