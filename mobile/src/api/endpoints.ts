export const Endpoints = {
  // Authentication
  AUTH_LOGIN: '/api/auth/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_ME: '/api/auth/me',

  // Master Data
  CATEGORIES: '/api/categories',
  PRODUCT_TYPES: '/api/product-types',
  PRODUCTS: '/api/products',
  PRODUCT_DETAIL: (id: number | string) => `/api/products/${id}`,
  PRODUCT_LOTS: (id: number | string) => `/api/products/${id}/lots`,
  PRODUCT_PRICE_HISTORY: (id: number | string) => `/api/products/${id}/price-history`,

  // Sales
  SALES: '/api/sales',
  SALES_RESOLVE_PRICE: '/api/sales/resolve-price',
  SALES_CANCEL: (id: number | string) => `/api/sales/${id}/cancel`,

  // Inventory
  INVENTORY: '/api/inventory',
  INVENTORY_RECEIPTS: '/api/inventory/receipts',
  INVENTORY_ADJUSTMENTS: '/api/inventory/adjustments',
  INVENTORY_LOTS: '/api/inventory/lots',
  INVENTORY_MOVEMENTS: '/api/inventory/movements',

  // Dashboard & Reports
  DASHBOARD_SUMMARY: '/api/dashboard/summary',
  DASHBOARD_AGGREGATE: '/api/dashboard/aggregate-table',
  REPORTS_SALES_BY_DATE: '/api/reports/sales-by-date',
  REPORTS_TOP_SELLING: '/api/reports/top-selling',

  // Sync Endpoints (To be implemented in Phase 05)
  SYNC_PULL: '/api/sync/pull',
  SYNC_PUSH: '/api/sync/push',
  SYNC_HEALTH: '/api/sync/health',
} as const;

export default Endpoints;
