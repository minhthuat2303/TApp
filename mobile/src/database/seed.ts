import { DatabaseService } from './DatabaseService';
import logger from '../utils/logger';

export async function seedLocalData(dbService: DatabaseService): Promise<void> {
  logger.info('DatabaseSeed', 'Cleaning up legacy mock data to ensure Supabase purity...');

  try {
    const mockSkus = [
      'GB-CAPY-01', 'GB-CAPY-02', 'GB-TEDDY-01', 'GB-TEDDY-02',
      'LG-CITY-01', 'LG-ROBOT-01', 'RC-CAR-01', 'RC-DRONE-01',
      'GD-BIEUDIEN-01', 'VD-SCOOTER-01'
    ];

    await dbService.withTransaction(async (tx) => {
      // Clean up mock products
      for (const sku of mockSkus) {
        await tx.runAsync('DELETE FROM products WHERE sku = ?', [sku]);
      }

      // Clean up mock product types
      await tx.runAsync(`
        DELETE FROM product_types 
        WHERE code IN ('CAPYBARA', 'TEDDY', 'LEGO_CITY', 'LEGO_ROBOT', 'RC_CAR', 'DRONE_MINI', 'BIEU_DIEN', 'SCOOTER')
      `);

      // Clean up mock categories
      await tx.runAsync(`
        DELETE FROM categories 
        WHERE code IN ('GAU_BONG', 'LEGO', 'DIEU_KHIEN', 'GIAO_DUC', 'VAN_DONG')
      `);

      // Ensure minimal user cache for offline support
      await tx.runAsync(`
        INSERT OR IGNORE INTO users (id, username, full_name, role, status)
        VALUES 
          (1, 'admin', 'Quản Trị Viên (Admin)', 'ADMIN', 'ACTIVE'),
          (2, 'staff', 'Nhân Viên Bán Hàng', 'STAFF', 'ACTIVE')
      `);
    });

    logger.info('DatabaseSeed', 'Local database sanitized. Ready for Supabase streaming.');
  } catch (err) {
    logger.warn('DatabaseSeed', 'Sanitization finished or skipped', err);
  }
}

export default seedLocalData;
