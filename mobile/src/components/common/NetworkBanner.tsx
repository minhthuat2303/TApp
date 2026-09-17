import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNetwork } from '../../network/NetworkContext';
import { Colors } from '../../constants/colors';
import { Spacing, Typography } from '../../constants/layout';

export const NetworkBanner: React.FC = () => {
  const { isOnline, isServerReachable, recheckServer } = useNetwork();

  if (isOnline && isServerReachable) {
    return null; // Fully online & server connected, no banner needed
  }

  const isOffline = !isOnline;
  const isServerDown = isOnline && !isServerReachable;

  return (
    <View
      style={[
        styles.banner,
        isOffline ? styles.offlineBanner : styles.serverDownBanner,
      ]}
    >
      <View style={styles.textWrapper}>
        <View
          style={[
            styles.dot,
            isOffline ? styles.dotOffline : styles.dotWarning,
          ]}
        />
        <Text
          style={[
            styles.text,
            isOffline ? styles.textOffline : styles.textWarning,
          ]}
        >
          {isOffline
            ? 'Chế độ ngoại tuyến (Offline POS) • Dữ liệu lưu cục bộ'
            : 'Đang kết nối lại máy chủ...'}
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => recheckServer()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[styles.retryText, isOffline ? styles.textOffline : styles.textWarning]}>
          Kiểm tra
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
  },
  offlineBanner: {
    backgroundColor: Colors.offlineBannerBg,
    borderBottomColor: Colors.offlineBannerBorder,
  },
  serverDownBanner: {
    backgroundColor: Colors.warningSubtle,
    borderBottomColor: Colors.warningBorder,
  },
  textWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  dotOffline: {
    backgroundColor: Colors.warning,
  },
  dotWarning: {
    backgroundColor: Colors.warning,
  },
  text: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.medium,
  },
  textOffline: {
    color: Colors.offlineBannerText,
  },
  textWarning: {
    color: Colors.warning,
  },
  retryText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.bold,
    textDecorationLine: 'underline',
  },
});

export default NetworkBanner;
