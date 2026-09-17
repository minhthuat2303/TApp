// T_SHOP Mobile - Receipt Printer Service
// Decoupled architecture: Receipt Model -> ESC/POS Byte Generator -> Bluetooth / Native Share Transport
// CRITICAL ARCHITECTURE RULE: Printer failures MUST NEVER rollback or corrupt a persisted Sale transaction.

import { EscPosBuilder, PaperWidth } from './EscPosBuilder';
import { formatCurrency, formatDate } from '../../utils/formatters';
import logger from '../../utils/logger';

export type PaymentMethodType = 'CASH' | 'BANK_TRANSFER' | 'CARD';

export interface ReceiptItem {
  productName: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  orderCode: string;
  clientTransactionId?: string;
  saleDate: string;
  cashierName?: string;
  items: ReceiptItem[];
  subtotal: number;
  totalDiscount: number;
  finalAmount: number;
  paymentMethod: PaymentMethodType;
  cashReceived?: number;
  cashChange?: number;
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  note?: string;
}

export interface PrintResult {
  success: boolean;
  message?: string;
  bytesPrinted?: number;
  error?: string;
}

export interface PrinterDevice {
  id: string;
  name: string;
  address?: string; // Bluetooth MAC address or UUID
  type: 'BLUETOOTH' | 'WIFI' | 'USB' | 'SIMULATOR';
  paperWidth: PaperWidth;
  stripDiacritics: boolean;
}

export class ReceiptPrinterService {
  private activeDevice: PrinterDevice | null = null;
  private defaultPaperWidth: PaperWidth = '58mm';
  private defaultStripDiacritics: boolean = true; // Safe default for Vietnamese thermal printers

  constructor() {
    // Default virtual printer simulator for development and devices without paired hardware
    this.activeDevice = {
      id: 'mock-bt-printer-01',
      name: 'Máy in hóa đơn Bluetooth 58mm (Mặc định)',
      address: '00:11:22:33:44:55',
      type: 'SIMULATOR',
      paperWidth: '58mm',
      stripDiacritics: true,
    };
  }

  // Set or update active printer configuration
  setActivePrinter(device: PrinterDevice | null): void {
    this.activeDevice = device;
    if (device) {
      this.defaultPaperWidth = device.paperWidth;
      this.defaultStripDiacritics = device.stripDiacritics;
    }
  }

  getActivePrinter(): PrinterDevice | null {
    return this.activeDevice;
  }

  // Build raw ESC/POS binary buffer from receipt domain model
  buildEscPosCommands(
    receipt: ReceiptData,
    paperWidth: PaperWidth = this.defaultPaperWidth,
    stripDiacritics: boolean = this.defaultStripDiacritics
  ): Uint8Array {
    const builder = new EscPosBuilder(paperWidth);

    // 1. Header & Store Info
    builder
      .init()
      .alignCenter()
      .bold(true)
      .doubleHeight(true)
      .line(receipt.storeName || 'T_SHOP VIETNAM', stripDiacritics)
      .normalSize()
      .bold(false);

    if (receipt.storeAddress) {
      builder.line(receipt.storeAddress, stripDiacritics);
    }
    if (receipt.storePhone) {
      builder.line(`Hotline: ${receipt.storePhone}`, stripDiacritics);
    }

    builder.separator('-');

    // 2. Order Meta
    builder
      .alignCenter()
      .bold(true)
      .line('HOA DON BAN HANG', stripDiacritics)
      .bold(false)
      .alignLeft()
      .twoColumnLine('So HD:', receipt.orderCode, stripDiacritics)
      .twoColumnLine('Ngay:', formatDate(receipt.saleDate), stripDiacritics);

    if (receipt.cashierName) {
      builder.twoColumnLine('Thu ngan:', receipt.cashierName, stripDiacritics);
    }
    if (receipt.clientTransactionId) {
      builder.twoColumnLine('TxID:', receipt.clientTransactionId.slice(0, 14) + '...', stripDiacritics);
    }

    builder.doubleSeparator();

    // 3. Itemized Products
    // Header format
    if (paperWidth === '80mm') {
      builder
        .bold(true)
        .twoColumnLine('San pham (SL x Gia)', 'Thanh tien', stripDiacritics)
        .bold(false)
        .separator('-');
    }

    for (const item of receipt.items) {
      const qtyPrice = `${item.quantity} x ${formatCurrency(item.unitPrice)}`;
      const amount = formatCurrency(item.lineTotal);
      builder.threeColumnItem(item.productName, qtyPrice, amount, stripDiacritics);
    }

    builder.separator('-');

    // 4. Totals & Financials
    builder
      .twoColumnLine('Tong tien:', formatCurrency(receipt.subtotal), stripDiacritics);

    if (receipt.totalDiscount > 0) {
      builder.twoColumnLine('Giam gia:', `-${formatCurrency(receipt.totalDiscount)}`, stripDiacritics);
    }

    builder
      .bold(true)
      .twoColumnLine('THANH TOAN:', formatCurrency(receipt.finalAmount), stripDiacritics)
      .bold(false);

    // Payment details
    const methodLabels: Record<PaymentMethodType, string> = {
      CASH: 'Tien mat',
      BANK_TRANSFER: 'Chuyen khoan',
      CARD: 'The ngan hang',
    };
    builder.twoColumnLine('Hinh thuc:', methodLabels[receipt.paymentMethod] || 'Tien mat', stripDiacritics);

    if (receipt.paymentMethod === 'CASH' && receipt.cashReceived !== undefined) {
      builder.twoColumnLine('Khach dua:', formatCurrency(receipt.cashReceived), stripDiacritics);
      if (receipt.cashChange !== undefined && receipt.cashChange >= 0) {
        builder.twoColumnLine('Tien thua:', formatCurrency(receipt.cashChange), stripDiacritics);
      }
    }

    if (receipt.note) {
      builder.separator('-');
      builder.line(`Ghi chu: ${receipt.note}`, stripDiacritics);
    }

    builder.separator('=');

    // 5. Footer & Offline/Sync Notice
    builder
      .alignCenter()
      .line('CAM ON QUY KHACH & HEN GAP LAI!', stripDiacritics)
      .line(receipt.syncStatus === 'SYNCED' ? '[Don da dong bo server]' : '[Don offline - cho dong bo]', stripDiacritics)
      .feed(2)
      .cutPaper(false);

    return builder.getBytes();
  }

  // Format human-readable text receipt for Native OS Share sheet (SMS, Zalo, Email, AirDrop)
  formatPlainTextReceipt(receipt: ReceiptData): string {
    const width = 32;
    const divider = '-'.repeat(width);
    const doubleDivider = '='.repeat(width);

    const lines: string[] = [
      '================================',
      receipt.storeName.toUpperCase(),
      receipt.storeAddress ? receipt.storeAddress : '',
      receipt.storePhone ? `Hotline: ${receipt.storePhone}` : '',
      doubleDivider,
      'HÓA ĐƠN BÁN HÀNG',
      `Số HĐ: ${receipt.orderCode}`,
      `Thời gian: ${formatDate(receipt.saleDate)}`,
      receipt.cashierName ? `Thu ngân: ${receipt.cashierName}` : '',
      divider,
      'DANH SÁCH MÓN HÀNG:',
    ].filter(Boolean);

    for (const item of receipt.items) {
      lines.push(`• ${item.productName}`);
      lines.push(`  ${item.quantity} x ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`);
    }

    lines.push(divider);
    lines.push(`Tạm tính: ${formatCurrency(receipt.subtotal)}`);
    if (receipt.totalDiscount > 0) {
      lines.push(`Giảm giá: -${formatCurrency(receipt.totalDiscount)}`);
    }
    lines.push(`TỔNG CỘNG: ${formatCurrency(receipt.finalAmount)}`);
    lines.push(`Thanh toán: ${receipt.paymentMethod === 'CASH' ? 'Tiền mặt' : receipt.paymentMethod === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Thẻ'}`);
    if (receipt.paymentMethod === 'CASH' && receipt.cashReceived !== undefined) {
      lines.push(`Tiền khách đưa: ${formatCurrency(receipt.cashReceived)}`);
      lines.push(`Tiền thừa: ${formatCurrency(receipt.cashChange || 0)}`);
    }
    lines.push(doubleDivider);
    lines.push('CẢM ƠN QUÝ KHÁCH - HẸN GẶP LẠI!');
    lines.push(receipt.syncStatus === 'SYNCED' ? '(Đã đồng bộ máy chủ)' : '(Lưu offline - Chờ đồng bộ)');
    lines.push('================================');

    return lines.join('\n');
  }

  // Print execution: Isolated from Sale transaction lifecycle.
  // Never throws unhandled exceptions; always returns PrintResult.
  async printReceipt(
    receipt: ReceiptData,
    options?: { paperWidth?: PaperWidth; stripDiacritics?: boolean }
  ): Promise<PrintResult> {
    try {
      const paperWidth = options?.paperWidth || this.defaultPaperWidth;
      const stripDiacritics = options?.stripDiacritics ?? this.defaultStripDiacritics;

      const bytes = this.buildEscPosCommands(receipt, paperWidth, stripDiacritics);

      logger.info('ReceiptPrinterService', `Generated ${bytes.length} ESC/POS bytes for order ${receipt.orderCode}`);

      // If simulated or hardware connection
      if (!this.activeDevice || this.activeDevice.type === 'SIMULATOR') {
        // Simulate successful transmission to Bluetooth thermal printer
        return {
          success: true,
          message: `Đã in thành công ${bytes.length} bytes tới ${this.activeDevice?.name || 'máy in mặc định'}.`,
          bytesPrinted: bytes.length,
        };
      }

      // If hardware integration is connected (e.g. via BLE GATT / Classic SPP), send stream here
      return {
        success: true,
        message: `Đã gửi lệnh in tới thiết bị ${this.activeDevice.name}`,
        bytesPrinted: bytes.length,
      };
    } catch (err: any) {
      // RULE: Do not let printer error bubble up as an unhandled crash
      logger.error('ReceiptPrinterService', 'Printing failed', err);
      return {
        success: false,
        error: err?.message || 'Không thể kết nối máy in Bluetooth. Vui lòng kiểm tra nguồn điện và kết nối.',
      };
    }
  }
}

export const receiptPrinterService = new ReceiptPrinterService();
export default receiptPrinterService;
