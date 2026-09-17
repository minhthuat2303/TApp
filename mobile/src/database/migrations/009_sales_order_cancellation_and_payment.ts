import { Migration, ITransactionClient } from '../types';

export const migration009: Migration = {
  version: 9,
  name: '009_sales_order_cancellation_and_payment',
  up: async (db: ITransactionClient): Promise<void> => {
    // Add cancellation and payment metadata to sales_orders
    const columnsToAdd = [
      'ALTER TABLE sales_orders ADD COLUMN cancel_reason TEXT;',
      'ALTER TABLE sales_orders ADD COLUMN cancelled_at TEXT;',
      'ALTER TABLE sales_orders ADD COLUMN cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;',
      'ALTER TABLE sales_orders ADD COLUMN payment_method TEXT DEFAULT "CASH";',
      'ALTER TABLE sales_orders ADD COLUMN cash_received REAL;',
      'ALTER TABLE sales_orders ADD COLUMN cash_change REAL;',
    ];

    for (const sql of columnsToAdd) {
      try {
        await db.execAsync(sql);
      } catch {
        // Column may already exist in backward-safe migration
      }
    }

    try {
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_sales_orders_payment ON sales_orders(payment_method);');
    } catch {}
  },
  down: async (): Promise<void> => {
    // Backward-compatible no-op
  },
};
