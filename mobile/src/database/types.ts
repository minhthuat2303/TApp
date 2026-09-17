// T_SHOP Mobile - Database Types & Driver Interfaces

export interface QueryResult {
  changes: number;
  lastInsertRowId: number;
}

export interface ITransactionClient {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<QueryResult>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface IDatabaseDriver extends ITransactionClient {
  openAsync(dbName: string): Promise<void>;
  closeAsync(): Promise<void>;
  isOpen(): boolean;
  withTransactionAsync<T>(action: (tx: ITransactionClient) => Promise<T>): Promise<T>;
}

export interface Migration {
  version: number;
  name: string;
  up: (db: ITransactionClient) => Promise<void>;
  down?: (db: ITransactionClient) => Promise<void>;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}

export interface SyncQueueRecord {
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

export interface StockStatus {
  productId: number;
  serverStock: number;
  pendingDelta: number;
  effectiveStock: number;
}

export interface SalesOrder {
  id: number;
  client_order_id: string;
  order_code: string;
  sale_date: string;
  total_amount: number;
  total_discount: number;
  final_amount: number;
  total_items: number;
  status: 'COMPLETED' | 'CANCELLED';
  sync_status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  payment_method?: string | null;
  cash_received?: number | null;
  cash_change?: number | null;
  note: string | null;
  created_by: number | null;
  created_at: string;
  synced_at: string | null;
}

export interface ImportRecord {
  id: number;
  client_import_id: string;
  server_id: number | null;
  import_code: string;
  supplier_id: number | null;
  supplier_name?: string;
  import_date: string;
  expected_date?: string | null;
  total_amount: number;
  note: string | null;
  status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  sync_status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  created_by: number | null;
  created_at: string;
  synced_at: string | null;
}

export interface ImportItem {
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

export interface ConflictRecord {
  id: number;
  conflict_id: string;
  client_transaction_id: string;
  entity_type: string;
  entity_id: string;
  local_data: string;
  server_data: string;
  reason: string;
  status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'IGNORED';
  conflict_type: string;
  operation: string;
  device_id: string | null;
  user_id: number | null;
  resolution: string | null;
  resolved_by: number | null;
  detected_at: string;
  resolved_at: string | null;
}

export interface StockDriftRecord {
  id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  expected_stock: number;
  actual_stock: number;
  drift_quantity: number;
  detected_at: string;
  source: string;
  status: 'DETECTED' | 'RECONCILED' | 'IGNORED';
  notes: string | null;
}

export interface SyncSession {
  id: number;
  session_id: string;
  started_at: string;
  completed_at: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  push_count: number;
  pull_count: number;
  success_count: number;
  failed_count: number;
  conflict_count: number;
  error: string | null;
}

