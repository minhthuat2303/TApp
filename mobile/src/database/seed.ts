import { DatabaseService } from './DatabaseService';
import logger from '../utils/logger';

export async function seedLocalData(dbService: DatabaseService): Promise<void> {
  logger.info('DatabaseSeed', 'Checking if local database requires development seed...');

  const categoryCount = await dbService.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM categories'
  );

  if (categoryCount && categoryCount.count > 0) {
    logger.info('DatabaseSeed', `Database already has ${categoryCount.count} categories, skipping seed.`);
    return;
  }

  logger.info('DatabaseSeed', 'Seeding initial development toy catalog...');

  await dbService.withTransaction(async (tx) => {
    // 1. Users / Staff Profile Cache
    await tx.runAsync(`
      INSERT OR IGNORE INTO users (id, username, full_name, role, status)
      VALUES 
        (1, 'admin', 'Quản Trị Viên (Admin)', 'ADMIN', 'ACTIVE'),
        (2, 'staff', 'Nhân Viên Bán Hàng', 'STAFF', 'ACTIVE')
    `);

    // 2. Categories
    await tx.runAsync(`
      INSERT OR IGNORE INTO categories (id, code, name, description, status)
      VALUES 
        (1, 'GAU_BONG', 'Gấu bông & Thú nhồi bông', 'Các loại gấu bông cao cấp, an toàn cho bé', 'ACTIVE'),
        (2, 'LEGO', 'Đồ chơi xếp hình & Lắp ráp', 'Bộ xếp hình phát triển trí tuệ logic', 'ACTIVE'),
        (3, 'DIEU_KHIEN', 'Đồ chơi điều khiển từ xa', 'Xe, máy bay, cano điều khiển', 'ACTIVE'),
        (4, 'GIAO_DUC', 'Đồ chơi giáo dục & Hướng nghiệp', 'Bảng chữ cái, đồ chơi nhà bếp, bác sĩ', 'ACTIVE'),
        (5, 'VAN_DONG', 'Đồ chơi vận động ngoài trời', 'Xe chòi chân, xe trượt scooter, bóng đá', 'ACTIVE')
    `);

    // 3. Product Types
    await tx.runAsync(`
      INSERT OR IGNORE INTO product_types (id, category_id, code, name, description, status)
      VALUES 
        (1, 1, 'CAPYBARA', 'Gấu bông Capybara', 'Thú nhồi bông Capybara hot trend', 'ACTIVE'),
        (2, 1, 'TEDDY', 'Gấu Teddy truyền thống', 'Gấu Teddy lông xù nhiều kích cỡ', 'ACTIVE'),
        (3, 2, 'LEGO_CITY', 'Lắp ráp mô hình Thành phố', 'Mô hình cứu hỏa, cảnh sát, cứu thương', 'ACTIVE'),
        (4, 2, 'LEGO_ROBOT', 'Lắp ráp Robot & Xe chiến đấu', 'Robot biến hình thông minh', 'ACTIVE'),
        (5, 3, 'RC_CAR', 'Xe đua điều khiển', 'Xe địa hình tốc độ cao', 'ACTIVE'),
        (6, 3, 'DRONE_MINI', 'Flycam / Drone mini', 'Máy bay điều khiển 4 cánh an toàn trong nhà', 'ACTIVE'),
        (7, 4, 'BIEU_DIEN', 'Bộ đồ chơi Bác sĩ / Kỹ sư', 'Dụng cụ nhập vai trẻ em', 'ACTIVE'),
        (8, 5, 'SCOOTER', 'Xe trượt Scooter gập gọn', 'Scooter 3 bánh có đèn LED phát sáng', 'ACTIVE')
    `);

    // 4. Products
    await tx.runAsync(`
      INSERT OR IGNORE INTO products (
        id, sku, name, category_id, product_type_id, 
        current_cost_price, current_selling_price, current_stock, min_stock_alert, status
      ) VALUES 
        (1, 'GB-CAPY-01', 'Gấu Bông Capybara Rút Mũi 35cm', 1, 1, 85000, 150000, 45, 10, 'ACTIVE'),
        (2, 'GB-CAPY-02', 'Gấu Bông Capybara Đeo Balo Rùa 45cm', 1, 1, 110000, 195000, 30, 8, 'ACTIVE'),
        (3, 'GB-TEDDY-01', 'Gấu Teddy Nơ Ôm Trái Tim 50cm', 1, 2, 130000, 230000, 25, 5, 'ACTIVE'),
        (4, 'LG-CITY-01', 'Bộ Xếp Hình Trạm Cứu Hỏa Đô Thị (520 chi tiết)', 2, 3, 210000, 360000, 20, 5, 'ACTIVE'),
        (5, 'LG-ROBOT-01', 'Robot Chiến Binh Biến Hình Transformers', 2, 4, 180000, 310000, 15, 5, 'ACTIVE'),
        (6, 'RC-CAR-01', 'Xe Đua Địa Hình Leo Núi 4WD Tỉ Lệ 1:16', 3, 5, 250000, 420000, 18, 5, 'ACTIVE'),
        (7, 'RC-DRONE-01', 'Máy Bay 4 Cánh Cảm Ứng Độ Cao Mini Drone', 3, 6, 190000, 320000, 12, 5, 'ACTIVE'),
        (8, 'GD-MED-01', 'Bộ Vali Bác Sĩ Nha Khoa Khám Răng (24 món)', 4, 7, 95000, 175000, 35, 10, 'ACTIVE'),
        (9, 'VD-SCOOT-01', 'Xe Trượt Scooter Bánh Phát Sáng Điều Chỉnh Độ Cao', 5, 8, 220000, 380000, 14, 5, 'ACTIVE'),
        (10, 'VD-BONG-01', 'Quả Bóng Đá Da Pu Size 4 Cho Trẻ Em', 5, 8, 75000, 135000, 50, 15, 'ACTIVE')
    `);

    // 5. Suppliers
    await tx.runAsync(`
      INSERT OR IGNORE INTO suppliers (id, code, name, phone, address, status)
      VALUES 
        (1, 'NCC-HN', 'Công ty Phân Phối Đồ Chơi Hà Nội Toy', '0901234567', 'Hoàng Mai, Hà Nội', 'ACTIVE'),
        (2, 'NCC-HCM', 'Xưởng Sản Xuất Thú Nhồi Bông Sài Gòn', '0987654321', 'Tân Bình, TP.HCM', 'ACTIVE')
    `);

    // 6. Inventory Lots for FIFO tracking
    await tx.runAsync(`
      INSERT OR IGNORE INTO inventory_lots (
        id, lot_code, product_id, purchase_date, 
        quantity_received, quantity_remaining, unit_cost, supplier_id, note
      ) VALUES 
        (1, 'LOT-2026-001', 1, '2026-08-01', 50, 45, 85000, 2, 'Lô nhập Capybara đợt 1'),
        (2, 'LOT-2026-002', 2, '2026-08-05', 30, 30, 110000, 2, 'Lô Capybara balo rùa'),
        (3, 'LOT-2026-003', 4, '2026-08-10', 20, 20, 210000, 1, 'Lô Lego cứu hỏa chính hãng')
    `);

    // 7. Initial sync metadata
    await tx.runAsync(`
      INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
      VALUES 
        ('device_registered', 'true', datetime('now')),
        ('last_synced_at', datetime('now'), datetime('now')),
        ('client_version', '1.0.0', datetime('now'))
    `);
  });

  logger.info('DatabaseSeed', 'Local database seed completed successfully!');
}

export default seedLocalData;
