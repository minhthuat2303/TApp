// T_SHOP Mobile - Native Barcode & QR Code Scanner Modal
// Powered by expo-camera (CameraView) with manual keyboard / USB OTG scanner fallback
// Features: Debounce cooldown, laser viewfinder animation, permission recovery, local product lookup

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import productRepository from '../../repository/ProductRepository';
import { Product } from '../../types/domain';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, BorderRadius, TypographyTokens } from '../../constants/layout';

export interface BarcodeScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScanBarcode?: (barcode: string) => Promise<{ success: boolean; message: string }>;
  onProductScanned?: (product: Product) => void;
  title?: string;
  subtitle?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCAN_BOX_SIZE = Math.min(SCREEN_WIDTH * 0.72, 280);

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  visible,
  onClose,
  onScanBarcode,
  onProductScanned,
  title = 'Quét mã vạch sản phẩm',
  subtitle = 'Đặt mã vạch hoặc mã QR vào khung ngắm',
}) => {
  const isWeb = Platform.OS === 'web';
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [lastScannedName, setLastScannedName] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(isWeb);

  // Scan cooldown lock
  const scanLockRef = useRef(false);
  const laserAnim = useRef(new Animated.Value(0)).current;

  // Animated laser line loop
  useEffect(() => {
    if (visible && !manualMode && permission?.granted) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(laserAnim, {
            toValue: 1,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(laserAnim, {
            toValue: 0,
            duration: 1800,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [visible, manualMode, permission?.granted]);

  // Reset states upon open/close
  useEffect(() => {
    if (visible) {
      setNotFoundCode(null);
      setLastScannedName(null);
      setManualCode('');
      scanLockRef.current = false;
    }
  }, [visible]);

  // Lookup product in local SQLite
  const handleCodeLookup = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || searching) return;

    setSearching(true);
    setNotFoundCode(null);

    try {
      if (onScanBarcode) {
        const res = await onScanBarcode(code);
        if (res.success) {
          setLastScannedName(res.message);
          setManualCode('');
        } else {
          setNotFoundCode(code);
        }
      } else if (onProductScanned) {
        const found = await productRepository.getByBarcode(code);
        if (found) {
          setLastScannedName(found.name);
          onProductScanned(found);
          setManualCode('');
        } else {
          setNotFoundCode(code);
        }
      }
    } catch (err) {
      console.error('Barcode lookup failed:', err);
      setNotFoundCode(code);
    } finally {
      setSearching(false);
      // Unlock camera scan after cooldown
      setTimeout(() => {
        scanLockRef.current = false;
      }, 1200);
    }
  };

  // Camera barcode detection handler
  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (scanLockRef.current || searching) return;
    scanLockRef.current = true;
    handleCodeLookup(result.data);
  };

  const laserTranslateY = laserAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCAN_BOX_SIZE - 4],
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header Bar */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕ Đóng</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Text style={styles.headerSubtitle}>{subtitle}</Text>
          </View>
          <TouchableOpacity
            style={styles.modeToggleBtn}
            onPress={() => setManualMode(!manualMode)}
          >
            <Text style={styles.modeToggleText}>{manualMode ? '📷 Camera' : '⌨️ Nhập'}</Text>
          </TouchableOpacity>
        </View>

        {/* Status Banners */}
        {lastScannedName && (
          <View style={styles.successBanner}>
            <Text style={styles.successBannerIcon}>✅</Text>
            <Text style={styles.successBannerText}>{lastScannedName}</Text>
          </View>
        )}

        {notFoundCode && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningBannerIcon}>⚠️</Text>
            <Text style={styles.warningBannerText}>
              Không tìm thấy sản phẩm với mã: <Text style={styles.boldText}>{notFoundCode}</Text>
            </Text>
          </View>
        )}

        {/* View Content: Manual Keyboard or Native Camera */}
        {manualMode ? (
          <View style={styles.manualContainer}>
            <Text style={styles.manualTitle}>Nhập mã thủ công</Text>
            <Text style={styles.manualDesc}>
              Nhập mã SKU, Barcode EAN-13 hoặc sử dụng đầu đọc mã vạch cắm ngoài (USB OTG / Bluetooth Wedge).
            </Text>

            {isWeb && (
              <View style={{ backgroundColor: '#1E293B', padding: 12, borderRadius: 8, marginBottom: 14, borderWidth: 1, borderColor: '#3B82F6' }}>
                <Text style={{ color: '#60A5FA', fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                  🌐 WEB DEMO — MÔ PHỎNG QUÉT MÃ VẠCH SẢN PHẨM
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, marginBottom: 8 }}>
                  Nhấp vào mã sản phẩm bên dưới để mô phỏng quét mã vạch và thêm vào giỏ:
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {['GB-CAPY-01', 'GB-CAPY-02', 'GB-TEDDY-01', 'LG-CITY-01', 'RC-CAR-01', 'RC-DRONE-01'].map(sku => (
                    <TouchableOpacity
                      key={sku}
                      style={{ backgroundColor: '#334155', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#475569' }}
                      onPress={() => {
                        setManualCode(sku);
                        handleCodeLookup(sku);
                      }}
                    >
                      <Text style={{ color: '#F8FAFC', fontSize: 11, fontWeight: '700' }}>⚡ {sku}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.inputRow}>
              <TextInput
                style={styles.manualInput}
                placeholder="VD: TOY-001, 89350018..."
                placeholderTextColor="#94A3B8"
                value={manualCode}
                onChangeText={setManualCode}
                autoFocus={true}
                returnKeyType="search"
                onSubmitEditing={() => handleCodeLookup(manualCode)}
              />
              <TouchableOpacity
                style={[styles.searchBtn, (!manualCode.trim() || searching) && styles.searchBtnDisabled]}
                onPress={() => handleCodeLookup(manualCode)}
                disabled={!manualCode.trim() || searching}
              >
                {searching ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.searchBtnText}>Tìm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : !permission ? (
          <View style={styles.permissionContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.permissionDesc}>Đang kiểm tra quyền truy cập máy ảnh...</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.permissionContainer}>
            <Text style={styles.permissionIcon}>📷</Text>
            <Text style={styles.permissionTitle}>Cần quyền truy cập Camera</Text>
            <Text style={styles.permissionDesc}>
              T_SHOP cần quyền sử dụng camera để quét mã vạch sản phẩm khi tính tiền hoặc kiểm kê kho hàng.
            </Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Cấp quyền Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.switchManualBtn}
              onPress={() => setManualMode(true)}
            >
              <Text style={styles.switchManualText}>Nhập mã SKU bằng tay ⌨️</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.cameraWrapper}>
            <CameraView
              style={styles.cameraAbsolute}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
              }}
              onBarcodeScanned={handleBarcodeScanned}
            />

            {/* Dark Mask with Transparent Viewfinder Cutout */}
            <View style={styles.overlay}>
              <View style={styles.overlayTop} />
              <View style={styles.overlayCenterRow}>
                <View style={styles.overlaySide} />
                <View style={styles.viewfinder}>
                  {/* Four Corner Reticles */}
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />

                  {/* Animated Laser Scan Line */}
                  <Animated.View
                    style={[
                      styles.laserLine,
                      { transform: [{ translateY: laserTranslateY }] },
                    ]}
                  />

                  {searching && (
                    <View style={styles.searchingOverlay}>
                      <ActivityIndicator size="large" color={Colors.primary} />
                      <Text style={styles.searchingText}>Đang tra cứu...</Text>
                    </View>
                  )}
                </View>
                <View style={styles.overlaySide} />
              </View>
              <View style={styles.overlayBottom}>
                <Text style={styles.hintText}>Hỗ trợ EAN-13, Code-128, QR Code</Text>
                <TouchableOpacity
                  style={styles.bottomManualBtn}
                  onPress={() => setManualMode(true)}
                >
                  <Text style={styles.bottomManualText}>⌨️ Nhập mã bằng bàn phím</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: Spacing.md,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: '#334155',
  },
  closeBtnText: {
    color: '#F8FAFC',
    fontWeight: '600',
    fontSize: TypographyTokens.fontSize.sm,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: TypographyTokens.fontSize.lg,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: TypographyTokens.fontSize.xs,
    marginTop: 2,
  },
  modeToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  modeToggleText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: TypographyTokens.fontSize.sm,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
  },
  successBannerIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  successBannerText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: TypographyTokens.fontSize.md,
    flex: 1,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
  },
  warningBannerIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  warningBannerText: {
    color: '#FFFFFF',
    fontSize: TypographyTokens.fontSize.sm,
    flex: 1,
  },
  boldText: {
    fontWeight: 'bold',
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  cameraAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  overlayCenterRow: {
    flexDirection: 'row',
    height: SCAN_BOX_SIZE,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  viewfinder: {
    width: SCAN_BOX_SIZE,
    height: SCAN_BOX_SIZE,
    position: 'relative',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#38BDF8',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  laserLine: {
    width: '100%',
    height: 2,
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  searchingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchingText: {
    color: '#F8FAFC',
    marginTop: 8,
    fontSize: TypographyTokens.fontSize.sm,
  },
  overlayBottom: {
    flex: 1.2,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  hintText: {
    color: '#94A3B8',
    fontSize: TypographyTokens.fontSize.sm,
    marginBottom: Spacing.md,
  },
  bottomManualBtn: {
    backgroundColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: BorderRadius.full,
  },
  bottomManualText: {
    color: '#F8FAFC',
    fontWeight: '600',
    fontSize: TypographyTokens.fontSize.md,
  },
  manualContainer: {
    flex: 1,
    padding: Spacing.lg,
    backgroundColor: '#0F172A',
  },
  manualTitle: {
    color: '#F8FAFC',
    fontSize: TypographyTokens.fontSize.xl,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  manualDesc: {
    color: '#94A3B8',
    fontSize: TypographyTokens.fontSize.sm,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  manualInput: {
    flex: 1,
    height: 48,
    backgroundColor: '#1E293B',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: Spacing.md,
    color: '#F8FAFC',
    fontSize: TypographyTokens.fontSize.lg,
    fontWeight: '600',
    marginRight: 10,
  },
  searchBtn: {
    height: 48,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnDisabled: {
    opacity: 0.5,
  },
  searchBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: TypographyTokens.fontSize.md,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  permissionIcon: {
    fontSize: 56,
    marginBottom: Spacing.md,
  },
  permissionTitle: {
    color: '#F8FAFC',
    fontSize: TypographyTokens.fontSize.xxl,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionDesc: {
    color: '#94A3B8',
    fontSize: TypographyTokens.fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  permissionBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: TypographyTokens.fontSize.md,
  },
  switchManualBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  switchManualText: {
    color: '#38BDF8',
    fontSize: TypographyTokens.fontSize.md,
  },
});

export default BarcodeScannerModal;
