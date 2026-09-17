// T_SHOP Mobile Domain Types - Strictly aligned with T_SHOP Backend Data Model

export type UserRole = 'ADMIN' | 'STAFF';
export type UserStatus = 'ACTIVE' | 'INACTIVE';
export type ProductStatus = 'ACTIVE' | 'INACTIVE';
export type SaleStatus = 'COMPLETED' | 'CANCELLED';
export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

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
}

export interface Category {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  product_count?: number;
  type_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProductType {
  id: number;
  category_id: number;
  category_name?: string;
  code: string;
  name: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  product_count?: number;
  created_at?: string;
  updated_at?: string;
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
  barcode?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PriceHistory {
  id: number;
  product_id: number;
  price: number;
  effective_from: string; // YYYY-MM-DD
  note?: string | null;
  created_by?: number | null;
  created_at?: string;
}

export interface SalesRecord {
  id: number;
  client_transaction_id?: string;
  server_id?: number | null;
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
  status: SaleStatus;
  sync_status?: SyncStatus;
  order_id?: number | null;
  client_order_id?: string | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  note?: string | null;
  created_by?: number | null;
  seller_name?: string;
  created_at: string;
  synced_at?: string | null;
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
  reference_type?: string | null;
  reference_id?: number | null;
  note?: string | null;
  created_by?: number | null;
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
  supplier_id?: number | null;
  supplier_name?: string;
  note?: string | null;
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
