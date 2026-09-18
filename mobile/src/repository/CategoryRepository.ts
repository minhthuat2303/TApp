import { Category, ProductType } from '../types/domain';
import { IRepository, IRemoteDataSource } from './base';
import { SqliteCategoryDataSource } from './sqlite/SqliteCategoryDataSource';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import logger from '../utils/logger';

class CategoryRemoteDataSource implements IRemoteDataSource<Category> {
  async getAll(): Promise<Category[]> {
    const res = await apiClient.get<Category[]>(Endpoints.CATEGORIES);
    return res.data || [];
  }

  async getById(id: number | string): Promise<Category | null> {
    const list = await this.getAll();
    return list.find((c) => c.id === Number(id)) || null;
  }
}

export class CategoryRepository implements IRepository<Category> {
  private localSource: SqliteCategoryDataSource;
  private remoteSource: IRemoteDataSource<Category>;
  private memoryCache: { data: Category[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 30000; // 30s cache TTL for instant UI response

  constructor(local?: SqliteCategoryDataSource, remote?: IRemoteDataSource<Category>) {
    this.localSource = local || new SqliteCategoryDataSource();
    this.remoteSource = remote || new CategoryRemoteDataSource();
  }

  setLocalDataSource(local: SqliteCategoryDataSource): void {
    this.localSource = local;
  }

  clearMemoryCache(): void {
    this.memoryCache = null;
  }

  async getAll(forceRemote = false): Promise<Category[]> {
    const now = Date.now();

    // 1. Instant RAM Cache Return
    if (!forceRemote && this.memoryCache && (now - this.memoryCache.timestamp < this.CACHE_TTL_MS)) {
      return this.memoryCache.data;
    }

    // 2. Direct Online Fetch from Supabase Cloud API
    try {
      const remoteData = await this.remoteSource.getAll();
      if (remoteData) {
        this.memoryCache = { data: remoteData, timestamp: now };
        return remoteData;
      }
    } catch (err) {
      logger.error('CategoryRepository', 'Failed to fetch categories from Supabase Cloud API', err);
      if (this.memoryCache) return this.memoryCache.data;
      throw err;
    }

    return this.memoryCache?.data || [];
  }

  async getById(id: number | string, forceRemote = false): Promise<Category | null> {
    if (!forceRemote && this.memoryCache) {
      const found = this.memoryCache.data.find((c) => c.id === Number(id));
      if (found) return found;
    }

    try {
      const remote = await this.remoteSource.getById(id);
      if (remote) return remote;
    } catch (err) {
      logger.error('CategoryRepository', `Failed to fetch remote category ${id}`, err);
    }

    return null;
  }

  async getTypesByCategory(categoryId: number): Promise<ProductType[]> {
    try {
      const res = await apiClient.get<ProductType[]>(Endpoints.PRODUCT_TYPES, {
        params: { categoryId }
      });
      return res.data || [];
    } catch (err) {
      logger.warn('CategoryRepository', 'Failed to fetch product types from Cloud API', err);
      return [];
    }
  }

  async search(query: string): Promise<Category[]> {
    const all = await this.getAll();
    const trimmed = query.trim();
    if (!trimmed) return all;

    const { matchesVietnameseSearch } = await import('../utils/vietnameseUtils');
    return all.filter((c) => 
      matchesVietnameseSearch(c.name, trimmed) ||
      matchesVietnameseSearch(c.code, trimmed) ||
      (c.description ? matchesVietnameseSearch(c.description, trimmed) : false)
    );
  }

  async createCategory(
    input: { code: string; name: string; description?: string },
    _userId = 1
  ): Promise<Category> {
    this.clearMemoryCache();

    const res = await apiClient.post<Category>(Endpoints.CATEGORIES, {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
    });

    if (res.data) {
      return res.data;
    }
    throw new Error('Không nhận được phản hồi từ máy chủ Supabase.');
  }

  async updateCategory(
    id: number,
    input: { code?: string; name?: string; description?: string; status?: 'ACTIVE' | 'INACTIVE' },
    _userId = 1
  ): Promise<Category | null> {
    this.clearMemoryCache();

    const res = await apiClient.put<Category>(Endpoints.CATEGORY_DETAIL(id), input);
    return res.data || null;
  }

  async deleteCategory(id: number, _userId = 1): Promise<void> {
    this.clearMemoryCache();
    await apiClient.delete(Endpoints.CATEGORY_DETAIL(id));
  }

  async deactivateCategory(id: number, userId = 1): Promise<Category | null> {
    return await this.updateCategory(id, { status: 'INACTIVE' }, userId);
  }
}

export const categoryRepository = new CategoryRepository();
export default categoryRepository;

