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

    // 1. Instant Cache Return (0ms latency for smooth UX)
    if (!forceRemote && this.memoryCache && (now - this.memoryCache.timestamp < this.CACHE_TTL_MS)) {
      return this.memoryCache.data;
    }

    // 2. Direct Online Fetch from Supabase Cloud API
    try {
      const remoteData = await this.remoteSource.getAll();
      if (remoteData && remoteData.length > 0) {
        this.memoryCache = { data: remoteData, timestamp: now };
        // Asynchronously persist to SQLite cache without blocking caller
        this.localSource.saveBatch(remoteData).catch((err) => {
          logger.warn('CategoryRepository', 'Failed to update local SQLite category cache', err);
        });
        return remoteData;
      }
    } catch (err) {
      logger.warn('CategoryRepository', 'Failed to fetch remote categories from Supabase, falling back to local SQLite', err);
    }

    // 3. Fallback to Local SQLite (Offline Mode)
    const localData = await this.localSource.getAll();
    if (localData.length > 0) {
      this.memoryCache = { data: localData, timestamp: now };
    }
    return localData;
  }

  async getById(id: number | string, forceRemote = false): Promise<Category | null> {
    if (!forceRemote && this.memoryCache) {
      const found = this.memoryCache.data.find((c) => c.id === Number(id));
      if (found) return found;
    }

    try {
      const remote = await this.remoteSource.getById(id);
      if (remote) {
        this.localSource.save(remote).catch(() => {});
        return remote;
      }
    } catch (err) {
      logger.warn('CategoryRepository', `Failed to fetch remote category ${id}`, err);
    }

    return await this.localSource.getById(id);
  }

  async getTypesByCategory(categoryId: number): Promise<ProductType[]> {
    return await this.localSource.getTypesByCategory(categoryId);
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
    userId = 1
  ): Promise<Category> {
    this.clearMemoryCache();

    // 1. Try Direct Online Creation on Supabase Server
    try {
      const res = await apiClient.post<Category>(Endpoints.CATEGORIES, {
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
      });

      if (res.data) {
        const createdRemote = res.data;
        await this.localSource.save(createdRemote);
        return createdRemote;
      }
    } catch (err) {
      logger.warn('CategoryRepository', 'Direct server category creation failed, enqueuing to Outbox for offline safety', err);
    }

    // 2. Offline Fallback: Local SQLite + Outbox
    const created = await this.localSource.create(input);
    const { outboxService } = await import('../services/OutboxService');
    await outboxService.enqueue({
      clientMutationId: `cat-create-${created.id}-${Date.now()}`,
      entityType: 'CATEGORY',
      entityId: String(created.id),
      action: 'CREATE',
      payload: {
        id: created.id,
        code: created.code,
        name: created.name,
        description: created.description,
        status: created.status,
      },
      userId,
    });

    return created;
  }

  async updateCategory(
    id: number,
    input: { code?: string; name?: string; description?: string; status?: 'ACTIVE' | 'INACTIVE' },
    userId = 1
  ): Promise<Category | null> {
    this.clearMemoryCache();

    // 1. Try Direct Online Update on Supabase Server
    try {
      const res = await apiClient.put<Category>(Endpoints.CATEGORY_DETAIL(id), input);
      if (res.data) {
        const updatedRemote = res.data;
        await this.localSource.save(updatedRemote);
        return updatedRemote;
      }
    } catch (err) {
      logger.warn('CategoryRepository', `Direct server category update failed for ${id}, enqueuing to Outbox`, err);
    }

    // 2. Offline Fallback: Local SQLite + Outbox
    const updated = await this.localSource.update(id, input);
    if (!updated) return null;

    const { outboxService } = await import('../services/OutboxService');
    await outboxService.enqueue({
      clientMutationId: `cat-update-${id}-${Date.now()}`,
      entityType: 'CATEGORY',
      entityId: String(id),
      action: 'UPDATE',
      payload: {
        id,
        code: updated.code,
        name: updated.name,
        description: updated.description,
        status: updated.status,
      },
      userId,
    });

    return updated;
  }

  async deleteCategory(id: number, userId = 1): Promise<void> {
    this.clearMemoryCache();

    // 1. Try Direct Online Delete on Supabase Server
    try {
      await apiClient.delete(Endpoints.CATEGORY_DETAIL(id));
    } catch (err) {
      logger.warn('CategoryRepository', `Direct server category delete failed for ${id}, enqueuing to Outbox`, err);
    }

    // 2. Delete in Local SQLite
    await this.localSource.delete(id);

    // 3. Fallback Outbox Queue
    const { outboxService } = await import('../services/OutboxService');
    await outboxService.enqueue({
      clientMutationId: `cat-delete-${id}-${Date.now()}`,
      entityType: 'CATEGORY',
      entityId: String(id),
      action: 'DELETE',
      payload: { id },
      userId,
    });
  }

  async deactivateCategory(id: number, userId = 1): Promise<Category | null> {
    return await this.updateCategory(id, { status: 'INACTIVE' }, userId);
  }
}

export const categoryRepository = new CategoryRepository();
export default categoryRepository;

