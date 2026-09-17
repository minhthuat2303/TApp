// T_SHOP Mobile - Comprehensive Reports & Retail Business Performance Screen
// 5 Core Functional Groups: Tổng quan, Doanh thu & Lãi, Sản phẩm, Hiệu suất, Tồn kho & Vốn
// Aligned with Retail Business Management Standards & Strict Offline SQLite Data Source

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  ActivityIndicator, 
  RefreshControl, 
  Modal,
  TextInput,
  Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import NetworkBanner from '../../components/common/NetworkBanner';
import { formatCurrency } from '../../utils/formatters';
import { Colors } from '../../constants/colors';
import { Spacing, BorderRadius } from '../../constants/layout';
import analyticsService from '../../services/AnalyticsService';
import { 
  DatePeriod, 
  ReportOverviewData,
  DetailedSalesRowItem,
  DiscountAnalysisData,
  ProductPerformanceItem,
  CategoryPerformanceItem,
  ProfitabilityMatrixData,
  HourlyPerformanceItem,
  WeekdayPerformanceItem,
  StaffPerformanceItem,
  InventoryCapitalData,
  OrderDrilldownItem,
  ProductLotDrilldownItem
} from '../../services/types';
import { useAuth } from '../../auth/AuthContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 15 Shared Time Filter Options
const PERIOD_OPTIONS: Array<{ key: DatePeriod; label: string }> = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'yesterday', label: 'Hôm qua' },
  { key: '7days', label: '7 ngày' },
  { key: '30days', label: '30 ngày' },
  { key: 'this_week', label: 'Tuần này' },
  { key: 'last_week', label: 'Tuần trước' },
  { key: 'this_month', label: 'Tháng này' },
  { key: 'last_month', label: 'Tháng trước' },
  { key: 'this_quarter', label: 'Quý này' },
  { key: 'last_quarter', label: 'Quý trước' },
  { key: '6months', label: '6 tháng' },
  { key: 'this_year', label: 'Năm nay' },
  { key: 'last_year', label: 'Năm trước' },
  { key: 'all_time', label: 'Toàn thời gian' },
  { key: 'custom', label: '📅 Tùy chọn' },
];

export const ReportsScreen: React.FC = () => {
  const { user } = useAuth();
  const currentUserId = user?.role === 'ADMIN' ? undefined : user?.id;

  // 5 Main Tabs
  const [activeTab, setActiveTab] = useState<'overview' | 'revenue_profit' | 'products' | 'performance' | 'inventory_capital'>('overview');
  
  // Shared Filter State
  const [period, setPeriod] = useState<DatePeriod>('this_month');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [tempStart, setTempStart] = useState<string>('');
  const [tempEnd, setTempEnd] = useState<string>('');

  // Data States for 5 Tabs
  const [overviewData, setOverviewData] = useState<ReportOverviewData | null>(null);
  const [timelineGranularity, setTimelineGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [timelineData, setTimelineData] = useState<DetailedSalesRowItem[]>([]);
  const [discountData, setDiscountData] = useState<DiscountAnalysisData | null>(null);
  
  const [productSortBy, setProductSortBy] = useState<'revenue' | 'profit' | 'margin' | 'quantity' | 'slow'>('revenue');
  const [productFilterType, setProductFilterType] = useState<'all' | 'low_margin' | 'slow'>('all');
  const [productSearch, setProductSearch] = useState('');
  const [productsList, setProductsList] = useState<ProductPerformanceItem[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryPerformanceItem[]>([]);
  const [matrixData, setMatrixData] = useState<ProfitabilityMatrixData | null>(null);

  const [hourlyData, setHourlyData] = useState<HourlyPerformanceItem[]>([]);
  const [weekdayData, setWeekdayData] = useState<WeekdayPerformanceItem[]>([]);
  const [staffData, setStaffData] = useState<{ hasData: boolean; staff: StaffPerformanceItem[] }>({ hasData: false, staff: [] });

  const [capitalData, setCapitalData] = useState<InventoryCapitalData | null>(null);

  // Status States
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  // Drill-down Modals
  const [dateDrilldownModal, setDateDrilldownModal] = useState(false);
  const [selectedDateForDrilldown, setSelectedDateForDrilldown] = useState<string>('');
  const [drilldownOrders, setDrilldownOrders] = useState<OrderDrilldownItem[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const [productLotModal, setProductLotModal] = useState(false);
  const [selectedProductLots, setSelectedProductLots] = useState<{ product: any; lots: ProductLotDrilldownItem[]; salesCount: number } | null>(null);

  // Fetch report data on period change or tab switch
  const loadReports = useCallback(async () => {
    try {
      setLoading(true);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())} - ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

      // Tab 1: Overview
      if (activeTab === 'overview') {
        const overview = await analyticsService.getReportOverview(period, customStart, customEnd, currentUserId);
        setOverviewData(overview);
      }
      // Tab 2: Revenue & Profit
      else if (activeTab === 'revenue_profit') {
        const [timeline, discount] = await Promise.all([
          analyticsService.getDetailedSalesTimeline(period, timelineGranularity, customStart, customEnd, currentUserId),
          analyticsService.getDiscountAnalysis(period, customStart, customEnd, currentUserId),
        ]);
        setTimelineData(timeline);
        setDiscountData(discount);
      }
      // Tab 3: Products, Categories & Matrix
      else if (activeTab === 'products') {
        const [prods, cats, matrix] = await Promise.all([
          analyticsService.getProductPerformance(period, productSortBy, productFilterType, customStart, customEnd, currentUserId),
          analyticsService.getCategoryPerformance(period, customStart, customEnd, currentUserId),
          analyticsService.getProfitabilityMatrix(period, customStart, customEnd, currentUserId),
        ]);
        setProductsList(prods);
        setCategoryList(cats);
        setMatrixData(matrix);
      }
      // Tab 4: Performance
      else if (activeTab === 'performance') {
        const [hourly, weekday, staff] = await Promise.all([
          analyticsService.getHourlyPerformance(period, customStart, customEnd, currentUserId),
          analyticsService.getWeekdayPerformance(period, customStart, customEnd, currentUserId),
          analyticsService.getStaffPerformance(period, customStart, customEnd),
        ]);
        setHourlyData(hourly);
        setWeekdayData(weekday);
        setStaffData(staff);
      }
      // Tab 5: Inventory Capital
      else if (activeTab === 'inventory_capital') {
        const cap = await analyticsService.getInventoryCapitalAnalysis(period, customStart, customEnd);
        setCapitalData(cap);
      }

      setLastRefreshed(timeStr);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, period, customStart, customEnd, timelineGranularity, productSortBy, productFilterType, currentUserId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
  };

  // Handle Date Drilldown
  const handleOpenDateDrilldown = async (dateStr: string) => {
    try {
      setSelectedDateForDrilldown(dateStr);
      setDateDrilldownModal(true);
      setDrilldownLoading(true);
      const orders = await analyticsService.getDateOrdersDrilldown(dateStr, currentUserId);
      setDrilldownOrders(orders);
    } catch (err) {
      console.error('Failed to drill down date:', err);
    } finally {
      setDrilldownLoading(false);
    }
  };

  // Handle Product Lot Drilldown
  const handleOpenProductDrilldown = async (productId: number) => {
    try {
      setProductLotModal(true);
      const detail = await analyticsService.getProductLotDrilldown(productId);
      setSelectedProductLots(detail);
    } catch (err) {
      console.error('Failed to drill down product lots:', err);
    }
  };

  // Handle Custom Period Apply
  const handleApplyCustomPeriod = () => {
    if (tempStart && tempEnd) {
      setCustomStart(tempStart.trim());
      setCustomEnd(tempEnd.trim());
      setPeriod('custom');
      setCustomModalVisible(false);
    }
  };

  // Filtered Products for Tab 3
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return productsList;
    const q = productSearch.toLowerCase().trim();
    return productsList.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [productsList, productSearch]);

  // Helper for trend badge
  const renderTrendBadge = (changePercent: number, trend: 'UP' | 'DOWN' | 'FLAT', isMargin = false) => {
    if (trend === 'FLAT') {
      return (
        <View style={[styles.trendPill, { backgroundColor: '#F1F5F9' }]}>
          <Text style={[styles.trendPillText, { color: '#64748B' }]}>→ 0{isMargin ? ' pp' : '%'}</Text>
        </View>
      );
    }
    const isPositive = trend === 'UP';
    return (
      <View style={[styles.trendPill, { backgroundColor: isPositive ? '#DCFCE7' : '#FEE2E2' }]}>
        <Text style={[styles.trendPillText, { color: isPositive ? '#16A34A' : '#DC2626' }]}>
          {isPositive ? '↑ +' : '↓ '}{changePercent}{isMargin ? ' pp' : '%'}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NetworkBanner />

      <View style={styles.container}>
        {/* Header Title & Offline Badge */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>📊 Báo cáo & Hiệu suất</Text>
            <Text style={styles.headerSub}>
              Dữ liệu offline • {lastRefreshed ? `Cập nhật: ${lastRefreshed}` : 'Đang đồng bộ'}
            </Text>
          </View>
          <Badge 
            label={user?.role === 'ADMIN' ? 'Toàn cửa hàng' : 'Cá nhân'} 
            variant={user?.role === 'ADMIN' ? 'primary' : 'warning'} 
          />
        </View>

        {/* 15 Shared Period Filter Chips */}
        <View style={styles.periodBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodScroll}>
            {PERIOD_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p.key}
                style={[styles.periodChip, period === p.key && styles.periodChipActive]}
                onPress={() => {
                  if (p.key === 'custom') {
                    setTempStart(customStart || new Date().toISOString().slice(0, 10));
                    setTempEnd(customEnd || new Date().toISOString().slice(0, 10));
                    setCustomModalVisible(true);
                  } else {
                    setPeriod(p.key);
                  }
                }}
              >
                <Text style={[styles.periodChipText, period === p.key && styles.periodChipTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 5 Main Tabs Navigation */}
        <View style={styles.tabContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'overview' && styles.activeTabBtn]}
              onPress={() => setActiveTab('overview')}
            >
              <Text style={[styles.tabText, activeTab === 'overview' && styles.activeTabText]}>
                1. TỔNG QUAN
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'revenue_profit' && styles.activeTabBtn]}
              onPress={() => setActiveTab('revenue_profit')}
            >
              <Text style={[styles.tabText, activeTab === 'revenue_profit' && styles.activeTabText]}>
                2. DOANH THU & LÃI
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'products' && styles.activeTabBtn]}
              onPress={() => setActiveTab('products')}
            >
              <Text style={[styles.tabText, activeTab === 'products' && styles.activeTabText]}>
                3. SẢN PHẨM
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'performance' && styles.activeTabBtn]}
              onPress={() => setActiveTab('performance')}
            >
              <Text style={[styles.tabText, activeTab === 'performance' && styles.activeTabText]}>
                4. HIỆU SUẤT
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'inventory_capital' && styles.activeTabBtn]}
              onPress={() => setActiveTab('inventory_capital')}
            >
              <Text style={[styles.tabText, activeTab === 'inventory_capital' && styles.activeTabText]}>
                5. TỒN KHO & VỐN
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Main Content Area */}
        {loading && !refreshing ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={{ marginTop: 8, fontSize: 13, color: Colors.textMuted }}>
              Đang tính toán số liệu tài chính & tồn kho...
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.scrollInner}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {/* ========================================================================= */}
            {/* TAB 1: TỔNG QUAN                                                          */}
            {/* ========================================================================= */}
            {/* ========================================================================= */}
            {/* TAB 1: TỔNG QUAN                                                          */}
            {/* ========================================================================= */}
            {activeTab === 'overview' && overviewData && (
              <View style={styles.tabSection}>
                {/* 1.1 Period Label & Comparison Notice */}
                <View style={styles.periodNoticeCard}>
                  <View style={styles.periodNoticeRow}>
                    <Text style={styles.periodNoticeTitle}>
                      📅 {overviewData.periodLabel}
                    </Text>
                    <View style={styles.periodComparisonTag}>
                      <Text style={styles.periodComparisonTagText}>Kỳ so sánh</Text>
                    </View>
                  </View>
                  <Text style={styles.periodNoticeSub}>
                    Đối chiếu với kỳ trước: {overviewData.previousPeriodLabel}
                  </Text>
                </View>

                {/* 1.2 Master Executive Financial Hero Card */}
                <Card style={styles.heroCard}>
                  <View style={styles.heroHeaderRow}>
                    <View style={styles.heroHeaderBadge}>
                      <Text style={{ fontSize: 13 }}>💎</Text>
                      <Text style={styles.heroLabel}>DOANH THU THỰC THU</Text>
                    </View>
                    {renderTrendBadge(
                      overviewData.comparisons.netRevenue.changePercent, 
                      overviewData.comparisons.netRevenue.trend
                    )}
                  </View>

                  <Text style={styles.heroPrimaryVal}>
                    {formatCurrency(overviewData.netRevenue)}
                  </Text>
                  
                  <Text style={styles.heroSubDescription}>
                    Thực thu sau khi trừ giảm giá & chiết khấu bán hàng
                  </Text>

                  {/* Visual Revenue Breakdown Mini-Bar */}
                  <View style={styles.heroRatioBarContainer}>
                    <View style={styles.heroRatioBarTrack}>
                      <View 
                        style={[
                          styles.heroRatioSegmentCogs, 
                          { width: `${overviewData.netRevenue > 0 ? Math.min(100, Math.round((overviewData.cogs / overviewData.netRevenue) * 100)) : 0}%` }
                        ]} 
                      />
                      <View 
                        style={[
                          styles.heroRatioSegmentProfit, 
                          { width: `${overviewData.netRevenue > 0 ? Math.max(0, Math.min(100, Math.round((overviewData.grossProfit / overviewData.netRevenue) * 100))) : 0}%` }
                        ]} 
                      />
                    </View>
                    <View style={styles.heroRatioLegendRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={[styles.heroRatioDot, { backgroundColor: '#F59E0B' }]} />
                        <Text style={styles.heroRatioLegendText}>
                          Giá vốn {overviewData.netRevenue > 0 ? Math.round((overviewData.cogs / overviewData.netRevenue) * 100) : 0}%
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={[styles.heroRatioDot, { backgroundColor: '#10B981' }]} />
                        <Text style={styles.heroRatioLegendText}>
                          Lãi gộp {overviewData.netRevenue > 0 ? Math.round((overviewData.grossProfit / overviewData.netRevenue) * 100) : 0}%
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.heroDivider} />

                  {/* 2 Symmetrical Pillars: Gross Profit & Margin */}
                  <View style={styles.heroPillarsRow}>
                    <View style={styles.heroPillarItem}>
                      <Text style={styles.heroPillarLabel}>LỢI NHUẬN GỘP</Text>
                      <Text style={styles.heroProfitVal}>
                        {formatCurrency(overviewData.grossProfit)}
                      </Text>
                      <View style={{ marginTop: 2 }}>
                        {renderTrendBadge(
                          overviewData.comparisons.grossProfit.changePercent, 
                          overviewData.comparisons.grossProfit.trend
                        )}
                      </View>
                    </View>

                    <View style={styles.heroPillarSeparator} />

                    <View style={styles.heroPillarItem}>
                      <Text style={styles.heroPillarLabel}>TỶ SUẤT MARGIN</Text>
                      <Text style={styles.heroMarginVal}>
                        {overviewData.margin}%
                      </Text>
                      <View style={{ marginTop: 2 }}>
                        {renderTrendBadge(
                          overviewData.comparisons.margin.percentagePointsChange, 
                          overviewData.comparisons.margin.trend, 
                          true
                        )}
                      </View>
                    </View>
                  </View>
                </Card>

                {/* 1.3 Ma trận Chỉ số Vận hành & Quy mô (3 Cột x 2 Hàng) */}
                <Text style={styles.sectionHeader}>⚖️ Ma trận chỉ số vận hành & Quy mô (3×2)</Text>
                <View style={styles.matrixContainer}>
                  {/* Hàng 1: Đơn hoàn thành • AOV (TB/Đơn) • Món / Đơn */}
                  <View style={styles.matrixRow}>
                    {/* Card 1: Số đơn hoàn thành */}
                    <Card style={styles.matrixCard}>
                      <View style={styles.matrixCardHeader}>
                        <View style={[styles.matrixIconCircle, { backgroundColor: '#EFF6FF' }]}>
                          <Text style={{ fontSize: 13 }}>🧾</Text>
                        </View>
                        {renderTrendBadge(
                          overviewData.comparisons.ordersCount.changePercent, 
                          overviewData.comparisons.ordersCount.trend
                        )}
                      </View>
                      <View style={styles.matrixCardBody}>
                        <Text style={styles.matrixLabel} numberOfLines={1}>Đơn hoàn thành</Text>
                        <Text style={styles.matrixValue} numberOfLines={1}>{overviewData.ordersCount} đơn</Text>
                        <Text style={styles.matrixSubText} numberOfLines={1}>Giao dịch chốt</Text>
                      </View>
                    </Card>

                    {/* Card 2: Giá trị trung bình đơn AOV */}
                    <Card style={styles.matrixCard}>
                      <View style={styles.matrixCardHeader}>
                        <View style={[styles.matrixIconCircle, { backgroundColor: '#F0FDF4' }]}>
                          <Text style={{ fontSize: 13 }}>💳</Text>
                        </View>
                        {renderTrendBadge(
                          overviewData.comparisons.aov.changePercent, 
                          overviewData.comparisons.aov.trend
                        )}
                      </View>
                      <View style={styles.matrixCardBody}>
                        <Text style={styles.matrixLabel} numberOfLines={1}>AOV (TB / Đơn)</Text>
                        <Text style={[styles.matrixValue, { color: Colors.primary }]} numberOfLines={1}>
                          {formatCurrency(overviewData.aov)}
                        </Text>
                        <Text style={styles.matrixSubText} numberOfLines={1}>Giá trị TB / đơn</Text>
                      </View>
                    </Card>

                    {/* Card 3: Số sản phẩm / đơn */}
                    <Card style={styles.matrixCard}>
                      <View style={styles.matrixCardHeader}>
                        <View style={[styles.matrixIconCircle, { backgroundColor: '#F3E8FF' }]}>
                          <Text style={{ fontSize: 13 }}>🛍️</Text>
                        </View>
                        <View style={styles.metricTag}>
                          <Text style={styles.metricTagText}>Giỏ</Text>
                        </View>
                      </View>
                      <View style={styles.matrixCardBody}>
                        <Text style={styles.matrixLabel} numberOfLines={1}>Món / Đơn hàng</Text>
                        <Text style={styles.matrixValue} numberOfLines={1}>{overviewData.unitsPerOrder} cái</Text>
                        <Text style={styles.matrixSubText} numberOfLines={1}>Quy mô giỏ TB</Text>
                      </View>
                    </Card>
                  </View>

                  {/* Hàng 2: Tổng món đã bán • Giá vốn COGS • Tổng giảm giá */}
                  <View style={styles.matrixRow}>
                    {/* Card 4: Số lượng sản phẩm bán */}
                    <Card style={styles.matrixCard}>
                      <View style={styles.matrixCardHeader}>
                        <View style={[styles.matrixIconCircle, { backgroundColor: '#FEF3C7' }]}>
                          <Text style={{ fontSize: 13 }}>📦</Text>
                        </View>
                        <View style={styles.metricTag}>
                          <Text style={styles.metricTagText}>Xuất</Text>
                        </View>
                      </View>
                      <View style={styles.matrixCardBody}>
                        <Text style={styles.matrixLabel} numberOfLines={1}>Tổng món đã bán</Text>
                        <Text style={styles.matrixValue} numberOfLines={1}>{overviewData.unitsSold} món</Text>
                        <Text style={styles.matrixSubText} numberOfLines={1}>Sản lượng bán ra</Text>
                      </View>
                    </Card>

                    {/* Card 5: Giá vốn hàng bán COGS */}
                    <Card style={styles.matrixCard}>
                      <View style={styles.matrixCardHeader}>
                        <View style={[styles.matrixIconCircle, { backgroundColor: '#FFF7ED' }]}>
                          <Text style={{ fontSize: 13 }}>🏷️</Text>
                        </View>
                        <View style={styles.metricTag}>
                          <Text style={styles.metricTagText}>FIFO</Text>
                        </View>
                      </View>
                      <View style={styles.matrixCardBody}>
                        <Text style={styles.matrixLabel} numberOfLines={1}>Giá vốn (COGS)</Text>
                        <Text style={[styles.matrixValue, { color: '#B45309' }]} numberOfLines={1}>
                          {formatCurrency(overviewData.cogs)}
                        </Text>
                        <Text style={styles.matrixSubText} numberOfLines={1}>
                          {overviewData.netRevenue > 0 ? `${Math.round((overviewData.cogs / overviewData.netRevenue) * 100)}% DT` : '0%'}
                        </Text>
                      </View>
                    </Card>

                    {/* Card 6: Tổng chiết khấu */}
                    <Card style={styles.matrixCard}>
                      <View style={styles.matrixCardHeader}>
                        <View style={[styles.matrixIconCircle, { backgroundColor: '#FEE2E2' }]}>
                          <Text style={{ fontSize: 13 }}>🎟️</Text>
                        </View>
                        <View style={styles.metricTag}>
                          <Text style={styles.metricTagText}>Giảm</Text>
                        </View>
                      </View>
                      <View style={styles.matrixCardBody}>
                        <Text style={styles.matrixLabel} numberOfLines={1}>Tổng giảm giá</Text>
                        <Text style={[styles.matrixValue, { color: Colors.danger }]} numberOfLines={1}>
                          {formatCurrency(overviewData.discount)}
                        </Text>
                        <Text style={styles.matrixSubText} numberOfLines={1}>
                          {overviewData.grossSales > 0 ? `${Math.round((overviewData.discount / overviewData.grossSales) * 100)}% DT` : '0%'}
                        </Text>
                      </View>
                    </Card>
                  </View>
                </View>

                {/* 1.4 Financial Waterfall Card */}
                <Text style={styles.sectionHeader}>💧 Phân rã Doanh thu & Dòng tiền lãi</Text>
                <Card style={styles.waterfallCard}>
                  {/* Step 1: Gross Sales */}
                  <View style={styles.waterfallStep}>
                    <View style={styles.waterfallStepLeft}>
                      <View style={[styles.waterfallDot, { backgroundColor: Colors.primary }]} />
                      <Text style={styles.waterfallLabel}>1. Doanh thu trước giảm (Gross)</Text>
                    </View>
                    <Text style={styles.waterfallVal}>{formatCurrency(overviewData.grossSales)}</Text>
                  </View>

                  {/* Step 2: Discount */}
                  <View style={styles.waterfallStep}>
                    <View style={styles.waterfallStepLeft}>
                      <View style={[styles.waterfallDot, { backgroundColor: Colors.danger }]} />
                      <Text style={[styles.waterfallLabel, { color: Colors.danger }]}>2. (-) Giảm giá & Chiết khấu</Text>
                    </View>
                    <Text style={[styles.waterfallVal, { color: Colors.danger }]}>-{formatCurrency(overviewData.discount)}</Text>
                  </View>

                  <View style={styles.waterfallLine} />

                  {/* Step 3: Net Revenue */}
                  <View style={[styles.waterfallStep, { backgroundColor: '#F8FAFC', padding: 8, borderRadius: 8 }]}>
                    <View style={styles.waterfallStepLeft}>
                      <View style={[styles.waterfallDot, { backgroundColor: Colors.primary }]} />
                      <Text style={[styles.waterfallLabel, { fontWeight: '700', color: Colors.primary }]}>3. (=) Doanh thu thực thu</Text>
                    </View>
                    <Text style={[styles.waterfallVal, { fontWeight: '800', color: Colors.primary, fontSize: 14 }]}>
                      {formatCurrency(overviewData.netRevenue)}
                    </Text>
                  </View>

                  {/* Step 4: COGS */}
                  <View style={styles.waterfallStep}>
                    <View style={styles.waterfallStepLeft}>
                      <View style={[styles.waterfallDot, { backgroundColor: '#B45309' }]} />
                      <Text style={[styles.waterfallLabel, { color: '#B45309' }]}>4. (-) Giá vốn hàng bán (COGS)</Text>
                    </View>
                    <Text style={[styles.waterfallVal, { color: '#B45309' }]}>-{formatCurrency(overviewData.cogs)}</Text>
                  </View>

                  {/* Step 5: Gross Profit Final Box */}
                  <View style={styles.waterfallFinalBox}>
                    <View style={styles.waterfallFinalLeft}>
                      <Text style={styles.waterfallFinalLabel}>5. (=) LỢI NHUẬN GỘP</Text>
                      <Text style={styles.waterfallFinalVal}>{formatCurrency(overviewData.grossProfit)}</Text>
                    </View>
                    <View style={styles.waterfallMarginBadge}>
                      <Text style={styles.waterfallMarginBadgeText}>Margin {overviewData.margin}%</Text>
                    </View>
                  </View>
                </Card>

                {/* 1.5 Business Alerts */}
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.sectionHeader}>⚠️ Cảnh báo kinh doanh & Bất thường</Text>
                  {overviewData.alerts.length === 0 ? (
                    <Card style={styles.alertEmptyCard}>
                      <Text style={{ fontSize: 18 }}>✨</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.alertEmptyTitle}>Hoạt động kinh doanh ổn định</Text>
                        <Text style={styles.alertEmptySub}>
                          Chưa phát hiện bất thường về doanh thu, biên lãi gộp hay tỷ lệ chiết khấu trong kỳ này.
                        </Text>
                      </View>
                    </Card>
                  ) : (
                    overviewData.alerts.map((alert) => (
                      <Card 
                        key={alert.id} 
                        style={[
                          styles.alertCard, 
                          alert.type === 'DANGER' ? styles.alertDanger : alert.type === 'WARNING' ? styles.alertWarning : styles.alertInfo
                        ]}
                      >
                        <View style={styles.alertHeader}>
                          <Text style={[
                            styles.alertTitle,
                            alert.type === 'DANGER' ? { color: '#B91C1C' } : alert.type === 'WARNING' ? { color: '#B45309' } : { color: '#1D4ED8' }
                          ]}>
                            {alert.type === 'DANGER' ? '🚨 ' : alert.type === 'WARNING' ? '⚠️ ' : 'ℹ️ '}
                            {alert.title}
                          </Text>
                          {alert.metric && (
                            <Badge 
                              label={alert.metric} 
                              variant={alert.type === 'DANGER' ? 'danger' : alert.type === 'WARNING' ? 'warning' : 'primary'} 
                            />
                          )}
                        </View>
                        <Text style={styles.alertMessage}>{alert.message}</Text>
                      </Card>
                    ))
                  )}
                </View>

                {/* 1.6 Revenue & Profit Trend Preview */}
                {overviewData.trend.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <View style={styles.chartHeaderRow}>
                      <Text style={styles.sectionHeader}>📊 Xu hướng Doanh thu & Lợi nhuận</Text>
                      <View style={styles.chartLegend}>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: Colors.primary }]} />
                          <Text style={styles.legendText}>Doanh thu</Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                          <Text style={styles.legendText}>Lợi nhuận</Text>
                        </View>
                      </View>
                    </View>
                    <Card style={{ padding: 12 }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 160, paddingVertical: 10, gap: 14 }}>
                          {overviewData.trend.map((t, idx) => {
                            const maxVal = Math.max(...overviewData.trend.map(i => i.revenue), 1);
                            const revHeight = Math.max(10, Math.round((t.revenue / maxVal) * 120));
                            const profHeight = Math.max(4, Math.round((Math.max(0, t.profit) / maxVal) * 120));
                            return (
                              <View key={idx} style={{ alignItems: 'center', width: 44 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3 }}>
                                  <View style={{ width: 14, height: revHeight, backgroundColor: Colors.primary, borderRadius: 3 }} />
                                  <View style={{ width: 14, height: profHeight, backgroundColor: '#10B981', borderRadius: 3 }} />
                                </View>
                                <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 6 }} numberOfLines={1}>
                                  {t.label}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </Card>
                  </View>
                )}
              </View>
            )}

            {/* ========================================================================= */}
            {/* TAB 2: DOANH THU & LỢI NHUẬN (TIMELINE & DISCOUNT ANALYSIS)              */}
            {/* ========================================================================= */}
            {activeTab === 'revenue_profit' && (
              <View style={styles.tabSection}>
                {/* Granularity Switcher */}
                <View style={styles.subFilterRow}>
                  <Text style={styles.subFilterLabel}>Mức độ chi tiết:</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {(['day', 'week', 'month'] as const).map((g) => (
                      <TouchableOpacity
                        key={g}
                        style={[styles.smallFilterPill, timelineGranularity === g && styles.smallFilterPillActive]}
                        onPress={() => setTimelineGranularity(g)}
                      >
                        <Text style={[styles.smallFilterText, timelineGranularity === g && styles.smallFilterTextActive]}>
                          {g === 'day' ? 'Theo ngày' : g === 'week' ? 'Theo tuần' : 'Theo tháng'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Timeline List */}
                <Text style={styles.sectionHeader}>📅 Báo cáo Doanh thu & Lãi chi tiết</Text>
                {timelineData.length === 0 ? (
                  <EmptyState title="Không có dữ liệu" description="Chưa có giao dịch hoàn thành nào trong khoảng thời gian này." />
                ) : (
                  timelineData.map((item) => (
                    <TouchableOpacity 
                      key={item.timeKey} 
                      onPress={() => {
                        if (timelineGranularity === 'day') {
                          handleOpenDateDrilldown(item.timeKey);
                        }
                      }}
                    >
                      <Card style={styles.timelineRowCard}>
                        <View style={styles.timelineHeader}>
                          <Text style={styles.timelineDateText}>📅 {item.label}</Text>
                          <Badge label={`${item.ordersCount} đơn • ${item.unitsSold} món`} variant="primary" />
                        </View>

                        <View style={styles.metricGridRow}>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Doanh thu thực:</Text>
                            <Text style={[styles.microValueBold, { color: Colors.primary }]}>
                              {formatCurrency(item.netRevenue)}
                            </Text>
                          </View>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Giá vốn COGS:</Text>
                            <Text style={[styles.microValueBold, { color: '#B45309' }]}>
                              {formatCurrency(item.cogs)}
                            </Text>
                          </View>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Lợi nhuận gộp:</Text>
                            <Text style={[styles.microValueBold, { color: '#15803D' }]}>
                              {formatCurrency(item.grossProfit)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.timelineFooterRow}>
                          <Text style={styles.timelineMarginText}>
                            Margin: <Text style={{ fontWeight: '700', color: '#15803D' }}>{item.margin}%</Text>
                          </Text>
                          <Text style={styles.timelineAovText}>
                            AOV: <Text style={{ fontWeight: '600' }}>{formatCurrency(item.aov)}</Text>
                          </Text>
                          {timelineGranularity === 'day' && (
                            <Text style={styles.drilldownHintText}>Chi tiết đơn →</Text>
                          )}
                        </View>
                      </Card>
                    </TouchableOpacity>
                  ))
                )}

                {/* Section: Discount Analysis */}
                {discountData && (
                  <View style={{ marginTop: 24 }}>
                    <Text style={styles.sectionHeader}>🎟️ Phân tích Chiết khấu & Khuyến mãi</Text>
                    <Card style={{ padding: 14 }}>
                      <View style={styles.kpiGrid2Col}>
                        <View style={styles.miniKpiBox}>
                          <Text style={styles.miniKpiLabel}>Tổng tiền giảm giá</Text>
                          <Text style={[styles.miniKpiVal, { color: Colors.danger }]}>
                            {formatCurrency(discountData.totalDiscount)}
                          </Text>
                        </View>
                        <View style={styles.miniKpiBox}>
                          <Text style={styles.miniKpiLabel}>Tỷ lệ đơn có giảm giá</Text>
                          <Text style={styles.miniKpiVal}>{discountData.ordersWithDiscountPercent}%</Text>
                          <Text style={styles.kpiSubText}>({discountData.ordersWithDiscountCount}/{discountData.ordersTotalCount} đơn)</Text>
                        </View>
                        <View style={styles.miniKpiBox}>
                          <Text style={styles.miniKpiLabel}>Giảm TB / Đơn giảm</Text>
                          <Text style={styles.miniKpiVal}>{formatCurrency(discountData.avgDiscountPerDiscountedOrder)}</Text>
                        </View>
                        <View style={styles.miniKpiBox}>
                          <Text style={styles.miniKpiLabel}>Tỷ trọng / DT gộp</Text>
                          <Text style={[styles.miniKpiVal, { color: discountData.discountToRevenueRatio > 10 ? Colors.danger : Colors.primary }]}>
                            {discountData.discountToRevenueRatio}%
                          </Text>
                        </View>
                      </View>

                      {discountData.topDiscountedProducts.length > 0 && (
                        <View style={{ marginTop: 14, borderTopWidth: 1, borderColor: Colors.borderSubtle, paddingTop: 10 }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 }}>
                            Top sản phẩm được giảm giá nhiều nhất:
                          </Text>
                          {discountData.topDiscountedProducts.map((p, idx) => (
                            <View key={p.productId} style={styles.topDiscountRow}>
                              <Text style={styles.topDiscountRank}>#{idx + 1}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.topDiscountName} numberOfLines={1}>{p.name}</Text>
                                <Text style={styles.topDiscountSub}>SKU: {p.sku} • Đã giảm trên {p.unitsDiscounted} món</Text>
                              </View>
                              <Text style={styles.topDiscountAmount}>-{formatCurrency(p.discountTotal)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </Card>
                  </View>
                )}
              </View>
            )}

            {/* ========================================================================= */}
            {/* TAB 3: SẢN PHẨM & DANH MỤC & MA TRẬN                                     */}
            {/* ========================================================================= */}
            {activeTab === 'products' && (
              <View style={styles.tabSection}>
                {/* 3.1 Profitability Matrix Widget */}
                {matrixData && matrixData.totalProductsCount > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={styles.sectionHeader}>⭐ Ma trận Hiệu quả Doanh thu × Lợi nhuận</Text>
                    <Text style={styles.matrixDesc}>
                      Điểm chuẩn trung bình: Doanh thu {formatCurrency(matrixData.avgRevenue)} | Lãi {formatCurrency(matrixData.avgProfit)}
                    </Text>

                    <View style={styles.matrixGrid}>
                      {/* Quadrant A: STARS */}
                      <View style={[styles.matrixQuadrantBox, { backgroundColor: '#FEFCE8', borderColor: '#FDE047' }]}>
                        <Text style={[styles.matrixBoxTitle, { color: '#854D0E' }]}>🌟 NGÔI SAO ({matrixData.stars.length})</Text>
                        <Text style={styles.matrixBoxDesc}>Doanh thu cao + Lãi cao</Text>
                        <Text style={styles.matrixSampleText} numberOfLines={2}>
                          {matrixData.stars.map(s => s.name).slice(0, 2).join(', ') || 'Chưa có'}
                        </Text>
                      </View>

                      {/* Quadrant B: CASH_COW */}
                      <View style={[styles.matrixQuadrantBox, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                        <Text style={[styles.matrixBoxTitle, { color: '#1D4ED8' }]}>💰 BÁN CHẠY LÃI THẤP ({matrixData.highVolumeLowMargin.length})</Text>
                        <Text style={styles.matrixBoxDesc}>Doanh thu cao + Lãi thấp</Text>
                        <Text style={styles.matrixSampleText} numberOfLines={2}>
                          {matrixData.highVolumeLowMargin.map(s => s.name).slice(0, 2).join(', ') || 'Chưa có'}
                        </Text>
                      </View>

                      {/* Quadrant C: POTENTIAL */}
                      <View style={[styles.matrixQuadrantBox, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                        <Text style={[styles.matrixBoxTitle, { color: '#15803D' }]}>🚀 TIỀM NĂNG ({matrixData.potentials.length})</Text>
                        <Text style={styles.matrixBoxDesc}>Doanh thu thấp + Lãi cao</Text>
                        <Text style={styles.matrixSampleText} numberOfLines={2}>
                          {matrixData.potentials.map(s => s.name).slice(0, 2).join(', ') || 'Chưa có'}
                        </Text>
                      </View>

                      {/* Quadrant D: LOW PERFORMER */}
                      <View style={[styles.matrixQuadrantBox, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
                        <Text style={[styles.matrixBoxTitle, { color: '#DC2626' }]}>⚠️ CẦN XỬ LÝ ({matrixData.lowPerformers.length})</Text>
                        <Text style={styles.matrixBoxDesc}>Doanh thu thấp + Lãi thấp</Text>
                        <Text style={styles.matrixSampleText} numberOfLines={2}>
                          {matrixData.lowPerformers.map(s => s.name).slice(0, 2).join(', ') || 'Chưa có'}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* 3.2 Category Performance Breakdown */}
                {categoryList.length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={styles.sectionHeader}>📂 Hiệu quả theo Danh mục ngành hàng</Text>
                    {categoryList.map((c) => (
                      <Card key={c.categoryId} style={styles.categoryCard}>
                        <View style={styles.categoryHeaderRow}>
                          <Text style={styles.categoryNameText}>📂 {c.categoryName}</Text>
                          <Badge label={`${c.revenueSharePercent}% DT`} variant="primary" />
                        </View>
                        <View style={styles.categoryProgressBarBg}>
                          <View style={[styles.categoryProgressBarFill, { width: `${Math.min(100, c.revenueSharePercent)}%` }]} />
                        </View>
                        <View style={styles.metricGridRow}>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Doanh thu:</Text>
                            <Text style={[styles.microValueBold, { color: Colors.primary }]}>{formatCurrency(c.netRevenue)}</Text>
                          </View>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Lợi nhuận:</Text>
                            <Text style={[styles.microValueBold, { color: '#15803D' }]}>{formatCurrency(c.grossProfit)}</Text>
                          </View>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Margin:</Text>
                            <Text style={[styles.microValueBold, { color: '#15803D' }]}>{c.margin}%</Text>
                          </View>
                        </View>
                      </Card>
                    ))}
                  </View>
                )}

                {/* 3.3 Product List Filters & Search */}
                <Text style={styles.sectionHeader}>📦 Xếp hạng sản phẩm chi tiết</Text>
                <TextInput
                  style={styles.productSearchInput}
                  placeholder="🔍 Tìm theo tên hoặc mã SKU sản phẩm..."
                  value={productSearch}
                  onChangeText={setProductSearch}
                />

                {/* Internal Sorting Chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.smallFilterPill, productSortBy === 'revenue' && productFilterType === 'all' && styles.smallFilterPillActive]}
                      onPress={() => { setProductSortBy('revenue'); setProductFilterType('all'); }}
                    >
                      <Text style={[styles.smallFilterText, productSortBy === 'revenue' && productFilterType === 'all' && styles.smallFilterTextActive]}>
                        Top Doanh thu
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallFilterPill, productSortBy === 'profit' && styles.smallFilterPillActive]}
                      onPress={() => { setProductSortBy('profit'); setProductFilterType('all'); }}
                    >
                      <Text style={[styles.smallFilterText, productSortBy === 'profit' && styles.smallFilterTextActive]}>
                        Top Lợi nhuận
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallFilterPill, productSortBy === 'margin' && styles.smallFilterPillActive]}
                      onPress={() => { setProductSortBy('margin'); setProductFilterType('all'); }}
                    >
                      <Text style={[styles.smallFilterText, productSortBy === 'margin' && styles.smallFilterTextActive]}>
                        Top Margin %
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallFilterPill, productSortBy === 'quantity' && styles.smallFilterPillActive]}
                      onPress={() => { setProductSortBy('quantity'); setProductFilterType('all'); }}
                    >
                      <Text style={[styles.smallFilterText, productSortBy === 'quantity' && styles.smallFilterTextActive]}>
                        Top Số lượng
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallFilterPill, productFilterType === 'low_margin' && styles.smallFilterPillActive]}
                      onPress={() => { setProductFilterType('low_margin'); }}
                    >
                      <Text style={[styles.smallFilterText, productFilterType === 'low_margin' && styles.smallFilterTextActive]}>
                        Margin thấp (&lt;15%)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallFilterPill, productFilterType === 'slow' && styles.smallFilterPillActive]}
                      onPress={() => { setProductFilterType('slow'); }}
                    >
                      <Text style={[styles.smallFilterText, productFilterType === 'slow' && styles.smallFilterTextActive]}>
                        Bán chậm / 0 bán
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>

                {/* Product List Render */}
                {filteredProducts.length === 0 ? (
                  <EmptyState title="Không tìm thấy sản phẩm" description="Không có sản phẩm nào khớp với tiêu chí lọc." />
                ) : (
                  filteredProducts.map((p, idx) => (
                    <TouchableOpacity key={p.id} onPress={() => handleOpenProductDrilldown(p.id)}>
                      <Card style={styles.productCard}>
                        <View style={styles.productCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                            <View style={[styles.rankBadge, idx < 3 && styles.rankBadgeTop]}>
                              <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                            </View>
                            <Text style={styles.productNameText} numberOfLines={1}>{p.name}</Text>
                          </View>
                          <Badge 
                            label={`Bán: ${p.soldQuantity}`} 
                            variant={p.soldQuantity > 0 ? 'success' : 'warning'} 
                          />
                        </View>
                        <Text style={styles.productSkuSub}>
                          SKU: {p.sku} • Danh mục: {p.categoryName} • Tồn: {p.currentStock}
                        </Text>

                        <View style={styles.metricGridRow}>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Doanh thu:</Text>
                            <Text style={[styles.microValueBold, { color: Colors.primary }]}>{formatCurrency(p.netRevenue)}</Text>
                          </View>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Giá vốn:</Text>
                            <Text style={[styles.microValueBold, { color: '#B45309' }]}>{formatCurrency(p.cogs)}</Text>
                          </View>
                          <View style={styles.metricMiniCol}>
                            <Text style={styles.microLabel}>Lãi gộp:</Text>
                            <Text style={[styles.microValueBold, { color: '#15803D' }]}>{formatCurrency(p.grossProfit)}</Text>
                          </View>
                        </View>

                        <View style={styles.productFooterRow}>
                          <Text style={{ fontSize: 11, color: Colors.textSecondary }}>
                            Biên lợi nhuận: <Text style={{ fontWeight: '700', color: p.margin < 15 ? Colors.danger : '#15803D' }}>{p.margin}%</Text>
                          </Text>
                          <Text style={styles.drilldownHintText}>Xem lô FIFO →</Text>
                        </View>
                      </Card>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            {/* ========================================================================= */}
            {/* TAB 4: HIỆU SUẤT (TIME & STAFF PERFORMANCE)                               */}
            {/* ========================================================================= */}
            {activeTab === 'performance' && (
              <View style={styles.tabSection}>
                {/* 4.1 Hourly Performance */}
                <Text style={styles.sectionHeader}>⏰ Hiệu suất theo Khung giờ bán hàng</Text>
                <Card style={{ padding: 12, marginBottom: 16 }}>
                  {hourlyData.map((h, idx) => {
                    const maxRev = Math.max(...hourlyData.map(i => i.netRevenue), 1);
                    const percent = Math.min(100, Math.round((h.netRevenue / maxRev) * 100));
                    return (
                      <View key={idx} style={styles.hourBarRow}>
                        <View style={styles.hourBarLabelCol}>
                          <Text style={styles.hourBarLabel}>{h.hourRange}</Text>
                          <Text style={styles.hourBarSub}>{h.ordersCount} đơn • {h.unitsSold} món</Text>
                        </View>
                        <View style={{ flex: 1, paddingHorizontal: 8 }}>
                          <View style={styles.hourBarBg}>
                            <View style={[styles.hourBarFill, { width: `${percent}%` }]} />
                          </View>
                        </View>
                        <View style={{ width: 85, alignItems: 'flex-end' }}>
                          <Text style={styles.hourBarVal}>{formatCurrency(h.netRevenue)}</Text>
                          <Text style={styles.hourBarMargin}>{h.margin}% lãi</Text>
                        </View>
                      </View>
                    );
                  })}
                </Card>

                {/* 4.2 Weekday Performance */}
                <Text style={styles.sectionHeader}>📅 Hiệu suất theo Thứ trong tuần</Text>
                <Card style={{ padding: 12, marginBottom: 16 }}>
                  {weekdayData.map((w, idx) => {
                    const maxRev = Math.max(...weekdayData.map(i => i.netRevenue), 1);
                    const percent = Math.min(100, Math.round((w.netRevenue / maxRev) * 100));
                    return (
                      <View key={idx} style={styles.hourBarRow}>
                        <View style={{ width: 75 }}>
                          <Text style={styles.hourBarLabel}>{w.dayName}</Text>
                          <Text style={styles.hourBarSub}>{w.ordersCount} đơn</Text>
                        </View>
                        <View style={{ flex: 1, paddingHorizontal: 8 }}>
                          <View style={styles.hourBarBg}>
                            <View style={[styles.hourBarFill, { width: `${percent}%`, backgroundColor: '#15803D' }]} />
                          </View>
                        </View>
                        <View style={{ width: 85, alignItems: 'flex-end' }}>
                          <Text style={styles.hourBarVal}>{formatCurrency(w.netRevenue)}</Text>
                          <Text style={styles.hourBarMargin}>AOV: {formatCurrency(w.aov)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </Card>

                {/* 4.3 Staff Performance */}
                <Text style={styles.sectionHeader}>👤 Hiệu suất Bán hàng của Nhân viên</Text>
                {!staffData.hasData || staffData.staff.length === 0 ? (
                  <Card style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: Colors.textMuted }}>
                      Chưa đủ dữ liệu để phân tích hiệu suất nhân viên.
                    </Text>
                  </Card>
                ) : (
                  staffData.staff.map((s, idx) => (
                    <Card key={s.userId} style={styles.staffCard}>
                      <View style={styles.staffHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.rankBadge, idx === 0 && styles.rankBadgeTop]}>
                            <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                          </View>
                          <View>
                            <Text style={styles.staffNameText}>{s.fullName}</Text>
                            <Text style={styles.staffSubText}>@{s.username} • {s.role}</Text>
                          </View>
                        </View>
                        <Badge label={`${s.ordersCount} đơn`} variant="primary" />
                      </View>

                      <View style={styles.metricGridRow}>
                        <View style={styles.metricMiniCol}>
                          <Text style={styles.microLabel}>Doanh thu:</Text>
                          <Text style={[styles.microValueBold, { color: Colors.primary }]}>{formatCurrency(s.netRevenue)}</Text>
                        </View>
                        <View style={styles.metricMiniCol}>
                          <Text style={styles.microLabel}>Lợi nhuận:</Text>
                          <Text style={[styles.microValueBold, { color: '#15803D' }]}>{formatCurrency(s.grossProfit)}</Text>
                        </View>
                        <View style={styles.metricMiniCol}>
                          <Text style={styles.microLabel}>AOV TB:</Text>
                          <Text style={[styles.microValueBold]}>{formatCurrency(s.aov)}</Text>
                        </View>
                      </View>
                    </Card>
                  ))
                )}
              </View>
            )}

            {/* ========================================================================= */}
            {/* TAB 5: TỒN KHO & VỐN (INVENTORY CAPITAL & VALUATION)                      */}
            {/* ========================================================================= */}
            {activeTab === 'inventory_capital' && capitalData && (
              <View style={styles.tabSection}>
                {/* 5.1 Capital KPI Cards */}
                <Text style={styles.sectionHeader}>💰 Tổng quan Phân bổ Vốn Tồn kho</Text>
                <View style={styles.kpiGrid2Col}>
                  <Card style={styles.miniKpiBox}>
                    <Text style={styles.miniKpiLabel}>Tổng giá trị vốn trong kho</Text>
                    <Text style={[styles.kpiValue, { color: '#B45309' }]}>
                      {formatCurrency(capitalData.totalInventoryValuation)}
                    </Text>
                    <Text style={styles.kpiSubText}>Tổng vốn đang bị giữ</Text>
                  </Card>

                  <Card style={styles.miniKpiBox}>
                    <Text style={styles.miniKpiLabel}>Tổng số lượng tồn kho</Text>
                    <Text style={[styles.kpiValue, { color: Colors.primary }]}>
                      {capitalData.totalStockQuantity} cái
                    </Text>
                    <Text style={styles.kpiSubText}>Hàng khả dụng</Text>
                  </Card>

                  <Card style={styles.miniKpiBox}>
                    <Text style={styles.miniKpiLabel}>Vòng quay kho (Turnover)</Text>
                    <Text style={[styles.kpiValue, { color: '#15803D' }]}>
                      {capitalData.inventoryTurnover !== undefined ? `${capitalData.inventoryTurnover} vòng` : 'N/A'}
                    </Text>
                    <Text style={styles.kpiSubText}>COGS / Vốn TB</Text>
                  </Card>

                  <Card style={styles.miniKpiBox}>
                    <Text style={styles.miniKpiLabel}>Số ngày quay vòng (DIO)</Text>
                    <Text style={[styles.kpiValue, { color: '#15803D' }]}>
                      {capitalData.daysOfInventory !== undefined ? `${capitalData.daysOfInventory} ngày` : 'N/A'}
                    </Text>
                    <Text style={styles.kpiSubText}>Thời gian xả kho</Text>
                  </Card>
                </View>

                {/* 5.2 Category Capital Allocation ("Tiền đang nằm ở đâu?") */}
                <Text style={styles.sectionHeader}>📊 "Tiền đang nằm ở đâu?" — Phân bổ theo danh mục</Text>
                {capitalData.categoryCapitalAllocation.length === 0 ? (
                  <EmptyState title="Kho đang trống" description="Không có tồn kho khả dụng." />
                ) : (
                  capitalData.categoryCapitalAllocation.map((c) => (
                    <Card key={c.categoryId} style={styles.categoryCard}>
                      <View style={styles.categoryHeaderRow}>
                        <Text style={styles.categoryNameText}>📂 {c.categoryName}</Text>
                        <Badge label={`${c.capitalSharePercent}% vốn`} variant="warning" />
                      </View>
                      <View style={styles.categoryProgressBarBg}>
                        <View style={[styles.categoryProgressBarFill, { width: `${Math.min(100, c.capitalSharePercent)}%`, backgroundColor: '#B45309' }]} />
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                        <Text style={{ fontSize: 12, color: Colors.textSecondary }}>
                          Số lượng: <Text style={{ fontWeight: '600', color: Colors.textMain }}>{c.stockQuantity} món</Text>
                        </Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#B45309' }}>
                          {formatCurrency(c.stockValuation)}
                        </Text>
                      </View>
                    </Card>
                  ))
                )}

                {/* 5.3 Top 10 Capital Heavy Products */}
                <Text style={styles.sectionHeader}>📦 Top 10 sản phẩm ứ đọng nhiều vốn nhất</Text>
                {capitalData.topCapitalProducts.map((p, idx) => (
                  <TouchableOpacity key={p.id} onPress={() => handleOpenProductDrilldown(p.id)}>
                    <Card style={styles.productCard}>
                      <View style={styles.productCardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                          <View style={[styles.rankBadge, idx < 3 && styles.rankBadgeTop]}>
                            <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                          </View>
                          <Text style={styles.productNameText} numberOfLines={1}>{p.name}</Text>
                        </View>
                        <Badge label={`${p.capitalSharePercent}% vốn`} variant="warning" />
                      </View>
                      <Text style={styles.productSkuSub}>
                        SKU: {p.sku} • Tồn: {p.currentStock} • Giá vốn đơn vị: {formatCurrency(p.unitCostPrice)}
                      </Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <Text style={{ fontSize: 11, color: Colors.textSecondary }}>Tổng tiền vốn đọng:</Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#B45309' }}>
                          {formatCurrency(p.stockValuation)}
                        </Text>
                      </View>
                    </Card>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </View>

      {/* ========================================================================= */}
      {/* MODAL 1: DRILL-DOWN CHI TIẾT ĐƠN HÀNG THEO NGÀY                           */}
      {/* ========================================================================= */}
      <Modal visible={dateDrilldownModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>🔍 Chi tiết Giao dịch trong ngày</Text>
                <Text style={{ fontSize: 12, color: Colors.textMuted }}>Ngày bán: {selectedDateForDrilldown}</Text>
              </View>
              <TouchableOpacity onPress={() => setDateDrilldownModal(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            {drilldownLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={{ marginTop: 8, fontSize: 12, color: Colors.textMuted }}>Đang tải đơn hàng...</Text>
              </View>
            ) : drilldownOrders.length === 0 ? (
              <EmptyState title="Không có đơn hàng" description="Không tìm thấy đơn hàng hoàn thành trong ngày này." />
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
                {drilldownOrders.map((ord) => (
                  <Card key={ord.id} style={{ padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: Colors.primary }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '700', fontSize: 13, color: Colors.textMain }}>#{ord.orderCode}</Text>
                      <Badge label={ord.paymentMethod} variant="primary" />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={{ fontSize: 11, color: Colors.textSecondary }}>Thu ngân: {ord.cashierName || 'Thu ngân'}</Text>
                      <Text style={{ fontSize: 11, color: Colors.textSecondary }}>{ord.itemsCount} dòng món</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, borderTopWidth: 1, borderColor: Colors.borderSubtle, paddingTop: 6 }}>
                      <Text style={{ fontSize: 11, color: Colors.danger }}>
                        {ord.totalDiscount > 0 ? `Giảm: -${formatCurrency(ord.totalDiscount)}` : 'Không giảm'}
                      </Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.primary }}>
                        {formatCurrency(ord.finalAmount)}
                      </Text>
                    </View>
                  </Card>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: DRILL-DOWN CHI TIẾT LÔ HÀNG FIFO SẢN PHẨM                        */}
      {/* ========================================================================= */}
      <Modal visible={productLotModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  🔍 {selectedProductLots?.product?.name || 'Chi tiết sản phẩm'}
                </Text>
                <Text style={{ fontSize: 12, color: Colors.textMuted }}>
                  SKU: {selectedProductLots?.product?.sku} • Tồn: {selectedProductLots?.product?.current_stock}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setProductLotModal(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, marginBottom: 12 }}>
                <View>
                  <Text style={{ fontSize: 11, color: Colors.textMuted }}>Giá bán hiện tại:</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.primary }}>
                    {formatCurrency(selectedProductLots?.product?.current_selling_price || 0)}
                  </Text>
                </View>
                <View>
                  <Text style={{ fontSize: 11, color: Colors.textMuted }}>Giá vốn bình quân:</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#B45309' }}>
                    {formatCurrency(selectedProductLots?.product?.current_cost_price || 0)}
                  </Text>
                </View>
                <View>
                  <Text style={{ fontSize: 11, color: Colors.textMuted }}>Tổng bán trong kỳ:</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#15803D' }}>
                    {selectedProductLots?.salesCount || 0} cái
                  </Text>
                </View>
              </View>

              <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textMain, marginBottom: 8 }}>
                📋 Danh sách Lô hàng FIFO trong kho ({selectedProductLots?.lots?.length || 0} lô):
              </Text>

              {(!selectedProductLots?.lots || selectedProductLots.lots.length === 0) ? (
                <EmptyState title="Không có lô hàng" description="Sản phẩm chưa có bản ghi lô hàng nhập nào." />
              ) : (
                selectedProductLots.lots.map((lot) => (
                  <Card key={lot.id} style={{ padding: 10, marginBottom: 8, borderColor: lot.quantityRemaining > 0 ? '#BBF7D0' : Colors.borderSubtle }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontWeight: '700', fontSize: 12 }}>Mã lô: {lot.lotCode}</Text>
                      <Badge 
                        label={lot.quantityRemaining > 0 ? `Còn: ${lot.quantityRemaining}` : 'Hết hàng'} 
                        variant={lot.quantityRemaining > 0 ? 'success' : 'neutral'} 
                      />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={{ fontSize: 11, color: Colors.textMuted }}>Ngày nhập: {lot.purchaseDate}</Text>
                      <Text style={{ fontSize: 11, color: Colors.textMuted }}>Nhập ban đầu: {lot.quantityReceived}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={{ fontSize: 11, color: Colors.textSecondary }}>Đơn giá vốn nhập:</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#B45309' }}>{formatCurrency(lot.unitCost)}</Text>
                    </View>
                  </Card>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: TÙY CHỌN NGÀY LỌC BÁO CÁO                                       */}
      {/* ========================================================================= */}
      <Modal visible={customModalVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: 320 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📅 Chọn khoảng ngày tùy chọn</Text>
              <TouchableOpacity onPress={() => setCustomModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <View style={{ paddingVertical: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 }}>
                Từ ngày (YYYY-MM-DD):
              </Text>
              <TextInput
                style={styles.dateTextInput}
                value={tempStart}
                onChangeText={setTempStart}
                placeholder="2026-09-01"
              />

              <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginTop: 12, marginBottom: 4 }}>
                Đến ngày (YYYY-MM-DD):
              </Text>
              <TextInput
                style={styles.dateTextInput}
                value={tempEnd}
                onChangeText={setTempEnd}
                placeholder="2026-09-30"
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Button title="Hủy" variant="secondary" style={{ flex: 1 }} onPress={() => setCustomModalVisible(false)} />
              <Button title="Áp dụng lọc" variant="primary" style={{ flex: 1 }} onPress={handleApplyCustomPeriod} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textMain,
  },
  headerSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  periodBar: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
    backgroundColor: Colors.surface,
  },
  periodScroll: {
    paddingHorizontal: 12,
    gap: 6,
  },
  periodChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  periodChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  periodChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  periodChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  tabContainer: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  tabScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  tabBtn: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  activeTabText: {
    color: Colors.primary,
    fontWeight: '800',
  },
  contentScroll: {
    flex: 1,
  },
  scrollInner: {
    padding: 14,
    paddingBottom: 40,
  },
  tabSection: {
    gap: 12,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textMain,
    marginTop: 6,
    marginBottom: 4,
  },
  periodNoticeCard: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  periodNoticeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  periodNoticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMain,
  },
  periodComparisonTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
  },
  periodComparisonTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
  },
  periodNoticeSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  heroCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  heroPrimaryVal: {
    fontSize: 26,
    fontWeight: '900',
    color: Colors.primary,
    marginTop: 6,
  },
  heroSubDescription: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  heroRatioBarContainer: {
    marginTop: 12,
    marginBottom: 4,
  },
  heroRatioBarTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  heroRatioSegmentCogs: {
    backgroundColor: '#F59E0B',
  },
  heroRatioSegmentProfit: {
    backgroundColor: '#10B981',
  },
  heroRatioLegendRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  heroRatioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heroRatioLegendText: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  heroDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12,
  },
  heroPillarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroPillarItem: {
    flex: 1,
    alignItems: 'center',
  },
  heroPillarSeparator: {
    width: 1,
    height: 38,
    backgroundColor: '#E2E8F0',
  },
  heroPillarLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  heroProfitVal: {
    fontSize: 17,
    fontWeight: '800',
    color: '#059669',
    marginTop: 2,
  },
  heroMarginVal: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0D9488',
    marginTop: 2,
  },
  matrixContainer: {
    gap: 10,
    marginTop: 6,
  },
  matrixRow: {
    flexDirection: 'row',
    gap: 10,
  },
  matrixCard: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    justifyContent: 'space-between',
    minHeight: 106,
    marginBottom: 0,
  },
  matrixCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  matrixIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  matrixCardBody: {
    gap: 1,
  },
  matrixLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  matrixValue: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textMain,
    marginVertical: 1,
  },
  matrixSubText: {
    fontSize: 9,
    color: Colors.textMuted,
  },
  kpiValue: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textMain,
    marginVertical: 2,
  },
  kpiSubText: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  metricTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
  },
  metricTagText: {
    fontSize: 9,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  trendPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  trendPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  waterfallCard: {
    padding: 14,
    borderRadius: 12,
    gap: 4,
  },
  waterfallStep: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  waterfallStepLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  waterfallDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  waterfallLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  waterfallVal: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMain,
  },
  waterfallLine: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  waterfallFinalBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginTop: 6,
  },
  waterfallFinalLeft: {
    gap: 2,
  },
  waterfallFinalLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857',
    letterSpacing: 0.5,
  },
  waterfallFinalVal: {
    fontSize: 18,
    fontWeight: '900',
    color: '#065F46',
  },
  waterfallMarginBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#10B981',
  },
  waterfallMarginBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  alertEmptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    borderRadius: 10,
  },
  alertEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  alertEmptySub: {
    fontSize: 11,
    color: '#15803D',
    marginTop: 2,
  },
  chartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chartLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  alertCard: {
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 4,
  },
  alertDanger: {
    backgroundColor: '#FEF2F2',
    borderLeftColor: '#DC2626',
  },
  alertWarning: {
    backgroundColor: '#FFFBEB',
    borderLeftColor: '#D97706',
  },
  alertInfo: {
    backgroundColor: '#EFF6FF',
    borderLeftColor: '#2563EB',
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  alertMessage: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  subFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  subFilterLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  smallFilterPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  smallFilterPillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  smallFilterText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  smallFilterTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  timelineRowCard: {
    padding: 12,
    marginBottom: 8,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timelineDateText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMain,
  },
  metricGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  metricMiniCol: {
    flex: 1,
  },
  microLabel: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  microValueBold: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMain,
    marginTop: 1,
  },
  timelineFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    borderTopWidth: 1,
    borderColor: Colors.borderSubtle,
    paddingTop: 6,
  },
  timelineMarginText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  timelineAovText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  drilldownHintText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  kpiGrid2Col: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  miniKpiBox: {
    width: (SCREEN_WIDTH - 28 - 8) / 2,
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  miniKpiLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  miniKpiVal: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textMain,
    marginTop: 2,
  },
  topDiscountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
    gap: 8,
  },
  topDiscountRank: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    width: 20,
  },
  topDiscountName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMain,
  },
  topDiscountSub: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  topDiscountAmount: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.danger,
  },
  matrixDesc: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  matrixGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  matrixQuadrantBox: {
    width: (SCREEN_WIDTH - 28 - 8) / 2,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  matrixBoxTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  matrixBoxDesc: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginVertical: 2,
  },
  matrixSampleText: {
    fontSize: 10,
    color: Colors.textMain,
    fontWeight: '600',
    marginTop: 4,
  },
  categoryCard: {
    padding: 10,
    marginBottom: 8,
  },
  categoryNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMain,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryProgressBarBg: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: 4,
  },
  categoryProgressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  productSearchInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    marginBottom: 10,
    color: Colors.textMain,
  },
  productCard: {
    padding: 10,
    marginBottom: 8,
  },
  productCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMain,
  },
  productSkuSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginVertical: 2,
  },
  productFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    borderTopWidth: 1,
    borderColor: Colors.borderSubtle,
    paddingTop: 4,
  },
  rankBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankBadgeTop: {
    backgroundColor: '#FEF08A',
  },
  rankBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMain,
  },
  hourBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  hourBarLabelCol: {
    width: 110,
  },
  hourBarLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMain,
  },
  hourBarSub: {
    fontSize: 9,
    color: Colors.textMuted,
  },
  hourBarBg: {
    height: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  hourBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  hourBarVal: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMain,
  },
  hourBarMargin: {
    fontSize: 9,
    color: '#15803D',
    fontWeight: '600',
  },
  staffCard: {
    padding: 12,
    marginBottom: 8,
  },
  staffHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  staffNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMain,
  },
  staffSubText: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    maxHeight: '80%',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
    paddingBottom: 12,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textMain,
  },
  modalCloseText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  dateTextInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: Colors.textMain,
  },
});

export default ReportsScreen;
