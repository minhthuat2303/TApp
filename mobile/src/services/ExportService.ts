// T_SHOP Mobile - Data Export & Backup Utility Service
// Supports exporting Products, Categories, Stock Cards / Movements, and Sales History to standard UTF-8 CSV
// and generates immutable local database backup snapshots.

import { Share, Platform } from 'react-native';
import databaseService, { DatabaseService } from '../database/DatabaseService';
import logger from '../utils/logger';

export class ExportService {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  // Helper: Escape CSV fields containing commas, quotes, or newlines
  private escapeCsvField(val: any): string {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // 1. Xuất danh sách sản phẩm (Products List) to CSV
  async exportProductsCsv(): Promise<string> {
    const products = await this.db.query<any>(`
      SELECT 
        p.id, p.sku, p.name, c.name as category, pt.name as product_type,
        p.current_cost_price, p.current_selling_price, p.current_stock, p.min_stock_alert, p.status,
        p.created_at, p.updated_at
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_types pt ON p.product_type_id = pt.id
      ORDER BY p.id ASC
    `);

    const headers = [
      'Mã ID',
      'Mã SKU',
      'Tên sản phẩm',
      'Danh mục',
      'Loại sản phẩm',
      'Giá vốn hiện tại (VND)',
      'Giá bán hiện tại (VND)',
      'Tồn kho khả dụng',
      'Mức cảnh báo tồn',
      'Trạng thái kinh doanh',
      'Ngày tạo',
      'Cập nhật cuối',
    ];

    const rows = products.map((p) => [
      this.escapeCsvField(p.id),
      this.escapeCsvField(p.sku),
      this.escapeCsvField(p.name),
      this.escapeCsvField(p.category || 'Chưa phân loại'),
      this.escapeCsvField(p.product_type || 'Tiêu chuẩn'),
      this.escapeCsvField(p.current_cost_price || 0),
      this.escapeCsvField(p.current_selling_price || 0),
      this.escapeCsvField(p.current_stock || 0),
      this.escapeCsvField(p.min_stock_alert || 5),
      this.escapeCsvField(p.status === 'ACTIVE' ? 'Đang bán' : 'Ngừng bán'),
      this.escapeCsvField(p.created_at || ''),
      this.escapeCsvField(p.updated_at || ''),
    ]);

    // UTF-8 BOM prefix (\uFEFF) ensures Excel and mobile viewers render Vietnamese accents correctly
    return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // 2. Xuất danh mục sản phẩm (Categories List) to CSV
  async exportCategoriesCsv(): Promise<string> {
    const categories = await this.db.query<any>(`
      SELECT 
        c.id, c.code, c.name, c.description, c.status,
        COUNT(p.id) as product_count,
        c.created_at
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.id ASC
    `);

    const headers = [
      'Mã ID',
      'Mã danh mục',
      'Tên danh mục',
      'Mô tả',
      'Số lượng sản phẩm',
      'Trạng thái',
      'Ngày tạo',
    ];

    const rows = categories.map((c) => [
      this.escapeCsvField(c.id),
      this.escapeCsvField(c.code),
      this.escapeCsvField(c.name),
      this.escapeCsvField(c.description || ''),
      this.escapeCsvField(c.product_count || 0),
      this.escapeCsvField(c.status === 'ACTIVE' ? 'Hoạt động' : 'Tạm khóa'),
      this.escapeCsvField(c.created_at || ''),
    ]);

    return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // 3. Xuất Thẻ kho & Sổ biến động kho (Stock Card / Movements) to CSV
  async exportStockMovementsCsv(limit = 1000): Promise<string> {
    const movements = await this.db.query<any>(`
      SELECT 
        sm.id, sm.movement_date, p.sku, p.name as product_name,
        sm.movement_type, sm.quantity_change, sm.balance_after,
        sm.reference_type, sm.reference_id, sm.note,
        u.username as operator, sm.created_at
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.created_by = u.id
      ORDER BY sm.id DESC
      LIMIT ?
    `, [limit]);

    const translateMovementType = (type: string) => {
      switch (type) {
        case 'PURCHASE': return 'Nhập mua hàng (PO)';
        case 'SALE': return 'Xuất bán hàng (POS)';
        case 'RETURN': return 'Nhập hoàn tồn (Hủy đơn)';
        case 'ADJUSTMENT': return 'Điều chỉnh kiểm kê';
        case 'DAMAGE': return 'Xuất hủy hỏng hóc';
        case 'LOSS': return 'Xuất hao hụt thất thoát';
        case 'GIFT': return 'Xuất tặng kèm';
        default: return type;
      }
    };

    const headers = [
      'Mã thẻ kho / GD',
      'Ngày giao dịch',
      'Mã SKU',
      'Tên sản phẩm',
      'Loại biến động',
      'Số lượng thay đổi',
      'Tồn kho sau biến động',
      'Loại chứng từ',
      'Mã chứng từ liên quan',
      'Người thực hiện',
      'Ghi chú / Lý do',
    ];

    const rows = movements.map((m) => [
      this.escapeCsvField(m.id),
      this.escapeCsvField(m.movement_date),
      this.escapeCsvField(m.sku),
      this.escapeCsvField(m.product_name),
      this.escapeCsvField(translateMovementType(m.movement_type)),
      this.escapeCsvField(m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change),
      this.escapeCsvField(m.balance_after),
      this.escapeCsvField(m.reference_type || ''),
      this.escapeCsvField(m.reference_id || ''),
      this.escapeCsvField(m.operator || 'Hệ thống'),
      this.escapeCsvField(m.note || ''),
    ]);

    return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // 4. Xuất Lịch sử bán hàng (Sales Orders History) to CSV
  async exportSalesOrdersCsv(periodDays = 365): Promise<string> {
    const cutoffDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const orders = await this.db.query<any>(`
      SELECT 
        o.order_code, o.sale_date, o.total_amount, o.total_discount, o.final_amount,
        o.payment_method, o.cash_received, o.cash_change,
        o.total_items, o.status, o.sync_status,
        u.username as cashier, o.note,
        o.cancel_reason, o.cancelled_at,
        canceller.username as cancelled_by_name,
        o.created_at
      FROM sales_orders o
      LEFT JOIN users u ON o.created_by = u.id
      LEFT JOIN users canceller ON o.cancelled_by = canceller.id
      WHERE o.sale_date >= ?
      ORDER BY o.id DESC
    `, [cutoffDate]);

    const translatePayment = (method: string) => {
      switch (method) {
        case 'CASH': return 'Tiền mặt';
        case 'BANK_TRANSFER': return 'Chuyển khoản QR';
        case 'CARD': return 'Thẻ ngân hàng';
        default: return method || 'Tiền mặt';
      }
    };

    const headers = [
      'Mã đơn hàng',
      'Ngày bán',
      'Thu ngân',
      'Phương thức thanh toán',
      'Tổng tiền hàng (VND)',
      'Giảm giá (VND)',
      'Khách cần trả (VND)',
      'Tiền khách đưa (VND)',
      'Tiền thối lại (VND)',
      'Tổng số lượng món',
      'Trạng thái đơn',
      'Lý do hủy (nếu có)',
      'Thời gian hủy',
      'Người thực hiện hủy',
      'Trạng thái đồng bộ',
      'Ghi chú',
    ];

    const rows = orders.map((o) => [
      this.escapeCsvField(o.order_code),
      this.escapeCsvField(o.sale_date),
      this.escapeCsvField(o.cashier || 'Admin'),
      this.escapeCsvField(translatePayment(o.payment_method)),
      this.escapeCsvField(o.total_amount || 0),
      this.escapeCsvField(o.total_discount || 0),
      this.escapeCsvField(o.final_amount || 0),
      this.escapeCsvField(o.cash_received || o.final_amount || 0),
      this.escapeCsvField(o.cash_change || 0),
      this.escapeCsvField(o.total_items || 0),
      this.escapeCsvField(o.status === 'CANCELLED' ? 'ĐÃ HỦY' : 'HOÀN THÀNH'),
      this.escapeCsvField(o.cancel_reason || ''),
      this.escapeCsvField(o.cancelled_at || ''),
      this.escapeCsvField(o.cancelled_by_name || ''),
      this.escapeCsvField(o.sync_status === 'SYNCED' ? 'Đã đồng bộ' : 'Chờ đồng bộ (Local)'),
      this.escapeCsvField(o.note || ''),
    ]);

    return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // Alias for backward compatibility
  async exportSalesCsv(periodDays = 365): Promise<string> {
    return this.exportSalesOrdersCsv(periodDays);
  }

  // 5. Utility helper: Chia sẻ file trên Mobile (Share Sheet) hoặc Tải file trên Web
  async shareOrDownloadFile(title: string, content: string, fileExtension: string = 'csv'): Promise<boolean> {
    const filename = title.endsWith(`.${fileExtension}`) ? title : `${title}.${fileExtension}`;

    // Web Platform: Trigger direct file download
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        const mimeType = fileExtension === 'json' ? 'application/json;charset=utf-8;' : 'text/csv;charset=utf-8;';
        const blob = new Blob([content], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        return true;
      } catch (err) {
        logger.error('ExportService', 'Web download error', err);
      }
    }

    // Native Mobile (Android / iOS): Open Native Share / Save Sheet
    try {
      await Share.share({
        title: filename,
        message: content,
      });
      return true;
    } catch (err) {
      logger.error('ExportService', 'Mobile share error', err);
      return false;
    }
  }

  // 6. Generate Controlled Local Database Backup JSON
  async generateLocalDatabaseBackupJson(): Promise<{
    metadata: {
      appName: string;
      appVersion: string;
      schemaVersion: number;
      exportedAt: string;
      totalTables: number;
    };
    data: Record<string, any[]>;
  }> {
    const [products, categories, types, orders, records, lots, movements, outbox] = await Promise.all([
      this.db.query('SELECT * FROM products'),
      this.db.query('SELECT * FROM categories'),
      this.db.query('SELECT * FROM product_types'),
      this.db.query('SELECT * FROM sales_orders'),
      this.db.query('SELECT * FROM sales_records'),
      this.db.query('SELECT * FROM inventory_lots'),
      this.db.query('SELECT * FROM stock_movements'),
      this.db.query('SELECT * FROM sync_queue'),
    ]);

    return {
      metadata: {
        appName: 'T_SHOP Retail POS',
        appVersion: '1.0.0',
        schemaVersion: 9,
        exportedAt: new Date().toISOString(),
        totalTables: 8,
      },
      data: {
        categories,
        product_types: types,
        products,
        sales_orders: orders,
        sales_records: records,
        inventory_lots: lots,
        stock_movements: movements,
        sync_queue: outbox,
      },
    };
  }

  async createLocalBackupJson(): Promise<{
    backup_metadata: {
      appName: string;
      app_version: string;
      database_version: string;
      timestamp: string;
    };
    snapshot: any;
  }> {
    const backup = await this.generateLocalDatabaseBackupJson();
    return {
      backup_metadata: {
        appName: backup.metadata.appName,
        app_version: backup.metadata.appVersion,
        database_version: `SQLite Schema v${backup.metadata.schemaVersion}`,
        timestamp: backup.metadata.exportedAt,
      },
      snapshot: backup.data,
    };
  }
}

export const exportService = new ExportService();
export default exportService;
