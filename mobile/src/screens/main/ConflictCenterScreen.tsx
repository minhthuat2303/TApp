import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';
import conflictService from '../../sync/ConflictService';
import inventoryReconciliationService, { ProductReconciliationResult } from '../../services/InventoryReconciliationService';
import { ConflictRecord } from '../../database/types';
import { useAuth } from '../../auth/AuthContext';
import { useSync } from '../../sync';

export const ConflictCenterScreen: React.FC = () => {
  const { user } = useAuth();
  const { triggerSync, isSyncing } = useSync();

  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState<ConflictRecord | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Reconciliation state
  const [reconciliationDrifts, setReconciliationDrifts] = useState<ProductReconciliationResult[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);

  const loadConflicts = useCallback(async () => {
    try {
      const scopeUserId = user?.role === 'ADMIN' ? undefined : user?.id;
      if (filter === 'OPEN') {
        const data = await conflictService.getOpenConflicts(scopeUserId);
        setConflicts(data);
      } else {
        const data = await conflictService.getAllConflicts(scopeUserId !== undefined ? { user_id: scopeUserId } : undefined);
        setConflicts(data);
      }
    } catch (err) {
      console.error('Failed to load conflicts:', err);
    } finally {
      setRefreshing(false);
    }
  }, [filter, user]);

  useEffect(() => {
    loadConflicts();
  }, [loadConflicts]);

  const onRefresh = () => {
    setRefreshing(true);
    loadConflicts();
  };

  const handleCancelLocal = (conflict: ConflictRecord) => {
    Alert.alert(
      'Hủy giao dịch cục bộ?',
      `Hành động này sẽ hủy đơn bán hàng ${conflict.client_transaction_id}, hoàn trả số lượng tồn kho nội bộ SQLite và đánh dấu xung đột đã giải quyết.`,
      [
        { text: 'Quay lại', style: 'cancel' },
        {
          text: 'Xác nhận hủy',
          style: 'destructive',
          onPress: async () => {
            try {
              setActionLoading(true);
              await conflictService.resolveWithCancellation(
                conflict.conflict_id,
                'Người dùng hủy cục bộ do xung đột kho',
                user?.id?.toString() || '1',
                user?.id
              );
              Alert.alert('Thành công', 'Đã hủy đơn hàng cục bộ và hoàn trả tồn kho.');
              setSelectedConflict(null);
              loadConflicts();
            } catch (err: any) {
              Alert.alert('Lỗi', err.message || 'Không thể hủy đơn hàng');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleRestockAndRetry = async (conflict: ConflictRecord) => {
    Alert.alert(
      'Thử lại đồng bộ?',
      `Đảm bảo kho máy chủ đã được nhập đủ hàng trước khi thử lại. Hệ thống sẽ chuyển Outbox về PENDING để gửi lại.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Thử lại ngay',
          onPress: async () => {
            try {
              setActionLoading(true);
              await conflictService.resolveWithRetry(
                conflict.conflict_id,
                user?.id?.toString() || '1',
                user?.id
              );
              Alert.alert('Đã lên lịch', 'Giao dịch đã được đưa lại vào hàng đợi đồng bộ.');
              setSelectedConflict(null);
              loadConflicts();
              // Trigger sync immediately
              await triggerSync();
            } catch (err: any) {
              Alert.alert('Lỗi', err.message || 'Không thể thử lại');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDismiss = async (conflict: ConflictRecord) => {
    try {
      setActionLoading(true);
      await conflictService.resolveWithDismiss(
        conflict.conflict_id,
        user?.id?.toString() || '1',
        'Bỏ qua bởi người dùng',
        user?.id
      );
      setSelectedConflict(null);
      loadConflicts();
    } catch (err: any) {
      Alert.alert('Lỗi', err.message || 'Không thể bỏ qua');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunLedgerAudit = async () => {
    try {
      setIsAuditing(true);
      const drifts = await inventoryReconciliationService.reconcileAllProducts('USER_MANUAL_AUDIT');
      setReconciliationDrifts(drifts);
      if (drifts.length === 0) {
        Alert.alert('Đối soát thành công', 'Không phát hiện sai lệch nào giữa số lượng tồn và sổ cái lịch sử giao dịch!');
      } else {
        Alert.alert('Cảnh báo lệch sổ cái', `Phát hiện ${drifts.length} sản phẩm có số lượng tồn không khớp với tổng biến động sổ cái!`);
      }
    } catch (err: any) {
      Alert.alert('Lỗi kiểm toán', err.message || 'Không thể đối soát tồn kho');
    } finally {
      setIsAuditing(false);
    }
  };

  const getConflictBadgeVariant = (type: string) => {
    switch (type) {
      case 'INVENTORY_CONFLICT':
        return 'danger';
      case 'VALIDATION_CONFLICT':
      case 'BUSINESS_CONFLICT':
        return 'warning';
      case 'DUPLICATE':
        return 'neutral';
      default:
        return 'primary';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header Summary Card */}
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Xử lý xung đột & Đối soát kho</Text>
              <Text style={styles.headerSubtitle}>
                Chính sách bảo toàn giao dịch: Không xóa/ghi đè dữ liệu kinh doanh.
              </Text>
            </View>
            <Button
              title={isAuditing ? 'Đang kiểm...' : '🔍 Đối soát sổ cái'}
              onPress={handleRunLedgerAudit}
              variant="secondary"
              size="sm"
              loading={isAuditing}
            />
          </View>

          {/* Filter Pills */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterPill, filter === 'OPEN' && styles.filterPillActive]}
              onPress={() => setFilter('OPEN')}
            >
              <Text style={[styles.filterPillText, filter === 'OPEN' && styles.filterPillTextActive]}>
                Đang chờ ({conflicts.filter((c) => c.status === 'OPEN').length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.filterPill, filter === 'ALL' && styles.filterPillActive]}
              onPress={() => setFilter('ALL')}
            >
              <Text style={[styles.filterPillText, filter === 'ALL' && styles.filterPillTextActive]}>
                Tất cả lịch sử
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Audit Results Panel if any drift detected */}
        {reconciliationDrifts.length > 0 && (
          <Card style={styles.driftCard}>
            <Text style={styles.driftTitle}>⚠️ Kết quả phát hiện lệch sổ cái (Stock Drift)</Text>
            {reconciliationDrifts.map((d) => (
              <View key={d.productId} style={styles.driftItem}>
                <Text style={styles.driftItemName}>{d.productName} ({d.sku})</Text>
                <Text style={styles.driftItemDetail}>
                  Tồn kho: {d.actualStock} | Sổ cái: {d.expectedStock} | Chênh lệch: {d.driftQuantity > 0 ? `+${d.driftQuantity}` : d.driftQuantity}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Conflict List */}
        {conflicts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🎉</Text>
            <Text style={styles.emptyTitle}>Không có xung đột nào!</Text>
            <Text style={styles.emptySubtitle}>
              Mọi giao dịch ngoại tuyến đã được đồng bộ an toàn và nhất quán.
            </Text>
          </View>
        ) : (
          conflicts.map((item) => (
            <Card key={item.conflict_id} style={styles.conflictCard}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.badgeRow}>
                    <Badge
                      label={item.conflict_type || 'CONFLICT'}
                      variant={getConflictBadgeVariant(item.conflict_type)}
                    />
                    <Badge
                      label={item.status}
                      variant={item.status === 'OPEN' ? 'warning' : 'neutral'}
                    />
                  </View>
                  <Text style={styles.txIdText}>Giao dịch: {item.client_transaction_id}</Text>
                  <Text style={styles.detectedAtText}>Thời điểm: {item.detected_at}</Text>
                </View>
              </View>

              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>Nguyên nhân xung đột:</Text>
                <Text style={styles.reasonText}>{item.reason}</Text>
              </View>

              {item.resolution && (
                <View style={styles.resolutionBox}>
                  <Text style={styles.resolutionText}>
                    Giải pháp: {item.resolution} (bởi User {item.resolved_by})
                  </Text>
                </View>
              )}

              {/* Action Buttons for OPEN conflicts */}
              {item.status === 'OPEN' && (
                <View style={styles.actionsRow}>
                  <Button
                    title="Hủy đơn cục bộ"
                    variant="danger"
                    size="sm"
                    onPress={() => handleCancelLocal(item)}
                    style={{ flex: 1 }}
                    loading={actionLoading}
                  />
                  <Button
                    title="Thử lại"
                    variant="primary"
                    size="sm"
                    onPress={() => handleRestockAndRetry(item)}
                    style={{ flex: 1 }}
                    loading={actionLoading}
                  />
                  <Button
                    title="Bỏ qua"
                    variant="secondary"
                    size="sm"
                    onPress={() => handleDismiss(item)}
                    loading={actionLoading}
                  />
                </View>
              )}

              <TouchableOpacity
                style={styles.detailsToggle}
                onPress={() => setSelectedConflict(item)}
              >
                <Text style={styles.detailsToggleText}>Xem chi tiết Payload ›</Text>
              </TouchableOpacity>
            </Card>
          ))
        )}
      </ScrollView>

      {/* JSON Payload Detail Modal */}
      <Modal
        visible={!!selectedConflict}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedConflict(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Chi tiết xung đột</Text>
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalSubheading}>Dữ liệu cục bộ (Local):</Text>
              <Text style={styles.codeText}>{selectedConflict?.local_data}</Text>

              <Text style={[styles.modalSubheading, { marginTop: 12 }]}>Dữ liệu phản hồi máy chủ (Server):</Text>
              <Text style={styles.codeText}>{selectedConflict?.server_data}</Text>
            </ScrollView>

            <Button
              title="Đóng"
              variant="secondary"
              onPress={() => setSelectedConflict(null)}
              style={{ marginTop: 12 }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  headerCard: {
    padding: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceAlt,
  },
  filterPillActive: {
    backgroundColor: Colors.primary,
  },
  filterPillText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  driftCard: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    padding: Spacing.md,
  },
  driftTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: '#b45309',
    marginBottom: Spacing.xs,
  },
  driftItem: {
    marginTop: 4,
  },
  driftItemName: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
    color: '#92400e',
  },
  driftItemDetail: {
    fontSize: Typography.fontSize.xs,
    color: '#b45309',
  },
  conflictCard: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  txIdText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  detectedAtText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  reasonBox: {
    backgroundColor: '#fef2f2',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.danger,
  },
  reasonLabel: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '700',
    color: Colors.danger,
  },
  reasonText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  resolutionBox: {
    backgroundColor: '#f0fdf4',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  resolutionText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.success,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  detailsToggle: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },
  detailsToggleText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: Spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: Typography.fontSize.md,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  modalSubheading: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  modalScroll: {
    maxHeight: 350,
  },
  codeText: {
    fontFamily: 'Courier',
    fontSize: 11,
    backgroundColor: '#f1f5f9',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginTop: 4,
    color: '#334155',
  },
});

export default ConflictCenterScreen;
