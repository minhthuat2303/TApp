// T_SHOP Mobile - File Import & Parsing Service (CSV / Text / Excel compatible)
// Provides complete validation, duplicate detection, row errors, and atomic committing for:
// 1. Bulk Product Import
// 2. Bulk Inventory Receipt Import

import databaseService, { DatabaseService } from '../database/DatabaseService';
import outboxService, { OutboxService } from './OutboxService';
import { ITransactionClient } from '../database/types';
import { ValidationError } from './types';
import logger from '../utils/logger';

export interface ProductImportRow {
  sku: string;
  name: string;
  category_name?: string;
  current_selling_price: number;
  current_cost_price?: number;
  min_stock_alert?: number;
  barcode?: string;
  description?: string;
}

export interface InventoryImportRow {
  sku: string;
  quantity: number;
  unit_cost_price: number;
  supplier_name?: string;
  note?: string;
}

export interface FileImportPreview<T> {
  entityType: 'PRODUCTS' | 'INVENTORY';
  fileName: string;
  totalRows: number;
  validRows: T[];
  errorRows: Array<{ rowNumber: number; raw: string; reason: string }>;
  summary: {
    createsCount?: number;
    updatesCount?: number;
    totalQuantity?: number;
    totalAmount?: number;
  };
}

export class FileImportService {
  private db: DatabaseService;
  private outbox: OutboxService;

  constructor(db?: DatabaseService, outbox?: OutboxService) {
    this.db = db || databaseService;
    this.outbox = outbox || outboxService;
  }

  // Helper: Parse CSV text into array of string arrays handling quotes
  parseCsv(text: string): string[][] {
    const lines = text.trim().split(/\r?\n/);
    const result: string[][] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const row: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if ((char === ',' || char === ';') && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      row.push(current.trim());
      result.push(row);
    }

    return result;
  }

  // 1. Parse & Preview Product Import CSV
  async previewProductImport(csvContent: string, fileName = 'products_import.csv'): Promise<FileImportPreview<ProductImportRow>> {
    const rawRows = this.parseCsv(csvContent);
    if (rawRows.length <= 1) {
      throw new ValidationError('File CSV trống hoặc không có dòng dữ liệu hợp lệ.');
    }

    // Header index discovery
    const header = rawRows[0].map(h => h.toLowerCase());
    const skuIdx = header.findIndex(h => h.includes('sku') || h.includes('mã'));
    const nameIdx = header.findIndex(h => h.includes('tên') || h.includes('name'));
    const priceIdx = header.findIndex(h => h.includes('giá bán') || h.includes('selling') || h.includes('giá'));
    const costIdx = header.findIndex(h => h.includes('giá vốn') || h.includes('cost'));
    const minAlertIdx = header.findIndex(h => h.includes('tồn tối thiểu') || h.includes('alert') || h.includes('ngưỡng'));
    const catIdx = header.findIndex(h => h.includes('danh mục') || h.includes('category'));
    const barcodeIdx = header.findIndex(h => h.includes('barcode') || h.includes('vạch'));

    if (skuIdx === -1 || nameIdx === -1) {
      throw new ValidationError('File CSV sản phẩm phải có cột "Mã SKU" và "Tên sản phẩm".');
    }

    // Fetch existing product SKUs to classify creates vs updates
    const existingProducts = await this.db.query<{ id: number; sku: string }>('SELECT id, sku FROM products');
    const existingSkuMap = new Set(existingProducts.map(p => p.sku.toUpperCase()));

    const validRows: ProductImportRow[] = [];
    const errorRows: Array<{ rowNumber: number; raw: string; reason: string }> = [];
    let createsCount = 0;
    let updatesCount = 0;

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 1;
      const sku = (row[skuIdx] || '').trim();
      const name = (row[nameIdx] || '').trim();

      if (!sku) {
        errorRows.push({ rowNumber: rowNum, raw: row.join(', '), reason: 'Thiếu mã SKU sản phẩm.' });
        continue;
      }
      if (!name) {
        errorRows.push({ rowNumber: rowNum, raw: row.join(', '), reason: 'Thiếu tên sản phẩm.' });
        continue;
      }

      const priceRaw = priceIdx !== -1 ? row[priceIdx].replace(/[^\d.]/g, '') : '0';
      const sellingPrice = parseFloat(priceRaw) || 0;
      if (sellingPrice < 0) {
        errorRows.push({ rowNumber: rowNum, raw: row.join(', '), reason: 'Giá bán không được nhỏ hơn 0.' });
        continue;
      }

      const costRaw = costIdx !== -1 ? row[costIdx].replace(/[^\d.]/g, '') : '0';
      const costPrice = parseFloat(costRaw) || 0;

      const minAlertRaw = minAlertIdx !== -1 ? row[minAlertIdx].replace(/[^\d]/g, '') : '5';
      const minStockAlert = parseInt(minAlertRaw, 10) || 5;

      const categoryName = catIdx !== -1 ? (row[catIdx] || '').trim() : undefined;
      const barcode = barcodeIdx !== -1 ? (row[barcodeIdx] || '').trim() : undefined;

      if (existingSkuMap.has(sku.toUpperCase())) {
        updatesCount++;
      } else {
        createsCount++;
      }

      validRows.push({
        sku,
        name,
        category_name: categoryName,
        current_selling_price: sellingPrice,
        current_cost_price: costPrice,
        min_stock_alert: minStockAlert,
        barcode: barcode || undefined,
      });
    }

    return {
      entityType: 'PRODUCTS',
      fileName,
      totalRows: rawRows.length - 1,
      validRows,
      errorRows,
      summary: {
        createsCount,
        updatesCount,
      },
    };
  }

  // 2. Commit Product Import to SQLite and Outbox
  async commitProductImport(preview: FileImportPreview<ProductImportRow>, userId = 1): Promise<{ importedCount: number; message: string }> {
    if (preview.validRows.length === 0) {
      throw new ValidationError('Không có dòng sản phẩm hợp lệ để nhập vào hệ thống.');
    }

    return await this.db.withTransactionAsync(async (tx: ITransactionClient) => {
      let imported = 0;
      const defaultCat = await tx.getFirstAsync<any>('SELECT id FROM categories LIMIT 1');
      const defaultCatId = defaultCat ? defaultCat.id : 1;
      const defaultType = await tx.getFirstAsync<any>('SELECT id FROM product_types LIMIT 1');
      const defaultTypeId = defaultType ? defaultType.id : 1;

      for (const item of preview.validRows) {
        const existing = await tx.getFirstAsync<any>(
          'SELECT id, current_selling_price FROM products WHERE LOWER(sku) = LOWER(?)',
          [item.sku]
        );

        if (existing) {
          await tx.runAsync(`
            UPDATE products
            SET name = ?, current_selling_price = ?, min_stock_alert = COALESCE(?, min_stock_alert), updated_at = datetime('now')
            WHERE id = ?
          `, [item.name, item.current_selling_price, item.min_stock_alert, existing.id]);

          if (Number(existing.current_selling_price) !== Number(item.current_selling_price)) {
            await tx.runAsync(`
              INSERT INTO price_history (product_id, price, effective_from, note, created_by, created_at)
              VALUES (?, ?, datetime('now'), 'Cập nhật từ file nhập sản phẩm', ?, datetime('now'))
            `, [existing.id, item.current_selling_price, userId]);
          }

          await this.outbox.enqueue({
            clientMutationId: `prod-upd-import-${existing.id}-${Date.now()}`,
            entityType: 'PRODUCT',
            entityId: String(existing.id),
            action: 'UPDATE',
            payload: { id: existing.id, ...item },
            userId,
          });
        } else {
          const insertRes = await tx.runAsync(`
            INSERT INTO products (
              sku, name, category_id, product_type_id,
              current_cost_price, current_selling_price, current_stock,
              min_stock_alert, status, barcode, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'ACTIVE', ?, datetime('now'), datetime('now'))
          `, [
            item.sku,
            item.name,
            defaultCatId,
            defaultTypeId,
            item.current_cost_price || 0,
            item.current_selling_price,
            item.min_stock_alert || 5,
            item.barcode || null,
          ]);

          const newId = insertRes.lastInsertRowId;
          await this.outbox.enqueue({
            clientMutationId: `prod-ins-import-${newId}-${Date.now()}`,
            entityType: 'PRODUCT',
            entityId: String(newId),
            action: 'CREATE',
            payload: { id: newId, ...item },
            userId,
          });
        }
        imported++;
      }

      return {
        importedCount: imported,
        message: `Đã nhập thành công ${imported} sản phẩm vào cơ sở dữ liệu.`,
      };
    });
  }

  // 3. Parse & Preview Inventory Stock Import CSV
  async previewInventoryImport(csvContent: string, fileName = 'inventory_import.csv'): Promise<FileImportPreview<InventoryImportRow>> {
    const rawRows = this.parseCsv(csvContent);
    if (rawRows.length <= 1) {
      throw new ValidationError('File CSV trống hoặc không có dòng dữ liệu hợp lệ.');
    }

    const header = rawRows[0].map(h => h.toLowerCase());
    const skuIdx = header.findIndex(h => h.includes('sku') || h.includes('mã'));
    const qtyIdx = header.findIndex(h => h.includes('số lượng') || h.includes('qty') || h.includes('sl'));
    const costIdx = header.findIndex(h => h.includes('giá') || h.includes('đơn giá') || h.includes('cost'));
    const supplierIdx = header.findIndex(h => h.includes('nhà cung cấp') || h.includes('supplier') || h.includes('ncc'));
    const noteIdx = header.findIndex(h => h.includes('ghi chú') || h.includes('note'));

    if (skuIdx === -1 || qtyIdx === -1 || costIdx === -1) {
      throw new ValidationError('File CSV nhập kho phải có các cột: "Mã SKU", "Số lượng", và "Đơn giá nhập".');
    }

    // Verify all products exist in SQLite
    const prods = await this.db.query<{ id: number; sku: string; name: string }>(
      'SELECT id, sku, name FROM products WHERE status = "ACTIVE"'
    );
    const prodMap = new Map(prods.map(p => [p.sku.toUpperCase(), p]));

    const validRows: InventoryImportRow[] = [];
    const errorRows: Array<{ rowNumber: number; raw: string; reason: string }> = [];
    let totalQuantity = 0;
    let totalAmount = 0;

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 1;
      const sku = (row[skuIdx] || '').trim();

      if (!sku) {
        errorRows.push({ rowNumber: rowNum, raw: row.join(', '), reason: 'Thiếu mã SKU.' });
        continue;
      }

      const product = prodMap.get(sku.toUpperCase());
      if (!product) {
        errorRows.push({
          rowNumber: rowNum,
          raw: row.join(', '),
          reason: `Mã SKU "${sku}" không tồn tại trong danh mục sản phẩm đang hoạt động.`,
        });
        continue;
      }

      const qtyRaw = row[qtyIdx].replace(/[^\d]/g, '');
      const quantity = parseInt(qtyRaw, 10);
      if (isNaN(quantity) || quantity <= 0) {
        errorRows.push({ rowNumber: rowNum, raw: row.join(', '), reason: 'Số lượng nhập phải là số nguyên > 0.' });
        continue;
      }

      const costRaw = row[costIdx].replace(/[^\d.]/g, '');
      const unitCost = parseFloat(costRaw);
      if (isNaN(unitCost) || unitCost < 0) {
        errorRows.push({ rowNumber: rowNum, raw: row.join(', '), reason: 'Đơn giá nhập không hợp lệ (>= 0).' });
        continue;
      }

      const supplierName = supplierIdx !== -1 ? (row[supplierIdx] || '').trim() : undefined;
      const note = noteIdx !== -1 ? (row[noteIdx] || '').trim() : undefined;

      const itemTotal = quantity * unitCost;
      totalQuantity += quantity;
      totalAmount += itemTotal;

      validRows.push({
        sku,
        quantity,
        unit_cost_price: unitCost,
        supplier_name: supplierName,
        note,
      });
    }

    return {
      entityType: 'INVENTORY',
      fileName,
      totalRows: rawRows.length - 1,
      validRows,
      errorRows,
      summary: {
        totalQuantity,
        totalAmount,
      },
    };
  }

  // 4. Commit Inventory Import (FIFO Lots, Stock Movement, Outbox)
  async commitInventoryImport(
    preview: FileImportPreview<InventoryImportRow>,
    importDate?: string,
    userId = 1
  ): Promise<{ importCode: string; totalItems: number; totalAmount: number; message: string }> {
    if (preview.validRows.length === 0) {
      throw new ValidationError('Không có dòng hàng nhập kho hợp lệ để thực hiện.');
    }

    const now = new Date();
    const dateStr = importDate || now.toISOString().slice(0, 10);
    const timeSuffix = now.getTime().toString().slice(-4);
    const importCode = `NK-CSV-${dateStr.replace(/-/g, '')}-${timeSuffix}`;
    const clientImportId = `imp-csv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return await this.db.withTransactionAsync(async (tx: ITransactionClient) => {
      // 1. Insert Import Header
      const headerRes = await tx.runAsync(`
        INSERT INTO imports (
          client_import_id, import_code, supplier_id, import_date,
          total_amount, note, status, sync_status, created_by, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'COMPLETED', 'PENDING', ?, datetime('now'))
      `, [
        clientImportId,
        importCode,
        dateStr,
        preview.summary.totalAmount || 0,
        `Nhập kho hàng loạt từ file ${preview.fileName}`,
        userId,
      ]);

      const importId = headerRes.lastInsertRowId;

      for (const item of preview.validRows) {
        const prod = await tx.getFirstAsync<any>(
          'SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE sku = ?',
          [item.sku]
        );
        if (!prod) continue;

        const itemTotal = item.quantity * item.unit_cost_price;

        // 2. Insert import_items
        await tx.runAsync(`
          INSERT INTO import_items (
            import_id, product_id, quantity, unit_cost_price, total_amount, created_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, [importId, prod.id, item.quantity, item.unit_cost_price, itemTotal]);

        // 3. Create FIFO Lot
        const lotCode = `LOT-${dateStr.replace(/-/g, '')}-${prod.sku}-${timeSuffix}`;
        await tx.runAsync(`
          INSERT INTO inventory_lots (
            lot_code, product_id, purchase_date, quantity_received,
            quantity_remaining, unit_cost, supplier_id, import_id,
            note, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, datetime('now'))
        `, [
          lotCode, prod.id, dateStr, item.quantity,
          item.quantity, item.unit_cost_price, importId,
          `Nhập kho file ${preview.fileName}`, userId,
        ]);

        // 4. Update Cost Price History
        await tx.runAsync(`
          INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by, created_at)
          VALUES (?, ?, date('now'), ?, ?, datetime('now'))
        `, [prod.id, item.unit_cost_price, `Nhập kho file ${preview.fileName}`, userId]);

        // 5. Update Product Stock and Weighted Average Cost
        const remainingLots = await tx.getFirstAsync<any>(`
          SELECT 
            COALESCE(SUM(quantity_remaining), 0) as total_rem,
            COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
          FROM inventory_lots
          WHERE product_id = ? AND quantity_remaining > 0
        `, [prod.id]);

        const totalRem = Number(remainingLots?.total_rem || 0);
        const totalVal = Number(remainingLots?.total_val || 0);
        const newStock = Number(prod.current_stock) + item.quantity;
        const weightedAvgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : item.unit_cost_price;

        await tx.runAsync(`
          UPDATE products
          SET current_stock = ?, current_cost_price = ?, updated_at = datetime('now')
          WHERE id = ?
        `, [newStock, weightedAvgCost, prod.id]);

        // 6. Log Stock Movement (PURCHASE)
        const clientMovementId = `mov-imp-csv-${Date.now()}-${prod.id}`;
        await tx.runAsync(`
          INSERT INTO stock_movements (
            client_movement_id, product_id, movement_type, quantity_change,
            balance_after, movement_date, reference_type, reference_id,
            sync_status, note, created_by, created_at
          ) VALUES (?, ?, 'PURCHASE', ?, ?, ?, 'IMPORT', ?, 'PENDING', ?, datetime('now'))
        `, [
          clientMovementId, prod.id, item.quantity,
          newStock, dateStr, importId,
          `Nhập kho lô từ file ${preview.fileName}`, userId,
        ]);
      }

      // Enqueue to Outbox
      await this.outbox.enqueue({
        clientMutationId: `imp-file-sync-${importId}-${Date.now()}`,
        entityType: 'IMPORT_ORDER',
        entityId: String(importId),
        action: 'CREATE',
        payload: {
          client_import_id: clientImportId,
          import_code: importCode,
          import_date: dateStr,
          total_amount: preview.summary.totalAmount || 0,
          total_items: preview.validRows.length,
          file_name: preview.fileName,
        },
        userId,
      });

      return {
        importCode,
        totalItems: preview.validRows.length,
        totalAmount: preview.summary.totalAmount || 0,
        message: `Đã nhập kho thành công ${preview.validRows.length} mặt hàng theo mã phiếu ${importCode}.`,
      };
    });
  }

  // Sample templates for users to copy or download
  getProductCsvTemplate(): string {
    return [
      'Mã SKU,Tên sản phẩm,Danh mục,Giá vốn,Giá bán,Tồn tối thiểu,Mã vạch',
      'GB-GAU-01,Gấu Bông Nâu Ôm Tim 40cm,Gấu Bông,85000,165000,5,8936001001',
      'XD-CAN-01,Xe Cẩu Điều Khiển Từ Xa 8 Kênh,Xe Điều Khiển,210000,380000,3,8936002002',
      'LG-TAU-01,Bộ Xếp Hình Tàu Chiến Hạm 450 Chi Tiết,Xếp Hình Lego,145000,285000,4,8936003003',
    ].join('\n');
  }

  getProductImportTemplate(): string {
    return this.getProductCsvTemplate();
  }

  getInventoryCsvTemplate(): string {
    return [
      'Mã SKU,Số lượng,Đơn giá nhập,Nhà cung cấp,Ghi chú',
      'GB-CAPY-01,20,85000,Tổng Kho Đồ Chơi VN,Nhập đợt lễ Tết',
      'LG-CITY-01,15,210000,Nhà Phân Phối Lego Hà Nội,Nhập bổ sung',
      'RC-CAR-01,10,250000,Công Ty Đồ Chơi Sài Gòn,Lô hàng mới về',
    ].join('\n');
  }

  getInventoryImportTemplate(): string {
    return this.getInventoryCsvTemplate();
  }
}

export const fileImportService = new FileImportService();
export default fileImportService;
