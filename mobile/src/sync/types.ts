export type SyncStatus = 'SYNCED' | 'SYNCING' | 'PENDING' | 'FAILED' | 'CONFLICT' | 'OFFLINE';

export interface SyncOptions {
  manual?: boolean;
  forcePull?: boolean;
}

export interface PushMutationItem {
  client_mutation_id: string;
  entity_type: string;
  entity_id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: any;
  payload_version: number;
  created_at: string;
}

export type ConflictType =
  | 'DUPLICATE'
  | 'VALIDATION_CONFLICT'
  | 'BUSINESS_CONFLICT'
  | 'INVENTORY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'MASTER_DATA_CONFLICT'
  | 'AUTHORIZATION_CONFLICT'
  | 'UNKNOWN_CONFLICT';

export type ConflictStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'IGNORED';

export type ConflictResolutionAction = 'CANCEL_LOCAL' | 'RESTOCK_AND_RETRY' | 'DISMISS';

export interface PushMutationResult {
  client_mutation_id: string;
  status: 'SYNCED' | 'ALREADY_PROCESSED' | 'CONFLICT' | 'FAILED';
  conflict_type?: ConflictType;
  server_transaction_id?: number | null;
  server_timestamp?: string;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface PushSyncResponse {
  results: PushMutationResult[];
  processed_count: number;
}

export interface PullSyncData {
  categories: any[];
  product_types: any[];
  products: any[];
  price_history: any[];
  inventory_lots: any[];
  next_cursor: string;
  has_more: boolean;
  server_timestamp: string;
}

export interface SyncSessionReport {
  sessionId: string;
  startedAt: string;
  completedAt: string;
  status: 'COMPLETED' | 'FAILED';
  pushCount: number;
  pullCount: number;
  successCount: number;
  failedCount: number;
  conflictCount: number;
  error?: string | null;
}

export type SyncStateListener = (status: SyncStatus, stats: { pendingCount: number; conflictCount: number }) => void;
