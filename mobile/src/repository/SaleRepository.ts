import { SalesRecord } from '../types/domain';
import { SalesOrder } from '../database/types';
import { IRepository, IRemoteDataSource } from './base';
import { CreateSaleInput, TodaySalesSummary } from './sqlite/SqliteSaleDataSource';
import { CreateSaleOrderInput, SaleOrderResult, CancelSaleOrderInput, CancelSaleOrderResult } from '../services/types';
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
  private remoteSource: IRemoteDataSource<SalesRecord>;
  private historyCache: { data: SalesOrder[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 15000; // 15s cache TTL

  constructor(remote?: IRemoteDataSource<SalesRecord>) {
    this.remoteSource = remote || new SaleRemoteDataSource();
  }

  clearCache(): void {
    this.historyCache = null;
  }

  async getAll(forceRemote = false, createdBy?: number): Promise<SalesRecord[]> {
    try {
      const remote = await this.remoteSource.getAll({ limit: 100 });
      if (createdBy !== undefined) {
        return remote.filter((s) => s.created_by === createdBy);
      }
      return remote;
    } catch (err) {
      logger.error('SaleRepository', 'Failed to fetch remote sales from Supabase Cloud', err);
      return [];
    }
  }

  async getById(id: number | string): Promise<SalesRecord | null> {
    return await this.remoteSource.getById(id);
  }

  async createSale(input: CreateSaleInput): Promise<SalesRecord> {
    const res = await apiClient.post<any>(Endpoints.SALES, {
      saleDate: new Date().toISOString().split('T')[0],
      items: [{
        productId: input.productId,
        quantity: input.quantity,
        discountThousand: ((input.discount || 0) / 1000),
        note: input.note,
      }],
      note: input.note,
    });
    if (res.data) {
      const rec = Array.isArray(res.data) ? res.data[0] : res.data;
      return rec as SalesRecord;
    }
    throw new Error('Không thể tạo đơn bán hàng trên Supabase.');
  }

  // --- MULTI-ITEM CHECKOUT: DIRECT SUPABASE CLOUD TRANSACTION ---
  async createMultiItemSale(input: CreateSaleOrderInput): Promise<SaleOrderResult> {
    this.clearCache();

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

    const rawData: any = res.data;
    const createdRecords: any[] = Array.isArray(rawData)
      ? rawData
      : (rawData && typeof rawData === 'object' && rawData.id ? [rawData] : []);

    if (createdRecords.length === 0) {
      throw new Error(res.error?.message || 'Máy chủ không trả về chi tiết đơn bán hàng.');
    }

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

    // Invalidate ProductRepository RAM cache to ensure next product fetch reflects new stock
    const { productRepository } = await import('./ProductRepository');
    productRepository.clearMemoryCache();

    return {
      order,
      items: createdRecords,
    };
  }

  // --- SALES ORDERS HISTORY: DIRECT SUPABASE CLOUD QUERY ---
  async getSalesOrders(params?: {
    startDate?: string;
    endDate?: string;
    status?: string;
    paymentMethod?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<SalesOrder[]> {
    const now = Date.now();

    // 1. RAM Cache Hit for Instant Filter Tabs (< 15s)
    if (!params?.search && this.historyCache && (now - this.historyCache.timestamp < this.CACHE_TTL_MS)) {
      let filtered = this.historyCache.data;
      if (params?.status && params.status !== 'ALL') {
        filtered = filtered.filter((o) => o.status === params.status);
      }
      if (params?.startDate) {
        filtered = filtered.filter((o) => o.sale_date >= params.startDate!);
      }
      if (params?.endDate) {
        filtered = filtered.filter((o) => o.sale_date <= params.endDate!);
      }
      return filtered;
    }

    // 2. Fetch directly from Cloud API
    try {
      const queryParams: Record<string, any> = { limit: params?.limit || 100 };
      if (params?.startDate) queryParams.startDate = params.startDate;
      if (params?.endDate) queryParams.endDate = params.endDate;
      if (params?.status && params.status !== 'ALL') queryParams.status = params.status;
      if (params?.search) queryParams.q = params.search;

      const res = await apiClient.get<any[]>(Endpoints.SALES, { params: queryParams });

      if (res.data && Array.isArray(res.data)) {
        const orderMap = new Map<string, SalesOrder>();

        for (const r of res.data) {
          const code = r.transaction_code || `TX-${r.id}`;
          const rawDate = String(r.sale_date || '');
          const normalizedDate = rawDate.includes('T') ? rawDate.split('T')[0] : (rawDate.slice(0, 10) || rawDate);

          if (!orderMap.has(code)) {
            orderMap.set(code, {
              id: r.id,
              client_order_id: code,
              order_code: code,
              sale_date: normalizedDate,
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
      logger.error('SaleRepository', 'Failed to fetch sales history from Supabase Cloud', err);
    }

    return [];
  }

  async getSalesHistory(params?: {
    startDate?: string;
    endDate?: string;
    status?: string;
    paymentMethod?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<SalesOrder[]> {
    return this.getSalesOrders(params);
  }

  async getSaleOrderDetail(orderIdOrClientOrderId: number | string): Promise<{
    order: SalesOrder;
    items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }>;
  } | null> {
    try {
      const res = await apiClient.get<any[]>(Endpoints.SALES, {
        params: { q: String(orderIdOrClientOrderId), limit: 50 }
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
      logger.error('SaleRepository', 'Failed to fetch order detail from Supabase Cloud', err);
    }

    return null;
  }

  async cancelSaleOrder(input: CancelSaleOrderInput): Promise<CancelSaleOrderResult> {
    this.clearCache();

    if (!input.orderId) {
      throw new Error('ID đơn hàng không hợp lệ để hủy.');
    }

    const res = await apiClient.post<any>(Endpoints.SALES_CANCEL(input.orderId), {
      reason: input.reason,
    });

    // Invalidate Product RAM cache
    const { productRepository } = await import('./ProductRepository');
    productRepository.clearMemoryCache();

    const orderData: any = res.data?.order || {
      id: input.orderId,
      status: 'CANCELLED',
      cancel_reason: input.reason,
    };

    return {
      order: orderData,
      restoredItemsCount: Number(res.data?.restoredItemsCount || 0),
      restoredQuantity: Number(res.data?.restoredQuantity || 0),
      message: res.data?.message || 'Hủy đơn hàng thành công',
    };
  }

  async getTodaySummary(createdBy?: number): Promise<TodaySalesSummary> {
    try {
      const res = await apiClient.get<any>(Endpoints.REPORTS_ANALYTICS, {
        params: { type: 'overview', period: 'today', userId: createdBy }
      });
      if (res.data) {
        return {
          totalOrders: Number(res.data.salesCount || 0),
          totalRevenue: Number(res.data.revenue || 0),
          totalProfit: Number(res.data.profit || 0),
        };
      }
    } catch (err) {
      logger.error('SaleRepository', 'Failed to fetch today summary from Cloud API', err);
    }
    return { totalOrders: 0, totalRevenue: 0, totalProfit: 0 };
  }
}

export const saleRepository = new SaleRepository();
export default saleRepository;
