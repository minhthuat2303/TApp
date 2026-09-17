// T_SHOP Mobile - POS Checkout Screen
// Offline-First Native Retail Checkout: Search/Scan -> Cart -> Stock Check -> Payment -> SQLite Atomic Transaction -> Outbox -> Receipt Modal -> ESC/POS Print

import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Alert,
  Modal,
  FlatList,
  TextInput,
  ActivityIndicator,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import EmptyState from '../../components/common/EmptyState';
import NetworkBanner from '../../components/common/NetworkBanner';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';
import productRepository from '../../repository/ProductRepository';
import saleRepository from '../../repository/SaleRepository';
import exportService from '../../services/ExportService';
import { Product, SalesRecord } from '../../types/domain';
import { SalesOrder } from '../../database/types';
import { useAuth } from '../../auth/AuthContext';
import BarcodeScannerModal from '../../components/scanner/BarcodeScannerModal';
import ReceiptModal from './ReceiptModal';
import { ReceiptData, PaymentMethodType } from '../../services/printer/ReceiptPrinterService';
import { matchesVietnameseSearch, calculateSearchRank } from '../../utils/vietnameseUtils';

interface CartItem {
  product: Product;
  qty: number;
  discount: number;
}

interface QuickDiscountPreset {
  label: string;
  value: number;
  type: 'fixed' | 'percent';
}

const QUICK_DISCOUNTS: QuickDiscountPreset[] = [
  { label: '0đ', value: 0, type: 'fixed' },
  { label: '10.000đ', value: 10000, type: 'fixed' },
  { label: '20.000đ', value: 20000, type: 'fixed' },
  { label: '50.000đ', value: 50000, type: 'fixed' },
  { label: '100.000đ', value: 100000, type: 'fixed' },
  { label: '5%', value: 5, type: 'percent' },
  { label: '10%', value: 10, type: 'percent' },
  { label: '20%', value: 20, type: 'percent' },
];

const COMMON_CASH_DENOMINATIONS = [
  50000,
  100000,
  200000,
  500000,
  1000000,
  2000000,
];

export const SalesScreen: React.FC = () => {
  const { user } = useAuth();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleNote, setSaleNote] = useState('');
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);

  // Modals state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [receiptVisible, setReceiptVisible] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState<ReceiptData | null>(null);
  const [checkoutConfirmModalVisible, setCheckoutConfirmModalVisible] = useState(false);

  // Multi-item selection state for warehouse picker
  const [selectedPickerItems, setSelectedPickerItems] = useState<Record<number, number>>({});

  // Discount state
  const [orderDiscountInput, setOrderDiscountInput] = useState<string>('');

  // Payment Engine state
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('CASH');
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');

  // Tab state: 'pos' vs 'history'
  const [activeTab, setActiveTab] = useState<'pos' | 'history'>('pos');

  // Sales History state
  const [historyOrders, setHistoryOrders] = useState<SalesOrder[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyDateFilter, setHistoryDateFilter] = useState<'ALL' | 'TODAY' | '7DAYS' | '30DAYS'>('ALL');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'ALL' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<'ALL' | 'CASH' | 'BANK_TRANSFER' | 'CARD'>('ALL');

  // Sale Detail Modal state
  const [saleDetailModalVisible, setSaleDetailModalVisible] = useState(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<{
    order: SalesOrder;
    items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }>;
  } | null>(null);
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false);

  // Sale Cancellation & Detail Mode state
  const [detailViewMode, setDetailViewMode] = useState<'DETAIL' | 'CANCEL'>('DETAIL');
  const [cancelReason, setCancelReason] = useState('Khách đổi ý không mua');
  const [cancellingSale, setCancellingSale] = useState(false);
  const [exportingSales, setExportingSales] = useState(false);

  // KPI metrics
  const completedHistoryOrders = historyOrders.filter((o) => o.status === 'COMPLETED');
  const cancelledHistoryOrders = historyOrders.filter((o) => o.status === 'CANCELLED');
  const historyCompletedRevenue = completedHistoryOrders.reduce((sum, o) => sum + (o.final_amount || 0), 0);

  // Load Sales History
  const loadSalesHistory = async () => {
    setLoadingHistory(true);
    try {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      let startDate: string | undefined;
      let endDate: string | undefined;

      if (historyDateFilter === 'TODAY') {
        startDate = todayStr;
        endDate = todayStr;
      } else if (historyDateFilter === '7DAYS') {
        const d7 = new Date();
        d7.setDate(d7.getDate() - 7);
        startDate = d7.toISOString().slice(0, 10);
        endDate = todayStr;
      } else if (historyDateFilter === '30DAYS') {
        const d30 = new Date();
        d30.setDate(d30.getDate() - 30);
        startDate = d30.toISOString().slice(0, 10);
        endDate = todayStr;
      }

      const orders = await saleRepository.getSalesHistory({
        startDate,
        endDate,
        status: historyStatusFilter === 'ALL' ? undefined : historyStatusFilter,
        paymentMethod: historyPaymentFilter === 'ALL' ? undefined : historyPaymentFilter,
        search: historySearchQuery.trim() || undefined,
        limit: 100,
      });
      setHistoryOrders(orders);
    } catch (err) {
      console.error('Error loading sales history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      loadSalesHistory();
    }
  }, [activeTab, historyDateFilter, historyStatusFilter, historyPaymentFilter, historySearchQuery]);

  const handleOpenSaleDetail = async (order: SalesOrder) => {
    setLoadingOrderDetail(true);
    setDetailViewMode('DETAIL');
    try {
      const detail = await saleRepository.getSaleOrderDetail(order.id || order.client_order_id);
      if (detail) {
        setSelectedOrderDetail(detail);
        setSaleDetailModalVisible(true);
      } else {
        showAlert('Không tìm thấy', 'Không tìm thấy chi tiết cho đơn hàng này.');
      }
    } catch (err: any) {
      showAlert('Lỗi', err?.message || 'Không thể tải chi tiết đơn hàng.');
    } finally {
      setLoadingOrderDetail(false);
    }
  };

  const handleReprintReceipt = () => {
    if (!selectedOrderDetail) return;
    const { order, items } = selectedOrderDetail;
    const receipt: ReceiptData = {
      storeName: 'T_SHOP VIỆT NAM',
      storeAddress: '123 Phố Đồ Chơi, Hà Nội',
      storePhone: '1900 6868',
      orderCode: order.order_code,
      clientTransactionId: order.client_order_id,
      saleDate: order.sale_date || order.created_at,
      cashierName: (order as any).seller_name || user?.full_name || user?.username || 'Thu ngân',
      items: items.map((it) => ({
        productName: it.product_name || 'Sản phẩm',
        sku: it.sku || '',
        quantity: it.quantity,
        unitPrice: it.unit_price_at_sale || (it as any).unit_price || 0,
        lineTotal: it.total_revenue || (it as any).line_total || 0,
      })),
      subtotal: order.total_amount,
      totalDiscount: order.total_discount,
      finalAmount: order.final_amount,
      paymentMethod: (order.payment_method as PaymentMethodType) || 'CASH',
      cashReceived: order.cash_received || order.final_amount,
      cashChange: order.cash_change || 0,
      syncStatus: order.sync_status || 'PENDING',
      note: order.note || undefined,
    };
    setCompletedReceipt(receipt);
    setReceiptVisible(true);
  };

  const handleOpenCancelConfirmation = () => {
    setCancelReason('Khách đổi ý không mua');
    setDetailViewMode('CANCEL');
  };

  const handleConfirmCancelSale = async () => {
    if (!selectedOrderDetail) return;
    const finalReason = (cancelReason || '').trim() || 'Khách đổi ý không mua';
    setCancellingSale(true);
    try {
      const order = selectedOrderDetail.order;
      const res = await saleRepository.cancelSaleOrder({
        orderId: order.id,
        clientOrderId: order.client_order_id,
        reason: finalReason,
        userId: user?.id || 1,
        userRole: user?.role || 'ADMIN',
      });

      // Refresh order detail
      const refreshedDetail = await saleRepository.getSaleOrderDetail(order.id || order.client_order_id);
      setSelectedOrderDetail(refreshedDetail);

      // Return to detail view mode
      setDetailViewMode('DETAIL');
      setCancelReason('Khách đổi ý không mua');

      // Refresh sales history list
      await loadSalesHistory();

      // Refresh POS stock
      await loadProducts();

      showAlert(
        'Đã hủy đơn hàng',
        `Đơn hàng [${order.order_code}] đã được hủy thành công.\nĐã hoàn trả ${res.restoredQuantity} sản phẩm vào kho khả dụng.`
      );
    } catch (err: any) {
      console.error('Error cancelling sale:', err);
      showAlert('Lỗi hủy đơn hàng', err?.message || 'Không thể hủy đơn hàng.');
    } finally {
      setCancellingSale(false);
    }
  };

  // --- EXPORT SALES HISTORY HANDLER ---
  const handleExportSalesHistory = async () => {
    setExportingSales(true);
    try {
      const dateTag = new Date().toISOString().slice(0, 10);
      const content = await exportService.exportSalesOrdersCsv(365);
      const filename = `Lich_su_ban_hang_${dateTag}.csv`;
      await exportService.shareOrDownloadFile(filename, content);
      showAlert('Xuất lịch sử bán hàng thành công! 📤', `Đã xuất ${historyOrders.length} đơn hàng ra file [${filename}].`);
    } catch (err: any) {
      showAlert('Lỗi xuất dữ liệu', err?.message || 'Không thể xuất lịch sử bán hàng.');
    } finally {
      setExportingSales(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      const prods = await productRepository.getAll();
      setAvailableProducts(prods.filter((p) => (p.status || 'ACTIVE') === 'ACTIVE'));
    } catch (err) {
      console.error('Error loading products for POS:', err);
    }
  }

  const addProductToCart = (prod: Product) => {
    // Inactive status validation
    if (prod.status === 'INACTIVE') {
      showAlert(
        'Tạm ngừng bán',
        `Sản phẩm "${prod.name}" hiện đang ở trạng thái tạm ngừng bán, không thể đưa vào đơn bán.`
      );
      return;
    }

    // Local stock pre-validation
    const existing = cart.find((it) => it.product.id === prod.id);
    const targetQty = (existing?.qty || 0) + 1;

    if (targetQty > prod.current_stock) {
      Alert.alert(
        'Cảnh báo tồn kho',
        `Sản phẩm "${prod.name}" chỉ còn ${prod.current_stock} cái trong kho khả dụng.`,
        [{ text: 'Đã hiểu' }]
      );
      if (prod.current_stock <= 0) return;
    }

    setCart((prev) => {
      const it = prev.find((i) => i.product.id === prod.id);
      if (it) {
        return prev.map((i) =>
          i.product.id === prod.id ? { ...i, qty: i.qty + 1 } : i
        );
      }
      return [...prev, { product: prod, qty: 1, discount: 0 }];
    });
    setPickerVisible(false);
  };

  // Barcode scan lookup handler
  const handleBarcodeScan = async (barcode: string) => {
    const trimmed = barcode.trim();
    // 1. Check in loaded cache first
    let prod = availableProducts.find(
      (p) => p.sku.toLowerCase() === trimmed.toLowerCase() || p.id.toString() === trimmed
    );

    // 2. Query local SQLite if not found in cache
    if (!prod) {
      const dbProd = await productRepository.getByBarcode(trimmed);
      if (dbProd) {
        prod = dbProd;
      }
    }

    if (!prod) {
      return {
        success: false,
        message: `Không tìm thấy sản phẩm nào khớp với mã "${trimmed}".`,
      };
    }

    if (prod.status === 'INACTIVE') {
      return {
        success: false,
        message: `Sản phẩm "${prod.name}" hiện đang tạm ngừng bán.`,
      };
    }

    // 3. Stock validation
    const inCart = cart.find((it) => it.product.id === prod!.id);
    const targetQty = (inCart?.qty || 0) + 1;

    if (targetQty > prod.current_stock) {
      return {
        success: false,
        message: `Sản phẩm "${prod.name}" chỉ còn ${prod.current_stock} trong kho (hiện giỏ: ${inCart?.qty || 0}).`,
      };
    }

    addProductToCart(prod);
    return {
      success: true,
      message: `Đã thêm: ${prod.name} (+1)`,
    };
  };

  const updateQty = (id: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === id) {
            const nextQty = item.qty + delta;
            if (nextQty > item.product.current_stock) {
              Alert.alert(
                'Vượt quá tồn kho',
                `Kho chỉ còn ${item.product.current_stock} cái khả dụng.`
              );
              return item;
            }
            const validQty = Math.max(1, nextQty);
            // Cap line discount to new line total
            const maxDisc = validQty * item.product.current_selling_price;
            return { ...item, qty: validQty, discount: Math.min(item.discount, maxDisc) };
          }
          return item;
        })
        .filter((item) => item.qty > 0)
    );
  };

  const removeItem = (id: number) => {
    setCart((prev) => {
      const updated = prev.filter((item) => item.product.id !== id);
      if (updated.length === 0) {
        setOrderDiscountInput('');
      }
      return updated;
    });
  };

  const totalItems = cart.reduce((acc, it) => acc + it.qty, 0);
  const subtotal = cart.reduce((acc, it) => acc + it.product.current_selling_price * it.qty, 0);
  const totalDiscount = cart.reduce((acc, it) => acc + (it.discount || 0), 0);
  const finalTotal = Math.max(0, subtotal - totalDiscount);

  // Financial & Change Calculations
  const numericCashReceived = cashReceivedInput.trim() ? parseInt(cashReceivedInput.replace(/\D/g, ''), 10) || 0 : 0;
  const cashChange = paymentMethod === 'CASH' ? Math.max(0, numericCashReceived - finalTotal) : 0;
  const isCashInsufficient = paymentMethod === 'CASH' && numericCashReceived < finalTotal && numericCashReceived > 0;

  // Set quick cash amount
  const handleQuickCash = (amount: number) => {
    setCashReceivedInput(amount.toString());
  };

  // --- DISCOUNT BUSINESS LOGIC HANDLERS ---
  // Handle per-item discount change (Supports Web-style thousand input e.g. 5 = 5.000đ or direct VND)
  const handleItemDiscountChange = (productId: number, text: string) => {
    const rawDigits = text.replace(/\D/g, '');
    const num = parseInt(rawDigits, 10) || 0;

    let discountVal = num;
    if (num > 0 && num < 1000) {
      discountVal = num * 1000;
    }

    setCart((prev) => {
      const updated = prev.map((it) => {
        if (it.product.id === productId) {
          const maxAllowed = it.qty * it.product.current_selling_price;
          const clamped = Math.min(maxAllowed, Math.max(0, discountVal));
          return { ...it, discount: clamped };
        }
        return it;
      });
      const newTotalDiscount = updated.reduce((acc, it) => acc + (it.discount || 0), 0);
      setOrderDiscountInput(newTotalDiscount > 0 ? newTotalDiscount.toLocaleString('vi-VN') : '');
      return updated;
    });
  };

  // Distribute an order-level discount proportionally across all cart items
  const distributeOrderDiscount = (totalDisc: number) => {
    const currentSubtotal = cart.reduce((acc, it) => acc + it.product.current_selling_price * it.qty, 0);
    const clampedTotal = Math.min(currentSubtotal, Math.max(0, totalDisc));

    if (cart.length === 0 || currentSubtotal === 0) return;

    let allocatedSum = 0;
    setCart((prev) =>
      prev.map((it, idx) => {
        const lineSubtotal = it.qty * it.product.current_selling_price;
        let lineDiscount = 0;
        if (idx === prev.length - 1) {
          lineDiscount = clampedTotal - allocatedSum;
        } else {
          lineDiscount = Math.round((lineSubtotal / currentSubtotal) * clampedTotal);
          allocatedSum += lineDiscount;
        }
        lineDiscount = Math.min(lineSubtotal, Math.max(0, lineDiscount));
        return { ...it, discount: lineDiscount };
      })
    );
  };

  // Handle order-level discount numeric input
  const handleOrderDiscountInput = (text: string) => {
    setOrderDiscountInput(text);
    const rawDigits = text.replace(/\D/g, '');
    const num = parseInt(rawDigits, 10) || 0;

    let discountVal = num;
    if (num > 0 && num < 1000) {
      discountVal = num * 1000;
    }

    distributeOrderDiscount(discountVal);
  };

  // Apply quick preset chip (e.g. 10k, 50k, 10%)
  const handleApplyQuickDiscount = (preset: QuickDiscountPreset) => {
    let discAmount = 0;
    if (preset.type === 'fixed') {
      discAmount = preset.value;
    } else {
      discAmount = Math.round(subtotal * (preset.value / 100));
    }
    discAmount = Math.min(subtotal, Math.max(0, discAmount));
    setOrderDiscountInput(discAmount > 0 ? discAmount.toLocaleString('vi-VN') : '');
    distributeOrderDiscount(discAmount);
  };

  const handleClearAllDiscounts = () => {
    setOrderDiscountInput('');
    setCart((prev) => prev.map((it) => ({ ...it, discount: 0 })));
  };

  const isPresetActive = (preset: QuickDiscountPreset) => {
    if (preset.value === 0 && totalDiscount === 0) return true;
    if (preset.type === 'fixed' && totalDiscount === preset.value) return true;
    if (preset.type === 'percent' && subtotal > 0 && Math.round(subtotal * (preset.value / 100)) === totalDiscount) return true;
    return false;
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // Multi-item warehouse picker actions
  const togglePickerProduct = (prod: Product) => {
    if (prod.current_stock <= 0) {
      showAlert('Hết hàng', `Sản phẩm "${prod.name}" hiện đã hết hàng khả dụng.`);
      return;
    }
    setSelectedPickerItems((prev) => {
      const copy = { ...prev };
      if (copy[prod.id]) {
        delete copy[prod.id];
      } else {
        copy[prod.id] = 1;
      }
      return copy;
    });
  };

  const updatePickerItemQty = (prod: Product, delta: number) => {
    setSelectedPickerItems((prev) => {
      const copy = { ...prev };
      const current = copy[prod.id] || 0;
      const next = current + delta;
      if (next <= 0) {
        delete copy[prod.id];
      } else if (next > prod.current_stock) {
        showAlert('Vượt quá tồn kho', `Sản phẩm "${prod.name}" chỉ còn ${prod.current_stock} cái trong kho.`);
        copy[prod.id] = prod.current_stock;
      } else {
        copy[prod.id] = next;
      }
      return copy;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedPickerItems((prev) => {
      const copy = { ...prev };
      filteredPickerProducts.forEach((p) => {
        if (p.current_stock > 0 && !copy[p.id]) {
          copy[p.id] = 1;
        }
      });
      return copy;
    });
  };

  const handleDeselectAll = () => {
    setSelectedPickerItems({});
  };

  const handleAddSelectedToCart = () => {
    const selectedIds = Object.keys(selectedPickerItems).map(Number);
    if (selectedIds.length === 0) {
      showAlert('Chưa chọn sản phẩm', 'Vui lòng tích chọn ít nhất một sản phẩm để thêm vào giỏ.');
      return;
    }

    setCart((prevCart) => {
      let updated = [...prevCart];
      for (const id of selectedIds) {
        const prod = availableProducts.find((p) => p.id === id);
        const qtyToAdd = selectedPickerItems[id] || 1;
        if (!prod) continue;

        const existingIdx = updated.findIndex((it) => it.product.id === id);
        if (existingIdx >= 0) {
          const newQty = Math.min(prod.current_stock, updated[existingIdx].qty + qtyToAdd);
          updated[existingIdx] = {
            ...updated[existingIdx],
            qty: newQty,
          };
        } else {
          updated.push({
            product: prod,
            qty: Math.min(prod.current_stock, qtyToAdd),
            discount: 0,
          });
        }
      }
      return updated;
    });

    setSelectedPickerItems({});
    setPickerVisible(false);
  };

  // Checkout execution
  const executeSaleCheckout = async () => {
    setCheckingOut(true);
    try {
      // 1. Atomic Checkout via Service Layer
      const result = await saleRepository.createMultiItemSale({
        items: cart.map((it) => ({
          productId: it.product.id,
          quantity: it.qty,
          unitPrice: it.product.current_selling_price,
          discount: it.discount,
        })),
        totalDiscount,
        note: saleNote || undefined,
        createdBy: user?.id,
      });

      const effectiveReceived = paymentMethod === 'CASH'
        ? (numericCashReceived > 0 ? numericCashReceived : finalTotal)
        : finalTotal;

      const calculatedChange = Math.max(0, effectiveReceived - finalTotal);

      // 2. Prepare Immutable Receipt Model from persisted transaction
      const receipt: ReceiptData = {
        storeName: 'T_SHOP VIỆT NAM',
        storeAddress: '123 Phố Đồ Chơi, Hà Nội',
        storePhone: '1900 6868',
        orderCode: result.order.order_code,
        clientTransactionId: result.order.client_order_id,
        saleDate: result.order.sale_date || new Date().toISOString(),
        cashierName: user?.full_name || user?.username || 'Thu ngân',
        items: cart.map((it) => ({
          productName: it.product.name,
          sku: it.product.sku,
          quantity: it.qty,
          unitPrice: it.product.current_selling_price,
          lineTotal: it.product.current_selling_price * it.qty - it.discount,
        })),
        subtotal,
        totalDiscount,
        finalAmount: result.order.final_amount,
        paymentMethod,
        cashReceived: effectiveReceived,
        cashChange: calculatedChange,
        syncStatus: result.order.sync_status || 'PENDING',
        note: saleNote || undefined,
      };

      // 3. Close confirmation modal, open receipt modal
      setCheckoutConfirmModalVisible(false);
      setCompletedReceipt(receipt);
      setReceiptVisible(true);

      // 4. Reset Cart and Inputs
      setCart([]);
      setSaleNote('');
      setCashReceivedInput('');

      // Refresh local products stock in state
      await loadProducts();
    } catch (err: any) {
      console.error('POS Sale Checkout error:', err);
      showAlert('Lỗi tạo đơn hàng', err?.message || 'Không thể tạo đơn hàng.');
    } finally {
      setCheckingOut(false);
    }
  };

  const handleCheckout = () => {
    if (cart.length === 0) {
      showAlert('Giỏ hàng trống', 'Vui lòng thêm sản phẩm vào giỏ trước khi thanh toán.');
      return;
    }

    // Payment validation
    if (paymentMethod === 'CASH') {
      const effectiveCash = numericCashReceived > 0 ? numericCashReceived : finalTotal;
      if (effectiveCash < finalTotal) {
        showAlert(
          'Tiền khách đưa chưa đủ',
          `Tổng đơn hàng là ${formatCurrency(finalTotal)}, nhưng số tiền khách đưa mới là ${formatCurrency(effectiveCash)}.`
        );
        return;
      }
    }

    // Open dedicated In-App Confirmation Modal (works 100% reliably on Mobile & Web)
    setCheckoutConfirmModalVisible(true);
  };

  const filteredPickerProducts = availableProducts
    .filter((p) => (p.status || 'ACTIVE') === 'ACTIVE')
    .map((p) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        return { product: p, rank: 50 };
      }
      const rank = calculateSearchRank(p.name, p.sku, trimmed, p.id.toString());
      const isMatch = rank > 0 ||
        matchesVietnameseSearch(p.name, trimmed) ||
        matchesVietnameseSearch(p.sku, trimmed) ||
        (p.category_name ? matchesVietnameseSearch(p.category_name, trimmed) : false);
      return { product: p, rank: isMatch ? (rank || 50) : 0 };
    })
    .filter((item) => item.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .map((item) => item.product);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NetworkBanner />

      <View style={styles.container}>
        {/* Top Tab Switcher: POS Checkout vs Sales History */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'pos' && styles.activeTabBtn]}
            onPress={() => setActiveTab('pos')}
          >
            <Text style={[styles.tabText, activeTab === 'pos' && styles.activeTabText]}>
              🛒 Thu ngân POS {cart.length > 0 ? `(${cart.length})` : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'history' && styles.activeTabBtn]}
            onPress={() => {
              setActiveTab('history');
              loadSalesHistory();
            }}
          >
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>
              📜 Lịch sử bán hàng {historyOrders.length > 0 ? `(${historyOrders.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* TAB 1: POS CHECKOUT */}
        {activeTab === 'pos' && (
          <View style={{ flex: 1 }}>
            {/* Top POS Action Toolbar */}
            <View style={styles.topToolbar}>
              <TouchableOpacity
                style={styles.scanBarcodeBtn}
                onPress={() => setScannerVisible(true)}
              >
                <Text style={styles.scanBarcodeIcon}>📷</Text>
                <Text style={styles.scanBarcodeText}>Quét Barcode / QR</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.addProductBtn}
                onPress={() => setPickerVisible(true)}
              >
                <Text style={styles.addProductIcon}>➕</Text>
                <Text style={styles.addProductText}>Chọn từ kho</Text>
              </TouchableOpacity>
            </View>

            {/* Cart items list */}
            <ScrollView contentContainerStyle={styles.cartList} showsVerticalScrollIndicator={false}>
              <View style={styles.cartHeaderRow}>
                <Text style={styles.cartTitle}>Giỏ hàng POS ({totalItems} món)</Text>
                {cart.length > 0 && (
                  <TouchableOpacity onPress={() => setCart([])}>
                    <Text style={styles.clearCartText}>Xóa hết</Text>
                  </TouchableOpacity>
                )}
              </View>

              {cart.length === 0 ? (
                <Card style={styles.emptyCartCard}>
                  <Text style={styles.emptyIcon}>🛒</Text>
                  <Text style={styles.emptyTitle}>Chưa có món hàng nào</Text>
                  <Text style={styles.emptySubtitle}>
                    Bấm "📷 Quét Barcode" hoặc "➕ Chọn từ kho" để bắt đầu đơn bán
                  </Text>
                </Card>
              ) : (
                cart.map((it) => {
                  const lineTotal = it.product.current_selling_price * it.qty - it.discount;
                  const isLowStock = it.qty >= it.product.current_stock;

                  return (
                    <Card key={it.product.id} style={styles.cartItemCard}>
                      <View style={styles.itemHeader}>
                        <View style={styles.skuTag}>
                          <Text style={styles.skuText}>{it.product.sku}</Text>
                        </View>
                        <View style={styles.itemHeaderRight}>
                          {isLowStock && (
                            <Text style={styles.stockWarnText}>Tối đa ({it.product.current_stock})</Text>
                          )}
                          <TouchableOpacity onPress={() => removeItem(it.product.id)}>
                            <Text style={styles.deleteIcon}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <Text style={styles.productName}>{it.product.name}</Text>
                      <Text style={styles.itemPriceText}>
                        Đơn giá: {formatCurrency(it.product.current_selling_price)}
                      </Text>

                      <View style={styles.stepperRow}>
                        <View style={styles.stepperWrapper}>
                          <TouchableOpacity
                            style={styles.stepBtn}
                            onPress={() => updateQty(it.product.id, -1)}
                          >
                            <Text style={styles.stepBtnText}>-</Text>
                          </TouchableOpacity>
                          <Text style={styles.qtyText}>{it.qty}</Text>
                          <TouchableOpacity
                            style={[styles.stepBtn, isLowStock && styles.stepBtnDisabled]}
                            onPress={() => updateQty(it.product.id, 1)}
                            disabled={isLowStock}
                          >
                            <Text style={[styles.stepBtnText, isLowStock && styles.stepBtnTextDisabled]}>+</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={styles.lineTotalWrapper}>
                          <Text style={styles.lineTotalLabel}>Thành tiền:</Text>
                          <Text style={styles.lineTotalValue}>{formatCurrency(lineTotal)}</Text>
                        </View>
                      </View>

                      {/* Item-level discount row */}
                      <View style={styles.itemDiscountRow}>
                        <View style={styles.itemDiscountLeft}>
                          <Text style={styles.itemDiscountLabel}>🏷️ Giảm giá món:</Text>
                          <Text style={styles.itemDiscountHint}>(kđ hoặc VND)</Text>
                        </View>
                        <View style={styles.itemDiscountInputWrapper}>
                          <TextInput
                            style={[styles.itemDiscountInput, it.discount > 0 && styles.itemDiscountInputActive]}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={Colors.textMuted}
                            value={it.discount > 0 ? (it.discount >= 1000 ? (it.discount / 1000).toString() : it.discount.toString()) : ''}
                            onChangeText={(text) => handleItemDiscountChange(it.product.id, text)}
                          />
                          <Text style={styles.itemDiscountUnit}>kđ</Text>
                          {it.discount > 0 && (
                            <TouchableOpacity
                              style={styles.itemDiscountClearBtn}
                              onPress={() => handleItemDiscountChange(it.product.id, '0')}
                            >
                              <Text style={styles.itemDiscountClearText}>✕</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        {it.discount > 0 && (
                          <Text style={styles.itemDiscountFormatted}>-{formatCurrency(it.discount)}</Text>
                        )}
                      </View>
                    </Card>
                  );
                })
              )}

              {/* Order Summary & Discount Section */}
              {cart.length > 0 && (
                <Card style={styles.orderSummaryCard}>
                  <View style={styles.orderSummaryHeader}>
                    <Text style={styles.orderSummaryTitle}>THÔNG TIN THANH TOÁN</Text>
                    <Text style={styles.orderSummaryCount}>{totalItems} món ({cart.length} loại)</Text>
                  </View>

                  {/* 1. TẠM TÍNH */}
                  <View style={styles.calcRow}>
                    <Text style={styles.calcLabel}>1. Tạm tính:</Text>
                    <Text style={styles.calcValue}>{formatCurrency(subtotal)}</Text>
                  </View>

                  {/* 2. KHUNG NHẬP GIẢM GIÁ */}
                  <View style={styles.discountBox}>
                    <View style={styles.discountHeader}>
                      <Text style={styles.discountHeaderTitle}>2. Giảm giá đơn hàng:</Text>
                      {totalDiscount > 0 && (
                        <TouchableOpacity onPress={handleClearAllDiscounts}>
                          <Text style={styles.clearDiscountBtn}>✕ Bỏ giảm giá</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.discountInputContainer}>
                      <TextInput
                        style={[styles.discountInputField, totalDiscount > 0 && styles.discountInputActive]}
                        keyboardType="numeric"
                        placeholder="Nhập số tiền giảm (VD: 50.000đ hoặc 50)..."
                        placeholderTextColor={Colors.textMuted}
                        value={orderDiscountInput}
                        onChangeText={handleOrderDiscountInput}
                      />
                      <Text style={styles.discountCurrencyUnit}>đ</Text>
                    </View>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickDiscountScroll}>
                      {QUICK_DISCOUNTS.map((preset) => {
                        const active = isPresetActive(preset);
                        return (
                          <TouchableOpacity
                            key={preset.label}
                            style={[styles.quickDiscountChip, active && styles.quickDiscountChipActive]}
                            onPress={() => handleApplyQuickDiscount(preset)}
                          >
                            <Text style={[styles.quickDiscountChipText, active && styles.quickDiscountChipTextActive]}>
                              {preset.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {totalDiscount > 0 && (
                      <View style={styles.appliedDiscountRow}>
                        <Text style={styles.appliedDiscountLabel}>Đã giảm trừ:</Text>
                        <Text style={styles.appliedDiscountValue}>-{formatCurrency(totalDiscount)}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.summaryDivider} />

                  {/* 3. TỔNG THANH TOÁN */}
                  <View style={styles.finalTotalRow}>
                    <Text style={styles.finalTotalLabel}>3. TỔNG THANH TOÁN:</Text>
                    <Text style={styles.finalTotalValue}>{formatCurrency(finalTotal)}</Text>
                  </View>
                </Card>
              )}

              {/* 4. PHƯƠNG THỨC THANH TOÁN */}
              {cart.length > 0 && (
                <Card style={styles.paymentCard}>
                  <Text style={styles.paymentSectionTitle}>4. PHƯƠNG THỨC THANH TOÁN</Text>

                  <View style={styles.methodSelector}>
                    <TouchableOpacity
                      style={[
                        styles.methodTab,
                        paymentMethod === 'CASH' && styles.methodTabActive,
                      ]}
                      onPress={() => setPaymentMethod('CASH')}
                    >
                      <Text
                        style={[
                          styles.methodTabText,
                          paymentMethod === 'CASH' && styles.methodTabTextActive,
                        ]}
                      >
                        💵 Tiền mặt
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.methodTab,
                        paymentMethod === 'BANK_TRANSFER' && styles.methodTabActive,
                      ]}
                      onPress={() => setPaymentMethod('BANK_TRANSFER')}
                    >
                      <Text
                        style={[
                          styles.methodTabText,
                          paymentMethod === 'BANK_TRANSFER' && styles.methodTabTextActive,
                        ]}
                      >
                        🏦 Chuyển khoản
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.methodTab,
                        paymentMethod === 'CARD' && styles.methodTabActive,
                      ]}
                      onPress={() => setPaymentMethod('CARD')}
                    >
                      <Text
                        style={[
                          styles.methodTabText,
                          paymentMethod === 'CARD' && styles.methodTabTextActive,
                        ]}
                      >
                        💳 Thẻ
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {paymentMethod === 'CASH' && (
                    <View style={styles.cashSection}>
                      <Text style={styles.cashLabel}>Tiền khách đưa (VND):</Text>

                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.denominationsScroll}>
                        <TouchableOpacity
                          style={[
                            styles.denomChip,
                            numericCashReceived === finalTotal && styles.denomChipActive,
                          ]}
                          onPress={() => handleQuickCash(finalTotal)}
                        >
                          <Text style={[styles.denomChipText, numericCashReceived === finalTotal && styles.denomChipTextActive]}>
                            Đủ tiền ({formatCurrency(finalTotal)})
                          </Text>
                        </TouchableOpacity>

                        {COMMON_CASH_DENOMINATIONS.filter((val) => val >= finalTotal).map((denom) => (
                          <TouchableOpacity
                            key={denom}
                            style={[
                              styles.denomChip,
                              numericCashReceived === denom && styles.denomChipActive,
                            ]}
                            onPress={() => handleQuickCash(denom)}
                          >
                            <Text style={[styles.denomChipText, numericCashReceived === denom && styles.denomChipTextActive]}>
                              {formatCurrency(denom)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>

                      <TextInput
                        style={[styles.cashInput, isCashInsufficient && styles.cashInputError]}
                        keyboardType="numeric"
                        placeholder={`Nhập số tiền (VD: ${finalTotal})...`}
                        value={cashReceivedInput}
                        onChangeText={setCashReceivedInput}
                      />

                      <View style={styles.changeRow}>
                        <Text style={styles.changeLabel}>Tiền thừa trả khách:</Text>
                        <Text style={[styles.changeValue, isCashInsufficient && styles.changeValueError]}>
                          {isCashInsufficient
                            ? `Còn thiếu ${formatCurrency(finalTotal - numericCashReceived)}`
                            : formatCurrency(cashChange)}
                        </Text>
                      </View>
                    </View>
                  )}

                  <Input
                    label="Ghi chú đơn hàng"
                    placeholder="VD: Khách quen giảm giá, đóng gói quà..."
                    value={saleNote}
                    onChangeText={setSaleNote}
                    containerStyle={{ marginTop: Spacing.sm }}
                  />
                </Card>
              )}
            </ScrollView>

            {/* 5. THANH TOÁN (Checkout Bottom Summary) */}
            <View style={styles.checkoutFooter}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Tạm tính:</Text>
                <Text style={styles.summaryValue}>{formatCurrency(subtotal)}</Text>
              </View>
              {totalDiscount > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Giảm giá:</Text>
                  <Text style={styles.discountValue}>-{formatCurrency(totalDiscount)}</Text>
                </View>
              )}
              <View style={[styles.summaryRow, styles.finalRow]}>
                <Text style={styles.finalLabel}>CẦN THANH TOÁN:</Text>
                <Text style={styles.finalValue}>{formatCurrency(finalTotal)}</Text>
              </View>

              <Button
                title={checkingOut ? 'Đang ghi nhận SQLite...' : `XÁC NHẬN BÁN (${totalItems}) • ${formatCurrency(finalTotal)}`}
                onPress={handleCheckout}
                loading={checkingOut}
                disabled={cart.length === 0 || checkingOut || isCashInsufficient}
                style={styles.checkoutBtn}
              />
            </View>
          </View>
        )}

        {/* TAB 2: SALES HISTORY */}
        {activeTab === 'history' && (
          <View style={{ flex: 1 }}>
            {/* KPI Summary Banner */}
            <View style={styles.historyKpiBanner}>
              <View style={styles.historyKpiItem}>
                <Text style={styles.historyKpiLabel}>Tổng đơn</Text>
                <Text style={styles.historyKpiValue}>{historyOrders.length}</Text>
              </View>
              <View style={styles.historyKpiDivider} />
              <View style={[styles.historyKpiItem, { flex: 1.4 }]}>
                <Text style={styles.historyKpiLabel}>Doanh thu hoàn thành</Text>
                <Text style={[styles.historyKpiValue, { color: Colors.primary }]}>
                  {formatCurrency(historyCompletedRevenue)}
                </Text>
              </View>
              <View style={styles.historyKpiDivider} />
              <View style={styles.historyKpiItem}>
                <Text style={styles.historyKpiLabel}>Đơn đã hủy</Text>
                <Text style={[styles.historyKpiValue, { color: Colors.danger }]}>
                  {cancelledHistoryOrders.length}
                </Text>
              </View>
            </View>

            {/* Search & Filter Header */}
            <View style={styles.historyFilterContainer}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={[styles.historySearchWrapper, { flex: 1 }]}>
                  <Text style={styles.searchIcon}>🔍</Text>
                  <TextInput
                    style={styles.historySearchInput}
                    placeholder="Tìm mã đơn (#HD...), SKU, tên sản phẩm..."
                    placeholderTextColor={Colors.textMuted}
                    value={historySearchQuery}
                    onChangeText={setHistorySearchQuery}
                  />
                  {historySearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setHistorySearchQuery('')} style={styles.clearSearchBtn}>
                      <Text style={{ color: Colors.textMuted, fontSize: 13 }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#EFF6FF',
                    borderColor: Colors.primary,
                    borderWidth: 1,
                    borderRadius: BorderRadius.md,
                    paddingHorizontal: 10,
                    paddingVertical: 9,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  onPress={handleExportSalesHistory}
                  disabled={exportingSales}
                  accessibilityLabel="Xuất lịch sử bán hàng ra file CSV"
                >
                  <Text style={{ fontSize: 13 }}>📤</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.primary }}>
                    {exportingSales ? 'Đang xuất...' : 'Xuất CSV'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Filter Chips Scroll */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
                {/* Date Filter */}
                <TouchableOpacity
                  style={[styles.chip, historyDateFilter === 'ALL' && styles.chipActive]}
                  onPress={() => setHistoryDateFilter('ALL')}
                >
                  <Text style={[styles.chipText, historyDateFilter === 'ALL' && styles.chipTextActive]}>Tất cả ngày</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyDateFilter === 'TODAY' && styles.chipActive]}
                  onPress={() => setHistoryDateFilter('TODAY')}
                >
                  <Text style={[styles.chipText, historyDateFilter === 'TODAY' && styles.chipTextActive]}>Hôm nay</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyDateFilter === '7DAYS' && styles.chipActive]}
                  onPress={() => setHistoryDateFilter('7DAYS')}
                >
                  <Text style={[styles.chipText, historyDateFilter === '7DAYS' && styles.chipTextActive]}>7 ngày qua</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyDateFilter === '30DAYS' && styles.chipActive]}
                  onPress={() => setHistoryDateFilter('30DAYS')}
                >
                  <Text style={[styles.chipText, historyDateFilter === '30DAYS' && styles.chipTextActive]}>30 ngày qua</Text>
                </TouchableOpacity>

                <View style={styles.chipDivider} />

                {/* Status Filter */}
                <TouchableOpacity
                  style={[styles.chip, historyStatusFilter === 'ALL' && styles.chipActive]}
                  onPress={() => setHistoryStatusFilter('ALL')}
                >
                  <Text style={[styles.chipText, historyStatusFilter === 'ALL' && styles.chipTextActive]}>Tất cả trạng thái</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyStatusFilter === 'COMPLETED' && styles.chipActive]}
                  onPress={() => setHistoryStatusFilter('COMPLETED')}
                >
                  <Text style={[styles.chipText, historyStatusFilter === 'COMPLETED' && styles.chipTextActive]}>✓ Hoàn thành</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyStatusFilter === 'CANCELLED' && styles.chipActive]}
                  onPress={() => setHistoryStatusFilter('CANCELLED')}
                >
                  <Text style={[styles.chipText, historyStatusFilter === 'CANCELLED' && styles.chipTextActive]}>✕ Đã hủy</Text>
                </TouchableOpacity>

                <View style={styles.chipDivider} />

                {/* Payment Method Filter */}
                <TouchableOpacity
                  style={[styles.chip, historyPaymentFilter === 'ALL' && styles.chipActive]}
                  onPress={() => setHistoryPaymentFilter('ALL')}
                >
                  <Text style={[styles.chipText, historyPaymentFilter === 'ALL' && styles.chipTextActive]}>Tất cả TT</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyPaymentFilter === 'CASH' && styles.chipActive]}
                  onPress={() => setHistoryPaymentFilter('CASH')}
                >
                  <Text style={[styles.chipText, historyPaymentFilter === 'CASH' && styles.chipTextActive]}>💵 Tiền mặt</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyPaymentFilter === 'BANK_TRANSFER' && styles.chipActive]}
                  onPress={() => setHistoryPaymentFilter('BANK_TRANSFER')}
                >
                  <Text style={[styles.chipText, historyPaymentFilter === 'BANK_TRANSFER' && styles.chipTextActive]}>🏦 Chuyển khoản</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, historyPaymentFilter === 'CARD' && styles.chipActive]}
                  onPress={() => setHistoryPaymentFilter('CARD')}
                >
                  <Text style={[styles.chipText, historyPaymentFilter === 'CARD' && styles.chipTextActive]}>💳 Thẻ</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>

            {/* Sales Orders List */}
            {loadingHistory ? (
              <View style={styles.loadingWrapper}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Đang tải lịch sử bán hàng...</Text>
              </View>
            ) : historyOrders.length === 0 ? (
              <EmptyState
                icon={<Text style={{ fontSize: 40 }}>📜</Text>}
                title="Không có đơn hàng nào"
                description={
                  historySearchQuery
                    ? `Không tìm thấy đơn hàng khớp với "${historySearchQuery}"`
                    : 'Chưa có dữ liệu bán hàng trong khoảng thời gian hoặc bộ lọc đã chọn.'
                }
                actionTitle="Tải lại danh sách"
                onAction={loadSalesHistory}
              />
            ) : (
              <FlatList
                data={historyOrders}
                keyExtractor={(item) => (item.id ? item.id.toString() : item.client_order_id)}
                contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40 }}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const isCancelled = item.status === 'CANCELLED';
                  const syncVariant = item.sync_status === 'SYNCED' ? 'primary' : item.sync_status === 'PENDING' ? 'warning' : 'danger';
                  const syncLabel = item.sync_status === 'SYNCED' ? 'Đã đồng bộ' : item.sync_status === 'PENDING' ? 'Chờ đồng bộ' : (item.sync_status || 'Offline');

                  return (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => handleOpenSaleDetail(item)}
                    >
                      <Card style={[styles.historyOrderCard, isCancelled && styles.historyOrderCardCancelled]}>
                        <View style={styles.orderCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.orderCardCode}>#{item.order_code}</Text>
                            <Badge
                              label={isCancelled ? '✕ Đã hủy' : '✓ Hoàn thành'}
                              variant={isCancelled ? 'danger' : 'success'}
                            />
                            <Badge
                              label={syncLabel}
                              variant={syncVariant}
                            />
                          </View>
                          <Text style={styles.orderCardTime}>{formatDate(item.sale_date || item.created_at)}</Text>
                        </View>

                        <View style={styles.orderCardBody}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.orderCardCashier}>
                              Thu ngân: <Text style={{ fontWeight: '600', color: Colors.textPrimary }}>{(item as any).seller_name || user?.full_name || 'Thu ngân'}</Text>
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                              <Text style={styles.orderCardMeta}>
                                {item.payment_method === 'CASH' ? '💵 Tiền mặt' : item.payment_method === 'BANK_TRANSFER' ? '🏦 Chuyển khoản' : '💳 Thẻ'}
                              </Text>
                              <Text style={styles.orderCardMeta}>• {item.total_items} sản phẩm</Text>
                              {item.total_discount > 0 && (
                                <Text style={[styles.orderCardMeta, { color: Colors.danger }]}>
                                  • Giảm {formatCurrency(item.total_discount)}
                                </Text>
                              )}
                            </View>
                          </View>

                          <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                            <Text style={[styles.orderCardAmount, isCancelled && styles.orderCardAmountCancelled]}>
                              {formatCurrency(item.final_amount)}
                            </Text>
                            {isCancelled && (
                              <Text style={styles.cancelledSubtext}>Hoàn tiền / kho</Text>
                            )}
                          </View>
                        </View>

                        {isCancelled && item.cancel_reason && (
                          <View style={styles.orderCardReasonBox}>
                            <Text style={styles.orderCardReasonText} numberOfLines={1}>
                              ⚠️ Lý do hủy: {item.cancel_reason}
                            </Text>
                          </View>
                        )}
                      </Card>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}
      </View>

      {/* Barcode / QR Camera & Wedge Scanner Modal */}
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanBarcode={handleBarcodeScan}
      />

      {/* Multi-Item Product Selection Modal from Stock */}
      <Modal visible={pickerVisible} animationType="slide" transparent={true} onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '85%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Chọn sản phẩm từ kho</Text>
                <Text style={{ fontSize: 11, color: Colors.textMuted }}>Tích chọn nhiều sản phẩm và điều chỉnh số lượng</Text>
              </View>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <Input
              placeholder="Tìm theo tên hoặc SKU..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              containerStyle={{ marginBottom: Spacing.xs }}
            />

            {/* Quick selection toolbar */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingVertical: 4 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  style={{ backgroundColor: '#EFF6FF', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#BFDBFE' }}
                  onPress={handleSelectAllVisible}
                >
                  <Text style={{ fontSize: 11, color: '#1D4ED8', fontWeight: '600' }}>Chọn tất cả ({filteredPickerProducts.length})</Text>
                </TouchableOpacity>

                {Object.keys(selectedPickerItems).length > 0 && (
                  <TouchableOpacity
                    style={{ backgroundColor: '#FEE2E2', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA' }}
                    onPress={handleDeselectAll}
                  >
                    <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '600' }}>Bỏ chọn tất cả</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.primary }}>
                Đã chọn: {Object.keys(selectedPickerItems).length} SP
              </Text>
            </View>

            <FlatList
              data={filteredPickerProducts}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={{ paddingBottom: 16 }}
              renderItem={({ item }) => {
                const isSelected = !!selectedPickerItems[item.id];
                const selectedQty = selectedPickerItems[item.id] || 0;
                const isOutOfStock = item.current_stock <= 0;

                return (
                  <View
                    style={[
                      styles.pickerItem,
                      isSelected && { backgroundColor: '#F0FDF4', borderColor: '#86EFAC', borderRadius: 8, paddingHorizontal: 8 },
                      isOutOfStock && { opacity: 0.5 },
                    ]}
                  >
                    {/* Checkbox Icon */}
                    <TouchableOpacity
                      disabled={isOutOfStock}
                      onPress={() => togglePickerProduct(item)}
                      style={{ marginRight: 10, justifyContent: 'center', alignItems: 'center' }}
                    >
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          borderWidth: 2,
                          borderColor: isSelected ? '#16A34A' : '#94A3B8',
                          backgroundColor: isSelected ? '#16A34A' : '#FFFFFF',
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                      >
                        {isSelected && <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' }}>✓</Text>}
                      </View>
                    </TouchableOpacity>

                    {/* Product Details */}
                    <TouchableOpacity
                      disabled={isOutOfStock}
                      style={{ flex: 1 }}
                      onPress={() => togglePickerProduct(item)}
                    >
                      <Text style={styles.pickerSku}>{item.sku}</Text>
                      <Text style={styles.pickerName} numberOfLines={1}>{item.name}</Text>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
                        <Text style={[styles.pickerStock, isOutOfStock && { color: Colors.danger, fontWeight: '700' }]}>
                          {isOutOfStock ? 'Hết hàng' : `Tồn: ${item.current_stock}`}
                        </Text>
                        <Text style={styles.pickerPrice}>{formatCurrency(item.current_selling_price)}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Stepper controller if selected */}
                    {isSelected && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                        <TouchableOpacity
                          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' }}
                          onPress={() => updatePickerItemQty(item, -1)}
                        >
                          <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#1E293B' }}>−</Text>
                        </TouchableOpacity>
                        <Text style={{ fontSize: 14, fontWeight: '700', minWidth: 24, textAlign: 'center' }}>
                          {selectedQty}
                        </Text>
                        <TouchableOpacity
                          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#DCFCE7', justifyContent: 'center', alignItems: 'center' }}
                          onPress={() => updatePickerItemQty(item, 1)}
                        >
                          <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#16A34A' }}>+</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              }}
            />

            {/* Bottom sticky bar for batch add */}
            <View style={{ borderTopWidth: 1, borderColor: '#E2E8F0', paddingTop: 10, marginTop: 4 }}>
              <Button
                title={
                  Object.keys(selectedPickerItems).length > 0
                    ? `✓ Thêm ${Object.keys(selectedPickerItems).length} sản phẩm (${Object.values(selectedPickerItems).reduce((s, q) => s + q, 0)} cái) vào giỏ`
                    : 'Chưa chọn sản phẩm nào'
                }
                onPress={handleAddSelectedToCart}
                disabled={Object.keys(selectedPickerItems).length === 0}
                variant="primary"
                size="lg"
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* In-App Native Checkout Confirmation Modal */}
      <Modal visible={checkoutConfirmModalVisible} animationType="fade" transparent={true} onRequestClose={() => !checkingOut && setCheckoutConfirmModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: 'auto', maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Xác nhận bán hàng</Text>
                <Text style={{ fontSize: 11, color: Colors.textMuted }}>Kiểm tra kỹ thông tin đơn hàng trước khi hoàn tất</Text>
              </View>
              <TouchableOpacity onPress={() => !checkingOut && setCheckoutConfirmModalVisible(false)} disabled={checkingOut}>
                <Text style={styles.modalCloseText}>✕ Hủy</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {/* Items preview table */}
              <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0' }}>
                <Text style={{ fontWeight: '700', fontSize: 13, marginBottom: 6, color: Colors.textPrimary }}>
                  Danh sách sản phẩm ({totalItems} món):
                </Text>
                {cart.map((it, idx) => (
                  <View key={it.product.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: idx < cart.length - 1 ? 1 : 0, borderColor: '#E2E8F0' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textPrimary }} numberOfLines={1}>
                        {it.product.name}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.textMuted }}>
                        {it.qty} x {formatCurrency(it.product.current_selling_price)}
                        {it.discount > 0 ? ` (Giảm ${formatCurrency(it.discount)})` : ''}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textPrimary }}>
                      {formatCurrency(it.product.current_selling_price * it.qty - it.discount)}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Financial Breakdown */}
              <View style={{ gap: 6, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary }}>Tạm tính:</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600' }}>{formatCurrency(subtotal)}</Text>
                </View>
                {totalDiscount > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: Colors.danger }}>Giảm giá:</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.danger }}>-{formatCurrency(totalDiscount)}</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderColor: '#E2E8F0' }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: Colors.textPrimary }}>CẦN THANH TOÁN:</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.primary }}>{formatCurrency(finalTotal)}</Text>
                </View>
              </View>

              {/* Payment Details */}
              <View style={{ backgroundColor: '#EFF6FF', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#BFDBFE' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: '#1E40AF', fontWeight: '600' }}>Hình thức thanh toán:</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E3A8A' }}>
                    {paymentMethod === 'CASH' ? '💵 Tiền mặt' : paymentMethod === 'BANK_TRANSFER' ? '🏦 Chuyển khoản' : '💳 Thẻ'}
                  </Text>
                </View>
                {paymentMethod === 'CASH' && (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ fontSize: 12, color: '#1E40AF' }}>Tiền khách đưa:</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E3A8A' }}>
                        {formatCurrency(numericCashReceived > 0 ? numericCashReceived : finalTotal)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: '#166534', fontWeight: '700' }}>Tiền thừa trả khách:</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#166534' }}>
                        {formatCurrency(cashChange)}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              {/* Action Buttons */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => setCheckoutConfirmModalVisible(false)}
                  disabled={checkingOut}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textSecondary }}>Quay lại</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ flex: 2, paddingVertical: 12, borderRadius: 8, backgroundColor: checkingOut ? '#94A3B8' : Colors.primary, alignItems: 'center', justifyContent: 'center' }}
                  onPress={executeSaleCheckout}
                  disabled={checkingOut}
                >
                  {checkingOut ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>✓ Hoàn tất thanh toán</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Itemized Receipt & Print / Share Modal */}
      <ReceiptModal
        visible={receiptVisible}
        receiptData={completedReceipt}
        onClose={() => setReceiptVisible(false)}
        onNewOrder={() => {
          setCart([]);
          setSaleNote('');
          setCashReceivedInput('');
        }}
      />

      {/* Sale Detail & Cancellation Modal */}
      <Modal
        visible={saleDetailModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          if (!cancellingSale) {
            if (detailViewMode === 'CANCEL') {
              setDetailViewMode('DETAIL');
            } else {
              setSaleDetailModalVisible(false);
            }
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '90%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, detailViewMode === 'CANCEL' && { color: Colors.danger }]}>
                  {detailViewMode === 'CANCEL'
                    ? `Xác nhận hủy đơn #${selectedOrderDetail?.order?.order_code || ''}`
                    : `Chi tiết đơn #${selectedOrderDetail?.order?.order_code || ''}`
                  }
                </Text>
                <Text style={{ fontSize: 11, color: Colors.textMuted }}>
                  {detailViewMode === 'CANCEL'
                    ? 'Thao tác này sẽ hoàn trả tồn kho và cập nhật báo cáo'
                    : `Mã giao dịch: ${selectedOrderDetail?.order?.client_order_id || ''}`
                  }
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (detailViewMode === 'CANCEL') {
                    setDetailViewMode('DETAIL');
                  } else {
                    setSaleDetailModalVisible(false);
                  }
                }}
                disabled={cancellingSale}
              >
                <Text style={styles.modalCloseText}>
                  {detailViewMode === 'CANCEL' ? '← Quay lại' : '✕ Đóng'}
                </Text>
              </TouchableOpacity>
            </View>

            {loadingOrderDetail ? (
              <View style={styles.loadingWrapper}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Đang tải chi tiết đơn hàng...</Text>
              </View>
            ) : selectedOrderDetail ? (
              detailViewMode === 'CANCEL' ? (
                /* Inline Cancellation Confirmation View */
                <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                  {/* Order quick overview */}
                  <View style={styles.cancelOverviewCard}>
                    <View style={styles.cancelOverviewRow}>
                      <Text style={styles.cancelOverviewLabel}>Mã đơn hàng:</Text>
                      <Text style={styles.cancelOverviewValue}>
                        #{selectedOrderDetail.order.order_code}
                      </Text>
                    </View>
                    <View style={styles.cancelOverviewRow}>
                      <Text style={styles.cancelOverviewLabel}>Tổng tiền hoàn trả:</Text>
                      <Text style={[styles.cancelOverviewValue, { color: Colors.danger, fontSize: 14 }]}>
                        {formatCurrency(selectedOrderDetail.order.final_amount)}
                      </Text>
                    </View>
                    <View style={styles.cancelOverviewRow}>
                      <Text style={styles.cancelOverviewLabel}>Số lượng trả lại kho:</Text>
                      <Text style={styles.cancelOverviewValue}>
                        {selectedOrderDetail.order.total_items} sản phẩm
                      </Text>
                    </View>
                  </View>

                  {/* Notice explaining atomic reversal */}
                  <View style={styles.cancelNoticeBox}>
                    <Text style={styles.cancelNoticeTitle}>⚠️ QUY ĐỊNH HOÀN TRẢ:</Text>
                    <Text style={styles.cancelNoticeText}>
                      • Tồn kho của toàn bộ sản phẩm trong đơn sẽ được cộng ngược lại vào kho hàng.{'\n'}
                      • Hệ thống ghi nhận bút toán thẻ kho RETURN tương ứng.{'\n'}
                      • Các lô nhập hàng FIFO đã tiêu thụ sẽ được phục hồi lại số lượng còn lại.{'\n'}
                      • Đơn hàng sẽ được loại trừ hoàn toàn khỏi doanh thu và lợi nhuận gộp.{'\n'}
                      • Thao tác hủy đơn không thể hoàn tác sau khi đã xác nhận.
                    </Text>
                  </View>

                  {/* Preset Reason Chips */}
                  <Text style={styles.cancelReasonLabel}>Chọn nhanh lý do hủy:</Text>
                  <View style={styles.presetReasonsContainer}>
                    {[
                      'Khách đổi ý không mua',
                      'Nhập sai sản phẩm / số lượng',
                      'Hàng lỗi khi bàn giao',
                      'Khách đổi sang sản phẩm khác',
                      'Khách trả lại toàn bộ hàng',
                    ].map((reasonText) => (
                      <TouchableOpacity
                        key={reasonText}
                        style={[
                          styles.presetReasonChip,
                          cancelReason === reasonText && styles.presetReasonChipActive,
                        ]}
                        onPress={() => setCancelReason(reasonText)}
                      >
                        <Text
                          style={[
                            styles.presetReasonText,
                            cancelReason === reasonText && styles.presetReasonTextActive,
                          ]}
                        >
                          {reasonText}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Custom reason text input */}
                  <Text style={styles.cancelReasonLabel}>Lý do hủy đơn hàng (bắt buộc) *</Text>
                  <TextInput
                    style={styles.cancelReasonInput}
                    placeholder="Nhập lý do chi tiết hủy đơn..."
                    placeholderTextColor={Colors.textMuted}
                    value={cancelReason}
                    onChangeText={setCancelReason}
                    multiline
                    numberOfLines={3}
                  />

                  {/* Action Buttons */}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                    <TouchableOpacity
                      style={styles.cancelBackBtn}
                      onPress={() => setDetailViewMode('DETAIL')}
                      disabled={cancellingSale}
                    >
                      <Text style={styles.cancelBackBtnText}>Quay lại</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.cancelSubmitBtn,
                        cancellingSale && styles.cancelSubmitBtnDisabled,
                      ]}
                      onPress={handleConfirmCancelSale}
                      disabled={cancellingSale}
                      activeOpacity={0.8}
                    >
                      {cancellingSale ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.cancelSubmitBtnText}>✕ Xác nhận hủy đơn</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                /* Normal Sale Detail View */
                <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                  {/* Cancellation Warning Banner if CANCELLED */}
                  {selectedOrderDetail.order.status === 'CANCELLED' && (
                    <View style={styles.detailCancelledBanner}>
                      <Text style={styles.detailCancelledTitle}>⚠️ ĐƠN HÀNG ĐÃ BỊ HỦY</Text>
                      <Text style={styles.detailCancelledInfo}>
                        • Thời gian hủy: {formatDate(selectedOrderDetail.order.cancelled_at)}
                      </Text>
                      <Text style={styles.detailCancelledInfo}>
                        • Người hủy: {(selectedOrderDetail.order as any).seller_name || 'Nhân viên'}
                      </Text>
                      <Text style={styles.detailCancelledInfo}>
                        • Lý do: {selectedOrderDetail.order.cancel_reason || 'Không có lý do'}
                      </Text>
                      <View style={styles.detailCancelledNotice}>
                        <Text style={styles.detailCancelledNoticeText}>
                          ✓ Tồn kho sản phẩm đã được hoàn trả về kho. Thẻ kho ghi nhận bút toán RETURN.
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Header Information Card */}
                  <Card style={styles.detailMetaCard}>
                    <View style={styles.detailMetaRow}>
                      <Text style={styles.detailMetaLabel}>Ngày bán:</Text>
                      <Text style={styles.detailMetaValue}>
                        {formatDate(selectedOrderDetail.order.sale_date || selectedOrderDetail.order.created_at)}
                      </Text>
                    </View>
                    <View style={styles.detailMetaRow}>
                      <Text style={styles.detailMetaLabel}>Thu ngân / Người bán:</Text>
                      <Text style={styles.detailMetaValue}>
                        {(selectedOrderDetail.order as any).seller_name || user?.full_name || 'Thu ngân'}
                      </Text>
                    </View>
                    <View style={styles.detailMetaRow}>
                      <Text style={styles.detailMetaLabel}>Trạng thái đơn hàng:</Text>
                      <Badge
                        label={selectedOrderDetail.order.status === 'CANCELLED' ? '✕ Đã hủy' : '✓ Hoàn thành'}
                        variant={selectedOrderDetail.order.status === 'CANCELLED' ? 'danger' : 'success'}
                      />
                    </View>
                    <View style={styles.detailMetaRow}>
                      <Text style={styles.detailMetaLabel}>Trạng thái đồng bộ:</Text>
                      <Badge
                        label={selectedOrderDetail.order.sync_status === 'SYNCED' ? 'Đã đồng bộ' : selectedOrderDetail.order.sync_status === 'PENDING' ? 'Chờ đồng bộ' : (selectedOrderDetail.order.sync_status || 'Offline')}
                        variant={selectedOrderDetail.order.sync_status === 'SYNCED' ? 'primary' : selectedOrderDetail.order.sync_status === 'PENDING' ? 'warning' : 'danger'}
                      />
                    </View>
                    {selectedOrderDetail.order.note ? (
                      <View style={[styles.detailMetaRow, { borderBottomWidth: 0 }]}>
                        <Text style={styles.detailMetaLabel}>Ghi chú:</Text>
                        <Text style={[styles.detailMetaValue, { fontStyle: 'italic' }]}>
                          {selectedOrderDetail.order.note}
                        </Text>
                      </View>
                    ) : null}
                  </Card>

                  {/* Line Items List */}
                  <Text style={styles.detailSectionTitle}>
                    DANH SÁCH SẢN PHẨM ({selectedOrderDetail.items.length} mặt hàng)
                  </Text>

                  {selectedOrderDetail.items.map((it, idx) => {
                    const unitPrice = it.unit_price_at_sale || (it as any).unit_price || 0;
                    const lineTotal = it.total_revenue || (it as any).line_total || ((it.quantity * unitPrice) - (it.discount || 0));

                    return (
                      <View key={it.id || idx} style={styles.detailItemRow}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.detailItemSku}>{it.sku}</Text>
                            {it.category_name ? (
                              <Text style={styles.detailItemCat}>• {it.category_name}</Text>
                            ) : null}
                          </View>
                          <Text style={styles.detailItemName}>{it.product_name || 'Sản phẩm'}</Text>
                          <Text style={styles.detailItemCalc}>
                            {it.quantity} x {formatCurrency(unitPrice)} (Đơn giá snapshot)
                          </Text>
                          {it.discount > 0 && (
                            <Text style={styles.detailItemDiscount}>
                              🏷️ Giảm giá món: -{formatCurrency(it.discount)}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.detailItemTotal}>{formatCurrency(lineTotal)}</Text>
                      </View>
                    );
                  })}

                  {/* Financial Summary */}
                  <Card style={styles.detailFinancialCard}>
                    <Text style={styles.detailSectionTitle}>TỔNG KẾT THANH TOÁN</Text>
                    <View style={styles.calcRow}>
                      <Text style={styles.calcLabel}>Tạm tính:</Text>
                      <Text style={styles.calcValue}>{formatCurrency(selectedOrderDetail.order.total_amount)}</Text>
                    </View>
                    {selectedOrderDetail.order.total_discount > 0 && (
                      <View style={styles.calcRow}>
                        <Text style={[styles.calcLabel, { color: Colors.danger }]}>Giảm giá đơn hàng:</Text>
                        <Text style={[styles.calcValue, { color: Colors.danger }]}>
                          -{formatCurrency(selectedOrderDetail.order.total_discount)}
                        </Text>
                      </View>
                    )}
                    <View style={[styles.calcRow, styles.finalRow]}>
                      <Text style={styles.finalLabel}>TỔNG TIỀN:</Text>
                      <Text style={styles.finalValue}>
                        {formatCurrency(selectedOrderDetail.order.final_amount)}
                      </Text>
                    </View>

                    <View style={styles.detailPaymentInfo}>
                      <View style={styles.detailPaymentRow}>
                        <Text style={styles.detailPaymentLabel}>Hình thức thanh toán:</Text>
                        <Text style={styles.detailPaymentVal}>
                          {selectedOrderDetail.order.payment_method === 'CASH'
                            ? '💵 Tiền mặt'
                            : selectedOrderDetail.order.payment_method === 'BANK_TRANSFER'
                            ? '📱 Chuyển khoản'
                            : '💳 Thẻ'}
                        </Text>
                      </View>
                      {selectedOrderDetail.order.payment_method === 'CASH' && (
                        <>
                          <View style={styles.detailPaymentRow}>
                            <Text style={styles.detailPaymentLabel}>Tiền khách đưa:</Text>
                            <Text style={styles.detailPaymentVal}>
                              {formatCurrency(selectedOrderDetail.order.cash_received || selectedOrderDetail.order.final_amount)}
                            </Text>
                          </View>
                          <View style={styles.detailPaymentRow}>
                            <Text style={styles.detailPaymentLabel}>Tiền thừa trả khách:</Text>
                            <Text style={[styles.detailPaymentVal, { color: Colors.success, fontWeight: '700' }]}>
                              {formatCurrency(selectedOrderDetail.order.cash_change || 0)}
                            </Text>
                          </View>
                        </>
                      )}
                    </View>
                  </Card>

                  {/* Action Buttons */}
                  <View style={styles.detailActionsRow}>
                    <TouchableOpacity
                      style={styles.reprintBtn}
                      onPress={handleReprintReceipt}
                    >
                      <Text style={styles.reprintBtnIcon}>📄</Text>
                      <Text style={styles.reprintBtnText}>In lại hóa đơn</Text>
                    </TouchableOpacity>

                    {selectedOrderDetail.order.status === 'COMPLETED' && (
                      <TouchableOpacity
                        style={styles.cancelSaleBtn}
                        onPress={handleOpenCancelConfirmation}
                      >
                        <Text style={styles.cancelSaleBtnIcon}>✕</Text>
                        <Text style={styles.cancelSaleBtnText}>Hủy đơn bán</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </ScrollView>
              )
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
  },
  topToolbar: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  scanBarcodeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
  },
  scanBarcodeIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  scanBarcodeText: {
    ...Typography.bodyMedium,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  addProductBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  addProductIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  addProductText: {
    ...Typography.bodyMedium,
    color: Colors.primary,
    fontWeight: '700',
  },
  cartList: {
    paddingHorizontal: Spacing.md,
    paddingBottom: 24,
    gap: Spacing.sm,
  },
  cartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  cartTitle: {
    ...Typography.titleSmall,
    color: Colors.textPrimary,
  },
  clearCartText: {
    ...Typography.bodySmall,
    color: Colors.danger,
    fontWeight: '600',
  },
  emptyCartCard: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    ...Typography.titleSmall,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  emptySubtitle: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  cartItemCard: {
    padding: Spacing.md,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  itemHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  skuTag: {
    backgroundColor: Colors.background,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  skuText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
  },
  stockWarnText: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '600',
  },
  deleteIcon: {
    fontSize: 16,
  },
  productName: {
    ...Typography.bodyMedium,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  itemPriceText: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  stepperWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  stepBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  stepBtnTextDisabled: {
    color: Colors.textMuted,
  },
  qtyText: {
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  lineTotalWrapper: {
    alignItems: 'flex-end',
  },
  lineTotalLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  lineTotalValue: {
    ...Typography.titleSmall,
    color: Colors.primary,
    fontWeight: '700',
  },
  itemDiscountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
  },
  itemDiscountLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemDiscountLabel: {
    ...Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  itemDiscountHint: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  itemDiscountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    height: 30,
  },
  itemDiscountInput: {
    width: 48,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'right',
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  itemDiscountInputActive: {
    color: Colors.danger,
  },
  itemDiscountUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    marginLeft: 2,
  },
  itemDiscountClearBtn: {
    marginLeft: 4,
    padding: 2,
  },
  itemDiscountClearText: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  itemDiscountFormatted: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.danger,
    marginLeft: 6,
  },
  orderSummaryCard: {
    padding: Spacing.md,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  orderSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  orderSummaryTitle: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.primary,
  },
  orderSummaryCount: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  calcLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  calcValue: {
    ...Typography.bodyMedium,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  discountBox: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  discountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  discountHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
  },
  clearDiscountBtn: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.danger,
  },
  discountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    height: 40,
    marginBottom: Spacing.xs,
  },
  discountInputField: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingVertical: 4,
  },
  discountInputActive: {
    color: Colors.danger,
  },
  discountCurrencyUnit: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    marginLeft: 4,
  },
  quickDiscountScroll: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  quickDiscountChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 6,
  },
  quickDiscountChipActive: {
    backgroundColor: '#FEF2F2',
    borderColor: Colors.danger,
  },
  quickDiscountChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  quickDiscountChipTextActive: {
    color: Colors.danger,
    fontWeight: '700',
  },
  appliedDiscountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  appliedDiscountLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.danger,
  },
  appliedDiscountValue: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.danger,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.sm,
  },
  finalTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
  },
  finalTotalLabel: {
    ...Typography.bodyLarge,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  finalTotalValue: {
    ...Typography.titleLarge,
    fontWeight: '800',
    color: Colors.primary,
  },
  paymentCard: {
    padding: Spacing.md,
    marginTop: Spacing.xs,
  },
  paymentSectionTitle: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  methodSelector: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  methodTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  methodTabActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  methodTabText: {
    ...Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  methodTabTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  cashSection: {
    marginTop: 4,
  },
  cashLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  denominationsScroll: {
    marginBottom: 8,
  },
  denomChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  denomChipActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  denomChipText: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  denomChipTextActive: {
    color: '#0369A1',
  },
  cashInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: '#FFFFFF',
    color: Colors.textPrimary,
  },
  cashInputError: {
    borderColor: Colors.danger,
  },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  changeLabel: {
    ...Typography.bodySmall,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  changeValue: {
    ...Typography.bodyMedium,
    fontWeight: '800',
    color: Colors.success,
  },
  changeValueError: {
    color: Colors.danger,
    fontWeight: '600',
  },
  checkoutFooter: {
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    padding: Spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  summaryLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  summaryValue: {
    ...Typography.bodySmall,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  discountValue: {
    ...Typography.bodySmall,
    fontWeight: '600',
    color: Colors.success,
  },
  finalRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
    marginTop: 4,
    marginBottom: 12,
  },
  finalLabel: {
    ...Typography.bodyLarge,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  finalValue: {
    ...Typography.titleLarge,
    fontWeight: '800',
    color: Colors.primary,
  },
  checkoutBtn: {
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '75%',
    padding: Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  modalTitle: {
    ...Typography.titleMedium,
    color: Colors.textPrimary,
  },
  modalCloseText: {
    ...Typography.bodyMedium,
    color: Colors.danger,
    fontWeight: '600',
  },
  pickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerSku: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  pickerName: {
    ...Typography.bodyMedium,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  pickerStock: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  pickerPrice: {
    ...Typography.bodyMedium,
    fontWeight: '700',
    color: Colors.primary,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  activeTabText: {
    color: Colors.primary,
    fontWeight: '700',
  },
  historyKpiBanner: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  historyKpiItem: {
    flex: 1,
    alignItems: 'center',
  },
  historyKpiLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  historyKpiValue: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  historyKpiDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.border,
  },
  historyFilterContainer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  historySearchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 10,
    height: 40,
    marginBottom: Spacing.xs,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  historySearchInput: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    paddingVertical: 4,
  },
  clearSearchBtn: {
    padding: 4,
  },
  chipsScroll: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginRight: 6,
  },
  chipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  chipDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.border,
    marginHorizontal: 4,
    alignSelf: 'center',
  },
  loadingWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: 13,
    color: Colors.textMuted,
  },
  historyOrderCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  historyOrderCardCancelled: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FECACA',
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  orderCardCode: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  orderCardTime: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  orderCardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  orderCardCashier: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  orderCardMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  orderCardAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primary,
  },
  orderCardAmountCancelled: {
    color: Colors.danger,
    textDecorationLine: 'line-through',
  },
  cancelledSubtext: {
    fontSize: 10,
    color: Colors.danger,
    fontWeight: '600',
    marginTop: 1,
  },
  orderCardReasonBox: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#FCA5A5',
  },
  orderCardReasonText: {
    fontSize: 11,
    color: Colors.danger,
    fontWeight: '600',
  },
  detailCancelledBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#F87171',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  detailCancelledTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#B91C1C',
    marginBottom: 6,
  },
  detailCancelledInfo: {
    fontSize: 12,
    color: '#991B1B',
    marginBottom: 2,
  },
  detailCancelledNotice: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#FECACA',
  },
  detailCancelledNoticeText: {
    fontSize: 11,
    color: '#15803D',
    fontWeight: '700',
  },
  detailMetaCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  detailMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  detailMetaLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  detailMetaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  detailSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
    marginTop: Spacing.xs,
  },
  detailItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailItemSku: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: Colors.textMuted,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  detailItemCat: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  detailItemName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  detailItemCalc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  detailItemDiscount: {
    fontSize: 11,
    color: Colors.danger,
    fontWeight: '600',
    marginTop: 1,
  },
  detailItemTotal: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  detailFinancialCard: {
    padding: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  detailPaymentInfo: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  detailPaymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  detailPaymentLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  detailPaymentVal: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  detailActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Spacing.xs,
  },
  reprintBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#3B82F6',
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
  },
  reprintBtnIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  reprintBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  cancelSaleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
  },
  cancelSaleBtnIcon: {
    fontSize: 16,
    marginRight: 6,
    color: '#DC2626',
    fontWeight: 'bold',
  },
  cancelSaleBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  cancelOverviewCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: Spacing.sm,
  },
  cancelOverviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cancelOverviewLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  cancelOverviewValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cancelNoticeBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#FCD34D',
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  cancelNoticeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 4,
  },
  cancelNoticeText: {
    fontSize: 11,
    color: '#92400E',
    lineHeight: 16,
  },
  cancelReasonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
    marginTop: 4,
  },
  presetReasonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: Spacing.sm,
  },
  presetReasonChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  presetReasonChipActive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
  },
  presetReasonText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  presetReasonTextActive: {
    color: '#DC2626',
    fontWeight: '700',
  },
  cancelReasonInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
    height: 60,
  },
  cancelBackBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBackBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  cancelSubmitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelSubmitBtnDisabled: {
    opacity: 0.5,
  },
  cancelSubmitBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default SalesScreen;
