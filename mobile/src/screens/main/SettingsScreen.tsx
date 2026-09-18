import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  Alert,
  Modal,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { useNetwork } from '../../network/NetworkContext';
import { useSync } from '../../sync';
import Config from '../../config/env';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import NetworkBanner from '../../components/common/NetworkBanner';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';
import dataHealthService, { DataHealthReport } from '../../services/DataHealthService';
import exportService from '../../services/ExportService';
import auditLogService, { ActivityEvent } from '../../services/AuditLogService';
import apiClient from '../../api/client';

export const SettingsScreen: React.FC = () => {
  const { user, deviceId, sessionId, authStatus, logout, isLoading } = useAuth();
  const { isOnline, isServerReachable, recheckServer } = useNetwork();
  const { syncStatus, pendingCount, conflictCount, triggerSync } = useSync();



  // Modal States
  const [healthModalVisible, setHealthModalVisible] = useState(false);
  const [healthReport, setHealthReport] = useState<DataHealthReport | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportContent, setExportContent] = useState<string | null>(null);
  const [exportTitle, setExportTitle] = useState<string>('');
  const [exportLoading, setExportLoading] = useState(false);

  const [auditModalVisible, setAuditModalVisible] = useState(false);
  const [auditEvents, setAuditEvents] = useState<ActivityEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const handleRunHealthCheck = async () => {
    setCheckingHealth(true);
    setHealthModalVisible(true);
    try {
      const report = await dataHealthService.checkDataHealth();
      setHealthReport(report);
    } catch (err: any) {
      Alert.alert('Lỗi kiểm tra dữ liệu', err?.message || 'Không thể thực thi chẩn đoán.');
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleExport = async (type: 'products' | 'categories' | 'sales' | 'movements' | 'backup') => {
    setExportLoading(true);
    try {
      let data = '';
      let title = '';
      const dateTag = new Date().toISOString().slice(0, 10);
      if (type === 'products') {
        data = await exportService.exportProductsCsv();
        title = `Danh_sach_san_pham_${dateTag}.csv`;
      } else if (type === 'categories') {
        data = await exportService.exportCategoriesCsv();
        title = `Danh_muc_san_pham_${dateTag}.csv`;
      } else if (type === 'sales') {
        data = await exportService.exportSalesOrdersCsv();
        title = `Lich_su_ban_hang_${dateTag}.csv`;
      } else if (type === 'movements') {
        data = await exportService.exportStockMovementsCsv();
        title = `The_kho_bien_dong_${dateTag}.csv`;
      } else if (type === 'backup') {
        const backupObj = await exportService.createLocalBackupJson();
        data = JSON.stringify(backupObj, null, 2);
        title = `Sao_luu_SQLite_${backupObj.backup_metadata.timestamp.slice(0, 10)}.json`;
      }

      setExportTitle(title);
      setExportContent(data);
      setExportModalVisible(true);
    } catch (err: any) {
      Alert.alert('Lỗi xuất dữ liệu', err?.message || 'Không thể xuất dữ liệu.');
    } finally {
      setExportLoading(false);
    }
  };

  const handleOpenAuditLog = async () => {
    setAuditLoading(true);
    setAuditModalVisible(true);
    try {
      const events = await auditLogService.getRecentActivities(40);
      setAuditEvents(events);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message || 'Không thể tải nhật ký thao tác.');
    } finally {
      setAuditLoading(false);
    }
  };



  const handleLogout = async () => {
    const result = await logout(false);
    if (!result.success && result.unSyncedCount && result.unSyncedCount > 0) {
      Alert.alert(
        'Cảnh Báo Dữ Liệu Chưa Đồng Bộ',
        `Có ${result.unSyncedCount} giao dịch trong Outbox chưa được đồng bộ lên máy chủ. Nếu đăng xuất, các giao dịch này vẫn được lưu an toàn trên máy nhưng máy chủ chưa ghi nhận.\n\nBạn có muốn đăng xuất ngay không?`,
        [
          { text: 'Ở lại đồng bộ', style: 'cancel' },
          {
            text: 'Đăng xuất',
            style: 'destructive',
            onPress: () => logout(true),
          },
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NetworkBanner />

      <ScrollView contentContainerStyle={styles.content}>
        {/* User Account Card */}
        <Card>
          <Text style={styles.cardSectionTitle}>Tài khoản đang đăng nhập</Text>
          <View style={styles.userRow}>
            <View>
              <Text style={styles.userNameText}>{user?.full_name}</Text>
              <Text style={styles.userSubText}>@{user?.username}</Text>
            </View>
            <Badge 
              label={user?.role === 'ADMIN' ? 'Quản Trị Viên' : 'Nhân Viên Bán Hàng'} 
              variant={user?.role === 'ADMIN' ? 'primary' : 'neutral'} 
            />
          </View>
          <View style={[styles.settingRow, { marginTop: Spacing.sm }]}>
            <Text style={styles.settingLabel}>Trạng thái phiên:</Text>
            <Badge 
              label={authStatus === 'AUTHENTICATED' ? 'Đã xác thực' : authStatus} 
              variant={authStatus === 'AUTHENTICATED' ? 'success' : 'danger'} 
            />
          </View>
        </Card>

        {/* System Utilities: Health Check & Export & Audit Log */}
        <Card>
          <Text style={styles.cardSectionTitle}>Công cụ & Tiện ích hệ thống (Phase 11)</Text>

          <View style={styles.actionButtonRow}>
            <Button
              title="🩺 Kiểm tra dữ liệu (Data Health)"
              onPress={handleRunHealthCheck}
              variant="outline"
              size="sm"
              style={{ flex: 1 }}
            />
            <Button
              title="📜 Nhật ký thao tác (Audit Log)"
              onPress={handleOpenAuditLog}
              variant="outline"
              size="sm"
              style={{ flex: 1 }}
            />
          </View>

          <Text style={[styles.cardSubTitle, { marginTop: Spacing.md }]}>Xuất dữ liệu & Sổ sách (CSV / JSON)</Text>
          <View style={styles.exportGrid}>
            <Button
              title="📦 DS Sản phẩm (CSV)"
              onPress={() => handleExport('products')}
              variant="secondary"
              size="sm"
              loading={exportLoading}
              style={{ flex: 1, minWidth: '47%' }}
            />
            <Button
              title="🗂️ Danh mục (CSV)"
              onPress={() => handleExport('categories')}
              variant="secondary"
              size="sm"
              loading={exportLoading}
              style={{ flex: 1, minWidth: '47%' }}
            />
            <Button
              title="📋 Thẻ kho (CSV)"
              onPress={() => handleExport('movements')}
              variant="secondary"
              size="sm"
              loading={exportLoading}
              style={{ flex: 1, minWidth: '47%' }}
            />
            <Button
              title="🛒 Lịch sử bán (CSV)"
              onPress={() => handleExport('sales')}
              variant="secondary"
              size="sm"
              loading={exportLoading}
              style={{ flex: 1, minWidth: '47%' }}
            />
            <Button
              title="💾 Sao lưu toàn bộ máy (JSON)"
              onPress={() => handleExport('backup')}
              variant="outline"
              size="sm"
              loading={exportLoading}
              style={{ width: '100%', marginTop: 4 }}
            />
          </View>
        </Card>

        {/* System Information Card (Section 14) */}
        <Card>
          <Text style={styles.cardSectionTitle}>Thông tin hệ thống (System Information)</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Phiên bản App (App Version):</Text>
            <Text style={styles.settingValue}>v{Config.APP_VERSION} (Production Ready)</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Phiên bản CSDL SQLite:</Text>
            <Text style={styles.settingValue}>Schema v7 (WAL Mode, FIFO Lots)</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Môi trường triển khai:</Text>
            <Text style={styles.settingValue}>{Config.APP_ENV}</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Máy chủ Cloud (Vercel):</Text>
            <Text style={[styles.settingValue, { color: Colors.primary, fontWeight: '700' }]}>{apiClient.getBaseUrl()}</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Cơ sở dữ liệu:</Text>
            <Text style={styles.settingValue}>Supabase PostgreSQL (Cloud)</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Trạng thái kết nối Server:</Text>
            <Badge 
              label={isServerReachable ? 'Đang hoạt động' : 'Đang kết nối lại'} 
              variant={isServerReachable ? 'success' : 'danger'} 
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Cơ chế lấy dữ liệu:</Text>
            <Badge 
              label="Supabase Cloud 100% Trực tiếp" 
              variant="success" 
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Mã thiết bị (Device ID - Masked):</Text>
            <Text style={[styles.settingValue, { fontSize: 11 }]}>
              {deviceId ? `${deviceId.slice(0, 8)}...****` : 'Chưa thiết lập'}
            </Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Mã phiên làm việc (Session ID):</Text>
            <Text style={[styles.settingValue, { fontSize: 11 }]}>
              {sessionId ? `${sessionId.slice(0, 8)}...****` : 'Ngoại tuyến'}
            </Text>
          </View>

          <Text style={styles.syncNote}>
            Toàn bộ số liệu sản phẩm, đơn hàng, báo cáo được lấy trực tiếp 100% từ cơ sở dữ liệu Supabase trên Cloud, bảo đảm đồng nhất tuyệt đối với Web.
          </Text>
        </Card>

        {/* Server & Network Actions */}
        <Card>
          <Button
            title="🔄 Kiểm tra lại kết nối máy chủ"
            onPress={() => recheckServer()}
            variant="outline"
            size="sm"
          />

          <Button
            title="⚡ Làm mới dữ liệu từ Cloud (Refresh)"
            onPress={async () => {
              try {
                const { default: catRepo } = await import('../../repository/CategoryRepository');
                const { default: prodRepo } = await import('../../repository/ProductRepository');
                await Promise.all([
                  catRepo.getAll(true),
                  prodRepo.getAll(true),
                ]);
                Alert.alert('Thành công', 'Đã làm mới toàn bộ dữ liệu từ máy chủ Supabase Cloud.');
              } catch (e: any) {
                Alert.alert('Lỗi', e?.message || 'Không thể làm mới dữ liệu.');
              }
            }}
            variant="secondary"
            size="sm"
            style={{ marginTop: Spacing.sm }}
          />

          <Button
            title="Đăng xuất khỏi thiết bị"
            onPress={handleLogout}
            variant="danger"
            size="md"
            loading={isLoading}
            style={{ marginTop: Spacing.md }}
          />
        </Card>
      </ScrollView>

      {/* --- MODAL 1: DATA HEALTH REPORT --- */}
      <Modal visible={healthModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🩺 Chẩn đoán dữ liệu SQLite (Data Health)</Text>
              <TouchableOpacity onPress={() => setHealthModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            {checkingHealth ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={{ marginTop: 10, fontSize: 12, color: Colors.textMuted }}>
                  Đang chạy kiểm tra toàn vẹn SQLite & đối soát logic...
                </Text>
              </View>
            ) : healthReport ? (
              <ScrollView style={{ maxHeight: 420 }}>
                {/* Overall status badge */}
                <View style={[styles.healthBanner, healthReport.overallStatus === 'HEALTHY' ? styles.healthBannerOk : styles.healthBannerWarn]}>
                  <Text style={styles.healthBannerTitle}>
                    {healthReport.overallStatus === 'HEALTHY' ? '✅ Hệ thống dữ liệu hoạt động hoàn hảo' : '⚠️ Cần kiểm tra một số mục'}
                  </Text>
                  <Text style={styles.healthBannerTime}>Thời điểm kiểm tra: {new Date(healthReport.checkedAt).toLocaleTimeString('vi-VN')}</Text>
                </View>

                {/* Metrics Table */}
                <View style={styles.healthMetricsBox}>
                  <Text style={styles.healthMetricsTitle}>Thống kê quy mô dữ liệu cục bộ:</Text>
                  <Text style={styles.healthMetricText}>• Tổng sản phẩm: {healthReport.metrics.totalProducts}</Text>
                  <Text style={styles.healthMetricText}>• Tổng đơn hàng đã chốt: {healthReport.metrics.totalCompletedOrders}</Text>
                  <Text style={styles.healthMetricText}>• Tổng số lượng tồn kho: {healthReport.metrics.totalStockUnits} cái</Text>
                  <Text style={styles.healthMetricText}>• Số lô nhập kho còn hạn: {healthReport.metrics.totalActiveLots} lô ({healthReport.metrics.totalLotUnits} cái)</Text>
                  <Text style={styles.healthMetricText}>• Hàng đợi Outbox chờ đồng bộ: {healthReport.metrics.pendingOutboxCount}</Text>
                  <Text style={styles.healthMetricText}>• Xung đột đồng bộ mở: {healthReport.metrics.openConflictsCount}</Text>
                </View>

                {/* Individual check results */}
                <Text style={[styles.healthMetricsTitle, { marginTop: 10, marginBottom: 6 }]}>Chi tiết 7 tiêu chuẩn kiểm tra:</Text>
                {healthReport.checks.map((c) => (
                  <View key={c.key} style={styles.checkRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 13 }}>{c.status === 'PASS' ? '🟢' : c.status === 'WARN' ? '🟡' : '🔴'}</Text>
                      <Text style={styles.checkName}>{c.name}</Text>
                    </View>
                    <Text style={styles.checkSummary}>{c.summary}</Text>
                    {c.details && <Text style={styles.checkDetails}>{c.details}</Text>}
                  </View>
                ))}
              </ScrollView>
            ) : null}

            <Button
              title="Đóng cửa sổ"
              onPress={() => setHealthModalVisible(false)}
              size="sm"
              style={{ marginTop: Spacing.sm }}
            />
          </View>
        </View>
      </Modal>

      {/* --- MODAL 2: DATA EXPORT PREVIEW --- */}
      <Modal visible={exportModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>📥 {exportTitle}</Text>
              <TouchableOpacity onPress={() => setExportModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 11, color: Colors.textMuted, marginBottom: 8 }}>
              Dữ liệu được trích xuất trực tiếp từ cơ sở dữ liệu SQLite cục bộ mà không làm thay đổi dữ liệu gốc:
            </Text>

            <ScrollView style={styles.exportTextBox}>
              <Text style={styles.exportTextContent} selectable>
                {exportContent}
              </Text>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: Spacing.sm }}>
              <Button
                title="📤 Chia sẻ / Tải file"
                onPress={async () => {
                  if (exportContent) {
                    await exportService.shareOrDownloadFile(exportTitle, exportContent, exportTitle.endsWith('.json') ? 'json' : 'csv');
                  }
                }}
                variant="primary"
                size="sm"
                style={{ flex: 1 }}
              />
              <Button
                title="Đóng"
                onPress={() => setExportModalVisible(false)}
                variant="outline"
                size="sm"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* --- MODAL 3: AUDIT LOG VIEWER --- */}
      <Modal visible={auditModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📜 Nhật ký thao tác (Audit Log)</Text>
              <TouchableOpacity onPress={() => setAuditModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>

            {auditLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={{ marginTop: 10, fontSize: 12, color: Colors.textMuted }}>Đang tải nhật ký giao dịch...</Text>
              </View>
            ) : auditEvents.length === 0 ? (
              <View style={{ padding: 30, alignItems: 'center' }}>
                <Text style={{ color: Colors.textMuted }}>Chưa có phát sinh giao dịch nào.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 420 }}>
                {auditEvents.map((evt) => (
                  <View key={evt.id} style={styles.auditEventRow}>
                    <Text style={styles.auditIcon}>{evt.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.auditTitle}>{evt.title}</Text>
                      <Text style={styles.auditSubtitle}>{evt.subtitle}</Text>
                      <Text style={styles.auditMeta}>{evt.timestamp} • Bởi: {evt.actor}</Text>
                    </View>
                    <Badge 
                      label={evt.tag} 
                      variant={evt.status === 'SYNCED' ? 'success' : evt.status === 'PENDING' ? 'warning' : 'neutral'} 
                    />
                  </View>
                ))}
              </ScrollView>
            )}

            <Button
              title="Đóng nhật ký"
              onPress={() => setAuditModalVisible(false)}
              size="sm"
              style={{ marginTop: Spacing.sm }}
            />
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
  content: {
    padding: Spacing.md,
    gap: Spacing.sm,
    paddingBottom: Spacing.xxl,
  },
  cardSectionTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.textMain,
    marginBottom: Spacing.sm,
  },
  cardSubTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  actionButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  exportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  userNameText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.textMain,
  },
  userSubText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  settingLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
  },
  settingValue: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.textMain,
  },
  syncNote: {
    fontSize: 11,
    color: Colors.textSubtle,
    marginTop: Spacing.sm,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.textMain,
    flex: 1,
  },
  modalCloseText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '700',
    marginLeft: 8,
  },
  healthBanner: {
    padding: 10,
    borderRadius: BorderRadius.md,
    marginBottom: 10,
  },
  healthBannerOk: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  healthBannerWarn: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  healthBannerTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#15803D',
  },
  healthBannerTime: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  healthMetricsBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 3,
  },
  healthMetricsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMain,
    marginBottom: 4,
  },
  healthMetricText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  checkRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  checkName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMain,
  },
  checkSummary: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    marginLeft: 20,
  },
  checkDetails: {
    fontSize: 10,
    color: Colors.danger,
    marginTop: 2,
    marginLeft: 20,
  },
  exportTextBox: {
    maxHeight: 280,
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  exportTextContent: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#1E293B',
    lineHeight: 16,
  },
  auditEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 8,
  },
  auditIcon: {
    fontSize: 20,
  },
  auditTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMain,
  },
  auditSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  auditMeta: {
    fontSize: 10,
    color: Colors.textSubtle,
    marginTop: 2,
  },
});

export default SettingsScreen;
