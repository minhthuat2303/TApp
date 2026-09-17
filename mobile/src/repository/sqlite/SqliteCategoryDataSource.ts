import { Category, ProductType } from '../../types/domain';
import { ILocalDataSource } from '../base';
import databaseService, { DatabaseService } from '../../database/DatabaseService';
import logger from '../../utils/logger';

export class SqliteCategoryDataSource implements ILocalDataSource<Category> {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  async getAll(): Promise<Category[]> {
    try {
      const rows = await this.db.query<Category>(`
        SELECT 
          c.id,
          c.code,
          c.name,
          c.description,
          c.status,
          c.created_at,
          c.updated_at,
          COUNT(p.id) as product_count
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id
        GROUP BY c.id
        ORDER BY c.id ASC
      `);
      return rows;
    } catch (err) {
      logger.error('SqliteCategoryDataSource', 'Failed to get all categories', err);
      return [];
    }
  }

  async getById(id: number | string): Promise<Category | null> {
    try {
      const row = await this.db.queryOne<Category>(`
        SELECT 
          c.id,
          c.code,
          c.name,
          c.description,
          c.status,
          c.created_at,
          c.updated_at,
          COUNT(p.id) as product_count
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id
        WHERE c.id = ?
        GROUP BY c.id
        LIMIT 1
      `, [Number(id)]);
      return row;
    } catch (err) {
      logger.error('SqliteCategoryDataSource', `Failed to get category ${id}`, err);
      return null;
    }
  }

  async getTypesByCategory(categoryId: number): Promise<ProductType[]> {
    try {
      const rows = await this.db.query<ProductType>(`
        SELECT 
          pt.id,
          pt.category_id,
          c.name as category_name,
          pt.code,
          pt.name,
          pt.description,
          pt.status,
          pt.created_at,
          pt.updated_at
        FROM product_types pt
        LEFT JOIN categories c ON pt.category_id = c.id
        WHERE pt.category_id = ?
        ORDER BY pt.id ASC
      `, [categoryId]);
      return rows;
    } catch (err) {
      logger.error('SqliteCategoryDataSource', `Failed to get types for category ${categoryId}`, err);
      return [];
    }
  }

  async save(item: Category): Promise<void> {
    try {
      await this.db.execute(`
        INSERT INTO categories (id, code, name, description, status, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code,
          name = excluded.name,
          description = excluded.description,
          status = excluded.status,
          updated_at = datetime('now')
      `, [item.id, item.code, item.name, item.description || null, item.status]);
    } catch (err) {
      logger.error('SqliteCategoryDataSource', `Failed to save category ${item.id}`, err);
      throw err;
    }
  }

  async saveBatch(items: Category[]): Promise<void> {
    if (items.length === 0) return;
    try {
      await this.db.withTransaction(async (tx) => {
        for (const item of items) {
          await tx.runAsync(`
            INSERT INTO categories (id, code, name, description, status, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              code = excluded.code,
              name = excluded.name,
              description = excluded.description,
              status = excluded.status,
              updated_at = datetime('now')
          `, [item.id, item.code, item.name, item.description || null, item.status]);
        }
      });
    } catch (err) {
      logger.error('SqliteCategoryDataSource', 'Failed to save batch categories', err);
      throw err;
    }
  }

  async delete(id: number | string): Promise<void> {
    try {
      await this.db.execute('DELETE FROM categories WHERE id = ?', [Number(id)]);
    } catch (err) {
      logger.error('SqliteCategoryDataSource', `Failed to delete category ${id}`, err);
      throw err;
    }
  }

  async create(input: { code: string; name: string; description?: string }): Promise<Category> {
    const res = await this.db.run(`
      INSERT INTO categories (code, name, description, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `, [input.code, input.name, input.description || null]);

    const created = await this.getById(res.lastInsertRowId);
    if (!created) {
      throw new Error('Lỗi tạo danh mục mới.');
    }
    return created;
  }

  async update(id: number, input: { code?: string; name?: string; description?: string; status?: 'ACTIVE' | 'INACTIVE' }): Promise<Category | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const newCode = input.code !== undefined ? input.code : existing.code;
    const newName = input.name !== undefined ? input.name : existing.name;
    const newDesc = input.description !== undefined ? input.description : existing.description;
    const newStatus = input.status !== undefined ? input.status : existing.status;

    await this.db.run(`
      UPDATE categories
      SET code = ?, name = ?, description = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [newCode, newName, newDesc, newStatus, id]);

    return await this.getById(id);
  }

  async clear(): Promise<void> {
    try {
      await this.db.execute('DELETE FROM categories');
    } catch (err) {
      logger.error('SqliteCategoryDataSource', 'Failed to clear categories', err);
      throw err;
    }
  }
}

export default SqliteCategoryDataSource;
