import { StockMovement, InventoryLot } from '../types/domain';
import { StockStatus, ImportRecord } from '../database/types';
import { IRepository, IRemoteDataSource } from './base';
import { CreateImportInput, ImportResult, StockAdjustmentInput, StockAdjustmentResult, PriceHistoryRecord, CostHistoryRecord } from '../services/types';
import productRepository from './ProductRepository';
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
  private remoteSource: IRemoteDataSource<StockMovement>;

  constructor(remote?: IRemoteDataSource<StockMovement>) {
    this.remoteSource = remote || new InventoryRemoteDataSource();
  }

  async getAll(): Promise<StockMovement[]> {
    try {
      return await this.remoteSource.getAll({ limit: 50 });
    } catch (err) {
      logger.error('InventoryRepository', 'Failed to fetch inventory movements from Supabase Cloud', err);
      return [];
    }
  }

  async getById(id: number | string): Promise<StockMovement | null> {
    return await this.remoteSource.getById(id);
  }

  async getStockStatus(productId: number): Promise<StockStatus> {
    const prods = await productRepository.getAll();
    const p = prods.find(item => item.id === productId);
    const currentStock = Number(p?.current_stock || 0);
    return {
      productId,
      serverStock: currentStock,
      pendingDelta: 0,
      effectiveStock: currentStock,
    };
  }

  async getAllStockStatuses(): Promise<StockStatus[]> {
    const prods = await productRepository.getAll();
    return prods.map((p) => {
      const currentStock = Number(p.current_stock || 0);
      return {
        productId: p.id,
        serverStock: currentStock,
        pendingDelta: 0,
        effectiveStock: currentStock,
      };
    });
  }

  async getInventoryLots(productId?: number): Promise<InventoryLot[]> {
    try {
      const res = await apiClient.get<any>(Endpoints.INVENTORY_LOTS, {
        params: productId ? { productId } : undefined
      });
      const lots = res.data;
      if (Array.isArray(lots)) {
        return lots.map((l: any) => ({
          id: Number(l.id),
          lot_code: String(l.lot_code),
          product_id: Number(l.product_id),
          purchase_date: String(l.purchase_date),
          quantity_received: Number(l.quantity_received),
          quantity_remaining: Number(l.quantity_remaining),
          unit_cost: Number(l.unit_cost),
          supplier_id: l.supplier_id ? Number(l.supplier_id) : null,
          import_id: l.import_id ? Number(l.import_id) : null,
          note: l.note || null,
          created_by: l.created_by ? Number(l.created_by) : 1,
          created_at: String(l.created_at),
          product_name: l.product_name,
          sku: l.sku,
          supplier_name: l.supplier_name,
        }));
      }
      return [];
    } catch (err) {
      logger.error('InventoryRepository', 'Failed to fetch inventory lots from Supabase Cloud', err);
      return [];
    }
  }

  async getStockMovements(productId?: number, limit = 50): Promise<StockMovement[]> {
    try {
      const res = await apiClient.get<any[]>(Endpoints.INVENTORY_MOVEMENTS, {
        params: { ...(productId ? { productId } : {}), limit }
      });
      if (Array.isArray(res.data)) {
        return res.data.map((m: any) => ({
          id: Number(m.id),
          product_id: Number(m.product_id),
          movement_type: m.movement_type,
          quantity_change: Number(m.quantity_change),
          balance_after: Number(m.balance_after),
          movement_date: String(m.movement_date),
          reference_type: m.reference_type,
          reference_id: m.reference_id,
          note: m.note,
          created_by: m.created_by,
          created_at: m.created_at,
          product_name: m.product_name,
          sku: m.sku,
        }));
      }
      return [];
    } catch (err) {
      logger.error('InventoryRepository', 'Failed to fetch stock movements from Supabase Cloud', err);
      return [];
    }
  }

  // Pure Online Stock Receipt (Nhập kho -> Supabase PostgreSQL via Vercel API)
  async createStockReceipt(input: CreateImportInput): Promise<ImportResult> {
    const payload = {
      items: input.items.map(it => ({
        productId: it.productId,
        quantity: it.quantity,
        unitCostPrice: it.unitCostPrice,
      })),
      supplierId: input.supplierId,
      note: input.note,
      importDate: input.importDate || new Date().toISOString().split('T')[0],
    };

    const res = await apiClient.post<any>(Endpoints.INVENTORY_RECEIPTS, payload);
    if (!res.data) {
      throw new Error(res.error?.message || 'Không nhận được phản hồi từ máy chủ Supabase.');
    }

    // Invalidate product memory cache so stock updates instantly
    productRepository.clearMemoryCache();

    const rawData: any = res.data;
    const code = rawData.importCode || rawData.import_code || rawData.importRecord?.import_code || rawData.importRecord?.importCode || 'NK-SUCCESS';
    const amount = Number(rawData.totalAmount || rawData.total_amount || rawData.importRecord?.total_amount || 0);

    const normalized: any = {
      ...rawData,
      importCode: code,
      import_code: code,
      totalAmount: amount,
      total_amount: amount,
      importRecord: {
        id: rawData.importId || rawData.importRecord?.id || 0,
        import_code: code,
        importCode: code,
        total_amount: amount,
        totalAmount: amount,
        ...(rawData.importRecord || {})
      }
    };

    return normalized;
  }

  // Pure Online Stock Adjustment (Điều chỉnh kho -> Supabase PostgreSQL via Vercel API)
  async adjustStock(input: StockAdjustmentInput): Promise<StockAdjustmentResult> {
    const payload = {
      productId: input.productId,
      movementType: input.movementType,
      quantityChange: input.quantityChange,
      movementDate: input.movementDate,
      note: input.note,
    };

    const res = await apiClient.post<any>(Endpoints.INVENTORY_ADJUSTMENTS, payload);
    if (!res.data) {
      throw new Error(res.error?.message || 'Không thể ghi nhận điều chỉnh kho trên Supabase.');
    }

    // Invalidate product memory cache so stock updates instantly
    productRepository.clearMemoryCache();

    return res.data;
  }

  async getPriceHistory(productId: number): Promise<PriceHistoryRecord[]> {
    return await productRepository.getPriceHistory(productId);
  }

  async getCostHistory(productId: number): Promise<CostHistoryRecord[]> {
    return await productRepository.getCostHistory(productId);
  }

  async getInventorySummary(): Promise<{ totalProducts: number; totalStock: number; totalValuation: number; lowStockCount: number }> {
    try {
      const res = await apiClient.get<any>(Endpoints.INVENTORY);
      const summary = res.data?.summary;
      if (summary) {
        return {
          totalProducts: Number(summary.totalProducts || 0),
          totalStock: Number(summary.totalStock || 0),
          totalValuation: Number(summary.totalValuation || 0),
          lowStockCount: Number(summary.lowStockCount || 0),
        };
      }
    } catch (err) {
      logger.error('InventoryRepository', 'Failed to fetch inventory summary from Supabase Cloud', err);
    }
    return { totalProducts: 0, totalStock: 0, totalValuation: 0, lowStockCount: 0 };
  }

  async getAllImports(limit = 50, offset = 0): Promise<ImportRecord[]> {
    try {
      const res = await apiClient.get<any[]>(Endpoints.INVENTORY_RECEIPTS, {
        params: { limit, offset }
      });
      return (res.data || []) as ImportRecord[];
    } catch (err) {
      logger.error('InventoryRepository', 'Failed to get imports from Supabase Cloud', err);
      return [];
    }
  }
}

export const inventoryRepository = new InventoryRepository();
export default inventoryRepository;
