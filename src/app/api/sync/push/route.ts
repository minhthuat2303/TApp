import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import crypto from 'crypto';

function computePayloadHash(payload: any): string {
  const canonical = JSON.stringify(payload, Object.keys(payload || {}).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để đồng bộ dữ liệu.' } },
        { status: 401 }
      );
    }

    const body = await request.json();
    let mutations: any[] = [];

    if (Array.isArray(body.mutations)) {
      mutations = body.mutations;
    } else if (body.client_mutation_id) {
      mutations = [body];
    } else {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Payload không hợp lệ: cần danh sách mutations.' } },
        { status: 400 }
      );
    }

    const results: any[] = [];

    for (const mutation of mutations) {
      const clientMutationId = mutation.client_mutation_id || mutation.payload?.client_order_id || mutation.payload?.client_import_id;
      const entityType = mutation.entity_type;
      const payload = mutation.payload || {};

      if (!clientMutationId || !entityType) {
        results.push({
          client_mutation_id: clientMutationId || 'UNKNOWN',
          status: 'FAILED',
          error: { code: 'VALIDATION_ERROR', message: 'Thiếu client_mutation_id hoặc entity_type.' },
        });
        continue;
      }

      try {
        // --- STEP 1: CHECK SERVER-LEVEL IDEMPOTENCY ---
        const incomingHash = computePayloadHash(payload);
        const existingTx = await db.queryOne<any>(`
          SELECT client_transaction_id, entity_type, status, server_id, result_json, payload_hash, payload_json, user_id, device_id, created_at
          FROM processed_sync_transactions
          WHERE client_transaction_id = ?
        `, [clientMutationId]);

        if (existingTx) {
          // Security check: Prevent cross-user transaction hijacking
          if (existingTx.user_id && existingTx.user_id !== user.id) {
            results.push({
              client_mutation_id: clientMutationId,
              status: 'CONFLICT',
              conflict_type: 'VALIDATION_CONFLICT',
              error: {
                code: 'CROSS_USER_HIJACKING_DETECTED',
                message: 'Phát hiện giao dịch client_transaction_id đã được ghi nhận bởi tài khoản khác. Không thể ghi đè.',
              },
              server_timestamp: new Date().toISOString(),
            });
            continue;
          }

          // Check if payload matches
          if (existingTx.payload_hash && existingTx.payload_hash !== incomingHash) {
            results.push({
              client_mutation_id: clientMutationId,
              status: 'CONFLICT',
              conflict_type: 'VALIDATION_CONFLICT',
              error: {
                code: 'PAYLOAD_MISMATCH',
                message: 'Phát hiện cùng client_transaction_id nhưng nội dung payload khác nhau. Giao dịch bị từ chối do xung đột định danh.',
              },
              server_timestamp: new Date().toISOString(),
            });
            continue;
          }

          results.push({
            client_mutation_id: clientMutationId,
            status: 'ALREADY_PROCESSED',
            conflict_type: 'DUPLICATE',
            server_transaction_id: existingTx.server_id,
            server_timestamp: existingTx.created_at,
            message: 'Giao dịch đã được xử lý trên máy chủ trước đó.',
          });
          continue;
        }

        // --- STEP 2: PROCESS MUTATION ATOMICALLY ---
        if (entityType === 'SALE_ORDER') {
          const saleResult = await db.transaction(async (tx) => {
            // Check double submission inside transaction
            const checkInside = await tx.queryOne<any>(`
              SELECT client_transaction_id, server_id, created_at
              FROM processed_sync_transactions
              WHERE client_transaction_id = ?
            `, [clientMutationId]);

            if (checkInside) {
              return {
                status: 'ALREADY_PROCESSED',
                server_id: checkInside.server_id,
                created_at: checkInside.created_at,
              };
            }

            const items = payload.items || [];
            if (!Array.isArray(items) || items.length === 0) {
              throw new Error('Đơn hàng không có sản phẩm nào.');
            }

            const saleDate = payload.sale_date || new Date().toISOString().split('T')[0];
            const orderCode = payload.order_code || `ORD-${Date.now().toString().slice(-6)}`;
            const recordedSales: number[] = [];

            // 1. Authoritative Validation & Stock Check
            for (const item of items) {
              const product = await tx.queryOne<any>(`
                SELECT id, sku, name, current_stock, current_selling_price, current_cost_price, status
                FROM products
                WHERE id = ?
              `, [item.product_id]);

              if (!product) {
                const err: any = new Error(`Sản phẩm (ID: ${item.product_id}) không tồn tại.`);
                err.code = 'PRODUCT_NOT_FOUND';
                err.conflict = true;
                throw err;
              }

              if (product.status !== 'ACTIVE') {
                const err: any = new Error(`Sản phẩm '${product.name}' đã ngừng kinh doanh trên hệ thống.`);
                err.code = 'PRODUCT_INACTIVE';
                err.conflict = true;
                throw err;
              }

              if (Number(product.current_stock) < item.quantity) {
                const err: any = new Error(
                  `Tồn kho máy chủ không đủ cho sản phẩm '${product.name}' (Tồn hiện tại: ${product.current_stock}, Yêu cầu: ${item.quantity}).`
                );
                err.code = 'INSUFFICIENT_STOCK';
                err.conflict = true;
                throw err;
              }

              // 2. Authoritative Price Resolution from price_history
              const priceRecord = await tx.queryOne<any>(`
                SELECT price FROM price_history
                WHERE product_id = ? AND effective_from <= ?
                ORDER BY effective_from DESC, id DESC
                LIMIT 1
              `, [item.product_id, saleDate]);

              const unitPrice = priceRecord ? Number(priceRecord.price) : Number(product.current_selling_price);
              const discountAmount = Math.max(0, Number(item.discount || 0));
              const subtotal = item.quantity * unitPrice;
              const totalRevenue = Math.max(0, subtotal - discountAmount);

              // 3. FIFO COGS Lot Allocation
              let availableLots = await tx.query<any>(`
                SELECT id, lot_code, quantity_received, quantity_remaining, unit_cost, purchase_date
                FROM inventory_lots
                WHERE product_id = ? AND quantity_remaining > 0
                ORDER BY purchase_date ASC, id ASC
              `, [item.product_id]);

              const totalLotQty = availableLots.reduce((acc, l) => acc + Number(l.quantity_remaining), 0);

              if (totalLotQty < item.quantity) {
                const missingQty = item.quantity - totalLotQty;
                const emergencyLotCode = `LOT-SYNC-${product.sku}-${Date.now().toString().slice(-4)}`;
                const insertEmergency = await tx.execute(`
                  INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, note, created_by)
                  VALUES (?, ?, ?, ?, ?, ?, 'Khởi tạo lô bổ sung tự động (Sync)', ?)
                `, [emergencyLotCode, product.id, saleDate, missingQty, missingQty, product.current_cost_price, user.id]);

                availableLots.push({
                  id: Number(insertEmergency.lastInsertId),
                  lot_code: emergencyLotCode,
                  quantity_received: missingQty,
                  quantity_remaining: missingQty,
                  unit_cost: Number(product.current_cost_price),
                  purchase_date: saleDate,
                });
              }

              let remainingNeeded = item.quantity;
              let accumulatedCOGS = 0;
              const allocationsToInsert: Array<{ lotId: number; lotCode: string; qty: number; unitCost: number; totalCost: number }> = [];

              for (const lot of availableLots) {
                if (remainingNeeded <= 0) break;
                const lotRemaining = Number(lot.quantity_remaining);
                const takeQty = Math.min(remainingNeeded, lotRemaining);
                const lotCost = takeQty * Number(lot.unit_cost);
                accumulatedCOGS += lotCost;
                remainingNeeded -= takeQty;

                await tx.execute(`
                  UPDATE inventory_lots
                  SET quantity_remaining = quantity_remaining - ?
                  WHERE id = ?
                `, [takeQty, lot.id]);

                allocationsToInsert.push({
                  lotId: lot.id,
                  lotCode: lot.lot_code,
                  qty: takeQty,
                  unitCost: Number(lot.unit_cost),
                  totalCost: lotCost,
                });
              }

              const totalCost = accumulatedCOGS;
              const profit = totalRevenue - totalCost;
              const costPriceAtSale = item.quantity > 0 ? (totalCost / item.quantity) : Number(product.current_cost_price);

              const lineTxCode = item.client_transaction_id || `${orderCode}-${item.product_id}-${Date.now().toString().slice(-4)}`;

              // 4. Insert sales_records
              const saleInfo = await tx.execute(`
                INSERT INTO sales_records (
                  transaction_code, product_id, sale_date, quantity,
                  unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit,
                  note, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                lineTxCode,
                item.product_id,
                saleDate,
                item.quantity,
                unitPrice,
                costPriceAtSale,
                discountAmount,
                totalRevenue,
                totalCost,
                profit,
                item.note || payload.note || `Đồng bộ từ Mobile (Đơn ${orderCode})`,
                user.id,
              ]);

              const saleRecordId = Number(saleInfo.lastInsertId);
              recordedSales.push(saleRecordId);

              // 5. Insert sale_cost_allocations
              for (const alloc of allocationsToInsert) {
                await tx.execute(`
                  INSERT INTO sale_cost_allocations (sale_id, inventory_lot_id, quantity, unit_cost, total_cost)
                  VALUES (?, ?, ?, ?, ?)
                `, [saleRecordId, alloc.lotId, alloc.qty, alloc.unitCost, alloc.totalCost]);
              }

              const newStockBalance = Number(product.current_stock) - item.quantity;

              // 6. Insert stock_movements
              await tx.execute(`
                INSERT INTO stock_movements (
                  product_id, movement_type, quantity_change, balance_after,
                  movement_date, reference_type, reference_id, note, created_by
                ) VALUES (?, 'SALE', ?, ?, ?, 'sales_records', ?, ?, ?)
              `, [
                item.product_id,
                -item.quantity,
                newStockBalance,
                saleDate,
                saleRecordId,
                `Đồng bộ bán đơn ${orderCode} (Mobile Tx: ${clientMutationId})`,
                user.id,
              ]);

              // 7. Recalculate Weighted Average Cost
              const remainingLotsSummary = await tx.queryOne<any>(`
                SELECT 
                  COALESCE(SUM(quantity_remaining), 0) as total_rem,
                  COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
                FROM inventory_lots
                WHERE product_id = ? AND quantity_remaining > 0
              `, [item.product_id]);

              const totalRem = Number(remainingLotsSummary?.total_rem || 0);
              const totalVal = Number(remainingLotsSummary?.total_val || 0);
              const weightedAvgCost = totalRem > 0
                ? Math.round(totalVal / totalRem)
                : Number(product.current_cost_price);

              // 8. Update product stock & cost
              await tx.execute(`
                UPDATE products
                SET current_stock = ?,
                    current_cost_price = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [newStockBalance, weightedAvgCost, item.product_id]);
            }

            // 9. Record Idempotent Processed Transaction
            const primaryServerId = recordedSales[0] || null;
            await tx.execute(`
              INSERT INTO processed_sync_transactions (
                client_transaction_id, entity_type, status, server_id, result_json, payload_hash, payload_json, user_id, device_id, created_at
              ) VALUES (?, ?, 'PROCESSED', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
              clientMutationId,
              'SALE_ORDER',
              primaryServerId,
              JSON.stringify({ order_code: orderCode, sales_record_ids: recordedSales }),
              incomingHash,
              JSON.stringify(payload),
              user.id,
              user.device_id || null,
            ]);

            return {
              status: 'SYNCED',
              server_id: primaryServerId,
              created_at: new Date().toISOString(),
            };
          });

          results.push({
            client_mutation_id: clientMutationId,
            status: saleResult.status,
            server_transaction_id: saleResult.server_id,
            server_timestamp: saleResult.created_at,
          });
        } else if (entityType === 'IMPORT') {
          const importResult = await db.transaction(async (tx) => {
            const checkInside = await tx.queryOne<any>(`
              SELECT client_transaction_id, server_id, created_at
              FROM processed_sync_transactions
              WHERE client_transaction_id = ?
            `, [clientMutationId]);

            if (checkInside) {
              return {
                status: 'ALREADY_PROCESSED',
                server_id: checkInside.server_id,
                created_at: checkInside.created_at,
              };
            }

            const items = payload.items || [];
            if (!Array.isArray(items) || items.length === 0) {
              throw new Error('Phiếu nhập không có sản phẩm nào.');
            }

            const importDate = payload.import_date || new Date().toISOString().split('T')[0];
            const importCode = payload.import_code || `NK-SYNC-${Date.now().toString().slice(-6)}`;
            const totalAmount = Number(payload.total_amount || 0);

            // 1. Create Import Header
            const importInfo = await tx.execute(`
              INSERT INTO imports (import_code, supplier_id, import_date, total_amount, note, created_by)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [
              importCode,
              payload.supplier_id || null,
              importDate,
              totalAmount,
              payload.note ? String(payload.note).trim() : `Đồng bộ phiếu nhập từ Mobile (${clientMutationId})`,
              user.id,
            ]);

            const importId = Number(importInfo.lastInsertId);

            // 2. Process Items
            for (const it of items) {
              const product = await tx.queryOne<any>('SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?', [it.product_id]);
              if (!product) {
                throw new Error(`Sản phẩm (ID: ${it.product_id}) không tồn tại trên hệ thống.`);
              }

              const qty = Number(it.quantity);
              const cost = Number(it.unit_cost_price);
              const itemTotal = Number(it.total_amount || qty * cost);
              const cleanDate = importDate.replace(/-/g, '');
              const lotCode = `LOT-${cleanDate}-${product.sku}-${Date.now().toString().slice(-4)}`;

              // Import Item
              await tx.execute(`
                INSERT INTO import_items (import_id, product_id, quantity, unit_cost_price, total_amount)
                VALUES (?, ?, ?, ?, ?)
              `, [importId, product.id, qty, cost, itemTotal]);

              // Inventory Lot
              const lotInfo = await tx.execute(`
                INSERT INTO inventory_lots (
                  lot_code, product_id, purchase_date, quantity_received, quantity_remaining,
                  unit_cost, supplier_id, import_id, note, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                lotCode,
                product.id,
                importDate,
                qty,
                qty,
                cost,
                payload.supplier_id || null,
                importId,
                `Nhập kho từ Mobile (Phiếu: ${importCode})`,
                user.id,
              ]);

              const lotId = Number(lotInfo.lastInsertId);

              // Cost Price History
              await tx.execute(`
                INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by)
                VALUES (?, ?, ?, ?, ?)
              `, [product.id, cost, importDate, `Nhập kho từ Mobile ${importCode} (Lô: ${lotCode})`, user.id]);

              // Calculate new weighted cost
              const remainingLotsSummary = await tx.queryOne<any>(`
                SELECT 
                  COALESCE(SUM(quantity_remaining), 0) as total_rem,
                  COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
                FROM inventory_lots
                WHERE product_id = ? AND quantity_remaining > 0
              `, [product.id]);

              const totalRem = Number(remainingLotsSummary?.total_rem || 0);
              const totalVal = Number(remainingLotsSummary?.total_val || 0);
              const newStock = Number(product.current_stock) + qty;
              const weightedAvgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : cost;

              // Update product
              await tx.execute(`
                UPDATE products
                SET current_stock = ?,
                    current_cost_price = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [newStock, weightedAvgCost, product.id]);

              // Stock movement
              await tx.execute(`
                INSERT INTO stock_movements (
                  product_id, movement_type, quantity_change, balance_after,
                  movement_date, reference_type, reference_id, note, created_by
                ) VALUES (?, 'PURCHASE', ?, ?, ?, 'imports', ?, ?, ?)
              `, [
                product.id,
                qty,
                newStock,
                importDate,
                importId,
                `Nhập kho từ Mobile ${importCode} (Lô: ${lotCode})`,
                user.id,
              ]);
            }

            // 3. Record in processed_sync_transactions
            await tx.execute(`
              INSERT INTO processed_sync_transactions (
                client_transaction_id, entity_type, status, server_id, result_json, payload_hash, payload_json, user_id, device_id, created_at
              ) VALUES (?, ?, 'PROCESSED', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
              clientMutationId,
              'IMPORT',
              importId,
              JSON.stringify({ import_code: importCode, import_id: importId }),
              incomingHash,
              JSON.stringify(payload),
              user.id,
              user.device_id || null,
            ]);

            return {
              status: 'SYNCED',
              server_id: importId,
              created_at: new Date().toISOString(),
            };
          });

          results.push({
            client_mutation_id: clientMutationId,
            status: importResult.status,
            server_transaction_id: importResult.server_id,
            server_timestamp: importResult.created_at,
          });
        } else if (entityType === 'INVENTORY_ADJUSTMENT') {
          const adjustResult = await db.transaction(async (tx) => {
            const checkInside = await tx.queryOne<any>(`
              SELECT client_transaction_id, server_id, created_at
              FROM processed_sync_transactions
              WHERE client_transaction_id = ?
            `, [clientMutationId]);

            if (checkInside) {
              return {
                status: 'ALREADY_PROCESSED',
                server_id: checkInside.server_id,
                created_at: checkInside.created_at,
              };
            }

            const productId = payload.product_id;
            const movementType = payload.movement_type;
            const quantityChange = Number(payload.quantity_change);
            const date = payload.movement_date || new Date().toISOString().split('T')[0];
            const note = payload.note;

            const product = await tx.queryOne<any>('SELECT id, sku, name, current_stock FROM products WHERE id = ?', [productId]);
            if (!product) {
              const err: any = new Error(`Sản phẩm (ID: ${productId}) không tồn tại trên hệ thống.`);
              err.code = 'PRODUCT_NOT_FOUND';
              err.conflict = true;
              throw err;
            }

            const newStock = Number(product.current_stock) + quantityChange;
            if (newStock < 0) {
              const err: any = new Error(`Tồn kho không đủ để điều chỉnh (Hiện tại: ${product.current_stock}, Thay đổi: ${quantityChange}).`);
              err.code = 'INSUFFICIENT_STOCK';
              err.conflict = true;
              throw err;
            }

            // 1. Insert stock movement
            const moveInfo = await tx.execute(`
              INSERT INTO stock_movements (
                product_id, movement_type, quantity_change, balance_after,
                movement_date, reference_type, reference_id, note, created_by
              ) VALUES (?, ?, ?, ?, ?, 'stock_adjustments', NULL, ?, ?)
            `, [
              productId,
              movementType,
              quantityChange,
              newStock,
              date,
              note ? String(note).trim() : `Đồng bộ điều chỉnh kho từ Mobile (${clientMutationId})`,
              user.id,
            ]);

            const movementId = Number(moveInfo.lastInsertId);

            // 2. Update product stock
            await tx.execute(`
              UPDATE products
              SET current_stock = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [newStock, productId]);

            // 3. Record in processed_sync_transactions
            await tx.execute(`
              INSERT INTO processed_sync_transactions (
                client_transaction_id, entity_type, status, server_id, result_json, payload_hash, payload_json, user_id, device_id, created_at
              ) VALUES (?, ?, 'PROCESSED', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
              clientMutationId,
              'INVENTORY_ADJUSTMENT',
              movementId,
              JSON.stringify({ movement_id: movementId, balance_after: newStock }),
              incomingHash,
              JSON.stringify(payload),
              user.id,
              user.device_id || null,
            ]);

            return {
              status: 'SYNCED',
              server_id: movementId,
              created_at: new Date().toISOString(),
            };
          });

          results.push({
            client_mutation_id: clientMutationId,
            status: adjustResult.status,
            server_transaction_id: adjustResult.server_id,
            server_timestamp: adjustResult.created_at,
          });
        } else if (entityType === 'CANCEL_SALE_ORDER' || entityType === 'CANCEL_SALE') {
          const cancelResult = await db.transaction(async (tx) => {
            const checkInside = await tx.queryOne<any>(`
              SELECT client_transaction_id, server_id, created_at
              FROM processed_sync_transactions
              WHERE client_transaction_id = ?
            `, [clientMutationId]);

            if (checkInside) {
              return {
                status: 'ALREADY_PROCESSED',
                server_id: checkInside.server_id,
                created_at: checkInside.created_at,
              };
            }

            const clientOrderId = payload.client_order_id || mutation.entity_id;
            const orderCode = payload.order_code;
            const reason = payload.reason || 'Hủy từ ứng dụng Mobile';

            let salesToCancel: any[] = [];

            const origTx = await tx.queryOne<any>(`
              SELECT server_id, result_json FROM processed_sync_transactions WHERE client_transaction_id = ?
            `, [clientOrderId]);

            if (origTx?.result_json) {
              try {
                const parsed = JSON.parse(origTx.result_json);
                if (Array.isArray(parsed.sales_record_ids) && parsed.sales_record_ids.length > 0) {
                  salesToCancel = await tx.query<any>(`
                    SELECT * FROM sales_records WHERE id IN (${parsed.sales_record_ids.map(() => '?').join(',')})
                  `, parsed.sales_record_ids);
                }
              } catch {}
            }

            if (salesToCancel.length === 0 && orderCode) {
              salesToCancel = await tx.query<any>(`
                SELECT * FROM sales_records WHERE transaction_code LIKE ? OR note LIKE ?
              `, [`%${orderCode}%`, `%${clientOrderId}%`]);
            }

            if (salesToCancel.length === 0 && clientOrderId) {
              salesToCancel = await tx.query<any>(`
                SELECT * FROM sales_records WHERE note LIKE ?
              `, [`%${clientOrderId}%`]);
            }

            let totalRestored = 0;
            const now = new Date().toISOString().split('T')[0];

            for (const sale of salesToCancel) {
              if (sale.status === 'CANCELLED') continue;

              const product = await tx.queryOne<any>('SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?', [sale.product_id]);
              if (!product) continue;

              // 1. Revert FIFO Lot allocations
              const allocations = await tx.query<any>(`
                SELECT inventory_lot_id, quantity FROM sale_cost_allocations WHERE sale_id = ?
              `, [sale.id]);

              for (const alloc of allocations) {
                await tx.execute(`
                  UPDATE inventory_lots SET quantity_remaining = quantity_remaining + ? WHERE id = ?
                `, [Number(alloc.quantity), alloc.inventory_lot_id]);
              }

              // 2. Update Product Stock and Recalculate Weighted Average Cost
              const newStock = Number(product.current_stock) + Number(sale.quantity);
              totalRestored += Number(sale.quantity);

              const remainingLotsSummary = await tx.queryOne<any>(`
                SELECT 
                  COALESCE(SUM(quantity_remaining), 0) as total_rem,
                  COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
                FROM inventory_lots
                WHERE product_id = ? AND quantity_remaining > 0
              `, [sale.product_id]);

              const totalRem = Number(remainingLotsSummary?.total_rem || 0);
              const totalVal = Number(remainingLotsSummary?.total_val || 0);
              const weightedAvgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : Number(product.current_cost_price);

              await tx.execute(`
                UPDATE products SET current_stock = ?, current_cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
              `, [newStock, weightedAvgCost, sale.product_id]);

              // 3. Stock movement (Type = RETURN)
              await tx.execute(`
                INSERT INTO stock_movements (
                  product_id, movement_type, quantity_change, balance_after,
                  movement_date, reference_type, reference_id, note, created_by
                ) VALUES (?, 'RETURN', ?, ?, ?, 'sales_records', ?, ?, ?)
              `, [
                sale.product_id,
                Number(sale.quantity),
                newStock,
                now,
                sale.id,
                `Hoàn tồn do hủy đơn [${orderCode || sale.transaction_code}] từ Mobile: ${reason}`,
                user.id
              ]);

              // 4. Update sales_record to CANCELLED
              await tx.execute(`
                UPDATE sales_records 
                SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?
                WHERE id = ?
              `, [reason, user.id, sale.id]);

              // 5. Audit log
              await tx.execute(`
                INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
                VALUES (?, 'CANCEL_SALE', 'SALES_RECORDS', ?, ?)
              `, [user.id, sale.id.toString(), JSON.stringify({
                transaction_code: sale.transaction_code,
                product_id: sale.product_id,
                quantity_restored: sale.quantity,
                reason,
                new_stock: newStock,
              })]);
            }

            await tx.execute(`
              INSERT INTO processed_sync_transactions (
                client_transaction_id, entity_type, status, server_id, result_json, payload_hash, payload_json, user_id, device_id, created_at
              ) VALUES (?, ?, 'PROCESSED', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
              clientMutationId,
              'CANCEL_SALE_ORDER',
              salesToCancel[0]?.id || null,
              JSON.stringify({ client_order_id: clientOrderId, cancelled_count: salesToCancel.length, restored_quantity: totalRestored }),
              incomingHash,
              JSON.stringify(payload),
              user.id,
              user.device_id || null,
            ]);

            return {
              status: 'SYNCED',
              server_id: salesToCancel[0]?.id || null,
              created_at: new Date().toISOString(),
            };
          });

          results.push({
            client_mutation_id: clientMutationId,
            status: cancelResult.status,
            server_transaction_id: cancelResult.server_id,
            server_timestamp: cancelResult.created_at,
          });
        } else {
          results.push({
            client_mutation_id: clientMutationId,
            status: 'FAILED',
            error: { code: 'UNSUPPORTED_ENTITY', message: `Entity type '${entityType}' không được hỗ trợ.` },
          });
        }
      } catch (err: any) {
        if (err.conflict) {
          const conflictType = err.code === 'INSUFFICIENT_STOCK'
            ? 'INVENTORY_CONFLICT'
            : (err.code === 'PRODUCT_INACTIVE' || err.code === 'PRODUCT_NOT_FOUND')
            ? 'BUSINESS_CONFLICT'
            : (err.code === 'PAYLOAD_MISMATCH')
            ? 'VALIDATION_CONFLICT'
            : 'BUSINESS_CONFLICT';

          results.push({
            client_mutation_id: clientMutationId,
            status: 'CONFLICT',
            conflict_type: conflictType,
            error: {
              code: err.code || 'BUSINESS_CONFLICT',
              message: err.message,
            },
            server_timestamp: new Date().toISOString(),
          });
        } else {
          results.push({
            client_mutation_id: clientMutationId,
            status: 'FAILED',
            error: {
              code: 'PROCESSING_ERROR',
              message: err.message || 'Lỗi khi xử lý mutation trên máy chủ.',
            },
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        results,
        processed_count: results.length,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'SYNC_PUSH_ERROR', message: error.message || 'Lỗi xử lý push sync.' },
      },
      { status: 500 }
    );
  }
}
