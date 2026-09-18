import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type AppEnvironment = 'development' | 'staging' | 'production';

// Detect development host LAN IP dynamically from Expo packager
function getDevelopmentHost(): string {
  // If running in Expo Go or Dev Client, hostUri contains the computer's LAN IP (e.g., 192.168.1.15:8081)
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip) {
      return `http://${ip}:3000`;
    }
  }

  // Fallbacks for emulators
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000'; // Android emulator localhost alias
  }

  return 'http://localhost:3000'; // iOS simulator or web
}

const ENV: AppEnvironment = __DEV__ ? 'development' : 'production';

export const Config = {
  APP_ENV: ENV,
  API_BASE_URL: process.env.EXPO_PUBLIC_API_URL || getDevelopmentHost(),
  API_TIMEOUT_MS: 15000,
  APP_NAME: 'T_SHOP Mobile POS',
  APP_VERSION: '1.0.0',
  CACHE_MAX_AGE_MS: 5 * 60 * 1000, // 5 minutes
};

export default Config;
