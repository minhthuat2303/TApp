import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView, 
  TouchableOpacity 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Card from '../../components/common/Card';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';

export const LoginScreen: React.FC = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const { login, isLoading } = useAuth();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }

    setError(null);
    try {
      await login({ username: username.trim(), password: password.trim() });
    } catch (err: any) {
      setError(err.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.');
    }
  };

  const handleSetDemo = (role: 'admin' | 'staff') => {
    if (role === 'admin') {
      setUsername('admin');
      setPassword('admin123');
    } else {
      setUsername('staff');
      setPassword('staff123');
    }
    setError(null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Brand Header */}
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoIcon}>🛍️</Text>
            </View>
            <Text style={styles.brandTitle}>T_SHOP RETAIL</Text>
            <Text style={styles.brandSubtitle}>Hệ thống Quản lý Bán Đồ Chơi Trẻ Em</Text>
          </View>

          {/* Form Card */}
          <Card style={styles.formCard}>
            <Text style={styles.cardTitle}>Đăng nhập thiết bị</Text>
            <Text style={styles.cardSubtitle}>
              Sử dụng tài khoản nhân viên hoặc quản trị viên
            </Text>

            <Input
              label="Tên đăng nhập"
              value={username}
              onChangeText={setUsername}
              placeholder="VD: admin hoặc staff"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Input
              label="Mật khẩu"
              value={password}
              onChangeText={setPassword}
              placeholder="Nhập mật khẩu"
              secureTextEntry
              autoCapitalize="none"
            />

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Button
              title="Đăng nhập"
              onPress={handleLogin}
              loading={isLoading}
              size="lg"
              style={styles.loginButton}
            />

            {/* Demo Quick Accounts */}
            <View style={styles.demoSection}>
              <Text style={styles.demoTitle}>Tài khoản thử nghiệm nhanh (1 chạm):</Text>
              <View style={styles.demoButtonsRow}>
                <TouchableOpacity
                  style={styles.demoBadge}
                  onPress={() => handleSetDemo('admin')}
                >
                  <Text style={styles.demoBadgeText}>👑 Admin (admin123)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.demoBadge}
                  onPress={() => handleSetDemo('staff')}
                >
                  <Text style={styles.demoBadgeText}>👤 Nhân viên (staff123)</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>

          <Text style={styles.footerNote}>
            Hỗ trợ Offline-First: Sau khi đăng nhập, bạn có thể bán hàng ngay cả khi mất kết nối mạng.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  logoIcon: {
    fontSize: 32,
  },
  brandTitle: {
    fontSize: Typography.fontSize.xxl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.textMain,
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  formCard: {
    padding: Spacing.lg,
  },
  cardTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.textMain,
    marginBottom: Spacing.xs,
  },
  cardSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.lg,
  },
  errorContainer: {
    backgroundColor: Colors.dangerSubtle,
    borderColor: Colors.dangerBorder,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.md,
  },
  errorText: {
    color: Colors.danger,
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.medium,
  },
  loginButton: {
    marginTop: Spacing.xs,
  },
  demoSection: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
  },
  demoTitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  demoButtonsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  demoBadge: {
    flex: 1,
    minWidth: 110,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
  },
  demoBadgeText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.textMain,
  },
  footerNote: {
    textAlign: 'center',
    fontSize: Typography.fontSize.xs,
    color: Colors.textSubtle,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
    lineHeight: 18,
  },
});

export default LoginScreen;
