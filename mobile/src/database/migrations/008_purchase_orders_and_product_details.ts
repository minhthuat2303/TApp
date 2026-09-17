import { Migration, ITransactionClient } from '../types';

export const migration008: Migration = {
  version: 8,
  name: '008_purchase_orders_and_product_details',
  up: async (db: ITransactionClient): Promise<void> => {
    // Add purchase order workflow and product description columns safely
    try {
      await db.execAsync(`
        ALTER TABLE imports ADD COLUMN status TEXT DEFAULT 'COMPLETED';
      `);
    } catch {
      // Column may already exist
    }

    try {
      await db.execAsync(`
        ALTER TABLE imports ADD COLUMN expected_date TEXT;
      `);
    } catch {
      // Column may already exist
    }

    try {
      await db.execAsync(`
        ALTER TABLE products ADD COLUMN description TEXT;
      `);
    } catch {
      // Column may already exist
    }

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);
    `);
  },
  down: async (_db: ITransactionClient): Promise<void> => {
    // Non-destructive rollback
  },
};

export default migration008;
