// T_SHOP Mobile - Inventory Management & Stock Movement Screen
// Comprehensive retail inventory management matching Web reference 100%:
// Stock Status, Multi-item Import, FIFO Lots, Append-only Ledger, Stock Adjustments, and Historical Price/Cost

import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Platform,
  TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import EmptyState from '../../components/common/EmptyState';
import NetworkBanner from '../../components/common/NetworkBanner';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput } from '../../utils/formatters';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';
import inventoryRepository from '../../repository/InventoryRepository';
import productRepository from '../../repository/ProductRepository';
import purchaseOrderService, { PurchaseOrderWithItems } from '../../services/PurchaseOrderService';
import fileImportService, { InventoryImportRow, FileImportPreview } from '../../services/FileImportService';
import exportService from '../../services/ExportService';
import { Product, StockMovement, InventoryLot } from '../../types/domain';
import { StockStatus } from '../../database/types';
import { PriceHistoryRecord, CostHistoryRecord, ImportItemInput } from '../../services/types';
import BarcodeScannerModal from '../../components/scanner/BarcodeScannerModal';

const ADJUSTMENT_TYPES = [
  { key: 'DAMAGE', label: 'Hỏng hóc (-)', sign: -1 },
  { key: 'LOSS', label: 'Thất thoát (-)', sign: -1 },
  { key: 'GIFT', label: 'Tặng kèm (-)', sign: -1 },
  { key: 'RETURN', label: 'Trả NCC (-)', sign: -1 },
  { key: 'ADJUSTMENT', label: 'Kiểm kê định kỳ (+/-)', sign: 1 },
];

export const InventoryScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'status' | 'movements' | 'lots' | 'orders'>('status');
  const [products, setProducts] = useState<Product[]>([]);
  const [stockStatuses, setStockStatuses] = useState<Map<number, StockStatus>>(new Map());
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithItems[]>([]);
  const [summary, setSummary] = useState({ totalProducts: 0, totalStock: 0, totalValuation: 0, lowStockCount: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [movementFilter, setMovementFilter] = useState<'ALL' | 'PURCHASE' | 'SALE' | 'ADJUSTMENT'>('ALL');
  const [poStatusFilter, setPoStatusFilter] = useState<'ALL' | 'PENDING' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [poSearchQuery, setPoSearchQuery] = useState('');

  // Purchase Order Detail & Confirmation Modal states
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithItems | null>(null);
  const [poDetailModalVisible, setPoDetailModalVisible] = useState(false);
  const [poCreateModalVisible, setPoCreateModalVisible] = useState(false);
  const [confirmingPO, setConfirmingPO] = useState(false);

  // New Purchase Order Form states
  const [poSupplier, setPoSupplier] = useState('Xưởng Sản Xuất Thú Bông Miền Nam');
  const [poExpectedDate, setPoExpectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [poStatus, setPoStatus] = useState<'PENDING' | 'COMPLETED'>('PENDING');
  const [poNote, setPoNote] = useState('');
  const [poSelectedProdId, setPoSelectedProdId] = useState<number>(0);
  const [poItemQty, setPoItemQty] = useState('10');
  const [poItemCost, setPoItemCost] = useState('80000');
  const [poItems, setPoItems] = useState<Array<{ product: Product; quantity: number; unitCostPrice: number }>>([]);
  const [savingPO, setSavingPO] = useState(false);

  // Bulk Inventory File Import states
  const [fileImportModalVisible, setFileImportModalVisible] = useState(false);
  const [fileCsvInput, setFileCsvInput] = useState('');
  const [fileImportPreview, setFileImportPreview] = useState<FileImportPreview<InventoryImportRow> | null>(null);
  const [parsingFileCsv, setParsingFileCsv] = useState(false);
  const [committingFileImport, setCommittingFileImport] = useState(false);
  const [exportingMovements, setExportingMovements] = useState(false);

  // Multi-item Import Modal states
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importItems, setImportItems] = useState<Array<ImportItemInput & { product: Product }>>([]);
  const [importNote, setImportNote] = useState('');
  const [importSupplier, setImportSupplier] = useState('Tổng Kho Đồ Chơi VN');
  const [submittingImport, setSubmittingImport] = useState(false);

  // Stock Adjustment Modal states
  const [adjustModalVisible, setAdjustModalVisible] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustType, setAdjustType] = useState<'DAMAGE' | 'LOSS' | 'GIFT' | 'RETURN' | 'ADJUSTMENT'>('DAMAGE');
  const [adjustQtyInput, setAdjustQtyInput] = useState('1');
  const [adjustNote, setAdjustNote] = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  // Price & Cost History Modal states
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyTab, setHistoryTab] = useState<'price' | 'cost'>('cost');
  const [priceHistoryList, setPriceHistoryList] = useState<PriceHistoryRecord[]>([]);
  const [costHistoryList, setCostHistoryList] = useState<CostHistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Barcode Scanner Modal
  const [scannerVisible, setScannerVisible] = useState(false);

  // View Mode: Detail cards vs compact List
  const [viewMode, setViewMode] = useState<'detail' | 'list'>('detail');

  const showAlert = (title: string, message: string, onConfirm?: () => void) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (onConfirm) {
        if (window.confirm(`${title}\n\n${message}`)) {
          onConfirm();
        }
      } else {
        window.alert(`${title}\n\n${message}`);
      }
    } else {
      if (onConfirm) {
        Alert.alert(title, message, [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Đồng ý', onPress: onConfirm }
        ]);
      } else {
        Alert.alert(title, message);
      }
    }
  };

  const loadData = async () => {
    try {
      const [prods, statuses, movs, activeLots, sum, pos] = await Promise.all([
        productRepository.getAll(),
        inventoryRepository.getAllStockStatuses(),
        inventoryRepository.getStockMovements(undefined, 50),
        inventoryRepository.getInventoryLots(),
        inventoryRepository.getInventorySummary(),
        purchaseOrderService.getPurchaseOrders(),
      ]);

      setProducts(prods);
      const statusMap = new Map<number, StockStatus>();
      statuses.forEach((s) => statusMap.set(s.productId, s));
      setStockStatuses(statusMap);
      setMovements(movs);
      setLots(activeLots);
      setSummary(sum);
      setPurchaseOrders(pos);
    } catch (err) {
      console.error('Failed to load inventory data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // --- MULTI-ITEM IMPORT HANDLERS ---
  const openImportModal = () => {
    if (products.length > 0) {
      setImportItems([
        {
          productId: products[0].id,
          quantity: 10,
          unitCostPrice: products[0].current_cost_price || 50000,
          product: products[0],
        }
      ]);
    }
    setImportNote('');
    setImportModalVisible(true);
  };

  const addProductToImport = (prod: Product) => {
    const existing = importItems.find((it) => it.productId === prod.id);
    if (existing) {
      setImportItems((prev) =>
        prev.map((it) => it.productId === prod.id ? { ...it, quantity: it.quantity + 5 } : it)
      );
    } else {
      setImportItems((prev) => [
        ...prev,
        {
          productId: prod.id,
          quantity: 10,
          unitCostPrice: prod.current_cost_price || 50000,
          product: prod,
        }
      ]);
    }
  };

  const removeImportItem = (prodId: number) => {
    setImportItems((prev) => prev.filter((it) => it.productId !== prodId));
  };

  const updateImportItem = (prodId: number, field: 'quantity' | 'unitCostPrice', value: number) => {
    setImportItems((prev) =>
      prev.map((it) => it.productId === prodId ? { ...it, [field]: value } : it)
    );
  };

  const totalImportCost = importItems.reduce(
    (acc, it) => acc + (it.quantity * it.unitCostPrice),
    0
  );

  const handleCommitImport = async () => {
    if (importItems.length === 0) {
      showAlert('Phiếu nhập trống', 'Vui lòng chọn ít nhất một sản phẩm cần nhập.');
      return;
    }

    for (const it of importItems) {
      if (it.quantity <= 0) {
        showAlert('Số lượng không hợp lệ', `Số lượng nhập của '${it.product.name}' phải lớn hơn 0.`);
        return;
      }
      if (it.unitCostPrice < 0) {
        showAlert('Đơn giá không hợp lệ', `Đơn giá của '${it.product.name}' không được âm.`);
        return;
      }
    }

    setSubmittingImport(true);
    try {
      const result = await inventoryRepository.createStockReceipt({
        items: importItems.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          unitCostPrice: it.unitCostPrice,
        })),
        note: `${importSupplier} - ${importNote || 'Nhập kho lô hàng mới'}`,
      });

      showAlert(
        'Nhập kho thành công! ✅',
        `Mã phiếu: ${result?.importRecord?.import_code || (result as any)?.importCode || 'NK-HOAN-TAT'}\nSố mặt hàng: ${importItems.length}\nTổng tiền nhập: ${formatCurrency(result?.importRecord?.total_amount || (result as any)?.totalAmount || 0)}\n\nTồn kho và phân bổ lô FIFO đã ghi nhận tức thì trên Supabase Cloud.`
      );

      setImportModalVisible(false);
      loadData();
    } catch (err: any) {
      showAlert('Lỗi nhập kho', err?.message || 'Không thể tạo phiếu nhập kho.');
    } finally {
      setSubmittingImport(false);
    }
  };

  // --- STOCK ADJUSTMENT HANDLERS ---
  const openAdjustModal = (prod: Product) => {
    setAdjustProduct(prod);
    setAdjustType('DAMAGE');
    setAdjustQtyInput('1');
    setAdjustNote('');
    setAdjustModalVisible(true);
  };

  const handleCommitAdjustment = async () => {
    if (!adjustProduct) return;

    const rawQty = parseInt(adjustQtyInput, 10);
    if (isNaN(rawQty) || rawQty <= 0) {
      showAlert('Số lượng không hợp lệ', 'Số lượng điều chỉnh phải là số nguyên dương.');
      return;
    }

    // Determine final signed change
    const isNegative = ['DAMAGE', 'LOSS', 'GIFT', 'RETURN'].includes(adjustType);
    const quantityChange = isNegative ? -rawQty : rawQty;

    if (isNegative && rawQty > adjustProduct.current_stock) {
      showAlert(
        'Vượt quá tồn kho',
        `Tồn kho khả dụng của '${adjustProduct.name}' chỉ còn ${adjustProduct.current_stock} cái. Không thể xuất giảm ${rawQty} cái.`
      );
      return;
    }

    setSubmittingAdjust(true);
    try {
      const res = await inventoryRepository.adjustStock({
        productId: adjustProduct.id,
        movementType: adjustType,
        quantityChange,
        note: adjustNote || `Điều chỉnh ${adjustType}`,
      });

      showAlert(
        'Điều chỉnh kho thành công! ✅',
        `Sản phẩm: ${res.productName}\nLoại điều chỉnh: ${res.movementType}\nBiến động: ${quantityChange > 0 ? '+' : ''}${quantityChange} cái\nTồn mới sau điều chỉnh: ${res.balanceAfter} cái.`
      );

      setAdjustModalVisible(false);
      loadData();
    } catch (err: any) {
      showAlert('Lỗi điều chỉnh', err?.message || 'Không thể ghi nhận điều chỉnh kho.');
    } finally {
      setSubmittingAdjust(false);
    }
  };

  // --- PRICE & COST HISTORY HANDLERS ---
  const openHistoryModal = async (prod: Product) => {
    setHistoryProduct(prod);
    setHistoryModalVisible(true);
    setLoadingHistory(true);
    try {
      const [priceLogs, costLogs] = await Promise.all([
        inventoryRepository.getPriceHistory(prod.id),
        inventoryRepository.getCostHistory(prod.id),
      ]);
      setPriceHistoryList(priceLogs);
      setCostHistoryList(costLogs);
    } catch (err) {
      console.error('Failed to load price history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // --- PURCHASE ORDER HANDLERS ---
  const openPODetail = (po: PurchaseOrderWithItems) => {
    setSelectedPO(po);
    setPoDetailModalVisible(true);
  };

  const handleConfirmPO = async (orderId: number) => {
    showAlert(
      'Xác nhận đơn mua hàng?',
      'Thao tác này sẽ ghi nhận hàng thực tế về kho, phân bổ các lô tồn kho FIFO và cập nhật giá vốn trung bình gia quyền (WAC). Bạn có chắc chắn muốn xác nhận?',
      async () => {
        setConfirmingPO(true);
        try {
          const res = await purchaseOrderService.confirmPurchaseOrder(orderId);
          const poCode = res?.importCode || res?.import_code || selectedPO?.import_code || `#${orderId}`;
          showAlert('Xác nhận thành công! ✅', `Đơn hàng ${poCode} đã hoàn tất nhập kho thực tế.`);
          setPoDetailModalVisible(false);
          await loadData();
        } catch (err: any) {
          showAlert('Lỗi xác nhận', err?.message || 'Không thể xác nhận đơn mua hàng.');
        } finally {
          setConfirmingPO(false);
        }
      }
    );
  };

  const handleCancelPO = async (orderId: number) => {
    showAlert(
      'Hủy đơn mua hàng',
      'Bạn có chắc chắn muốn hủy đơn mua hàng này không?',
      async () => {
        try {
          await purchaseOrderService.cancelPurchaseOrder(orderId, 'Người dùng hủy trên ứng dụng Mobile');
          showAlert('Thành công', 'Đơn mua hàng đã được chuyển sang trạng thái Hủy.');
          setPoDetailModalVisible(false);
          await loadData();
        } catch (err: any) {
          showAlert('Lỗi', err?.message || 'Không thể hủy đơn mua hàng.');
        }
      }
    );
  };

  const handleAddItemToPO = () => {
    const prod = products.find(p => p.id === poSelectedProdId);
    if (!prod) {
      showAlert('Lỗi', 'Vui lòng chọn một sản phẩm.');
      return;
    }
    const qty = parseInt(poItemQty, 10);
    const cost = parseCurrencyInput(poItemCost);
    if (isNaN(qty) || qty <= 0) {
      showAlert('Lỗi', 'Số lượng nhập phải lớn hơn 0.');
      return;
    }
    if (isNaN(cost) || cost < 0) {
      showAlert('Lỗi', 'Đơn giá nhập không hợp lệ.');
      return;
    }

    setPoItems(prev => {
      const existingIdx = prev.findIndex(it => it.product.id === prod.id);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx].quantity += qty;
        copy[existingIdx].unitCostPrice = cost;
        return copy;
      }
      return [...prev, { product: prod, quantity: qty, unitCostPrice: cost }];
    });
  };

  const handleCreatePO = async () => {
    if (poItems.length === 0) {
      showAlert('Chưa có sản phẩm', 'Vui lòng thêm ít nhất một sản phẩm vào đơn mua hàng.');
      return;
    }
    setSavingPO(true);
    try {
      const created = await purchaseOrderService.createPurchaseOrder({
        supplierId: 1,
        expectedDate: poExpectedDate || undefined,
        note: `${poSupplier} - ${poNote || 'Tạo từ Mobile'}`,
        status: poStatus,
        items: poItems.map(it => ({
          productId: it.product.id,
          quantity: it.quantity,
          unitCostPrice: it.unitCostPrice,
        })),
      });

      showAlert(
        poStatus === 'COMPLETED' ? 'Nhập kho thành công! ✅' : 'Tạo đơn mua hàng thành công! 📝',
        `Mã đơn: ${created.import_code}\nTrạng thái: ${poStatus === 'COMPLETED' ? 'Đã nhập kho' : 'Chờ nhận hàng'}\nTổng tiền: ${formatCurrency(created.total_amount)}`
      );

      setPoCreateModalVisible(false);
      setPoItems([]);
      setPoNote('');
      await loadData();
    } catch (err: any) {
      showAlert('Lỗi tạo đơn', err?.message || 'Không thể tạo đơn mua hàng.');
    } finally {
      setSavingPO(false);
    }
  };

  // --- BULK INVENTORY FILE IMPORT HANDLERS ---
  const loadSampleInventoryCsv = () => {
    const template = fileImportService.getInventoryImportTemplate();
    setFileCsvInput(template);
  };

  const handlePreviewInventoryFile = async () => {
    if (!fileCsvInput.trim()) {
      showAlert('Lỗi', 'Vui lòng nhập hoặc dán nội dung file CSV.');
      return;
    }
    setParsingFileCsv(true);
    try {
      const preview = await fileImportService.previewInventoryImport(fileCsvInput);
      setFileImportPreview(preview);
    } catch (err: any) {
      showAlert('Lỗi file CSV', err?.message || 'Không thể phân tích dữ liệu.');
    } finally {
      setParsingFileCsv(false);
    }
  };

  const handleCommitInventoryFile = async () => {
    if (!fileImportPreview || fileImportPreview.validRows.length === 0) {
      showAlert('Lỗi', 'Không có dòng hợp lệ để nhập kho.');
      return;
    }
    setCommittingFileImport(true);
    try {
      const result = await fileImportService.commitInventoryImport(fileImportPreview);
      showAlert('Nhập kho thành công! ✅', result.message, async () => {
        setFileImportModalVisible(false);
        setFileImportPreview(null);
        setFileCsvInput('');
        await loadData();
      });
    } catch (err: any) {
      showAlert('Lỗi nhập kho', err?.message || 'Không thể hoàn tất nhập kho từ file.');
    } finally {
      setCommittingFileImport(false);
    }
  };

  // Filtered Products
  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const status = stockStatuses.get(p.id);
    const effectiveStock = status && typeof status.effectiveStock === 'number' && !isNaN(status.effectiveStock)
      ? status.effectiveStock
      : (typeof p.current_stock === 'number' && !isNaN(p.current_stock) ? p.current_stock : 0);
    const matchesLowStock = !lowStockOnly || effectiveStock <= p.min_stock_alert;
    return matchesSearch && matchesLowStock;
  });

  // Filtered Movements
  const filteredMovements = movements.filter((m) => {
    if (movementFilter === 'ALL') return true;
    if (movementFilter === 'PURCHASE') return m.movement_type === 'PURCHASE';
    if (movementFilter === 'SALE') return m.movement_type === 'SALE';
    if (movementFilter === 'ADJUSTMENT') return !['PURCHASE', 'SALE'].includes(m.movement_type);
    return true;
  });

  // --- EXPORT STOCK CARD HANDLER ---
  const handleExportStockCard = async () => {
    setExportingMovements(true);
    try {
      const dateTag = new Date().toISOString().slice(0, 10);
      const content = await exportService.exportStockMovementsCsv(1000);
      const filename = `The_kho_bien_dong_${dateTag}.csv`;
      await exportService.shareOrDownloadFile(filename, content);
      showAlert('Xuất thẻ kho thành công! 📤', `Đã xuất ${movements.length} bản ghi thẻ kho ra file [${filename}].`);
    } catch (err: any) {
      showAlert('Lỗi xuất thẻ kho', err?.message || 'Không thể xuất dữ liệu thẻ kho.');
    } finally {
      setExportingMovements(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NetworkBanner />

      <View style={styles.container}>
        {/* Top Summary Banner */}
        <View style={styles.summaryBar}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryVal}>{summary.totalProducts}</Text>
            <Text style={styles.summaryLbl}>Mặt hàng</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryVal, { color: Colors.primary }]}>{summary.totalStock}</Text>
            <Text style={styles.summaryLbl}>Tổng tồn (cái)</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryVal, { color: '#15803D' }]}>{formatCurrency(summary.totalValuation)}</Text>
            <Text style={styles.summaryLbl}>Giá trị kho</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryVal, { color: summary.lowStockCount > 0 ? Colors.danger : '#64748B' }]}>
              {summary.lowStockCount}
            </Text>
            <Text style={styles.summaryLbl}>Tồn ít</Text>
          </View>
        </View>

        {/* Action Buttons Toolbar */}
        <View style={styles.actionsBar}>
          <TouchableOpacity
            style={styles.actionBtnImport}
            onPress={openImportModal}
          >
            <Text style={styles.actionBtnIcon}>📥</Text>
            <Text style={styles.actionBtnText}>Nhập kho</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtnAdjust}
            onPress={() => {
              if (products.length > 0) openAdjustModal(products[0]);
              else showAlert('Chưa có sản phẩm', 'Vui lòng thêm sản phẩm trước khi điều chỉnh kho.');
            }}
          >
            <Text style={styles.actionBtnIcon}>⚖️</Text>
            <Text style={styles.actionBtnText}>Điều chỉnh</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtnAdjust, { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' }]}
            onPress={() => {
              setFileCsvInput('');
              setFileImportPreview(null);
              setFileImportModalVisible(true);
            }}
          >
            <Text style={styles.actionBtnIcon}>📂</Text>
            <Text style={[styles.actionBtnText, { color: '#166534' }]}>Nhập File</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtnAdjust, { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' }]}
            onPress={handleExportStockCard}
            disabled={exportingMovements}
            accessibilityLabel="Xuất sổ thẻ kho ra file CSV"
          >
            <Text style={styles.actionBtnIcon}>📤</Text>
            <Text style={[styles.actionBtnText, { color: '#1D4ED8' }]}>{exportingMovements ? 'Đang xuất...' : 'Xuất Thẻ kho'}</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'status' && styles.activeTabBtn]}
            onPress={() => setActiveTab('status')}
          >
            <Text style={[styles.tabText, activeTab === 'status' && styles.activeTabText]}>
              📦 Tồn kho ({filteredProducts.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'movements' && styles.activeTabBtn]}
            onPress={() => setActiveTab('movements')}
          >
            <Text style={[styles.tabText, activeTab === 'movements' && styles.activeTabText]}>
              📋 Thẻ kho ({movements.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'lots' && styles.activeTabBtn]}
            onPress={() => setActiveTab('lots')}
          >
            <Text style={[styles.tabText, activeTab === 'lots' && styles.activeTabText]}>
              🏷️ Lô FIFO ({lots.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'orders' && styles.activeTabBtn]}
            onPress={() => setActiveTab('orders')}
          >
            <Text style={[styles.tabText, activeTab === 'orders' && styles.activeTabText]}>
              📑 Đơn mua ({purchaseOrders.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* View Mode Toggle Sub-bar */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderColor: '#E2E8F0' }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary }}>
            {activeTab === 'status' ? '📦 Tồn kho sản phẩm' : activeTab === 'movements' ? '📋 Thẻ kho biến động' : activeTab === 'lots' ? '🏷️ Lô hàng FIFO' : '📑 Đơn mua hàng'}
          </Text>

          <View style={{ flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 8, padding: 2 }}>
            <TouchableOpacity
              style={[
                { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
                viewMode === 'detail' && { backgroundColor: '#FFFFFF' }
              ]}
              onPress={() => setViewMode('detail')}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: viewMode === 'detail' ? Colors.primary : Colors.textMuted }}>
                🗂️ Chi tiết
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
                viewMode === 'list' && { backgroundColor: '#FFFFFF' }
              ]}
              onPress={() => setViewMode('list')}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: viewMode === 'list' ? Colors.primary : Colors.textMuted }}>
                📋 Danh sách
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrapper}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Đang đọc dữ liệu kho từ SQLite...</Text>
          </View>
        ) : (
          <ScrollView 
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {/* TAB 1: STOCK STATUS */}
            {activeTab === 'status' && (
              <>
                {/* Search & Low Stock Toggle */}
                <View style={styles.filterBox}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="🔍 Tìm tên sản phẩm, mã SKU..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  <TouchableOpacity
                    style={[styles.lowStockFilterBtn, lowStockOnly && styles.lowStockFilterBtnActive]}
                    onPress={() => setLowStockOnly(!lowStockOnly)}
                  >
                    <Text style={[styles.lowStockFilterText, lowStockOnly && styles.lowStockFilterTextActive]}>
                      ⚠️ Cảnh báo tồn
                    </Text>
                  </TouchableOpacity>
                </View>

                {filteredProducts.length === 0 ? (
                  <EmptyState title="Không tìm thấy sản phẩm" description="Hãy thử tìm kiếm với từ khóa khác." />
                ) : (
                  filteredProducts.map((item) => {
                    const status = stockStatuses.get(item.id);
                    const serverStock = status && typeof status.serverStock === 'number' && !isNaN(status.serverStock)
                      ? status.serverStock
                      : (typeof item.current_stock === 'number' && !isNaN(item.current_stock) ? item.current_stock : 0);
                    const pendingDelta = status && typeof status.pendingDelta === 'number' && !isNaN(status.pendingDelta)
                      ? status.pendingDelta
                      : 0;
                    const effectiveStock = status && typeof status.effectiveStock === 'number' && !isNaN(status.effectiveStock)
                      ? status.effectiveStock
                      : (typeof item.current_stock === 'number' && !isNaN(item.current_stock) ? item.current_stock : 0);
                    const isLow = effectiveStock <= item.min_stock_alert;

                    return viewMode === 'detail' ? (
                      <Card key={item.id} style={styles.itemCard}>
                        <View style={styles.cardTopRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={styles.skuText}>🏷️ {item.sku}</Text>
                            <View style={[styles.stockPillBadge, isLow ? styles.stockPillBadgeLow : styles.stockPillBadgeOk]}>
                              <Text style={[styles.stockPillText, isLow ? styles.stockPillTextLow : styles.stockPillTextOk]}>
                                📦 Tồn: {effectiveStock} cái
                              </Text>
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            <Badge
                              label={isLow ? `Tồn ít (≤${item.min_stock_alert})` : 'Đủ hàng'}
                              variant={isLow ? 'warning' : 'success'}
                            />
                            <TouchableOpacity
                              style={styles.historyChip}
                              onPress={() => openHistoryModal(item)}
                            >
                              <Text style={styles.historyChipText}>📊 Lịch sử giá</Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        <Text style={styles.itemName}>{item.name}</Text>

                        {/* Financial metrics */}
                        <View style={styles.priceRow}>
                          <Text style={styles.priceTag}>
                            Giá vốn: <Text style={{ fontWeight: '700' }}>{formatCurrency(item.current_cost_price)}</Text>
                          </Text>
                          <Text style={styles.priceTag}>
                            Giá bán: <Text style={{ fontWeight: '700', color: Colors.primary }}>{formatCurrency(item.current_selling_price)}</Text>
                          </Text>
                        </View>

                        {/* Stock Balance Breakdown */}
                        <View style={styles.stockBreakdownBox}>
                          <View style={styles.breakdownCol}>
                            <Text style={styles.breakdownLabel}>Server xác nhận:</Text>
                            <Text style={styles.serverStockValue}>{serverStock} cái</Text>
                          </View>
                          {pendingDelta > 0 && (
                            <View style={styles.breakdownCol}>
                              <Text style={styles.breakdownLabel}>Đang chờ sync:</Text>
                              <Text style={styles.pendingStockValue}>-{pendingDelta} cái</Text>
                            </View>
                          )}
                          <View style={styles.breakdownCol}>
                            <Text style={styles.breakdownLabel}>Khả dụng thực tế:</Text>
                            <Text style={[styles.effectiveStockValue, isLow && styles.lowStockText]}>
                              {effectiveStock} cái
                            </Text>
                          </View>
                        </View>

                        {/* Card Quick Actions */}
                        <View style={styles.cardActionRow}>
                          <TouchableOpacity
                            style={styles.cardQuickBtn}
                            onPress={() => openAdjustModal(item)}
                          >
                            <Text style={styles.cardQuickBtnText}>⚖️ Điều chỉnh</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.cardQuickBtn, { backgroundColor: '#EFF6FF', borderColor: '#3B82F6' }]}
                            onPress={() => {
                              addProductToImport(item);
                              setImportModalVisible(true);
                            }}
                          >
                            <Text style={[styles.cardQuickBtnText, { color: '#1D4ED8' }]}>📥 Thêm vào phiếu nhập</Text>
                          </TouchableOpacity>
                        </View>
                      </Card>
                    ) : (
                      <View key={item.id} style={{ backgroundColor: '#FFFFFF', padding: 10, marginBottom: 6, borderRadius: 8, borderWidth: 1, borderColor: isLow ? '#FCA5A5' : '#E2E8F0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: '700', color: Colors.primary }}>{item.sku}</Text>
                            {isLow && <Text style={{ fontSize: 10, color: Colors.danger, fontWeight: '700' }}>⚠️ Cảnh báo</Text>}
                          </View>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.textPrimary }} numberOfLines={1}>{item.name}</Text>
                          <Text style={{ fontSize: 11, color: Colors.textMuted }}>Vốn: {formatCurrency(item.current_cost_price)} • Bán: {formatCurrency(item.current_selling_price)}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[{ fontSize: 14, fontWeight: '800' }, isLow ? { color: Colors.danger } : { color: '#16A34A' }]}>
                            {effectiveStock} cái
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                            <TouchableOpacity onPress={() => openAdjustModal(item)} style={{ paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, backgroundColor: '#FEF3C7' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#92400E' }}>⚖️ Sửa</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => openHistoryModal(item)} style={{ paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, backgroundColor: '#EFF6FF' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#1E40AF' }}>📊 Lịch sử</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            )}

            {/* TAB 2: STOCK MOVEMENTS (LEDGER) */}
            {activeTab === 'movements' && (
              <>
                {/* Movement Filter Chips */}
                <View style={styles.movementFilterRow}>
                  {[
                    { key: 'ALL', label: 'Tất cả' },
                    { key: 'PURCHASE', label: '📥 Nhập kho' },
                    { key: 'SALE', label: '🛒 Xuất bán' },
                    { key: 'ADJUSTMENT', label: '⚖️ Điều chỉnh' },
                  ].map((chip) => (
                    <TouchableOpacity
                      key={chip.key}
                      style={[styles.movementChip, movementFilter === chip.key && styles.movementChipActive]}
                      onPress={() => setMovementFilter(chip.key as any)}
                    >
                      <Text style={[styles.movementChipText, movementFilter === chip.key && styles.movementChipTextActive]}>
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {filteredMovements.length === 0 ? (
                  <EmptyState 
                    title="Chưa có biến động kho" 
                    description="Khi bạn bán hàng, nhập kho hoặc kiểm kê, các giao dịch sẽ ghi nhận append-only tại đây." 
                  />
                ) : (
                  filteredMovements.map((m) => {
                    const isPositive = m.quantity_change > 0;
                    return viewMode === 'detail' ? (
                      <Card key={m.id} style={styles.movementCard}>
                        <View style={styles.cardTopRow}>
                          <Text style={styles.movementDate}>{m.movement_date}</Text>
                          <Badge
                            label={
                              m.movement_type === 'PURCHASE' ? 'Nhập kho' :
                              m.movement_type === 'SALE' ? 'Xuất bán' :
                              m.movement_type === 'DAMAGE' ? 'Hỏng hóc' :
                              m.movement_type === 'LOSS' ? 'Thất thoát' :
                              m.movement_type === 'RETURN' ? 'Trả NCC' : 'Điều chỉnh'
                            }
                            variant={
                              m.movement_type === 'PURCHASE' ? 'success' :
                              m.movement_type === 'SALE' ? 'primary' :
                              ['DAMAGE', 'LOSS', 'RETURN'].includes(m.movement_type) ? 'danger' : 'warning'
                            }
                          />
                        </View>
                        <Text style={styles.movementSku}>{m.product_name || `Mã SP: ${m.product_id}`}</Text>
                        <Text style={styles.movementNote}>{m.note || 'Giao dịch POS'}</Text>
                        <View style={styles.cardBottomRow}>
                          <Text style={styles.balanceText}>Tồn sau GD: <Text style={{ fontWeight: '700' }}>{m.balance_after} cái</Text></Text>
                          <Text
                            style={[
                              styles.changeText,
                              isPositive ? styles.positiveChange : styles.negativeChange,
                            ]}
                          >
                            {isPositive ? `+${m.quantity_change}` : m.quantity_change}
                          </Text>
                        </View>
                      </Card>
                    ) : (
                      <View key={m.id} style={{ backgroundColor: '#FFFFFF', padding: 8, marginBottom: 4, borderRadius: 6, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ fontSize: 11, color: Colors.textMuted }}>{m.movement_date}</Text>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: m.movement_type === 'PURCHASE' ? '#16A34A' : m.movement_type === 'SALE' ? '#2563EB' : '#DC2626' }}>
                              [{m.movement_type}]
                            </Text>
                          </View>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textPrimary }} numberOfLines={1}>
                            {m.product_name || `Mã SP: ${m.product_id}`}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[{ fontSize: 13, fontWeight: '800' }, isPositive ? { color: '#16A34A' } : { color: '#DC2626' }]}>
                            {isPositive ? `+${m.quantity_change}` : m.quantity_change}
                          </Text>
                          <Text style={{ fontSize: 10, color: Colors.textMuted }}>Còn: {m.balance_after} cái</Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            )}

            {/* TAB 3: FIFO INVENTORY LOTS */}
            {activeTab === 'lots' && (
              <>
                <Text style={styles.sectionTitle}>Danh sách lô hàng nhập kho (FIFO Tracking)</Text>
                {lots.length === 0 ? (
                  <EmptyState title="Chưa có lô hàng" description="Khi nhập kho, các lô hàng sẽ được lưu theo thứ tự FIFO." />
                ) : (
                  lots.map((lot) => {
                    const isExhausted = lot.quantity_remaining <= 0;
                    return viewMode === 'detail' ? (
                      <Card key={lot.id} style={[styles.lotCard, isExhausted && { opacity: 0.6 }]}>
                        <View style={styles.cardTopRow}>
                          <Text style={styles.lotCodeText}>🏷️ {lot.lot_code}</Text>
                          <Badge
                            label={isExhausted ? 'Đã xuất hết' : `Còn ${lot.quantity_remaining} cái`}
                            variant={isExhausted ? 'neutral' : 'success'}
                          />
                        </View>
                        <Text style={styles.itemName}>{lot.product_name || `Sản phẩm ID: ${lot.product_id}`}</Text>
                        
                        <View style={styles.lotDetailsRow}>
                          <Text style={styles.lotDetailText}>Ngày nhập: <Text style={{ fontWeight: '700' }}>{lot.purchase_date}</Text></Text>
                          <Text style={styles.lotDetailText}>Đơn giá nhập: <Text style={{ fontWeight: '700', color: '#15803D' }}>{formatCurrency(lot.unit_cost)}</Text></Text>
                        </View>

                        <View style={styles.lotDetailsRow}>
                          <Text style={styles.lotDetailText}>Ban đầu: {lot.quantity_received} cái</Text>
                          <Text style={styles.lotDetailText}>Giá trị còn lại: <Text style={{ fontWeight: '700' }}>{formatCurrency(lot.quantity_remaining * lot.unit_cost)}</Text></Text>
                        </View>
                      </Card>
                    ) : (
                      <View key={lot.id} style={[{ backgroundColor: '#FFFFFF', padding: 8, marginBottom: 4, borderRadius: 6, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, isExhausted && { opacity: 0.6 }]}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: '700', color: Colors.primary }}>{lot.lot_code}</Text>
                            <Text style={{ fontSize: 10, color: Colors.textMuted }}>{lot.purchase_date}</Text>
                          </View>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textPrimary }} numberOfLines={1}>{lot.product_name || `SP ID: ${lot.product_id}`}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#15803D' }}>{formatCurrency(lot.unit_cost)}</Text>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: isExhausted ? Colors.textMuted : '#16A34A' }}>
                            {lot.quantity_remaining}/{lot.quantity_received} cái
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            )}

            {/* TAB 4: PURCHASE ORDERS */}
            {activeTab === 'orders' && (
              <>
                <View style={styles.filterBox}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="🔍 Tìm mã đơn, nhà cung cấp, ghi chú..."
                    value={poSearchQuery}
                    onChangeText={setPoSearchQuery}
                  />
                  <TouchableOpacity
                    style={[styles.actionBtnImport, { paddingVertical: 8, paddingHorizontal: 12 }]}
                    onPress={() => {
                      setPoItems([]);
                      setPoNote('');
                      if (products.length > 0) {
                        setPoSelectedProdId(products[0].id);
                        setPoItemCost(String(products[0].current_cost_price || 80000));
                      }
                      setPoCreateModalVisible(true);
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>+ Đơn mới</Text>
                  </TouchableOpacity>
                </View>

                {/* Status Filter Chips */}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: Spacing.sm }}>
                  {[
                    { key: 'ALL', label: 'Tất cả' },
                    { key: 'PENDING', label: 'Chờ nhận' },
                    { key: 'COMPLETED', label: 'Đã nhập kho' },
                    { key: 'CANCELLED', label: 'Đã hủy' },
                  ].map((s) => (
                    <TouchableOpacity
                      key={s.key}
                      style={[
                        styles.historySwitchBtn,
                        poStatusFilter === s.key && styles.historySwitchBtnActive,
                        { flex: 1, paddingVertical: 6 }
                      ]}
                      onPress={() => setPoStatusFilter(s.key as any)}
                    >
                      <Text style={[styles.historySwitchText, poStatusFilter === s.key && styles.historySwitchTextActive, { fontSize: 12 }]}>
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {(() => {
                  const filteredPOs = purchaseOrders.filter((po) => {
                    const matchesStatus = poStatusFilter === 'ALL' || (po.status || 'COMPLETED') === poStatusFilter;
                    const matchesSearch = !poSearchQuery.trim() || 
                      po.import_code.toLowerCase().includes(poSearchQuery.toLowerCase()) || 
                      (po.supplier_name && po.supplier_name.toLowerCase().includes(poSearchQuery.toLowerCase())) || 
                      (po.note && po.note.toLowerCase().includes(poSearchQuery.toLowerCase()));
                    return matchesStatus && matchesSearch;
                  });

                  if (filteredPOs.length === 0) {
                    return (
                      <EmptyState
                        title="Chưa có đơn mua hàng"
                        description={poSearchQuery ? 'Không có đơn mua hàng nào khớp với tìm kiếm.' : 'Chưa có đơn mua hàng nào trong danh mục này.'}
                      />
                    );
                  }

                  return filteredPOs.map((po) => {
                    const st = po.status || 'COMPLETED';
                    const isPending = st === 'PENDING';
                    const isCompleted = st === 'COMPLETED';

                    return viewMode === 'detail' ? (
                      <TouchableOpacity key={po.id} activeOpacity={0.7} onPress={() => openPODetail(po)}>
                        <Card style={[styles.itemCard, isPending && { borderColor: '#FDE047', borderWidth: 1 }]}>
                          <View style={styles.cardTopRow}>
                            <Text style={[styles.lotCodeText, { fontSize: 14 }]}>🧾 {po.import_code}</Text>
                            <Badge
                              label={isPending ? '⏳ Chờ nhận hàng' : isCompleted ? '✓ Đã nhập kho' : '✕ Đã hủy'}
                              variant={isPending ? 'warning' : isCompleted ? 'success' : 'neutral'}
                            />
                          </View>

                          <Text style={styles.itemName}>NCC: {po.supplier_name || 'Xưởng Thú Bông Miền Nam'}</Text>

                          <View style={styles.lotDetailsRow}>
                            <Text style={styles.lotDetailText}>Ngày tạo: <Text style={{ fontWeight: '600' }}>{po.import_date}</Text></Text>
                            {po.expected_date ? (
                              <Text style={styles.lotDetailText}>Dự kiến: <Text style={{ fontWeight: '600', color: '#B45309' }}>{po.expected_date}</Text></Text>
                            ) : null}
                          </View>

                          <View style={[styles.cardBottomRow, { marginTop: 8 }]}>
                            <Text style={{ fontSize: 12, color: Colors.textMuted }}>
                              Số mặt hàng: {po.items?.length || 1}
                            </Text>
                            <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.primary }}>
                              {formatCurrency(po.total_amount)}
                            </Text>
                          </View>

                          {po.note ? (
                            <Text style={[styles.movementNote, { marginTop: 4 }]} numberOfLines={1}>
                              📝 {po.note}
                            </Text>
                          ) : null}
                        </Card>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity key={po.id} activeOpacity={0.7} onPress={() => openPODetail(po)} style={{ backgroundColor: '#FFFFFF', padding: 10, marginBottom: 6, borderRadius: 8, borderWidth: 1, borderColor: isPending ? '#FDE047' : '#E2E8F0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: '700', color: Colors.primary }}>🧾 {po.import_code}</Text>
                            <Badge
                              label={isPending ? 'Chờ nhận' : isCompleted ? 'Đã nhập' : 'Đã hủy'}
                              variant={isPending ? 'warning' : isCompleted ? 'success' : 'neutral'}
                            />
                          </View>
                          <Text style={{ fontSize: 12, color: Colors.textPrimary }} numberOfLines={1}>{po.supplier_name || 'Nhà cung cấp'}</Text>
                          <Text style={{ fontSize: 11, color: Colors.textMuted }}>Ngày: {po.import_date} {po.expected_date ? `• Hẹn: ${po.expected_date}` : ''}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E40AF' }}>{formatCurrency(po.total_amount)}</Text>
                          {isPending && (
                            <View style={{ marginTop: 4, backgroundColor: '#DCFCE7', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#166534' }}>✓ Nhập kho</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  });
                })()}
              </>
            )}
          </ScrollView>
        )}
      </View>

      {/* MODAL 1: MULTI-ITEM IMPORT (NHẬP KHO) */}
      <Modal visible={importModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📥 Tạo Phiếu Nhập Kho</Text>
              <TouchableOpacity onPress={() => setImportModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={styles.inputLabel}>Nhà cung cấp:</Text>
              <TextInput
                style={styles.modalInput}
                value={importSupplier}
                onChangeText={setImportSupplier}
                placeholder="Nhập tên nhà cung cấp..."
              />

              <Text style={styles.inputLabel}>Ghi chú phiếu nhập:</Text>
              <TextInput
                style={styles.modalInput}
                value={importNote}
                onChangeText={setImportNote}
                placeholder="Ví dụ: Nhập hàng đầu tháng, lô đồ chơi lắp ráp..."
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 }}>
                <Text style={styles.sectionSubtitle}>Danh sách sản phẩm nhập ({importItems.length})</Text>
                <TouchableOpacity
                  style={styles.scannerIconBtn}
                  onPress={() => setScannerVisible(true)}
                >
                  <Text style={{ fontSize: 13, marginRight: 4 }}>📷</Text>
                  <Text style={{ fontSize: 12, color: Colors.primary, fontWeight: '700' }}>Quét mã</Text>
                </TouchableOpacity>
              </View>

              {/* Quick Select Product Chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {products.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.quickAddChip}
                    onPress={() => addProductToImport(p)}
                  >
                    <Text style={styles.quickAddChipText}>+ {p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Items in batch */}
              {importItems.map((item) => {
                const lineTotal = item.quantity * item.unitCostPrice;
                return (
                  <View key={item.productId} style={styles.importItemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.importItemName}>{item.product.name}</Text>
                      <Text style={styles.importItemSku}>SKU: {item.product.sku} | Tồn hiện tại: {item.product.current_stock}</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.microLabel}>Số lượng nhập:</Text>
                          <TextInput
                            style={styles.numberInput}
                            keyboardType="numeric"
                            value={item.quantity.toString()}
                            onChangeText={(v) => updateImportItem(item.productId, 'quantity', parseInt(v, 10) || 0)}
                          />
                        </View>
                        <View style={{ flex: 1.5 }}>
                          <Text style={styles.microLabel}>Giá nhập (VNĐ):</Text>
                          <TextInput
                            style={styles.numberInput}
                            keyboardType="numeric"
                            value={item.unitCostPrice.toString()}
                            onChangeText={(v) => updateImportItem(item.productId, 'unitCostPrice', parseFloat(v) || 0)}
                          />
                        </View>
                      </View>
                      <Text style={styles.importLineTotal}>Thành tiền: {formatCurrency(lineTotal)}</Text>
                    </View>

                    <TouchableOpacity
                      style={styles.removeImportBtn}
                      onPress={() => removeImportItem(item.productId)}
                    >
                      <Text style={{ color: Colors.danger, fontWeight: 'bold' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              {/* Grand Total */}
              <View style={styles.totalBox}>
                <Text style={styles.totalLabel}>Tổng tiền nhập kho:</Text>
                <Text style={styles.totalAmount}>{formatCurrency(totalImportCost)}</Text>
              </View>

              <Button
                title={submittingImport ? "Đang ghi nhận..." : "Xác nhận Nhập kho"}
                onPress={handleCommitImport}
                loading={submittingImport}
                size="lg"
                style={{ marginTop: Spacing.md }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: STOCK ADJUSTMENT (ĐIỀU CHỈNH KHO) */}
      <Modal visible={adjustModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>⚖️ Điều chỉnh kiểm kê kho</Text>
              <TouchableOpacity onPress={() => setAdjustModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {adjustProduct && (
                <View style={styles.adjustProductHeader}>
                  <Text style={styles.adjustProductName}>{adjustProduct.name}</Text>
                  <Text style={styles.adjustProductStock}>Tồn khả dụng hiện tại: <Text style={{ fontWeight: '700' }}>{adjustProduct.current_stock} cái</Text></Text>
                </View>
              )}

              <Text style={styles.inputLabel}>Lý do điều chỉnh:</Text>
              <View style={styles.adjustTypeGrid}>
                {ADJUSTMENT_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.adjustTypeBtn, adjustType === t.key && styles.adjustTypeBtnActive]}
                    onPress={() => setAdjustType(t.key as any)}
                  >
                    <Text style={[styles.adjustTypeBtnText, adjustType === t.key && styles.adjustTypeBtnTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Số lượng thay đổi:</Text>
              <TextInput
                style={styles.modalInput}
                keyboardType="numeric"
                value={adjustQtyInput}
                onChangeText={setAdjustQtyInput}
                placeholder="Nhập số lượng (Ví dụ: 1, 5, 10)..."
              />

              <Text style={styles.inputLabel}>Ghi chú biên bản kiểm kê:</Text>
              <TextInput
                style={styles.modalInput}
                value={adjustNote}
                onChangeText={setAdjustNote}
                placeholder="Ví dụ: Rách bao bì trong lúc vận chuyển, vỡ đồ chơi..."
              />

              <Button
                title={submittingAdjust ? "Đang xử lý..." : "Xác nhận Điều chỉnh"}
                onPress={handleCommitAdjustment}
                loading={submittingAdjust}
                variant="danger"
                size="lg"
                style={{ marginTop: Spacing.md }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL 3: PRICE & COST HISTORY MODAL */}
      <Modal visible={historyModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📊 Lịch sử Giá & Giá vốn</Text>
                {historyProduct && (
                  <Text style={{ fontSize: 12, color: '#64748B' }}>{historyProduct.name} ({historyProduct.sku})</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setHistoryModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            {/* Switch between Price and Cost History */}
            <View style={styles.historySwitchRow}>
              <TouchableOpacity
                style={[styles.historySwitchBtn, historyTab === 'cost' && styles.historySwitchBtnActive]}
                onPress={() => setHistoryTab('cost')}
              >
                <Text style={[styles.historySwitchText, historyTab === 'cost' && styles.historySwitchTextActive]}>
                  Lịch sử Giá nhập ({costHistoryList.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.historySwitchBtn, historyTab === 'price' && styles.historySwitchBtnActive]}
                onPress={() => setHistoryTab('price')}
              >
                <Text style={[styles.historySwitchText, historyTab === 'price' && styles.historySwitchTextActive]}>
                  Lịch sử Giá bán ({priceHistoryList.length})
                </Text>
              </TouchableOpacity>
            </View>

            {loadingHistory ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
            ) : (
              <ScrollView style={{ maxHeight: 350 }}>
                {historyTab === 'cost' ? (
                  costHistoryList.length === 0 ? (
                    <Text style={styles.emptyHistoryText}>Chưa có bản ghi lịch sử giá nhập.</Text>
                  ) : (
                    costHistoryList.map((log) => (
                      <View key={log.id} style={styles.historyLogRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyEffectiveDate}>Áp dụng từ: {log.effective_from}</Text>
                          <Text style={styles.historyLogNote}>{log.note || 'Nhập kho lô hàng'}</Text>
                        </View>
                        <Text style={styles.historyCostVal}>{formatCurrency(log.cost_price)}</Text>
                      </View>
                    ))
                  )
                ) : (
                  priceHistoryList.length === 0 ? (
                    <Text style={styles.emptyHistoryText}>Chưa có bản ghi lịch sử giá bán.</Text>
                  ) : (
                    priceHistoryList.map((log) => (
                      <View key={log.id} style={styles.historyLogRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyEffectiveDate}>Áp dụng từ: {log.effective_from}</Text>
                          <Text style={styles.historyLogNote}>{log.note || 'Cập nhật giá bán lẻ'}</Text>
                        </View>
                        <Text style={styles.historyPriceVal}>{formatCurrency(log.price)}</Text>
                      </View>
                    ))
                  )
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL 4: PURCHASE ORDER DETAIL & RECEIVING MODAL */}
      <Modal
        visible={poDetailModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPoDetailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            {selectedPO && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Chi tiết Đơn mua: {selectedPO.import_code}</Text>
                    <Text style={styles.modalSubtitle}>NCC: {selectedPO.supplier_name || 'Nhà cung cấp'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setPoDetailModalVisible(false)}>
                    <Text style={styles.modalCloseText}>✕ Đóng</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
                  <Card style={{ padding: 12, marginBottom: 12 }}>
                    <View style={styles.cardTopRow}>
                      <Text style={{ fontSize: 13, color: Colors.textMuted }}>Trạng thái:</Text>
                      <Badge
                        label={selectedPO.status === 'PENDING' ? 'Chờ nhận hàng' : selectedPO.status === 'COMPLETED' ? 'Đã nhập kho' : 'Đã hủy'}
                        variant={selectedPO.status === 'PENDING' ? 'warning' : selectedPO.status === 'COMPLETED' ? 'success' : 'neutral'}
                      />
                    </View>
                    <Text style={{ fontSize: 13, color: Colors.textSecondary, marginTop: 4 }}>
                      Ngày đặt hàng: {selectedPO.import_date}
                    </Text>
                    {selectedPO.expected_date ? (
                      <Text style={{ fontSize: 13, color: '#B45309', marginTop: 2 }}>
                        Ngày dự kiến nhận: {selectedPO.expected_date}
                      </Text>
                    ) : null}
                    {selectedPO.note ? (
                      <Text style={{ fontSize: 13, color: Colors.textSecondary, marginTop: 4, fontStyle: 'italic' }}>
                        Ghi chú: {selectedPO.note}
                      </Text>
                    ) : null}
                  </Card>

                  <Text style={styles.sectionSubtitle}>Danh sách mặt hàng nhập ({selectedPO.items?.length || 0}):</Text>
                  {selectedPO.items?.map((it, idx) => (
                    <View key={idx} style={[styles.importItemRow, { marginVertical: 4 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '700', fontSize: 14 }}>{it.product_name || `Mã SP: ${it.product_id}`}</Text>
                        <Text style={{ fontSize: 12, color: Colors.textMuted }}>SKU: {it.sku} | Giá nhập: {formatCurrency(it.unit_cost_price)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 14, fontWeight: '700' }}>x{it.quantity}</Text>
                        <Text style={{ fontSize: 13, color: Colors.primary, fontWeight: '600' }}>{formatCurrency(it.total_amount)}</Text>
                      </View>
                    </View>
                  ))}

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: Colors.border }}>
                    <Text style={{ fontSize: 16, fontWeight: '700' }}>Tổng giá trị đơn:</Text>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: Colors.primary }}>{formatCurrency(selectedPO.total_amount)}</Text>
                  </View>

                  {/* Actions for PENDING order */}
                  {selectedPO.status === 'PENDING' && (
                    <View style={{ marginTop: 16, gap: 10 }}>
                      <Button
                        title={confirmingPO ? 'Đang xác nhận...' : '✓ Xác nhận đơn & Nhập hàng vào kho'}
                        onPress={() => handleConfirmPO(selectedPO.id)}
                        disabled={confirmingPO}
                        variant="primary"
                        size="lg"
                      />
                      <Button
                        title="✕ Hủy đơn mua hàng"
                        onPress={() => handleCancelPO(selectedPO.id)}
                        disabled={confirmingPO}
                        variant="outline"
                        size="md"
                      />
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL 5: CREATE PURCHASE ORDER MODAL */}
      <Modal
        visible={poCreateModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPoCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '92%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📝 Tạo Đơn Mua Hàng Mới</Text>
              <TouchableOpacity onPress={() => setPoCreateModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Nhà cung cấp (*):</Text>
              <TextInput
                style={styles.modalInput}
                value={poSupplier}
                onChangeText={setPoSupplier}
                placeholder="Tên nhà cung cấp..."
              />

              <Text style={styles.inputLabel}>Ngày dự kiến nhận hàng (YYYY-MM-DD):</Text>
              <TextInput
                style={styles.modalInput}
                value={poExpectedDate}
                onChangeText={setPoExpectedDate}
                placeholder="VD: 2026-09-15"
              />

              <Text style={styles.inputLabel}>Trạng thái ban đầu:</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <TouchableOpacity
                  style={[
                    styles.historySwitchBtn,
                    poStatus === 'PENDING' && styles.historySwitchBtnActive,
                    { flex: 1, paddingVertical: 8 }
                  ]}
                  onPress={() => setPoStatus('PENDING')}
                >
                  <Text style={[styles.historySwitchText, poStatus === 'PENDING' && styles.historySwitchTextActive]}>
                    ⏳ Chờ nhận hàng (Khuyên dùng)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.historySwitchBtn,
                    poStatus === 'COMPLETED' && styles.historySwitchBtnActive,
                    { flex: 1, paddingVertical: 8 }
                  ]}
                  onPress={() => setPoStatus('COMPLETED')}
                >
                  <Text style={[styles.historySwitchText, poStatus === 'COMPLETED' && styles.historySwitchTextActive]}>
                    ✓ Nhập kho ngay
                  </Text>
                </TouchableOpacity>
              </View>

              <Card style={{ padding: 12, marginBottom: 12, backgroundColor: '#F8FAFC' }}>
                <Text style={{ fontWeight: '700', fontSize: 13, marginBottom: 6 }}>Thêm sản phẩm vào đơn:</Text>
                <Text style={styles.inputLabel}>Chọn sản phẩm:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  {products.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[
                        styles.historySwitchBtn,
                        poSelectedProdId === p.id && styles.historySwitchBtnActive,
                        { marginRight: 6, paddingVertical: 6, paddingHorizontal: 10 }
                      ]}
                      onPress={() => {
                        setPoSelectedProdId(p.id);
                        setPoItemCost(formatCurrencyInput(p.current_cost_price || 80000));
                      }}
                    >
                      <Text style={[styles.historySwitchText, poSelectedProdId === p.id && styles.historySwitchTextActive, { fontSize: 12 }]}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Số lượng:</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={poItemQty}
                      onChangeText={setPoItemQty}
                      keyboardType="numeric"
                      placeholder="10"
                    />
                  </View>
                  <View style={{ flex: 1.5 }}>
                    <Text style={styles.inputLabel}>Đơn giá nhập (VND):</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={poItemCost}
                      onChangeText={(t) => setPoItemCost(formatCurrencyInput(t))}
                      keyboardType="numeric"
                      placeholder="80,000"
                    />
                  </View>
                </View>

                <Button
                  title="+ Thêm vào đơn"
                  onPress={handleAddItemToPO}
                  variant="secondary"
                  size="sm"
                  style={{ marginTop: 8 }}
                />
              </Card>

              {/* Items Summary Table */}
              <Text style={styles.sectionSubtitle}>Sản phẩm trong đơn ({poItems.length}):</Text>
              {poItems.length === 0 ? (
                <Text style={{ color: Colors.textMuted, fontSize: 13, marginVertical: 8, fontStyle: 'italic' }}>
                  Chưa có sản phẩm nào được chọn.
                </Text>
              ) : (
                poItems.map((it, idx) => (
                  <View key={idx} style={[styles.importItemRow, { marginVertical: 4 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600', fontSize: 13 }}>{it.product.name}</Text>
                      <Text style={{ fontSize: 11, color: Colors.textMuted }}>{it.quantity} x {formatCurrency(it.unitCostPrice)}</Text>
                    </View>
                    <Text style={{ fontWeight: '700', fontSize: 13, color: Colors.primary }}>
                      {formatCurrency(it.quantity * it.unitCostPrice)}
                    </Text>
                  </View>
                ))
              )}

              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Ghi chú:</Text>
              <TextInput
                style={styles.modalInput}
                value={poNote}
                onChangeText={setPoNote}
                placeholder="Ghi chú đợt mua hàng..."
              />

              <Button
                title={savingPO ? 'Đang tạo đơn...' : '✓ Hoàn tất tạo đơn mua hàng'}
                onPress={handleCreatePO}
                disabled={savingPO || poItems.length === 0}
                variant="primary"
                size="lg"
                style={{ marginTop: 16 }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL 6: INVENTORY BULK FILE IMPORT (CSV) MODAL */}
      <Modal
        visible={fileImportModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setFileImportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '92%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📂 Nhập Kho Từ File CSV / Excel</Text>
                <Text style={styles.modalSubtitle}>Nhập tồn kho & tạo các lô FIFO tự động</Text>
              </View>
              <TouchableOpacity onPress={() => setFileImportModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              <View style={{ backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#86EFAC', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <Text style={{ fontWeight: '700', color: '#166534', fontSize: 13 }}>📋 Quy trình nhập kho chuẩn:</Text>
                <Text style={{ fontSize: 12, color: '#15803D', lineHeight: 18, marginTop: 4 }}>
                  Cột dữ liệu yêu cầu: Mã SKU, Số lượng nhập, Đơn giá nhập, Nhà cung cấp.{'\n'}
                  Hệ thống tự động kiểm tra SKU tồn tại, tạo lô FIFO, tính giá vốn WAC và đồng bộ Outbox.
                </Text>
                <Button
                  title="📄 Dán mẫu dữ liệu nhập kho demo"
                  onPress={loadSampleInventoryCsv}
                  variant="outline"
                  size="sm"
                  style={{ marginTop: 8 }}
                />
              </View>

              <Text style={styles.inputLabel}>Nội dung CSV:</Text>
              <TextInput
                style={[styles.modalInput, { height: 120, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 12 }]}
                multiline
                numberOfLines={6}
                value={fileCsvInput}
                onChangeText={setFileCsvInput}
                placeholder="Dán nội dung CSV nhập kho vào đây..."
              />

              <Button
                title={parsingFileCsv ? 'Đang phân tích...' : '🔍 Kiểm tra dữ liệu file'}
                onPress={handlePreviewInventoryFile}
                disabled={parsingFileCsv || !fileCsvInput.trim()}
                variant="secondary"
                size="md"
                style={{ marginVertical: 10 }}
              />

              {fileImportPreview && (
                <View style={{ backgroundColor: '#F8FAFC', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, marginTop: 8 }}>
                  <Text style={{ fontWeight: '700', fontSize: 14 }}>Kết quả kiểm tra dữ liệu:</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginVertical: 8 }}>
                    <View style={{ flex: 1, backgroundColor: '#DCFCE7', padding: 10, borderRadius: 6, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '700', color: '#166534' }}>{fileImportPreview.validRows.length}</Text>
                      <Text style={{ fontSize: 11, color: '#15803D' }}>Hàng hợp lệ</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: '#FEE2E2', padding: 10, borderRadius: 6, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '700', color: '#991B1B' }}>{fileImportPreview.errorRows.length}</Text>
                      <Text style={{ fontSize: 11, color: '#991B1B' }}>Dòng lỗi</Text>
                    </View>
                    <View style={{ flex: 1.5, backgroundColor: '#EFF6FF', padding: 10, borderRadius: 6, alignItems: 'center' }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#1E40AF' }}>{formatCurrency(fileImportPreview.summary.totalAmount || 0)}</Text>
                      <Text style={{ fontSize: 11, color: '#1E3A8A' }}>Tổng giá trị</Text>
                    </View>
                  </View>

                  {fileImportPreview.errorRows.length > 0 && (
                    <View style={{ backgroundColor: '#FEF2F2', padding: 8, borderRadius: 6, marginVertical: 6 }}>
                      <Text style={{ fontWeight: '700', color: '#991B1B', fontSize: 12 }}>⚠️ Các lỗi cần sửa:</Text>
                      {fileImportPreview.errorRows.map((er, idx) => (
                        <Text key={idx} style={{ fontSize: 11, color: '#B91C1C' }}>
                          • Dòng {er.rowNumber}: {er.reason}
                        </Text>
                      ))}
                    </View>
                  )}

                  <Button
                    title={committingFileImport ? 'Đang ghi vào kho...' : `✓ Xác nhận nhập kho ${fileImportPreview.validRows.length} mặt hàng`}
                    onPress={handleCommitInventoryFile}
                    disabled={committingFileImport || fileImportPreview.validRows.length === 0}
                    variant="primary"
                    size="lg"
                    style={{ marginTop: 12 }}
                  />
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanBarcode={async (barcode: string) => {
          const prod = products.find((p) => p.sku.toLowerCase() === barcode.trim().toLowerCase());
          if (prod) {
            addProductToImport(prod);
            return { success: true, message: `Đã thêm: ${prod.name}` };
          }
          return { success: false, message: `Không tìm thấy sản phẩm khớp mã: ${barcode}` };
        }}
      />
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
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryVal: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.text,
  },
  summaryLbl: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.borderSubtle,
  },
  actionsBar: {
    flexDirection: 'row',
    gap: 8,
    padding: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  actionBtnImport: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#22C55E',
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
  },
  actionBtnAdjust: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
  },
  actionBtnIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  activeTabText: {
    color: Colors.primary,
    fontWeight: '700',
  },
  loadingWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.bodySm.fontSize,
    color: Colors.textMuted,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  filterBox: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 13,
  },
  lowStockFilterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
  },
  lowStockFilterBtnActive: {
    backgroundColor: '#FEE2E2',
    borderColor: Colors.danger,
  },
  lowStockFilterText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  lowStockFilterTextActive: {
    color: Colors.danger,
    fontWeight: '700',
  },
  itemCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  skuText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  priceTag: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  historyChip: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  historyChipText: {
    fontSize: 10,
    color: '#1D4ED8',
    fontWeight: '700',
  },
  stockBreakdownBox: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.sm,
    padding: 6,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    marginTop: 4,
  },
  breakdownCol: {
    flex: 1,
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  serverStockValue: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
  },
  pendingStockValue: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.warning,
  },
  effectiveStockValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#15803D',
  },
  lowStockText: {
    color: Colors.danger,
  },
  cardActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardQuickBtn: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardQuickBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
  },
  movementFilterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: Spacing.sm,
    flexWrap: 'wrap',
  },
  movementChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  movementChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  movementChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  movementChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  movementCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  movementDate: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  movementSku: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 2,
  },
  movementNote: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: '#F1F5F9',
  },
  balanceText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  changeText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  positiveChange: {
    color: '#16A34A',
  },
  negativeChange: {
    color: '#DC2626',
  },
  lotCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  lotCodeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  lotDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  lotDetailText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.lg,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
    paddingBottom: Spacing.sm,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  modalCloseText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 8,
    marginBottom: 4,
  },
  microLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  scannerIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  quickAddChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 6,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  quickAddChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
  },
  importItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: BorderRadius.md,
    padding: 10,
    marginBottom: 8,
  },
  importItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  importItemSku: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  numberInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  importLineTotal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
    marginTop: 6,
  },
  removeImportBtn: {
    padding: 8,
    marginLeft: 6,
  },
  totalBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: BorderRadius.md,
    padding: 12,
    marginTop: 10,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#15803D',
  },
  adjustProductHeader: {
    backgroundColor: '#F1F5F9',
    padding: 10,
    borderRadius: BorderRadius.md,
    marginBottom: 8,
  },
  adjustProductName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  adjustProductStock: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  adjustTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  adjustTypeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  adjustTypeBtnActive: {
    backgroundColor: '#FEE2E2',
    borderColor: Colors.danger,
  },
  adjustTypeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  adjustTypeBtnTextActive: {
    color: Colors.danger,
    fontWeight: '700',
  },
  historySwitchRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    padding: 3,
    marginBottom: 10,
  },
  historySwitchBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 4,
  },
  historySwitchBtnActive: {
    backgroundColor: '#fff',
  },
  historySwitchText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  historySwitchTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  emptyHistoryText: {
    textAlign: 'center',
    color: Colors.textMuted,
    padding: 20,
    fontSize: 12,
  },
  historyLogRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  historyEffectiveDate: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  historyLogNote: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  historyCostVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803D',
  },
  historyPriceVal: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  stockPillBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
  },
  stockPillBadgeOk: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  stockPillBadgeLow: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  stockPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  stockPillTextOk: {
    color: '#15803D',
  },
  stockPillTextLow: {
    color: '#DC2626',
  },
});

export default InventoryScreen;
