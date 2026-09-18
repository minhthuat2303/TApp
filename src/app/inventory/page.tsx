'use client';

import React, { useState, useEffect } from 'react';
import { 
  Boxes, 
  AlertTriangle, 
  FileText, 
  PlusCircle, 
  Search, 
  Filter, 
  Layers, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  PackageCheck, 
  Tag,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import Link from 'next/link';

export default function InventoryOverviewPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'status' | 'lots' | 'movements'>('status');

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [movementTypeFilter, setMovementTypeFilter] = useState('');
  const [lotStatusFilter, setLotStatusFilter] = useState('AVAILABLE'); // AVAILABLE, EXHAUSTED, ALL

  // Data states
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [lotsData, setLotsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Adjustment Modal
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustType, setAdjustType] = useState('DAMAGE');
  const [adjustQuantity, setAdjustQuantity] = useState(-1);
  const [adjustDate, setAdjustDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [adjustNote, setAdjustNote] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const catRes = await fetch('/api/categories');
      const catJson = await catRes.json();
      if (catJson.success) setCategories(catJson.data);

      if (activeTab === 'status') {
        let url = `/api/inventory?lowStock=${lowStockOnly}`;
        if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
        if (selectedCategory) url += `&categoryId=${selectedCategory}`;

        const res = await fetch(url);
        const json = await res.json();
        if (json.success) setInventoryData(json.data);
      } else if (activeTab === 'lots') {
        let url = `/api/inventory/lots?limit=100`;
        if (lotStatusFilter !== 'ALL') url += `&status=${lotStatusFilter}`;
        if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
        if (selectedCategory) url += `&categoryId=${selectedCategory}`;

        const res = await fetch(url);
        const json = await res.json();
        if (json.success) setLotsData(json);
      } else {
        let url = `/api/inventory/movements?limit=100`;
        if (movementTypeFilter) url += `&movementType=${movementTypeFilter}`;

        const res = await fetch(url);
        const json = await res.json();
        if (json.success) setMovements(json.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab, searchQuery, selectedCategory, lowStockOnly, movementTypeFilter, lotStatusFilter]);

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    try {
      const res = await fetch('/api/inventory/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: parseInt(adjustProductId),
          movementType: adjustType,
          quantityChange: adjustQuantity,
          movementDate: adjustDate,
          note: adjustNote,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setFeedback({ type: 'success', message: 'Đã điều chỉnh kho thành công!' });
        setShowAdjustModal(false);
        setAdjustNote('');
        loadData();
      } else {
        setFeedback({ type: 'error', message: json.error?.message || 'Điều chỉnh thất bại.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    }
  };

  const formatVND = (v: number) => formatCurrency(v);

  return (
    <div style={{ width: '100%' }}>
      {/* Top action bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 14,
      }}>
        {/* Scrollable Tabs */}
        <div className="tabs-scroll-container" style={{ backgroundColor: '#f1f5f9', padding: 4, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('status')}
            className={`btn btn-sm ${activeTab === 'status' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', minHeight: 34 }}
          >
            <Boxes size={14} />
            <span>Tồn kho hiện tại</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('lots')}
            className={`btn btn-sm ${activeTab === 'lots' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', minHeight: 34 }}
          >
            <PackageCheck size={14} />
            <span>Lô hàng (FIFO Lots)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('movements')}
            className={`btn btn-sm ${activeTab === 'movements' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', minHeight: 34 }}
          >
            <FileText size={14} />
            <span>Sổ cái thẻ kho</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Link href="/inventory/import" className="btn btn-primary btn-sm">
            <PlusCircle size={14} />
            <span>Nhập kho</span>
          </Link>

          {user?.role === 'ADMIN' && (
            <button
              onClick={() => {
                if (inventoryData?.items?.length > 0) {
                  setAdjustProductId(inventoryData.items[0].id.toString());
                }
                setShowAdjustModal(true);
              }}
              className="btn btn-secondary btn-sm"
            >
              <FileText size={14} />
              <span>Xuất huỷ / Điều chỉnh</span>
            </button>
          )}
        </div>
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
          {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* 1. TAB: TỒN KHO HIỆN TẠI */}
      {activeTab === 'status' && (
        <>
          {/* Inventory summary cards (Responsive 2-Col) */}
          <div className="stats-grid" style={{ marginBottom: 14 }}>
            <div className="stat-card" style={{ borderLeft: '4px solid #2563eb' }}>
              <div className="stat-label">TỔNG SỐ LƯỢNG TỒN</div>
              <div className="stat-value" style={{ color: '#1d4ed8' }}>
                {(inventoryData?.summary?.totalStock ?? inventoryData?.summary?.totalStockItems ?? 0).toLocaleString('vi-VN')} <span style={{ fontSize: 13 }}>món</span>
              </div>
              <div className="stat-sub">{inventoryData?.summary?.totalProducts || 0} sản phẩm</div>
            </div>

            <div className="stat-card" style={{ borderLeft: '4px solid #059669' }}>
              <div className="stat-label">TỔNG GIÁ TRỊ TỒN KHO</div>
              <div className="stat-value" style={{ color: '#047857' }}>
                {formatVND(inventoryData?.summary?.totalValuation || 0)}
              </div>
              <div className="stat-sub">Tính theo giá vốn FIFO</div>
            </div>

            <div className="stat-card" style={{ borderLeft: '4px solid #dc2626' }}>
              <div className="stat-label">CẢNH BÁO SẮP HẾT HÀNG</div>
              <div className="stat-value" style={{ color: '#b91c1c' }}>
                {inventoryData?.summary?.lowStockCount || 0} <span style={{ fontSize: 13 }}>sản phẩm</span>
              </div>
              <div className="stat-sub">Tồn dưới ngưỡng an toàn</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="">-- Tất cả danh mục --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={lowStockOnly}
                  onChange={(e) => setLowStockOnly(e.target.checked)}
                />
                <span style={{ color: '#dc2626', fontWeight: 600 }}>Chỉ xem hàng sắp hết</span>
              </label>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Mã SKU</th>
                    <th>Sản phẩm</th>
                    <th>Danh mục</th>
                    <th className="text-right">Tồn hiện tại</th>
                    <th className="text-right">Giá vốn BQ</th>
                    <th className="text-right">Giá bán</th>
                    <th className="text-right">Giá trị tồn</th>
                    <th className="text-center">Cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                        Đang tải dữ liệu tồn kho...
                      </td>
                    </tr>
                  ) : inventoryData?.items?.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                        Không tìm thấy sản phẩm nào.
                      </td>
                    </tr>
                  ) : (
                    inventoryData?.items?.map((item: any) => (
                      <tr key={item.id}>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{item.sku}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{item.product_type_name}</div>
                        </td>
                        <td>{item.category_name}</td>
                        <td className="text-right">
                          <span style={{
                            fontWeight: 700,
                            color: item.current_stock <= item.min_stock_alert ? '#dc2626' : '#0f172a',
                          }}>
                            {item.current_stock}
                          </span>
                        </td>
                        <td className="text-right" style={{ color: '#64748b' }}>
                          {formatVND(item.current_cost_price)}
                        </td>
                        <td className="text-right" style={{ fontWeight: 500 }}>
                          {formatVND(item.current_selling_price)}
                        </td>
                        <td className="text-right" style={{ fontWeight: 700, color: '#059669' }}>
                          {formatVND(item.stock_valuation)}
                        </td>
                        <td className="text-center">
                          {item.current_stock <= item.min_stock_alert ? (
                            <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <AlertTriangle size={11} /> Cần nhập
                            </span>
                          ) : (
                            <span className="badge badge-success">An toàn</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 2. TAB: QUẢN LÝ LÔ HÀNG (FIFO INVENTORY LOTS) */}
      {activeTab === 'lots' && (
        <>
          <div className="stats-grid" style={{ marginBottom: 14 }}>
            <div className="stat-card" style={{ borderLeft: '4px solid #2563eb' }}>
              <div className="stat-label">TỔNG SL NHẬP VÀO</div>
              <div className="stat-value" style={{ color: '#1d4ed8' }}>
                {(lotsData?.summary?.totalReceived || 0).toLocaleString('vi-VN')} <span style={{ fontSize: 13 }}>món</span>
              </div>
              <div className="stat-sub">{lotsData?.summary?.lotCount || 0} lô hàng</div>
            </div>

            <div className="stat-card" style={{ borderLeft: '4px solid #16a34a' }}>
              <div className="stat-label">TỔNG SL CÒN TRONG LÔ</div>
              <div className="stat-value" style={{ color: '#15803d' }}>
                {(lotsData?.summary?.totalRemaining || 0).toLocaleString('vi-VN')} <span style={{ fontSize: 13 }}>món</span>
              </div>
              <div className="stat-sub">Sẵn sàng xuất FIFO</div>
            </div>

            <div className="stat-card" style={{ borderLeft: '4px solid #0891b2' }}>
              <div className="stat-label">GIÁ TRỊ TỒN CÁC LÔ</div>
              <div className="stat-value" style={{ color: '#0e7490' }}>
                {formatVND(lotsData?.summary?.totalRemainingValue || 0)}
              </div>
              <div className="stat-sub">Theo giá từng lô</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 8,
              padding: '10px 14px',
            }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 28, height: 34, fontSize: 12.5 }}
                  placeholder="Tìm Mã Lô, SKU, Tên SP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 8, top: 10 }} />
              </div>

              <select
                className="form-select"
                style={{ height: 34, padding: '2px 8px', fontSize: 12.5 }}
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="">-- Tất cả danh mục --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                className="form-select"
                style={{ height: 34, padding: '2px 8px', fontSize: 12.5 }}
                value={lotStatusFilter}
                onChange={(e) => setLotStatusFilter(e.target.value)}
              >
                <option value="AVAILABLE">Lô còn hàng</option>
                <option value="EXHAUSTED">Lô đã xuất hết</option>
                <option value="ALL">Tất cả các lô</option>
              </select>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Mã Lô</th>
                    <th>Sản phẩm</th>
                    <th>Ngày nhập</th>
                    <th className="text-right">SL Nhập</th>
                    <th className="text-right">SL Còn</th>
                    <th className="text-right">Đơn giá nhập</th>
                    <th className="text-right">Giá trị còn lại</th>
                    <th>Nhà cung cấp</th>
                    <th className="text-center">Trạng thái</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                        Đang tải danh sách lô hàng...
                      </td>
                    </tr>
                  ) : !lotsData?.data || lotsData.data.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                        Không có lô hàng nào phù hợp.
                      </td>
                    </tr>
                  ) : (
                    lotsData.data.map((lot: any) => (
                      <tr key={lot.id}>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace', color: '#1e3a8a' }}>
                          {lot.lot_code}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{lot.product_name}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>SKU: {lot.sku} • {lot.category_name}</div>
                        </td>
                        <td style={{ fontWeight: 500 }}>{lot.purchase_date}</td>
                        <td className="text-right">{lot.quantity_received}</td>
                        <td className="text-right">
                          <span style={{
                            fontWeight: 700,
                            color: lot.quantity_remaining > 0 ? '#15803d' : '#94a3b8',
                          }}>
                            {lot.quantity_remaining}
                          </span>
                        </td>
                        <td className="text-right" style={{ fontWeight: 600, color: '#475569' }}>
                          {formatVND(lot.unit_cost)}
                        </td>
                        <td className="text-right" style={{ fontWeight: 700, color: '#0e7490' }}>
                          {formatVND(lot.remaining_value)}
                        </td>
                        <td style={{ fontSize: 12 }}>{lot.supplier_name || '-'}</td>
                        <td className="text-center">
                          <span className={`badge ${lot.status === 'AVAILABLE' ? 'badge-success' : 'badge-neutral'}`}>
                            {lot.status === 'AVAILABLE' ? 'Còn hàng' : 'Đã hết'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{lot.note || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 3. TAB: SỔ CÁI THẺ KHO */}
      {activeTab === 'movements' && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8, padding: '10px 14px' }}>
            <h2 className="card-title" style={{ fontSize: 14.5 }}>Nhật ký biến động kho</h2>

            <select
              className="form-select"
              style={{ height: 34, padding: '2px 8px', fontSize: 12.5, width: '100%', maxWidth: 220 }}
              value={movementTypeFilter}
              onChange={(e) => setMovementTypeFilter(e.target.value)}
            >
              <option value="">-- Tất cả loại biến động --</option>
              <option value="PURCHASE">Nhập kho (PURCHASE)</option>
              <option value="SALE">Bán hàng (SALE)</option>
              <option value="DAMAGE">Hàng hỏng (DAMAGE)</option>
              <option value="LOSS">Mất mát (LOSS)</option>
              <option value="GIFT">Hàng biếu tặng (GIFT)</option>
              <option value="RETURN">Trả hàng NCC (RETURN)</option>
              <option value="ADJUSTMENT">Kiểm kê (ADJUSTMENT)</option>
            </select>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ngày phát sinh</th>
                  <th>Mã SKU</th>
                  <th>Sản phẩm</th>
                  <th>Loại biến động</th>
                  <th className="text-right">Thay đổi</th>
                  <th className="text-right">Tồn sau GD</th>
                  <th>Lý do / Ghi chú</th>
                  <th>Người thực hiện</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                      Đang tải sổ cái kho...
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                      Chưa có biến động kho nào.
                    </td>
                  </tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 500 }}>{m.movement_date}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{m.sku}</td>
                      <td style={{ fontWeight: 600 }}>{m.product_name}</td>
                      <td>
                        <span className={`badge ${
                          m.movement_type === 'PURCHASE' ? 'badge-success' :
                          m.movement_type === 'SALE' ? 'badge-neutral' : 'badge-danger'
                        }`}>
                          {m.movement_type}
                        </span>
                      </td>
                      <td className="text-right" style={{
                        fontWeight: 700,
                        color: m.quantity_change > 0 ? '#15803d' : '#dc2626',
                      }}>
                        {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700 }}>
                        {m.balance_after}
                      </td>
                      <td style={{ color: '#64748b', fontSize: 12.5 }}>{m.note || '-'}</td>
                      <td style={{ fontSize: 12 }}>{m.creator_name || 'Hệ thống'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADJUSTMENT MODAL */}
      {showAdjustModal && (
        <div className="modal-backdrop" onClick={() => setShowAdjustModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleAdjustSubmit}>
              <div className="modal-header">
                <h3 className="modal-title">Xuất huỷ / Điều chỉnh kho</h3>
                <button type="button" onClick={() => setShowAdjustModal(false)} className="btn btn-secondary btn-sm">
                  <X size={16} />
                </button>
              </div>

              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Sản phẩm điều chỉnh (*)</label>
                  <select
                    className="form-select"
                    value={adjustProductId}
                    onChange={(e) => setAdjustProductId(e.target.value)}
                    required
                  >
                    {inventoryData?.items?.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        [{p.sku}] {p.name} (Tồn hiện tại: {p.current_stock})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Loại điều chỉnh (*)</label>
                    <select
                      className="form-select"
                      value={adjustType}
                      onChange={(e) => setAdjustType(e.target.value)}
                      required
                    >
                      <option value="DAMAGE">Hỏng / Lỗi (DAMAGE)</option>
                      <option value="LOSS">Thất thoát (LOSS)</option>
                      <option value="GIFT">Biếu tặng (GIFT)</option>
                      <option value="RETURN">Trả NCC (RETURN)</option>
                      <option value="ADJUSTMENT">Kiểm kê (ADJUSTMENT)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Số lượng thay đổi (*)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={adjustQuantity}
                      onChange={(e) => setAdjustQuantity(parseInt(e.target.value) || 0)}
                      required
                    />
                    <span style={{ fontSize: 11, color: '#64748b' }}>Nhập số âm để giảm tồn</span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Ngày ghi nhận</label>
                  <input
                    type="date"
                    className="form-input"
                    value={adjustDate}
                    onChange={(e) => setAdjustDate(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Lý do chi tiết (*)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: Rách bao bì, kiểm kê thiếu..."
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowAdjustModal(false)} className="btn btn-secondary">
                  Huỷ
                </button>
                <button type="submit" className="btn btn-primary">
                  Xác nhận điều chỉnh
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
