// T_SHOP Mobile - Service Layer Types, DTOs & Custom Errors

import { SalesOrder, ImportRecord, ImportItem } from '../database/types';
import { SalesRecord } from '../types/domain';

// --- CUSTOM SERVICE ERRORS ---
export class AppServiceError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppServiceError';
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppServiceError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class InsufficientStockError extends AppServiceError {
  productId: number;
  available: number;
  requested: number;

  constructor(productName: string, productId: number, available: number, requested: number) {
    super(
      'INSUFFICIENT_STOCK',
      `Sản phẩm '${productName}' không đủ tồn kho khả dụng! Hiện có: ${available}, yêu cầu: ${requested}.`,
      { productId, available, requested }
    );
    this.name = 'InsufficientStockError';
    this.productId = productId;
    this.available = available;
    this.requested = requested;
  }
}

export class DuplicateError extends AppServiceError {
  transactionId: string;

  constructor(transactionId: string, message = 'Giao dịch đã được ghi nhận trước đó.') {
    super('DUPLICATE_ERROR', message, { transactionId });
    this.name = 'DuplicateError';
    this.transactionId = transactionId;
  }
}

export class BusinessRuleError extends AppServiceError {
  constructor(message: string, details?: unknown) {
    super('BUSINESS_RULE_ERROR', message, details);
    this.name = 'BusinessRuleError';
  }
}

// --- DTOs ---

export interface CartItemInput {
  productId: number;
  quantity: number;
  unitPrice?: number;
  discount?: number; // Discount in VND (e.g. 5000 = 5000 VND)
  discountThousand?: number; // Discount in 1000 VND units (e.g. 5 = 5000 VND) matching Web
  note?: string;
}

export interface CreateSaleOrderInput {
  clientOrderId?: string;
  saleDate?: string; // YYYY-MM-DD
  items: CartItemInput[];
  totalDiscount?: number; // Total discount in VND
  paymentMethod?: string;
  cashReceived?: number;
  cashChange?: number;
  note?: string;
  createdBy?: number;
}

export interface SaleOrderResult {
  order: SalesOrder;
  items: SalesRecord[];
}

export interface CancelSaleOrderInput {
  orderId?: number;
  clientOrderId?: string;
  reason: string;
  userId?: number;
  userRole?: string;
}

export interface CancelSaleOrderResult {
  order: SalesOrder;
  restoredItemsCount: number;
  restoredQuantity: number;
  message: string;
}

export interface ImportItemInput {
  productId: number;
  quantity: number;
  unitCostPrice: number;
}

export interface CreateImportInput {
  clientImportId?: string;
  supplierId?: number;
  importDate?: string; // YYYY-MM-DD
  items: ImportItemInput[];
  note?: string;
  createdBy?: number;
}

export interface ImportResult {
  importRecord: ImportRecord;
  items: ImportItem[];
}

export interface StockAdjustmentInput {
  clientAdjustmentId?: string;
  productId: number;
  movementType: 'DAMAGE' | 'LOSS' | 'GIFT' | 'RETURN' | 'ADJUSTMENT';
  quantityChange: number; // positive or negative non-zero
  movementDate?: string;
  note?: string;
  createdBy?: number;
}

export interface StockAdjustmentResult {
  movementId: number;
  clientMovementId: string;
  productId: number;
  productName: string;
  movementType: string;
  quantityChange: number;
  balanceAfter: number;
  movementDate: string;
  note?: string;
}

// --- OUTBOX ENGINE TYPES ---

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'RETRY';

export interface OutboxMutationPayload<T = unknown> {
  client_mutation_id: string;
  entity_type: 'SALE_ORDER' | 'CANCEL_SALE_ORDER' | 'SALE' | 'IMPORT' | 'IMPORT_ORDER' | 'PRODUCT' | 'CATEGORY' | 'PRICE_CHANGE' | 'INVENTORY_ADJUSTMENT';
  entity_id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: T;
  payload_version: number;
  created_at: string;
  user_id?: number | null;
  device_id?: string | null;
}

export interface OutboxRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

// --- ANALYTICS & REPORTING TYPES ---

export type DatePeriod = 
  | 'today' 
  | 'yesterday' 
  | '7days' 
  | '30days' 
  | 'this_week'
  | 'last_week'
  | 'this_month' 
  | 'last_month' 
  | 'this_quarter'
  | 'last_quarter'
  | '6months'
  | 'this_year'
  | 'last_year'
  | 'all_time'
  | 'custom';

export interface MetricComparison {
  current: number;
  previous: number;
  changeValue: number;
  changePercent: number; // percentage growth: ((curr - prev) / prev) * 100
  trend: 'UP' | 'DOWN' | 'FLAT';
}

export interface MarginComparison {
  currentMargin: number; // percentage (e.g. 38.5)
  previousMargin: number;
  percentagePointsChange: number; // percentage points (curr - prev)
  trend: 'UP' | 'DOWN' | 'FLAT';
}

export interface BusinessAlertItem {
  id: string;
  type: 'WARNING' | 'DANGER' | 'INFO';
  title: string;
  message: string;
  metric?: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ReportOverviewData {
  grossSales: number;
  discount: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  margin: number;
  ordersCount: number;
  unitsSold: number;
  aov: number;
  unitsPerOrder: number;
  comparisons: {
    netRevenue: MetricComparison;
    grossProfit: MetricComparison;
    ordersCount: MetricComparison;
    aov: MetricComparison;
    margin: MarginComparison;
  };
  trend: RevenueProfitTrendItem[];
  alerts: BusinessAlertItem[];
  periodLabel: string;
  previousPeriodLabel: string;
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
}

export interface DetailedSalesRowItem {
  timeKey: string;
  label: string;
  grossSales: number;
  discount: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  margin: number;
  ordersCount: number;
  unitsSold: number;
  aov: number;
}

export interface DiscountAnalysisData {
  totalDiscount: number;
  ordersWithDiscountCount: number;
  ordersTotalCount: number;
  ordersWithDiscountPercent: number;
  avgDiscountPerDiscountedOrder: number;
  avgDiscountPerTotalOrder: number;
  discountToRevenueRatio: number;
  topDiscountedProducts: Array<{
    productId: number;
    name: string;
    sku: string;
    discountTotal: number;
    unitsDiscounted: number;
  }>;
}

export interface ProductPerformanceItem {
  id: number;
  sku: string;
  name: string;
  categoryName?: string;
  productTypeName?: string;
  soldQuantity: number;
  grossSales: number;
  discount: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  margin: number;
  currentStock: number;
  quadrant?: 'STAR' | 'CASH_COW' | 'QUESTION' | 'DOG';
}

export interface CategoryPerformanceItem {
  categoryId: number;
  categoryName: string;
  categoryCode: string;
  productCount: number;
  soldQuantity: number;
  grossSales: number;
  discount: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  margin: number;
  revenueSharePercent: number;
}

export interface ProfitabilityMatrixData {
  avgRevenue: number;
  avgProfit: number;
  totalProductsCount: number;
  stars: ProductPerformanceItem[];
  highVolumeLowMargin: ProductPerformanceItem[];
  potentials: ProductPerformanceItem[];
  lowPerformers: ProductPerformanceItem[];
}

export interface HourlyPerformanceItem {
  hourRange: string;
  hourStart: number;
  hourEnd: number;
  ordersCount: number;
  netRevenue: number;
  grossProfit: number;
  margin: number;
  unitsSold: number;
}

export interface WeekdayPerformanceItem {
  dayOfWeek: number;
  dayName: string;
  ordersCount: number;
  netRevenue: number;
  grossProfit: number;
  margin: number;
  unitsSold: number;
  aov: number;
}

export interface StaffPerformanceItem {
  userId: number;
  username: string;
  fullName: string;
  role: string;
  ordersCount: number;
  netRevenue: number;
  grossProfit: number;
  margin: number;
  unitsSold: number;
  aov: number;
}

export interface InventoryCapitalData {
  totalInventoryValuation: number;
  totalStockQuantity: number;
  lowStockItemsCount: number;
  deadStockCount: number;
  deadStockValuation: number;
  cogsInPeriod: number;
  inventoryTurnover?: number;
  daysOfInventory?: number;
  categoryCapitalAllocation: Array<{
    categoryId: number;
    categoryName: string;
    stockValuation: number;
    stockQuantity: number;
    capitalSharePercent: number;
  }>;
  topCapitalProducts: Array<{
    id: number;
    sku: string;
    name: string;
    categoryName?: string;
    currentStock: number;
    unitCostPrice: number;
    stockValuation: number;
    capitalSharePercent: number;
  }>;
}

export interface OrderDrilldownItem {
  id: number;
  orderCode: string;
  saleDate: string;
  finalAmount: number;
  totalDiscount: number;
  totalAmount: number;
  paymentMethod: string;
  cashierName?: string;
  itemsCount: number;
}

export interface ProductLotDrilldownItem {
  id: number;
  lotCode: string;
  purchaseDate: string;
  quantityReceived: number;
  quantityRemaining: number;
  unitCost: number;
  status: string;
}

export interface DashboardSummaryData {
  revenue: number;
  cogs: number;
  profit: number;
  total_discount?: number;
  discount?: number;
  aov?: number;
  ordersCount?: number;
  salesCount: number;
  soldQuantity: number;
  currentTotalStock: number;
  stockValuation: number;
  lowStockCount: number;
  importsCount?: number;
  adjustmentsCount?: number;
  adjustmentsQuantity?: number;
  periodLabel: string;
  dateRange: {
    startDate: string;
    endDate: string;
    period: DatePeriod;
  };
}

export interface RevenueProfitTrendItem {
  date: string;
  label: string;
  revenue: number;
  cogs: number;
  profit: number;
  soldQuantity: number;
  transactionCount: number;
}

export interface TopSellingItem {
  id: number;
  sku: string;
  name: string;
  category_name?: string;
  product_type_name?: string;
  sold_quantity: number;
  total_revenue: number;
  total_profit: number;
  current_stock: number;
}

export interface SlowMovingItem {
  id: number;
  sku: string;
  name: string;
  category_name?: string;
  product_type_name?: string;
  current_stock: number;
  current_cost_price: number;
  stock_valuation: number;
}

export interface SalesByDateItem {
  sale_date: string;
  order_count: number;
  total_quantity: number;
  total_revenue: number;
  total_cost: number;
  total_profit: number;
}

export interface PriceHistoryRecord {
  id: number;
  product_id: number;
  price: number;
  effective_from: string;
  note?: string;
  created_by?: number;
  created_at: string;
}

export interface CostHistoryRecord {
  id: number;
  product_id: number;
  cost_price: number;
  effective_from: string;
  note?: string;
  created_by?: number;
  created_at: string;
}
