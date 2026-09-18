'use client';

import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  Edit, 
  History, 
  Tag, 
  Layers, 
  X, 
  Download,
  Upload,
  AlertCircle,
  FileSpreadsheet,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { getClientCached, setClientCached } from '@/lib/client-cache';
import { formatCurrency } from '@/lib/formatters';

export default function ProductsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'types'>('products');

  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Data states with Instant Cache
  const [products, setProducts] = useState<any[]>(() => getClientCached('products:list:initial') || []);
  const [categories, setCategories] = useState<any[]>(() => getClientCached('categories') || []);
  const [productTypes, setProductTypes] = useState<any[]>(() => getClientCached('product_types:all') || []);
  const [loading, setLoading] = useState(() => !getClientCached('products:list:initial'));

  // Modals state
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);

  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<any | null>(null);

  // Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  // Detail Modal
  const [detailProduct, setDetailProduct] = useState<any | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'price' | 'lots' | 'sales' | 'stock'>('info');
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [lotsHistory, setLotsHistory] = useState<any[]>([]);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [stockHistory, setStockHistory] = useState<any[]>([]);

  // Add new price state inside detail modal
  const [newPrice, setNewPrice] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [priceNote, setPriceNote] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = async () => {
    let prodUrl = `/api/products?limit=100`;
    if (searchQuery) prodUrl += `&q=${encodeURIComponent(searchQuery)}`;
    if (selectedCategory) prodUrl += `&categoryId=${selectedCategory}`;
    if (selectedType) prodUrl += `&productTypeId=${selectedType}`;
    if (statusFilter) prodUrl += `&status=${statusFilter}`;

    const cacheKey = `products:${prodUrl}`;
    const cached = getClientCached(cacheKey);
    if (cached) {
      setProducts(cached);
    } else {
      setLoading(true);
    }

    try {
      const [catRes, typeRes, prodRes] = await Promise.allSettled([
        fetch('/api/categories').then((r) => r.json()),
        fetch('/api/product-types').then((r) => r.json()),
        fetch(prodUrl).then((r) => r.json()),
      ]);

      if (catRes.status === 'fulfilled' && catRes.value.success) {
        setCategories(catRes.value.data);
        setClientCached('categories', catRes.value.data);
      }
      if (typeRes.status === 'fulfilled' && typeRes.value.success) {
        setProductTypes(typeRes.value.data);
        setClientCached('product_types:all', typeRes.value.data);
      }
      if (prodRes.status === 'fulfilled' && prodRes.value.success) {
        setProducts(prodRes.value.data);
        setClientCached(cacheKey, prodRes.value.data);
        if (!searchQuery && !selectedCategory && !selectedType && !statusFilter) {
          setClientCached('products:list:initial', prodRes.value.data);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchQuery, selectedCategory, selectedType, statusFilter]);

  // Load product sub-history when detailProduct or detailTab changes
  useEffect(() => {
    if (!detailProduct) return;

    if (detailTab === 'price') {
      fetch(`/api/products/${detailProduct.id}/price-history`)
        .then((r) => r.json())
        .then((j) => { if (j.success) setPriceHistory(j.data); });
    } else if (detailTab === 'lots') {
      fetch(`/api/products/${detailProduct.id}/lots`)
        .then((r) => r.json())
        .then((j) => { if (j.success) setLotsHistory(j.data || []); });
    } else if (detailTab === 'sales') {
      fetch(`/api/products/${detailProduct.id}/sales-history`)
        .then((r) => r.json())
        .then((j) => { if (j.success) setSalesHistory(j.data); });
    } else if (detailTab === 'stock') {
      fetch(`/api/products/${detailProduct.id}/stock-history`)
        .then((r) => r.json())
        .then((j) => { if (j.success) setStockHistory(j.data); });
    }
  }, [detailProduct, detailTab]);

  // Handle Add New Price
  const handleAddNewPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailProduct || !newPrice) return;

    try {
      const res = await fetch(`/api/products/${detailProduct.id}/price-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: parseFloat(newPrice),
          effective_from: effectiveDate,
          note: priceNote,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setPriceHistory(json.data);
        setNewPrice('');
        setPriceNote('');
        setFeedback({ type: 'success', message: 'Đã thêm mức giá bán mới thành công!' });
        loadData();
      } else {
        setFeedback({ type: 'error', message: json.error?.message || 'Lỗi thêm giá mới.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    }
  };

  // Toggle status
  const handleToggleStatus = async (product: any) => {
    const nextStatus = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (json.success) {
        loadData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownloadTemplate = () => {
    window.open('/api/excel/templates/products', '_blank');
  };

  const handlePreviewExcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;

    setPreviewing(true);
    setPreviewData(null);

    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('entityType', 'products');

    try {
      const res = await fetch('/api/excel/preview', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.success) {
        setPreviewData(json.data);
      } else {
        setFeedback({ type: 'error', message: json.error?.message || 'Lỗi đọc file Excel.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommitExcel = async () => {
    if (!previewData || committing) return;
    setCommitting(true);

    try {
      const res = await fetch('/api/excel/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: previewData.fileName,
          entityType: 'products',
          creates: previewData.creates,
          updates: previewData.updates,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setFeedback({ type: 'success', message: json.message || 'Import sản phẩm thành công!' });
        setShowImportModal(false);
        setPreviewData(null);
        setImportFile(null);
        loadData();
      } else {
        setFeedback({ type: 'error', message: json.error?.message || 'Lỗi import sản phẩm.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setCommitting(false);
    }
  };

  const formatVND = (v: number) => formatCurrency(v);

  return (
    <div style={{ width: '100%' }}>
      {/* 1. Header & Navigation Tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 16,
      }}>
        {/* Scrollable Tabs */}
        <div className="tabs-scroll-container" style={{ backgroundColor: '#f1f5f9', padding: 4, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('products')}
            className={`btn btn-sm ${activeTab === 'products' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', minHeight: 34 }}
          >
            <Package size={14} />
            <span>Sản phẩm ({products.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`btn btn-sm ${activeTab === 'categories' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', minHeight: 34 }}
          >
            <Tag size={14} />
            <span>Danh mục ({categories.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('types')}
            className={`btn btn-sm ${activeTab === 'types' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', minHeight: 34 }}
          >
            <Layers size={14} />
            <span>Loại SP ({productTypes.length})</span>
          </button>
        </div>

        {/* Action Buttons */}
        {user?.role === 'ADMIN' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {activeTab === 'products' && (
              <>
                <button
                  onClick={handleDownloadTemplate}
                  className="btn btn-secondary btn-sm"
                  title="Tải file mẫu Excel"
                >
                  <Download size={14} color="#059669" />
                  <span>Xuất mẫu</span>
                </button>

                <button
                  onClick={() => { setImportFile(null); setPreviewData(null); setShowImportModal(true); }}
                  className="btn btn-secondary btn-sm"
                  title="Import file Excel"
                >
                  <Upload size={14} color="#2563eb" />
                  <span>Import</span>
                </button>

                <button
                  onClick={() => { setEditingProduct(null); setShowProductModal(true); }}
                  className="btn btn-primary btn-sm"
                >
                  <Plus size={14} />
                  <span>Thêm SP</span>
                </button>
              </>
            )}
            {activeTab === 'categories' && (
              <button
                onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }}
                className="btn btn-primary btn-sm"
              >
                <Plus size={14} />
                <span>Thêm danh mục</span>
              </button>
            )}
            {activeTab === 'types' && (
              <button
                onClick={() => { setEditingType(null); setShowTypeModal(true); }}
                className="btn btn-primary btn-sm"
              >
                <Plus size={14} />
                <span>Thêm loại SP</span>
              </button>
            )}
          </div>
        )}
      </div>

      {feedback && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          backgroundColor: feedback.type === 'success' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          borderRadius: 6,
          color: feedback.type === 'success' ? '#15803d' : '#dc2626',
          marginBottom: 14,
          fontSize: 13,
        }}>
          <AlertCircle size={16} />
          <span>{feedback.message}</span>
        </div>
      )}

      {/* 2. TAB: PRODUCTS */}
      {activeTab === 'products' && (
        <div className="card">
          <div className="card-header" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 8,
            padding: '10px 14px',
          }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: 28, height: 34, fontSize: 12.5 }}
                placeholder="Tìm theo tên, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 8, top: 10 }} />
            </div>

            <select
              className="form-select"
              style={{ height: 34, padding: '2px 8px', fontSize: 12.5 }}
              value={selectedCategory}
              onChange={(e) => { setSelectedCategory(e.target.value); setSelectedType(''); }}
            >
              <option value="">-- Tất cả danh mục --</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              className="form-select"
              style={{ height: 34, padding: '2px 8px', fontSize: 12.5 }}
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value="">-- Tất cả loại SP --</option>
              {productTypes
                .filter((pt) => !selectedCategory || String(pt.category_id) === String(selectedCategory))
                .map((pt) => (
                  <option key={pt.id} value={pt.id}>{pt.name}</option>
                ))}
            </select>

            <select
              className="form-select"
              style={{ height: 34, padding: '2px 8px', fontSize: 12.5 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">-- Trạng thái --</option>
              <option value="ACTIVE">Đang bán</option>
              <option value="INACTIVE">Ngừng bán</option>
            </select>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Mã SKU</th>
                  <th>Tên sản phẩm</th>
                  <th>Danh mục / Loại</th>
                  <th className="text-right">Giá nhập</th>
                  <th className="text-right">Giá bán</th>
                  <th className="text-right">Tồn kho</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center" style={{ width: 130 }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                      Đang tải danh sách sản phẩm...
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                      Không tìm thấy sản phẩm nào.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace', color: '#1e293b' }}>
                        {p.sku}
                      </td>
                      <td>
                        <span 
                          onClick={() => { setDetailProduct(p); setDetailTab('info'); }}
                          style={{ fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}
                        >
                          {p.name}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        <div>{p.category_name}</div>
                        <div style={{ color: '#64748b' }}>{p.product_type_name}</div>
                      </td>
                      <td className="text-right" style={{ color: '#64748b' }}>
                        {formatVND(p.current_cost_price)}
                      </td>
                      <td className="text-right" style={{ fontWeight: 600 }}>
                        {formatVND(p.current_selling_price)}
                      </td>
                      <td className="text-right">
                        <span style={{
                          fontWeight: 700,
                          color: p.current_stock <= p.min_stock_alert ? '#dc2626' : '#059669',
                        }}>
                          {p.current_stock}
                        </span>
                      </td>
                      <td className="text-center">
                        <span className={`badge ${p.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}`}>
                          {p.status === 'ACTIVE' ? 'Đang bán' : 'Ngừng bán'}
                        </span>
                      </td>
                      <td className="text-center">
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button
                            onClick={() => { setDetailProduct(p); setDetailTab('price'); }}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 6px' }}
                            title="Xem lịch sử giá & thẻ kho"
                          >
                            <History size={13} />
                          </button>
                          {user?.role === 'ADMIN' && (
                            <>
                              <button
                                onClick={() => { setEditingProduct(p); setShowProductModal(true); }}
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '4px 6px' }}
                                title="Sửa thông tin"
                              >
                                <Edit size={13} />
                              </button>
                              <button
                                onClick={() => handleToggleStatus(p)}
                                className={`btn btn-sm ${p.status === 'ACTIVE' ? 'btn-secondary' : 'btn-success'}`}
                                style={{ padding: '4px 6px', fontSize: 11.5 }}
                                title={p.status === 'ACTIVE' ? 'Ngừng bán' : 'Kích hoạt lại'}
                              >
                                {p.status === 'ACTIVE' ? 'Dừng' : 'Bật'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. TAB: CATEGORIES */}
      {activeTab === 'categories' && (
        <div className="card">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Mã danh mục</th>
                  <th>Tên danh mục</th>
                  <th>Mô tả</th>
                  <th className="text-right">Số loại SP</th>
                  <th className="text-right">Số sản phẩm</th>
                  <th className="text-center">Trạng thái</th>
                  {user?.role === 'ADMIN' && <th className="text-center" style={{ width: 90 }}>Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{c.code}</td>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td style={{ color: '#64748b' }}>{c.description || '-'}</td>
                    <td className="text-right">{c.type_count || 0}</td>
                    <td className="text-right">{c.product_count || 0}</td>
                    <td className="text-center">
                      <span className="badge badge-success">{c.status}</span>
                    </td>
                    {user?.role === 'ADMIN' && (
                      <td className="text-center">
                        <button
                          onClick={() => { setEditingCategory(c); setShowCategoryModal(true); }}
                          className="btn btn-secondary btn-sm"
                        >
                          <Edit size={13} />
                          <span>Sửa</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. TAB: PRODUCT TYPES */}
      {activeTab === 'types' && (
        <div className="card">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Mã loại</th>
                  <th>Tên loại sản phẩm</th>
                  <th>Thuộc danh mục</th>
                  <th>Mô tả</th>
                  <th className="text-right">Số lượng SP</th>
                  <th className="text-center">Trạng thái</th>
                  {user?.role === 'ADMIN' && <th className="text-center" style={{ width: 90 }}>Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {productTypes.map((pt) => (
                  <tr key={pt.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{pt.code}</td>
                    <td style={{ fontWeight: 600 }}>{pt.name}</td>
                    <td>
                      <span className="badge badge-neutral">{pt.category_name}</span>
                    </td>
                    <td style={{ color: '#64748b' }}>{pt.description || '-'}</td>
                    <td className="text-right">{pt.product_count || 0}</td>
                    <td className="text-center">
                      <span className="badge badge-success">{pt.status}</span>
                    </td>
                    {user?.role === 'ADMIN' && (
                      <td className="text-center">
                        <button
                          onClick={() => { setEditingType(pt); setShowTypeModal(true); }}
                          className="btn btn-secondary btn-sm"
                        >
                          <Edit size={13} />
                          <span>Sửa</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. IMPORT EXCEL MODAL */}
      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="modal-content" style={{ maxWidth: 650 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileSpreadsheet size={18} color="#2563eb" />
                <h3 className="modal-title">Import sản phẩm từ Excel</h3>
              </div>
              <button onClick={() => setShowImportModal(false)} className="btn btn-secondary btn-sm"><X size={16} /></button>
            </div>

            <div className="modal-body">
              <form onSubmit={handlePreviewExcel} style={{ marginBottom: 16 }}>
                <label className="form-label">Chọn file Excel (.xlsx hoặc .xls):</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    className="form-input"
                    style={{ flex: 1, minWidth: 200 }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setImportFile(e.target.files[0]);
                        setPreviewData(null);
                      }
                    }}
                    required
                  />
                  <button type="submit" className="btn btn-primary" disabled={!importFile || previewing} style={{ height: 38 }}>
                    {previewing ? 'Đang đọc...' : 'Kiểm tra file'}
                  </button>
                </div>
              </form>

              {/* Preview Diff Box */}
              {previewData && (
                <div style={{ border: '1px solid var(--border-strong)', borderRadius: 6, padding: 12, backgroundColor: '#f8fafc' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
                    Kết quả kiểm tra file:
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 12 }}>
                    <div style={{ padding: 8, backgroundColor: '#f0fdf4', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#15803d' }}>Thêm mới</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{previewData.creates.length}</div>
                    </div>
                    <div style={{ padding: 8, backgroundColor: '#eff6ff', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#1e40af' }}>Cập nhật</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#2563eb' }}>{previewData.updates.length}</div>
                    </div>
                    <div style={{ padding: 8, backgroundColor: '#ffffff', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Không đổi</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#64748b' }}>{previewData.unchanged.length}</div>
                    </div>
                    <div style={{ padding: 8, backgroundColor: '#fef2f2', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#991b1b' }}>Lỗi</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#dc2626' }}>{previewData.errors.length}</div>
                    </div>
                  </div>

                  {previewData.errors.length > 0 && (
                    <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, maxHeight: 100, overflowY: 'auto' }}>
                      {previewData.errors.map((e: any, idx: number) => (
                        <div key={idx}>• Dòng {e.rowNumber}: {e.message}</div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCommitExcel}
                    className="btn btn-success"
                    style={{ width: '100%', minHeight: 42, fontSize: 14 }}
                    disabled={committing || (previewData.creates.length === 0 && previewData.updates.length === 0)}
                  >
                    {committing ? 'Đang lưu vào hệ thống...' : `Xác nhận Import (${previewData.creates.length + previewData.updates.length} SP)`}
                  </button>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowImportModal(false)} className="btn btn-secondary">Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* 6. PRODUCT DETAIL MODAL */}
      {detailProduct && (
        <div className="modal-backdrop" onClick={() => setDetailProduct(null)}>
          <div className="modal-content" style={{ maxWidth: 750 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
                <h3 className="modal-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {detailProduct.name}
                </h3>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  SKU: {detailProduct.sku} • {detailProduct.category_name} ({detailProduct.product_type_name})
                </div>
              </div>
              <button onClick={() => setDetailProduct(null)} className="btn btn-secondary btn-sm">
                <X size={16} />
              </button>
            </div>

            {/* Modal Sub-Tabs (Scrollable) */}
            <div className="tabs-scroll-container" style={{ borderBottom: '1px solid var(--border-subtle)', padding: '0 14px', backgroundColor: '#f8fafc' }}>
              {[
                { key: 'info', label: 'Thông tin chung' },
                { key: 'lots', label: 'Lô hàng (FIFO)' },
                { key: 'price', label: 'Lịch sử giá' },
                { key: 'sales', label: 'Lịch sử bán' },
                { key: 'stock', label: 'Lịch sử kho' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setDetailTab(tab.key as any)}
                  style={{
                    padding: '10px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    border: 'none',
                    borderBottom: detailTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
                    backgroundColor: 'transparent',
                    color: detailTab === tab.key ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="modal-body">
              {detailTab === 'info' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Mã SKU:</div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{detailProduct.sku}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Trạng thái:</div>
                    <div style={{ fontWeight: 600 }}>{detailProduct.status === 'ACTIVE' ? 'Đang bán' : 'Ngừng bán'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Giá vốn BQ:</div>
                    <div style={{ fontWeight: 600, color: '#64748b' }}>{formatVND(detailProduct.current_cost_price)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Giá bán:</div>
                    <div style={{ fontWeight: 700, color: '#1d4ed8', fontSize: 15 }}>{formatVND(detailProduct.current_selling_price)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Tồn hiện tại:</div>
                    <div style={{ fontWeight: 700, color: '#059669', fontSize: 15 }}>{detailProduct.current_stock} món</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Cảnh báo tồn ít:</div>
                    <div style={{ fontWeight: 600 }}>{detailProduct.min_stock_alert} món</div>
                  </div>
                </div>
              )}

              {detailTab === 'lots' && (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Mã Lô</th>
                        <th>Ngày nhập</th>
                        <th className="text-right">SL Nhập</th>
                        <th className="text-right">SL Còn lại</th>
                        <th className="text-right">Đơn giá nhập</th>
                        <th className="text-right">Giá trị còn lại</th>
                        <th className="text-center">Trạng thái</th>
                        <th>Nhà cung cấp</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotsHistory.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>
                            Chưa có dữ liệu lô hàng nhập.
                          </td>
                        </tr>
                      ) : (
                        lotsHistory.map((lot) => (
                          <tr key={lot.id}>
                            <td style={{ fontWeight: 600, fontFamily: 'monospace', color: '#1e3a8a' }}>{lot.lot_code}</td>
                            <td>{lot.purchase_date}</td>
                            <td className="text-right">{lot.quantity_received}</td>
                            <td className="text-right">
                              <span style={{ fontWeight: 700, color: lot.quantity_remaining > 0 ? '#15803d' : '#94a3b8' }}>
                                {lot.quantity_remaining}
                              </span>
                            </td>
                            <td className="text-right">{formatVND(lot.unit_cost)}</td>
                            <td className="text-right" style={{ fontWeight: 700, color: '#0e7490' }}>
                              {formatVND(lot.remaining_value)}
                            </td>
                            <td className="text-center">
                              <span className={`badge ${lot.status === 'AVAILABLE' ? 'badge-success' : 'badge-neutral'}`}>
                                {lot.status === 'AVAILABLE' ? 'Còn hàng' : 'Hết hàng'}
                              </span>
                            </td>
                            <td style={{ fontSize: 12 }}>{lot.supplier_name || '-'}</td>
                            <td style={{ fontSize: 12, color: '#64748b' }}>{lot.note || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {detailTab === 'price' && (
                <div>
                  {user?.role === 'ADMIN' && (
                    <form onSubmit={handleAddNewPrice} style={{
                      backgroundColor: '#eff6ff',
                      padding: 12,
                      borderRadius: 6,
                      border: '1px solid #bfdbfe',
                      marginBottom: 14,
                    }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e3a8a', marginBottom: 6 }}>
                        Thêm mức giá bán mới:
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                        <input
                          type="number"
                          className="form-input"
                          placeholder="Mức giá mới"
                          value={newPrice}
                          onChange={(e) => setNewPrice(e.target.value)}
                          required
                        />
                        <input
                          type="date"
                          className="form-input"
                          value={effectiveDate}
                          onChange={(e) => setEffectiveDate(e.target.value)}
                          required
                        />
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Lý do đổi giá"
                          value={priceNote}
                          onChange={(e) => setPriceNote(e.target.value)}
                        />
                        <button type="submit" className="btn btn-primary" style={{ height: 38 }}>
                          Cập nhật
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Ngày áp dụng</th>
                          <th className="text-right">Mức giá bán</th>
                          <th>Ghi chú</th>
                          <th>Người cập nhật</th>
                        </tr>
                      </thead>
                      <tbody>
                        {priceHistory.map((ph) => (
                          <tr key={ph.id}>
                            <td style={{ fontWeight: 600 }}>{ph.effective_from}</td>
                            <td className="text-right" style={{ fontWeight: 700, color: '#1d4ed8' }}>
                              {formatVND(ph.price)}
                            </td>
                            <td style={{ color: '#64748b' }}>{ph.note || '-'}</td>
                            <td style={{ fontSize: 12 }}>{ph.creator_name || 'Hệ thống'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detailTab === 'sales' && (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ngày bán</th>
                        <th>Mã GD</th>
                        <th className="text-right">SL</th>
                        <th className="text-right">Giá bán lúc đó</th>
                        <th className="text-right">Doanh thu</th>
                        <th className="text-right">Lợi nhuận</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesHistory.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>
                            Chưa có lịch sử bán hàng.
                          </td>
                        </tr>
                      ) : (
                        salesHistory.map((sh) => (
                          <tr key={sh.id}>
                            <td>{sh.sale_date}</td>
                            <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{sh.transaction_code}</td>
                            <td className="text-right" style={{ fontWeight: 700 }}>{sh.quantity}</td>
                            <td className="text-right">{formatVND(sh.unit_price_at_sale)}</td>
                            <td className="text-right" style={{ fontWeight: 700, color: '#1d4ed8' }}>{formatVND(sh.total_revenue)}</td>
                            <td className="text-right" style={{ fontWeight: 600, color: '#15803d' }}>{formatVND(sh.profit)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {detailTab === 'stock' && (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Loại biến động</th>
                        <th className="text-right">Số lượng</th>
                        <th className="text-right">Tồn sau GD</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockHistory.map((sm) => (
                        <tr key={sm.id}>
                          <td>{sm.movement_date}</td>
                          <td>
                            <span className={`badge ${sm.movement_type === 'PURCHASE' ? 'badge-success' : sm.movement_type === 'SALE' ? 'badge-neutral' : 'badge-danger'}`}>
                              {sm.movement_type}
                            </span>
                          </td>
                          <td className="text-right" style={{
                            fontWeight: 700,
                            color: sm.quantity_change > 0 ? '#15803d' : '#dc2626',
                          }}>
                            {sm.quantity_change > 0 ? `+${sm.quantity_change}` : sm.quantity_change}
                          </td>
                          <td className="text-right" style={{ fontWeight: 700 }}>{sm.balance_after}</td>
                          <td style={{ fontSize: 12, color: '#64748b' }}>{sm.note || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={() => setDetailProduct(null)} className="btn btn-secondary">Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* 7. CREATE / EDIT PRODUCT MODAL */}
      {showProductModal && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          productTypes={productTypes}
          onClose={() => setShowProductModal(false)}
          onSuccess={() => { setShowProductModal(false); loadData(); }}
        />
      )}

      {/* 8. CREATE / EDIT CATEGORY MODAL */}
      {showCategoryModal && (
        <CategoryFormModal
          category={editingCategory}
          onClose={() => setShowCategoryModal(false)}
          onSuccess={() => { setShowCategoryModal(false); loadData(); }}
        />
      )}

      {/* 9. CREATE / EDIT TYPE MODAL */}
      {showTypeModal && (
        <TypeFormModal
          type={editingType}
          categories={categories}
          onClose={() => setShowTypeModal(false)}
          onSuccess={() => { setShowTypeModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

// Modal component: Add/Edit Product
function ProductFormModal({ product, categories, productTypes, onClose, onSuccess }: any) {
  const isEdit = !!product;
  const [sku, setSku] = useState(product?.sku || '');
  const [name, setName] = useState(product?.name || '');
  const [categoryId, setCategoryId] = useState(product?.category_id || categories[0]?.id || '');
  const [typeId, setTypeId] = useState(product?.product_type_id || '');
  const [costPrice, setCostPrice] = useState(product?.current_cost_price || 0);
  const [sellingPrice, setSellingPrice] = useState(product?.current_selling_price || 0);
  const [initialStock, setInitialStock] = useState(product?.current_stock || 0);
  const [minAlert, setMinAlert] = useState(product?.min_stock_alert || 5);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!typeId && categoryId) {
      const firstType = productTypes.find((t: any) => String(t.category_id) === String(categoryId));
      if (firstType) setTypeId(firstType.id);
    }
  }, [categoryId, productTypes, typeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const url = isEdit ? `/api/products/${product.id}` : '/api/products';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = isEdit
        ? { name, category_id: categoryId, product_type_id: typeId, min_stock_alert: minAlert }
        : {
            sku,
            name,
            category_id: categoryId,
            product_type_id: typeId,
            cost_price: costPrice,
            selling_price: sellingPrice,
            initial_stock: initialStock,
            min_stock_alert: minAlert,
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        onSuccess();
      } else {
        setError(json.error?.message || 'Lỗi lưu thông tin sản phẩm.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h3 className="modal-title">{isEdit ? 'Sửa thông tin sản phẩm' : 'Thêm sản phẩm mới'}</h3>
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm"><X size={16} /></button>
          </div>

          <div className="modal-body">
            {error && (
              <div style={{ padding: '8px 12px', backgroundColor: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">Mã SKU (*)</label>
                <input
                  type="text"
                  className="form-input"
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  disabled={isEdit}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tên sản phẩm (*)</label>
                <input
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">Danh mục (*)</label>
                <select
                  className="form-select"
                  value={categoryId}
                  onChange={(e) => { setCategoryId(e.target.value); setTypeId(''); }}
                  required
                >
                  {categories.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Loại sản phẩm (*)</label>
                <select
                  className="form-select"
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                  required
                >
                  {productTypes
                    .filter((t: any) => String(t.category_id) === String(categoryId))
                    .map((t: any) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
              </div>
            </div>

            {!isEdit && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label">Giá nhập</label>
                  <input
                    type="number"
                    className="form-input"
                    value={costPrice}
                    onChange={(e) => setCostPrice(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Giá bán</label>
                  <input
                    type="number"
                    className="form-input"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Tồn ban đầu</label>
                  <input
                    type="number"
                    className="form-input"
                    value={initialStock}
                    onChange={(e) => setInitialStock(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Ngưỡng cảnh báo tồn ít</label>
              <input
                type="number"
                className="form-input"
                style={{ width: 120 }}
                value={minAlert}
                onChange={(e) => setMinAlert(parseInt(e.target.value) || 5)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">Huỷ</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Tạo sản phẩm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal: Category Form
function CategoryFormModal({ category, onClose, onSuccess }: any) {
  const isEdit = !!category;
  const [code, setCode] = useState(category?.code || '');
  const [name, setName] = useState(category?.name || '');
  const [desc, setDesc] = useState(category?.description || '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = isEdit ? `/api/categories/${category.id}` : '/api/categories';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, description: desc }),
      });
      const json = await res.json();
      if (json.success) onSuccess();
      else setError(json.error?.message || 'Lỗi lưu danh mục.');
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 450 }} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h3 className="modal-title">{isEdit ? 'Sửa danh mục' : 'Thêm danh mục'}</h3>
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm"><X size={16} /></button>
          </div>
          <div className="modal-body">
            {error && <div style={{ color: '#dc2626', marginBottom: 10, fontSize: 13 }}>{error}</div>}
            <div className="form-group">
              <label className="form-label">Mã danh mục (*)</label>
              <input type="text" className="form-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={isEdit} required />
            </div>
            <div className="form-group">
              <label className="form-label">Tên danh mục (*)</label>
              <input type="text" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Mô tả</label>
              <input type="text" className="form-input" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">Huỷ</button>
            <button type="submit" className="btn btn-primary">Lưu</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal: Product Type Form
function TypeFormModal({ type, categories, onClose, onSuccess }: any) {
  const isEdit = !!type;
  const [categoryId, setCategoryId] = useState(type?.category_id || categories[0]?.id || '');
  const [code, setCode] = useState(type?.code || '');
  const [name, setName] = useState(type?.name || '');
  const [desc, setDesc] = useState(type?.description || '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = isEdit ? `/api/product-types/${type.id}` : '/api/product-types';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId, code, name, description: desc }),
      });
      const json = await res.json();
      if (json.success) onSuccess();
      else setError(json.error?.message || 'Lỗi lưu loại sản phẩm.');
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 450 }} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h3 className="modal-title">{isEdit ? 'Sửa loại sản phẩm' : 'Thêm loại sản phẩm'}</h3>
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm"><X size={16} /></button>
          </div>
          <div className="modal-body">
            {error && <div style={{ color: '#dc2626', marginBottom: 10, fontSize: 13 }}>{error}</div>}
            <div className="form-group">
              <label className="form-label">Thuộc danh mục (*)</label>
              <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Mã loại (*)</label>
              <input type="text" className="form-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={isEdit} required />
            </div>
            <div className="form-group">
              <label className="form-label">Tên loại SP (*)</label>
              <input type="text" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Mô tả</label>
              <input type="text" className="form-input" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">Huỷ</button>
            <button type="submit" className="btn btn-primary">Lưu</button>
          </div>
        </form>
      </div>
    </div>
  );
}
