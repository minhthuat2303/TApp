// T_SHOP Mobile - Analytics & Reporting Service
// Pure offline SQLite aggregation engine matching Web business logic 100%

import databaseService, { DatabaseService } from '../database/DatabaseService';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import { 
  DatePeriod, 
  DashboardSummaryData, 
  RevenueProfitTrendItem, 
  TopSellingItem, 
  SlowMovingItem, 
  SalesByDateItem,
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
  ProductLotDrilldownItem,
  MetricComparison,
  MarginComparison,
  BusinessAlertItem,
} from './types';
import logger from '../utils/logger';

export class AnalyticsService {
  private db: DatabaseService;
  private summaryCache = new Map<string, { data: DashboardSummaryData; timestamp: number }>();
  private trendCache = new Map<string, { data: RevenueProfitTrendItem[]; timestamp: number }>();
  private topSellingCache = new Map<string, { data: TopSellingItem[]; timestamp: number }>();
  private readonly CACHE_TTL_MS = 15000; // 15s cache TTL for instant 0ms response on UI tab switching

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  clearCache(): void {
    this.summaryCache.clear();
    this.trendCache.clear();
    this.topSellingCache.clear();
  }

  // Resolve ISO date strings (YYYY-MM-DD) for selected period
  resolveDateRange(period: DatePeriod, customStart?: string, customEnd?: string): {
    startDate: string;
    endDate: string;
    label: string;
  } {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (customStart && customEnd) {
      return {
        startDate: customStart,
        endDate: customEnd,
        label: `Tùy chọn (${customStart} - ${customEnd})`,
      };
    }

    switch (period) {
      case 'today': {
        const todayStr = toYMD(now);
        return { startDate: todayStr, endDate: todayStr, label: 'Hôm nay' };
      }
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const yStr = toYMD(y);
        return { startDate: yStr, endDate: yStr, label: 'Hôm qua' };
      }
      case '7days': {
        const past7 = new Date(now);
        past7.setDate(past7.getDate() - 6);
        return {
          startDate: toYMD(past7),
          endDate: toYMD(now),
          label: '7 ngày gần nhất',
        };
      }
      case '30days': {
        const past30 = new Date(now);
        past30.setDate(past30.getDate() - 29);
        return {
          startDate: toYMD(past30),
          endDate: toYMD(now),
          label: '30 ngày gần nhất',
        };
      }
      case 'this_week': {
        const day = now.getDay();
        const diff = (day === 0 ? -6 : 1) - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return {
          startDate: toYMD(monday),
          endDate: toYMD(sunday),
          label: 'Tuần này',
        };
      }
      case 'last_week': {
        const day = now.getDay();
        const diff = (day === 0 ? -6 : 1) - day - 7;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return {
          startDate: toYMD(monday),
          endDate: toYMD(sunday),
          label: 'Tuần trước',
        };
      }
      case 'this_month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return {
          startDate: toYMD(start),
          endDate: toYMD(end),
          label: `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`,
        };
      }
      case 'last_month': {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return {
          startDate: toYMD(start),
          endDate: toYMD(end),
          label: `Tháng ${start.getMonth() + 1}/${start.getFullYear()}`,
        };
      }
      case 'this_quarter': {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const start = new Date(now.getFullYear(), currentQuarter * 3, 1);
        const end = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
        return {
          startDate: toYMD(start),
          endDate: toYMD(end),
          label: `Quý ${currentQuarter + 1}/${now.getFullYear()}`,
        };
      }
      case 'last_quarter': {
        let prevQuarter = Math.floor(now.getMonth() / 3) - 1;
        let year = now.getFullYear();
        if (prevQuarter < 0) {
          prevQuarter = 3;
          year -= 1;
        }
        const start = new Date(year, prevQuarter * 3, 1);
        const end = new Date(year, (prevQuarter + 1) * 3, 0);
        return {
          startDate: toYMD(start),
          endDate: toYMD(end),
          label: `Quý ${prevQuarter + 1}/${year}`,
        };
      }
      case '6months': {
        const start = new Date(now);
        start.setDate(start.getDate() - 180);
        return {
          startDate: toYMD(start),
          endDate: toYMD(now),
          label: '6 tháng qua',
        };
      }
      case 'this_year': {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        return {
          startDate: toYMD(start),
          endDate: toYMD(end),
          label: `Năm ${now.getFullYear()}`,
        };
      }
      case 'last_year': {
        const year = now.getFullYear() - 1;
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);
        return {
          startDate: toYMD(start),
          endDate: toYMD(end),
          label: `Năm ${year}`,
        };
      }
      case 'all_time': {
        return {
          startDate: '1970-01-01',
          endDate: '2099-12-31',
          label: 'Toàn thời gian',
        };
      }
      default:
        return {
          startDate: toYMD(now),
          endDate: toYMD(now),
          label: 'Hôm nay',
        };
    }
  }

  // Resolve matching previous period for comparison (Kỳ trước liền kề)
  resolvePreviousDateRange(period: DatePeriod, currentStart: string, currentEnd: string): {
    startDate: string;
    endDate: string;
    label: string;
  } {
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (period === 'today') {
      const d = new Date(currentStart);
      d.setDate(d.getDate() - 1);
      const str = toYMD(d);
      return { startDate: str, endDate: str, label: 'Hôm qua' };
    }
    if (period === 'yesterday') {
      const d = new Date(currentStart);
      d.setDate(d.getDate() - 1);
      const str = toYMD(d);
      return { startDate: str, endDate: str, label: 'Hôm kia' };
    }
    if (period === 'this_week') {
      const start = new Date(currentStart);
      start.setDate(start.getDate() - 7);
      const end = new Date(currentEnd);
      end.setDate(end.getDate() - 7);
      return { startDate: toYMD(start), endDate: toYMD(end), label: 'Tuần trước' };
    }
    if (period === 'last_week') {
      const start = new Date(currentStart);
      start.setDate(start.getDate() - 7);
      const end = new Date(currentEnd);
      end.setDate(end.getDate() - 7);
      return { startDate: toYMD(start), endDate: toYMD(end), label: '2 tuần trước' };
    }
    if (period === 'this_month') {
      const parts = currentStart.split('-').map(Number);
      const curYear = parts[0];
      const curMonth = parts[1] - 1;
      const start = new Date(curYear, curMonth - 1, 1);
      const end = new Date(curYear, curMonth, 0);
      return { startDate: toYMD(start), endDate: toYMD(end), label: `Tháng ${start.getMonth() + 1}/${start.getFullYear()}` };
    }
    if (period === 'last_month') {
      const parts = currentStart.split('-').map(Number);
      const curYear = parts[0];
      const curMonth = parts[1] - 1;
      const start = new Date(curYear, curMonth - 1, 1);
      const end = new Date(curYear, curMonth, 0);
      return { startDate: toYMD(start), endDate: toYMD(end), label: `Tháng ${start.getMonth() + 1}/${start.getFullYear()}` };
    }
    if (period === 'this_year') {
      const year = Number(currentStart.slice(0, 4)) - 1;
      return { startDate: `${year}-01-01`, endDate: `${year}-12-31`, label: `Năm ${year}` };
    }
    if (period === 'last_year') {
      const year = Number(currentStart.slice(0, 4)) - 1;
      return { startDate: `${year}-01-01`, endDate: `${year}-12-31`, label: `Năm ${year}` };
    }
    if (period === 'all_time') {
      return { startDate: '1970-01-01', endDate: '1970-01-01', label: 'Không có kỳ trước' };
    }

    // Default fallback (for 7days, 30days, 6months, custom):
    const startMs = new Date(currentStart).getTime();
    const endMs = new Date(currentEnd).getTime();
    const diffDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

    const prevEnd = new Date(currentStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    return {
      startDate: toYMD(prevStart),
      endDate: toYMD(prevEnd),
      label: `Kỳ trước (${diffDays} ngày)`,
    };
  }

  // 1. Dashboard Financial & Stock KPI Summary
  async getDashboardSummary(period: DatePeriod = 'this_month', userId?: number, customStart?: string, customEnd?: string): Promise<DashboardSummaryData> {
    const { startDate, endDate, label } = this.resolveDateRange(period, customStart, customEnd);
    const now = Date.now();
    const cacheKey = `${period}:${startDate}:${endDate}:${userId || 'all'}`;

    // 1. Instant RAM Cache Hit (0ms)
    const cached = this.summaryCache.get(cacheKey);
    if (cached && (now - cached.timestamp < this.CACHE_TTL_MS)) {
      return cached.data;
    }

    // 2. Direct Online Query from Supabase Cloud API
    try {
      const res = await apiClient.get<any>(Endpoints.DASHBOARD_SUMMARY, {
        params: { period, startDate: customStart, endDate: customEnd }
      });
      if (res.data) {
        const d = res.data;
        const summary: DashboardSummaryData = {
          revenue: Number(d.revenue || 0),
          cogs: Number(d.cogs || 0),
          profit: Number(d.profit || 0),
          salesCount: Number(d.salesCount || 0),
          soldQuantity: Number(d.soldQuantity || 0),
          currentTotalStock: Number(d.currentTotalStock || 0),
          stockValuation: Number(d.stockValuation || 0),
          lowStockCount: Number(d.lowStockCount || 0),
          importsCount: 0,
          adjustmentsCount: 0,
          adjustmentsQuantity: 0,
          periodLabel: d.periodLabel || label,
          dateRange: {
            startDate,
            endDate,
            period,
          },
        };
        this.summaryCache.set(cacheKey, { data: summary, timestamp: now });
        return summary;
      }
    } catch (err) {
      logger.warn('AnalyticsService', 'Failed to fetch cloud dashboard summary, falling back to local SQLite', err);
    }

    // 3. Fallback to Local SQLite
    try {
      let salesSql = `
        SELECT 
          COUNT(CASE WHEN status = 'COMPLETED' THEN id END) as sales_count,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN quantity ELSE 0 END), 0) as sold_quantity,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_revenue ELSE 0 END), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_cost ELSE 0 END), 0) as total_cost,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN profit ELSE 0 END), 0) as total_profit
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ?
      `;
      const salesParams: any[] = [startDate, endDate];

      if (userId !== undefined) {
        salesSql += ' AND (created_by = ? OR created_by IS NULL)';
        salesParams.push(userId);
      }

      const [salesStats, stockStats, lotValuationRow, importStats, adjStats] = await Promise.all([
        this.db.queryOne<any>(salesSql, salesParams),
        this.db.queryOne<any>(`
          SELECT 
            COALESCE(SUM(current_stock), 0) as total_stock,
            COALESCE(SUM(CASE WHEN current_stock <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count
          FROM products
          WHERE status = 'ACTIVE'
        `),
        this.db.queryOne<any>(`
          SELECT 
            COALESCE(SUM(quantity_remaining * unit_cost), 0) as lot_valuation
          FROM inventory_lots
          WHERE quantity_remaining > 0
        `),
        this.db.queryOne<any>(`
          SELECT COUNT(id) as count
          FROM imports
          WHERE import_date >= ? AND import_date <= ?
        `, [startDate, endDate]),
        this.db.queryOne<any>(`
          SELECT 
            COUNT(id) as count,
            COALESCE(SUM(ABS(quantity_change)), 0) as total_quantity
          FROM stock_movements
          WHERE (
            reference_type = 'stock_adjustments' 
            OR movement_type IN ('ADJUSTMENT', 'DAMAGE', 'LOSS', 'GIFT', 'RETURN')
          )
          AND (
            (movement_date >= ? AND movement_date <= ?)
            OR (substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?)
          )
        `, [startDate, endDate, startDate, endDate]),
      ]);

      const currentTotalStock = Number(stockStats?.total_stock || 0);
      let stockValuation = Number(lotValuationRow?.lot_valuation || 0);

      // Fallback valuation if no active lots
      if (stockValuation <= 0 && currentTotalStock > 0) {
        const prodValuation = await this.db.queryOne<any>(`
          SELECT COALESCE(SUM(current_stock * current_cost_price), 0) as prod_val
          FROM products
          WHERE status = 'ACTIVE'
        `);
        stockValuation = Number(prodValuation?.prod_val || 0);
      }

      const localSummary: DashboardSummaryData = {
        revenue: Number(salesStats?.total_revenue || 0),
        cogs: Number(salesStats?.total_cost || 0),
        profit: Number(salesStats?.total_profit || 0),
        salesCount: Number(salesStats?.sales_count || 0),
        soldQuantity: Number(salesStats?.sold_quantity || 0),
        currentTotalStock,
        stockValuation,
        lowStockCount: Number(stockStats?.low_stock_count || 0),
        importsCount: Number(importStats?.count || 0),
        adjustmentsCount: Number(adjStats?.count || 0),
        adjustmentsQuantity: Number(adjStats?.total_quantity || 0),
        periodLabel: label,
        dateRange: {
          startDate,
          endDate,
          period,
        },
      };
      this.summaryCache.set(cacheKey, { data: localSummary, timestamp: now });
      return localSummary;
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get dashboard summary', err);
      return {
        revenue: 0,
        cogs: 0,
        profit: 0,
        salesCount: 0,
        soldQuantity: 0,
        currentTotalStock: 0,
        stockValuation: 0,
        lowStockCount: 0,
        importsCount: 0,
        adjustmentsCount: 0,
        adjustmentsQuantity: 0,
        periodLabel: label,
        dateRange: { startDate, endDate, period },
      };
    }
  }

  // 2. Revenue & Profit Trend Chart Data (Chronological daily breakdown)
  async getRevenueProfitTrend(period: DatePeriod = '30days', userId?: number): Promise<RevenueProfitTrendItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period);
    const now = Date.now();
    const cacheKey = `trend:${period}:${userId || 'all'}`;

    // 1. Instant RAM Cache Hit (0ms)
    const cached = this.trendCache.get(cacheKey);
    if (cached && (now - cached.timestamp < this.CACHE_TTL_MS)) {
      return cached.data;
    }

    // 2. Direct Online Query from Supabase Cloud API
    try {
      const res = await apiClient.get<any>(Endpoints.DASHBOARD_CHART_REVENUE_PROFIT, {
        params: { period, granularity: 'day' }
      });
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        const cloudTrend = res.data.map((item: any) => ({
          date: item.fullDate || item.timeKey,
          label: item.label,
          revenue: Number(item.revenue || 0),
          cogs: Math.max(0, Number(item.revenue || 0) - Number(item.profit || 0)),
          profit: Number(item.profit || 0),
          soldQuantity: Number(item.soldQuantity || 0),
          transactionCount: Number(item.transactionCount || 0),
        }));
        this.trendCache.set(cacheKey, { data: cloudTrend, timestamp: now });
        return cloudTrend;
      }
    } catch (err) {
      logger.warn('AnalyticsService', 'Failed to fetch cloud revenue profit trend, falling back to local SQLite', err);
    }

    // 3. Fallback to Local SQLite
    try {
      let sql = `
        SELECT 
          sale_date as time_key,
          COUNT(id) as transaction_count,
          COALESCE(SUM(quantity), 0) as sold_quantity,
          COALESCE(SUM(total_revenue), 0) as revenue,
          COALESCE(SUM(total_cost), 0) as total_cost,
          COALESCE(SUM(profit), 0) as profit
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        sql += ' AND (created_by = ? OR created_by IS NULL)';
        params.push(userId);
      }

      sql += ' GROUP BY sale_date ORDER BY sale_date ASC';

      const rows = await this.db.query<any>(sql, params);

      const localTrend = rows.map((r) => {
        const dateStr = String(r.time_key).slice(0, 10);
        const dayMonth = dateStr.slice(5).replace('-', '/');
        return {
          date: dateStr,
          label: dayMonth,
          revenue: Number(r.revenue || 0),
          cogs: Number(r.total_cost || 0),
          profit: Number(r.profit || 0),
          soldQuantity: Number(r.sold_quantity || 0),
          transactionCount: Number(r.transaction_count || 0),
        };
      });
      this.trendCache.set(cacheKey, { data: localTrend, timestamp: now });
      return localTrend;
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get revenue profit trend', err);
      return [];
    }
  }

  // 3. Top Selling Products (by Quantity & Revenue)
  async getTopSellingProducts(period: DatePeriod = 'this_month', limit = 10, userId?: number): Promise<TopSellingItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period);
    const now = Date.now();
    const cacheKey = `top:${period}:${limit}:${userId || 'all'}`;

    // 1. Instant RAM Cache Hit (0ms)
    const cached = this.topSellingCache.get(cacheKey);
    if (cached && (now - cached.timestamp < this.CACHE_TTL_MS)) {
      return cached.data;
    }

    // 2. Direct Online Query from Supabase Cloud API
    try {
      const res = await apiClient.get<any>(Endpoints.REPORTS_TOP_SELLING, {
        params: { period, limit }
      });
      if (res.data?.topSelling && Array.isArray(res.data.topSelling)) {
        const items = res.data.topSelling.map((r: any) => ({
          id: Number(r.id),
          sku: String(r.sku),
          name: String(r.name),
          category_name: r.category_name || undefined,
          product_type_name: r.product_type_name || undefined,
          sold_quantity: Number(r.sold_quantity || 0),
          total_revenue: Number(r.total_revenue || 0),
          total_profit: Number(r.total_profit || 0),
          current_stock: Number(r.current_stock || 0),
        }));
        this.topSellingCache.set(cacheKey, { data: items, timestamp: now });
        return items;
      }
    } catch (err) {
      logger.warn('AnalyticsService', 'Failed to fetch cloud top selling products, falling back to local SQLite', err);
    }

    // 3. Fallback to Local SQLite
    try {
      let sql = `
        SELECT 
          p.id, p.sku, p.name,
          c.name as category_name,
          pt.name as product_type_name,
          COALESCE(SUM(sr.quantity), 0) as sold_quantity,
          COALESCE(SUM(sr.total_revenue), 0) as total_revenue,
          COALESCE(SUM(sr.profit), 0) as total_profit,
          p.current_stock
        FROM sales_records sr
        JOIN products p ON p.id = sr.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_types pt ON pt.id = p.product_type_id
        WHERE sr.sale_date >= ? AND sr.sale_date <= ? AND status = 'COMPLETED'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        sql += ' AND (sr.created_by = ? OR sr.created_by IS NULL)';
        params.push(userId);
      }

      sql += `
        GROUP BY p.id, p.sku, p.name, c.name, pt.name, p.current_stock
        ORDER BY sold_quantity DESC, total_revenue DESC
        LIMIT ?
      `;
      params.push(limit);

      const rows = await this.db.query<any>(sql, params);

      const localItems = rows.map((r) => ({
        id: Number(r.id),
        sku: String(r.sku),
        name: String(r.name),
        category_name: r.category_name || undefined,
        product_type_name: r.product_type_name || undefined,
        sold_quantity: Number(r.sold_quantity || 0),
        total_revenue: Number(r.total_revenue || 0),
        total_profit: Number(r.total_profit || 0),
        current_stock: Number(r.current_stock || 0),
      }));
      this.topSellingCache.set(cacheKey, { data: localItems, timestamp: now });
      return localItems;
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get top selling products', err);
      return [];
    }
  }

  // 4. Slow Moving Products (Active products with zero sales in period)
  async getSlowMovingProducts(period: DatePeriod = 'this_month', limit = 10): Promise<SlowMovingItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period);

    // 1. Direct Online Query from Supabase Cloud API
    try {
      const res = await apiClient.get<any>(Endpoints.REPORTS_TOP_SELLING, {
        params: { period, limit }
      });
      if (res.data?.slowMoving && Array.isArray(res.data.slowMoving)) {
        return res.data.slowMoving.map((r: any) => ({
          id: Number(r.id),
          sku: String(r.sku),
          name: String(r.name),
          current_stock: Number(r.current_stock || 0),
          current_cost_price: Number(r.current_cost_price || 0),
          stock_valuation: Number(r.stock_valuation || 0),
          category_name: r.category_name || undefined,
          product_type_name: r.product_type_name || undefined,
        }));
      }
    } catch (err) {
      logger.warn('AnalyticsService', 'Failed to fetch cloud slow moving products, falling back to local SQLite', err);
    }

    // 2. Fallback to Local SQLite
    try {
      const sql = `
        SELECT 
          p.id, p.sku, p.name, p.current_stock, p.current_cost_price,
          (p.current_stock * p.current_cost_price) as stock_valuation,
          c.name as category_name,
          pt.name as product_type_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_types pt ON pt.id = p.product_type_id
        WHERE p.status = 'ACTIVE'
          AND p.id NOT IN (
            SELECT DISTINCT product_id 
            FROM sales_records 
            WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
          )
        ORDER BY p.current_stock DESC
        LIMIT ?
      `;

      const rows = await this.db.query<any>(sql, [startDate, endDate, limit]);

      return rows.map((r) => ({
        id: Number(r.id),
        sku: String(r.sku),
        name: String(r.name),
        category_name: r.category_name || undefined,
        product_type_name: r.product_type_name || undefined,
        current_stock: Number(r.current_stock || 0),
        current_cost_price: Number(r.current_cost_price || 0),
        stock_valuation: Number(r.stock_valuation || 0),
      }));
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get slow moving products', err);
      return [];
    }
  }

  // 5. Tabular Sales Report by Date
  async getSalesByDateReport(period: DatePeriod = '30days', userId?: number): Promise<SalesByDateItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period);

    try {
      let sql = `
        SELECT 
          sale_date,
          COUNT(id) as order_count,
          COALESCE(SUM(quantity), 0) as total_quantity,
          COALESCE(SUM(total_revenue), 0) as total_revenue,
          COALESCE(SUM(total_cost), 0) as total_cost,
          COALESCE(SUM(profit), 0) as total_profit
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        sql += ' AND (created_by = ? OR created_by IS NULL)';
        params.push(userId);
      }

      sql += ' GROUP BY sale_date ORDER BY sale_date DESC';

      const rows = await this.db.query<any>(sql, params);

      return rows.map((r) => ({
        sale_date: String(r.sale_date).slice(0, 10),
        order_count: Number(r.order_count || 0),
        total_quantity: Number(r.total_quantity || 0),
        total_revenue: Number(r.total_revenue || 0),
        total_cost: Number(r.total_cost || 0),
        total_profit: Number(r.total_profit || 0),
      }));
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get sales by date report', err);
      return [];
    }
  }

  // --- ENHANCED REPORTS & PERFORMANCE SUITE ---

  // Helper: Calculate metric comparison between current and previous period
  private calculateMetricComp(current: number, previous: number): MetricComparison {
    const changeValue = current - previous;
    let changePercent = 0;
    if (previous > 0) {
      changePercent = Math.round(((current - previous) / previous) * 1000) / 10;
    } else if (current > 0) {
      changePercent = 100;
    }
    const trend: 'UP' | 'DOWN' | 'FLAT' = changeValue > 0.001 ? 'UP' : changeValue < -0.001 ? 'DOWN' : 'FLAT';
    return { current, previous, changeValue, changePercent, trend };
  }

  // Helper: Calculate margin percentage points comparison (Điểm %)
  private calculateMarginComp(currGrossProfit: number, currNetRevenue: number, prevGrossProfit: number, prevNetRevenue: number): MarginComparison {
    const currentMargin = currNetRevenue > 0 ? Math.round((currGrossProfit / currNetRevenue) * 1000) / 10 : 0;
    const previousMargin = prevNetRevenue > 0 ? Math.round((prevGrossProfit / prevNetRevenue) * 1000) / 10 : 0;
    const percentagePointsChange = Math.round((currentMargin - previousMargin) * 10) / 10;
    const trend: 'UP' | 'DOWN' | 'FLAT' = percentagePointsChange > 0.05 ? 'UP' : percentagePointsChange < -0.05 ? 'DOWN' : 'FLAT';
    return { currentMargin, previousMargin, percentagePointsChange, trend };
  }

  // 7. Tab 1: Comprehensive Executive Report Overview (9 KPIs, Comparison, Waterfall & Alerts)
  async getReportOverview(period: DatePeriod = 'this_month', customStart?: string, customEnd?: string, userId?: number): Promise<ReportOverviewData> {
    const curRange = this.resolveDateRange(period, customStart, customEnd);
    const prevRange = this.resolvePreviousDateRange(period, curRange.startDate, curRange.endDate);

    try {
      // 1. Current period metrics
      let curSql = `
        SELECT 
          COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(discount), 0) as total_discount,
          COALESCE(SUM(total_revenue), 0) as net_revenue,
          COALESCE(SUM(total_cost), 0) as total_cogs,
          COALESCE(SUM(profit), 0) as gross_profit,
          COALESCE(SUM(quantity), 0) as units_sold,
          COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as orders_count
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const curParams: any[] = [curRange.startDate, curRange.endDate];
      if (userId !== undefined) {
        curSql += ' AND (created_by = ? OR created_by IS NULL)';
        curParams.push(userId);
      }

      // 2. Previous period metrics
      let prevSql = `
        SELECT 
          COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(discount), 0) as total_discount,
          COALESCE(SUM(total_revenue), 0) as net_revenue,
          COALESCE(SUM(total_cost), 0) as total_cogs,
          COALESCE(SUM(profit), 0) as gross_profit,
          COALESCE(SUM(quantity), 0) as units_sold,
          COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as orders_count
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const prevParams: any[] = [prevRange.startDate, prevRange.endDate];
      if (userId !== undefined) {
        prevSql += ' AND (created_by = ? OR created_by IS NULL)';
        prevParams.push(userId);
      }

      const [curRow, prevRow, trendData, lowStockList, slowMovingList] = await Promise.all([
        this.db.queryOne<any>(curSql, curParams),
        this.db.queryOne<any>(prevSql, prevParams),
        this.getRevenueProfitTrend(period, userId),
        this.getLowStockProducts(5),
        this.getSlowMovingProducts(period, 5),
      ]);

      const netRevenue = Number(curRow?.net_revenue ?? curRow?.total_revenue ?? 0);
      const discount = Number(curRow?.total_discount ?? curRow?.discount ?? 0);
      const grossSales = Number(curRow?.gross_sales ?? (netRevenue + discount));
      const cogs = Number(curRow?.total_cogs ?? curRow?.total_cost ?? curRow?.cogs ?? 0);
      const grossProfit = Number(curRow?.gross_profit ?? curRow?.total_profit ?? curRow?.profit ?? 0);
      const unitsSold = Number(curRow?.units_sold ?? curRow?.sold_quantity ?? 0);
      const ordersCount = Number(curRow?.orders_count ?? curRow?.sales_count ?? 0);
      const margin = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 1000) / 10 : 0;
      const aov = ordersCount > 0 ? Math.round(netRevenue / ordersCount) : 0;
      const unitsPerOrder = ordersCount > 0 ? Math.round((unitsSold / ordersCount) * 10) / 10 : 0;

      const prevNetRevenue = Number(prevRow?.net_revenue ?? prevRow?.total_revenue ?? 0);
      const prevGrossProfit = Number(prevRow?.gross_profit ?? prevRow?.total_profit ?? prevRow?.profit ?? 0);
      const prevOrdersCount = Number(prevRow?.orders_count ?? prevRow?.sales_count ?? 0);
      const prevAov = prevOrdersCount > 0 ? Math.round(prevNetRevenue / prevOrdersCount) : 0;

      const comparisons = {
        netRevenue: this.calculateMetricComp(netRevenue, prevNetRevenue),
        grossProfit: this.calculateMetricComp(grossProfit, prevGrossProfit),
        ordersCount: this.calculateMetricComp(ordersCount, prevOrdersCount),
        aov: this.calculateMetricComp(aov, prevAov),
        margin: this.calculateMarginComp(grossProfit, netRevenue, prevGrossProfit, prevNetRevenue),
      };

      // 3. Generate Business Alerts
      const alerts: BusinessAlertItem[] = [];

      // Alert 1: Sụt giảm doanh thu > 15%
      if (prevNetRevenue > 0 && comparisons.netRevenue.changePercent < -15) {
        alerts.push({
          id: 'alert_rev_drop',
          type: 'DANGER',
          severity: 'HIGH',
          title: 'Doanh thu sụt giảm mạnh',
          message: `Doanh thu giảm ${Math.abs(comparisons.netRevenue.changePercent)}% so với ${prevRange.label}. Cần rà soát các mặt hàng chủ lực hoặc đẩy mạnh chương trình bán lẻ.`,
          metric: `${comparisons.netRevenue.changePercent}%`,
        });
      }

      // Alert 2: Sụt giảm biên lợi nhuận > 3 điểm %
      if (comparisons.margin.percentagePointsChange < -3) {
        alerts.push({
          id: 'alert_margin_drop',
          type: 'WARNING',
          severity: 'HIGH',
          title: 'Biên lợi nhuận gộp suy giảm',
          message: `Biên lợi nhuận sụt giảm ${Math.abs(comparisons.margin.percentagePointsChange)} điểm % so với kỳ trước. Giá vốn nhập hoặc chiết khấu có dấu hiệu tăng.`,
          metric: `${comparisons.margin.percentagePointsChange} pp`,
        });
      }

      // Alert 3: Tỷ lệ chiết khấu cao bất thường (> 10% doanh thu trước giảm giá)
      if (grossSales > 0 && (discount / grossSales) > 0.10) {
        const discountRatio = Math.round((discount / grossSales) * 100);
        alerts.push({
          id: 'alert_discount_high',
          type: 'WARNING',
          severity: 'MEDIUM',
          title: 'Chiết khấu chiếm tỷ trọng cao',
          message: `Tổng tiền giảm giá chiếm ${discountRatio}% doanh thu gộp. Cần kiểm soát các ưu đãi vượt định mức.`,
          metric: `${discountRatio}%`,
        });
      }

      // Alert 4: Sản phẩm sắp hết hàng
      if (lowStockList.length > 0) {
        alerts.push({
          id: 'alert_low_stock',
          type: 'WARNING',
          severity: 'MEDIUM',
          title: 'Cảnh báo tồn kho cạn',
          message: `Có ${lowStockList.length} mặt hàng đã chạm hoặc dưới định mức tồn tối thiểu (${lowStockList.map(i => i.name).slice(0, 2).join(', ')}...).`,
          metric: `${lowStockList.length} món`,
        });
      }

      // Alert 5: Hàng ứ đọng vốn lâu ngày
      if (slowMovingList.length > 0) {
        const totalDeadValuation = slowMovingList.reduce((acc, it) => acc + it.stock_valuation, 0);
        alerts.push({
          id: 'alert_dead_stock',
          type: 'INFO',
          severity: 'LOW',
          title: 'Hàng tồn kho đọng vốn',
          message: `Phát hiện ${slowMovingList.length} sản phẩm không phát sinh đơn bán trong kỳ, đang giữ ${totalDeadValuation.toLocaleString('vi-VN')}đ tiền vốn.`,
          metric: `${slowMovingList.length} sản phẩm`,
        });
      }

      return {
        grossSales,
        discount,
        netRevenue,
        cogs,
        grossProfit,
        margin,
        ordersCount,
        unitsSold,
        aov,
        unitsPerOrder,
        comparisons,
        trend: trendData,
        alerts,
        periodLabel: curRange.label,
        previousPeriodLabel: prevRange.label,
        startDate: curRange.startDate,
        endDate: curRange.endDate,
        previousStartDate: prevRange.startDate,
        previousEndDate: prevRange.endDate,
      };
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get report overview', err);
      return {
        grossSales: 0,
        discount: 0,
        netRevenue: 0,
        cogs: 0,
        grossProfit: 0,
        margin: 0,
        ordersCount: 0,
        unitsSold: 0,
        aov: 0,
        unitsPerOrder: 0,
        comparisons: {
          netRevenue: { current: 0, previous: 0, changeValue: 0, changePercent: 0, trend: 'FLAT' },
          grossProfit: { current: 0, previous: 0, changeValue: 0, changePercent: 0, trend: 'FLAT' },
          ordersCount: { current: 0, previous: 0, changeValue: 0, changePercent: 0, trend: 'FLAT' },
          aov: { current: 0, previous: 0, changeValue: 0, changePercent: 0, trend: 'FLAT' },
          margin: { currentMargin: 0, previousMargin: 0, percentagePointsChange: 0, trend: 'FLAT' },
        },
        trend: [],
        alerts: [],
        periodLabel: curRange.label,
        previousPeriodLabel: prevRange.label,
        startDate: curRange.startDate,
        endDate: curRange.endDate,
        previousStartDate: prevRange.startDate,
        previousEndDate: prevRange.endDate,
      };
    }
  }

  // 8. Tab 2: Detailed Sales & Profit Timeline (Day / Week / Month Granularity)
  async getDetailedSalesTimeline(
    period: DatePeriod = 'this_month',
    granularity: 'day' | 'week' | 'month' = 'day',
    customStart?: string,
    customEnd?: string,
    userId?: number
  ): Promise<DetailedSalesRowItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      let groupExpr = 'sale_date';
      if (granularity === 'week') {
        groupExpr = "strftime('%Y-W%W', sale_date)";
      } else if (granularity === 'month') {
        groupExpr = "strftime('%Y-%m', sale_date)";
      }

      let sql = `
        SELECT 
          ${groupExpr} as time_key,
          sale_date,
          COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(discount), 0) as total_discount,
          COALESCE(SUM(total_revenue), 0) as net_revenue,
          COALESCE(SUM(total_cost), 0) as total_cogs,
          COALESCE(SUM(profit), 0) as gross_profit,
          COALESCE(SUM(quantity), 0) as units_sold,
          COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as orders_count
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        sql += ' AND (created_by = ? OR created_by IS NULL)';
        params.push(userId);
      }

      sql += ` GROUP BY ${groupExpr} ORDER BY ${groupExpr} DESC`;

      const rows = await this.db.query<any>(sql, params);

      return rows.map((r) => {
        const netRev = Number(r.net_revenue || 0);
        const profit = Number(r.gross_profit || 0);
        const orders = Number(r.orders_count || 0);
        const margin = netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0;
        const aov = orders > 0 ? Math.round(netRev / orders) : 0;

        let label = String(r.time_key);
        if (granularity === 'day') {
          const parts = label.slice(0, 10).split('-');
          label = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : label;
        } else if (granularity === 'month') {
          const parts = label.split('-');
          label = parts.length === 2 ? `Tháng ${parts[1]}/${parts[0]}` : label;
        } else if (granularity === 'week') {
          label = `Tuần ${label.replace(/^.*-W/, '')}`;
        }

        return {
          timeKey: String(r.time_key),
          label,
          grossSales: Number(r.gross_sales || 0),
          discount: Number(r.total_discount || 0),
          netRevenue: netRev,
          cogs: Number(r.total_cogs || 0),
          grossProfit: profit,
          margin,
          ordersCount: orders,
          unitsSold: Number(r.units_sold || 0),
          aov,
        };
      });
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get detailed sales timeline', err);
      return [];
    }
  }

  // 9. Tab 2: Discount Breakdown Analysis
  async getDiscountAnalysis(period: DatePeriod = 'this_month', customStart?: string, customEnd?: string, userId?: number): Promise<DiscountAnalysisData> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      let baseSql = `
        SELECT 
          COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(discount), 0) as total_discount,
          COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as total_orders,
          COUNT(DISTINCT CASE WHEN discount > 0 THEN COALESCE(client_order_id, transaction_code) END) as discounted_orders
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const baseParams: any[] = [startDate, endDate];
      if (userId !== undefined) {
        baseSql += ' AND (created_by = ? OR created_by IS NULL)';
        baseParams.push(userId);
      }

      let topDiscSql = `
        SELECT 
          p.id as product_id,
          p.name,
          p.sku,
          COALESCE(SUM(sr.discount), 0) as discount_total,
          COALESCE(SUM(CASE WHEN sr.discount > 0 THEN sr.quantity ELSE 0 END), 0) as units_discounted
        FROM sales_records sr
        JOIN products p ON p.id = sr.product_id
        WHERE sr.sale_date >= ? AND sr.sale_date <= ? AND sr.status = 'COMPLETED' AND sr.discount > 0
      `;
      const topDiscParams: any[] = [startDate, endDate];
      if (userId !== undefined) {
        topDiscSql += ' AND (sr.created_by = ? OR sr.created_by IS NULL)';
        topDiscParams.push(userId);
      }
      topDiscSql += ' GROUP BY p.id, p.name, p.sku ORDER BY discount_total DESC LIMIT 5';

      const [summaryRow, topRows] = await Promise.all([
        this.db.queryOne<any>(baseSql, baseParams),
        this.db.query<any>(topDiscSql, topDiscParams),
      ]);

      const grossSales = Number(summaryRow?.gross_sales || 0);
      const totalDiscount = Number(summaryRow?.total_discount || 0);
      const ordersTotalCount = Number(summaryRow?.total_orders || 0);
      const ordersWithDiscountCount = Number(summaryRow?.discounted_orders || 0);

      const ordersWithDiscountPercent = ordersTotalCount > 0 ? Math.round((ordersWithDiscountCount / ordersTotalCount) * 1000) / 10 : 0;
      const avgDiscountPerDiscountedOrder = ordersWithDiscountCount > 0 ? Math.round(totalDiscount / ordersWithDiscountCount) : 0;
      const avgDiscountPerTotalOrder = ordersTotalCount > 0 ? Math.round(totalDiscount / ordersTotalCount) : 0;
      const discountToRevenueRatio = grossSales > 0 ? Math.round((totalDiscount / grossSales) * 1000) / 10 : 0;

      return {
        totalDiscount,
        ordersWithDiscountCount,
        ordersTotalCount,
        ordersWithDiscountPercent,
        avgDiscountPerDiscountedOrder,
        avgDiscountPerTotalOrder,
        discountToRevenueRatio,
        topDiscountedProducts: topRows.map((r) => ({
          productId: Number(r.product_id),
          name: String(r.name),
          sku: String(r.sku),
          discountTotal: Number(r.discount_total || 0),
          unitsDiscounted: Number(r.units_discounted || 0),
        })),
      };
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get discount analysis', err);
      return {
        totalDiscount: 0,
        ordersWithDiscountCount: 0,
        ordersTotalCount: 0,
        ordersWithDiscountPercent: 0,
        avgDiscountPerDiscountedOrder: 0,
        avgDiscountPerTotalOrder: 0,
        discountToRevenueRatio: 0,
        topDiscountedProducts: [],
      };
    }
  }

  // 10. Tab 3: Product Performance & Ranking
  async getProductPerformance(
    period: DatePeriod = 'this_month',
    sortBy: 'revenue' | 'profit' | 'margin' | 'quantity' | 'slow' = 'revenue',
    filterType: 'all' | 'low_margin' | 'slow' = 'all',
    customStart?: string,
    customEnd?: string,
    userId?: number
  ): Promise<ProductPerformanceItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      let sql = `
        SELECT 
          p.id, p.sku, p.name,
          c.name as category_name,
          pt.name as product_type_name,
          COALESCE(SUM(sr.quantity), 0) as sold_quantity,
          COALESCE(SUM(sr.quantity * sr.unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(sr.discount), 0) as discount,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.total_cost), 0) as cogs,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          p.current_stock
        FROM products p
        LEFT JOIN sales_records sr ON sr.product_id = p.id 
          AND sr.sale_date >= ? AND sr.sale_date <= ? 
          AND sr.status = 'COMPLETED'
          ${userId !== undefined ? 'AND (sr.created_by = ? OR sr.created_by IS NULL)' : ''}
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_types pt ON pt.id = p.product_type_id
        WHERE p.status = 'ACTIVE'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        params.push(userId);
      }

      sql += ' GROUP BY p.id, p.sku, p.name, c.name, pt.name, p.current_stock';

      const rows = await this.db.query<any>(sql, params);

      let items: ProductPerformanceItem[] = rows.map((r) => {
        const netRev = Number(r.net_revenue ?? r.total_revenue ?? 0);
        const disc = Number(r.discount ?? 0);
        const gross = Number(r.gross_sales ?? (netRev + disc));
        const cogs = Number(r.cogs ?? r.total_cost ?? 0);
        const profit = Number(r.gross_profit ?? r.total_profit ?? r.profit ?? 0);
        const margin = netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0;

        return {
          id: Number(r.id),
          sku: String(r.sku || ''),
          name: String(r.name || ''),
          categoryName: r.category_name || r.categoryName || 'Chưa phân loại',
          productTypeName: r.product_type_name || r.productTypeName || 'Tiêu chuẩn',
          soldQuantity: Number(r.sold_quantity ?? r.quantity ?? 0),
          grossSales: gross,
          discount: disc,
          netRevenue: netRev,
          cogs,
          grossProfit: profit,
          margin,
          currentStock: Number(r.current_stock ?? 0),
        };
      });

      // Filters
      if (filterType === 'low_margin') {
        items = items.filter(it => it.soldQuantity > 0 && it.margin < 15);
      } else if (filterType === 'slow') {
        items = items.filter(it => it.soldQuantity === 0);
      }

      // Sort
      items.sort((a, b) => {
        if (sortBy === 'profit') return b.grossProfit - a.grossProfit;
        if (sortBy === 'margin') return b.margin - a.margin;
        if (sortBy === 'quantity') return b.soldQuantity - a.soldQuantity;
        if (sortBy === 'slow') return b.currentStock - a.currentStock;
        return b.netRevenue - a.netRevenue;
      });

      return items;
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get product performance', err);
      return [];
    }
  }

  // 11. Tab 3: Category Performance Breakdown
  async getCategoryPerformance(
    period: DatePeriod = 'this_month',
    customStart?: string,
    customEnd?: string,
    userId?: number
  ): Promise<CategoryPerformanceItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      let sql = `
        SELECT 
          c.id as category_id,
          c.name as category_name,
          c.code as category_code,
          COUNT(DISTINCT p.id) as product_count,
          COALESCE(SUM(sr.quantity), 0) as sold_quantity,
          COALESCE(SUM(sr.quantity * sr.unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(sr.discount), 0) as discount,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.total_cost), 0) as cogs,
          COALESCE(SUM(sr.profit), 0) as gross_profit
        FROM categories c
        JOIN products p ON p.category_id = c.id
        LEFT JOIN sales_records sr ON sr.product_id = p.id 
          AND sr.sale_date >= ? AND sr.sale_date <= ? 
          AND sr.status = 'COMPLETED'
          ${userId !== undefined ? 'AND (sr.created_by = ? OR sr.created_by IS NULL)' : ''}
        WHERE c.status = 'ACTIVE'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        params.push(userId);
      }

      sql += ' GROUP BY c.id, c.name, c.code ORDER BY net_revenue DESC';

      const rows = await this.db.query<any>(sql, params);
      const totalStoreRevenue = rows.reduce((sum, r) => sum + Number(r.net_revenue ?? r.total_revenue ?? 0), 0);

      return rows.map((r) => {
        const netRev = Number(r.net_revenue ?? r.total_revenue ?? 0);
        const disc = Number(r.discount ?? 0);
        const gross = Number(r.gross_sales ?? (netRev + disc));
        const cogs = Number(r.cogs ?? r.total_cost ?? 0);
        const profit = Number(r.gross_profit ?? r.total_profit ?? r.profit ?? 0);
        const margin = netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0;
        const revenueSharePercent = totalStoreRevenue > 0 ? Math.round((netRev / totalStoreRevenue) * 1000) / 10 : 0;

        return {
          categoryId: Number(r.category_id ?? r.id ?? 0),
          categoryName: String(r.category_name ?? r.name ?? 'Chưa phân loại'),
          categoryCode: String(r.category_code ?? r.code ?? ''),
          productCount: Number(r.product_count ?? 0),
          soldQuantity: Number(r.sold_quantity ?? r.quantity ?? 0),
          grossSales: gross,
          discount: disc,
          netRevenue: netRev,
          cogs,
          grossProfit: profit,
          margin,
          revenueSharePercent,
        };
      });
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get category performance', err);
      return [];
    }
  }

  // 12. Tab 3: Profitability Matrix (BCG-style Revenue vs Profit Analysis)
  async getProfitabilityMatrix(
    period: DatePeriod = 'this_month',
    customStart?: string,
    customEnd?: string,
    userId?: number
  ): Promise<ProfitabilityMatrixData> {
    const products = await this.getProductPerformance(period, 'revenue', 'all', customStart, customEnd, userId);
    const activeProducts = products.filter(p => p.soldQuantity > 0);

    if (activeProducts.length === 0) {
      return {
        avgRevenue: 0,
        avgProfit: 0,
        totalProductsCount: 0,
        stars: [],
        highVolumeLowMargin: [],
        potentials: [],
        lowPerformers: [],
      };
    }

    const totalRev = activeProducts.reduce((sum, p) => sum + p.netRevenue, 0);
    const totalProf = activeProducts.reduce((sum, p) => sum + p.grossProfit, 0);
    const avgRevenue = Math.round(totalRev / activeProducts.length);
    const avgProfit = Math.round(totalProf / activeProducts.length);

    const stars: ProductPerformanceItem[] = [];
    const highVolumeLowMargin: ProductPerformanceItem[] = [];
    const potentials: ProductPerformanceItem[] = [];
    const lowPerformers: ProductPerformanceItem[] = [];

    for (const p of activeProducts) {
      if (p.netRevenue >= avgRevenue && p.grossProfit >= avgProfit) {
        p.quadrant = 'STAR';
        stars.push(p);
      } else if (p.netRevenue >= avgRevenue && p.grossProfit < avgProfit) {
        p.quadrant = 'CASH_COW';
        highVolumeLowMargin.push(p);
      } else if (p.netRevenue < avgRevenue && p.grossProfit >= avgProfit) {
        p.quadrant = 'QUESTION';
        potentials.push(p);
      } else {
        p.quadrant = 'DOG';
        lowPerformers.push(p);
      }
    }

    return {
      avgRevenue,
      avgProfit,
      totalProductsCount: activeProducts.length,
      stars,
      highVolumeLowMargin,
      potentials,
      lowPerformers,
    };
  }

  // 13. Tab 4: Hourly Sales Performance
  async getHourlyPerformance(
    period: DatePeriod = 'this_month',
    customStart?: string,
    customEnd?: string,
    userId?: number
  ): Promise<HourlyPerformanceItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      let sql = `
        SELECT 
          CAST(strftime('%H', created_at) AS INTEGER) as hour_of_day,
          COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as orders_count,
          COALESCE(SUM(total_revenue), 0) as net_revenue,
          COALESCE(SUM(profit), 0) as gross_profit,
          COALESCE(SUM(quantity), 0) as units_sold
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        sql += ' AND (created_by = ? OR created_by IS NULL)';
        params.push(userId);
      }

      sql += ' GROUP BY hour_of_day ORDER BY hour_of_day ASC';

      const rows = await this.db.query<any>(sql, params);
      const hourMap = new Map<number, { orders: number; revenue: number; profit: number; units: number }>();
      for (const r of rows) {
        hourMap.set(Number(r.hour_of_day), {
          orders: Number(r.orders_count || 0),
          revenue: Number(r.net_revenue || 0),
          profit: Number(r.gross_profit || 0),
          units: Number(r.units_sold || 0),
        });
      }

      // Retail slots
      const slots = [
        { start: 6, end: 9, label: '06:00 - 09:00 (Sáng sớm)' },
        { start: 9, end: 12, label: '09:00 - 12:00 (Sáng)' },
        { start: 12, end: 15, label: '12:00 - 15:00 (Trưa)' },
        { start: 15, end: 18, label: '15:00 - 18:00 (Chiều)' },
        { start: 18, end: 21, label: '18:00 - 21:00 (Tối)' },
        { start: 21, end: 24, label: '21:00 - 24:00 (Đêm)' },
      ];

      return slots.map(slot => {
        let orders = 0;
        let revenue = 0;
        let profit = 0;
        let units = 0;

        for (let h = slot.start; h < slot.end; h++) {
          const data = hourMap.get(h);
          if (data) {
            orders += data.orders;
            revenue += data.revenue;
            profit += data.profit;
            units += data.units;
          }
        }

        const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
        return {
          hourRange: slot.label,
          hourStart: slot.start,
          hourEnd: slot.end,
          ordersCount: orders,
          netRevenue: revenue,
          grossProfit: profit,
          margin,
          unitsSold: units,
        };
      });
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get hourly performance', err);
      return [];
    }
  }

  // 14. Tab 4: Weekday Sales Performance
  async getWeekdayPerformance(
    period: DatePeriod = 'this_month',
    customStart?: string,
    customEnd?: string,
    userId?: number
  ): Promise<WeekdayPerformanceItem[]> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      let sql = `
        SELECT 
          CAST(strftime('%w', sale_date) AS INTEGER) as day_of_week,
          COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as orders_count,
          COALESCE(SUM(total_revenue), 0) as net_revenue,
          COALESCE(SUM(profit), 0) as gross_profit,
          COALESCE(SUM(quantity), 0) as units_sold
        FROM sales_records
        WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
      `;
      const params: any[] = [startDate, endDate];

      if (userId !== undefined) {
        sql += ' AND (created_by = ? OR created_by IS NULL)';
        params.push(userId);
      }

      sql += ' GROUP BY day_of_week ORDER BY day_of_week ASC';

      const rows = await this.db.query<any>(sql, params);
      const dayMap = new Map<number, { orders: number; revenue: number; profit: number; units: number }>();
      for (const r of rows) {
        dayMap.set(Number(r.day_of_week), {
          orders: Number(r.orders_count || 0),
          revenue: Number(r.net_revenue || 0),
          profit: Number(r.gross_profit || 0),
          units: Number(r.units_sold || 0),
        });
      }

      // SQLite %w: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const dayOrder = [
        { dow: 1, name: 'Thứ Hai' },
        { dow: 2, name: 'Thứ Ba' },
        { dow: 3, name: 'Thứ Tư' },
        { dow: 4, name: 'Thứ Năm' },
        { dow: 5, name: 'Thứ Sáu' },
        { dow: 6, name: 'Thứ Bảy' },
        { dow: 0, name: 'Chủ Nhật' },
      ];

      return dayOrder.map(item => {
        const data = dayMap.get(item.dow) || { orders: 0, revenue: 0, profit: 0, units: 0 };
        const margin = data.revenue > 0 ? Math.round((data.profit / data.revenue) * 1000) / 10 : 0;
        const aov = data.orders > 0 ? Math.round(data.revenue / data.orders) : 0;

        return {
          dayOfWeek: item.dow,
          dayName: item.name,
          ordersCount: data.orders,
          netRevenue: data.revenue,
          grossProfit: data.profit,
          margin,
          unitsSold: data.units,
          aov,
        };
      });
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get weekday performance', err);
      return [];
    }
  }

  // 15. Tab 4: Staff Sales Performance
  async getStaffPerformance(period: DatePeriod = 'this_month', customStart?: string, customEnd?: string): Promise<{ hasData: boolean; staff: StaffPerformanceItem[] }> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      const sql = `
        SELECT 
          COALESCE(u.id, sr.created_by, 1) as user_id,
          COALESCE(u.username, 'nhanvien_' || COALESCE(sr.created_by, 1)) as username,
          COALESCE(u.full_name, 'Nhân viên ' || COALESCE(sr.created_by, 1)) as full_name,
          COALESCE(u.role, 'STAFF') as role,
          COUNT(DISTINCT COALESCE(sr.client_order_id, sr.transaction_code)) as orders_count,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          COALESCE(SUM(sr.quantity), 0) as units_sold
        FROM sales_records sr
        LEFT JOIN users u ON u.id = sr.created_by
        WHERE sr.sale_date >= ? AND sr.sale_date <= ? AND sr.status = 'COMPLETED'
        GROUP BY COALESCE(u.id, sr.created_by, 1), u.username, u.full_name, u.role
        ORDER BY net_revenue DESC
      `;

      const rows = await this.db.query<any>(sql, [startDate, endDate]);

      if (rows.length === 0) {
        return { hasData: false, staff: [] };
      }

      const staff = rows.map((r) => {
        const netRev = Number(r.net_revenue || 0);
        const profit = Number(r.gross_profit || 0);
        const orders = Number(r.orders_count || 0);
        const margin = netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0;
        const aov = orders > 0 ? Math.round(netRev / orders) : 0;

        return {
          userId: Number(r.user_id),
          username: String(r.username),
          fullName: String(r.full_name),
          role: String(r.role),
          ordersCount: orders,
          netRevenue: netRev,
          grossProfit: profit,
          margin,
          unitsSold: Number(r.units_sold || 0),
          aov,
        };
      });

      return { hasData: true, staff };
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get staff performance', err);
      return { hasData: false, staff: [] };
    }
  }

  // 16. Tab 5: Inventory Capital & Valuation Analysis ("Tiền đang nằm ở đâu?")
  async getInventoryCapitalAnalysis(period: DatePeriod = 'this_month', customStart?: string, customEnd?: string): Promise<InventoryCapitalData> {
    const { startDate, endDate } = this.resolveDateRange(period, customStart, customEnd);

    try {
      const [lotValuationRow, stockStatsRow, cogsRow, deadStockList, categoryRows, topProductsRows] = await Promise.all([
        this.db.queryOne<any>(`
          SELECT COALESCE(SUM(quantity_remaining * unit_cost), 0) as lot_valuation
          FROM inventory_lots
          WHERE quantity_remaining > 0
        `),
        this.db.queryOne<any>(`
          SELECT 
            COALESCE(SUM(current_stock), 0) as total_stock,
            COALESCE(SUM(CASE WHEN current_stock <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count
          FROM products
          WHERE status = 'ACTIVE'
        `),
        this.db.queryOne<any>(`
          SELECT COALESCE(SUM(total_cost), 0) as period_cogs
          FROM sales_records
          WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
        `, [startDate, endDate]),
        this.getSlowMovingProducts(period, 50),
        this.db.query<any>(`
          SELECT 
            c.id as category_id,
            c.name as category_name,
            COALESCE(SUM(p.current_stock * p.current_cost_price), 0) as stock_valuation,
            COALESCE(SUM(p.current_stock), 0) as stock_quantity
          FROM categories c
          JOIN products p ON p.category_id = c.id
          WHERE p.status = 'ACTIVE'
          GROUP BY c.id, c.name
          HAVING stock_valuation > 0
          ORDER BY stock_valuation DESC
        `),
        this.db.query<any>(`
          SELECT 
            p.id, p.sku, p.name, c.name as category_name,
            p.current_stock, p.current_cost_price as unit_cost_price,
            (p.current_stock * p.current_cost_price) as stock_valuation
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.status = 'ACTIVE' AND p.current_stock > 0
          ORDER BY stock_valuation DESC
          LIMIT 10
        `),
      ]);

      const totalStockQuantity = Number(stockStatsRow?.total_stock || 0);
      let totalInventoryValuation = Number(lotValuationRow?.lot_valuation || 0);
      const productValuation = categoryRows.reduce((sum, r) => sum + Number(r.stock_valuation || 0), 0);
      if (totalInventoryValuation < productValuation || totalInventoryValuation <= 0) {
        if (productValuation > 0) {
          totalInventoryValuation = productValuation;
        } else if (totalStockQuantity > 0) {
          const fallback = await this.db.queryOne<any>(`
            SELECT COALESCE(SUM(current_stock * current_cost_price), 0) as prod_val
            FROM products
            WHERE status = 'ACTIVE'
          `);
          totalInventoryValuation = Number(fallback?.prod_val || 0);
        }
      }

      const cogsInPeriod = Number(cogsRow?.period_cogs ?? cogsRow?.total_cost ?? 0);
      const lowStockItemsCount = Number(stockStatsRow?.low_stock_count || 0);
      const deadStockCount = deadStockList.length;
      const deadStockValuation = deadStockList.reduce((acc, it) => acc + it.stock_valuation, 0);

      // Inventory Turnover = COGS / Average Stock Valuation
      let inventoryTurnover: number | undefined;
      let daysOfInventory: number | undefined;
      if (totalInventoryValuation > 0 && cogsInPeriod > 0) {
        inventoryTurnover = Math.round((cogsInPeriod / totalInventoryValuation) * 100) / 100;
        const startMs = new Date(startDate).getTime();
        const endMs = new Date(endDate).getTime();
        const days = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
        daysOfInventory = Math.round((totalInventoryValuation / cogsInPeriod) * days);
      }

      const categoryCapitalAllocation = categoryRows.map((r) => {
        const val = Number(r.stock_valuation || 0);
        const share = totalInventoryValuation > 0 ? Math.round((val / totalInventoryValuation) * 1000) / 10 : 0;
        return {
          categoryId: Number(r.category_id),
          categoryName: String(r.category_name),
          stockValuation: val,
          stockQuantity: Number(r.stock_quantity || 0),
          capitalSharePercent: share,
        };
      });

      const topCapitalProducts = topProductsRows.map((r) => {
        const val = Number(r.stock_valuation || 0);
        const share = totalInventoryValuation > 0 ? Math.round((val / totalInventoryValuation) * 1000) / 10 : 0;
        return {
          id: Number(r.id),
          sku: String(r.sku),
          name: String(r.name),
          categoryName: r.category_name || 'Chưa phân loại',
          currentStock: Number(r.current_stock || 0),
          unitCostPrice: Number(r.unit_cost_price || 0),
          stockValuation: val,
          capitalSharePercent: share,
        };
      });

      return {
        totalInventoryValuation,
        totalStockQuantity,
        lowStockItemsCount,
        deadStockCount,
        deadStockValuation,
        cogsInPeriod,
        inventoryTurnover,
        daysOfInventory,
        categoryCapitalAllocation,
        topCapitalProducts,
      };
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get inventory capital analysis', err);
      return {
        totalInventoryValuation: 0,
        totalStockQuantity: 0,
        lowStockItemsCount: 0,
        deadStockCount: 0,
        deadStockValuation: 0,
        cogsInPeriod: 0,
        categoryCapitalAllocation: [],
        topCapitalProducts: [],
      };
    }
  }

  // 17. Drill-down: Get orders list for a specific day
  async getDateOrdersDrilldown(dateStr: string, userId?: number): Promise<OrderDrilldownItem[]> {
    try {
      let sql = `
        SELECT 
          COALESCE(so.id, sr.order_id, sr.id) as id,
          COALESCE(so.order_code, sr.transaction_code) as order_code,
          sr.sale_date,
          COALESCE(so.final_amount, SUM(sr.total_revenue)) as final_amount,
          COALESCE(so.total_discount, SUM(sr.discount)) as total_discount,
          COALESCE(so.total_amount, SUM(sr.quantity * sr.unit_price_at_sale)) as total_amount,
          COALESCE(so.payment_method, 'CASH') as payment_method,
          u.full_name as cashier_name,
          COUNT(sr.id) as items_count
        FROM sales_records sr
        LEFT JOIN sales_orders so ON so.id = sr.order_id OR so.client_order_id = sr.client_order_id
        LEFT JOIN users u ON u.id = sr.created_by
        WHERE sr.sale_date = ? AND sr.status = 'COMPLETED'
      `;
      const params: any[] = [dateStr];

      if (userId !== undefined) {
        sql += ' AND (sr.created_by = ? OR sr.created_by IS NULL)';
        params.push(userId);
      }

      sql += `
        GROUP BY COALESCE(so.id, sr.order_id, sr.id), COALESCE(so.order_code, sr.transaction_code), sr.sale_date, so.final_amount, so.total_discount, so.total_amount, so.payment_method, u.full_name
        ORDER BY id DESC
      `;

      const rows = await this.db.query<any>(sql, params);

      if (rows.length === 0) {
        try {
          const res = await apiClient.get<any[]>(Endpoints.SALES, {
            params: { startDate: dateStr, endDate: dateStr, limit: 100 }
          });
          if (res.data && Array.isArray(res.data) && res.data.length > 0) {
            const map = new Map<string, OrderDrilldownItem>();
            for (const r of res.data) {
              const code = r.transaction_code || `TX-${r.id}`;
              if (!map.has(code)) {
                map.set(code, {
                  id: Number(r.id),
                  orderCode: code,
                  saleDate: String(r.sale_date).slice(0, 10),
                  finalAmount: Number(r.total_revenue || 0),
                  totalDiscount: Number(r.discount || 0),
                  totalAmount: Number(r.total_revenue || 0) + Number(r.discount || 0),
                  paymentMethod: 'CASH',
                  cashierName: r.seller_name || 'Thu ngân',
                  itemsCount: 1,
                });
              } else {
                const item = map.get(code)!;
                item.finalAmount += Number(r.total_revenue || 0);
                item.totalDiscount += Number(r.discount || 0);
                item.totalAmount += Number(r.total_revenue || 0) + Number(r.discount || 0);
                item.itemsCount += 1;
              }
            }
            return Array.from(map.values());
          }
        } catch (cloudErr) {
          logger.warn('AnalyticsService', 'Cloud drilldown fetch failed', cloudErr);
        }
      }

      return rows.map((r) => ({
        id: Number(r.id),
        orderCode: String(r.order_code),
        saleDate: String(r.sale_date).slice(0, 10),
        finalAmount: Number(r.final_amount || 0),
        totalDiscount: Number(r.total_discount || 0),
        totalAmount: Number(r.total_amount || 0),
        paymentMethod: String(r.payment_method || 'CASH'),
        cashierName: r.cashier_name || 'Thu ngân',
        itemsCount: Number(r.items_count || 1),
      }));
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get date orders drilldown', err);
      return [];
    }
  }

  // 18. Drill-down: Get product FIFO lots inspection
  async getProductLotDrilldown(productId: number): Promise<{ product: any; lots: ProductLotDrilldownItem[]; salesCount: number }> {
    try {
      const [prod, lots, salesRow] = await Promise.all([
        this.db.queryOne<any>('SELECT * FROM products WHERE id = ?', [productId]),
        this.db.query<any>(`
          SELECT id, lot_code, purchase_date, quantity_received, quantity_remaining, unit_cost, status
          FROM inventory_lots
          WHERE product_id = ?
          ORDER BY purchase_date ASC, id ASC
        `, [productId]),
        this.db.queryOne<any>(`
          SELECT COALESCE(SUM(quantity), 0) as total_sold
          FROM sales_records
          WHERE product_id = ? AND status = 'COMPLETED'
        `, [productId]),
      ]);

      return {
        product: prod,
        lots: lots.map((l) => ({
          id: Number(l.id),
          lotCode: String(l.lot_code),
          purchaseDate: String(l.purchase_date || '').slice(0, 10),
          quantityReceived: Number(l.quantity_received || 0),
          quantityRemaining: Number(l.quantity_remaining || 0),
          unitCost: Number(l.unit_cost || 0),
          status: String(l.status || 'ACTIVE'),
        })),
        salesCount: Number(salesRow?.total_sold || 0),
      };
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get product lot drilldown', err);
      return { product: null, lots: [], salesCount: 0 };
    }
  }

  // 6. Low Stock Products (Used by Dashboard and Reports)
  async getLowStockProducts(limit = 10): Promise<Array<{
    id: number;
    name: string;
    sku: string;
    current_stock: number;
    min_stock_alert: number;
  }>> {
    try {
      const sql = `
        SELECT id, name, sku, current_stock, min_stock_alert
        FROM products
        WHERE status = 'ACTIVE' AND current_stock <= min_stock_alert
        ORDER BY current_stock ASC
        LIMIT ?
      `;
      const rows = await this.db.query<any>(sql, [limit]);
      return rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        sku: String(r.sku),
        current_stock: Number(r.current_stock || 0),
        min_stock_alert: Number(r.min_stock_alert || 0),
      }));
    } catch (err) {
      logger.error('AnalyticsService', 'Failed to get low stock products', err);
      return [];
    }
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
