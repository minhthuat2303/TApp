# T_SHOP — PHASE 09 BARCODE REPORT
# BARCODE / QR CODE SCANNER TECHNICAL ARCHITECTURE

============================================================
**Project:** T_SHOP  
**Topic:** Camera Scanner, Barcode Formats, Cooldown & Wedge Integration  
**Date:** September 10, 2026  
============================================================

## 1. Native Camera Engine Specification

T_SHOP mobile utilizes `expo-camera@~57.0.4` with the modern `CameraView` component on Expo SDK 57.

```tsx
<CameraView
  style={styles.cameraAbsolute}
  facing="back"
  barcodeScannerSettings={{
    barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
  }}
  onBarcodeScanned={handleBarcodeScanned}
/>
```

### Supported Barcode Formats
1. **EAN-13**: Standard retail international barcodes printed on retail toy boxes in Vietnam (prefix 893...).
2. **EAN-8**: Shortened packaging barcode format for small toys and figurines.
3. **Code-128**: High-density alphanumeric barcode standard used for internal warehouse SKUs and lot labels.
4. **Code-39**: Legacy industrial barcode standard.
5. **QR Code**: 2D matrix barcode format for payment URLs, serial numbers, and complex payload encoding.
6. **UPC-A / UPC-E**: North American toy import retail formats.

---

## 2. Duplicate Scan Protection (Spam Cooldown)

Camera frame rates typically evaluate 30–60 frames per second. If a user holds a toy package in front of the lens, the native detector triggers callbacks multiple times within 100 milliseconds.

To prevent erratic cart increments:
1. **Lock Ref**: A synchronous `scanLockRef = useRef(false)` immediately halts subsequent frame events before any React re-render.
2. **Lookup Execution**: The barcode is queried against local SQLite.
3. **Cooldown Window**: An asynchronous `setTimeout(..., 1200)` unlocks the scanner only after 1.2 seconds, giving visual feedback to the cashier (`✅ Đã thêm: [Tên sản phẩm] (+1)`).

---

## 3. Camera Permissions & Lifecycle Safety

### Permission States Handled:
- **`undetermined`**: Displays an intuitive prompt explaining why camera access is required.
- **`granted`**: Unlocks camera view with animated red laser line viewfinder.
- **`denied` / `blocked`**: Renders clear instructions to enable camera in OS settings, accompanied by a direct button to switch to **Manual / USB OTG Scanner Mode**.

### Battery & Resource Lifecycle Safety:
When `BarcodeScannerModal` is unmounted or `visible === false`, the camera viewfinder is completely removed from the view hierarchy. This releases camera hardware handles and prevents background battery drain.

---

## 4. Hardware Scanner / USB OTG Wedge Compatibility

For high-volume retail checkouts, handheld Bluetooth or USB OTG barcode scanner guns behave as HID (Human Interface Device) keyboards:
- In `Manual Mode`, the `TextInput` captures incoming keystrokes terminated by an `Enter` / `Return` key.
- `onSubmitEditing` immediately executes product lookup in SQLite, allowing cashier scanning at sub-50ms speeds without aiming a phone camera.
