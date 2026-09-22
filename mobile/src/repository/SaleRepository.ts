import { SalesRecord } from '../types/domain';
import { SalesOrder } from '../database/types';
import { IRepository, IRemoteDataSource } from './base';
import { CreateSaleInput, TodaySalesSummary } from './sqlite/SqliteSaleDataSource';
import { CreateSaleOrderInput, SaleOrderResult, CancelSaleOrderInput, CancelSaleOrderResult } from '../services/types';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import logger from '../utils/logger';

export function formatOrderHeader(productNames?: string[]): string {
  if (!productNames || productNames.length === 0) return 'Đơn hàng';
  const unique = [...new Set(productNames.filter(Boolean))];
  if (unique.length === 0) return 'Đơn hàng';
  if (unique.length === 1) return unique[0];
  return `${unique[0]} + ${unique.length - 1} sản phẩm khác`;
}

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
  private historyCacheMap = new Map<string, { data: SalesOrder[]; timestamp: number }>();
  private orderDetailCache = new Map<string, {
    order: SalesOrder;
    items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }>;
  }>();
  private readonly CACHE_TTL_MS = 10000; // 10s cache TTL

  constructor(remote?: IRemoteDataSource<SalesRecord>) {
    this.remoteSource = remote || new SaleRemoteDataSource();
  }

  clearCache(): void {
    this.historyCacheMap.clear();
    this.orderDetailCache.clear();
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
      paymentMethod: input.paymentMethod || 'CASH',
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

    const now = new Date();
    const cleanDate = (input.saleDate || now.toISOString().split('T')[0]).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const sharedCode = input.clientOrderId || `TX-${cleanDate}-${now.getTime().toString().slice(-4)}${randomSuffix}`;

    const payload = {
      saleDate: input.saleDate || now.toISOString().split('T')[0],
      orderCode: sharedCode,
      transactionCode: sharedCode,
      clientOrderId: sharedCode,
      paymentMethod: input.paymentMethod || 'CASH',
      items: input.items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        discountThousand: ((it.discount || 0) / 1000),
        note: it.note,
      })),
      note: input.note,
    };

    const res = await apiClient.post<any>(Endpoints.SALES, payload);

    const rawData: any = res.data;
    const createdRecords: any[] = Array.isArray(rawData)
      ? rawData
      : (rawData && typeof rawData === 'object' && rawData.id ? [rawData] : []);

    if (createdRecords.length === 0) {
      throw new Error(res.error?.message || 'Máy chủ không trả về chi tiết đơn bán hàng.');
    }

    const orderCode = res.data?.orderCode || res.data?.transactionCode || createdRecords[0]?.transaction_code || sharedCode;

    const totalItems = createdRecords.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const finalAmount = createdRecords.reduce((sum, r) => sum + Number(r.total_revenue || 0), 0);
    const totalDiscount = createdRecords.reduce((sum, r) => sum + Number(r.discount || 0), 0);
    const subtotal = finalAmount + totalDiscount;

    const effectiveReceived = input.cashReceived !== undefined ? input.cashReceived : finalAmount;
    const effectiveChange = input.cashChange !== undefined ? input.cashChange : Math.max(0, effectiveReceived - finalAmount);

    const productNames = [...new Set(createdRecords.map((r) => r.product_name).filter(Boolean))];
    const displayTitle = formatOrderHeader(productNames);

    const order: SalesOrder = {
      id: createdRecords[0]?.id || Date.now(),
      client_order_id: orderCode,
      order_code: orderCode,
      sale_date: input.saleDate || now.toISOString().split('T')[0],
      total_amount: subtotal,
      total_discount: totalDiscount,
      final_amount: finalAmount,
      total_items: totalItems,
      status: 'COMPLETED',
      sync_status: 'SYNCED',
      payment_method: input.paymentMethod || 'CASH',
      cash_received: effectiveReceived,
      cash_change: effectiveChange,
      note: input.note || null,
      created_by: input.createdBy || 1,
      created_at: now.toISOString(),
      synced_at: now.toISOString(),
      product_names: productNames,
      display_title: displayTitle,
    };

    return {
      order,
      items: createdRecords,
    };
  }

  // --- SALES ORDERS HISTORY: AGGREGATED FROM SUPABASE CLOUD ---
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
    const cacheKey = JSON.stringify(params || {});
    if (!params?.search && this.historyCacheMap.has(cacheKey)) {
      const cached = this.historyCacheMap.get(cacheKey)!;
      if (now - cached.timestamp < this.CACHE_TTL_MS) {
        return cached.data;
      }
    }

    try {
      const queryParams: Record<string, any> = { limit: params?.limit || 100 };
      if (params?.startDate) queryParams.startDate = params.startDate;
      if (params?.endDate) queryParams.endDate = params.endDate;
      if (params?.status && params.status !== 'ALL') queryParams.status = params.status;
      if (params?.paymentMethod && params.paymentMethod !== 'ALL') queryParams.paymentMethod = params.paymentMethod;
      if (params?.search) queryParams.q = params.search;

      const res = await apiClient.get<any[]>(Endpoints.SALES, { params: queryParams });

      if (res.data && Array.isArray(res.data)) {
        const orderMap = new Map<string, SalesOrder>();
        const itemsByCode = new Map<string, any[]>();

        for (const r of res.data) {
          const code = r.transaction_code || `TX-${r.id}`;
          const rawDate = String(r.sale_date || '');
          const normalizedDate = rawDate.includes('T') ? rawDate.split('T')[0] : (rawDate.slice(0, 10) || rawDate);

          if (!itemsByCode.has(code)) itemsByCode.set(code, []);
          itemsByCode.get(code)!.push(r);

          if (!orderMap.has(code)) {
            const productNames = r.product_name ? [r.product_name] : [];
            orderMap.set(code, {
              id: r.id,
              client_order_id: code,
              order_code: code,
              sale_date: normalizedDate,
              total_items: Number(r.quantity),
              total_amount: Number(r.total_revenue) + Number(r.discount || 0),
              total_discount: Number(r.discount || 0),
              final_amount: Number(r.total_revenue),
              payment_method: (r.payment_method as any) || 'CASH',
              status: (r.status as any) || 'COMPLETED',
              sync_status: 'SYNCED',
              note: r.note || null,
              cancel_reason: r.cancel_reason || null,
              cancelled_at: r.cancelled_at || null,
              created_by: r.created_by ?? null,
              created_at: r.created_at || r.sale_date,
              seller_name: r.seller_name,
              product_names: productNames,
              display_title: formatOrderHeader(productNames),
            } as any);
          } else {
            const existing = orderMap.get(code)!;
            existing.total_items += Number(r.quantity);
            existing.total_amount += Number(r.total_revenue) + Number(r.discount || 0);
            existing.total_discount += Number(r.discount || 0);
            existing.final_amount += Number(r.total_revenue);
            if (r.status === 'CANCELLED') existing.status = 'CANCELLED';
            if (r.cancel_reason && !existing.cancel_reason) existing.cancel_reason = r.cancel_reason;
            if (r.product_name && !(existing.product_names || []).includes(r.product_name)) {
              existing.product_names = existing.product_names || [];
              existing.product_names.push(r.product_name);
              existing.display_title = formatOrderHeader(existing.product_names);
            }
          }
        }

        // Cache order details in memory for instantaneous & strictly accurate detail lookups
        for (const [code, order] of orderMap.entries()) {
          const rawItems = itemsByCode.get(code) || [];
          const items = rawItems.map((r: any) => ({
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
            sync_status: 'SYNCED' as any,
            note: r.note,
            created_by: r.created_by,
            created_at: r.created_at,
            product_name: r.product_name,
            sku: r.sku,
            category_name: r.category_name,
          }));

          const detailObj = { order, items: items as any };
          this.orderDetailCache.set(code, detailObj);
          this.orderDetailCache.set(String(order.id), detailObj);
        }

        const cloudOrders = Array.from(orderMap.values());
        if (!params?.search) {
          this.historyCacheMap.set(cacheKey, { data: cloudOrders, timestamp: now });
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

  // --- CANONICAL ORDER DETAIL RETRIEVAL ---
  async getSaleOrderDetail(orderIdOrCode: number | string): Promise<{
    order: SalesOrder;
    items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }>;
  } | null> {
    const key = String(orderIdOrCode).trim();
    if (!key) return null;

    // 1. Try dedicated SALES_DETAIL endpoint first
    try {
      const res = await apiClient.get<any>(Endpoints.SALES_DETAIL(key));
      if (res.data && (res.data.order || res.data.items)) {
        const orderData = res.data.order;
        const itemsData = res.data.items || [];
        const productNames = itemsData.map((it: any) => it.product_name).filter(Boolean);
        const displayTitle = formatOrderHeader(productNames);
        orderData.product_names = productNames;
        orderData.display_title = displayTitle;

        const result = { order: orderData, items: itemsData };
        this.orderDetailCache.set(key, result);
        if (orderData.order_code) this.orderDetailCache.set(orderData.order_code, result);
        return result;
      }
    } catch (err) {
      // Fallback to query if endpoint not supported on remote server
    }

    // 2. Query SALES endpoint with strict canonical filter
    try {
      const res = await apiClient.get<any[]>(Endpoints.SALES, {
        params: { q: key, limit: 50 }
      });

      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        // STRICT FILTER: Match exact transaction_code or exact numeric id ONLY
        const matchingRecords = res.data.filter(
          (r: any) => String(r.transaction_code).trim() === key || Number(r.id) === Number(key)
        );

        if (matchingRecords.length > 0) {
          const first = matchingRecords[0];
          const totalItems = matchingRecords.reduce((s, r) => s + Number(r.quantity), 0);
          const finalAmount = matchingRecords.reduce((s, r) => s + Number(r.total_revenue), 0);
          const totalDiscount = matchingRecords.reduce((s, r) => s + Number(r.discount || 0), 0);
          const isCancelled = matchingRecords.some((r: any) => r.status === 'CANCELLED');
          const productNames = [...new Set(matchingRecords.map((r: any) => r.product_name).filter(Boolean))];
          const displayTitle = formatOrderHeader(productNames);

          const order: SalesOrder = {
            id: first.id,
            client_order_id: first.transaction_code,
            order_code: first.transaction_code,
            sale_date: first.sale_date,
            total_items: totalItems,
            total_amount: finalAmount + totalDiscount,
            total_discount: totalDiscount,
            final_amount: finalAmount,
            payment_method: (first.payment_method as any) || 'CASH',
            status: isCancelled ? 'CANCELLED' : 'COMPLETED',
            sync_status: 'SYNCED',
            note: first.note || null,
            cancel_reason: first.cancel_reason || null,
            cancelled_at: first.cancelled_at || null,
            created_by: first.created_by ?? null,
            created_at: first.created_at || first.sale_date,
            seller_name: first.seller_name,
            product_names: productNames,
            display_title: displayTitle,
          } as any;

          const items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }> = matchingRecords.map((r: any) => ({
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

          const result = { order, items };
          this.orderDetailCache.set(key, result);
          this.orderDetailCache.set(first.transaction_code, result);
          return result;
        }
      }
    } catch (err) {
      logger.error('SaleRepository', 'Failed to fetch order detail via strict search', err);
    }

    // 3. If remote failed or returned no exact match, return cached entry from getSalesOrders if available
    if (this.orderDetailCache.has(key)) {
      return this.orderDetailCache.get(key)!;
    }

    // NEVER return res.data[0]! Return null so UI shows "Không tìm thấy" instead of an unrelated order
    return null;
  }

  // --- ATOMIC CANCELLATION FOR CANONICAL ORDER ---
  async cancelSaleOrder(input: CancelSaleOrderInput & { itemIds?: number[] }): Promise<CancelSaleOrderResult> {
    this.clearCache();

    const targetId = input.clientOrderId || input.orderId;
    if (!targetId) {
      throw new Error('Mã hoặc ID đơn hàng không hợp lệ để hủy.');
    }

    // 1. Send cancellation request to primary cancel endpoint
    let res = await apiClient.post<any>(Endpoints.SALES_CANCEL(targetId), {
      reason: input.reason,
    });

    // 2. If server rejected with INVALID_ID or 400 because targetId was a string on legacy server, retry with numeric orderId
    if (!res.data && input.orderId && input.orderId !== targetId) {
      try {
        res = await apiClient.post<any>(Endpoints.SALES_CANCEL(input.orderId), {
          reason: input.reason,
        });
      } catch (retryErr) {
        // Continue to check result
      }
    }

    // 3. If multi-item order on legacy server that only cancels 1 item, cancel remaining items
    if (input.itemIds && input.itemIds.length > 1) {
      for (const itemId of input.itemIds) {
        if (itemId !== Number(input.orderId)) {
          try {
            await apiClient.post<any>(Endpoints.SALES_CANCEL(itemId), {
              reason: input.reason,
            });
          } catch (e) {
            // Item might already be cancelled, ignore
          }
        }
      }
    }

    // Invalidate Product RAM cache & Sales RAM cache
    const { productRepository } = await import('./ProductRepository');
    productRepository.clearMemoryCache();
    this.clearCache();

    const orderData: any = res.data?.order || {
      id: input.orderId,
      status: 'CANCELLED',
      cancel_reason: input.reason,
    };

    return {
      order: orderData,
      restoredItemsCount: Number(res.data?.restoredItemsCount || input.itemIds?.length || 1),
      restoredQuantity: Number(res.data?.restoredQuantity ?? res.data?.quantityRestored ?? 0),
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
