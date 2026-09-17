import { SalesRecord } from '../types/domain';
import { SalesOrder } from '../database/types';
import { IRepository, IRemoteDataSource } from './base';
import { SqliteSaleDataSource, CreateSaleInput, TodaySalesSummary } from './sqlite/SqliteSaleDataSource';
import offlineSaleService, { OfflineSaleService } from '../services/OfflineSaleService';
import { CreateSaleOrderInput, SaleOrderResult, CancelSaleOrderInput, CancelSaleOrderResult } from '../services/types';
import databaseService, { DatabaseService } from '../database/DatabaseService';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import logger from '../utils/logger';

class SaleRemoteDataSource implements IRemoteDataSource<SalesRecord> {
  async getAll(params?: Record<string, unknown>): Promise<SalesRecord[]> {
    const res = await apiClient.get<SalesRecord[]>(Endpoints.SALES, { params: params as any });
    return res.data || [];
  }

  async getById(id: number | string): Promise<SalesRecord | null> {
    const list = await this.getAll({ limit: 50 });
    return list.find((s) => s.id === Number(id)) || null;
  }
}

export class SaleRepository implements IRepository<SalesRecord> {
  private localSource: SqliteSaleDataSource;
  private remoteSource: IRemoteDataSource<SalesRecord>;
  private saleService: OfflineSaleService;
  private db: DatabaseService;

  constructor(
    local?: SqliteSaleDataSource,
    remote?: IRemoteDataSource<SalesRecord>,
    saleService?: OfflineSaleService,
    db?: DatabaseService
  ) {
    this.localSource = local || new SqliteSaleDataSource();
    this.remoteSource = remote || new SaleRemoteDataSource();
    this.saleService = saleService || offlineSaleService;
    this.db = db || databaseService;
  }

  setLocalDataSource(local: SqliteSaleDataSource): void {
    this.localSource = local;
  }

  async getAll(forceRemote = false, createdBy?: number): Promise<SalesRecord[]> {
    if (!forceRemote) {
      const local = await this.localSource.getAllSales({ limit: 50, createdBy });
      if (local.length > 0) return local;
    }

    try {
      const remote = await this.remoteSource.getAll({ limit: 30 });
      if (createdBy !== undefined) {
        return remote.filter((s) => s.created_by === createdBy);
      }
      return remote;
    } catch (err) {
      logger.warn('SaleRepository', 'Failed to fetch remote sales, returning local SQLite', err);
      return await this.localSource.getAllSales({ limit: 50, createdBy });
    }
  }

  async getById(id: number | string): Promise<SalesRecord | null> {
    const all = await this.localSource.getAllSales({ limit: 200 });
    const local = all.find((s) => s.id === Number(id) || s.client_transaction_id === String(id));
    if (local) return local;
    return await this.remoteSource.getById(id);
  }

  async createSale(input: CreateSaleInput): Promise<SalesRecord> {
    return await this.localSource.createLocalSale(input);
  }

  // Multi-item cart checkout via OfflineSaleService
  async createMultiItemSale(input: CreateSaleOrderInput): Promise<SaleOrderResult> {
    return await this.saleService.createSaleOrder(input);
  }

  async getAllOrders(limit = 50, offset = 0, createdBy?: number): Promise<SalesOrder[]> {
    try {
      if (createdBy !== undefined) {
        return await this.db.query<SalesOrder>(`
          SELECT * FROM sales_orders WHERE created_by = ? ORDER BY id DESC LIMIT ? OFFSET ?
        `, [createdBy, limit, offset]);
      }
      return await this.db.query<SalesOrder>(`
        SELECT * FROM sales_orders ORDER BY id DESC LIMIT ? OFFSET ?
      `, [limit, offset]);
    } catch (err) {
      logger.error('SaleRepository', 'Failed to get sales orders', err);
      return [];
    }
  }

  async getPendingSales(createdBy?: number): Promise<SalesRecord[]> {
    return await this.localSource.getPendingSales(createdBy);
  }

  async getPendingSyncCount(userId?: number): Promise<number> {
    return await this.localSource.getPendingSyncCount(userId);
  }

  async getSalesHistory(params?: {
    search?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    createdBy?: number;
    limit?: number;
    offset?: number;
  }): Promise<SalesOrder[]> {
    return await this.localSource.getSalesOrders(params);
  }

  async getSaleOrderDetail(orderIdOrClientOrderId: number | string): Promise<{
    order: SalesOrder;
    items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }>;
  } | null> {
    return await this.localSource.getSaleOrderDetail(orderIdOrClientOrderId);
  }

  async cancelSaleOrder(input: CancelSaleOrderInput): Promise<CancelSaleOrderResult> {
    return await this.saleService.cancelSaleOrder(input);
  }

  async getTodaySummary(createdBy?: number): Promise<TodaySalesSummary> {
    return await this.localSource.getTodaySummary(createdBy);
  }
}

export const saleRepository = new SaleRepository();
export default saleRepository;
