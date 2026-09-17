import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Chỉ Admin mới có quyền nhập dữ liệu Excel.' } },
        { status: 403 }
      );
    }

    const formData = (await request.formData()) as unknown as globalThis.FormData;
    const fileEntry = formData.get('file');
    const entityTypeEntry = formData.get('entityType');
    const entityType = typeof entityTypeEntry === 'string' && entityTypeEntry.trim() ? entityTypeEntry.trim() : 'products';

    const file = fileEntry instanceof File ? fileEntry : null;
    if (!file) {
      return NextResponse.json(
        { success: false, error: { code: 'NO_FILE', message: 'Vui lòng chọn file Excel (.xlsx hoặc .xls).' } },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_FILE_TYPE', message: 'Chỉ chấp nhận định dạng file .xlsx hoặc .xls.' } },
        { status: 400 }
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: { code: 'FILE_TOO_LARGE', message: 'Kích thước file không được vượt quá 5MB.' } },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return NextResponse.json(
        { success: false, error: { code: 'EMPTY_SHEET', message: 'File Excel không có dữ liệu sheet.' } },
        { status: 400 }
      );
    }

    const rawRows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[firstSheetName]);

    if (!rawRows || rawRows.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'EMPTY_FILE', message: 'File Excel không có dòng dữ liệu nào.' } },
        { status: 400 }
      );
    }

    if (entityType === 'products') {
      const existingProducts = await db.query('SELECT * FROM products');
      const categories = await db.query('SELECT id, code, name FROM categories');
      const productTypes = await db.query('SELECT id, code, name, category_id FROM product_types');

      const catMap = new Map<string, any>();
      categories.forEach((c) => {
        catMap.set(c.code.toUpperCase(), c);
        catMap.set(c.name.toLowerCase(), c);
      });

      const typeMap = new Map<string, any>();
      productTypes.forEach((t) => {
        typeMap.set(t.code.toUpperCase(), t);
        typeMap.set(t.name.toLowerCase(), t);
      });

      const prodMap = new Map<string, any>();
      existingProducts.forEach((p) => {
        prodMap.set(p.sku.toUpperCase(), p);
      });

      const seenSkusInFile = new Set<string>();

      const creates: any[] = [];
      const updates: any[] = [];
      const unchanged: any[] = [];
      const errors: any[] = [];

      rawRows.forEach((row, index) => {
        const rowNumber = index + 2;

        const skuRaw = row['Mã SKU (*)'] || row['SKU'] || row['sku'] || row['Mã sản phẩm'];
        const nameRaw = row['Tên sản phẩm (*)'] || row['Tên sản phẩm'] || row['name'];
        const catRaw = row['Mã danh mục (*)'] || row['Danh mục'] || row['category'];
        const typeRaw = row['Mã loại SP (*)'] || row['Loại sản phẩm'] || row['type'];
        const costRaw = row['Giá nhập hiện tại'] ?? row['Giá nhập'] ?? row['cost_price'];
        const priceRaw = row['Giá bán hiện tại'] ?? row['Giá bán'] ?? row['selling_price'];
        const stockRaw = row['Số lượng tồn'] ?? row['Tồn kho'] ?? row['stock'];
        const minAlertRaw = row['Ngưỡng cảnh báo tồn'] ?? row['Cảnh báo tồn'] ?? 5;

        if (!skuRaw) {
          errors.push({ rowNumber, message: 'Thiếu mã SKU/Mã sản phẩm bắt buộc.', data: row });
          return;
        }

        const sku = String(skuRaw).trim().toUpperCase();

        if (seenSkusInFile.has(sku)) {
          errors.push({ rowNumber, message: `Trùng lặp mã SKU '${sku}' trong cùng file Excel.`, data: row });
          return;
        }
        seenSkusInFile.add(sku);

        if (!nameRaw) {
          errors.push({ rowNumber, message: `SKU '${sku}': Thiếu tên sản phẩm.`, data: row });
          return;
        }

        const name = String(nameRaw).trim();

        const catKey = String(catRaw || '').trim().toUpperCase();
        const category = catMap.get(catKey) || catMap.get(catKey.toLowerCase());
        if (!category) {
          errors.push({ rowNumber, message: `SKU '${sku}': Danh mục '${catRaw}' không tồn tại trong hệ thống.`, data: row });
          return;
        }

        const typeKey = String(typeRaw || '').trim().toUpperCase();
        const productType = typeMap.get(typeKey) || typeMap.get(typeKey.toLowerCase());
        if (!productType) {
          errors.push({ rowNumber, message: `SKU '${sku}': Loại sản phẩm '${typeRaw}' không tồn tại trong hệ thống.`, data: row });
          return;
        }

        const costPrice = Number(costRaw) || 0;
        const sellingPrice = Number(priceRaw) || 0;
        const stock = Number(stockRaw) || 0;
        const minAlert = Number(minAlertRaw) || 5;

        if (costPrice < 0 || sellingPrice < 0 || stock < 0 || minAlert < 0) {
          errors.push({ rowNumber, message: `SKU '${sku}': Giá hoặc số lượng không được âm.`, data: row });
          return;
        }

        const existing = prodMap.get(sku);

        if (!existing) {
          creates.push({
            rowNumber,
            sku,
            name,
            category_id: category.id,
            category_name: category.name,
            product_type_id: productType.id,
            product_type_name: productType.name,
            cost_price: costPrice,
            selling_price: sellingPrice,
            stock,
            min_stock_alert: minAlert,
          });
        } else {
          const changes: string[] = [];
          if (existing.name !== name) changes.push(`Tên: '${existing.name}' → '${name}'`);
          if (existing.category_id !== category.id) changes.push(`Danh mục đổi sang '${category.name}'`);
          if (existing.product_type_id !== productType.id) changes.push(`Loại SP đổi sang '${productType.name}'`);
          if (Number(existing.current_selling_price) !== sellingPrice) {
            changes.push(`Giá bán: ${Number(existing.current_selling_price).toLocaleString('vi-VN')}đ → ${sellingPrice.toLocaleString('vi-VN')}đ`);
          }
          if (Number(existing.current_cost_price) !== costPrice) {
            changes.push(`Giá vốn: ${Number(existing.current_cost_price).toLocaleString('vi-VN')}đ → ${costPrice.toLocaleString('vi-VN')}đ`);
          }

          if (changes.length > 0) {
            updates.push({
              rowNumber,
              id: existing.id,
              sku,
              name,
              category_id: category.id,
              category_name: category.name,
              product_type_id: productType.id,
              product_type_name: productType.name,
              cost_price: costPrice,
              selling_price: sellingPrice,
              stock: existing.current_stock,
              min_stock_alert: minAlert,
              changes,
            });
          } else {
            unchanged.push({
              rowNumber,
              sku,
              name,
              category_name: category.name,
              product_type_name: productType.name,
            });
          }
        }
      });

      return NextResponse.json({
        success: true,
        data: {
          fileName: file.name,
          entityType,
          totalRows: rawRows.length,
          creates,
          updates,
          unchanged,
          errors,
          canCommit: errors.length === 0 || creates.length > 0 || updates.length > 0,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: { code: 'UNSUPPORTED_ENTITY', message: `Chưa hỗ trợ preview cho ${entityType}.` } },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'PARSE_ERROR', message: error.message || 'Lỗi đọc file Excel.' } },
      { status: 500 }
    );
  }
}
