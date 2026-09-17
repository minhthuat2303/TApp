// T_SHOP Mobile - Activity & Audit Log Service
// Compiles chronological event logs from immutable transactional tables (sales, imports, movements, syncs)

import databaseService, { DatabaseService } from '../database/DatabaseService';

export interface ActivityEvent {
  id: string;
  type: 'SALE' | 'IMPORT' | 'ADJUSTMENT' | 'SYNC' | 'CONFLICT';
  title: string;
  subtitle: string;
  timestamp: string;
  status: 'COMPLETED' | 'PENDING' | 'SYNCED' | 'FAILED' | 'OPEN';
  actor?: string;
  icon: string;
  tag: string;
}

export class AuditLogService {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  async getRecentActivities(limit = 30): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      // 1. Recent Sales Orders
      const sales = await this.db.query<any>(`
        SELECT 
          o.id, o.order_code, o.sale_date, o.final_amount, o.total_items,
          o.status, o.sync_status, o.created_at, u.username as cashier
        FROM sales_orders o
        LEFT JOIN users u ON o.created_by = u.id
        ORDER BY o.id DESC
        LIMIT ?
      `, [limit]);

      for (const s of sales) {
        events.push({
          id: `sale-${s.id}`,
          type: 'SALE',
          title: `Bán hàng: ${s.order_code}`,
          subtitle: `${s.total_items} món • ${(s.final_amount || 0).toLocaleString('vi-VN')} đ`,
          timestamp: s.created_at || s.sale_date,
          status: s.status === 'COMPLETED' ? (s.sync_status === 'SYNCED' ? 'SYNCED' : 'PENDING') : 'FAILED',
          actor: s.cashier || 'Thu ngân',
          icon: '🛒',
          tag: s.sync_status === 'SYNCED' ? 'Đã đồng bộ' : 'Lưu Offline',
        });
      }

      // 2. Recent Stock Movements (Damage, Loss, Return, Adjustments)
      const movements = await this.db.query<any>(`
        SELECT 
          sm.id, sm.movement_type, sm.quantity_change, sm.movement_date,
          sm.note, sm.created_at, p.name as product_name, p.sku
        FROM stock_movements sm
        JOIN products p ON sm.product_id = p.id
        WHERE sm.movement_type != 'SALE'
        ORDER BY sm.id DESC
        LIMIT ?
      `, [limit]);

      for (const m of movements) {
        const isImport = m.movement_type === 'PURCHASE';
        events.push({
          id: `move-${m.id}`,
          type: isImport ? 'IMPORT' : 'ADJUSTMENT',
          title: isImport ? `Nhập kho: ${m.product_name}` : `Điều chỉnh kho (${m.movement_type})`,
          subtitle: `${m.quantity_change > 0 ? '+' : ''}${m.quantity_change} cái • SKU: ${m.sku}`,
          timestamp: m.created_at || m.movement_date,
          status: 'COMPLETED',
          icon: isImport ? '📥' : '⚖️',
          tag: m.movement_type,
        });
      }

      // 3. Recent Sync Sessions
      const syncSessions = await this.db.query<any>(`
        SELECT session_id, started_at, completed_at, status, total_pushed, total_pulled
        FROM sync_sessions
        ORDER BY id DESC
        LIMIT 10
      `);

      for (const ss of syncSessions) {
        events.push({
          id: `sync-${ss.session_id}`,
          type: 'SYNC',
          title: `Đồng bộ máy chủ`,
          subtitle: `Đẩy: ${ss.total_pushed || 0} • Kéo: ${ss.total_pulled || 0}`,
          timestamp: ss.started_at,
          status: ss.status === 'COMPLETED' ? 'SYNCED' : 'FAILED',
          icon: '🔄',
          tag: ss.status === 'COMPLETED' ? 'Thành công' : 'Lỗi kết nối',
        });
      }

      // Sort all events descending by timestamp
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return events.slice(0, limit);
    } catch (err) {
      console.error('Failed to get activity events:', err);
      return [];
    }
  }
}

export const auditLogService = new AuditLogService();
export default auditLogService;
