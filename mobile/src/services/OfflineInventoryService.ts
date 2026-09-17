import { ITransactionClient, ImportRecord, ImportItem, StockStatus } from '../database/types';
import databaseService, { DatabaseService } from '../database/DatabaseService';
import offlineTransactionService, { OfflineTransactionService } from './OfflineTransactionService';
import outboxService, { OutboxService } from './OutboxService';
import { CreateImportInput, ImportResult, StockAdjustmentInput, StockAdjustmentResult, ValidationError } from './types';
import logger from '../utils/logger';

export class OfflineInventoryService {
  private db: DatabaseService;
  private txService: OfflineTransactionService;
  private outbox: OutboxService;

  constructor(
    db?: DatabaseService,
    txService?: OfflineTransactionService,
    outbox?: OutboxService
  ) {
    this.db = db || databaseService;
    this.txService = txService || offlineTransactionService;
    this.outbox = outbox || outboxService;
  }

  async createStockReceipt(input: CreateImportInput): Promise<ImportResult> {
    if (!input.items || input.items.length === 0) {
      throw new ValidationError('Phiếu nhập kho phải có ít nhất 1 sản phẩm.');
    }

    const clientImportId = input.clientImportId || this.txService.generateId('imp');
    const now = new Date();
    const dateStr = input.importDate || now.toISOString().slice(0, 10);
    const timeSuffix = now.getTime().toString().slice(-4);
    const importCode = `NK-OFFLINE-${dateStr.replace(/-/g, '')}-${timeSuffix}`;

    return await this.txService.executeAtomic(
      clientImportId,
      async (tx: ITransactionClient) => {
        let totalAmount = 0;
        const processedItems: Array<{
          product: { id: number; sku: string; name: string; current_stock: number; current_cost_price: number };
          quantity: number;
          unitCostPrice: number;
          totalItemAmount: number;
        }> = [];

        // 1. Validate items
        for (const item of input.items) {
          if (!item.productId || isNaN(item.quantity) || item.quantity <= 0) {
            throw new ValidationError('Số lượng nhập phải lớn hơn 0.');
          }
          if (isNaN(item.unitCostPrice) || item.unitCostPrice < 0) {
            throw new ValidationError('Đơn giá nhập không thể âm.');
          }

          const product = await tx.getFirstAsync<{
            id: number;
            sku: string;
            name: string;
            current_stock: number;
            current_cost_price: number;
          }>('SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?', [item.productId]);

          if (!product) {
            throw new ValidationError(`Sản phẩm với ID ${item.productId} không tồn tại.`);
          }

          const totalItemAmount = item.quantity * item.unitCostPrice;
          totalAmount += totalItemAmount;

          processedItems.push({
            product,
            quantity: item.quantity,
            unitCostPrice: item.unitCostPrice,
            totalItemAmount,
          });
        }

        // 2. Insert Import Header
        const importInfo = await tx.runAsync(`
          INSERT INTO imports (
            client_import_id, import_code, supplier_id, import_date,
            total_amount, note, sync_status, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, datetime('now'))
        `, [
          clientImportId, importCode, input.supplierId || null, dateStr,
          totalAmount, input.note || null, input.createdBy || 1
        ]);

        const importId = importInfo.lastInsertRowId;
        const createdItems: ImportItem[] = [];

        // 3. Process each item: insert import_items, lots, cost history, and update stock
        for (const item of processedItems) {
          const itemResult = await tx.runAsync(`
            INSERT INTO import_items (
              import_id, product_id, quantity, unit_cost_price, total_amount, created_at
            ) VALUES (?, ?, ?, ?, ?, datetime('now'))
          `, [
            importId, item.product.id, item.quantity,
            item.unitCostPrice, item.totalItemAmount
          ]);

          const lotCode = `LOT-${dateStr.replace(/-/g, '')}-${item.product.sku}-${timeSuffix}`;

          // Create FIFO inventory lot
          await tx.runAsync(`
            INSERT INTO inventory_lots (
              lot_code, product_id, purchase_date, quantity_received,
              quantity_remaining, unit_cost, supplier_id, import_id,
              note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `, [
            lotCode, item.product.id, dateStr, item.quantity,
            item.quantity, item.unitCostPrice, input.supplierId || null,
            importId, `Nhập kho phiếu ${importCode}`, input.createdBy || 1
          ]);

          // Record cost price history
          await tx.runAsync(`
            INSERT INTO cost_price_history (
              product_id, cost_price, effective_from, note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, datetime('now'))
          `, [
            item.product.id, item.unitCostPrice, dateStr,
            `Nhập kho phiếu ${importCode} (Lô ${lotCode})`, input.createdBy || 1
          ]);

          // Recalculate weighted average cost and update product stock
          const newStock = item.product.current_stock + item.quantity;
          const weightedCost = Math.round(
            (item.product.current_stock * item.product.current_cost_price + item.totalItemAmount) /
            (newStock > 0 ? newStock : 1)
          );

          await tx.runAsync(`
            UPDATE products 
            SET current_stock = ?, current_cost_price = ?, updated_at = datetime('now')
            WHERE id = ?
          `, [newStock, weightedCost, item.product.id]);

          // Insert stock movement
          const clientMovementId = `mov-${clientImportId}-P${item.product.id}`;
          await tx.runAsync(`
            INSERT INTO stock_movements (
              client_movement_id, product_id, movement_type, quantity_change,
              balance_after, movement_date, reference_type, reference_id,
              sync_status, note, created_by, created_at
            ) VALUES (?, ?, 'PURCHASE', ?, ?, ?, 'imports', ?, 'PENDING', ?, ?, datetime('now'))
          `, [
            clientMovementId, item.product.id, item.quantity,
            newStock, dateStr, importId.toString(),
            `Nhập kho ${importCode} (Lô ${lotCode})`, input.createdBy || 1
          ]);

          createdItems.push({
            id: itemResult.lastInsertRowId,
            import_id: importId,
            product_id: item.product.id,
            product_name: item.product.name,
            sku: item.product.sku,
            quantity: item.quantity,
            unit_cost_price: item.unitCostPrice,
            total_amount: item.totalItemAmount,
            created_at: now.toISOString(),
          });
        }

        // 4. Enqueue into Outbox sync_queue
        const outboxPayload = {
          client_import_id: clientImportId,
          import_code: importCode,
          supplier_id: input.supplierId,
          import_date: dateStr,
          total_amount: totalAmount,
          items: processedItems.map((it) => ({
            product_id: it.product.id,
            sku: it.product.sku,
            quantity: it.quantity,
            unit_cost_price: it.unitCostPrice,
            total_amount: it.totalItemAmount,
          })),
          note: input.note,
          created_by: input.createdBy || 1,
        };

        await this.outbox.enqueueMutation(tx, {
          client_mutation_id: clientImportId,
          entity_type: 'IMPORT',
          entity_id: clientImportId,
          action: 'CREATE',
          payload: outboxPayload,
          payload_version: 1,
          created_at: now.toISOString(),
          user_id: input.createdBy || 1,
        });

        const importRecord: ImportRecord = {
          id: importId,
          client_import_id: clientImportId,
          server_id: null,
          import_code: importCode,
          supplier_id: input.supplierId || null,
          import_date: dateStr,
          total_amount: totalAmount,
          note: input.note || null,
          sync_status: 'PENDING',
          created_by: input.createdBy || 1,
          created_at: now.toISOString(),
          synced_at: null,
        };

        logger.info('OfflineInventoryService', `Created offline stock receipt ${importCode} with total ${totalAmount}`);
        return { importRecord, items: createdItems };
      },
      {
        sql: 'SELECT id FROM imports WHERE client_import_id = ?',
        params: [clientImportId],
      }
    );
  }

  async getStockStatus(productId: number): Promise<StockStatus> {
    const product = await this.db.queryOne<{ current_stock: number }>(
      'SELECT current_stock FROM products WHERE id = ?',
      [productId]
    );
    const serverStock = product ? product.current_stock : 0;

    const pendingRow = await this.db.queryOne<{ pending_sold: number }>(`
      SELECT COALESCE(SUM(quantity), 0) as pending_sold 
      FROM sales_records 
      WHERE product_id = ? AND status = 'COMPLETED' AND sync_status = 'PENDING'
    `, [productId]);

    const pendingDelta = pendingRow ? pendingRow.pending_sold : 0;
    const effectiveStock = Math.max(0, serverStock - pendingDelta);

    return { productId, serverStock, pendingDelta, effectiveStock };
  }

  async adjustStock(input: StockAdjustmentInput): Promise<StockAdjustmentResult> {
    const qtyChange = parseInt(String(input.quantityChange), 10);
    if (isNaN(qtyChange) || qtyChange === 0) {
      throw new ValidationError('Số lượng điều chỉnh kho phải là số nguyên khác 0.');
    }

    const clientAdjustmentId = input.clientAdjustmentId || this.txService.generateId('adj');
    const now = new Date();
    const dateStr = input.movementDate || now.toISOString().slice(0, 10);

    return await this.txService.executeAtomic(
      clientAdjustmentId,
      async (tx: ITransactionClient) => {
        const product = await tx.getFirstAsync<{
          id: number;
          sku: string;
          name: string;
          current_stock: number;
        }>('SELECT id, sku, name, current_stock FROM products WHERE id = ?', [input.productId]);

        if (!product) {
          throw new ValidationError(`Sản phẩm với ID ${input.productId} không tồn tại.`);
        }

        const newStock = Number(product.current_stock) + qtyChange;
        if (newStock < 0) {
          throw new ValidationError(
            `Tồn kho khả dụng không đủ để điều chỉnh xuất (${product.name}: tồn hiện tại ${product.current_stock}, điều chỉnh ${qtyChange}).`
          );
        }

        // 1. Insert stock_movements
        const moveInfo = await tx.runAsync(`
          INSERT INTO stock_movements (
            client_movement_id, product_id, movement_type, quantity_change,
            balance_after, movement_date, reference_type, reference_id,
            sync_status, note, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'stock_adjustments', NULL, 'PENDING', ?, ?, datetime('now'))
        `, [
          clientAdjustmentId, input.productId, input.movementType, qtyChange,
          newStock, dateStr, input.note || `Điều chỉnh kho (${input.movementType})`,
          input.createdBy || 1
        ]);

        const movementId = moveInfo.lastInsertRowId;

        // 2. Update products current_stock
        await tx.runAsync(`
          UPDATE products
          SET current_stock = ?, updated_at = datetime('now')
          WHERE id = ?
        `, [newStock, input.productId]);

        // 3. Enqueue Outbox mutation
        const outboxPayload = {
          client_adjustment_id: clientAdjustmentId,
          product_id: input.productId,
          movement_type: input.movementType,
          quantity_change: qtyChange,
          movement_date: dateStr,
          note: input.note,
          created_by: input.createdBy || 1,
        };

        await this.outbox.enqueueMutation(tx, {
          client_mutation_id: clientAdjustmentId,
          entity_type: 'INVENTORY_ADJUSTMENT',
          entity_id: clientAdjustmentId,
          action: 'CREATE',
          payload: outboxPayload,
          payload_version: 1,
          created_at: now.toISOString(),
          user_id: input.createdBy || 1,
        });

        logger.info('OfflineInventoryService', `Adjusted stock for ${product.name} (${input.movementType}: ${qtyChange}). Balance after: ${newStock}`);

        return {
          movementId,
          clientMovementId: clientAdjustmentId,
          productId: input.productId,
          productName: product.name,
          movementType: input.movementType,
          quantityChange: qtyChange,
          balanceAfter: newStock,
          movementDate: dateStr,
          note: input.note,
        };
      },
      {
        sql: 'SELECT id FROM stock_movements WHERE client_movement_id = ?',
        params: [clientAdjustmentId],
      }
    );
  }
}

export const offlineInventoryService = new OfflineInventoryService();
export default offlineInventoryService;
