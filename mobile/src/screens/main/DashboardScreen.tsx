// T_SHOP Mobile - Dashboard & Analytics Screen
// Real-time financial & inventory KPIs with period filtering and trend charts matching Web reference 100%

import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { useNetwork } from '../../network/NetworkContext';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import NetworkBanner from '../../components/common/NetworkBanner';
import { formatCurrency } from '../../utils/formatters';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';
import { useSync } from '../../sync';
import analyticsService from '../../services/AnalyticsService';
import { DatePeriod, DashboardSummaryData, RevenueProfitTrendItem } from '../../services/types';

type NavigationProp = NativeStackNavigationProp<MainStackParamList, 'Dashboard'>;

const PERIOD_TABS: Array<{ key: DatePeriod; label: string }> = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7days', label: '7 ngày' },
  { key: '30days', label: '30 ngày' },
  { key: 'this_month', label: 'Tháng này' },
];

export const DashboardScreen: React.FC = () => {
  const { user, deviceId, authStatus, revocationReason } = useAuth();
  const { isOnline } = useNetwork();
  const { syncStatus, pendingCount, conflictCount, isSyncing, triggerSync } = useSync();
  const navigation = useNavigation<NavigationProp>();

  const [selectedPeriod, setSelectedPeriod] = useState<DatePeriod>('this_month');
  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [todaySummary, setTodaySummary] = useState<DashboardSummaryData | null>(null);
  const [slowCount, setSlowCount] = useState<number>(0);
  const [lowStockItems, setLowStockItems] = useState<Array<{ id: number; name: string; sku: string; current_stock: number; min_stock_alert: number }>>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Vừa xong');
  const [trendData, setTrendData] = useState<RevenueProfitTrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (syncStatus === 'SYNCED') {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setLastSyncTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    }
  }, [syncStatus]);

  const loadDashboardData = async () => {
    try {
      const currentUserId = user?.role === 'ADMIN' ? undefined : user?.id;
      const [sum, trend, todaySum, slowList, lowList] = await Promise.all([
        analyticsService.getDashboardSummary(selectedPeriod, currentUserId),
        analyticsService.getRevenueProfitTrend(selectedPeriod, currentUserId),
        analyticsService.getDashboardSummary('today', currentUserId),
        analyticsService.getSlowMovingProducts(selectedPeriod, 50),
        analyticsService.getLowStockProducts(10),
      ]);

      setSummary(sum);
      setTrendData(trend);
      setTodaySummary(todaySum);
      setSlowCount(slowList.length);
      setLowStockItems((lowList || []).filter(item => item.current_stock <= item.min_stock_alert));
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedPeriod]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  const handleSyncNow = async () => {
    if (!isOnline) {
      setSyncFeedback('⚠️ Đang ngoại tuyến. Không thể kết nối máy chủ.');
      return;
    }
    try {
      setSyncFeedback('⏳ Đang đồng bộ dữ liệu với máy chủ...');
      await triggerSync();
      setSyncFeedback(`✅ Đã đồng bộ hoàn tất lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
      loadDashboardData();
    } catch (err: any) {
      setSyncFeedback(`❌ Lỗi đồng bộ: ${err?.message || 'Không thể kết nối máy chủ'}`);
    }
  };

  const getSyncBadge = () => {
    switch (syncStatus) {
      case 'SYNCING':
        return <Badge label="Đang đồng bộ..." variant="primary" />;
      case 'SYNCED':
        return <Badge label="Đã đồng bộ" variant="success" />;
      case 'PENDING':
        return <Badge label={`Còn ${pendingCount} chờ sync`} variant="warning" />;
      case 'CONFLICT':
        return <Badge label={`${conflictCount} xung đột`} variant="danger" />;
      case 'FAILED':
        return <Badge label="Lỗi đồng bộ" variant="danger" />;
      case 'OFFLINE':
      default:
        return <Badge label="Ngoại tuyến" variant="neutral" />;
    }
  };

  // Find max revenue for chart scaling
  const maxRevenue = Math.max(1, ...trendData.map((d) => d.revenue));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NetworkBanner />

      {/* Session Revocation / Expiry Warning Banner */}
      {authStatus !== 'AUTHENTICATED' && authStatus !== 'UNAUTHENTICATED' && (
        <View style={{ backgroundColor: Colors.danger, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
            ⚠️ {revocationReason || 'Phiên làm việc đã bị thu hồi hoặc hết hạn. Vui lòng vào Cài đặt để đăng nhập lại.'}
          </Text>
        </View>
      )}

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* User Header */}
        <View style={styles.userHeader}>
          <View>
            <Text style={styles.greeting}>Xin chào,</Text>
            <Text style={styles.userName}>{user?.full_name || 'Nhân viên T_SHOP'}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {deviceId && (
              <Badge 
                label={`📱 ${deviceId.slice(0, 6)}`} 
                variant="neutral" 
              />
            )}
            <Badge 
              label={user?.role === 'ADMIN' ? 'Quản Trị Viên' : 'Nhân Viên'} 
              variant={user?.role === 'ADMIN' ? 'primary' : 'neutral'} 
            />
          </View>
        </View>

        {/* System & Sync Status Panel hidden per user request */}

        {/* Task Center: CẦN XỬ LÝ (Section 7) */}
        {(pendingCount > 0 || conflictCount > 0 || (summary && summary.lowStockCount > 0) || slowCount > 0) && (
          <Card style={styles.taskCenterCard}>
            <View style={styles.taskCenterHeader}>
              <Text style={styles.taskCenterIcon}>📋</Text>
              <Text style={styles.taskCenterTitle}>CẦN XỬ LÝ</Text>
              <Badge 
                label={`${(pendingCount > 0 ? 1 : 0) + (conflictCount > 0 ? 1 : 0) + (summary && summary.lowStockCount > 0 ? 1 : 0) + (slowCount > 0 ? 1 : 0)} việc`} 
                variant="warning" 
              />
            </View>
            <View style={styles.taskList}>
              {pendingCount > 0 && (
                <TouchableOpacity 
                  style={styles.taskItem}
                  onPress={handleSyncNow}
                >
                  <Text style={styles.taskBullet}>⏳</Text>
                  <Text style={styles.taskText}>
                    <Text style={{ fontWeight: '700' }}>{pendingCount} giao dịch</Text> trong Outbox chờ đồng bộ lên máy chủ
                  </Text>
                  <Text style={styles.taskActionLink}>Gửi ngay ›</Text>
                </TouchableOpacity>
              )}
              {conflictCount > 0 && (
                <TouchableOpacity 
                  style={styles.taskItem}
                  onPress={() => navigation.navigate('ConflictCenter')}
                >
                  <Text style={styles.taskBullet}>⚠️</Text>
                  <Text style={[styles.taskText, { color: Colors.danger }]}>
                    <Text style={{ fontWeight: '700' }}>{conflictCount} giao dịch xung đột</Text> cần đối soát
                  </Text>
                  <Text style={[styles.taskActionLink, { color: Colors.danger }]}>Xử lý ›</Text>
                </TouchableOpacity>
              )}
              {summary && summary.lowStockCount > 0 && (
                <TouchableOpacity 
                  style={styles.taskItem}
                  onPress={() => navigation.navigate('Inventory')}
                >
                  <Text style={styles.taskBullet}>🚨</Text>
                  <Text style={styles.taskText}>
                    <Text style={{ fontWeight: '700' }}>{summary.lowStockCount} sản phẩm</Text> tồn kho dưới mức cảnh báo
                  </Text>
                  <Text style={styles.taskActionLink}>Kiểm kho ›</Text>
                </TouchableOpacity>
              )}
              {slowCount > 0 && (
                <TouchableOpacity 
                  style={styles.taskItem}
                  onPress={() => navigation.navigate('Reports')}
                >
                  <Text style={styles.taskBullet}>💤</Text>
                  <Text style={styles.taskText}>
                    <Text style={{ fontWeight: '700' }}>{slowCount} sản phẩm</Text> bán chậm / chưa phát sinh bán
                  </Text>
                  <Text style={styles.taskActionLink}>Báo cáo ›</Text>
                </TouchableOpacity>
              )}
            </View>
          </Card>
        )}

        {/* Quick Actions Grid (Section 6) */}
        <Card style={styles.quickActionCard}>
          <Text style={styles.cardSectionTitle}>Thao tác nhanh</Text>
          <View style={styles.quickGrid}>
            <TouchableOpacity 
              style={[styles.quickGridItem, { backgroundColor: '#EFF6FF' }]}
              onPress={() => navigation.navigate('Sales')}
            >
              <Text style={styles.quickGridIcon}>🛒</Text>
              <Text style={styles.quickGridLabel}>Bán hàng</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickGridItem, { backgroundColor: '#F0FDF4' }]}
              onPress={() => navigation.navigate('Sales')}
            >
              <Text style={styles.quickGridIcon}>📷</Text>
              <Text style={styles.quickGridLabel}>Quét mã</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickGridItem, { backgroundColor: '#FEF3C7' }]}
              onPress={() => navigation.navigate('Inventory')}
            >
              <Text style={styles.quickGridIcon}>📥</Text>
              <Text style={styles.quickGridLabel}>Nhập kho</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickGridItem, { backgroundColor: '#F3E8FF' }]}
              onPress={() => navigation.navigate('Inventory')}
            >
              <Text style={styles.quickGridIcon}>⚖️</Text>
              <Text style={styles.quickGridLabel}>Điều chỉnh tồn</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickGridItem, { backgroundColor: '#ECFDF5' }]}
              onPress={() => navigation.navigate('Reports')}
            >
              <Text style={styles.quickGridIcon}>📊</Text>
              <Text style={styles.quickGridLabel}>Báo cáo</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickGridItem, { backgroundColor: '#F1F5F9' }]}
              onPress={handleSyncNow}
            >
              <Text style={styles.quickGridIcon}>🔄</Text>
              <Text style={styles.quickGridLabel}>Đồng bộ ngay</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Daily Summary Card: TỔNG KẾT HÔM NAY (Section 10) */}
        {todaySummary && (
          <Card style={styles.todayCard}>
            <View style={styles.todayHeader}>
              <Text style={styles.todayTitle}>📅 Tổng kết hôm nay ({todaySummary.dateRange.startDate})</Text>
              <Badge label={`${todaySummary.salesCount} đơn hoàn thành`} variant="success" />
            </View>
            <View style={styles.todayGrid}>
              <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Doanh thu thuần</Text>
                <Text style={[styles.todayVal, { color: Colors.primary }]}>{formatCurrency(todaySummary.revenue)}</Text>
              </View>
              <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Lợi nhuận gộp</Text>
                <Text style={[styles.todayVal, { color: '#15803D' }]}>{formatCurrency(todaySummary.profit)}</Text>
              </View>
              <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Giá vốn (COGS)</Text>
                <Text style={styles.todayVal}>{formatCurrency(todaySummary.cogs)}</Text>
              </View>
              <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Số lượng bán</Text>
                <Text style={styles.todayVal}>{todaySummary.soldQuantity} món</Text>
              </View>
              <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Nhập kho</Text>
                <Text style={styles.todayVal}>{todaySummary.importsCount || 0} phiếu</Text>
              </View>
              <View style={styles.todayItem}>
                <Text style={styles.todayLabel}>Điều chỉnh tồn</Text>
                <Text style={styles.todayVal}>
                  {todaySummary.adjustmentsCount || 0} lượt{todaySummary.adjustmentsQuantity ? ` (${todaySummary.adjustmentsQuantity} cái)` : ''}
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* Period Selector Tabs */}
        <View style={styles.periodBar}>
          {PERIOD_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.periodBtn, selectedPeriod === tab.key && styles.periodBtnActive]}
              onPress={() => setSelectedPeriod(tab.key)}
            >
              <Text style={[styles.periodBtnText, selectedPeriod === tab.key && styles.periodBtnTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={{ marginTop: 8, fontSize: 12, color: Colors.textMuted }}>Đang tổng hợp số liệu từ SQLite...</Text>
          </View>
        ) : (
          <>
            {/* Primary KPI Grid */}
            <View style={styles.metricsGrid}>
              {/* Card 1: Doanh thu thuần */}
              <Card style={styles.metricCard}>
                <Text style={styles.metricLabel}>Doanh thu thuần</Text>
                <Text style={[styles.metricValue, { color: Colors.primary }]}>
                  {formatCurrency(summary?.revenue || 0)}
                </Text>
                <Text style={styles.metricSub}>{summary?.salesCount || 0} đơn ({summary?.soldQuantity || 0} món)</Text>
              </Card>

              {/* Card 2: Lợi nhuận gộp */}
              <Card style={styles.metricCard}>
                <Text style={styles.metricLabel}>Lợi nhuận gộp</Text>
                <Text style={[styles.metricValue, { color: '#15803D' }]}>
                  {formatCurrency(summary?.profit || 0)}
                </Text>
                <Text style={styles.metricSub}>
                  {summary && summary.revenue > 0
                    ? `Biên lãi: ${Math.round((summary.profit / summary.revenue) * 100)}%`
                    : 'Doanh thu - Giá vốn'}
                </Text>
              </Card>

              {/* Card 3: Giá vốn hàng bán */}
              <Card style={styles.metricCard}>
                <Text style={styles.metricLabel}>Giá vốn bán ra (COGS)</Text>
                <Text style={[styles.metricValue, { color: '#B45309' }]}>
                  {formatCurrency(summary?.cogs || 0)}
                </Text>
                <Text style={styles.metricSub}>Phân bổ FIFO theo lô</Text>
              </Card>

              {/* Card 4: Giá trị tồn kho */}
              <Card style={styles.metricCard}>
                <Text style={styles.metricLabel}>Tổng giá trị kho</Text>
                <Text style={styles.metricValue}>
                  {formatCurrency(summary?.stockValuation || 0)}
                </Text>
                <Text style={styles.metricSub}>{summary?.currentTotalStock || 0} cái trong kho</Text>
              </Card>
            </View>

            {/* Visual Revenue vs. Profit Trend Bar Chart */}
            <Card style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <Text style={styles.cardSectionTitle}>Biểu đồ doanh thu & lợi nhuận ({summary?.periodLabel})</Text>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.primary }]} />
                  <Text style={styles.legendText}>Doanh thu</Text>
                  <View style={[styles.legendDot, { backgroundColor: '#16A34A', marginLeft: 10 }]} />
                  <Text style={styles.legendText}>Lợi nhuận</Text>
                </View>
              </View>

              {trendData.length === 0 ? (
                <View style={styles.emptyChartBox}>
                  <Text style={styles.emptyChartText}>Chưa có phát sinh đơn hàng trong kỳ này.</Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartScroll}>
                  <View style={styles.barsContainer}>
                    {trendData.map((d, idx) => {
                      const revHeight = Math.max(8, Math.min(120, (d.revenue / maxRevenue) * 120));
                      const profitHeight = Math.max(4, Math.min(120, (d.profit / maxRevenue) * 120));

                      return (
                        <View key={idx} style={styles.barGroup}>
                          <View style={styles.barPillarContainer}>
                            {/* Revenue Bar */}
                            <View style={[styles.barPillar, { height: revHeight, backgroundColor: Colors.primary }]} />
                            {/* Profit Bar */}
                            <View style={[styles.barPillar, { height: profitHeight, backgroundColor: '#16A34A' }]} />
                          </View>
                          <Text style={styles.barLabel}>{d.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              )}
            </Card>

            {/* Low Stock Alert (Section 8) */}
            {lowStockItems.length > 0 && (
              <Card style={[styles.alertCard, { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }]}>
                <View style={styles.alertHeader}>
                  <Text style={styles.alertHeaderIcon}>🚨</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardSectionTitle, { color: '#991B1B', marginBottom: 2 }]}>
                      SẢN PHẨM TỒN KHO THẤP ({lowStockItems.length})
                    </Text>
                    <Text style={{ fontSize: 11, color: '#B91C1C' }}>
                      Các mặt hàng chạm hoặc dưới ngưỡng tối thiểu (Tồn kho ≤ Ngưỡng)
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => navigation.navigate('Inventory')}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.primary }}>Chi tiết ›</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 8, gap: 6 }}>
                  {lowStockItems.slice(0, 4).map((item) => (
                    <View key={item.id} style={styles.alertItemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.alertItemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.alertItemSku}>SKU: {item.sku}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.alertItemStock, { color: item.current_stock === 0 ? '#DC2626' : '#D97706' }]}>
                          Tồn: {item.current_stock}
                        </Text>
                        <Text style={styles.alertItemThreshold}>Ngưỡng: {item.min_stock_alert}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {/* Slow Moving / Dead Stock Alert (Section 9) */}
            {slowCount > 0 && (
              <Card style={[styles.alertCard, { borderColor: '#FED7AA', backgroundColor: '#FFFBEB' }]}>
                <View style={styles.alertHeader}>
                  <Text style={styles.alertHeaderIcon}>💤</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardSectionTitle, { color: '#9A3412', marginBottom: 2 }]}>
                      CẢNH BÁO BÁN CHẬM & TỒN ĐỌNG
                    </Text>
                    <Text style={{ fontSize: 11, color: '#C2410C' }}>
                      {slowCount} sản phẩm chưa phát sinh bán trong kỳ này ({summary?.periodLabel})
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => navigation.navigate('Reports')}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#EA580C' }}>Báo cáo ›</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            )}

            {/* Module Navigation Links */}
            <Card style={styles.navCard}>
              <Text style={styles.cardSectionTitle}>Phân hệ quản trị</Text>
              
              <TouchableOpacity
                style={styles.navRow}
                onPress={() => navigation.navigate('Products')}
              >
                <Text style={styles.navIcon}>🧸</Text>
                <Text style={styles.navTitle}>Danh mục sản phẩm</Text>
                <Text style={styles.navArrow}>›</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.navRow}
                onPress={() => navigation.navigate('Sales')}
              >
                <Text style={styles.navIcon}>🛒</Text>
                <Text style={styles.navTitle}>Màn hình thu ngân (POS)</Text>
                <Text style={styles.navArrow}>›</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.navRow}
                onPress={() => navigation.navigate('Inventory')}
              >
                <Text style={styles.navIcon}>📦</Text>
                <Text style={styles.navTitle}>Quản lý kho & Nhập hàng</Text>
                <Text style={styles.navArrow}>›</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.navRow}
                onPress={() => navigation.navigate('Reports')}
              >
                <Text style={styles.navIcon}>📈</Text>
                <Text style={styles.navTitle}>Báo cáo bán hàng & Hiệu suất</Text>
                <Text style={styles.navArrow}>›</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.navRow}
                onPress={() => navigation.navigate('ConflictCenter')}
              >
                <Text style={styles.navIcon}>🛡️</Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.navTitle}>Xử lý xung đột & Đối soát</Text>
                  {conflictCount > 0 && (
                    <Badge label={`${conflictCount} lỗi`} variant="danger" />
                  )}
                </View>
                <Text style={styles.navArrow}>›</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.navRow}
                onPress={() => navigation.navigate('Settings')}
              >
                <Text style={styles.navIcon}>⚙️</Text>
                <Text style={styles.navTitle}>Cài đặt hệ thống & Tài khoản</Text>
                <Text style={styles.navArrow}>›</Text>
              </TouchableOpacity>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
    paddingBottom: Spacing.xxl,
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  greeting: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
  },
  syncCard: {
    padding: Spacing.sm,
  },
  syncCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncIcon: {
    fontSize: 22,
  },
  syncTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  syncSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    lineHeight: 15,
  },
  periodBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    padding: 4,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    marginBottom: 4,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
  },
  periodBtnActive: {
    backgroundColor: Colors.primary,
  },
  periodBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  periodBtnTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    minWidth: '47%',
    padding: Spacing.sm,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 2,
  },
  metricSub: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  chartCard: {
    padding: Spacing.md,
    marginTop: 4,
  },
  chartHeader: {
    marginBottom: 10,
  },
  cardSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  emptyChartBox: {
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyChartText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  chartScroll: {
    marginTop: 6,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 140,
    paddingTop: 10,
    gap: 12,
  },
  barGroup: {
    alignItems: 'center',
    width: 32,
  },
  barPillarContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 120,
    gap: 2,
  },
  barPillar: {
    width: 10,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  barLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 4,
  },
  quickActionCard: {
    padding: Spacing.sm,
    marginTop: 4,
  },
  quickButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  syncNotice: {
    fontSize: 10,
    color: '#D97706',
    marginTop: 4,
    fontWeight: '500',
  },
  syncFeedbackText: {
    fontSize: 11,
    color: '#16A34A',
    marginTop: 4,
    fontWeight: '600',
  },
  taskCenterCard: {
    padding: Spacing.sm,
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  taskCenterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  taskCenterIcon: {
    fontSize: 16,
  },
  taskCenterTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#B45309',
    flex: 1,
  },
  taskList: {
    gap: 6,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 6,
  },
  taskBullet: {
    fontSize: 13,
  },
  taskText: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
  },
  taskActionLink: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  quickGridItem: {
    width: '30%',
    flexGrow: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  quickGridIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  quickGridLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
  },
  todayCard: {
    padding: Spacing.sm,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  todayTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  todayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  todayItem: {
    width: '30%',
    flexGrow: 1,
    padding: 6,
    backgroundColor: '#fff',
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  todayLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  todayVal: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.text,
  },
  alertCard: {
    padding: Spacing.sm,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  alertHeaderIcon: {
    fontSize: 20,
  },
  alertItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#FEE2E2',
  },
  alertItemName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
  },
  alertItemSku: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  alertItemStock: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertItemThreshold: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  navCard: {
    padding: Spacing.sm,
    marginTop: 4,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  navIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  navTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  navArrow: {
    fontSize: 18,
    color: Colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderSubtle,
  },
});

export default DashboardScreen;
