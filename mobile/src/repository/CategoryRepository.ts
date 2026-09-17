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

  constructor(local?: SqliteCategoryDataSource, remote?: IRemoteDataSource<Category>) {
    this.localSource = local || new SqliteCategoryDataSource();
    this.remoteSource = remote || new CategoryRemoteDataSource();
  }

  setLocalDataSource(local: SqliteCategoryDataSource): void {
    this.localSource = local;
  }

  async getAll(forceRemote = false): Promise<Category[]> {
    if (!forceRemote) {
      const localData = await this.localSource.getAll();
      if (localData.length > 0) return localData;
    }

    try {
      const remoteData = await this.remoteSource.getAll();
      if (remoteData.length > 0) {
        await this.localSource.saveBatch(remoteData);
      }
      return remoteData;
    } catch (err) {
      logger.warn('CategoryRepository', 'Failed to fetch categories, falling back to local SQLite', err);
      return await this.localSource.getAll();
    }
  }

  async getById(id: number | string, forceRemote = false): Promise<Category | null> {
    if (!forceRemote) {
      const local = await this.localSource.getById(id);
      if (local) return local;
    }

    try {
      const remote = await this.remoteSource.getById(id);
      if (remote) await this.localSource.save(remote);
      return remote;
    } catch (err) {
      return await this.localSource.getById(id);
    }
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
    await this.localSource.delete(id);

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

