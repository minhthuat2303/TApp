import { Product } from '../types/domain';
import { IRepository, ILocalDataSource, IRemoteDataSource } from './base';
import { SqliteProductDataSource } from './sqlite/SqliteProductDataSource';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import logger from '../utils/logger';

// 1. Remote API Data Source
class ProductRemoteDataSource implements IRemoteDataSource<Product> {
  async getAll(params?: Record<string, unknown>): Promise<Product[]> {
    const res = await apiClient.get<Product[]>(Endpoints.PRODUCTS, { params: params as any });
    return res.data || [];
  }

  async getById(id: number | string): Promise<Product | null> {
    const res = await apiClient.get<Product>(Endpoints.PRODUCT_DETAIL(id));
    return res.data || null;
  }
}

// 2. Product Repository (Offline-First Facade)
export class ProductRepository implements IRepository<Product> {
  private localSource: SqliteProductDataSource;
  private remoteSource: IRemoteDataSource<Product>;

  constructor(
    local?: SqliteProductDataSource,
    remote?: IRemoteDataSource<Product>
  ) {
    this.localSource = local || new SqliteProductDataSource();
    this.remoteSource = remote || new ProductRemoteDataSource();
  }

  setLocalDataSource(local: SqliteProductDataSource): void {
    this.localSource = local;
  }

  async getAll(forceRemote = false): Promise<Product[]> {
    // 1. Try local SQLite first if not forced remote
    if (!forceRemote) {
      const localData = await this.localSource.getAll();
      if (localData.length > 0) {
        logger.debug('ProductRepository', `SQLite hit: loaded ${localData.length} products locally`);
        return localData;
      }
    }

    // 2. Fetch from remote API and refresh local SQLite cache
    try {
      logger.debug('ProductRepository', 'Fetching products from remote API...');
      const remoteData = await this.remoteSource.getAll({ limit: 100 });
      if (remoteData.length > 0) {
        await this.localSource.saveBatch(remoteData);
      }
      return remoteData;
    } catch (err) {
      logger.warn('ProductRepository', 'Failed to fetch remote products, falling back to local SQLite', err);
      return await this.localSource.getAll();
    }
  }

  async getById(id: number | string, forceRemote = false): Promise<Product | null> {
    if (!forceRemote) {
      const localItem = await this.localSource.getById(id);
      if (localItem) return localItem;
    }

    try {
      const remoteItem = await this.remoteSource.getById(id);
      if (remoteItem) {
        await this.localSource.save(remoteItem);
      }
      return remoteItem;
    } catch (err) {
      logger.warn('ProductRepository', `Failed to fetch remote product ${id}`, err);
      return await this.localSource.getById(id);
    }
  }

  async search(keyword: string): Promise<Product[]> {
    if (!keyword.trim()) {
      return await this.getAll();
    }
    return await this.localSource.search(keyword);
  }

  async getByBarcode(barcode: string): Promise<Product | null> {
    if (!barcode.trim()) return null;
    return await this.localSource.getByBarcode(barcode);
  }

  async getByCategory(categoryId: number): Promise<Product[]> {
    return await this.localSource.getByCategory(categoryId);
  }

  async saveLocal(product: Product): Promise<void> {
    await this.localSource.save(product);
  }

  async updateProduct(
    id: number,
    input: {
      name?: string;
      sku?: string;
      category_id?: number;
      product_type_id?: number;
      selling_price?: number;
      min_stock_alert?: number;
      status?: import('../types/domain').ProductStatus;
      description?: string;
    },
    userId = 1
  ): Promise<Product | null> {
    const updated = await this.localSource.update(id, input, userId);
    if (!updated) return null;

    const { outboxService } = await import('../services/OutboxService');
    await outboxService.enqueue({
      clientMutationId: `prod-update-${id}-${Date.now()}`,
      entityType: 'PRODUCT',
      entityId: String(id),
      action: 'UPDATE',
      payload: {
        id,
        name: updated.name,
        sku: updated.sku,
        category_id: updated.category_id,
        product_type_id: updated.product_type_id,
        current_selling_price: updated.current_selling_price,
        min_stock_alert: updated.min_stock_alert,
        status: updated.status,
        description: updated.description,
      },
      userId,
    });

    return updated;
  }

  async createProduct(
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
    const created = await this.localSource.create(input, userId);

    const { outboxService } = await import('../services/OutboxService');
    await outboxService.enqueue({
      clientMutationId: `prod-create-${created.id}-${Date.now()}`,
      entityType: 'PRODUCT',
      entityId: String(created.id),
      action: 'CREATE',
      payload: {
        id: created.id,
        sku: created.sku,
        name: created.name,
        category_id: created.category_id,
        product_type_id: created.product_type_id,
        current_selling_price: created.current_selling_price,
        current_cost_price: created.current_cost_price,
        min_stock_alert: created.min_stock_alert,
        status: created.status,
        description: created.description,
      },
      userId,
    });

    return created;
  }

  async getPriceHistory(productId: number): Promise<any[]> {
    return await this.localSource.getPriceHistory(productId);
  }

  async getCostHistory(productId: number): Promise<any[]> {
    return await this.localSource.getCostHistory(productId);
  }

  async getStockMovements(productId: number): Promise<any[]> {
    return await this.localSource.getStockMovements(productId);
  }
}

export const productRepository = new ProductRepository();
export default productRepository;

