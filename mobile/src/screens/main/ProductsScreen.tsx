import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Input from '../../components/common/Input';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import NetworkBanner from '../../components/common/NetworkBanner';
import { formatCurrency, formatDateTime, formatCurrencyInput, parseCurrencyInput } from '../../utils/formatters';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';
import productRepository from '../../repository/ProductRepository';
import categoryRepository from '../../repository/CategoryRepository';
import fileImportService, { ProductImportRow, FileImportPreview } from '../../services/FileImportService';
import exportService from '../../services/ExportService';
import { Product, Category, ProductStatus } from '../../types/domain';
import { useAuth } from '../../auth/AuthContext';

export const ProductsScreen: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'detail' | 'list'>('detail');

  // --- Modal States ---
  // 1. Product Detail Modal
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'priceHistory' | 'costHistory' | 'movements'>('info');
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [costHistory, setCostHistory] = useState<any[]>([]);
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 2. Product Edit Modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSku, setEditSku] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<number>(1);
  const [editSellingPrice, setEditSellingPrice] = useState('0');
  const [editMinStock, setEditMinStock] = useState('5');
  const [editStatus, setEditStatus] = useState<ProductStatus>('ACTIVE');
  const [editDescription, setEditDescription] = useState('');
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  // 3. Category Management Modal
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);

  // 4. Product File Import Modal
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [csvInput, setCsvInput] = useState('');
  const [importPreview, setImportPreview] = useState<FileImportPreview<ProductImportRow> | null>(null);
  const [parsingCsv, setParsingCsv] = useState(false);
  const [committingImport, setCommittingImport] = useState(false);
  const [exportingData, setExportingData] = useState(false);

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

  const loadData = useCallback(async (forceRemote = false) => {
    try {
      const cats = await categoryRepository.getAll(forceRemote);
      let prods = search.trim()
        ? await productRepository.search(search)
        : await productRepository.getAll(forceRemote);

      if (selectedCategory) {
        prods = prods.filter((p) => p.category_id === selectedCategory);
      }
      setCategories(cats);
      setProducts(prods);
    } catch (err) {
      console.error('ProductsScreen load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCategory, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData(true);
  };

  // --- Product Detail Handlers ---
  const openProductDetail = async (prod: Product) => {
    setSelectedProduct(prod);
    setDetailTab('info');
    setDetailModalVisible(true);
    setLoadingHistory(true);
    try {
      const [ph, ch, sm] = await Promise.all([
        productRepository.getPriceHistory(prod.id),
        productRepository.getCostHistory(prod.id),
        productRepository.getStockMovements(prod.id),
      ]);
      setPriceHistory(ph);
      setCostHistory(ch);
      setStockMovements(sm);
    } catch (err) {
      console.error('Failed to load histories:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // --- Product Edit / Create Handlers ---
  const openCreateProduct = () => {
    if (!isAdmin) {
      showAlert('Quyền hạn', 'Tài khoản của bạn có vai trò Nhân viên. Chỉ Quản trị viên (Admin) mới có quyền tạo sản phẩm mới.');
      return;
    }
    setIsCreatingProduct(true);
    setSelectedProduct(null);
    setEditName('');
    setEditSku(`SKU-${Date.now().toString().slice(-6)}`);
    setEditBarcode('');
    setEditCategoryId(categories[0]?.id || 1);
    setEditSellingPrice('0');
    setEditMinStock('5');
    setEditStatus('ACTIVE');
    setEditDescription('');
    setIsFormDirty(false);
    setEditModalVisible(true);
  };

  const openEditProduct = (prod: Product) => {
    if (!isAdmin) {
      showAlert('Quyền hạn', 'Tài khoản của bạn có vai trò Nhân viên. Chỉ Quản trị viên (Admin) mới có quyền chỉnh sửa thông tin sản phẩm.');
      return;
    }
    setIsCreatingProduct(false);
    setSelectedProduct(prod);
    setEditName(prod.name);
    setEditSku(prod.sku);
    setEditBarcode(prod.barcode || prod.sku);
    setEditCategoryId(prod.category_id);
    setEditSellingPrice(formatCurrencyInput(prod.current_selling_price));
    setEditMinStock(String(prod.min_stock_alert || 5));
    setEditStatus(prod.status);
    setEditDescription(prod.description || '');
    setIsFormDirty(false);
    setEditModalVisible(true);
  };

  const handleCloseEdit = () => {
    if (isFormDirty) {
      showAlert(
        'Thay đổi chưa lưu',
        'Bạn có dữ liệu chưa lưu. Bạn có chắc chắn muốn hủy và đóng lại không?',
        () => {
          setEditModalVisible(false);
          setIsFormDirty(false);
        }
      );
    } else {
      setEditModalVisible(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!editName.trim()) {
      showAlert('Lỗi nhập liệu', 'Vui lòng nhập tên sản phẩm.');
      return;
    }
    const priceNum = parseCurrencyInput(editSellingPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      showAlert('Lỗi nhập liệu', 'Giá bán phải là số hợp lệ (>= 0).');
      return;
    }

    setSavingProduct(true);
    try {
      if (isCreatingProduct) {
        await productRepository.createProduct({
          sku: editSku.trim(),
          name: editName.trim(),
          category_id: editCategoryId,
          product_type_id: 1,
          selling_price: priceNum,
          min_stock_alert: Number(editMinStock) || 5,
          description: editDescription.trim() || undefined,
        });
        showAlert('Thành công', 'Đã tạo mới sản phẩm và lưu an toàn vào SQLite.');
      } else if (selectedProduct) {
        await productRepository.updateProduct(selectedProduct.id, {
          name: editName.trim(),
          sku: editSku.trim(),
          category_id: editCategoryId,
          selling_price: priceNum,
          min_stock_alert: Number(editMinStock) || 5,
          status: editStatus,
          description: editDescription.trim() || undefined,
        });
        showAlert('Thành công', 'Đã cập nhật thông tin sản phẩm và lịch sử giá bán.');
      }

      setIsFormDirty(false);
      setEditModalVisible(false);
      setDetailModalVisible(false);
      await loadData();
    } catch (err: any) {
      showAlert('Lỗi lưu sản phẩm', err.message || 'Không thể lưu sản phẩm.');
    } finally {
      setSavingProduct(false);
    }
  };

  // --- Category Management Handlers ---
  const openCategoryManager = async () => {
    if (!isAdmin) {
      showAlert('Quyền hạn', 'Tài khoản của bạn có vai trò Nhân viên. Chỉ Quản trị viên (Admin) mới có quyền quản lý danh mục.');
      return;
    }
    setCategoryModalVisible(true);
    setShowAddCategory(false);
    setEditingCategory(null);
    setCategorySearch('');
    const list = await categoryRepository.getAll();
    setCategoryList(list);
  };

  const handleSearchCategories = async (query: string) => {
    setCategorySearch(query);
    const filtered = await categoryRepository.search(query);
    setCategoryList(filtered);
  };

  const handleSaveCategory = async () => {
    if (!newCatName.trim()) {
      showAlert('Lỗi', 'Vui lòng nhập tên danh mục.');
      return;
    }
    setSavingCategory(true);
    try {
      if (editingCategory) {
        await categoryRepository.updateCategory(editingCategory.id, {
          name: newCatName.trim(),
          code: newCatCode.trim() || editingCategory.code,
          description: newCatDesc.trim() || undefined,
        });
        showAlert('Thành công', 'Đã cập nhật danh mục.');
      } else {
        const code = newCatCode.trim() || `CAT-${Date.now().toString().slice(-4)}`;
        await categoryRepository.createCategory({
          code,
          name: newCatName.trim(),
          description: newCatDesc.trim() || undefined,
        });
        showAlert('Thành công', 'Đã tạo danh mục mới.');
      }
      setNewCatCode('');
      setNewCatName('');
      setNewCatDesc('');
      setEditingCategory(null);
      setShowAddCategory(false);
      const list = await categoryRepository.getAll();
      setCategoryList(list);
      await loadData();
    } catch (err: any) {
      showAlert('Lỗi', err.message || 'Không thể lưu danh mục.');
    } finally {
      setSavingCategory(false);
    }
  };

  const startEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setNewCatName(cat.name);
    setNewCatCode(cat.code);
    setNewCatDesc(cat.description || '');
    setShowAddCategory(true);
  };

  const cancelCategoryForm = () => {
    setEditingCategory(null);
    setNewCatName('');
    setNewCatCode('');
    setNewCatDesc('');
    setShowAddCategory(false);
  };

  const handleDeleteCategory = (cat: Category) => {
    setDeletingCategory(cat);
  };

  const confirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    setIsDeletingCategory(true);
    try {
      await categoryRepository.deleteCategory(deletingCategory.id);
      const list = await categoryRepository.getAll();
      setCategoryList(list);
      await loadData();
      setDeletingCategory(null);
    } catch (err: any) {
      showAlert('Lỗi', err.message || 'Không thể xóa danh mục.');
      setDeletingCategory(null);
    } finally {
      setIsDeletingCategory(false);
    }
  };

  // --- Product File Import Handlers ---
  const openImportModal = () => {
    if (!isAdmin) {
      showAlert('Quyền hạn', 'Tài khoản của bạn có vai trò Nhân viên. Chỉ Quản trị viên (Admin) mới có quyền nhập file CSV.');
      return;
    }
    setCsvInput('');
    setImportPreview(null);
    setImportModalVisible(true);
  };

  const loadSampleProductCsv = () => {
    const template = fileImportService.getProductImportTemplate();
    setCsvInput(template);
  };

  const handlePreviewImport = async () => {
    if (!csvInput.trim()) {
      showAlert('Lỗi', 'Vui lòng dán nội dung CSV hoặc dùng mẫu dữ liệu.');
      return;
    }
    setParsingCsv(true);
    try {
      const preview = await fileImportService.previewProductImport(csvInput);
      setImportPreview(preview);
    } catch (err: any) {
      showAlert('Lỗi định dạng file', err.message || 'Không thể đọc file CSV.');
    } finally {
      setParsingCsv(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importPreview || importPreview.validRows.length === 0) {
      showAlert('Lỗi', 'Không có dòng dữ liệu hợp lệ để nhập kho.');
      return;
    }
    setCommittingImport(true);
    try {
      const result = await fileImportService.commitProductImport(importPreview);
      showAlert('Nhập file thành công', result.message, async () => {
        setImportModalVisible(false);
        setImportPreview(null);
        setCsvInput('');
        await loadData();
      });
    } catch (err: any) {
      showAlert('Lỗi nhập dữ liệu', err.message || 'Không thể nhập sản phẩm từ file.');
    } finally {
      setCommittingImport(false);
    }
  };

  // --- EXPORT PRODUCTS & CATEGORIES HANDLERS ---
  const handleExportData = async (type: 'products' | 'categories') => {
    setExportingData(true);
    try {
      const dateTag = new Date().toISOString().slice(0, 10);
      let content = '';
      let filename = '';
      if (type === 'products') {
        content = await exportService.exportProductsCsv();
        filename = `Danh_sach_san_pham_${dateTag}.csv`;
      } else {
        content = await exportService.exportCategoriesCsv();
        filename = `Danh_muc_san_pham_${dateTag}.csv`;
      }

      await exportService.shareOrDownloadFile(filename, content);
      showAlert('Xuất file thành công! 📤', `Đã xuất dữ liệu ra file [${filename}].`);
    } catch (err: any) {
      showAlert('Lỗi xuất file', err?.message || 'Không thể xuất dữ liệu.');
    } finally {
      setExportingData(false);
    }
  };

  const openExportMenu = () => {
    if (Platform.OS === 'web') {
      const choice = window.confirm('Chọn định dạng xuất:\n- Bấm OK để xuất Danh sách Sản phẩm (CSV)\n- Bấm Cancel để xuất Danh mục Sản phẩm (CSV)');
      handleExportData(choice ? 'products' : 'categories');
    } else {
      Alert.alert(
        'Xuất dữ liệu ra file CSV',
        'Chọn tệp tin bạn muốn xuất ra máy:',
        [
          { text: 'Đóng', style: 'cancel' },
          { text: '🗂️ Xuất Danh mục', onPress: () => handleExportData('categories') },
          { text: '📦 Xuất Sản phẩm', onPress: () => handleExportData('products') },
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NetworkBanner />
      
      <View style={styles.container}>
        {/* Top Actions & Shortcuts */}
        <View style={styles.topToolbar}>
          {isAdmin ? (
            <>
              <TouchableOpacity 
                style={styles.toolBtn} 
                onPress={openCategoryManager}
                accessibilityLabel="Quản lý danh mục"
              >
                <Text style={styles.toolBtnText}>📁 Danh mục</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.toolBtn} 
                onPress={openImportModal}
                accessibilityLabel="Nhập sản phẩm từ file CSV"
              >
                <Text style={styles.toolBtnText}>📥 Nhập File</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.toolBtn} 
                onPress={openExportMenu}
                disabled={exportingData}
                accessibilityLabel="Xuất danh sách sản phẩm hoặc danh mục ra file CSV"
              >
                <Text style={styles.toolBtnText}>{exportingData ? '⏳...' : '📤 Xuất File'}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.toolBtn, styles.toolBtnPrimary]} 
                onPress={openCreateProduct}
                accessibilityLabel="Thêm sản phẩm mới"
              >
                <Text style={[styles.toolBtnText, styles.toolBtnPrimaryText]}>+ Thêm SP</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity 
                style={styles.toolBtn} 
                onPress={openExportMenu}
                disabled={exportingData}
                accessibilityLabel="Xuất danh sách sản phẩm hoặc danh mục ra file CSV"
              >
                <Text style={styles.toolBtnText}>{exportingData ? '⏳...' : '📤 Xuất File'}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
                <Badge label="👤 Vai trò: Nhân viên" variant="neutral" />
              </View>
            </>
          )}
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrapper}>
          <Input
            placeholder="Tìm theo SKU, barcode, tên sản phẩm..."
            value={search}
            onChangeText={(text) => {
              setSearch(text);
              if (selectedCategory) setSelectedCategory(null);
            }}
            containerStyle={{ marginBottom: 0 }}
          />
        </View>

        {/* Categories Horizontal Scroll */}
        <View style={styles.categoryScrollWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
            <TouchableOpacity
              style={[
                styles.categoryChip,
                selectedCategory === null && styles.categoryChipActive,
              ]}
              onPress={() => setSelectedCategory(null)}
            >
              <Text
                style={[
                  styles.categoryText,
                  selectedCategory === null && styles.categoryTextActive,
                ]}
              >
                Tất cả
              </Text>
            </TouchableOpacity>

            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  selectedCategory === cat.id && styles.categoryChipActive,
                ]}
                onPress={() => setSelectedCategory(cat.id)}
              >
                <Text
                  style={[
                    styles.categoryText,
                    selectedCategory === cat.id && styles.categoryTextActive,
                  ]}
                >
                  {cat.name} {cat.product_count !== undefined ? `(${cat.product_count})` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Product List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Đang đọc dữ liệu từ SQLite...</Text>
          </View>
        ) : (
          <ScrollView 
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <View style={styles.listHeaderRow}>
              <Text style={styles.listHeaderTitle}>
                Sản phẩm trong kho ({products.length})
              </Text>
              
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 8, padding: 2 }}>
                  <TouchableOpacity
                    style={[
                      { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
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
                      { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
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
            </View>

            {products.length === 0 ? (
              <EmptyState 
                title="Không tìm thấy sản phẩm"
                description={search ? `Không có sản phẩm nào khớp với "${search}"` : 'Kho chưa có sản phẩm nào.'}
              />
            ) : (
              products.map((item) => (
                <TouchableOpacity 
                  key={item.id} 
                  activeOpacity={0.7}
                  onPress={() => openProductDetail(item)}
                >
                  {viewMode === 'detail' ? (
                    <Card style={styles.productCard}>
                      <View style={styles.cardHeaderRow}>
                        <View style={styles.skuWrapper}>
                          <Text style={styles.skuText}>🏷️ {item.sku}</Text>
                        </View>
                        <Badge 
                          variant={item.status === 'ACTIVE' ? 'success' : 'neutral'}
                          label={item.status === 'ACTIVE' ? 'Đang bán' : 'Tạm dừng'}
                        />
                      </View>

                      <Text style={styles.productName}>{item.name}</Text>
                      
                      <View style={styles.categoryRow}>
                        <Text style={styles.categoryLabel}>
                          📁 {item.category_name || 'Đồ chơi'} {item.product_type_name ? `› ${item.product_type_name}` : ''}
                        </Text>
                      </View>

                      <View style={styles.footerRow}>
                        <View>
                          <Text style={styles.priceLabel}>Giá bán:</Text>
                          <Text style={styles.priceValue}>{formatCurrency(item.current_selling_price)}</Text>
                        </View>

                        <View style={styles.stockWrapper}>
                          <Text style={styles.stockLabel}>Tồn kho:</Text>
                          <Text 
                            style={[
                              styles.stockValue,
                              item.current_stock <= item.min_stock_alert && styles.stockAlert
                            ]}
                          >
                            {item.current_stock} cái
                          </Text>
                        </View>
                      </View>
                    </Card>
                  ) : (
                    <View
                      style={{
                        backgroundColor: '#FFFFFF',
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        marginBottom: 6,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: '#E2E8F0',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: '700', color: Colors.primary }}>
                            {item.sku}
                          </Text>
                          <Badge 
                            variant={item.status === 'ACTIVE' ? 'success' : 'neutral'}
                            label={item.status === 'ACTIVE' ? 'Bán' : 'Dừng'}
                          />
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.textPrimary }} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={{ fontSize: 11, color: Colors.textMuted }}>
                          {item.category_name || 'Đồ chơi'} {item.product_type_name ? `› ${item.product_type_name}` : ''}
                        </Text>
                      </View>

                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary }}>
                          {formatCurrency(item.current_selling_price)}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <Text style={{ fontSize: 11, color: Colors.textMuted }}>Tồn:</Text>
                          <Text 
                            style={[
                              { fontSize: 13, fontWeight: '700', color: '#16A34A' },
                              item.current_stock <= item.min_stock_alert && { color: Colors.danger }
                            ]}
                          >
                            {item.current_stock}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        )}
      </View>

      {/* ========================================================= */}
      {/* 1. PRODUCT DETAIL MODAL                                   */}
      {/* ========================================================= */}
      <Modal
        visible={detailModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          {selectedProduct && (
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle} numberOfLines={1}>
                    {selectedProduct.name}
                  </Text>
                  <Text style={styles.modalSubtitle}>Mã SKU: {selectedProduct.sku}</Text>
                </View>
                <TouchableOpacity 
                  style={styles.closeBtn} 
                  onPress={() => setDetailModalVisible(false)}
                >
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Detail Tabs */}
              <View style={styles.tabHeaderRow}>
                <TouchableOpacity 
                  style={[styles.modalTabBtn, detailTab === 'info' && styles.modalTabBtnActive]}
                  onPress={() => setDetailTab('info')}
                >
                  <Text style={[styles.modalTabText, detailTab === 'info' && styles.modalTabTextActive]}>Thông tin</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalTabBtn, detailTab === 'priceHistory' && styles.modalTabBtnActive]}
                  onPress={() => setDetailTab('priceHistory')}
                >
                  <Text style={[styles.modalTabText, detailTab === 'priceHistory' && styles.modalTabTextActive]}>Giá bán</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalTabBtn, detailTab === 'costHistory' && styles.modalTabBtnActive]}
                  onPress={() => setDetailTab('costHistory')}
                >
                  <Text style={[styles.modalTabText, detailTab === 'costHistory' && styles.modalTabTextActive]}>Giá vốn</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalTabBtn, detailTab === 'movements' && styles.modalTabBtnActive]}
                  onPress={() => setDetailTab('movements')}
                >
                  <Text style={[styles.modalTabText, detailTab === 'movements' && styles.modalTabTextActive]}>Biến động</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBody}>
                {detailTab === 'info' && (
                  <View style={styles.infoTabContainer}>
                    <Card style={styles.infoCard}>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Mã Barcode / Mã vạch:</Text>
                        <Text style={styles.infoValue}>{selectedProduct.barcode || selectedProduct.sku}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Danh mục:</Text>
                        <Text style={styles.infoValue}>{selectedProduct.category_name || 'Đồ chơi'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Loại sản phẩm:</Text>
                        <Text style={styles.infoValue}>{selectedProduct.product_type_name || 'Mặc định'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Giá bán hiện tại:</Text>
                        <Text style={[styles.infoValue, { color: Colors.primary, fontWeight: '700' }]}>
                          {formatCurrency(selectedProduct.current_selling_price)}
                        </Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Giá vốn trung bình (WAC):</Text>
                        <Text style={styles.infoValue}>{formatCurrency(selectedProduct.current_cost_price)}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Tồn kho khả dụng:</Text>
                        <Text style={[styles.infoValue, { fontWeight: '700' }]}>
                          {selectedProduct.current_stock} cái
                        </Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Cảnh báo hết hàng khi dưới:</Text>
                        <Text style={styles.infoValue}>{selectedProduct.min_stock_alert} cái</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Trạng thái kinh doanh:</Text>
                        <Badge 
                          variant={selectedProduct.status === 'ACTIVE' ? 'success' : 'neutral'}
                          label={selectedProduct.status === 'ACTIVE' ? 'Đang bán' : 'Ngừng bán'}
                        />
                      </View>
                      {selectedProduct.description ? (
                        <View style={{ marginTop: 8 }}>
                          <Text style={styles.infoLabel}>Mô tả sản phẩm:</Text>
                          <Text style={styles.descValue}>{selectedProduct.description}</Text>
                        </View>
                      ) : null}
                    </Card>

                    {isAdmin ? (
                      <View style={styles.actionRow}>
                        <Button
                          title="✏️ Chỉnh sửa thông tin"
                          onPress={() => openEditProduct(selectedProduct)}
                          variant="primary"
                        />
                      </View>
                    ) : (
                      <View style={{ padding: 12, backgroundColor: '#F8FAFC', borderRadius: 8, alignItems: 'center', marginTop: 12 }}>
                        <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>🔒 Chức năng chỉnh sửa thông tin dành cho Quản trị viên (Admin)</Text>
                      </View>
                    )}
                  </View>
                )}

                {detailTab === 'priceHistory' && (
                  <View>
                    <Text style={styles.subHeading}>Lịch sử điều chỉnh giá bán niêm yết</Text>
                    {loadingHistory ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : priceHistory.length === 0 ? (
                      <EmptyState title="Chưa có lịch sử giá" description="Sản phẩm chưa có lần cập nhật giá bán nào." />
                    ) : (
                      priceHistory.map((h, i) => (
                        <Card key={i} style={styles.historyCard}>
                          <View style={styles.historyCardHeader}>
                            <Text style={styles.historyPrice}>{formatCurrency(h.price)}</Text>
                            <Text style={styles.historyDate}>{formatDateTime(h.effective_from || h.created_at)}</Text>
                          </View>
                          <Text style={styles.historyNote}>{h.note || 'Điều chỉnh giá bán'}</Text>
                          {h.creator_name ? <Text style={styles.historyCreator}>Bởi: {h.creator_name}</Text> : null}
                        </Card>
                      ))
                    )}
                  </View>
                )}

                {detailTab === 'costHistory' && (
                  <View>
                    <Text style={styles.subHeading}>Lịch sử giá vốn từ các đợt nhập kho</Text>
                    {loadingHistory ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : costHistory.length === 0 ? (
                      <EmptyState title="Chưa có giá vốn" description="Chưa ghi nhận biến động giá vốn." />
                    ) : (
                      costHistory.map((c, i) => (
                        <Card key={i} style={styles.historyCard}>
                          <View style={styles.historyCardHeader}>
                            <Text style={[styles.historyPrice, { color: '#0F172A' }]}>{formatCurrency(c.cost_price)}</Text>
                            <Text style={styles.historyDate}>{formatDateTime(c.effective_from || c.created_at)}</Text>
                          </View>
                          <Text style={styles.historyNote}>{c.note || 'Cập nhật giá vốn nhập kho'}</Text>
                        </Card>
                      ))
                    )}
                  </View>
                )}

                {detailTab === 'movements' && (
                  <View>
                    <Text style={styles.subHeading}>Biến động kho hàng (Ledger)</Text>
                    {loadingHistory ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : stockMovements.length === 0 ? (
                      <EmptyState title="Chưa có biến động" description="Sản phẩm chưa phát sinh giao dịch xuất/nhập kho." />
                    ) : (
                      stockMovements.map((m, i) => (
                        <Card key={i} style={styles.movementCard}>
                          <View style={styles.historyCardHeader}>
                            <Badge 
                              variant={m.quantity_change > 0 ? 'success' : 'danger'}
                              label={`${m.movement_type}: ${m.quantity_change > 0 ? '+' : ''}${m.quantity_change}`}
                            />
                            <Text style={styles.historyDate}>{m.movement_date}</Text>
                          </View>
                          <Text style={styles.balanceText}>Tồn sau biến động: {m.balance_after} cái</Text>
                          {m.note ? <Text style={styles.historyNote}>{m.note}</Text> : null}
                        </Card>
                      ))
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* ========================================================= */}
      {/* 2. PRODUCT EDIT / CREATE MODAL                           */}
      {/* ========================================================= */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={handleCloseEdit}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isCreatingProduct ? 'Thêm sản phẩm mới' : 'Chỉnh sửa sản phẩm'}
              </Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleCloseEdit}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Input
                label="Tên sản phẩm (*)"
                value={editName}
                onChangeText={(t) => { setEditName(t); setIsFormDirty(true); }}
                placeholder="VD: Gấu Bông Capybara 40cm"
              />

              <Input
                label="Mã SKU (*)"
                value={editSku}
                onChangeText={(t) => { setEditSku(t); setIsFormDirty(true); }}
                placeholder="VD: GB-CAPY-01"
              />

              <Input
                label="Mã Barcode / Mã vạch"
                value={editBarcode}
                onChangeText={(t) => { setEditBarcode(t); setIsFormDirty(true); }}
                placeholder="Mã vạch quét nhanh tại POS"
              />

              {/* Category Picker */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Danh mục sản phẩm (*)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
                  {categories.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[
                        styles.catSelectChip,
                        editCategoryId === c.id && styles.catSelectChipActive
                      ]}
                      onPress={() => { setEditCategoryId(c.id); setIsFormDirty(true); }}
                    >
                      <Text style={[styles.catSelectText, editCategoryId === c.id && styles.catSelectTextActive]}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <Input
                label="Giá bán niêm yết (VND) (*)"
                value={editSellingPrice}
                onChangeText={(t) => { setEditSellingPrice(formatCurrencyInput(t)); setIsFormDirty(true); }}
                keyboardType="numeric"
                placeholder="VD: 150,000"
              />

              <Input
                label="Mức tồn kho cảnh báo tối thiểu"
                value={editMinStock}
                onChangeText={(t) => { setEditMinStock(t); setIsFormDirty(true); }}
                keyboardType="numeric"
                placeholder="VD: 5"
              />

              {/* Stock Protection Notice */}
              <View style={styles.stockProtectionBox}>
                <Text style={styles.stockProtectionTitle}>🔒 Bảo vệ số lượng tồn kho</Text>
                <Text style={styles.stockProtectionDesc}>
                  Tồn kho hiện tại:{' '}
                  <Text style={{ fontWeight: '700' }}>
                    {isCreatingProduct ? 0 : selectedProduct?.current_stock || 0} cái
                  </Text>
                  . Theo chuẩn kế toán bán lẻ, không được sửa trực tiếp tồn kho tại màn hình này. Mọi thay đổi tồn kho phải thông qua Nhập kho hoặc Kiểm kê kho.
                </Text>
              </View>

              {/* Status Switcher */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Trạng thái kinh doanh</Text>
                <View style={styles.statusRow}>
                  <TouchableOpacity
                    style={[styles.statusBtn, editStatus === 'ACTIVE' && styles.statusBtnActive]}
                    onPress={() => { setEditStatus('ACTIVE'); setIsFormDirty(true); }}
                  >
                    <Text style={[styles.statusBtnText, editStatus === 'ACTIVE' && styles.statusBtnTextActive]}>
                      ✓ Đang kinh doanh
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.statusBtn, editStatus === 'INACTIVE' && styles.statusBtnInactive]}
                    onPress={() => { setEditStatus('INACTIVE'); setIsFormDirty(true); }}
                  >
                    <Text style={[styles.statusBtnText, editStatus === 'INACTIVE' && styles.statusBtnTextActive]}>
                      ✕ Tạm ngừng bán
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Input
                label="Mô tả sản phẩm"
                value={editDescription}
                onChangeText={(t) => { setEditDescription(t); setIsFormDirty(true); }}
                placeholder="Chất liệu, kích thước, xuất xứ..."
                multiline
                numberOfLines={3}
              />

              <View style={{ marginTop: Spacing.lg, marginBottom: Spacing.xl }}>
                <Button
                  title={savingProduct ? 'Đang lưu...' : 'Lưu sản phẩm'}
                  onPress={handleSaveProduct}
                  disabled={savingProduct}
                  variant="primary"
                  size="lg"
                />
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ========================================================= */}
      {/* 3. CATEGORY MANAGEMENT MODAL                              */}
      {/* ========================================================= */}
      <Modal
        visible={categoryModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Quản lý Danh mục</Text>
                <Text style={styles.modalSubtitle}>Đồng bộ tức thì với POS & SQLite</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setCategoryModalVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.sm }}>
              <Input
                placeholder="Tìm danh mục (có dấu hoặc không dấu)..."
                value={categorySearch}
                onChangeText={handleSearchCategories}
              />

              <Button
                title={showAddCategory ? (editingCategory ? 'Đóng khung sửa danh mục' : 'Đóng khung thêm danh mục') : '+ Thêm danh mục mới'}
                onPress={() => {
                  if (showAddCategory) {
                    cancelCategoryForm();
                  } else {
                    setEditingCategory(null);
                    setNewCatName('');
                    setNewCatCode('');
                    setNewCatDesc('');
                    setShowAddCategory(true);
                  }
                }}
                variant="outline"
                size="sm"
                style={{ marginBottom: Spacing.sm }}
              />

              {showAddCategory && (
                <Card style={styles.addCategoryCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={styles.subHeading}>
                      {editingCategory ? `Sửa danh mục: ${editingCategory.name}` : 'Thêm danh mục sản phẩm'}
                    </Text>
                    {editingCategory && (
                      <TouchableOpacity onPress={cancelCategoryForm}>
                        <Text style={{ fontSize: 12, color: Colors.textMuted }}>✕ Hủy sửa</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Input
                    label="Tên danh mục (*)"
                    value={newCatName}
                    onChangeText={setNewCatName}
                    placeholder="VD: Đồ chơi lắp ráp"
                  />
                  <Input
                    label="Mã định danh"
                    value={newCatCode}
                    onChangeText={setNewCatCode}
                    placeholder="VD: LAP_RAP"
                  />
                  <Input
                    label="Mô tả"
                    value={newCatDesc}
                    onChangeText={setNewCatDesc}
                    placeholder="Ghi chú chi tiết danh mục..."
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        title={savingCategory ? 'Đang lưu...' : (editingCategory ? 'Lưu thay đổi' : 'Tạo danh mục')}
                        onPress={handleSaveCategory}
                        disabled={savingCategory}
                        variant="primary"
                      />
                    </View>
                    {editingCategory && (
                      <Button
                        title="Hủy"
                        onPress={cancelCategoryForm}
                        variant="outline"
                      />
                    )}
                  </View>
                </Card>
              )}
            </View>

            <ScrollView style={styles.modalBody}>
              {categoryList.map((cat) => (
                <Card key={cat.id} style={styles.catCard}>
                  {deletingCategory?.id === cat.id ? (
                    <View>
                      <Text style={[styles.catName, { marginBottom: 6 }]}>🗑️ Xóa danh mục?</Text>
                      <Text style={{ fontSize: 13, color: Colors.textSecondary, marginBottom: 10 }}>
                        {(cat.product_count || 0) > 0
                          ? `Danh mục "${cat.name}" đang có ${cat.product_count} sản phẩm. Sản phẩm sẽ không bị xóa. Xác nhận xóa danh mục?`
                          : `Xóa vĩnh viễn danh mục "${cat.name}"? Thao tác không thể hoàn tác.`
                        }
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          style={[styles.catDeleteBtn, { flex: 1, justifyContent: 'center', opacity: isDeletingCategory ? 0.6 : 1 }]}
                          onPress={confirmDeleteCategory}
                          disabled={isDeletingCategory}
                        >
                          <Text style={styles.catDeleteBtnText}>{isDeletingCategory ? 'Đang xóa...' : '✓ Xác nhận xóa'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.catEditBtn, { flex: 1, justifyContent: 'center' }]}
                          onPress={() => setDeletingCategory(null)}
                          disabled={isDeletingCategory}
                        >
                          <Text style={styles.catEditBtnText}>✕ Hủy</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.catCardHeader}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.catName}>{cat.name}</Text>
                          <Text style={styles.catCode}>Mã: {cat.code}</Text>
                        </View>
                        <View style={styles.catActions}>
                          <TouchableOpacity
                            style={styles.catEditBtn}
                            onPress={() => startEditCategory(cat)}
                          >
                            <Text style={styles.catEditBtnText}>✏️ Sửa</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.catDeleteBtn}
                            onPress={() => handleDeleteCategory(cat)}
                          >
                            <Text style={styles.catDeleteBtnText}>🗑️ Xóa</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {cat.description ? <Text style={styles.catDesc}>{cat.description}</Text> : null}
                      <View style={styles.catFooter}>
                        <Text style={styles.catCount}>📦 {cat.product_count || 0} sản phẩm</Text>
                      </View>
                    </>
                  )}
                </Card>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ========================================================= */}
      {/* 4. PRODUCT FILE IMPORT MODAL                              */}
      {/* ========================================================= */}
      <Modal
        visible={importModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setImportModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Nhập sản phẩm từ File CSV/Excel</Text>
                <Text style={styles.modalSubtitle}>Xác thực định dạng & không trùng lặp</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setImportModalVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.importGuidanceBox}>
                <Text style={styles.guidanceTitle}>📋 Hướng dẫn nhập file</Text>
                <Text style={styles.guidanceText}>
                  Cột dữ liệu yêu cầu: Mã SKU, Tên sản phẩm, Giá bán, Giá vốn, Danh mục.{'\n'}
                  Hệ thống tự động phát hiện lỗi dòng, mã trùng và xác thực trước khi ghi vào SQLite.
                </Text>
                <Button
                  title="📄 Tải mẫu dữ liệu demo"
                  onPress={loadSampleProductCsv}
                  variant="outline"
                  size="sm"
                  style={{ marginTop: 8 }}
                />
              </View>

              <Text style={styles.inputLabel}>Nội dung file CSV / Bảng tính:</Text>
              <TextInput
                style={styles.csvTextInput}
                multiline
                numberOfLines={8}
                value={csvInput}
                onChangeText={setCsvInput}
                placeholder="Dán nội dung file CSV vào đây..."
              />

              <Button
                title={parsingCsv ? 'Đang kiểm tra...' : '🔍 Xem trước & Kiểm tra dữ liệu'}
                onPress={handlePreviewImport}
                disabled={parsingCsv || !csvInput.trim()}
                variant="secondary"
                style={{ marginVertical: Spacing.md }}
              />

              {importPreview && (
                <View style={styles.previewContainer}>
                  <Text style={styles.subHeading}>Kết quả kiểm tra dữ liệu:</Text>
                  <View style={styles.previewStatsRow}>
                    <View style={[styles.statBox, { backgroundColor: '#DCFCE7' }]}>
                      <Text style={[styles.statNum, { color: '#166534' }]}>{importPreview.validRows.length}</Text>
                      <Text style={styles.statLabel}>Hợp lệ</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: '#FEE2E2' }]}>
                      <Text style={[styles.statNum, { color: '#991B1B' }]}>{importPreview.errorRows.length}</Text>
                      <Text style={styles.statLabel}>Lỗi dòng</Text>
                    </View>
                  </View>

                  {importPreview.errorRows.length > 0 && (
                    <View style={styles.errorRowsBox}>
                      <Text style={styles.errorBoxTitle}>⚠️ Chi tiết các dòng lỗi cần sửa:</Text>
                      {importPreview.errorRows.map((err, i) => (
                        <Text key={i} style={styles.errorRowText}>
                          • Dòng {err.rowNumber}: {err.reason} ({err.raw})
                        </Text>
                      ))}
                    </View>
                  )}

                  <View style={{ marginTop: Spacing.md }}>
                    <Text style={styles.inputLabel}>Xem trước các sản phẩm sẽ được nhập:</Text>
                    {importPreview.validRows.slice(0, 5).map((row, idx) => (
                      <Card key={idx} style={{ padding: 10, marginVertical: 4 }}>
                        <Text style={{ fontWeight: '700' }}>{row.name}</Text>
                        <Text style={{ fontSize: 12, color: Colors.textMuted }}>
                          SKU: {row.sku} | Giá bán: {formatCurrency(row.current_selling_price)}
                        </Text>
                      </Card>
                    ))}
                    {importPreview.validRows.length > 5 && (
                      <Text style={{ fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: 4 }}>
                        ... và {importPreview.validRows.length - 5} sản phẩm khác
                      </Text>
                    )}
                  </View>

                  <Button
                    title={committingImport ? 'Đang nhập dữ liệu...' : `✓ Xác nhận nhập ${importPreview.validRows.length} sản phẩm`}
                    onPress={handleCommitImport}
                    disabled={committingImport || importPreview.validRows.length === 0}
                    variant="primary"
                    size="lg"
                    style={{ marginTop: Spacing.lg, marginBottom: Spacing.xl }}
                  />
                </View>
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
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
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  toolBtn: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  toolBtnText: {
    ...Typography.bodySmall,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  toolBtnPrimaryText: {
    color: '#FFFFFF',
  },
  searchWrapper: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  categoryScrollWrapper: {
    paddingVertical: Spacing.xs,
  },
  categoryScroll: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.xs,
  },
  categoryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryText: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  categoryTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
  },
  listContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  listHeaderTitle: {
    ...Typography.titleSmall,
    color: Colors.textPrimary,
  },
  offlineBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  productCard: {
    padding: Spacing.md,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  skuWrapper: {
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  skuText: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    fontWeight: '500',
  },
  productName: {
    ...Typography.bodyLarge,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  categoryRow: {
    marginBottom: Spacing.sm,
  },
  categoryLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  priceLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  priceValue: {
    ...Typography.titleMedium,
    color: Colors.primary,
    fontWeight: '700',
  },
  stockWrapper: {
    alignItems: 'flex-end',
  },
  stockLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  stockValue: {
    ...Typography.bodyLarge,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  stockAlert: {
    color: Colors.danger,
  },
  // Modal Styles
  modalSafeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: Colors.background,
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontWeight: 'bold',
  },
  tabHeaderRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  modalTabBtnActive: {
    borderBottomColor: Colors.primary,
  },
  modalTabText: {
    fontSize: 14,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  modalTabTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  modalBody: {
    flex: 1,
    padding: Spacing.md,
  },
  infoTabContainer: {
    gap: Spacing.md,
  },
  infoCard: {
    padding: Spacing.md,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  infoLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  descValue: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 20,
    marginTop: 4,
  },
  actionRow: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
  },
  subHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  historyCard: {
    padding: Spacing.md,
    marginBottom: Spacing.xs,
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  historyDate: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  historyNote: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  historyCreator: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  movementCard: {
    padding: Spacing.md,
    marginBottom: Spacing.xs,
  },
  balanceText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 4,
  },
  formGroup: {
    marginBottom: Spacing.md,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  catSelectChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    marginRight: 6,
  },
  catSelectChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  catSelectText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  catSelectTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  stockProtectionBox: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  stockProtectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 4,
  },
  stockProtectionDesc: {
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.card,
  },
  statusBtnActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  statusBtnInactive: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  statusBtnText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  statusBtnTextActive: {
    color: '#166534',
    fontWeight: '700',
  },
  addCategoryCard: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  catCard: {
    padding: Spacing.md,
    marginBottom: Spacing.xs,
  },
  catCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  catName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  catCode: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  catDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  catFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 6,
  },
  catCount: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  catActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  catEditBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  catEditBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1D4ED8',
  },
  catDeleteBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#FEF2F2',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  catDeleteBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  importGuidanceBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  guidanceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  guidanceText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  csvTextInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 12,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
  },
  previewContainer: {
    backgroundColor: '#FFFFFF',
    padding: Spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing.sm,
  },
  previewStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 8,
  },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  errorRowsBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
  },
  errorBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 4,
  },
  errorRowText: {
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 18,
  },
});

export default ProductsScreen;
