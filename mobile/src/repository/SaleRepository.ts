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
  private historyCache: { data: SalesOrder[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 15000; // 15s cache TTL for lightning-fast sub-second UX

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

  clearCache(): void {
    this.historyCache = null;
  }

  async getAll(forceRemote = false, createdBy?: number): Promise<SalesRecord[]> {
    if (!forceRemote) {
      const local = await this.localSource.getAllSales({ limit: 50, createdBy });
      if (local.length > 0) return local;
    }

    try {
      const remote = await this.remoteSource.getAll({ limit: 100 });
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

  // --- MULTI-ITEM CHECKOUT: DIRECT SUPABASE CLOUD TRANSACTION ---
  async createMultiItemSale(input: CreateSaleOrderInput): Promise<SaleOrderResult> {
    this.clearCache();

    // 1. Attempt Direct Online Transaction on Supabase Cloud
    try {
      const payload = {
        saleDate: input.saleDate || new Date().toISOString().split('T')[0],
        items: input.items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          discountThousand: ((it.discount || 0) / 1000),
          note: it.note,
        })),
        note: input.note,
      };

      const res = await apiClient.post<any[]>(Endpoints.SALES, payload);

      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        const createdRecords = res.data;
        const now = new Date();
        const clientOrderId = input.clientOrderId || `ord-cloud-${now.getTime()}`;
        const orderCode = createdRecords[0]?.transaction_code || `ORD-${now.getTime().toString().slice(-6)}`;

        const totalItems = createdRecords.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
        const finalAmount = createdRecords.reduce((sum, r) => sum + Number(r.total_revenue || 0), 0);
        const totalDiscount = createdRecords.reduce((sum, r) => sum + Number(r.discount || 0), 0);
        const subtotal = finalAmount + totalDiscount;

        const effectiveReceived = input.cashReceived !== undefined ? input.cashReceived : finalAmount;
        const effectiveChange = input.cashChange !== undefined ? input.cashChange : Math.max(0, effectiveReceived - finalAmount);

        const order: SalesOrder = {
          id: createdRecords[0].id,
          client_order_id: clientOrderId,
          order_code: orderCode,
          sale_date: payload.saleDate,
          total_items: totalItems,
          total_amount: subtotal,
          total_discount: totalDiscount,
          final_amount: finalAmount,
          payment_method: input.paymentMethod || 'CASH',
          cash_received: effectiveReceived,
          cash_change: effectiveChange,
          note: input.note || null,
          status: 'COMPLETED',
          sync_status: 'SYNCED',
          created_by: input.createdBy ?? null,
          created_at: now.toISOString(),
          synced_at: now.toISOString(),
        };

        // Persist synchronously to local SQLite so both offline cache and local history are instant
        try {
          await this.db.withTransaction(async (tx) => {
            const orderRes = await tx.runAsync(`
              INSERT INTO sales_orders (
                client_order_id, order_code, sale_date, total_amount,
                total_discount, final_amount, total_items, payment_method, cash_received, cash_change,
                note, status, sync_status, created_by, created_at, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'SYNCED', ?, ?, datetime('now'))
            `, [
              order.client_order_id, order.order_code, order.sale_date, order.total_amount,
              order.total_discount, order.final_amount, order.total_items, order.payment_method, order.cash_received,
              order.cash_change, order.note || null, order.created_by, order.created_at
            ]);

            const localOrderId = orderRes.lastInsertRowId;
            order.id = localOrderId;

            for (const rec of createdRecords) {
              await tx.runAsync(`
                INSERT INTO sales_records (
                  client_transaction_id, server_id, transaction_code, product_id, sale_date,
                  quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue,
                  total_cost, profit, status, sync_status, note, created_by, created_at, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'SYNCED', ?, ?, ?, datetime('now'))
              `, [
                rec.transaction_code, rec.id, rec.transaction_code, rec.product_id, rec.sale_date,
                rec.quantity, rec.unit_price_at_sale, rec.cost_price_at_sale, rec.discount || 0, rec.total_revenue,
                rec.total_cost, rec.profit, rec.note || null, rec.created_by, rec.created_at || now.toISOString()
              ]);

              // Update stock locally
              await tx.runAsync(`
                UPDATE products SET current_stock = MAX(0, current_stock - ?) WHERE id = ?
              `, [rec.quantity, rec.product_id]);
            }
          });
        } catch (localSaveErr) {
          logger.warn('SaleRepository', 'Warning: Failed to cache cloud sale to local SQLite', localSaveErr);
        }

        // Invalidate ProductRepository RAM cache to ensure next product fetch reflects new stock
        const { productRepository } = await import('./ProductRepository');
        productRepository.clearMemoryCache();

        return { order, items: createdRecords };
      }
    } catch (err) {
      logger.warn('SaleRepository', 'Direct Supabase checkout failed, falling back to OfflineSaleService', err);
    }

    // 2. Offline Fallback: Local SQLite Atomic Transaction + Outbox Queue
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

  // --- SALES HISTORY: DIRECT SUPABASE CLOUD SYNC & LOCAL CACHE ---
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
    const now = Date.now();

    // 1. Instant Cache Return (if no custom search and within TTL)
    if (!params?.search && this.historyCache && (now - this.historyCache.timestamp < this.CACHE_TTL_MS)) {
      return this.historyCache.data;
    }

    // 2. Direct Online Fetch from Supabase Cloud API
    try {
      const queryParams: Record<string, any> = {
        limit: params?.limit || 100,
        offset: params?.offset || 0,
      };
      if (params?.startDate) queryParams.startDate = params.startDate;
      if (params?.endDate) queryParams.endDate = params.endDate;
      if (params?.status && params.status !== 'ALL') queryParams.status = params.status;
      if (params?.search) queryParams.q = params.search;

      const res = await apiClient.get<any[]>(Endpoints.SALES, { params: queryParams });

      if (res.data && Array.isArray(res.data)) {
        // Group individual sales records by transaction_code into SalesOrder objects
        const orderMap = new Map<string, SalesOrder>();

        for (const r of res.data) {
          const code = r.transaction_code || `TX-${r.id}`;
          if (!orderMap.has(code)) {
            orderMap.set(code, {
              id: r.id,
              client_order_id: code,
              order_code: code,
              sale_date: r.sale_date,
              total_items: Number(r.quantity),
              total_amount: Number(r.total_revenue) + Number(r.discount || 0),
              total_discount: Number(r.discount || 0),
              final_amount: Number(r.total_revenue),
              payment_method: 'CASH',
              status: (r.status as any) || 'COMPLETED',
              sync_status: 'SYNCED',
              note: r.note || null,
              cancel_reason: r.cancel_reason || null,
              cancelled_at: r.cancelled_at || null,
              created_by: r.created_by ?? null,
              created_at: r.created_at || r.sale_date,
              seller_name: r.seller_name,
            } as any);
          } else {
            const existing = orderMap.get(code)!;
            existing.total_items += Number(r.quantity);
            existing.total_amount += Number(r.total_revenue) + Number(r.discount || 0);
            existing.total_discount += Number(r.discount || 0);
            existing.final_amount += Number(r.total_revenue);
          }
        }

        const cloudOrders = Array.from(orderMap.values());
        if (!params?.search) {
          this.historyCache = { data: cloudOrders, timestamp: now };
        }
        return cloudOrders;
      }
    } catch (err) {
      logger.warn('SaleRepository', 'Failed to fetch sales history from Supabase Cloud, falling back to local SQLite', err);
    }

    // 3. Fallback to Local SQLite
    return await this.localSource.getSalesOrders(params);
  }

  async getSaleOrderDetail(orderIdOrClientOrderId: number | string): Promise<{
    order: SalesOrder;
    items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }>;
  } | null> {
    // 1. Try local SQLite first for speed
    const local = await this.localSource.getSaleOrderDetail(orderIdOrClientOrderId);
    if (local) return local;

    // 2. Fetch directly from Cloud API if not present in local SQLite
    try {
      const res = await apiClient.get<any[]>(Endpoints.SALES, {
        params: { q: String(orderIdOrClientOrderId), limit: 20 }
      });

      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        const matchingRecords = res.data.filter(
          (r: any) => r.transaction_code === String(orderIdOrClientOrderId) || r.id === Number(orderIdOrClientOrderId)
        );
        const recordsToUse = matchingRecords.length > 0 ? matchingRecords : [res.data[0]];
        const first = recordsToUse[0];

        const totalItems = recordsToUse.reduce((s, r) => s + Number(r.quantity), 0);
        const finalAmount = recordsToUse.reduce((s, r) => s + Number(r.total_revenue), 0);
        const totalDiscount = recordsToUse.reduce((s, r) => s + Number(r.discount || 0), 0);

        const order: SalesOrder = {
          id: first.id,
          client_order_id: first.transaction_code,
          order_code: first.transaction_code,
          sale_date: first.sale_date,
          total_items: totalItems,
          total_amount: finalAmount + totalDiscount,
          total_discount: totalDiscount,
          final_amount: finalAmount,
          payment_method: 'CASH',
          status: (first.status as any) || 'COMPLETED',
          sync_status: 'SYNCED',
          note: first.note || null,
          cancel_reason: first.cancel_reason || null,
          cancelled_at: first.cancelled_at || null,
          created_by: first.created_by ?? null,
          created_at: first.created_at || first.sale_date,
          seller_name: first.seller_name,
        } as any;

        const items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }> = recordsToUse.map((r: any) => ({
          id: r.id,
          transaction_code: r.transaction_code,
          client_transaction_id: r.transaction_code,
          product_id: r.product_id,
          sale_date: r.sale_date,
          quantity: r.quantity,
          unit_price_at_sale: r.unit_price_at_sale,
          cost_price_at_sale: r.cost_price_at_sale,
          discount: r.discount || 0,
          total_revenue: r.total_revenue,
          total_cost: r.total_cost,
          profit: r.profit,
          status: r.status || 'COMPLETED',
          sync_status: 'SYNCED',
          note: r.note,
          created_by: r.created_by,
          created_at: r.created_at,
          product_name: r.product_name,
          sku: r.sku,
          category_name: r.category_name,
        }));

        return { order, items };
      }
    } catch (err) {
      logger.warn('SaleRepository', 'Failed to fetch order detail from Supabase Cloud', err);
    }

    return null;
  }

  async cancelSaleOrder(input: CancelSaleOrderInput): Promise<CancelSaleOrderResult> {
    this.clearCache();

    // 1. Try Direct Online Cancellation on Supabase Server
    if (input.orderId) {
      try {
        await apiClient.post(Endpoints.SALES_CANCEL(input.orderId), {
          reason: input.reason,
        });

        // Invalidate Product RAM cache
        const { productRepository } = await import('./ProductRepository');
        productRepository.clearMemoryCache();
      } catch (err) {
        logger.warn('SaleRepository', `Direct server cancellation failed for order ${input.orderId}`, err);
      }
    }

    // 2. Perform local cancellation
    return await this.saleService.cancelSaleOrder(input);
  }

  async getTodaySummary(createdBy?: number): Promise<TodaySalesSummary> {
    return await this.localSource.getTodaySummary(createdBy);
  }
}

export const saleRepository = new SaleRepository();
export default saleRepository;
