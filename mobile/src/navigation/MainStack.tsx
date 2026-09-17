import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainStackParamList } from './types';
import DashboardScreen from '../screens/main/DashboardScreen';
import ProductsScreen from '../screens/main/ProductsScreen';
import SalesScreen from '../screens/main/SalesScreen';
import InventoryScreen from '../screens/main/InventoryScreen';
import ReportsScreen from '../screens/main/ReportsScreen';
import SettingsScreen from '../screens/main/SettingsScreen';
import ConflictCenterScreen from '../screens/main/ConflictCenterScreen';
import { Colors } from '../constants/colors';

const Stack = createNativeStackNavigator<MainStackParamList>();

export const MainStack: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="Dashboard"
      screenOptions={{
        headerStyle: {
          backgroundColor: Colors.surface,
        },
        headerTintColor: Colors.primary,
        headerTitleStyle: {
          color: Colors.textMain,
          fontWeight: '700',
        },
        headerShadowVisible: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen 
        name="Dashboard" 
        component={DashboardScreen} 
        options={{ headerShown: false }} 
      />
      <Stack.Screen 
        name="Products" 
        component={ProductsScreen} 
        options={{ title: 'Danh mục sản phẩm' }} 
      />
      <Stack.Screen 
        name="Sales" 
        component={SalesScreen} 
        options={{ title: 'Ghi nhận bán (POS)' }} 
      />
      <Stack.Screen 
        name="Inventory" 
        component={InventoryScreen} 
        options={{ title: 'Quản lý kho hàng' }} 
      />
      <Stack.Screen 
        name="Reports" 
        component={ReportsScreen} 
        options={{ title: 'Báo cáo bán hàng & Hiệu suất' }} 
      />
      <Stack.Screen 
        name="Settings" 
        component={SettingsScreen} 
        options={{ title: 'Cài đặt hệ thống' }} 
      />
      <Stack.Screen 
        name="ConflictCenter" 
        component={ConflictCenterScreen} 
        options={{ title: 'Xử lý xung đột & Đối soát' }} 
      />
    </Stack.Navigator>
  );
};

export default MainStack;
