// TypeScript definitions for T_SHOP

export type UserRole = 'ADMIN' | 'STAFF';
export type UserStatus = 'ACTIVE' | 'INACTIVE';
export type ProductStatus = 'ACTIVE' | 'INACTIVE';

export type MovementType = 
  | 'SALE' 
  | 'PURCHASE' 
  | 'DAMAGE' 
  | 'LOSS' 
  | 'GIFT' 
  | 'RETURN' 
  | 'ADJUSTMENT';

export interface User {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface UserSession {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  session_id?: string;
  device_id?: string;
}

export interface Device {
  device_id: string;
  user_id: number | null;
  device_name: string | null;
  platform: 'android' | 'ios' | 'web';
  app_version: string | null;
  status: 'ACTIVE' | 'REVOKED';
  created_at: string;
  last_seen_at: string;
}

export interface UserSessionRecord {
  session_id: string;
  user_id: number;
  device_id: string;
  refresh_token_hash: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
  last_refreshed_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface Category {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  product_count?: number;
  type_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ProductType {
  id: number;
  category_id: number;
  category_name?: string;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  product_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  category_name?: string;
  product_type_id: number;
  product_type_name?: string;
  current_cost_price: number;
  current_selling_price: number;
  current_stock: number;
  min_stock_alert: number;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export interface PriceHistory {
  id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  price: number;
  effective_from: string; // YYYY-MM-DD
  note: string | null;
  created_by: number | null;
  creator_name?: string;
  created_at: string;
}

export interface CostPriceHistory {
  id: number;
  product_id: number;
  cost_price: number;
  effective_from: string; // YYYY-MM-DD
  note: string | null;
  created_by: number | null;
  created_at: string;
}

export interface SalesRecord {
  id: number;
  transaction_code: string;
  product_id: number;
  product_name?: string;
  sku?: string;
  category_name?: string;
  product_type_name?: string;
  sale_date: string; // YYYY-MM-DD
  quantity: number;
  unit_price_at_sale: number;
  cost_price_at_sale: number;
  discount: number;
  total_revenue: number;
  total_cost: number;
  profit: number;
  status: 'COMPLETED' | 'CANCELLED';
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  canceller_name?: string;
  note: string | null;
  created_by: number | null;
  seller_name?: string;
  created_at: string;
}

export interface StockMovement {
  id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  movement_type: MovementType;
  quantity_change: number;
  balance_after: number;
  movement_date: string; // YYYY-MM-DD
  reference_type: string | null;
  reference_id: number | null;
  note: string | null;
  created_by: number | null;
  creator_name?: string;
  created_at: string;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
}

export interface ImportOrder {
  id: number;
  import_code: string;
  supplier_id: number | null;
  supplier_name?: string;
  import_date: string;
  total_amount: number;
  note: string | null;
  created_by: number | null;
  creator_name?: string;
  created_at: string;
  items?: ImportOrderItem[];
}

export interface ImportOrderItem {
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

export interface InventoryLot {
  id: number;
  lot_code: string;
  product_id: number;
  product_name?: string;
  sku?: string;
  purchase_date: string; // YYYY-MM-DD
  quantity_received: number;
  quantity_remaining: number;
  unit_cost: number;
  supplier_id: number | null;
  supplier_name?: string;
  import_id: number | null;
  note: string | null;
  created_by: number | null;
  creator_name?: string;
  created_at: string;
}

export interface SaleCostAllocation {
  id: number;
  sale_id: number;
  inventory_lot_id: number;
  lot_code?: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  entity_name: string;
  entity_id: string | null;
  old_value_json: string | null;
  new_value_json: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface DashboardSummary {
  revenue: number;
  salesCount: number;
  soldQuantity: number;
  currentTotalStock: number;
  stockValuation: number;
  profit: number;
  periodLabel: string;
}

export interface MasterTableRow {
  product_id: number;
  sku: string;
  product_name: string;
  category_name: string;
  product_type_name: string;
  total_available: number; // Tồn đầu + Nhập trong kỳ
  total_imported: number;  // SL nhập trong kỳ
  total_sold: number;      // SL bán trong kỳ
  current_stock: number;   // SL tồn hiện tại
  cost_price: number;      // Giá vốn hiện hành
  selling_price: number;   // Giá bán hiện hành
  stock_value: number;     // Giá trị tồn = current_stock * cost_price
  revenue: number;         // Doanh thu trong kỳ (theo snapshot giá lúc bán)
  profit: number;          // Lợi nhuận trong kỳ
  status: ProductStatus;
}
