// T_SHOP Mobile - Receipt & Sale Result Modal
// Displays itemized receipt, actual sync status, ESC/POS print action, and native share.
// Architecture Guarantee: Printer failure does not break or alter the persisted sale transaction.

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { Spacing, Typography, BorderRadius } from '../../constants/layout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { formatCurrency, formatDate } from '../../utils/formatters';
import receiptPrinterService, { ReceiptData } from '../../services/printer/ReceiptPrinterService';

interface ReceiptModalProps {
  visible: boolean;
  receiptData: ReceiptData | null;
  onClose: () => void;
  onNewOrder: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  visible,
  receiptData,
  onClose,
  onNewOrder,
}) => {
  const [printing, setPrinting] = useState(false);
  const [printStatusMsg, setPrintStatusMsg] = useState<string | null>(null);

  if (!receiptData) return null;

  const handlePrint = async () => {
    setPrinting(true);
    setPrintStatusMsg(null);
    try {
      const res = await receiptPrinterService.printReceipt(receiptData);
      if (res.success) {
        setPrintStatusMsg('✅ In hóa đơn thành công!');
        Alert.alert('Máy in ESC/POS', res.message || 'Đã gửi lệnh in thành công.');
      } else {
        // Printer failure MUST NOT rollback the sale
        setPrintStatusMsg(`⚠️ Lỗi máy in: ${res.error}`);
        Alert.alert(
          'Không thể in hóa đơn',
          `${res.error}\n\nLưu ý: Giao dịch bán hàng vẫn đã được lưu an toàn vào cơ sở dữ liệu local. Bạn có thể thử in lại hoặc chia sẻ hóa đơn qua tin nhắn.`,
          [
            { text: 'Đóng' },
            { text: 'Thử lại', onPress: handlePrint },
          ]
        );
      }
    } catch (err: any) {
      setPrintStatusMsg(`⚠️ Lỗi: ${err?.message || 'Không rõ'}`);
      Alert.alert('Lỗi in', err?.message || 'Không thể kết nối máy in.');
    } finally {
      setPrinting(false);
    }
  };

  const handleShare = async () => {
    try {
      const text = receiptPrinterService.formatPlainTextReceipt(receiptData);
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          Alert.alert('Đã sao chép hóa đơn', 'Nội dung hóa đơn text đã được sao chép vào Clipboard để gửi Zalo / Tin nhắn.');
          return;
        }
      }
      await Share.share({
        title: `Hóa đơn T_SHOP - ${receiptData.orderCode}`,
        message: text,
      });
    } catch (err: any) {
      console.error('Share error:', err);
    }
  };

  const isSynced = receiptData.syncStatus === 'SYNCED';

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.successBadge}>
              <Text style={styles.successIcon}>✓</Text>
            </View>
            <Text style={styles.title}>Bán Hàng Thành Công!</Text>
            <Text style={styles.orderCode}>{receiptData.orderCode}</Text>

            {/* Accurate Sync Status Badge */}
            <View style={[styles.syncBadge, isSynced ? styles.syncSynced : styles.syncPending]}>
              <Text style={[styles.syncBadgeText, isSynced ? styles.syncSyncedText : styles.syncPendingText]}>
                {isSynced ? '● Đã đồng bộ máy chủ' : '○ Lưu Offline - Chờ đồng bộ'}
              </Text>
            </View>
          </View>

          {/* Receipt Body */}
          <ScrollView contentContainerStyle={styles.receiptScroll} showsVerticalScrollIndicator={false}>
            <Card style={styles.paperCard}>
              {/* Store details */}
              <View style={styles.storeHeader}>
                <Text style={styles.storeName}>{receiptData.storeName}</Text>
                {receiptData.storeAddress ? (
                  <Text style={styles.storeSub}>{receiptData.storeAddress}</Text>
                ) : null}
                {receiptData.storePhone ? (
                  <Text style={styles.storeSub}>ĐT: {receiptData.storePhone}</Text>
                ) : null}
              </View>

              <View style={styles.dashedDivider} />

              {/* Meta lines */}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Thời gian:</Text>
                <Text style={styles.metaValue}>{formatDate(receiptData.saleDate)}</Text>
              </View>
              {receiptData.cashierName ? (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Thu ngân:</Text>
                  <Text style={styles.metaValue}>{receiptData.cashierName}</Text>
                </View>
              ) : null}

              <View style={styles.dashedDivider} />

              {/* Items List */}
              <Text style={styles.itemsSectionTitle}>DANH SÁCH MÓN HÀNG ({receiptData.items.length})</Text>
              {receiptData.items.map((it, idx) => (
                <View key={idx} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{it.productName}</Text>
                    <Text style={styles.itemCalc}>
                      {it.quantity} x {formatCurrency(it.unitPrice)}
                    </Text>
                  </View>
                  <Text style={styles.itemAmount}>{formatCurrency(it.lineTotal)}</Text>
                </View>
              ))}

              <View style={styles.dashedDivider} />

              {/* Financial calculations */}
              <View style={styles.calcRow}>
                <Text style={styles.calcLabel}>Tạm tính:</Text>
                <Text style={styles.calcValue}>{formatCurrency(receiptData.subtotal)}</Text>
              </View>
              {receiptData.totalDiscount > 0 ? (
                <View style={styles.calcRow}>
                  <Text style={styles.calcLabel}>Giảm giá:</Text>
                  <Text style={styles.discountValue}>-{formatCurrency(receiptData.totalDiscount)}</Text>
                </View>
              ) : null}

              <View style={[styles.calcRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>TỔNG THU:</Text>
                <Text style={styles.totalAmount}>{formatCurrency(receiptData.finalAmount)}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Hình thức:</Text>
                <Text style={styles.metaValue}>
                  {receiptData.paymentMethod === 'CASH'
                    ? 'Tiền mặt'
                    : receiptData.paymentMethod === 'BANK_TRANSFER'
                    ? 'Chuyển khoản'
                    : 'Thẻ'}
                </Text>
              </View>

              {receiptData.paymentMethod === 'CASH' && receiptData.cashReceived !== undefined ? (
                <>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Khách đưa:</Text>
                    <Text style={styles.metaValue}>{formatCurrency(receiptData.cashReceived)}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Tiền thừa trả khách:</Text>
                    <Text style={styles.changeValue}>{formatCurrency(receiptData.cashChange || 0)}</Text>
                  </View>
                </>
              ) : null}

              {receiptData.note ? (
                <View style={styles.noteBox}>
                  <Text style={styles.noteText}>Ghi chú: {receiptData.note}</Text>
                </View>
              ) : null}

              {printStatusMsg ? (
                <View style={styles.printStatusBanner}>
                  <Text style={styles.printStatusText}>{printStatusMsg}</Text>
                </View>
              ) : null}
            </Card>
          </ScrollView>

          {/* Action Bar */}
          <View style={styles.actionsFooter}>
            <View style={styles.printerRow}>
              <Button
                title={printing ? 'Đang gửi...' : '🖨️ In hóa đơn (ESC/POS)'}
                onPress={handlePrint}
                loading={printing}
                variant="primary"
                style={styles.printBtn}
              />
              <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
                <Text style={styles.shareBtnText}>📤 Chia sẻ</Text>
              </TouchableOpacity>
            </View>

            <Button
              title="🛒 Tạo đơn hàng mới"
              variant="outline"
              onPress={() => {
                onClose();
                onNewOrder();
              }}
              style={styles.newOrderBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: Spacing.lg,
  },
  header: {
    alignItems: 'center',
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  successBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  successIcon: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: 'bold',
  },
  title: {
    ...Typography.titleMedium,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  orderCode: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  syncBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  syncSynced: {
    backgroundColor: '#E8F5E9',
  },
  syncPending: {
    backgroundColor: '#FFF8E1',
  },
  syncBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  syncSyncedText: {
    color: '#2E7D32',
  },
  syncPendingText: {
    color: '#F57F17',
  },
  receiptScroll: {
    padding: Spacing.md,
  },
  paperCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  storeHeader: {
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  storeName: {
    ...Typography.bodyLarge,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  storeSub: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  dashedDivider: {
    borderWidth: 0.8,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    marginVertical: Spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  metaLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  metaValue: {
    ...Typography.bodySmall,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  itemsSectionTitle: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: 6,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  itemName: {
    ...Typography.bodySmall,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  itemCalc: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 1,
  },
  itemAmount: {
    ...Typography.bodySmall,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  calcLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  calcValue: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
  },
  discountValue: {
    ...Typography.bodySmall,
    color: Colors.success,
    fontWeight: '600',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
    marginTop: 6,
    marginBottom: 8,
  },
  totalLabel: {
    ...Typography.bodyMedium,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  totalAmount: {
    ...Typography.titleMedium,
    fontWeight: '800',
    color: Colors.primary,
  },
  changeValue: {
    ...Typography.bodySmall,
    fontWeight: '700',
    color: Colors.success,
  },
  noteBox: {
    backgroundColor: Colors.background,
    padding: 8,
    borderRadius: BorderRadius.sm,
    marginTop: 8,
  },
  noteText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  printStatusBanner: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#F3E5F5',
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
  },
  printStatusText: {
    ...Typography.caption,
    fontWeight: '600',
    color: '#6A1B9A',
  },
  actionsFooter: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  printerRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  printBtn: {
    flex: 2,
  },
  shareBtn: {
    flex: 1,
    backgroundColor: '#F0F0F0',
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shareBtnText: {
    ...Typography.bodyMedium,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  newOrderBtn: {
    marginTop: 4,
  },
});

export default ReceiptModal;
