import { Product } from '../../types/domain';
import { ILocalDataSource } from '../base';
import databaseService, { DatabaseService } from '../../database/DatabaseService';
import { matchesVietnameseSearch, calculateSearchRank } from '../../utils/vietnameseUtils';
import logger from '../../utils/logger';

export class SqliteProductDataSource implements ILocalDataSource<Product> {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  async getAll(): Promise<Product[]> {
    try {
      const rows = await this.db.query<Product>(`
        SELECT 
          p.id,
          p.sku,
          p.name,
          p.category_id,
          c.name as category_name,
          p.product_type_id,
          pt.name as product_type_name,
          p.current_cost_price,
          p.current_selling_price,
          p.current_stock,
          p.min_stock_alert,
          p.status,
          p.created_at,
          p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN product_types pt ON p.product_type_id = pt.id
        ORDER BY p.id ASC
      `);
      return rows;
    } catch (err) {
      logger.error('SqliteProductDataSource', 'Failed to get all products', err);
      return [];
    }
  }

  async getById(id: number | string): Promise<Product | null> {
    try {
      const row = await this.db.queryOne<Product>(`
        SELECT 
          p.id,
          p.sku,
          p.name,
          p.category_id,
          c.name as category_name,
          p.product_type_id,
          pt.name as product_type_name,
          p.current_cost_price,
          p.current_selling_price,
          p.current_stock,
          p.min_stock_alert,
          p.status,
          p.created_at,
          p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN product_types pt ON p.product_type_id = pt.id
        WHERE p.id = ?
        LIMIT 1
      `, [Number(id)]);
      return row;
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to get product by id ${id}`, err);
      return null;
    }
  }

  async search(keyword: string): Promise<Product[]> {
    try {
      const trimmed = keyword.trim();
      if (!trimmed) {
        return await this.getAll();
      }

      // Fetch all active products for deterministic in-memory Vietnamese normalized matching & ranking
      const allProducts = await this.getAll();

      const matchedProducts = allProducts
        .map((p) => {
          const rank = calculateSearchRank(p.name, p.sku, trimmed, p.id.toString());
          const isMatch = rank > 0 || 
            matchesVietnameseSearch(p.name, trimmed) || 
            matchesVietnameseSearch(p.sku, trimmed) ||
            (p.category_name ? matchesVietnameseSearch(p.category_name, trimmed) : false);
          return { product: p, rank: isMatch ? (rank || 50) : 0 };
        })
        .filter((item) => item.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .map((item) => item.product);

      return matchedProducts;
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to search products for ${keyword}`, err);
      return [];
    }
  }

  async getByBarcode(barcode: string): Promise<Product | null> {
    try {
      const trimmed = barcode.trim();
      const numId = Number(trimmed);
      const isNum = !isNaN(numId) && numId > 0;

      const row = await this.db.queryOne<Product>(`
        SELECT 
          p.id,
          p.sku,
          p.name,
          p.category_id,
          c.name as category_name,
          p.product_type_id,
          pt.name as product_type_name,
          p.current_cost_price,
          p.current_selling_price,
          p.current_stock,
          p.min_stock_alert,
          p.status,
          p.created_at,
          p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN product_types pt ON p.product_type_id = pt.id
        WHERE LOWER(p.sku) = LOWER(?) ${isNum ? 'OR p.id = ?' : ''}
        LIMIT 1
      `, isNum ? [trimmed, numId] : [trimmed]);

      return row;
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to get product by barcode ${barcode}`, err);
      return null;
    }
  }

  async getByCategory(categoryId: number): Promise<Product[]> {
    try {
      const rows = await this.db.query<Product>(`
        SELECT 
          p.id,
          p.sku,
          p.name,
          p.category_id,
          c.name as category_name,
          p.product_type_id,
          pt.name as product_type_name,
          p.current_cost_price,
          p.current_selling_price,
          p.current_stock,
          p.min_stock_alert,
          p.status,
          p.created_at,
          p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN product_types pt ON p.product_type_id = pt.id
        WHERE p.category_id = ?
        ORDER BY p.id ASC
      `, [categoryId]);
      return rows;
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to get products by category ${categoryId}`, err);
      return [];
    }
  }

  async save(item: Product): Promise<void> {
    try {
      if (item.category_id) {
        await this.db.execute(`
          INSERT OR IGNORE INTO categories (id, code, name, status, created_at, updated_at)
          VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
        `, [item.category_id, `CAT-${item.category_id}`, item.category_name || `Danh mục ${item.category_id}`]);
      }
      if (item.product_type_id && item.category_id) {
        await this.db.execute(`
          INSERT OR IGNORE INTO product_types (id, category_id, code, name, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
        `, [item.product_type_id, item.category_id, `TYPE-${item.product_type_id}`, item.product_type_name || `Loại ${item.product_type_id}`]);
      }

      await this.db.execute(`
        INSERT INTO products (
          id, sku, name, category_id, product_type_id,
          current_cost_price, current_selling_price, current_stock, min_stock_alert, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          sku = excluded.sku,
          name = excluded.name,
          category_id = excluded.category_id,
          product_type_id = excluded.product_type_id,
          current_cost_price = excluded.current_cost_price,
          current_selling_price = excluded.current_selling_price,
          current_stock = excluded.current_stock,
          min_stock_alert = excluded.min_stock_alert,
          status = excluded.status,
          updated_at = datetime('now')
      `, [
        item.id,
        item.sku,
        item.name,
        item.category_id,
        item.product_type_id,
        item.current_cost_price,
        item.current_selling_price,
        item.current_stock,
        item.min_stock_alert,
        item.status
      ]);
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to save product ${item.id}`, err);
      throw err;
    }
  }

  async saveBatch(items: Product[]): Promise<void> {
    if (items.length === 0) return;
    try {
      await this.db.withTransaction(async (tx) => {
        for (const item of items) {
          if (item.category_id) {
            await tx.runAsync(`
              INSERT OR IGNORE INTO categories (id, code, name, status, created_at, updated_at)
              VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
            `, [item.category_id, `CAT-${item.category_id}`, item.category_name || `Danh mục ${item.category_id}`]);
          }

          if (item.product_type_id && item.category_id) {
            await tx.runAsync(`
              INSERT OR IGNORE INTO product_types (id, category_id, code, name, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
            `, [item.product_type_id, item.category_id, `TYPE-${item.product_type_id}`, item.product_type_name || `Loại ${item.product_type_id}`]);
          }

          await tx.runAsync(`
            INSERT INTO products (
              id, sku, name, category_id, product_type_id,
              current_cost_price, current_selling_price, current_stock, min_stock_alert, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              sku = excluded.sku,
              name = excluded.name,
              category_id = excluded.category_id,
              product_type_id = excluded.product_type_id,
              current_cost_price = excluded.current_cost_price,
              current_selling_price = excluded.current_selling_price,
              current_stock = excluded.current_stock,
              min_stock_alert = excluded.min_stock_alert,
              status = excluded.status,
              updated_at = datetime('now')
          `, [
            item.id,
            item.sku,
            item.name,
            item.category_id,
            item.product_type_id,
            item.current_cost_price,
            item.current_selling_price,
            item.current_stock,
            item.min_stock_alert,
            item.status
          ]);
        }
      });
    } catch (err) {
      logger.error('SqliteProductDataSource', 'Failed to save batch products', err);
      throw err;
    }
  }

  async delete(id: number | string): Promise<void> {
    try {
      await this.db.execute('DELETE FROM products WHERE id = ?', [Number(id)]);
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to delete product ${id}`, err);
      throw err;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.db.execute('DELETE FROM products');
    } catch (err) {
      logger.error('SqliteProductDataSource', 'Failed to clear products', err);
      throw err;
    }
  }

  async update(
    id: number,
    input: {
      name?: string;
      sku?: string;
      category_id?: number;
      product_type_id?: number;
      selling_price?: number;
      min_stock_alert?: number;
      status?: import('../../types/domain').ProductStatus;
      description?: string;
    },
    userId = 1
  ): Promise<Product | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const newName = input.name !== undefined ? input.name.trim() : existing.name;
    const newSku = input.sku !== undefined ? input.sku.trim() : existing.sku;
    const newCatId = input.category_id !== undefined ? input.category_id : existing.category_id;
    const newTypeId = input.product_type_id !== undefined ? input.product_type_id : existing.product_type_id;
    const newMinAlert = input.min_stock_alert !== undefined ? input.min_stock_alert : existing.min_stock_alert;
    const newStatus = input.status !== undefined ? input.status : existing.status;
    const newDesc = input.description !== undefined ? input.description : (existing.description || null);

    const priceChanged = input.selling_price !== undefined && Number(input.selling_price) !== existing.current_selling_price;
    const newSellingPrice = priceChanged ? Number(input.selling_price) : existing.current_selling_price;

    await this.db.withTransaction(async (tx) => {
      // NOTE: Strictly never alter current_stock in Product Edit
      await tx.runAsync(`
        UPDATE products
        SET name = ?, sku = ?, category_id = ?, product_type_id = ?,
            current_selling_price = ?, min_stock_alert = ?, status = ?,
            description = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [newName, newSku, newCatId, newTypeId, newSellingPrice, newMinAlert, newStatus, newDesc, id]);

      // If price changed, append to price_history
      if (priceChanged) {
        await tx.runAsync(`
          INSERT INTO price_history (product_id, price, effective_from, note, created_by, created_at)
          VALUES (?, ?, datetime('now'), 'Cập nhật giá bán từ Mobile App', ?, datetime('now'))
        `, [id, newSellingPrice, userId]);
      }
    });

    return await this.getById(id);
  }

  async create(
    input: {
      sku: string;
      name: string;
      category_id: number;
      product_type_id: number;
      selling_price: number;
      cost_price?: number;
      min_stock_alert?: number;
      description?: string;
    },
    userId = 1
  ): Promise<Product> {
    const costPrice = input.cost_price !== undefined ? Number(input.cost_price) : 0;
    const sellingPrice = Number(input.selling_price) || 0;
    const minAlert = input.min_stock_alert !== undefined ? Number(input.min_stock_alert) : 5;

    let createdId = 0;
    await this.db.withTransaction(async (tx) => {
      const res = await tx.runAsync(`
        INSERT INTO products (
          sku, name, category_id, product_type_id,
          current_cost_price, current_selling_price, current_stock,
          min_stock_alert, status, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'ACTIVE', ?, datetime('now'), datetime('now'))
      `, [
        input.sku.trim(),
        input.name.trim(),
        input.category_id,
        input.product_type_id,
        costPrice,
        sellingPrice,
        minAlert,
        input.description || null,
      ]);
      createdId = res.lastInsertRowId;

      // Initial price history
      await tx.runAsync(`
        INSERT INTO price_history (product_id, price, effective_from, note, created_by, created_at)
        VALUES (?, ?, datetime('now'), 'Giá bán niêm yết ban đầu', ?, datetime('now'))
      `, [createdId, sellingPrice, userId]);

      if (costPrice > 0) {
        await tx.runAsync(`
          INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by, created_at)
          VALUES (?, ?, datetime('now'), 'Giá vốn ban đầu', ?, datetime('now'))
        `, [createdId, costPrice, userId]);
      }
    });

    const created = await this.getById(createdId);
    if (!created) {
      throw new Error('Không thể tải thông tin sản phẩm vừa tạo.');
    }
    return created;
  }

  async getPriceHistory(productId: number): Promise<any[]> {
    try {
      return await this.db.query(`
        SELECT 
          ph.id, ph.product_id, ph.price, ph.effective_from, ph.note, ph.created_at,
          u.username as creator_name
        FROM price_history ph
        LEFT JOIN users u ON u.id = ph.created_by
        WHERE ph.product_id = ?
        ORDER BY ph.effective_from DESC, ph.id DESC
      `, [productId]);
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to get price history for ${productId}`, err);
      return [];
    }
  }

  async getCostHistory(productId: number): Promise<any[]> {
    try {
      return await this.db.query(`
        SELECT 
          ch.id, ch.product_id, ch.cost_price, ch.effective_from, ch.note, ch.created_at,
          u.username as creator_name
        FROM cost_price_history ch
        LEFT JOIN users u ON u.id = ch.created_by
        WHERE ch.product_id = ?
        ORDER BY ch.effective_from DESC, ch.id DESC
      `, [productId]);
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to get cost history for ${productId}`, err);
      return [];
    }
  }

  async getStockMovements(productId: number): Promise<any[]> {
    try {
      return await this.db.query(`
        SELECT 
          m.id, m.client_movement_id, m.product_id, m.movement_type,
          m.quantity_change, m.balance_after, m.movement_date,
          m.reference_type, m.reference_id, m.sync_status, m.note,
          m.created_at, u.username as creator_name
        FROM stock_movements m
        LEFT JOIN users u ON u.id = m.created_by
        WHERE m.product_id = ?
        ORDER BY m.movement_date DESC, m.id DESC
      `, [productId]);
    } catch (err) {
      logger.error('SqliteProductDataSource', `Failed to get stock movements for ${productId}`, err);
      return [];
    }
  }
}

export default SqliteProductDataSource;

