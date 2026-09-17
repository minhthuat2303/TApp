// T_SHOP Mobile - Web Demo Data Layer & SQLite In-Memory / LocalStorage Driver
// Specifically engineered for Web Preview (Expo Web / Browser testing)
// Guarantees 100% zero changes to Native Android/iOS runtime while providing fully interactive local data on browser.

import { IDatabaseDriver, ITransactionClient, QueryResult } from './types';
import logger from '../utils/logger';

interface CategoryRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

interface ProductTypeRow {
  id: number;
  category_id: number;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

interface ProductRow {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  product_type_id: number;
  current_cost_price: number;
  current_selling_price: number;
  current_stock: number;
  min_stock_alert: number;
  status: 'ACTIVE' | 'INACTIVE';
  created_at?: string;
  updated_at?: string;
}

interface SalesOrderRow {
  id: number;
  client_order_id: string;
  order_code: string;
  sale_date: string;
  total_amount: number;
  total_discount: number;
  final_amount: number;
  total_items: number;
  payment_method?: string | null;
  cash_received?: number | null;
  cash_change?: number | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  seller_name?: string | null;
  status: 'COMPLETED' | 'CANCELLED';
  sync_status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  note: string | null;
  created_by: number | null;
  created_at: string;
  synced_at: string | null;
}

interface SalesRecordRow {
  id: number;
  order_id?: number | null;
  client_order_id?: string | null;
  client_transaction_id: string;
  transaction_code: string;
  product_id: number;
  product_name?: string;
  sku?: string;
  category_name?: string;
  product_type_name?: string;
  sale_date: string;
  quantity: number;
  unit_price_at_sale: number;
  cost_price_at_sale: number;
  discount: number;
  total_revenue: number;
  total_cost: number;
  profit: number;
  status: 'COMPLETED' | 'CANCELLED';
  sync_status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  note?: string | null;
  created_by?: number | null;
  seller_name?: string;
  created_at: string;
  synced_at?: string | null;
}

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  role: 'ADMIN' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE';
}

interface SyncQueueRow {
  id: number;
  client_mutation_id: string;
  entity_type: string;
  entity_id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload_json: string;
  payload_version: number;
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'RETRY';
  retry_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  user_id?: number | null;
  device_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface ConflictRow {
  id: number;
  entity_type: string;
  entity_id: string;
  server_data: string;
  local_data: string;
  status: 'UNRESOLVED' | 'RESOLVED';
  created_at: string;
  resolved_at?: string | null;
}

interface StockMovementRow {
  id: number;
  client_movement_id: string;
  product_id: number;
  product_name?: string;
  sku?: string;
  movement_type: string;
  quantity_change: number;
  balance_after: number;
  movement_date: string;
  reference_type: string | null;
  reference_id: string | null;
  sync_status: string;
  note: string | null;
  created_by: number | null;
  creator_name?: string;
  created_at: string;
}

interface InventoryLotRow {
  id: number;
  lot_code: string;
  product_id: number;
  product_name?: string;
  sku?: string;
  purchase_date: string;
  quantity_received: number;
  quantity_remaining: number;
  unit_cost: number;
  supplier_id: number | null;
  supplier_name?: string;
  import_id: number | null;
  note: string | null;
  created_by?: number | null;
  created_at: string;
}

interface CostHistoryRow {
  id: number;
  product_id: number;
  old_cost_price: number;
  new_cost_price: number;
  reason: string | null;
  created_by: number | null;
  created_at: string;
}

interface PriceHistoryRow {
  id: number;
  product_id: number;
  old_price: number;
  new_price: number;
  effective_from: string;
  reason: string | null;
  created_by: number | null;
  created_at: string;
}

interface ImportRow {
  id: number;
  client_import_id: string;
  server_id: number | null;
  import_code: string;
  supplier_id: number | null;
  supplier_name?: string;
  import_date: string;
  expected_date: string | null;
  total_amount: number;
  note: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  sync_status: string;
  created_by: number | null;
  created_at: string;
  synced_at?: string | null;
}

interface ImportItemRow {
  id: number;
  import_id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  quantity: number;
  unit_cost_price: number;
  total_amount: number;
  created_at: string;
}

function getIsoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.slice(0, 7);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  const year = new Date(firstThursday).getFullYear();
  return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

export class WebDemoSqliteDriver implements IDatabaseDriver {
  private readonly STORAGE_KEY = 't_shop_web_demo_data_v6';
  private opened = false;
  private users: UserRow[] = [];
  private categories: CategoryRow[] = [];
  private productTypes: ProductTypeRow[] = [];
  private products: ProductRow[] = [];
  private salesOrders: SalesOrderRow[] = [];
  private salesRecords: SalesRecordRow[] = [];
  private syncQueue: SyncQueueRow[] = [];
  private conflicts: ConflictRow[] = [];
  private stockMovements: StockMovementRow[] = [];
  private inventoryLots: InventoryLotRow[] = [];
  private costPriceHistory: CostHistoryRow[] = [];
  private priceHistory: PriceHistoryRow[] = [];
  private imports: ImportRow[] = [];
  private importItems: ImportItemRow[] = [];
  private metadata: Map<string, string> = new Map();
  private lastInsertedId = 100;

  async openAsync(dbName: string = 't_shop.db'): Promise<void> {
    this.opened = true;
    const loaded = this.loadFromLocalStorage();
    if (!loaded) {
      this.initSeedData();
      this.saveToLocalStorage();
    }
    if (typeof window !== 'undefined') {
      (window as any).resetDemoData = () => this.resetDemoData();
      (window as any).tShopDriver = this;
    }
    logger.info('WebDemoSqliteDriver', `Web Demo Database (${dbName}) initialized successfully in-browser.`);
  }

  resetDemoData(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.STORAGE_KEY);
    }
    this.products = [];
    this.salesOrders = [];
    this.salesRecords = [];
    this.initSeedData();
    this.saveToLocalStorage();
    logger.info('WebDemoSqliteDriver', 'Web demo data reset to defaults.');
  }

  private saveToLocalStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const data = {
        users: this.users,
        categories: this.categories,
        productTypes: this.productTypes,
        products: this.products,
        salesOrders: this.salesOrders,
        salesRecords: this.salesRecords,
        syncQueue: this.syncQueue,
        conflicts: this.conflicts,
        stockMovements: this.stockMovements,
        inventoryLots: this.inventoryLots,
        costPriceHistory: this.costPriceHistory,
        priceHistory: this.priceHistory,
        imports: this.imports,
        importItems: this.importItems,
        lastInsertedId: this.lastInsertedId,
      };
      window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      logger.warn('WebDemoSqliteDriver', 'Failed to save to localStorage', e);
    }
  }

  private loadFromLocalStorage(): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    try {
      const raw = window.localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.products) || data.products.length === 0) return false;
      this.users = data.users || [];
      this.categories = data.categories || [];
      this.productTypes = data.productTypes || [];
      this.products = data.products || [];
      this.salesOrders = data.salesOrders || [];
      this.salesRecords = data.salesRecords || [];
      this.syncQueue = data.syncQueue || [];
      this.conflicts = data.conflicts || [];
      this.stockMovements = data.stockMovements || [];
      this.inventoryLots = data.inventoryLots || [];
      this.costPriceHistory = data.costPriceHistory || [];
      this.priceHistory = data.priceHistory || [];
      this.imports = data.imports || [];
      this.importItems = data.importItems || [];
      this.lastInsertedId = Number(data.lastInsertedId) || 1000;
      return true;
    } catch (e) {
      logger.warn('WebDemoSqliteDriver', 'Failed to load from localStorage', e);
      return false;
    }
  }

  async closeAsync(): Promise<void> {
    this.opened = false;
  }

  isOpen(): boolean {
    return this.opened;
  }

  private initSeedData(): void {
    if (this.products.length > 0) return;

    this.users = [
      { id: 1, username: 'admin', full_name: 'Quản Trị Viên (Admin)', role: 'ADMIN', status: 'ACTIVE' },
      { id: 2, username: 'nhanvien_a', full_name: 'Nhân Viên Bán Hàng A', role: 'STAFF', status: 'ACTIVE' },
      { id: 3, username: 'nhanvien_b', full_name: 'Nhân Viên Bán Hàng B', role: 'STAFF', status: 'ACTIVE' },
    ];

    this.categories = [
      { id: 1, code: 'GAU_BONG', name: 'Gấu bông & Thú nhồi bông', description: 'Các loại gấu bông cao cấp, an toàn cho bé', status: 'ACTIVE' },
      { id: 2, code: 'LEGO', name: 'Đồ chơi xếp hình & Lắp ráp', description: 'Bộ xếp hình phát triển trí tuệ logic', status: 'ACTIVE' },
      { id: 3, code: 'DIEU_KHIEN', name: 'Đồ chơi điều khiển từ xa', description: 'Xe, máy bay, cano điều khiển', status: 'ACTIVE' },
      { id: 4, code: 'GIAO_DUC', name: 'Đồ chơi giáo dục & Hướng nghiệp', description: 'Bảng chữ cái, đồ chơi nhà bếp, bác sĩ', status: 'ACTIVE' },
      { id: 5, code: 'VAN_DONG', name: 'Đồ chơi vận động ngoài trời', description: 'Xe chòi chân, xe trượt scooter, bóng đá', status: 'ACTIVE' },
    ];

    this.productTypes = [
      { id: 1, category_id: 1, code: 'CAPYBARA', name: 'Gấu bông Capybara', description: 'Thú nhồi bông Capybara hot trend', status: 'ACTIVE' },
      { id: 2, category_id: 1, code: 'TEDDY', name: 'Gấu Teddy truyền thống', description: 'Gấu Teddy lông xù nhiều kích cỡ', status: 'ACTIVE' },
      { id: 3, category_id: 2, code: 'LEGO_CITY', name: 'Lắp ráp mô hình Thành phố', description: 'Mô hình cứu hỏa, cảnh sát, cứu thương', status: 'ACTIVE' },
      { id: 4, category_id: 2, code: 'LEGO_ROBOT', name: 'Lắp ráp Robot & Xe chiến đấu', description: 'Robot biến hình thông minh', status: 'ACTIVE' },
      { id: 5, category_id: 3, code: 'RC_CAR', name: 'Xe đua điều khiển', description: 'Xe địa hình tốc độ cao', status: 'ACTIVE' },
      { id: 6, category_id: 3, code: 'DRONE_MINI', name: 'Flycam / Drone mini', description: 'Máy bay điều khiển 4 cánh an toàn trong nhà', status: 'ACTIVE' },
      { id: 7, category_id: 4, code: 'BIEU_DIEN', name: 'Bộ đồ chơi Bác sĩ / Kỹ sư', description: 'Dụng cụ nhập vai trẻ em', status: 'ACTIVE' },
      { id: 8, category_id: 5, code: 'SCOOTER', name: 'Xe trượt Scooter gập gọn', description: 'Scooter 3 bánh có đèn LED phát sáng', status: 'ACTIVE' },
    ];

    this.products = [
      { id: 1, sku: 'GB-CAPY-01', name: 'Gấu Bông Capybara Rút Mũi 35cm', category_id: 1, product_type_id: 1, current_cost_price: 85000, current_selling_price: 150000, current_stock: 45, min_stock_alert: 10, status: 'ACTIVE' },
      { id: 2, sku: 'GB-CAPY-02', name: 'Gấu Bông Capybara Đeo Balo Rùa 45cm', category_id: 1, product_type_id: 1, current_cost_price: 110000, current_selling_price: 195000, current_stock: 30, min_stock_alert: 8, status: 'ACTIVE' },
      { id: 3, sku: 'GB-TEDDY-01', name: 'Gấu Teddy Nơ Ôm Trái Tim 50cm', category_id: 1, product_type_id: 2, current_cost_price: 130000, current_selling_price: 230000, current_stock: 25, min_stock_alert: 5, status: 'ACTIVE' },
      { id: 4, sku: 'LG-CITY-01', name: 'Bộ Xếp Hình Trạm Cứu Hỏa Đô Thị (520 chi tiết)', category_id: 2, product_type_id: 3, current_cost_price: 210000, current_selling_price: 360000, current_stock: 20, min_stock_alert: 5, status: 'ACTIVE' },
      { id: 5, sku: 'LG-ROBOT-01', name: 'Robot Chiến Binh Biến Hình Transformers', category_id: 2, product_type_id: 4, current_cost_price: 180000, current_selling_price: 310000, current_stock: 15, min_stock_alert: 5, status: 'ACTIVE' },
      { id: 6, sku: 'RC-CAR-01', name: 'Xe Đua Địa Hình Leo Núi 4WD Tỉ Lệ 1:16', category_id: 3, product_type_id: 5, current_cost_price: 250000, current_selling_price: 420000, current_stock: 18, min_stock_alert: 5, status: 'ACTIVE' },
      { id: 7, sku: 'RC-DRONE-01', name: 'Máy Bay 4 Cánh Cảm Ứng Độ Cao Mini Drone', category_id: 3, product_type_id: 6, current_cost_price: 190000, current_selling_price: 320000, current_stock: 12, min_stock_alert: 5, status: 'ACTIVE' },
      { id: 8, sku: 'GD-MED-01', name: 'Bộ Vali Bác Sĩ Nha Khoa Khám Răng (24 món)', category_id: 4, product_type_id: 7, current_cost_price: 95000, current_selling_price: 175000, current_stock: 35, min_stock_alert: 10, status: 'ACTIVE' },
      { id: 9, sku: 'VD-SCOOT-01', name: 'Xe Trượt Scooter Bánh Phát Sáng Điều Chỉnh Độ Cao', category_id: 5, product_type_id: 8, current_cost_price: 220000, current_selling_price: 380000, current_stock: 14, min_stock_alert: 5, status: 'ACTIVE' },
      { id: 10, sku: 'VD-BONG-01', name: 'Quả Bóng Đá Da Pu Size 4 Cho Trẻ Em', category_id: 5, product_type_id: 8, current_cost_price: 75000, current_selling_price: 135000, current_stock: 50, min_stock_alert: 15, status: 'ACTIVE' },
    ];

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const subDays = (days: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      return toYMD(d);
    };

    const todayStr = toYMD(now);
    const yesterdayStr = subDays(1);
    const d3Str = subDays(3);
    const d5Str = subDays(5);
    const d7Str = subDays(7);
    const d10Str = subDays(10);
    const d14Str = subDays(14);

    // Prior period dates (for comparison)
    const prevDate1 = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), 25));
    const prevDate2 = new Date(now.getFullYear(), now.getMonth() - 1, Math.max(1, Math.min(now.getDate() - 5, 20)));
    const lastMonth1 = toYMD(prevDate1);
    const lastMonth2 = toYMD(prevDate2);

    // Seed realistic retail sales orders
    this.salesOrders = [
      {
        id: 1,
        client_order_id: 'ord-today-001',
        order_code: `HD-${todayStr.replace(/-/g, '')}-001`,
        sale_date: todayStr,
        total_amount: 345000,
        total_discount: 15000,
        final_amount: 330000,
        total_items: 2,
        payment_method: 'CASH',
        cash_received: 350000,
        cash_change: 20000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Khách mua quà sinh nhật cho bé',
        created_by: 1,
        created_at: `${todayStr}T09:30:00.000Z`,
        synced_at: `${todayStr}T09:31:00.000Z`,
      },
      {
        id: 2,
        client_order_id: 'ord-today-002',
        order_code: `HD-${todayStr.replace(/-/g, '')}-002`,
        sale_date: todayStr,
        total_amount: 630000,
        total_discount: 30000,
        final_amount: 600000,
        total_items: 3,
        payment_method: 'BANK_TRANSFER',
        cash_received: 600000,
        cash_change: 0,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Đơn Lego & bóng đá chuyển khoản QR',
        created_by: 2,
        created_at: `${todayStr}T14:15:00.000Z`,
        synced_at: `${todayStr}T14:16:00.000Z`,
      },
      {
        id: 3,
        client_order_id: 'ord-today-003',
        order_code: `HD-${todayStr.replace(/-/g, '')}-003`,
        sale_date: todayStr,
        total_amount: 420000,
        total_discount: 20000,
        final_amount: 400000,
        total_items: 1,
        payment_method: 'CASH',
        cash_received: 500000,
        cash_change: 100000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Xe đua điều khiển leo núi',
        created_by: 2,
        created_at: `${todayStr}T19:45:00.000Z`,
        synced_at: `${todayStr}T19:46:00.000Z`,
      },
      {
        id: 4,
        client_order_id: 'ord-yest-001',
        order_code: `HD-${yesterdayStr.replace(/-/g, '')}-001`,
        sale_date: yesterdayStr,
        total_amount: 460000,
        total_discount: 40000,
        final_amount: 420000,
        total_items: 2,
        payment_method: 'CASH',
        cash_received: 500000,
        cash_change: 80000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: '2 gấu Teddy nơ quà tặng',
        created_by: 1,
        created_at: `${yesterdayStr}T10:10:00.000Z`,
        synced_at: `${yesterdayStr}T10:11:00.000Z`,
      },
      {
        id: 5,
        client_order_id: 'ord-yest-002',
        order_code: `HD-${yesterdayStr.replace(/-/g, '')}-002`,
        sale_date: yesterdayStr,
        total_amount: 555000,
        total_discount: 30000,
        final_amount: 525000,
        total_items: 2,
        payment_method: 'CARD',
        cash_received: 525000,
        cash_change: 0,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Bộ đồ chơi bác sĩ + scooter',
        created_by: 3,
        created_at: `${yesterdayStr}T16:30:00.000Z`,
        synced_at: `${yesterdayStr}T16:31:00.000Z`,
      },
      {
        id: 6,
        client_order_id: 'ord-d3-001',
        order_code: `HD-${d3Str.replace(/-/g, '')}-001`,
        sale_date: d3Str,
        total_amount: 620000,
        total_discount: 20000,
        final_amount: 600000,
        total_items: 3,
        payment_method: 'BANK_TRANSFER',
        cash_received: 600000,
        cash_change: 0,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Drone mini + 2 gấu capybara',
        created_by: 2,
        created_at: `${d3Str}T11:20:00.000Z`,
        synced_at: `${d3Str}T11:21:00.000Z`,
      },
      {
        id: 7,
        client_order_id: 'ord-d5-001',
        order_code: `HD-${d5Str.replace(/-/g, '')}-001`,
        sale_date: d5Str,
        total_amount: 620000,
        total_discount: 50000,
        final_amount: 570000,
        total_items: 2,
        payment_method: 'CASH',
        cash_received: 600000,
        cash_change: 30000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: '2 Robot Transformers',
        created_by: 3,
        created_at: `${d5Str}T15:00:00.000Z`,
        synced_at: `${d5Str}T15:01:00.000Z`,
      },
      {
        id: 8,
        client_order_id: 'ord-d7-001',
        order_code: `HD-${d7Str.replace(/-/g, '')}-001`,
        sale_date: d7Str,
        total_amount: 525000,
        total_discount: 20000,
        final_amount: 505000,
        total_items: 3,
        payment_method: 'CASH',
        cash_received: 510000,
        cash_change: 5000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Balo rùa + bóng đá',
        created_by: 1,
        created_at: `${d7Str}T20:10:00.000Z`,
        synced_at: `${d7Str}T20:11:00.000Z`,
      },
      {
        id: 9,
        client_order_id: 'ord-d10-001',
        order_code: `HD-${d10Str.replace(/-/g, '')}-001`,
        sale_date: d10Str,
        total_amount: 360000,
        total_discount: 0,
        final_amount: 360000,
        total_items: 1,
        payment_method: 'CASH',
        cash_received: 400000,
        cash_change: 40000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Xếp hình Trạm cứu hỏa',
        created_by: 2,
        created_at: `${d10Str}T13:40:00.000Z`,
        synced_at: `${d10Str}T13:41:00.000Z`,
      },
      {
        id: 10,
        client_order_id: 'ord-d14-001',
        order_code: `HD-${d14Str.replace(/-/g, '')}-001`,
        sale_date: d14Str,
        total_amount: 770000,
        total_discount: 40000,
        final_amount: 730000,
        total_items: 3,
        payment_method: 'BANK_TRANSFER',
        cash_received: 730000,
        cash_change: 0,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Xe đua + 2 bộ vali bác sĩ',
        created_by: 1,
        created_at: `${d14Str}T18:25:00.000Z`,
        synced_at: `${d14Str}T18:26:00.000Z`,
      },
      {
        id: 11,
        client_order_id: 'ord-prev-001',
        order_code: `HD-${lastMonth1.replace(/-/g, '')}-001`,
        sale_date: lastMonth1,
        total_amount: 660000,
        total_discount: 20000,
        final_amount: 640000,
        total_items: 3,
        payment_method: 'CASH',
        cash_received: 650000,
        cash_change: 10000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Đơn tháng trước: Capybara + Lego',
        created_by: 1,
        created_at: `${lastMonth1}T10:30:00.000Z`,
        synced_at: `${lastMonth1}T10:31:00.000Z`,
      },
      {
        id: 12,
        client_order_id: 'ord-prev-002',
        order_code: `HD-${lastMonth2.replace(/-/g, '')}-002`,
        sale_date: lastMonth2,
        total_amount: 700000,
        total_discount: 30000,
        final_amount: 670000,
        total_items: 2,
        payment_method: 'CARD',
        cash_received: 670000,
        cash_change: 0,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        note: 'Đơn tháng trước: Drone + Scooter',
        created_by: 2,
        created_at: `${lastMonth2}T16:00:00.000Z`,
        synced_at: `${lastMonth2}T16:01:00.000Z`,
      },
    ];

    // Seed matching sales line records (mathematically balanced)
    this.salesRecords = [
      // Order 1: today 09:30
      {
        id: 1,
        order_id: 1,
        client_order_id: 'ord-today-001',
        client_transaction_id: 'tx-01-item-01',
        transaction_code: `HD-${todayStr.replace(/-/g, '')}-001-P1`,
        product_id: 1,
        product_name: 'Gấu Bông Capybara Rút Mũi 35cm',
        sku: 'GB-CAPY-01',
        category_name: 'Gấu bông & Thú nhồi bông',
        product_type_name: 'Gấu bông Capybara',
        sale_date: todayStr,
        quantity: 1,
        unit_price_at_sale: 150000,
        cost_price_at_sale: 85000,
        discount: 0,
        total_revenue: 150000,
        total_cost: 85000,
        profit: 65000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${todayStr}T09:30:00.000Z`,
      },
      {
        id: 2,
        order_id: 1,
        client_order_id: 'ord-today-001',
        client_transaction_id: 'tx-01-item-02',
        transaction_code: `HD-${todayStr.replace(/-/g, '')}-001-P2`,
        product_id: 2,
        product_name: 'Gấu Bông Capybara Đeo Balo Rùa 45cm',
        sku: 'GB-CAPY-02',
        category_name: 'Gấu bông & Thú nhồi bông',
        product_type_name: 'Gấu bông Capybara',
        sale_date: todayStr,
        quantity: 1,
        unit_price_at_sale: 195000,
        cost_price_at_sale: 110000,
        discount: 15000,
        total_revenue: 180000,
        total_cost: 110000,
        profit: 70000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${todayStr}T09:30:00.000Z`,
      },
      // Order 2: today 14:15
      {
        id: 3,
        order_id: 2,
        client_order_id: 'ord-today-002',
        client_transaction_id: 'tx-02-item-01',
        transaction_code: `HD-${todayStr.replace(/-/g, '')}-002-P4`,
        product_id: 4,
        product_name: 'Bộ Xếp Hình Trạm Cứu Hỏa Đô Thị (520 chi tiết)',
        sku: 'LG-CITY-01',
        category_name: 'Đồ chơi xếp hình & Lắp ráp',
        product_type_name: 'Lắp ráp mô hình Thành phố',
        sale_date: todayStr,
        quantity: 1,
        unit_price_at_sale: 360000,
        cost_price_at_sale: 210000,
        discount: 30000,
        total_revenue: 330000,
        total_cost: 210000,
        profit: 120000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${todayStr}T14:15:00.000Z`,
      },
      {
        id: 4,
        order_id: 2,
        client_order_id: 'ord-today-002',
        client_transaction_id: 'tx-02-item-02',
        transaction_code: `HD-${todayStr.replace(/-/g, '')}-002-P10`,
        product_id: 10,
        product_name: 'Quả Bóng Đá Da Pu Size 4 Cho Trẻ Em',
        sku: 'VD-BONG-01',
        category_name: 'Đồ chơi vận động ngoài trời',
        product_type_name: 'Xe trượt Scooter gập gọn',
        sale_date: todayStr,
        quantity: 2,
        unit_price_at_sale: 135000,
        cost_price_at_sale: 75000,
        discount: 0,
        total_revenue: 270000,
        total_cost: 150000,
        profit: 120000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${todayStr}T14:15:00.000Z`,
      },
      // Order 3: today 19:45
      {
        id: 5,
        order_id: 3,
        client_order_id: 'ord-today-003',
        client_transaction_id: 'tx-03-item-01',
        transaction_code: `HD-${todayStr.replace(/-/g, '')}-003-P6`,
        product_id: 6,
        product_name: 'Xe Đua Địa Hình Leo Núi 4WD Tỉ Lệ 1:16',
        sku: 'RC-CAR-01',
        category_name: 'Đồ chơi điều khiển từ xa',
        product_type_name: 'Xe đua điều khiển',
        sale_date: todayStr,
        quantity: 1,
        unit_price_at_sale: 420000,
        cost_price_at_sale: 250000,
        discount: 20000,
        total_revenue: 400000,
        total_cost: 250000,
        profit: 150000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${todayStr}T19:45:00.000Z`,
      },
      // Order 4: yesterday 10:10
      {
        id: 6,
        order_id: 4,
        client_order_id: 'ord-yest-001',
        client_transaction_id: 'tx-04-item-01',
        transaction_code: `HD-${yesterdayStr.replace(/-/g, '')}-001-P3`,
        product_id: 3,
        product_name: 'Gấu Teddy Nơ Ôm Trái Tim 50cm',
        sku: 'GB-TEDDY-01',
        category_name: 'Gấu bông & Thú nhồi bông',
        product_type_name: 'Gấu Teddy truyền thống',
        sale_date: yesterdayStr,
        quantity: 2,
        unit_price_at_sale: 230000,
        cost_price_at_sale: 130000,
        discount: 40000,
        total_revenue: 420000,
        total_cost: 260000,
        profit: 160000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${yesterdayStr}T10:10:00.000Z`,
      },
      // Order 5: yesterday 16:30
      {
        id: 7,
        order_id: 5,
        client_order_id: 'ord-yest-002',
        client_transaction_id: 'tx-05-item-01',
        transaction_code: `HD-${yesterdayStr.replace(/-/g, '')}-002-P8`,
        product_id: 8,
        product_name: 'Bộ Vali Bác Sĩ Nha Khoa Khám Răng (24 món)',
        sku: 'GD-MED-01',
        category_name: 'Đồ chơi giáo dục & Hướng nghiệp',
        product_type_name: 'Bộ đồ chơi Bác sĩ / Kỹ sư',
        sale_date: yesterdayStr,
        quantity: 1,
        unit_price_at_sale: 175000,
        cost_price_at_sale: 95000,
        discount: 0,
        total_revenue: 175000,
        total_cost: 95000,
        profit: 80000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 3,
        created_at: `${yesterdayStr}T16:30:00.000Z`,
      },
      {
        id: 8,
        order_id: 5,
        client_order_id: 'ord-yest-002',
        client_transaction_id: 'tx-05-item-02',
        transaction_code: `HD-${yesterdayStr.replace(/-/g, '')}-002-P9`,
        product_id: 9,
        product_name: 'Xe Trượt Scooter Bánh Phát Sáng Điều Chỉnh Độ Cao',
        sku: 'VD-SCOOT-01',
        category_name: 'Đồ chơi vận động ngoài trời',
        product_type_name: 'Xe trượt Scooter gập gọn',
        sale_date: yesterdayStr,
        quantity: 1,
        unit_price_at_sale: 380000,
        cost_price_at_sale: 220000,
        discount: 30000,
        total_revenue: 350000,
        total_cost: 220000,
        profit: 130000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 3,
        created_at: `${yesterdayStr}T16:30:00.000Z`,
      },
      // Order 6: d3 11:20
      {
        id: 9,
        order_id: 6,
        client_order_id: 'ord-d3-001',
        client_transaction_id: 'tx-06-item-01',
        transaction_code: `HD-${d3Str.replace(/-/g, '')}-001-P7`,
        product_id: 7,
        product_name: 'Máy Bay 4 Cánh Cảm Ứng Độ Cao Mini Drone',
        sku: 'RC-DRONE-01',
        category_name: 'Đồ chơi điều khiển từ xa',
        product_type_name: 'Flycam / Drone mini',
        sale_date: d3Str,
        quantity: 1,
        unit_price_at_sale: 320000,
        cost_price_at_sale: 190000,
        discount: 20000,
        total_revenue: 300000,
        total_cost: 190000,
        profit: 110000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${d3Str}T11:20:00.000Z`,
      },
      {
        id: 10,
        order_id: 6,
        client_order_id: 'ord-d3-001',
        client_transaction_id: 'tx-06-item-02',
        transaction_code: `HD-${d3Str.replace(/-/g, '')}-001-P1`,
        product_id: 1,
        product_name: 'Gấu Bông Capybara Rút Mũi 35cm',
        sku: 'GB-CAPY-01',
        category_name: 'Gấu bông & Thú nhồi bông',
        product_type_name: 'Gấu bông Capybara',
        sale_date: d3Str,
        quantity: 2,
        unit_price_at_sale: 150000,
        cost_price_at_sale: 85000,
        discount: 0,
        total_revenue: 300000,
        total_cost: 170000,
        profit: 130000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${d3Str}T11:20:00.000Z`,
      },
      // Order 7: d5 15:00
      {
        id: 11,
        order_id: 7,
        client_order_id: 'ord-d5-001',
        client_transaction_id: 'tx-07-item-01',
        transaction_code: `HD-${d5Str.replace(/-/g, '')}-001-P5`,
        product_id: 5,
        product_name: 'Robot Chiến Binh Biến Hình Transformers',
        sku: 'LG-ROBOT-01',
        category_name: 'Đồ chơi xếp hình & Lắp ráp',
        product_type_name: 'Lắp ráp Robot & Xe chiến đấu',
        sale_date: d5Str,
        quantity: 2,
        unit_price_at_sale: 310000,
        cost_price_at_sale: 180000,
        discount: 50000,
        total_revenue: 570000,
        total_cost: 360000,
        profit: 210000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 3,
        created_at: `${d5Str}T15:00:00.000Z`,
      },
      // Order 8: d7 20:10
      {
        id: 12,
        order_id: 8,
        client_order_id: 'ord-d7-001',
        client_transaction_id: 'tx-08-item-01',
        transaction_code: `HD-${d7Str.replace(/-/g, '')}-001-P2`,
        product_id: 2,
        product_name: 'Gấu Bông Capybara Đeo Balo Rùa 45cm',
        sku: 'GB-CAPY-02',
        category_name: 'Gấu bông & Thú nhồi bông',
        product_type_name: 'Gấu bông Capybara',
        sale_date: d7Str,
        quantity: 2,
        unit_price_at_sale: 195000,
        cost_price_at_sale: 110000,
        discount: 20000,
        total_revenue: 370000,
        total_cost: 220000,
        profit: 150000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${d7Str}T20:10:00.000Z`,
      },
      {
        id: 13,
        order_id: 8,
        client_order_id: 'ord-d7-001',
        client_transaction_id: 'tx-08-item-02',
        transaction_code: `HD-${d7Str.replace(/-/g, '')}-001-P10`,
        product_id: 10,
        product_name: 'Quả Bóng Đá Da Pu Size 4 Cho Trẻ Em',
        sku: 'VD-BONG-01',
        category_name: 'Đồ chơi vận động ngoài trời',
        product_type_name: 'Xe trượt Scooter gập gọn',
        sale_date: d7Str,
        quantity: 1,
        unit_price_at_sale: 135000,
        cost_price_at_sale: 75000,
        discount: 0,
        total_revenue: 135000,
        total_cost: 75000,
        profit: 60000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${d7Str}T20:10:00.000Z`,
      },
      // Order 9: d10 13:40
      {
        id: 14,
        order_id: 9,
        client_order_id: 'ord-d10-001',
        client_transaction_id: 'tx-09-item-01',
        transaction_code: `HD-${d10Str.replace(/-/g, '')}-001-P4`,
        product_id: 4,
        product_name: 'Bộ Xếp Hình Trạm Cứu Hỏa Đô Thị (520 chi tiết)',
        sku: 'LG-CITY-01',
        category_name: 'Đồ chơi xếp hình & Lắp ráp',
        product_type_name: 'Lắp ráp mô hình Thành phố',
        sale_date: d10Str,
        quantity: 1,
        unit_price_at_sale: 360000,
        cost_price_at_sale: 210000,
        discount: 0,
        total_revenue: 360000,
        total_cost: 210000,
        profit: 150000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${d10Str}T13:40:00.000Z`,
      },
      // Order 10: d14 18:25
      {
        id: 15,
        order_id: 10,
        client_order_id: 'ord-d14-001',
        client_transaction_id: 'tx-10-item-01',
        transaction_code: `HD-${d14Str.replace(/-/g, '')}-001-P6`,
        product_id: 6,
        product_name: 'Xe Đua Địa Hình Leo Núi 4WD Tỉ Lệ 1:16',
        sku: 'RC-CAR-01',
        category_name: 'Đồ chơi điều khiển từ xa',
        product_type_name: 'Xe đua điều khiển',
        sale_date: d14Str,
        quantity: 1,
        unit_price_at_sale: 420000,
        cost_price_at_sale: 250000,
        discount: 40000,
        total_revenue: 380000,
        total_cost: 250000,
        profit: 130000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${d14Str}T18:25:00.000Z`,
      },
      {
        id: 16,
        order_id: 10,
        client_order_id: 'ord-d14-001',
        client_transaction_id: 'tx-10-item-02',
        transaction_code: `HD-${d14Str.replace(/-/g, '')}-001-P8`,
        product_id: 8,
        product_name: 'Bộ Vali Bác Sĩ Nha Khoa Khám Răng (24 món)',
        sku: 'GD-MED-01',
        category_name: 'Đồ chơi giáo dục & Hướng nghiệp',
        product_type_name: 'Bộ đồ chơi Bác sĩ / Kỹ sư',
        sale_date: d14Str,
        quantity: 2,
        unit_price_at_sale: 175000,
        cost_price_at_sale: 95000,
        discount: 0,
        total_revenue: 350000,
        total_cost: 190000,
        profit: 160000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${d14Str}T18:25:00.000Z`,
      },
      // Order 11: lastMonth1 (Prior period)
      {
        id: 17,
        order_id: 11,
        client_order_id: 'ord-prev-001',
        client_transaction_id: 'tx-11-item-01',
        transaction_code: `HD-${lastMonth1.replace(/-/g, '')}-001-P1`,
        product_id: 1,
        product_name: 'Gấu Bông Capybara Rút Mũi 35cm',
        sku: 'GB-CAPY-01',
        category_name: 'Gấu bông & Thú nhồi bông',
        product_type_name: 'Gấu bông Capybara',
        sale_date: lastMonth1,
        quantity: 2,
        unit_price_at_sale: 150000,
        cost_price_at_sale: 85000,
        discount: 20000,
        total_revenue: 280000,
        total_cost: 170000,
        profit: 110000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${lastMonth1}T10:30:00.000Z`,
      },
      {
        id: 18,
        order_id: 11,
        client_order_id: 'ord-prev-001',
        client_transaction_id: 'tx-11-item-02',
        transaction_code: `HD-${lastMonth1.replace(/-/g, '')}-001-P4`,
        product_id: 4,
        product_name: 'Bộ Xếp Hình Trạm Cứu Hỏa Đô Thị (520 chi tiết)',
        sku: 'LG-CITY-01',
        category_name: 'Đồ chơi xếp hình & Lắp ráp',
        product_type_name: 'Lắp ráp mô hình Thành phố',
        sale_date: lastMonth1,
        quantity: 1,
        unit_price_at_sale: 360000,
        cost_price_at_sale: 210000,
        discount: 0,
        total_revenue: 360000,
        total_cost: 210000,
        profit: 150000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: `${lastMonth1}T10:30:00.000Z`,
      },
      // Order 12: lastMonth2 (Prior period)
      {
        id: 19,
        order_id: 12,
        client_order_id: 'ord-prev-002',
        client_transaction_id: 'tx-12-item-01',
        transaction_code: `HD-${lastMonth2.replace(/-/g, '')}-002-P7`,
        product_id: 7,
        product_name: 'Máy Bay 4 Cánh Cảm Ứng Độ Cao Mini Drone',
        sku: 'RC-DRONE-01',
        category_name: 'Đồ chơi điều khiển từ xa',
        product_type_name: 'Flycam / Drone mini',
        sale_date: lastMonth2,
        quantity: 1,
        unit_price_at_sale: 320000,
        cost_price_at_sale: 190000,
        discount: 0,
        total_revenue: 320000,
        total_cost: 190000,
        profit: 130000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${lastMonth2}T16:00:00.000Z`,
      },
      {
        id: 20,
        order_id: 12,
        client_order_id: 'ord-prev-002',
        client_transaction_id: 'tx-12-item-02',
        transaction_code: `HD-${lastMonth2.replace(/-/g, '')}-002-P9`,
        product_id: 9,
        product_name: 'Xe Trượt Scooter Bánh Phát Sáng Điều Chỉnh Độ Cao',
        sku: 'VD-SCOOT-01',
        category_name: 'Đồ chơi vận động ngoài trời',
        product_type_name: 'Xe trượt Scooter gập gọn',
        sale_date: lastMonth2,
        quantity: 1,
        unit_price_at_sale: 380000,
        cost_price_at_sale: 220000,
        discount: 30000,
        total_revenue: 350000,
        total_cost: 220000,
        profit: 130000,
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 2,
        created_at: `${lastMonth2}T16:00:00.000Z`,
      },
    ];

    // Seed sample imports
    this.imports = [
      {
        id: 1,
        client_import_id: 'sample-import-001',
        server_id: 1,
        import_code: 'NK-20260901-001',
        supplier_id: 1,
        import_date: '2026-09-01',
        expected_date: '2026-09-02',
        total_amount: 8100000,
        note: 'Nhập hàng định kỳ đầu tháng từ Tổng Kho',
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: '2026-09-01T08:00:00.000Z',
        synced_at: '2026-09-01T08:05:00.000Z',
      }
    ];

    // Seed sample inventory lots (FIFO)
    this.inventoryLots = [
      {
        id: 1,
        lot_code: 'LOT-20260901-GB-CAPY-01-001',
        product_id: 1,
        product_name: 'Gấu Bông Capybara Rút Mũi 35cm',
        sku: 'GB-CAPY-01',
        purchase_date: '2026-09-01',
        quantity_received: 50,
        quantity_remaining: 45,
        unit_cost: 85000,
        supplier_id: 1,
        supplier_name: 'Tổng Kho Đồ Chơi VN',
        import_id: 1,
        note: 'Lô Capybara đầu tháng',
        created_by: 1,
        created_at: '2026-09-01T08:00:00.000Z',
      },
      {
        id: 2,
        lot_code: 'LOT-20260901-GB-CAPY-02-002',
        product_id: 2,
        product_name: 'Gấu Bông Capybara Đeo Balo Rùa 45cm',
        sku: 'GB-CAPY-02',
        purchase_date: '2026-09-01',
        quantity_received: 35,
        quantity_remaining: 30,
        unit_cost: 110000,
        supplier_id: 1,
        supplier_name: 'Tổng Kho Đồ Chơi VN',
        import_id: 1,
        note: 'Lô Balo rùa',
        created_by: 1,
        created_at: '2026-09-01T08:00:00.000Z',
      },
      {
        id: 3,
        lot_code: 'LOT-20260901-GB-TEDDY-01-003',
        product_id: 3,
        product_name: 'Gấu Teddy Nơ Ôm Trái Tim 50cm',
        sku: 'GB-TEDDY-01',
        purchase_date: '2026-09-01',
        quantity_received: 30,
        quantity_remaining: 25,
        unit_cost: 130000,
        supplier_id: 1,
        supplier_name: 'Tổng Kho Đồ Chơi VN',
        import_id: 1,
        note: 'Lô Gấu Teddy nơ',
        created_by: 1,
        created_at: '2026-09-01T08:00:00.000Z',
      },
      {
        id: 4,
        lot_code: 'LOT-20260902-LG-CITY-01-004',
        product_id: 4,
        product_name: 'Bộ Xếp Hình Trạm Cứu Hỏa Đô Thị (520 chi tiết)',
        sku: 'LG-CITY-01',
        purchase_date: '2026-09-02',
        quantity_received: 20,
        quantity_remaining: 20,
        unit_cost: 210000,
        supplier_id: 1,
        supplier_name: 'Tổng Kho Đồ Chơi VN',
        import_id: 1,
        note: 'Lô Lego Cứu hỏa',
        created_by: 1,
        created_at: '2026-09-02T09:00:00.000Z',
      },
      {
        id: 5,
        lot_code: 'LOT-20260902-LG-ROBOT-01-005',
        product_id: 5,
        product_name: 'Robot Chiến Binh Biến Hình Transformers',
        sku: 'LG-ROBOT-01',
        purchase_date: '2026-09-02',
        quantity_received: 20,
        quantity_remaining: 15,
        unit_cost: 180000,
        supplier_id: 1,
        supplier_name: 'Tổng Kho Đồ Chơi VN',
        import_id: 1,
        note: 'Lô Robot biến hình',
        created_by: 1,
        created_at: '2026-09-02T09:00:00.000Z',
      },
      {
        id: 6,
        lot_code: 'LOT-20260902-RC-CAR-01-006',
        product_id: 6,
        product_name: 'Xe Đua Địa Hình Leo Núi 4WD Tỉ Lệ 1:16',
        sku: 'RC-CAR-01',
        purchase_date: '2026-09-02',
        quantity_received: 25,
        quantity_remaining: 18,
        unit_cost: 250000,
        supplier_id: 2,
        supplier_name: 'Công Ty CP Đồ Chơi Thông Minh',
        import_id: 2,
        note: 'Lô Xe đua leo núi',
        created_by: 1,
        created_at: '2026-09-02T10:00:00.000Z',
      },
      {
        id: 7,
        lot_code: 'LOT-20260902-RC-DRONE-01-007',
        product_id: 7,
        product_name: 'Máy Bay 4 Cánh Cảm Ứng Độ Cao Mini Drone',
        sku: 'RC-DRONE-01',
        purchase_date: '2026-09-02',
        quantity_received: 15,
        quantity_remaining: 12,
        unit_cost: 190000,
        supplier_id: 2,
        supplier_name: 'Công Ty CP Đồ Chơi Thông Minh',
        import_id: 2,
        note: 'Lô Mini Drone',
        created_by: 1,
        created_at: '2026-09-02T10:00:00.000Z',
      },
      {
        id: 8,
        lot_code: 'LOT-20260903-GD-MED-01-008',
        product_id: 8,
        product_name: 'Bộ Vali Bác Sĩ Nha Khoa Khám Răng (24 món)',
        sku: 'GD-MED-01',
        purchase_date: '2026-09-03',
        quantity_received: 40,
        quantity_remaining: 35,
        unit_cost: 95000,
        supplier_id: 2,
        supplier_name: 'Công Ty CP Đồ Chơi Thông Minh',
        import_id: 2,
        note: 'Lô Vali bác sĩ',
        created_by: 1,
        created_at: '2026-09-03T09:00:00.000Z',
      },
      {
        id: 9,
        lot_code: 'LOT-20260903-VD-SCOOT-01-009',
        product_id: 9,
        product_name: 'Xe Trượt Scooter Bánh Phát Sáng Điều Chỉnh Độ Cao',
        sku: 'VD-SCOOT-01',
        purchase_date: '2026-09-03',
        quantity_received: 20,
        quantity_remaining: 14,
        unit_cost: 220000,
        supplier_id: 3,
        supplier_name: 'Đại Lý Phân Phối Việt Long',
        import_id: 3,
        note: 'Lô Scooter phát sáng',
        created_by: 1,
        created_at: '2026-09-03T11:00:00.000Z',
      },
      {
        id: 10,
        lot_code: 'LOT-20260903-VD-BONG-01-010',
        product_id: 10,
        product_name: 'Quả Bóng Đá Da Pu Size 4 Cho Trẻ Em',
        sku: 'VD-BONG-01',
        purchase_date: '2026-09-03',
        quantity_received: 60,
        quantity_remaining: 50,
        unit_cost: 75000,
        supplier_id: 3,
        supplier_name: 'Đại Lý Phân Phối Việt Long',
        import_id: 3,
        note: 'Lô Quả bóng đá size 4',
        created_by: 1,
        created_at: '2026-09-03T11:00:00.000Z',
      },
    ];

    // Seed stock movements (Ledger)
    this.stockMovements = [
      {
        id: 1,
        client_movement_id: 'mov-init-01',
        product_id: 1,
        product_name: 'Gấu Bông Capybara Rút Mũi 35cm',
        sku: 'GB-CAPY-01',
        movement_type: 'PURCHASE',
        quantity_change: 50,
        balance_after: 50,
        movement_date: '2026-09-01',
        reference_type: 'imports',
        reference_id: '1',
        sync_status: 'SYNCED',
        note: 'Nhập kho phiếu NK-20260901-001 (Lô LOT-20260901-GB-CAPY-01-001)',
        created_by: 1,
        creator_name: 'Admin Quản Trị',
        created_at: '2026-09-01T08:00:00.000Z',
      },
      {
        id: 2,
        client_movement_id: 'mov-sale-01',
        product_id: 1,
        product_name: 'Gấu Bông Capybara Rút Mũi 35cm',
        sku: 'GB-CAPY-01',
        movement_type: 'SALE',
        quantity_change: -5,
        balance_after: 45,
        movement_date: todayStr,
        reference_type: 'sales_records',
        reference_id: '1',
        sync_status: 'SYNCED',
        note: 'Ghi nhận bán mã HD-20260910-001',
        created_by: 1,
        creator_name: 'Thu ngân',
        created_at: '2026-09-10T10:00:00.000Z',
      },
    ];

    // Seed price and cost history
    this.costPriceHistory = [
      { id: 1, product_id: 1, cost_price: 80000, effective_from: '2026-08-01', note: 'Giá vốn đợt 1', created_by: 1, created_at: '2026-08-01T08:00:00.000Z' },
      { id: 2, product_id: 1, cost_price: 85000, effective_from: '2026-09-01', note: 'Nhập kho theo phiếu NK-20260901-001', created_by: 1, created_at: '2026-09-01T08:00:00.000Z' },
      { id: 3, product_id: 2, cost_price: 110000, effective_from: '2026-09-01', note: 'Nhập kho đợt 1', created_by: 1, created_at: '2026-09-01T08:00:00.000Z' },
      { id: 4, product_id: 4, cost_price: 210000, effective_from: '2026-09-02', note: 'Nhập kho lô Lego', created_by: 1, created_at: '2026-09-02T09:00:00.000Z' },
    ];

    this.priceHistory = [
      { id: 1, product_id: 1, price: 145000, effective_from: '2026-08-01', note: 'Giá bán niêm yết ban đầu', created_by: 1, created_at: '2026-08-01T08:00:00.000Z' },
      { id: 2, product_id: 1, price: 150000, effective_from: '2026-09-01', note: 'Điều chỉnh giá niêm yết', created_by: 1, created_at: '2026-09-01T08:00:00.000Z' },
      { id: 3, product_id: 2, price: 195000, effective_from: '2026-09-01', note: 'Giá bán niêm yết ban đầu', created_by: 1, created_at: '2026-09-01T08:00:00.000Z' },
      { id: 4, product_id: 4, price: 360000, effective_from: '2026-09-02', note: 'Giá bán niêm yết ban đầu', created_by: 1, created_at: '2026-09-02T09:00:00.000Z' },
    ];

    // Seed sample conflict
    this.conflicts = [
      {
        id: 1,
        conflict_id: 'demo-cnf-001',
        client_transaction_id: 'tx-conflict-01',
        entity_type: 'SALE_ORDER',
        entity_id: 'HD-CONFLICT-01',
        local_data: JSON.stringify({ sku: 'GB-CAPY-01', qty: 2, client_stock: 3 }),
        server_data: JSON.stringify({ current_stock: 1, error: 'INSUFFICIENT_STOCK' }),
        reason: 'Tồn kho trên máy chủ chỉ còn 1 cái do máy khác đã bán trước.',
        status: 'OPEN',
        conflict_type: 'INVENTORY_CONFLICT',
        operation: 'CREATE',
        device_id: 'demo-web-device',
        user_id: 1,
        resolution: null,
        resolved_by: null,
        detected_at: new Date().toISOString(),
        resolved_at: null,
      },
    ];

    // Seed Purchase Orders (imports & import_items)
    this.imports = [
      {
        id: 1,
        client_import_id: 'po-client-001',
        server_id: 1,
        import_code: 'PO-20260901-0001',
        supplier_id: 1,
        supplier_name: 'Xưởng Sản Xuất Thú Bông Miền Nam',
        import_date: '2026-09-01',
        expected_date: '2026-09-02',
        total_amount: 4250000,
        note: 'Nhập lô hàng đầu tháng 9',
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        created_by: 1,
        created_at: '2026-09-01T08:00:00.000Z',
        synced_at: '2026-09-01T08:10:00.000Z',
      },
      {
        id: 2,
        client_import_id: 'po-client-002',
        server_id: null,
        import_code: 'PO-20260911-0002',
        supplier_id: 1,
        supplier_name: 'Xưởng Sản Xuất Thú Bông Miền Nam',
        import_date: todayStr,
        expected_date: '2026-09-15',
        total_amount: 2200000,
        note: 'Đơn đặt hàng chờ nhà cung cấp giao vào ngày 15/09',
        status: 'PENDING',
        sync_status: 'PENDING',
        created_by: 1,
        created_at: new Date().toISOString(),
        synced_at: null,
      },
    ];

    this.importItems = [
      {
        id: 1,
        import_id: 1,
        product_id: 1,
        product_name: 'Gấu Bông Capybara Rút Mũi 35cm',
        sku: 'GB-CAPY-01',
        quantity: 50,
        unit_cost_price: 85000,
        total_amount: 4250000,
        created_at: '2026-09-01T08:00:00.000Z',
      },
      {
        id: 2,
        import_id: 2,
        product_id: 2,
        product_name: 'Gấu Bông Teddy Nơ Hồng 50cm',
        sku: 'GB-TEDDY-02',
        quantity: 20,
        unit_cost_price: 110000,
        total_amount: 2200000,
        created_at: new Date().toISOString(),
      },
    ];

    this.metadata.set('device_registered', 'true');
    this.metadata.set('last_synced_at', new Date().toISOString());
  }

  async execAsync(sql: string): Promise<void> {
    return;
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const res = await this.internalRunAsync(sql, params);
    this.saveToLocalStorage();
    return res;
  }

  private async internalRunAsync(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const cleanSql = sql.trim();
    const upper = cleanSql.toUpperCase();

    // 1. INSERT INTO sales_orders
    if (upper.startsWith('INSERT INTO SALES_ORDERS')) {
      this.lastInsertedId++;
      let clientOrderId: string;
      let orderCode: string;
      let saleDate: string;
      let totalAmount: number;
      let totalDiscount: number;
      let finalAmount: number;
      let totalItems: number;
      let paymentMethod: string = 'CASH';
      let cashReceived: number | null = null;
      let cashChange: number | null = null;
      let note: string | null = null;
      let createdBy: number = 1;

      if (params.length >= 12) {
        [clientOrderId, orderCode, saleDate, totalAmount, totalDiscount, finalAmount, totalItems, paymentMethod, cashReceived, cashChange, note, createdBy] = params as any[];
      } else if (params.length === 9) {
        [clientOrderId, orderCode, saleDate, totalAmount, totalDiscount, finalAmount, totalItems, note, createdBy] = params as any[];
      } else {
        [clientOrderId, orderCode, saleDate, totalAmount, totalDiscount, finalAmount, totalItems] = params as any[];
        createdBy = Number(params[params.length - 1]) || 1;
      }

      this.salesOrders.unshift({
        id: this.lastInsertedId,
        client_order_id: clientOrderId,
        order_code: orderCode,
        sale_date: saleDate || new Date().toISOString(),
        total_amount: Number(totalAmount) || 0,
        total_discount: Number(totalDiscount) || 0,
        final_amount: Number(finalAmount) || 0,
        total_items: Number(totalItems) || 1,
        payment_method: paymentMethod || 'CASH',
        cash_received: cashReceived ? Number(cashReceived) : null,
        cash_change: cashChange !== null ? Number(cashChange) : null,
        status: 'COMPLETED',
        sync_status: 'PENDING',
        note: note || null,
        created_by: createdBy ? Number(createdBy) : 1,
        created_at: new Date().toISOString(),
        synced_at: null,
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 1b. UPDATE sales_orders
    if (upper.startsWith('UPDATE SALES_ORDERS')) {
      const targetId = params[params.length - 1];
      const order = this.salesOrders.find(o => o.id === Number(targetId) || o.client_order_id === String(targetId));
      if (order) {
        if (upper.includes("STATUS = 'CANCELLED'")) {
          order.status = 'CANCELLED';
          if (params.length >= 3) {
            order.cancel_reason = String(params[0] || 'Khách hủy');
            order.cancelled_by = Number(params[1]) || 1;
          }
          order.cancelled_at = new Date().toISOString();
        } else if (upper.includes("SYNC_STATUS = 'SYNCED'")) {
          order.sync_status = 'SYNCED';
          order.synced_at = new Date().toISOString();
        }
      }
      return { changes: 1, lastInsertRowId: order?.id || 1 };
    }

    // 2. INSERT INTO sales_records
    if (upper.startsWith('INSERT INTO SALES_RECORDS')) {
      this.lastInsertedId++;
      let orderId: number | null = null;
      let clientOrderId: string | null = null;
      let clientTxId: string;
      let txCode: string;
      let productId: number;
      let saleDate: string;
      let qty: number;
      let unitPrice: number;
      let costPrice: number;
      let discount: number;
      let totalRev: number;
      let totalCost: number;
      let profit: number;
      let createdBy: number = 1;

      if (params.length >= 15) {
        orderId = Number(params[0]) || null;
        clientOrderId = params[1] as string || null;
        clientTxId = params[2] as string;
        txCode = params[3] as string;
        productId = Number(params[4]);
        saleDate = params[5] as string;
        qty = Number(params[6]);
        unitPrice = Number(params[7]);
        costPrice = Number(params[8]);
        discount = Number(params[9]);
        totalRev = Number(params[10]);
        totalCost = Number(params[11]);
        profit = Number(params[12]);
        createdBy = Number(params[14]) || 1;
      } else {
        [
          clientTxId, txCode, productId, saleDate, qty,
          unitPrice, costPrice, discount, totalRev, totalCost, profit
        ] = params as any[];
        createdBy = Number(params[params.length - 1]) || 1;
      }

      const prod = this.products.find(p => p.id === Number(productId));

      this.salesRecords.unshift({
        id: this.lastInsertedId,
        order_id: orderId,
        client_order_id: clientOrderId,
        client_transaction_id: clientTxId,
        transaction_code: txCode,
        product_id: Number(productId),
        product_name: prod?.name || 'Sản phẩm',
        sku: prod?.sku,
        sale_date: saleDate || new Date().toISOString().split('T')[0],
        quantity: Number(qty) || 1,
        unit_price_at_sale: Number(unitPrice) || 0,
        cost_price_at_sale: Number(costPrice) || 0,
        discount: Number(discount) || 0,
        total_revenue: Number(totalRev) || 0,
        total_cost: Number(totalCost) || 0,
        profit: Number(profit) || 0,
        status: 'COMPLETED',
        sync_status: 'PENDING',
        created_by: createdBy ? Number(createdBy) : 1,
        created_at: new Date().toISOString(),
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 2b. UPDATE sales_records
    if (upper.startsWith('UPDATE SALES_RECORDS')) {
      const targetId = params[params.length - 1];
      const recordsToUpdate = this.salesRecords.filter(r => 
        r.id === Number(targetId) || 
        r.client_transaction_id === String(targetId) || 
        r.client_order_id === String(targetId) ||
        r.order_id === Number(targetId)
      );
      recordsToUpdate.forEach(r => {
        if (upper.includes("STATUS = 'CANCELLED'")) {
          r.status = 'CANCELLED';
          if (params.length >= 3) {
            r.cancel_reason = String(params[0] || 'Khách hủy');
            r.cancelled_by = Number(params[1]) || 1;
          }
          r.cancelled_at = new Date().toISOString();
        } else if (upper.includes("SYNC_STATUS = 'SYNCED'")) {
          r.sync_status = 'SYNCED';
          r.synced_at = new Date().toISOString();
        }
      });
      return { changes: recordsToUpdate.length || 1, lastInsertRowId: 1 };
    }

    // 3. INSERT INTO imports
    if (upper.startsWith('INSERT INTO IMPORTS')) {
      this.lastInsertedId++;
      let clientImportId: string;
      let importCode: string;
      let supplierId: number | null = null;
      let importDate: string;
      let expectedDate: string | null = null;
      let totalAmount: number;
      let note: string | null = null;
      let status: 'PENDING' | 'COMPLETED' | 'CANCELLED' = 'COMPLETED';
      let createdBy: number = 1;

      if (params.length >= 8) {
        clientImportId = params[0] as string;
        importCode = params[1] as string;
        supplierId = params[2] ? Number(params[2]) : null;
        importDate = params[3] as string;
        expectedDate = (params[4] as string) || null;
        totalAmount = Number(params[5]) || 0;
        note = (params[6] as string) || null;
        status = (params[7] as any) || 'COMPLETED';
        createdBy = Number(params[8]) || 1;
      } else {
        [clientImportId, importCode, supplierId, importDate, totalAmount, note, createdBy] = params as any[];
        status = 'COMPLETED';
      }

      this.imports.unshift({
        id: this.lastInsertedId,
        client_import_id: clientImportId,
        server_id: null,
        import_code: importCode,
        supplier_id: supplierId ? Number(supplierId) : null,
        supplier_name: supplierId === 1 ? 'Xưởng Sản Xuất Thú Bông Miền Nam' : 'Tổng Kho Đồ Chơi VN',
        import_date: importDate || new Date().toISOString().split('T')[0],
        expected_date: expectedDate,
        total_amount: Number(totalAmount) || 0,
        note: note || null,
        status: status || 'COMPLETED',
        sync_status: 'PENDING',
        created_by: createdBy ? Number(createdBy) : 1,
        created_at: new Date().toISOString(),
        synced_at: null,
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 3b. INSERT INTO import_items
    if (upper.startsWith('INSERT INTO IMPORT_ITEMS')) {
      this.lastInsertedId++;
      const [importId, productId, quantity, unitCostPrice, totalAmount] = params as any[];
      const prod = this.products.find(p => p.id === Number(productId));

      this.importItems.push({
        id: this.lastInsertedId,
        import_id: Number(importId),
        product_id: Number(productId),
        product_name: prod?.name,
        sku: prod?.sku,
        quantity: Number(quantity) || 0,
        unit_cost_price: Number(unitCostPrice) || 0,
        total_amount: Number(totalAmount) || 0,
        created_at: new Date().toISOString(),
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 3c. UPDATE imports
    if (upper.startsWith('UPDATE IMPORTS')) {
      const id = Number(params[params.length - 1]);
      const imp = this.imports.find(i => i.id === id);
      if (imp) {
        if (upper.includes('STATUS = ?')) {
          imp.status = params[0] as any;
        } else if (upper.includes("STATUS = 'COMPLETED'")) {
          imp.status = 'COMPLETED';
        }
      }
      return { changes: 1, lastInsertRowId: id };
    }

    // 3d. INSERT INTO categories
    if (upper.startsWith('INSERT INTO CATEGORIES')) {
      this.lastInsertedId++;
      const [code, name, desc] = params as any[];
      this.categories.push({
        id: this.lastInsertedId,
        code: code || `CAT-${this.lastInsertedId}`,
        name: name || `Danh mục ${this.lastInsertedId}`,
        description: desc || null,
        status: 'ACTIVE',
      });
      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 3e. UPDATE categories
    if (upper.startsWith('UPDATE CATEGORIES')) {
      const id = Number(params[params.length - 1]);
      const cat = this.categories.find(c => c.id === id);
      if (cat) {
        if (params.length >= 5) {
          cat.code = (params[0] as string) || cat.code;
          cat.name = (params[1] as string) || cat.name;
          cat.description = (params[2] as string) !== undefined ? (params[2] as string) : cat.description;
          if (params[3] !== undefined) cat.status = params[3] as any;
        } else if (params.length >= 4) {
          cat.name = (params[0] as string) || cat.name;
          cat.description = (params[1] as string) !== undefined ? (params[1] as string) : cat.description;
          if (params[2] !== undefined) cat.status = params[2] as any;
        } else if (params.length >= 3) {
          cat.name = (params[0] as string) || cat.name;
          cat.description = (params[1] as string) !== undefined ? (params[1] as string) : cat.description;
        }
      }
      return { changes: 1, lastInsertRowId: id };
    }

    // 3f. DELETE FROM categories
    if (upper.startsWith('DELETE FROM CATEGORIES')) {
      const id = Number(params[0] !== undefined ? params[0] : params[params.length - 1]);
      if (!isNaN(id) && id > 0) {
        this.categories = this.categories.filter(c => c.id !== id);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    // 4. INSERT INTO inventory_lots
    if (upper.startsWith('INSERT INTO INVENTORY_LOTS')) {
      this.lastInsertedId++;
      const [
        lotCode, productId, purchaseDate, qtyReceived, qtyRemaining,
        unitCost, supplierId, importId, note, createdBy
      ] = params as any[];

      const prod = this.products.find(p => p.id === Number(productId));

      this.inventoryLots.unshift({
        id: this.lastInsertedId,
        lot_code: lotCode,
        product_id: Number(productId),
        product_name: prod?.name,
        sku: prod?.sku,
        purchase_date: purchaseDate || new Date().toISOString().split('T')[0],
        quantity_received: Number(qtyReceived) || 0,
        quantity_remaining: Number(qtyRemaining) || 0,
        unit_cost: Number(unitCost) || 0,
        supplier_id: supplierId ? Number(supplierId) : null,
        import_id: importId ? Number(importId) : null,
        note: note || null,
        created_by: createdBy ? Number(createdBy) : 1,
        created_at: new Date().toISOString(),
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 4b. UPDATE inventory_lots
    if (upper.startsWith('UPDATE INVENTORY_LOTS')) {
      const lotId = Number(params[params.length - 1]);
      const lot = this.inventoryLots.find(l => l.id === lotId);
      if (lot) {
        if (upper.includes('QUANTITY_REMAINING = QUANTITY_REMAINING + ?')) {
          lot.quantity_remaining += Number(params[0]) || 0;
        } else if (upper.includes('QUANTITY_REMAINING = ?')) {
          lot.quantity_remaining = Number(params[0]) || 0;
        }
      }
      return { changes: 1, lastInsertRowId: lotId };
    }

    // 5. INSERT INTO cost_price_history
    if (upper.startsWith('INSERT INTO COST_PRICE_HISTORY')) {
      this.lastInsertedId++;
      const [productId, costPrice, effectiveFrom, note, createdBy] = params as any[];

      this.costPriceHistory.unshift({
        id: this.lastInsertedId,
        product_id: Number(productId),
        cost_price: Number(costPrice) || 0,
        effective_from: effectiveFrom || new Date().toISOString().split('T')[0],
        note: note || null,
        created_by: createdBy ? Number(createdBy) : 1,
        created_at: new Date().toISOString(),
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 5b. INSERT INTO price_history
    if (upper.startsWith('INSERT INTO PRICE_HISTORY')) {
      this.lastInsertedId++;
      const [productId, price, effectiveFrom, note, createdBy] = params as any[];

      this.priceHistory.unshift({
        id: this.lastInsertedId,
        product_id: Number(productId),
        price: Number(price) || 0,
        effective_from: effectiveFrom || new Date().toISOString().split('T')[0],
        note: note || null,
        created_by: createdBy ? Number(createdBy) : 1,
        created_at: new Date().toISOString(),
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 6. INSERT INTO stock_movements
    if (upper.startsWith('INSERT INTO STOCK_MOVEMENTS')) {
      this.lastInsertedId++;
      let clientMovementId: string = `mov-${this.lastInsertedId}`;
      let productId: number = 1;
      let movementType: string = 'PURCHASE';
      let qtyChange: number = 0;
      let balanceAfter: number = 0;
      let movementDate: string = new Date().toISOString().split('T')[0];
      let referenceType: string | null = null;
      let referenceId: string | null = null;
      let note: string | null = null;
      let createdBy: number = 1;

      if (params.length >= 10) {
        [
          clientMovementId, productId, movementType, qtyChange,
          balanceAfter, movementDate, referenceType, referenceId,
          note, createdBy
        ] = params as any[];
      } else if (upper.includes("'PURCHASE'") || upper.includes('"PURCHASE"')) {
        clientMovementId = String(params[0] || clientMovementId);
        productId = Number(params[1]) || 1;
        movementType = 'PURCHASE';
        qtyChange = Number(params[2]) || 0;
        balanceAfter = Number(params[3]) || 0;
        movementDate = String(params[4] || movementDate);
        referenceType = 'imports';
        referenceId = params[5] ? String(params[5]) : null;
        note = params[6] ? String(params[6]) : null;
        createdBy = Number(params[7]) || 1;
      } else if (upper.includes("'SALE'") || upper.includes('"SALE"')) {
        clientMovementId = String(params[0] || clientMovementId);
        productId = Number(params[1]) || 1;
        movementType = 'SALE';
        qtyChange = Number(params[2]) || 0;
        balanceAfter = Number(params[3]) || 0;
        movementDate = String(params[4] || movementDate);
        referenceType = 'sales_records';
        referenceId = params[5] ? String(params[5]) : null;
        note = params[6] ? String(params[6]) : null;
        createdBy = Number(params[7]) || 1;
      } else if (params.length === 8) {
        // Stock adjustment: [clientAdjustmentId, productId, movementType, qtyChange, balanceAfter, dateStr, note, createdBy]
        clientMovementId = String(params[0] || clientMovementId);
        productId = Number(params[1]) || 1;
        movementType = String(params[2] || 'ADJUSTMENT');
        qtyChange = Number(params[3]) || 0;
        balanceAfter = Number(params[4]) || 0;
        movementDate = String(params[5] || movementDate);
        referenceType = 'stock_adjustments';
        referenceId = null;
        note = params[6] ? String(params[6]) : null;
        createdBy = Number(params[7]) || 1;
      } else {
        [
          clientMovementId, productId, movementType, qtyChange,
          balanceAfter, movementDate
        ] = params as any[];
        note = params[params.length - 2] ? String(params[params.length - 2]) : null;
        createdBy = Number(params[params.length - 1]) || 1;
      }

      const prod = this.products.find(p => p.id === Number(productId));

      this.stockMovements.unshift({
        id: this.lastInsertedId,
        client_movement_id: clientMovementId || `mov-${this.lastInsertedId}`,
        product_id: Number(productId),
        product_name: prod?.name,
        sku: prod?.sku,
        movement_type: movementType,
        quantity_change: Number(qtyChange) || 0,
        balance_after: Number(balanceAfter) || 0,
        movement_date: movementDate || new Date().toISOString().split('T')[0],
        reference_type: referenceType || null,
        reference_id: referenceId ? String(referenceId) : null,
        sync_status: 'PENDING',
        note: note || null,
        created_by: createdBy ? Number(createdBy) : 1,
        creator_name: 'Nhân viên',
        created_at: new Date().toISOString(),
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 6b. INSERT INTO products
    if (upper.startsWith('INSERT INTO PRODUCTS')) {
      this.lastInsertedId++;
      let newProd: ProductRow;
      if (params.length >= 8) {
        const [sku, name, catId, typeId, cost, price, stock, minAlert, status, desc] = params as any[];
        newProd = {
          id: this.lastInsertedId,
          sku: String(sku),
          name: String(name),
          category_id: Number(catId) || 1,
          product_type_id: Number(typeId) || 1,
          current_cost_price: Number(cost) || 0,
          current_selling_price: Number(price) || 0,
          current_stock: Number(stock) || 0,
          min_stock_alert: Number(minAlert) || 5,
          status: (status as any) || 'ACTIVE',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        newProd = {
          id: this.lastInsertedId,
          sku: String(params[0] || `SKU-${this.lastInsertedId}`),
          name: String(params[1] || `Sản phẩm ${this.lastInsertedId}`),
          category_id: Number(params[2]) || 1,
          product_type_id: Number(params[3]) || 1,
          current_cost_price: 0,
          current_selling_price: Number(params[4]) || 0,
          current_stock: 0,
          min_stock_alert: 5,
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      this.products.unshift(newProd);
      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    // 7. UPDATE products
    if (upper.includes('UPDATE PRODUCTS')) {
      let id = Number(params[params.length - 1]);
      if (isNaN(id) || id === undefined) {
        const idMatch = cleanSql.match(/WHERE\s+ID\s*=\s*(\d+)/i);
        if (idMatch) id = Number(idMatch[1]);
      }
      const prod = this.products.find(p => p.id === id);
      if (prod) {
        if (upper.includes("STATUS = 'INACTIVE'") || upper.includes("STATUS='INACTIVE'")) {
          prod.status = 'INACTIVE';
        } else if (upper.includes("STATUS = 'ACTIVE'") || upper.includes("STATUS='ACTIVE'")) {
          prod.status = 'ACTIVE';
        } else if (upper.includes('STATUS = ?')) {
          const sParam = params.find(p => p === 'ACTIVE' || p === 'INACTIVE');
          if (sParam) prod.status = sParam as any;
        }

        if (upper.includes('CURRENT_STOCK = ?, CURRENT_COST_PRICE = ?')) {
          prod.current_stock = Number(params[0]);
          prod.current_cost_price = Number(params[1]);
        } else if (upper.includes('CURRENT_STOCK = ?')) {
          prod.current_stock = Number(params[0]);
        } else if (upper.includes('NAME = ?, SKU = ?') || upper.includes('NAME = ?')) {
          prod.name = (params[0] as string) || prod.name;
          prod.sku = (params[1] as string) || prod.sku;
          if (params.length >= 7) {
            prod.category_id = Number(params[2]) || prod.category_id;
            prod.product_type_id = Number(params[3]) || prod.product_type_id;
            prod.current_selling_price = Number(params[4]) || prod.current_selling_price;
            prod.min_stock_alert = Number(params[5]) || prod.min_stock_alert;
            prod.status = (params[6] as any) || prod.status;
          }
        }
        prod.updated_at = new Date().toISOString();
      }
      return { changes: 1, lastInsertRowId: id };
    }

    // 8. INSERT INTO sync_queue
    if (upper.startsWith('INSERT INTO SYNC_QUEUE')) {
      this.lastInsertedId++;
      const [
        clientMutationId, entityType, entityId, action,
        payloadJson, payloadVersion, status, retryCount, userId, deviceId
      ] = params as any[];

      this.syncQueue.unshift({
        id: this.lastInsertedId,
        client_mutation_id: clientMutationId,
        entity_type: entityType,
        entity_id: String(entityId),
        action: action || 'CREATE',
        payload_json: payloadJson,
        payload_version: Number(payloadVersion) || 1,
        status: status || 'PENDING',
        retry_count: Number(retryCount) || 0,
        last_error: null,
        next_retry_at: null,
        user_id: userId ? Number(userId) : 1,
        device_id: deviceId || 'web-demo-device',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return { changes: 1, lastInsertRowId: this.lastInsertedId };
    }

    return { changes: 1, lastInsertRowId: ++this.lastInsertedId };
  }

  async getAllAsync<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const cleanSql = sql.trim();
    const upper = cleanSql.toUpperCase();

    // Helper: Extract date range from params
    const dateParams = params.filter(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p));
    const startDate = dateParams.length >= 1 ? String(dateParams[0]) : undefined;
    const endDate = dateParams.length >= 2 ? String(dateParams[1]) : (dateParams.length === 1 ? String(dateParams[0]) : undefined);

    let userParam: number | undefined;
    if (upper.includes('CREATED_BY = ?') || upper.includes('SR.CREATED_BY = ?')) {
      const uCandidate = params.find(p => typeof p === 'number' || (typeof p === 'string' && /^\d+$/.test(p) && !dateParams.includes(p)));
      if (uCandidate !== undefined) {
        userParam = Number(uCandidate);
      }
    }

    // Filter sales records by date, user and status
    const getFilteredSales = () => {
      return this.salesRecords.filter(s => {
        if ((s.status || 'COMPLETED') !== 'COMPLETED') return false;
        const d = (s.sale_date || '').slice(0, 10);
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        if (userParam !== undefined && s.created_by !== undefined && s.created_by !== null && s.created_by !== userParam) {
          return false;
        }
        return true;
      });
    };

    // 0. Users
    if (upper.includes('FROM USERS')) {
      return this.users as any;
    }

    // 1. Categories
    if (upper.includes('FROM CATEGORIES')) {
      // 1a. Capital analysis: Category valuation
      if (upper.includes('STOCK_VALUATION')) {
        const rows = this.categories.map(c => {
          const prods = this.products.filter(p => p.category_id === c.id && p.status === 'ACTIVE');
          const stock_valuation = prods.reduce((sum, p) => sum + (p.current_stock * p.current_cost_price), 0);
          const stock_quantity = prods.reduce((sum, p) => sum + (p.current_stock || 0), 0);
          return {
            category_id: c.id,
            id: c.id,
            category_name: c.name,
            name: c.name,
            stock_valuation,
            stock_quantity,
          };
        }).filter(r => r.stock_valuation > 0);
        return rows.sort((a, b) => b.stock_valuation - a.stock_valuation) as any;
      }

      // 1b. Performance analysis: Category sales performance
      if (
        upper.includes('CATEGORY_NAME') ||
        upper.includes('NET_REVENUE') ||
        upper.includes('PRODUCT_COUNT') ||
        upper.includes('COALESCE(SUM(SR.QUANTITY)') ||
        upper.includes('GROUP BY C.ID')
      ) {
        const filteredSales = getFilteredSales();
        const rows = this.categories.map(c => {
          const catProds = this.products.filter(p => p.category_id === c.id);
          const catProdIds = new Set(catProds.map(p => p.id));
          const matchingSales = filteredSales.filter(s => catProdIds.has(s.product_id));

          const sold_quantity = matchingSales.reduce((sum, s) => sum + (s.quantity || 0), 0);
          const gross_sales = matchingSales.reduce((sum, s) => sum + ((s.quantity * s.unit_price_at_sale) || (s.total_revenue + s.discount)), 0);
          const discount = matchingSales.reduce((sum, s) => sum + (s.discount || 0), 0);
          const net_revenue = matchingSales.reduce((sum, s) => sum + (s.total_revenue || 0), 0);
          const cogs = matchingSales.reduce((sum, s) => sum + (s.total_cost || 0), 0);
          const gross_profit = matchingSales.reduce((sum, s) => sum + (s.profit || 0), 0);

          return {
            category_id: c.id,
            id: c.id,
            category_name: c.name,
            name: c.name,
            category_code: c.code,
            code: c.code,
            product_count: catProds.length,
            sold_quantity,
            gross_sales,
            discount,
            net_revenue,
            cogs,
            gross_profit,
          };
        });
        return rows.sort((a, b) => b.net_revenue - a.net_revenue) as any;
      }

      return this.categories as any;
    }

    // 2. Product Types
    if (upper.includes('FROM PRODUCT_TYPES')) {
      return this.productTypes as any;
    }

    // 3. Products
    if (upper.includes('FROM PRODUCTS')) {
      // 3a. Capital analysis: Top products valuation
      if (upper.includes('STOCK_VALUATION') && (upper.includes('ORDER BY STOCK_VALUATION') || upper.includes('CURRENT_STOCK * P.CURRENT_COST_PRICE'))) {
        const rows = this.products.filter(p => p.status === 'ACTIVE' && p.current_stock > 0).map(p => {
          const cat = this.categories.find(c => c.id === p.category_id);
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            category_name: cat?.name || 'Chưa phân loại',
            current_stock: p.current_stock,
            current_cost_price: p.current_cost_price,
            unit_cost_price: p.current_cost_price,
            stock_valuation: p.current_stock * p.current_cost_price,
          };
        }).sort((a, b) => b.stock_valuation - a.stock_valuation);
        return rows.slice(0, 10) as any;
      }

      // 3b. Slow moving products (Zero sales in period)
      if (upper.includes('NOT IN') && upper.includes('SALES_RECORDS')) {
        const filteredSales = getFilteredSales();
        const activeSoldIds = new Set(filteredSales.map(s => s.product_id));
        const slowProds = this.products.filter(p => p.status === 'ACTIVE' && !activeSoldIds.has(p.id)).map(p => {
          const cat = this.categories.find(c => c.id === p.category_id);
          const pt = this.productTypes.find(t => t.id === p.product_type_id);
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            current_stock: p.current_stock,
            current_cost_price: p.current_cost_price,
            stock_valuation: p.current_stock * p.current_cost_price,
            category_name: cat?.name || 'Chưa phân loại',
            product_type_name: pt?.name || 'Tiêu chuẩn',
          };
        }).sort((a, b) => b.current_stock - a.current_stock);
        return slowProds as any;
      }

      // 3c. Product Performance & Ranking (Tab 3)
      if (
        upper.includes('COALESCE(SUM(SR.QUANTITY)') ||
        (upper.includes('LEFT JOIN SALES_RECORDS') && (upper.includes('GROSS_PROFIT') || upper.includes('NET_REVENUE') || upper.includes('COGS') || upper.includes('COALESCE(SUM(SR.PROFIT)')))
      ) {
        const filteredSales = getFilteredSales();
        return this.products.filter(p => p.status === 'ACTIVE').map(p => {
          const cat = this.categories.find(c => c.id === p.category_id);
          const pt = this.productTypes.find(t => t.id === p.product_type_id);
          const pSales = filteredSales.filter(s => s.product_id === p.id);

          const sold_quantity = pSales.reduce((sum, s) => sum + (s.quantity || 0), 0);
          const gross_sales = pSales.reduce((sum, s) => sum + ((s.quantity * s.unit_price_at_sale) || (s.total_revenue + s.discount)), 0);
          const discount = pSales.reduce((sum, s) => sum + (s.discount || 0), 0);
          const net_revenue = pSales.reduce((sum, s) => sum + (s.total_revenue || 0), 0);
          const cogs = pSales.reduce((sum, s) => sum + (s.total_cost || 0), 0);
          const gross_profit = pSales.reduce((sum, s) => sum + (s.profit || 0), 0);

          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            category_name: cat?.name || 'Chưa phân loại',
            product_type_name: pt?.name || 'Tiêu chuẩn',
            sold_quantity,
            gross_sales,
            discount,
            net_revenue,
            cogs,
            gross_profit,
            current_stock: p.current_stock,
            current_cost_price: p.current_cost_price,
          };
        }) as any;
      }

      // 3d. Specific query for getAllStockStatuses: includes server_stock and pending_sold
      if (upper.includes('SERVER_STOCK') || upper.includes('PENDING_SOLD')) {
        return this.products.map((p) => {
          const pendingSold = this.salesRecords
            .filter(s => s.product_id === p.id && s.status === 'COMPLETED' && s.sync_status === 'PENDING')
            .reduce((sum, s) => sum + (s.quantity || 0), 0);
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            server_stock: p.current_stock,
            current_stock: p.current_stock,
            pending_sold: pendingSold,
          };
        }) as any;
      }

      let list = this.products.map((p) => {
        const cat = this.categories.find(c => c.id === p.category_id);
        const pt = this.productTypes.find(t => t.id === p.product_type_id);
        return {
          ...p,
          category_name: cat?.name || '',
          product_type_name: pt?.name || '',
        };
      });

      if (upper.includes('WHERE P.ID = ?') || upper.includes('WHERE ID = ?')) {
        const id = Number(params[0]);
        return list.filter(p => p.id === id) as any;
      }

      if (upper.includes('LOWER(P.SKU) = LOWER(?)') || upper.includes('LOWER(SKU) = LOWER(?)')) {
        const code = String(params[0]).toLowerCase();
        const numId = params[1] ? Number(params[1]) : Number(code);
        return list.filter(p => p.sku.toLowerCase() === code || p.id === numId) as any;
      }

      return list as any;
    }

    // 4. Sales Orders
    if (upper.includes('FROM SALES_ORDERS')) {
      let list = this.salesOrders.map(o => ({
        ...o,
        seller_name: o.created_by === 1 ? 'Thu ngân' : `Nhân viên #${o.created_by}`,
      }));

      if (upper.includes('WHERE CLIENT_ORDER_ID = ?') || upper.includes('WHERE SO.CLIENT_ORDER_ID = ?')) {
        const cId = String(params[0]);
        list = list.filter(o => o.client_order_id === cId);
      } else if (upper.includes('WHERE SO.ID = ?') || upper.includes('WHERE ID = ?')) {
        const oId = Number(params[0]);
        list = list.filter(o => o.id === oId);
      } else if (upper.includes('CLIENT_ORDER_ID = ? OR SO.ORDER_CODE = ?') || upper.includes('CLIENT_ORDER_ID = ? OR ORDER_CODE = ?')) {
        const val = String(params[0]);
        list = list.filter(o => o.client_order_id === val || o.order_code === val);
      }

      // Check status filter (both literal string and parameterized)
      if (upper.includes("STATUS = 'CANCELLED'") || upper.includes('STATUS = "CANCELLED"')) {
        list = list.filter(o => o.status === 'CANCELLED');
      } else if (upper.includes("STATUS = 'COMPLETED'") || upper.includes('STATUS = "COMPLETED"')) {
        list = list.filter(o => o.status === 'COMPLETED');
      } else if (upper.includes('SO.STATUS = ?') || upper.includes('STATUS = ?')) {
        const st = params.find(p => p === 'COMPLETED' || p === 'CANCELLED');
        if (st) {
          list = list.filter(o => o.status === st);
        }
      }

      // Check user filter (createdBy)
      if (upper.includes('SO.CREATED_BY = ?') || upper.includes('CREATED_BY = ?')) {
        const uid = params.find(p => typeof p === 'number' && p > 0);
        if (uid !== undefined) {
          list = list.filter(o => o.created_by === uid);
        }
      }

      // Check payment method filter
      if (upper.includes('PAYMENT_METHOD') && params.some(p => p === 'CASH' || p === 'BANK_TRANSFER' || p === 'CARD')) {
        const pm = params.find(p => p === 'CASH' || p === 'BANK_TRANSFER' || p === 'CARD');
        if (pm) {
          list = list.filter(o => (o.payment_method || 'CASH') === pm);
        }
      }

      // Check date filters
      if (upper.includes('SALE_DATE >= ?') && startDate) {
        list = list.filter(o => o.sale_date >= startDate);
      }
      if (upper.includes('SALE_DATE <= ?') && endDate) {
        list = list.filter(o => o.sale_date <= endDate);
      }

      // Check search filter
      const searchParam = params.find(p => typeof p === 'string' && p.startsWith('%') && p.endsWith('%'));
      if (searchParam) {
        const q = String(searchParam).replace(/%/g, '').toLowerCase();
        list = list.filter(o => {
          if (o.order_code.toLowerCase().includes(q)) return true;
          if (o.client_order_id?.toLowerCase().includes(q)) return true;
          if (o.note?.toLowerCase().includes(q)) return true;
          const items = this.salesRecords.filter(r => r.order_id === o.id || r.client_order_id === o.client_order_id);
          return items.some(i => i.product_name?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q));
        });
      }

      return list as any;
    }

    // 5. Sales Records (Analytics & Reporting Queries)
    if (upper.includes('FROM SALES_RECORDS')) {
      let list = [...this.salesRecords];

      if (upper.includes('WHERE CLIENT_TRANSACTION_ID = ?')) {
        const txId = String(params[0]);
        return list.filter(s => s.client_transaction_id === txId) as any;
      }

      if (
        upper.includes('WHERE SR.ORDER_ID = ? OR SR.CLIENT_ORDER_ID = ?') ||
        upper.includes('WHERE ORDER_ID = ? OR CLIENT_ORDER_ID = ?') ||
        upper.includes('WHERE SR.CLIENT_ORDER_ID = ? OR SR.ORDER_ID = ?') ||
        upper.includes('WHERE CLIENT_ORDER_ID = ? OR ORDER_ID = ?')
      ) {
        const p0 = params[0];
        const p1 = params[1] || p0;
        return list.filter(s => 
          s.order_id === Number(p0) || s.order_id === Number(p1) ||
          s.client_order_id === String(p0) || s.client_order_id === String(p1)
        ) as any;
      }

      const filteredSales = getFilteredSales();

      // 5.0 Date Orders Drilldown (must be before LEFT JOIN users / staff check)
      if (upper.includes('LEFT JOIN SALES_ORDERS') || upper.includes('CASHIER_NAME') || upper.includes('ITEMS_COUNT')) {
        const targetDate = String(params[0] || startDate || '');
        const targetUserId = params.length > 1 ? Number(params[1]) : (userParam !== undefined ? userParam : undefined);

        const daySales = this.salesRecords.filter(s => {
          if ((s.status || 'COMPLETED') !== 'COMPLETED') return false;
          const d = (s.sale_date || '').slice(0, 10);
          if (targetDate && d !== targetDate) return false;
          if (targetUserId !== undefined && s.created_by !== undefined && s.created_by !== null && s.created_by !== targetUserId) return false;
          return true;
        });

        const orderMap = new Map<string, any>();
        daySales.forEach(s => {
          const orderKey = String(s.order_id || s.client_order_id || s.transaction_code || s.id);
          const order = this.salesOrders.find(o => o.id === s.order_id || o.client_order_id === s.client_order_id);
          const u = this.users.find(usr => usr.id === (s.created_by || order?.created_by || 1));
          const cashierName = u?.full_name || 'Thu ngân';

          if (!orderMap.has(orderKey)) {
            orderMap.set(orderKey, {
              id: order?.id || s.order_id || s.id,
              order_code: order?.order_code || s.transaction_code,
              sale_date: s.sale_date,
              final_amount: order?.final_amount ?? 0,
              total_discount: order?.total_discount ?? 0,
              total_amount: order?.total_amount ?? 0,
              payment_method: order?.payment_method || 'CASH',
              cashier_name: cashierName,
              items_count: 0,
              _revenueSum: 0,
              _discountSum: 0,
              _grossSum: 0,
            });
          }

          const curr = orderMap.get(orderKey)!;
          curr.items_count += 1;
          curr._revenueSum += (s.total_revenue || 0);
          curr._discountSum += (s.discount || 0);
          curr._grossSum += ((s.quantity * s.unit_price_at_sale) || (s.total_revenue + s.discount));

          if (!order) {
            curr.final_amount = curr._revenueSum;
            curr.total_discount = curr._discountSum;
            curr.total_amount = curr._grossSum;
          }
        });

        return Array.from(orderMap.values()).sort((a, b) => Number(b.id) - Number(a.id)) as any;
      }

      // 5a. Hourly performance: strftime('%H', created_at)
      if (upper.includes("STRFTIME('%H'") || upper.includes('HOUR_OF_DAY')) {
        const hourMap = new Map<number, { hour_of_day: number; orders_count: number; net_revenue: number; gross_profit: number; units_sold: number; _orderIds: Set<string> }>();
        filteredSales.forEach(s => {
          const h = parseInt((s.created_at || '').slice(11, 13), 10) || 0;
          const curr = hourMap.get(h) || { hour_of_day: h, orders_count: 0, net_revenue: 0, gross_profit: 0, units_sold: 0, _orderIds: new Set<string>() };
          const orderKey = String(s.client_order_id || s.order_id || s.transaction_code || s.id);
          curr._orderIds.add(orderKey);
          curr.orders_count = curr._orderIds.size;
          curr.net_revenue += s.total_revenue;
          curr.gross_profit += s.profit;
          curr.units_sold += s.quantity;
          hourMap.set(h, curr);
        });
        return Array.from(hourMap.values()).map(h => ({
          hour_of_day: h.hour_of_day,
          orders_count: h.orders_count,
          net_revenue: h.net_revenue,
          gross_profit: h.gross_profit,
          units_sold: h.units_sold,
        })).sort((a, b) => a.hour_of_day - b.hour_of_day) as any;
      }

      // 5b. Weekday performance: strftime('%w', sale_date)
      if (upper.includes("STRFTIME('%W'") || upper.includes('DAY_OF_WEEK')) {
        const dayMap = new Map<number, { day_of_week: number; orders_count: number; net_revenue: number; gross_profit: number; units_sold: number; _orderIds: Set<string> }>();
        filteredSales.forEach(s => {
          const dow = new Date(s.sale_date).getDay();
          const curr = dayMap.get(dow) || { day_of_week: dow, orders_count: 0, net_revenue: 0, gross_profit: 0, units_sold: 0, _orderIds: new Set<string>() };
          const orderKey = String(s.client_order_id || s.order_id || s.transaction_code || s.id);
          curr._orderIds.add(orderKey);
          curr.orders_count = curr._orderIds.size;
          curr.net_revenue += s.total_revenue;
          curr.gross_profit += s.profit;
          curr.units_sold += s.quantity;
          dayMap.set(dow, curr);
        });
        return Array.from(dayMap.values()).map(d => ({
          day_of_week: d.day_of_week,
          orders_count: d.orders_count,
          net_revenue: d.net_revenue,
          gross_profit: d.gross_profit,
          units_sold: d.units_sold,
        })).sort((a, b) => a.day_of_week - b.day_of_week) as any;
      }

      // 5c. Staff performance: LEFT JOIN users u ON u.id = sr.created_by
      if (upper.includes('LEFT JOIN USERS') || upper.includes('ROLE') || upper.includes('STAFF')) {
        const staffMap = new Map<number, { user_id: number; username: string; full_name: string; role: string; orders_count: number; net_revenue: number; gross_profit: number; units_sold: number; _orderIds: Set<string> }>();
        filteredSales.forEach(s => {
          const uid = s.created_by || 1;
          const user = this.users.find(u => u.id === uid) || { id: uid, username: `nhanvien_${uid}`, full_name: `Nhân viên ${uid}`, role: 'STAFF', status: 'ACTIVE' };
          const curr = staffMap.get(uid) || {
            user_id: uid,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            orders_count: 0,
            net_revenue: 0,
            gross_profit: 0,
            units_sold: 0,
            _orderIds: new Set<string>(),
          };
          const orderKey = String(s.client_order_id || s.order_id || s.transaction_code || s.id);
          curr._orderIds.add(orderKey);
          curr.orders_count = curr._orderIds.size;
          curr.net_revenue += s.total_revenue;
          curr.gross_profit += s.profit;
          curr.units_sold += s.quantity;
          staffMap.set(uid, curr);
        });
        return Array.from(staffMap.values()).map(st => ({
          user_id: st.user_id,
          username: st.username,
          full_name: st.full_name,
          role: st.role,
          orders_count: st.orders_count,
          net_revenue: st.net_revenue,
          gross_profit: st.gross_profit,
          units_sold: st.units_sold,
        })).sort((a, b) => b.net_revenue - a.net_revenue) as any;
      }

      // 5d. Discount breakdown: Top Discounted Products
      if (upper.includes('DISCOUNT > 0') && (upper.includes('DISCOUNT_TOTAL') || upper.includes('UNITS_DISCOUNTED'))) {
        const discMap = new Map<number, { product_id: number; name: string; sku: string; discount_total: number; units_discounted: number }>();
        filteredSales.filter(s => s.discount > 0).forEach(s => {
          const prod = this.products.find(p => p.id === s.product_id);
          const curr = discMap.get(s.product_id) || {
            product_id: s.product_id,
            name: s.product_name || prod?.name || '',
            sku: s.sku || prod?.sku || '',
            discount_total: 0,
            units_discounted: 0,
          };
          curr.discount_total += s.discount;
          curr.units_discounted += s.quantity;
          discMap.set(s.product_id, curr);
        });
        return Array.from(discMap.values()).sort((a, b) => b.discount_total - a.discount_total).slice(0, 5) as any;
      }

      // 5e. Timeline & Trend (GROUP BY sale_date or time_key)
      if (upper.includes('GROUP BY SALE_DATE') || upper.includes('GROUP BY TIME_KEY') || upper.includes('STRFTIME')) {
        const dateMap = new Map<string, any>();
        filteredSales.forEach((s) => {
          let key = s.sale_date;
          if (upper.includes('%Y-%M')) {
            key = s.sale_date.slice(0, 7);
          } else if (upper.includes('%Y-W%W')) {
            key = getIsoWeekKey(s.sale_date);
          }
          const curr = dateMap.get(key) || {
            sale_date: s.sale_date,
            time_key: key,
            orders_count: 0,
            order_count: 0,
            transaction_count: 0,
            units_sold: 0,
            sold_quantity: 0,
            total_quantity: 0,
            gross_sales: 0,
            total_discount: 0,
            discount: 0,
            net_revenue: 0,
            total_revenue: 0,
            revenue: 0,
            total_cogs: 0,
            total_cost: 0,
            gross_profit: 0,
            profit: 0,
            _orderIds: new Set<string>(),
          };
          const orderKey = String(s.client_order_id || s.order_id || s.transaction_code || s.id);
          curr._orderIds.add(orderKey);
          curr.orders_count = curr._orderIds.size;
          curr.order_count = curr._orderIds.size;
          curr.transaction_count += 1;
          curr.units_sold += s.quantity;
          curr.sold_quantity += s.quantity;
          curr.total_quantity += s.quantity;
          curr.gross_sales += ((s.quantity * s.unit_price_at_sale) || (s.total_revenue + s.discount));
          curr.total_discount += s.discount;
          curr.discount += s.discount;
          curr.net_revenue += s.total_revenue;
          curr.total_revenue += s.total_revenue;
          curr.revenue += s.total_revenue;
          curr.total_cogs += s.total_cost;
          curr.total_cost += s.total_cost;
          curr.gross_profit += s.profit;
          curr.profit += s.profit;
          dateMap.set(key, curr);
        });

        const rows = Array.from(dateMap.values()).map(r => {
          const { _orderIds, ...rest } = r;
          return rest;
        });

        if (upper.includes('ORDER BY SALE_DATE ASC') || upper.includes('ORDER BY TIME_KEY ASC')) {
          return rows.sort((a, b) => a.time_key.localeCompare(b.time_key)) as any;
        }

        return rows.sort((a, b) => b.time_key.localeCompare(a.time_key)) as any;
      }

      // 5f. Top Selling Products Query
      if (upper.includes('GROUP BY P.ID')) {
        const prodMap = new Map<number, any>();
        filteredSales.forEach((s) => {
          const curr = prodMap.get(s.product_id) || {
            id: s.product_id,
            sku: s.sku,
            name: s.product_name,
            category_name: s.category_name,
            product_type_name: s.product_type_name,
            sold_quantity: 0,
            total_revenue: 0,
            total_profit: 0,
            current_stock: this.products.find(p => p.id === s.product_id)?.current_stock || 0,
          };
          curr.sold_quantity += s.quantity;
          curr.total_revenue += s.total_revenue;
          curr.total_profit += s.profit;
          prodMap.set(s.product_id, curr);
        });

        return Array.from(prodMap.values()).sort((a, b) => b.sold_quantity - a.sold_quantity) as any;
      }

      return filteredSales as any;
    }

    // 6. Stock Movements
    if (upper.includes('FROM STOCK_MOVEMENTS')) {
      let list = [...this.stockMovements];
      if (upper.includes('WHERE CLIENT_MOVEMENT_ID = ?') || upper.includes('WHERE M.CLIENT_MOVEMENT_ID = ?')) {
        const cId = String(params[0]);
        list = list.filter(m => m.client_movement_id === cId);
      } else if (upper.includes('WHERE M.ID = ?') || upper.includes('WHERE ID = ?')) {
        const id = Number(params[0]);
        list = list.filter(m => m.id === id);
      } else if (upper.includes('WHERE M.PRODUCT_ID = ?') || upper.includes('WHERE PRODUCT_ID = ?')) {
        const pid = Number(params[0]);
        list = list.filter(m => m.product_id === pid);
      }
      return list as any;
    }

    // 7. Inventory Lots
    if (upper.includes('FROM INVENTORY_LOTS')) {
      let list = [...this.inventoryLots];
      if (upper.includes('WHERE PRODUCT_ID = ?')) {
        const pid = Number(params[0]);
        list = list.filter(l => l.product_id === pid);
      }
      if (upper.includes('QUANTITY_REMAINING < QUANTITY_RECEIVED')) {
        list = list.filter(l => l.quantity_remaining < l.quantity_received);
      }
      if (upper.includes('ORDER BY PURCHASE_DATE DESC') || upper.includes('ORDER BY ID DESC')) {
        list.sort((a, b) => b.id - a.id);
      }
      return list as any;
    }

    // 8. Cost Price History
    if (upper.includes('FROM COST_PRICE_HISTORY')) {
      let list = [...this.costPriceHistory];
      if (upper.includes('WHERE PRODUCT_ID = ?')) {
        const pid = Number(params[0]);
        list = list.filter(c => c.product_id === pid);
      }
      return list as any;
    }

    // 9. Price History
    if (upper.includes('FROM PRICE_HISTORY')) {
      let list = [...this.priceHistory];
      if (upper.includes('WHERE PRODUCT_ID = ?')) {
        const pid = Number(params[0]);
        list = list.filter(p => p.product_id === pid);
      }
      return list as any;
    }

    // 10. Imports
    if (upper.includes('FROM IMPORTS')) {
      let list = [...this.imports];
      if (upper.includes('WHERE CLIENT_IMPORT_ID = ?') || upper.includes('WHERE I.CLIENT_IMPORT_ID = ?')) {
        const cId = String(params[0]);
        list = list.filter(i => i.client_import_id === cId);
      } else if (upper.includes('WHERE I.ID = ?') || upper.includes('WHERE ID = ?')) {
        const id = Number(params[0]);
        list = list.filter(i => i.id === id);
      }
      if (upper.includes('COALESCE(I.STATUS,') || upper.includes('STATUS = ?')) {
        const statusVal = String(params[0]);
        if (statusVal && statusVal !== 'ALL') {
          list = list.filter(i => (i.status || 'COMPLETED') === statusVal);
        }
      }
      return list as any;
    }

    // 10b. Import Items
    if (upper.includes('FROM IMPORT_ITEMS')) {
      let list = this.importItems.map(it => {
        const prod = this.products.find(p => p.id === it.product_id);
        return {
          ...it,
          product_name: prod?.name || it.product_name,
          sku: prod?.sku || it.sku,
          current_stock: prod?.current_stock || 0,
        };
      });
      if (upper.includes('WHERE IT.IMPORT_ID = ?') || upper.includes('WHERE IMPORT_ID = ?')) {
        const impId = Number(params[0]);
        list = list.filter(it => it.import_id === impId);
      }
      return list as any;
    }

    // 11. Conflict Records
    if (upper.includes('FROM CONFLICT_RECORDS')) {
      return this.conflicts as any;
    }

    // 12. Sync Queue
    if (upper.includes('FROM SYNC_QUEUE')) {
      return this.syncQueue as any;
    }

    return [] as any;
  }

  async getFirstAsync<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const cleanSql = sql.trim();
    const upper = cleanSql.toUpperCase();

    // Helper: Extract date range from params
    const dateParams = params.filter(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p));
    const startDate = dateParams.length >= 1 ? String(dateParams[0]) : undefined;
    const endDate = dateParams.length >= 2 ? String(dateParams[1]) : (dateParams.length === 1 ? String(dateParams[0]) : undefined);

    let userParam: number | undefined;
    if (upper.includes('CREATED_BY = ?') || upper.includes('SR.CREATED_BY = ?')) {
      const uCandidate = params.find(p => typeof p === 'number' || (typeof p === 'string' && /^\d+$/.test(p) && !dateParams.includes(p)));
      if (uCandidate !== undefined) {
        userParam = Number(uCandidate);
      }
    }

    const getFilteredSales = () => {
      return this.salesRecords.filter(s => {
        if ((s.status || 'COMPLETED') !== 'COMPLETED') return false;
        const d = (s.sale_date || '').slice(0, 10);
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        if (userParam !== undefined && s.created_by !== undefined && s.created_by !== null && s.created_by !== userParam) {
          return false;
        }
        return true;
      });
    };

    // 0. Pending sold query for product stock validation
    if (upper.includes('PENDING_SOLD') || (upper.includes('FROM SALES_RECORDS') && upper.includes('SYNC_STATUS = \'PENDING\''))) {
      const pid = Number(params[0]);
      const pendingSum = this.salesRecords
        .filter(s => (!pid || s.product_id === pid) && s.status === 'COMPLETED' && s.sync_status === 'PENDING')
        .reduce((sum, s) => sum + (s.quantity || 0), 0);
      return { pending_sold: pendingSum } as any;
    }

    // 0b. Total sold query for product lot drilldown (getProductLotDrilldown)
    if (upper.includes('FROM SALES_RECORDS') && upper.includes('TOTAL_SOLD')) {
      const pid = Number(params[0]);
      const totalSold = this.salesRecords
        .filter(s => s.product_id === pid && (s.status || 'COMPLETED') === 'COMPLETED')
        .reduce((sum, s) => sum + (s.quantity || 0), 0);
      return { total_sold: totalSold } as any;
    }

    // 1. Comprehensive Sales Records Aggregation (Overview, Dashboard, Discounts, Orders Count)
    if (upper.includes('FROM SALES_RECORDS') && (upper.includes('SUM(') || upper.includes('COUNT(') || upper.includes('ORDERS_COUNT') || upper.includes('DISCOUNTED_ORDERS'))) {
      let matchingSales = getFilteredSales();
      if (upper.includes('PRODUCT_ID = ?') && params.length > 0) {
        const pid = Number(params.find(p => typeof p === 'number' || (typeof p === 'string' && /^\d+$/.test(p) && !dateParams.includes(p))));
        if (!isNaN(pid) && pid > 0) {
          matchingSales = matchingSales.filter(s => s.product_id === pid);
        }
      }

      const grossSales = matchingSales.reduce((sum, s) => sum + ((s.quantity * s.unit_price_at_sale) || (s.total_revenue + s.discount)), 0);
      const totalDiscount = matchingSales.reduce((sum, s) => sum + (s.discount || 0), 0);
      const netRevenue = matchingSales.reduce((sum, s) => sum + (s.total_revenue || 0), 0);
      const totalCost = matchingSales.reduce((sum, s) => sum + (s.total_cost || 0), 0);
      const totalProfit = matchingSales.reduce((sum, s) => sum + (s.profit || 0), 0);
      const unitsSold = matchingSales.reduce((sum, s) => sum + (s.quantity || 0), 0);
      const uniqueOrders = new Set(matchingSales.map(s => s.client_order_id || s.transaction_code || s.order_id || s.id));
      const discOrders = new Set(matchingSales.filter(s => s.discount > 0).map(s => s.client_order_id || s.transaction_code || s.order_id || s.id));
      const ordersCount = uniqueOrders.size;

      return {
        gross_sales: grossSales,
        total_discount: totalDiscount,
        discount: totalDiscount,
        net_revenue: netRevenue,
        total_revenue: netRevenue,
        revenue: netRevenue,
        total_cogs: totalCost,
        total_cost: totalCost,
        cogs: totalCost,
        period_cogs: totalCost,
        gross_profit: totalProfit,
        total_profit: totalProfit,
        profit: totalProfit,
        units_sold: unitsSold,
        sold_quantity: unitsSold,
        orders_count: ordersCount,
        order_count: ordersCount,
        total_orders: ordersCount,
        sales_count: ordersCount,
        transaction_count: matchingSales.length,
        discounted_orders: discOrders.size,
        total_sold: unitsSold,
      } as any;
    }

    // 2. Stock summary query
    if (upper.includes('FROM PRODUCTS') && upper.includes('SUM(CURRENT_STOCK)')) {
      const totalStock = this.products.reduce((s, it) => s + (it.current_stock || 0), 0);
      const lowStock = this.products.filter(p => p.current_stock <= p.min_stock_alert).length;
      const totalVal = this.products.reduce((s, it) => s + (it.current_stock * it.current_cost_price), 0);

      return {
        total_products: this.products.length,
        total_stock: totalStock,
        low_stock_count: lowStock,
        total_valuation: totalVal,
      } as any;
    }

    // 3. Lot valuation query or summary query
    if (upper.includes('FROM INVENTORY_LOTS') && upper.includes('SUM(')) {
      if (upper.includes('TOTAL_REM') || upper.includes('TOTAL_VAL')) {
        const pid = params.find(p => typeof p === 'number');
        const lots = this.inventoryLots.filter(l => (!pid || l.product_id === pid) && l.quantity_remaining > 0);
        const totalRem = lots.reduce((sum, l) => sum + (l.quantity_remaining || 0), 0);
        const totalVal = lots.reduce((sum, l) => sum + ((l.quantity_remaining || 0) * (l.unit_cost || 0)), 0);
        return { total_rem: totalRem, total_val: totalVal } as any;
      }
      const val = this.inventoryLots.reduce((s, it) => s + (it.quantity_remaining * it.unit_cost), 0);
      return { lot_valuation: val } as any;
    }

    // 4. Imports count query
    if (upper.includes('FROM IMPORTS') && upper.includes('COUNT(')) {
      let matching = this.imports;
      if (params && params.length >= 2 && typeof params[0] === 'string' && typeof params[1] === 'string') {
        const [startDate, endDate] = params;
        matching = matching.filter(i => {
          const d = i.import_date || (i.created_at ? i.created_at.slice(0, 10) : '');
          return (!startDate || d >= startDate) && (!endDate || d <= endDate);
        });
      }
      return { count: matching.length } as any;
    }

    // 5. Stock adjustments count and total quantity query
    if (upper.includes('FROM STOCK_MOVEMENTS') && (upper.includes('COUNT(') || upper.includes('TOTAL_QUANTITY') || upper.includes('SUM('))) {
      const isAdjustment = (m: StockMovementRow) => {
        const t = (m.movement_type || '').toUpperCase();
        const r = (m.reference_type || '').toLowerCase();
        return r === 'stock_adjustments' || (!['PURCHASE', 'SALE'].includes(t) && t.length > 0);
      };

      let matching = this.stockMovements.filter(isAdjustment);
      if (params && params.length >= 2 && typeof params[0] === 'string' && typeof params[1] === 'string') {
        const startDate = String(params[0]);
        const endDate = String(params[1]);
        matching = matching.filter(m => {
          const d = m.movement_date || (m.created_at ? m.created_at.slice(0, 10) : '');
          return (!startDate || d >= startDate) && (!endDate || d <= endDate);
        });
      }

      const count = matching.length;
      const total_quantity = matching.reduce((sum, m) => sum + Math.abs(Number(m.quantity_change) || 0), 0);
      return { count, total_quantity } as any;
    }

    const rows = await this.getAllAsync<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async withTransactionAsync<T>(action: (tx: ITransactionClient) => Promise<T>): Promise<T> {
    const client: ITransactionClient = {
      execAsync: (sql) => this.execAsync(sql),
      runAsync: (sql, params) => this.runAsync(sql, params),
      getAllAsync: (sql, params) => this.getAllAsync(sql, params),
      getFirstAsync: (sql, params) => this.getFirstAsync(sql, params),
    };
    return await action(client);
  }
}

export const webDemoSqliteDriver = new WebDemoSqliteDriver();
export default webDemoSqliteDriver;
