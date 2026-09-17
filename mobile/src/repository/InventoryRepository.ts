import { StockMovement, InventoryLot } from '../types/domain';
import { StockStatus, ImportRecord } from '../database/types';
import { IRepository, IRemoteDataSource } from './base';
import { SqliteInventoryDataSource } from './sqlite/SqliteInventoryDataSource';
import offlineInventoryService, { OfflineInventoryService } from '../services/OfflineInventoryService';
import { CreateImportInput, ImportResult, StockAdjustmentInput, StockAdjustmentResult, PriceHistoryRecord, CostHistoryRecord } from '../services/types';
import databaseService, { DatabaseService } from '../database/DatabaseService';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import logger from '../utils/logger';

class InventoryRemoteDataSource implements IRemoteDataSource<StockMovement> {
  async getAll(params?: Record<string, unknown>): Promise<StockMovement[]> {
    const res = await apiClient.get<StockMovement[]>(Endpoints.INVENTORY_MOVEMENTS, { params: params as any });
    return res.data || [];
  }

  async getById(id: number | string): Promise<StockMovement | null> {
    const list = await this.getAll({ limit: 50 });
    return list.find((m) => m.id === Number(id)) || null;
  }
}

export class InventoryRepository implements IRepository<StockMovement> {
  private localSource: SqliteInventoryDataSource;
  private remoteSource: IRemoteDataSource<StockMovement>;
  private inventoryService: OfflineInventoryService;
  private db: DatabaseService;

  constructor(
    local?: SqliteInventoryDataSource,
    remote?: IRemoteDataSource<StockMovement>,
    inventoryService?: OfflineInventoryService,
    db?: DatabaseService
  ) {
    this.localSource = local || new SqliteInventoryDataSource();
    this.remoteSource = remote || new InventoryRemoteDataSource();
    this.inventoryService = inventoryService || offlineInventoryService;
    this.db = db || databaseService;
  }

  setLocalDataSource(local: SqliteInventoryDataSource): void {
    this.localSource = local;
  }

  async getAll(forceRemote = false): Promise<StockMovement[]> {
    if (!forceRemote) {
      const local = await this.localSource.getStockMovements(undefined, 50);
      if (local.length > 0) return local;
    }

    try {
      const remote = await this.remoteSource.getAll({ limit: 30 });
      return remote;
    } catch (err) {
      logger.warn('InventoryRepository', 'Failed to fetch inventory movements, returning local SQLite', err);
      return await this.localSource.getStockMovements(undefined, 50);
    }
  }

  async getById(id: number | string): Promise<StockMovement | null> {
    const movements = await this.localSource.getStockMovements(undefined, 100);
    const local = movements.find((m) => m.id === Number(id));
    if (local) return local;
    return await this.remoteSource.getById(id);
  }

  async getStockStatus(productId: number): Promise<StockStatus> {
    return await this.localSource.getStockStatus(productId);
  }

  async getAllStockStatuses(): Promise<StockStatus[]> {
    return await this.localSource.getAllStockStatuses();
  }

  async getInventoryLots(productId?: number): Promise<InventoryLot[]> {
    return await this.localSource.getInventoryLots(productId);
  }

  async getStockMovements(productId?: number, limit = 50): Promise<StockMovement[]> {
    return await this.localSource.getStockMovements(productId, limit);
  }

  // Offline stock receipt (Nhập kho)
  async createStockReceipt(input: CreateImportInput): Promise<ImportResult> {
    return await this.inventoryService.createStockReceipt(input);
  }

  // Offline stock adjustment (Điều chỉnh kho)
  async adjustStock(input: StockAdjustmentInput): Promise<StockAdjustmentResult> {
    return await this.inventoryService.adjustStock(input);
  }

  async getPriceHistory(productId: number): Promise<PriceHistoryRecord[]> {
    return await this.localSource.getPriceHistory(productId);
  }

  async getCostHistory(productId: number): Promise<CostHistoryRecord[]> {
    return await this.localSource.getCostHistory(productId);
  }

  async getInventorySummary(): Promise<{ totalProducts: number; totalStock: number; totalValuation: number; lowStockCount: number }> {
    return await this.localSource.getInventorySummary();
  }

  async getAllImports(limit = 50, offset = 0): Promise<ImportRecord[]> {
    try {
      return await this.db.query<ImportRecord>(`
        SELECT * FROM imports ORDER BY id DESC LIMIT ? OFFSET ?
      `, [limit, offset]);
    } catch (err) {
      logger.error('InventoryRepository', 'Failed to get imports', err);
      return [];
    }
  }
}

export const inventoryRepository = new InventoryRepository();
export default inventoryRepository;
