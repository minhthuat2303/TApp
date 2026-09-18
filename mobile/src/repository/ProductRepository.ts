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

// 2. Product Repository (Direct Online Mode with RAM & SQLite Caching)
export class ProductRepository implements IRepository<Product> {
  private localSource: SqliteProductDataSource;
  private remoteSource: IRemoteDataSource<Product>;
  private memoryCache: { data: Product[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 20000; // 20s cache TTL for instant UI response

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

  clearMemoryCache(): void {
    this.memoryCache = null;
  }

  async getAll(forceRemote = false): Promise<Product[]> {
    const now = Date.now();

    // 1. Instant Cache Return (0ms latency for smooth UX)
    if (!forceRemote && this.memoryCache && (now - this.memoryCache.timestamp < this.CACHE_TTL_MS)) {
      return this.memoryCache.data;
    }

    // 2. Direct Online Fetch from Supabase Cloud API
    try {
      logger.debug('ProductRepository', 'Fetching latest products from Supabase Cloud API...');
      const remoteData = await this.remoteSource.getAll({ limit: 500 });
      if (remoteData && remoteData.length > 0) {
        this.memoryCache = { data: remoteData, timestamp: now };
        // Asynchronously persist to SQLite cache without blocking caller
        this.localSource.saveBatch(remoteData).catch((err) => {
          logger.warn('ProductRepository', 'Failed to update local SQLite product cache', err);
        });
        return remoteData;
      }
    } catch (err) {
      logger.warn('ProductRepository', 'Failed to fetch remote products from Supabase, falling back to local SQLite', err);
    }

    // 3. Fallback to Local SQLite (Offline Mode)
    const localData = await this.localSource.getAll();
    if (localData.length > 0) {
      this.memoryCache = { data: localData, timestamp: now };
    }
    return localData;
  }

  async getById(id: number | string, forceRemote = false): Promise<Product | null> {
    if (!forceRemote && this.memoryCache) {
      const found = this.memoryCache.data.find((p) => p.id === Number(id));
      if (found) return found;
    }

    try {
      const remoteItem = await this.remoteSource.getById(id);
      if (remoteItem) {
        this.localSource.save(remoteItem).catch(() => {});
        return remoteItem;
      }
    } catch (err) {
      logger.warn('ProductRepository', `Failed to fetch remote product ${id}`, err);
    }

    return await this.localSource.getById(id);
  }

  async search(keyword: string): Promise<Product[]> {
    if (!keyword.trim()) {
      return await this.getAll();
    }
    // Search in RAM cache if available for instant sub-millisecond search
    if (this.memoryCache && this.memoryCache.data.length > 0) {
      const trimmed = keyword.trim().toLowerCase();
      const { matchesVietnameseSearch } = await import('../utils/vietnameseUtils');
      return this.memoryCache.data.filter(
        (p) =>
          matchesVietnameseSearch(p.name, trimmed) ||
          matchesVietnameseSearch(p.sku, trimmed)
      );
    }
    return await this.localSource.search(keyword);
  }

  async getByBarcode(barcode: string): Promise<Product | null> {
    if (!barcode.trim()) return null;
    if (this.memoryCache && this.memoryCache.data.length > 0) {
      const trimmed = barcode.trim().toLowerCase();
      const found = this.memoryCache.data.find(
        (p) => p.sku.toLowerCase() === trimmed || String(p.id) === trimmed
      );
      if (found) return found;
    }
    return await this.localSource.getByBarcode(barcode);
  }

  async getByCategory(categoryId: number): Promise<Product[]> {
    if (this.memoryCache && this.memoryCache.data.length > 0) {
      return this.memoryCache.data.filter((p) => p.category_id === categoryId);
    }
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
    this.clearMemoryCache();

    // 1. Try Direct Online Update on Supabase Server
    try {
      const res = await apiClient.put<Product>(Endpoints.PRODUCT_DETAIL(id), {
        ...input,
        selling_price: input.selling_price,
      });
      if (res.data) {
        const updatedRemote = res.data;
        await this.localSource.save(updatedRemote);
        return updatedRemote;
      }
    } catch (err) {
      logger.warn('ProductRepository', `Direct server product update failed for ${id}, enqueuing to Outbox`, err);
    }

    // 2. Offline Fallback: Local SQLite + Outbox
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
    this.clearMemoryCache();

    // 1. Try Direct Online Creation on Supabase Server
    try {
      const res = await apiClient.post<Product>(Endpoints.PRODUCTS, {
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        category_id: input.category_id,
        product_type_id: input.product_type_id,
        current_selling_price: input.selling_price,
        current_cost_price: input.cost_price || 0,
        min_stock_alert: input.min_stock_alert || 5,
        description: input.description?.trim() || null,
      });

      if (res.data) {
        const createdRemote = res.data;
        await this.localSource.save(createdRemote);
        return createdRemote;
      }
    } catch (err) {
      logger.warn('ProductRepository', 'Direct server product creation failed, enqueuing to Outbox', err);
    }

    // 2. Offline Fallback: Local SQLite + Outbox
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

