import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NetworkProvider } from './src/network/NetworkContext';
import { AuthProvider } from './src/auth/AuthContext';
import { SyncProvider } from './src/sync/SyncContext';
import RootNavigator from './src/navigation/RootNavigator';
import databaseService from './src/database/DatabaseService';
import seedLocalData from './src/database/seed';
import Colors from './src/constants/colors';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import logger from './src/utils/logger';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    async function initDatabase() {
      try {
        logger.info('App', 'Starting database initialization...');
        await databaseService.initialize();
        await seedLocalData(databaseService);
        setDbReady(true);
      } catch (err: any) {
        logger.error('App', 'Failed to initialize SQLite database', err);
        setInitError(err?.message || 'Lỗi khởi tạo cơ sở dữ liệu cục bộ');
      }
    }

    initDatabase();
  }, []);

  if (initError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Lỗi khởi tạo Local Database</Text>
        <Text style={styles.errorSubtitle}>{initError}</Text>
      </View>
    );
  }

  if (!dbReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Đang chuẩn bị cơ sở dữ liệu SQLite...</Text>
      </View>
    );
  }

  const isWeb = Platform.OS === 'web';

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={isWeb ? styles.webOuterContainer : styles.nativeContainer}>
        <View style={isWeb ? styles.webAppWrapper : styles.nativeContainer}>
          <NetworkProvider>
            <AuthProvider>
              <SyncProvider>
                <ErrorBoundary>
                  <RootNavigator />
                </ErrorBoundary>
              </SyncProvider>
            </AuthProvider>
          </NetworkProvider>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.danger,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  nativeContainer: {
    flex: 1,
  },
  webOuterContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webAppWrapper: {
    width: '100%',
    maxWidth: 440,
    height: '100%',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
});
