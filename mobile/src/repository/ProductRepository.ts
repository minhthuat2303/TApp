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

    // 1. Instant RAM Cache Return (0ms latency for smooth UX)
    if (!forceRemote && this.memoryCache && (now - this.memoryCache.timestamp < this.CACHE_TTL_MS)) {
      return this.memoryCache.data;
    }

    // 2. Direct Online Fetch from Supabase Cloud API
    try {
      logger.debug('ProductRepository', 'Fetching latest products from Supabase Cloud API...');
      const remoteData = await this.remoteSource.getAll({ limit: 500 });
      if (remoteData) {
        this.memoryCache = { data: remoteData, timestamp: now };
        return remoteData;
      }
    } catch (err) {
      logger.error('ProductRepository', 'Failed to fetch remote products from Supabase Cloud', err);
      if (this.memoryCache) return this.memoryCache.data;
      throw err;
    }

    return this.memoryCache?.data || [];
  }

  async getById(id: number | string, forceRemote = false): Promise<Product | null> {
    if (!forceRemote && this.memoryCache) {
      const found = this.memoryCache.data.find((p) => p.id === Number(id));
      if (found) return found;
    }

    try {
      const remoteItem = await this.remoteSource.getById(id);
      if (remoteItem) return remoteItem;
    } catch (err) {
      logger.warn('ProductRepository', `Failed to fetch remote product ${id}`, err);
    }

    const all = await this.getAll();
    return all.find((p) => p.id === Number(id)) || null;
  }

  async search(keyword: string): Promise<Product[]> {
    const all = await this.getAll();
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return all;

    const { matchesVietnameseSearch } = await import('../utils/vietnameseUtils');
    return all.filter(
      (p) =>
        matchesVietnameseSearch(p.name, trimmed) ||
        matchesVietnameseSearch(p.sku, trimmed)
    );
  }

  async getByBarcode(barcode: string): Promise<Product | null> {
    if (!barcode.trim()) return null;
    const all = await this.getAll();
    const trimmed = barcode.trim().toLowerCase();
    return all.find(
      (p) => p.sku.toLowerCase() === trimmed || String(p.id) === trimmed
    ) || null;
  }

  async getByCategory(categoryId: number): Promise<Product[]> {
    const all = await this.getAll();
    return all.filter((p) => p.category_id === categoryId);
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
    _userId = 1
  ): Promise<Product | null> {
    this.clearMemoryCache();

    const res = await apiClient.put<Product>(Endpoints.PRODUCT_DETAIL(id), {
      ...input,
      selling_price: input.selling_price,
    });
    return res.data || null;
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
    _userId = 1
  ): Promise<Product> {
    this.clearMemoryCache();

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
      return res.data;
    }
    throw new Error('Không nhận được phản hồi từ máy chủ Supabase.');
  }

  async deleteProduct(id: number): Promise<void> {
    this.clearMemoryCache();
    await apiClient.delete(Endpoints.PRODUCT_DETAIL(id));
  }

  async getPriceHistory(productId: number): Promise<any[]> {
    try {
      const res = await apiClient.get<any[]>(Endpoints.PRODUCT_PRICE_HISTORY(productId));
      return res.data || [];
    } catch {
      return [];
    }
  }

  async getCostHistory(productId: number): Promise<any[]> {
    try {
      const res = await apiClient.get<any[]>(Endpoints.PRODUCT_LOTS(productId));
      return res.data || [];
    } catch {
      return [];
    }
  }

  async getStockMovements(productId: number): Promise<any[]> {
    try {
      const res = await apiClient.get<any[]>(Endpoints.INVENTORY_MOVEMENTS, {
        params: { productId }
      });
      return res.data || [];
    } catch {
      return [];
    }
  }
}

export const productRepository = new ProductRepository();
export default productRepository;

