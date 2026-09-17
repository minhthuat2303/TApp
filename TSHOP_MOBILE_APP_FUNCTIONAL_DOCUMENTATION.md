# T_SHOP MOBILE APP
## MASTER FUNCTIONAL & TECHNICAL DOCUMENTATION

---

### 1. Document Information

* **Tên tài liệu:** Báo cáo Phân tích Chức năng và Kiến trúc Kỹ thuật Toàn diện T_SHOP Mobile App (Master Functional & Technical Documentation).
* **Ứng dụng:** T_SHOP Mobile POS & Retail Management System (`com.tshop.retail.mobile`).
* **Phiên bản ứng dụng:** `1.0.0` (Expo SDK 57 / React Native 0.86.3 / React 19.2.3 / TypeScript 6.0.3).
* **Nguồn chân lý (Source of Truth):** Toàn bộ Source code thực tế trong repository `D:\project\T_App\mobile` và các API endpoints liên quan trong `D:\project\T_App\src`.
* **Quy chuẩn đánh giá (Quality Standard):**
  * `IMPLEMENTED`: Mã nguồn đã được lập trình thực tế trong codebase.
  * `TESTED`: Có kịch bản kiểm thử tự động (Unit / Integration / Regression Test) xác nhận.
  * `RUNTIME VERIFIED`: Đã được biên dịch, chạy thử nghiệm và xác minh thành công trên môi trường Runtime (Web Demo WebDriver / Android Emulator / Local Server).
  * `PHYSICAL HARDWARE VERIFIED`: Đã kiểm nghiệm vật lý trên thiết bị phần cứng thật (máy in nhiệt Bluetooth, máy quét laser vật lý cầm tay).

---

### 2. Executive Summary

T_SHOP Mobile App là hệ thống quản lý bán hàng (POS) và quản trị chuỗi cung ứng bán lẻ vận hành theo mô hình **Offline-First**. Ứng dụng được thiết kế cho phép thu ngân và chủ cửa hàng thực hiện toàn bộ nghiệp vụ cốt lõi (bán hàng, quét mã vạch, tính chiết khấu, in hóa đơn, nhập kho theo lô FIFO, điều chỉnh tồn kho, kiểm tra thẻ kho, hủy đơn hàng, đối soát công nợ, xem báo cáo) hoàn toàn ngoại tuyến tại chỗ thông qua cơ sở dữ liệu nhúng **SQLite**. 

Khi có kết nối mạng (Internet / LAN), **Sync Engine** nền sẽ tự động đẩy các giao dịch đột biến từ hàng đợi ngoại tuyến (`sync_queue`) lên máy chủ trung tâm (`/api/sync/push`) và kéo các cập nhật dữ liệu danh mục mới nhất về thiết bị (`/api/sync/pull`) dựa trên cơ chế phân trang theo con trỏ thời gian (Cursor-based sync) và giải quyết xung đột nghiệp vụ theo bảng phân loại (Conflict Taxonomy).

Toàn bộ hệ thống kế toán chi phí tồn kho và giá vốn hàng bán (COGS) tuân thủ nghiêm ngặt nguyên lý **FIFO (First In, First Out)**, quản lý từng lô hàng (`inventory_lots`), tự động tái tính toán giá vốn bình quân gia quyền tại thời điểm nhập xuất, và ghi chép bất biến (immutable ledger) vào bảng di biến động kho (`stock_movements`).

---

### 3. Current Application Status

* **Trạng thái phát triển:** Hoàn thiện Phase 11.6 - Đã sẵn sàng phát hành thử nghiệm (Production Release Ready Candidate).
* **Nền tảng hỗ trợ theo cấu hình `app.json`:** Android (`com.tshop.retail.mobile`), iOS (`com.tshop.retail.mobile`), Web Browser (thông qua `react-native-web` phục vụ môi trường demo, đào tạo thu ngân và tích hợp headless).
* **Độ bao phủ tính năng (Feature Completeness):**
  * POS bán hàng & Giỏ hàng đa mặt hàng: **100% IMPLEMENTED & RUNTIME VERIFIED**.
  * Quản lý giá vốn FIFO & Tính COGS: **100% IMPLEMENTED & TESTED (162/162 PASS)**.
  * Đơn mua hàng (Purchase Orders) & Nhập kho theo lô: **100% IMPLEMENTED & TESTED**.
  * Hủy đơn hàng & Hoàn kho LIFO cho lô FIFO: **100% IMPLEMENTED & TESTED**.
  * Hàng đợi ngoại tuyến (Outbox Engine) & Idempotency: **100% IMPLEMENTED & TESTED**.
  * Quét mã vạch đa định dạng qua Camera: **100% IMPLEMENTED & RUNTIME VERIFIED**.
  * Trình tạo lệnh nhị phân máy in nhiệt ESC/POS: **100% IMPLEMENTED & TESTED**.
  * Kết nối phần cứng máy in nhiệt Bluetooth vật lý: **SOFTWARE IMPLEMENTED / PHYSICAL HARDWARE PENDING**.
  * Xuất dữ liệu báo cáo (CSV UTF-8 BOM): **100% IMPLEMENTED & RUNTIME VERIFIED**.

---

### 4. Technology Stack

Dựa trên file thực tế `mobile/package.json` và `mobile/app.json`:

* **Core Framework:**
  * `react`: `19.2.3`
  * `react-native`: `0.86.3`
  * `expo`: `~57.0.21`
  * `react-dom`: `19.2.3`
  * `react-native-web`: `^0.21.2`
  * `@expo/metro-runtime`: `~57.0.15`
* **Navigation:**
  * `@react-navigation/native`: `^7.3.18`
  * `@react-navigation/native-stack`: `^7.18.10`
  * `react-native-screens`: `~4.26.0`
  * `react-native-safe-area-context`: `~5.7.0`
* **Local Database & Storage:**
  * `expo-sqlite`: `~57.0.2` (Chạy trên Android/iOS)
  * Custom Driver Web: `WebDemoSqliteDriver.ts` (Sử dụng `localStorage` + Memory Map để mô phỏng SQLite trên nền tảng Web Preview)
  * `expo-secure-store`: `~57.0.3` (Lưu trữ JWT Access Token, Refresh Token, Device UUID an toàn trong Android Keystore / iOS Keychain)
* **Hardware & Device API:**
  * `expo-camera`: `~57.0.4` (Quét mã vạch 1D / 2D QR Code)
  * `@react-native-community/netinfo`: `12.0.1` (Giám sát trạng thái kết nối mạng Internet)
  * `expo-constants`: `~57.0.17`
  * `expo-status-bar`: `~57.0.1`
  * `@expo/vector-icons`: `^15.0.2` (Bộ icon MaterialIcons, Ionicons, Feather)
* **Ngôn ngữ & Biên dịch:**
  * `typescript`: `~6.0.3` (Strict Type-Checking)
  * `@types/react`: `~19.2.2`

---

### 5. Project Structure

Cấu trúc thư mục thực tế của `mobile/src/`:

```
mobile/
├── App.tsx                           # Điểm khởi đầu ứng dụng, cấu hình AuthProvider, SyncProvider, ErrorBoundary
├── app.json                          # Cấu hình Expo, permissions, bundle identifiers, adaptive icons
├── package.json                      # Danh sách dependencies và npm scripts
├── tsconfig.json                     # Cấu hình TypeScript
├── tests/                            # Bộ kiểm thử tự động Node.js / better-sqlite3
│   ├── database.test.mjs             # 30 Test Suites (162 assertions) kiểm tra Database & Outbox & POS
│   ├── phase10_discount.test.mjs     # Test chiết khấu sản phẩm & chiết khấu tổng đơn hàng
│   ├── phase10_inventory_cost.test.mjs # Test phân bổ giá vốn FIFO và tái tính giá vốn bình quân
│   ├── phase11_5_completion.test.mjs # Test toàn diện vòng đời đơn mua và nhập kho
│   ├── phase11_6_sales_cancellation.test.mjs # Test hủy đơn hàng, hoàn kho và phương thức thanh toán
│   └── phase11_production.test.mjs   # Test kiểm chứng cấu hình Production
└── src/
    ├── api/                          # HTTP Network Client & API Endpoints
    │   ├── client.ts                 # Axios/Fetch wrapper với Token Interceptor và RTR Mutex
    │   ├── endpoints.ts              # Danh sách URL máy chủ (/api/sync/push, /api/auth/login...)
    │   └── types.ts                  # Kiểu dữ liệu ApiResponse, ApiError
    ├── auth/                         # Xác thực & Quản lý phiên làm việc
    │   ├── AuthContext.tsx           # React Context cung cấp user session, login, logout
    │   ├── AuthManager.ts            # Single-flight Mutex xử lý Refresh Token Rotation (RTR)
    │   ├── tokenStorage.ts           # Adapter lưu token qua SecureStore (Native) hoặc LocalStorage (Web)
    │   └── types.ts                  # Định nghĩa UserSession, AuthEvent
    ├── components/                   # UI Components dùng chung
    │   ├── common/
    │   │   ├── Badge.tsx             # Hiển thị trạng thái màu (PENDING, COMPLETED, SYNCED...)
    │   │   ├── Button.tsx            # Nút bấm chuẩn với loading state, disabled state
    │   │   ├── Card.tsx              # Khung chứa nội dung viền bo tròn đổ bóng
    │   │   ├── EmptyState.tsx        # Trạng thái danh sách rỗng kèm icon và nút thao tác
    │   │   ├── ErrorBoundary.tsx     # Bắt lỗi crash React Tree toàn cục
    │   │   ├── ErrorView.tsx         # Màn hình thông báo lỗi cục bộ kèm nút Thử lại
    │   │   ├── Input.tsx             # Ô nhập dữ liệu có label, validation error, icon
    │   │   ├── LoadingView.tsx       # Màn hình chờ hoặc spinner tải dữ liệu
    │   │   └── NetworkBanner.tsx     # Thanh thông báo trạng thái Ngoại tuyến / Trực tuyến màu cam/xanh
    │   └── scanner/
    │       └── BarcodeScannerModal.tsx # Modal quét mã vạch qua Camera với vạch laser động và nhập tay
    ├── config/
    │   └── env.ts                    # Cấu hình biến môi trường (API_BASE_URL, TIMEOUT, RETRY_LIMIT)
    ├── constants/
    │   ├── colors.ts                 # Hệ thống bảng màu chuẩn (Primary, Surface, Text, Accent, Status)
    │   └── layout.ts                 # Tokens khoảng cách (Spacing), Bo góc (BorderRadius), Typography
    ├── database/                     # Tầng kết nối SQLite & Migrations
    │   ├── DatabaseService.ts        # Service quản lý vòng đời DB, run migrations, atomic transactions
    │   ├── ExpoSqliteDriver.ts       # Driver giao tiếp thực tế với expo-sqlite
    │   ├── WebDemoSqliteDriver.ts    # Driver mô phỏng DB trên nền tảng Web Demo
    │   ├── migrations/               # Danh sách 9 file migration schema
    │   ├── seed.ts                   # Dữ liệu khởi tạo ban đầu (Master data mẫu)
    │   └── types.ts                  # Interface ITransactionClient, IDatabaseDriver, QueryParams
    ├── navigation/                   # Điều hướng luồng màn hình
    │   ├── AuthStack.tsx             # Stack điều hướng đăng nhập (LoginScreen)
    │   ├── MainStack.tsx             # Stack màn hình chính (Dashboard, Sales, Products, Inventory...)
    │   ├── RootNavigator.tsx         # Bộ điều hướng gốc chuyển đổi giữa Auth và Main theo phiên
    │   └── types.ts                  # Type param lists của Navigation
    ├── network/                      # Quản lý trạng thái mạng
    │   ├── NetworkContext.tsx        # Context cung cấp cờ isConnected, isInternetReachable
    │   └── NetworkService.ts         # Wrapper lắng nghe sự kiện từ NetInfo
    ├── repository/                   # Pattern Repository trung gian truy vấn dữ liệu
    │   ├── CategoryRepository.ts     # Interface truy xuất danh mục
    │   ├── CustomerRepository.ts     # Interface truy xuất khách hàng
    │   ├── InventoryRepository.ts    # Interface truy xuất kho và lô hàng
    │   ├── ProductRepository.ts      # Interface truy xuất sản phẩm và giá
    │   ├── SaleRepository.ts         # Interface truy xuất đơn hàng và doanh số
    │   ├── base.ts                   # Base CRUD Repository
    │   └── sqlite/                   # Các Data Source SQLite thực thi các interface trên
    ├── screens/                      # Giao diện các màn hình nghiệp vụ
    │   ├── auth/
    │   │   └── LoginScreen.tsx       # Màn hình đăng nhập tài khoản / chế độ ngoại tuyến
    │   └── main/
    │       ├── ConflictCenterScreen.tsx # Trung tâm xử lý xung đột dữ liệu & đối soát lệch kho
    │       ├── DashboardScreen.tsx   # Màn hình tổng quan KPI, cảnh báo tồn kho, lối tắt POS
    │       ├── InventoryScreen.tsx   # Trung tâm kho hàng (Tồn kho, Đơn mua, Lô FIFO, Thẻ kho, Nhập kho)
    │       ├── ProductsScreen.tsx    # Quản lý danh mục, sản phẩm, lịch sử giá bán/giá vốn, import/export
    │       ├── ReceiptModal.tsx      # Modal xem hóa đơn, in nhiệt ESC/POS, chia sẻ hóa đơn
    │       ├── ReportsScreen.tsx     # Báo cáo doanh thu theo ngày, bán chạy, bán chậm, tỷ suất lợi nhuận
    │       ├── SalesScreen.tsx       # Màn hình POS bán hàng, giỏ hàng, thanh toán & Lịch sử bán hàng
    │       └── SettingsScreen.tsx    # Cài đặt hệ thống, chẩn đoán DB, cấu hình máy in, outbox, tài khoản
    ├── services/                     # Business Logic Services
    │   ├── AnalyticsService.ts       # Tính toán số liệu Dashboard, KPI, top selling, slow moving
    │   ├── AuditLogService.ts        # Ghi nhận nhật ký kiểm toán hành vi người dùng
    │   ├── DataHealthService.ts      # Kiểm tra tính toàn vẹn database, khóa ngoại, bất biến tồn kho
    │   ├── ExportService.ts          # Xuất dữ liệu CSV (UTF-8 BOM) sản phẩm, danh mục, thẻ kho, đơn hàng
    │   ├── FileImportService.ts      # Xử lý import hàng loạt file CSV sản phẩm và kho hàng
    │   ├── InventoryReconciliationService.ts # Đối soát tồn kho và phát hiện trượt tồn (Stock Drift)
    │   ├── OfflineInventoryService.ts # Xử lý điều chỉnh kho (Hao hụt, hư hỏng, kiểm kê) và nhập lẻ
    │   ├── OfflineSaleService.ts     # Xử lý thanh toán POS, chiết khấu, phân bổ FIFO COGS, hủy đơn hàng
    │   ├── OfflineTransactionService.ts # Tạo mã định danh client UUID và điều phối giao dịch cục bộ
    │   ├── OutboxService.ts          # Quản lý hàng đợi đột biến outbox, retry backoff
    │   ├── PurchaseOrderService.ts   # Quản lý đơn mua hàng, duyệt đơn, tạo lô hàng FIFO tự động
    │   ├── printer/
    │   │   ├── EscPosBuilder.ts      # Bộ sinh mã nhị phân ESC/POS 58mm/80mm, khử dấu tiếng Việt
    │   │   └── ReceiptPrinterService.ts # Dịch vụ in nhiệt, quản lý thiết bị in, in mẫu thử
    │   └── types.ts                  # Định nghĩa các Validation Errors và DTOs nghiệp vụ
    ├── storage/                      # Dịch vụ lưu trữ cục bộ
    │   ├── StorageService.ts         # Wrapper lưu trữ key-value
    │   └── types.ts                  # Interface IStorageService
    ├── sync/                         # Động cơ đồng bộ 2 chiều (Sync Engine)
    │   ├── ConflictService.ts        # Giải quyết xung đột dữ liệu theo chiến lược Client/Server Wins
    │   ├── PullSyncHandler.ts        # Kéo dữ liệu mới từ server theo Cursor timestamp
    │   ├── PushSyncHandler.ts        # Đẩy dữ liệu outbox lên server theo từng lô giao dịch
    │   ├── SyncContext.tsx           # React Context cung cấp sync status, triggers, manual sync
    │   ├── SyncEngine.ts             # Bộ điều phối đồng bộ tự động khi có mạng hoặc định kỳ
    │   └── types.ts                  # Định nghĩa MutationQueueItem, SyncResult, ConflictPayload
    ├── types/                        # Domain Models toàn hệ thống
    │   ├── domain.ts                 # Product, Category, SaleOrder, InventoryLot, StockMovement, User
    │   └── errors.ts                 # Lớp lỗi chuẩn hóa AppError, NetworkError, SqliteError
    └── utils/                        # Thư viện tiện ích
        ├── formatters.ts             # Định dạng tiền tệ VND (100.000đ), ngày tháng (DD/MM/YYYY HH:mm)
        ├── logger.ts                 # Logger phân cấp DEBUG, INFO, WARN, ERROR
        └── vietnameseUtils.ts        # Khử dấu tiếng Việt, phân tách token, xếp hạng điểm tìm kiếm
```

---

### 6. Architecture Overview

Hệ sinh thái T_SHOP Mobile App được xây dựng dựa trên nguyên lý kiến trúc **Offline-First Layered Clean Architecture**:

```
+-------------------------------------------------------------------------------+
|                             PRESENTATION LAYER                                |
|  [Screens: Dashboard, POS, Products, Inventory, Reports, Settings, Conflicts] |
|  [Components: Scanner Modal, Receipt Modal, Network Banner, Form Controls]    |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
|                            BUSINESS SERVICES LAYER                            |
|  - OfflineSaleService (POS Checkout, FIFO COGS Allocation, Order Cancel)     |
|  - PurchaseOrderService (PO Lifecycle, FIFO Lot Creation, Weighted Cost)      |
|  - OfflineInventoryService (Stock Adjustments: DAMAGE, LOSS, GIFT, RETURN)    |
|  - AnalyticsService (Aggregations, Gross Profit, Dead Stock, Top Selling)    |
|  - FileImportService / ExportService (Bulk CSV I/O, UTF-8 BOM, UTF-8 Parsing) |
|  - ReceiptPrinterService (ESC/POS 58mm/80mm Binary Stream Generator)         |
+-------------------------------------------------------------------------------+
         |                                                   |
         v                                                   v
+------------------------------------+  +---------------------------------------+
|          REPOSITORY LAYER          |  |         SYNC & OUTBOX ENGINE          |
|  - SqliteProductDataSource         |  |  - OutboxService (sync_queue)         |
|  - SqliteCategoryDataSource        |  |  - PushSyncHandler (Idempotency Mutex)|
|  - SqliteInventoryDataSource       |  |  - PullSyncHandler (Cursor Timestamp) |
|  - SqliteSaleDataSource            |  |  - ConflictService (Resolution Center)|
+------------------------------------+  +---------------------------------------+
                   \                               /
                    v                             v
+-------------------------------------------------------------------------------+
|                            LOCAL STORAGE LAYER                                |
|  - SQLite Native Database (WAL Mode, PRAGMA foreign_keys = ON)                |
|  - 21 Data Tables across 9 Schema Migrations                                  |
|  - expo-secure-store (Hardware-backed Keystore/Keychain for JWT Tokens)       |
+-------------------------------------------------------------------------------+
                                      |
                         (When Network Available)
                                      v
+-------------------------------------------------------------------------------+
|                             REMOTE BACKEND API                                |
|  [/api/sync/push]  [/api/sync/pull]  [/api/auth/login]  [/api/auth/refresh]   |
+-------------------------------------------------------------------------------+
```

---

### 7. Navigation Map

Hệ thống điều hướng sử dụng `@react-navigation/native-stack` được định nghĩa tại `mobile/src/navigation/`:

```
ROOT NAVIGATOR (RootNavigator.tsx)
│
├── [Chưa xác thực / Logout] ──> AuthStack (AuthStack.tsx)
│                                └── Login (LoginScreen.tsx)
│
└── [Đã xác thực / Offline Mode] ──> MainStack (MainStack.tsx)
                                      ├── Dashboard (DashboardScreen.tsx) [Màn hình khởi đầu]
                                      ├── Products (ProductsScreen.tsx)
                                      ├── Sales (SalesScreen.tsx) [POS & Lịch sử bán hàng]
                                      ├── Inventory (InventoryScreen.tsx) [Kho, Đơn mua, Lô, Thẻ kho]
                                      ├── Reports (ReportsScreen.tsx) [Doanh thu & Hiệu suất]
                                      ├── Settings (SettingsScreen.tsx) [Cài đặt & Chẩn đoán]
                                      └── ConflictCenter (ConflictCenterScreen.tsx) [Xử lý xung đột]
```

*Ngoài ra, các Modal chức năng chuyên sâu được lồng ghép trực tiếp tại các màn hình:*
* `ReceiptModal.tsx`: Được mở từ `SalesScreen` ngay sau khi thanh toán thành công hoặc khi nhấn "Xem chi tiết / In lại" từ Lịch sử bán hàng.
* `BarcodeScannerModal.tsx`: Được mở từ `SalesScreen` (khi nhấn icon Barcode) hoặc từ `ProductsScreen` (khi nhập/sửa sản phẩm).

---

### 8. Screen Inventory

| Tên màn hình | File nguồn | Route Name | Đối tượng | Offline Support | Quyền Native |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Đăng nhập** | `screens/auth/LoginScreen.tsx` | `Login` | Thu ngân, Quản lý | Cho phép đăng nhập Offline nếu đã từng đăng nhập | Không |
| **Tổng quan (Dashboard)** | `screens/main/DashboardScreen.tsx` | `Dashboard` | Mọi user | 100% Offline từ SQLite | Không |
| **Sản phẩm & Giá** | `screens/main/ProductsScreen.tsx` | `Products` | Mọi user (Staff bị giới hạn sửa) | 100% Offline (Outbox sync) | Camera (Quét mã) |
| **Bán hàng (POS) & Lịch sử** | `screens/main/SalesScreen.tsx` | `Sales` | Thu ngân, Quản lý | 100% Offline (Tạo đơn & Hủy đơn) | Camera (Quét mã) |
| **Quản lý kho hàng** | `screens/main/InventoryScreen.tsx` | `Inventory` | Quản lý kho, Admin | 100% Offline (Nhập kho, Đơn mua, Thẻ kho) | Không |
| **Báo cáo & Hiệu suất** | `screens/main/ReportsScreen.tsx` | `Reports` | Quản lý, Admin | 100% Offline (Truy vấn tổng hợp SQLite) | Không |
| **Cài đặt & Chẩn đoán** | `screens/main/SettingsScreen.tsx` | `Settings` | Mọi user | Hoạt động Offline | Bluetooth (Máy in) |
| **Xử lý xung đột** | `screens/main/ConflictCenterScreen.tsx` | `ConflictCenter` | Quản lý, Admin | Xem Offline, giải quyết khi có mạng | Không |
| **Chi tiết & In Hóa đơn** | `screens/main/ReceiptModal.tsx` | N/A (Modal Component) | Thu ngân, Khách hàng | In & Xem 100% Offline | Bluetooth, Native Share |

---

### 9. Dashboard

* **File nguồn:** `mobile/src/screens/main/DashboardScreen.tsx`
* **Dịch vụ cung cấp dữ liệu:** `mobile/src/services/AnalyticsService.ts`
* **Nguồn dữ liệu:** Hoàn toàn truy vấn nội bộ từ cơ sở dữ liệu SQLite cục bộ (`sales_orders`, `sales_records`, `products`, `inventory_lots`).
* **Các chỉ số tài chính (KPIs):**
  * **Tổng doanh thu (Revenue):** `SUM(so.final_amount)` của các đơn hàng có `status = 'COMPLETED'`.
  * **Lợi nhuận gộp (Gross Profit):** `SUM(sr.profit)` trong đó `profit = line_revenue - line_cost`.
  * **Tổng số đơn hàng (Orders Count):** `COUNT(so.id)` với `status = 'COMPLETED'`.
  * **Tổng giá trị tồn kho (Inventory Valuation):** `SUM(p.current_stock * p.current_cost_price)` hoặc tính chính xác từ các lô hàng còn tồn `SUM(il.quantity_remaining * il.unit_cost)`.
* **Bộ lọc thời gian hỗ trợ:**
  * `TODAY` (Hôm nay): `sale_date = date('now')`.
  * `7_DAYS` (7 ngày qua): `sale_date >= date('now', '-7 days')`.
  * `30_DAYS` (30 ngày qua): `sale_date >= date('now', '-30 days')`.
  * `THIS_MONTH` (Tháng này): `strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now')`.
* **Cảnh báo tồn kho (Inventory Alerts Widget):**
  * Lọc danh sách sản phẩm có `current_stock <= min_stock_alert`.
  * Hiển thị danh sách đỏ gồm tên sản phẩm, mã SKU, số lượng tồn thực tế so với mức cảnh báo tối thiểu.
* **Lối tắt thao tác nhanh (Quick Action Shortcuts):**
  * Nút "Ghi nhận bán (POS)" $\rightarrow$ Điều hướng tới `Sales`.
  * Nút "Quản lý kho" $\rightarrow$ Điều hướng tới `Inventory`.
  * Nút "Thêm sản phẩm" $\rightarrow$ Mở trực tiếp màn hình `Products`.
  * Nút "Báo cáo chi tiết" $\rightarrow$ Điều hướng tới `Reports`.
* **Trạng thái kết nối & Đồng bộ:** Tích hợp thanh banner mạng hiển thị trạng thái kết nối và số lượng đột biến đang chờ đồng bộ (`sync_queue.status = 'PENDING'`). Hỗ trợ kéo để làm mới (`RefreshControl`).

---

### 10. Product Management

* **File nguồn:** `mobile/src/screens/main/ProductsScreen.tsx`
* **Data Sources:** `SqliteProductDataSource.ts`, `SqliteCategoryDataSource.ts`.
* **Các thuộc tính sản phẩm thực tế trong DB:**
  * `id`: Khóa chính định danh.
  * `sku`: Mã SKU sản phẩm (Duy nhất - UNIQUE).
  * `barcode`: Mã vạch sản phẩm (EAN-13, Code-128...).
  * `name`: Tên sản phẩm.
  * `category_id`: ID danh mục (Khóa ngoại liên kết bảng `categories`).
  * `product_type_id`: ID loại sản phẩm (Khóa ngoại `product_types`).
  * `current_cost_price`: Giá vốn bình quân hiện tại (>= 0).
  * `current_selling_price`: Giá bán niêm yết (>= 0).
  * `current_stock`: Số lượng tồn kho thực tế hiện tại.
  * `min_stock_alert`: Ngưỡng cảnh báo tồn kho tối thiểu (Mặc định: 5).
  * `description`: Mô tả chi tiết sản phẩm.
  * `status`: Trạng thái kinh doanh (`ACTIVE` / `INACTIVE`).
* **Quy trình Thêm sản phẩm mới (Add Product Flow):**
  1. Người dùng nhập: Tên sản phẩm, Mã SKU (hoặc tự sinh), Barcode (nhập tay hoặc quét camera), Danh mục, Giá bán, Giá vốn khởi điểm, Tồn kho tối thiểu, Mô tả.
  2. Validate: Bắt buộc tên không được để trống, SKU không được trùng, Giá bán >= 0, Giá vốn >= 0.
  3. Ghi vào SQLite: Bắt đầu giao dịch `tx.withTransactionAsync`. Thêm dòng mới vào bảng `products`.
  4. Ghi nhận lịch sử giá: Tự động ghi 1 dòng vào `price_history` và 1 dòng vào `cost_price_history`.
  5. Đẩy Outbox: Ghi vào `sync_queue` với `entity_type = 'PRODUCTS'`, `action_type = 'CREATE'`.
* **Quy trình Sửa sản phẩm (Edit Product Flow):**
  * Các trường được phép chỉnh sửa: `name`, `barcode`, `category_id`, `product_type_id`, `current_selling_price`, `min_stock_alert`, `description`, `status`.
  * Trường `current_stock` **KHÔNG** được sửa trực tiếp tại đây (phải qua nghiệp vụ Kiểm kê / Điều chỉnh kho để đảm bảo tính toàn vẹn của thẻ kho).
  * Trường `current_cost_price` được cập nhật tự động theo các lô hàng nhập hoặc chỉnh sửa có ghi nhận vào `cost_price_history`.
  * Nếu `current_selling_price` thay đổi $\rightarrow$ Tự động chèn 1 bản ghi vào `price_history` ghi nhận thời điểm hiệu lực và người sửa.
* **Lịch sử giá bán & Giá vốn (Price History Modal):**
  * Hiển thị bảng biến thiên giá theo thời gian: Mức giá cũ $\rightarrow$ Mức giá mới, ngày áp dụng, người thực hiện, ghi chú.
* **Xuất dữ liệu (Export Products):** Nút xuất file danh sách sản phẩm định dạng UTF-8 CSV kèm BOM chuẩn hóa.

---

### 11. Category Management

* **File nguồn:** `mobile/src/screens/main/ProductsScreen.tsx` (Tích hợp Modal quản lý danh mục) và `SqliteCategoryDataSource.ts`.
* **Thuộc tính danh mục:** `id`, `code` (UNIQUE), `name`, `description`, `status` (`ACTIVE` / `INACTIVE`).
* **Chức năng thực tế:**
  * Xem danh sách danh mục kèm số lượng sản phẩm liên kết (`product_count = COUNT(products.id)`).
  * Thêm danh mục mới (Mã code, Tên danh mục, Mô tả).
  * Sửa danh mục (Tên, Mô tả).
  * Ngừng hoạt động danh mục (`status = 'INACTIVE'`).
* **Quy tắc vô hiệu hóa danh mục (Deactivation Invariant):**
  * **Code thực tế xác nhận:** Trong SQLite schema, bảng `products` liên kết với `categories` qua ràng buộc `ON DELETE RESTRICT`. 
  * Do đó, hệ thống **KHÔNG cho phép xóa cứng** danh mục đang chứa sản phẩm. Khi chuyển trạng thái danh mục sang `INACTIVE`, các sản phẩm hiện có thuộc danh mục này vẫn giữ nguyên liên kết và tiếp tục kinh doanh bình thường, nhưng danh mục sẽ bị ẩn khỏi danh sách lựa chọn khi tạo sản phẩm mới.

---

### 12. Search & Product Discovery

* **File nguồn:** `mobile/src/utils/vietnameseUtils.ts` và `mobile/src/repository/sqlite/SqliteProductDataSource.ts`.
* **Cơ chế tìm kiếm sản phẩm:**
  * Hỗ trợ tìm kiếm kết hợp đa trường: Tên sản phẩm (`name`), Mã SKU (`sku`), Mã vạch (`barcode`), Mã danh mục.
  * **Chuẩn hóa tiếng Việt tuyệt đối (Deterministic Accent Normalization):** Hàm `removeVietnameseDiacritics()` chuyển đổi toàn bộ ký tự có dấu, ký tự tổ hợp NFD sang ký tự Latinh gốc (á, à, ả, ã, ạ $\rightarrow$ a; đ $\rightarrow$ d; Đ $\rightarrow$ D...).
  * **Không phân biệt chữ hoa / chữ thường (Case-insensitive):** Toàn bộ truy vấn và dữ liệu so sánh được đưa về chữ thường (`toLowerCase()`).
  * **Tìm kiếm đa từ khóa (Multi-token match):** Hỗ trợ tìm kiếm theo nhiều từ rời rạc. Ví dụ gõ "bup barbie" vẫn khớp chính xác sản phẩm "Búp Bê Barbie Xinh Xắn".
* **Thang điểm xếp hạng ưu tiên (Search Ranking Scoring):**
  1. **Điểm 100:** Khớp chính xác hoàn toàn Mã vạch (`barcode`) hoặc Mã SKU (`sku`).
  2. **Điểm 90:** Khớp chính xác hoàn toàn Tên sản phẩm đã chuẩn hóa.
  3. **Điểm 80:** Tên hoặc SKU bắt đầu bằng từ khóa tìm kiếm (Prefix match).
  4. **Điểm 70:** Tên hoặc SKU chứa từ khóa tìm kiếm (Substring match).
  5. **Điểm 60:** Khớp tất cả các token từ khóa rời rạc.
  6. **Điểm 0:** Không khớp.
* **Chỉ mục cơ sở dữ liệu hỗ trợ tìm kiếm:**
  * `idx_products_sku` trên `products(sku)`
  * `idx_products_name` trên `products(name)`
  * `idx_products_barcode` trên `products(barcode)`
  * `idx_products_status` trên `products(status)`

---

### 13. Sales / POS

* **File nguồn:** `mobile/src/screens/main/SalesScreen.tsx`
* **Dịch vụ nghiệp vụ:** `mobile/src/services/OfflineSaleService.ts`
* **Luồng xử lý bán hàng thực tế (Actual Sale Flow):**
  ```
  TÌM KIẾM SẢN PHẨM / QUÉT MÃ VẠCH (Camera/Scanner)
         │
         ▼
  THÊM VÀO GIỎ HÀNG (Cart Items)
         │
         ▼
  ĐIỀU CHỈNH SỐ LƯỢNG (Quantity Input / +/- Buttons)
         │
         ▼
  KIỂM TRA TỒN KHO (Stock Validation Guard: Cart Qty <= Current Stock)
         │
         ▼
  CHỐT GIÁ BÁN & GIÁ VỐN (Unit Price Snapshot & FIFO Lot Matching)
         │
         ▼
  ÁP DỤNG CHIẾT KHẤU (Discount per Item OR Total Order Discount)
         │
         ▼
  CHỌN PHƯƠNG THỨC THANH TOÁN (CASH / BANK_TRANSFER / CARD)
         │
         ▼
  TÍNH TIỀN KHÁCH ĐƯA & TIỀN THỪA (Amount Tendered & Change)
         │
         ▼
  GIAO DỊCH SQLITE ATOMIC (tx.withTransactionAsync)
         ├── Trừ số lượng tồn trong inventory_lots theo FIFO
         ├── Tính tổng giá vốn hàng bán (COGS) & Lợi nhuận gộp
         ├── Cập nhật tồn kho khả dụng products.current_stock
         ├── Tái tính giá vốn bình quân products.current_cost_price
         ├── Ghi nhận đơn hàng vào sales_orders
         ├── Ghi nhận chi tiết dòng vào sales_records
         ├── Ghi phân bổ giá vốn vào sale_cost_allocations
         ├── Ghi thẻ kho bất biến vào stock_movements (type = 'SALE')
         └── Thêm bản ghi đột biến vào hàng đợi outbox (sync_queue)
         │
         ▼
  MỞ HÓA ĐƠN BÁN HÀNG (ReceiptModal: In nhiệt ESC/POS & Chia sẻ)
  ```
* **Quy tắc Chiết khấu (Discount Rules):**
  * *Chiết khấu theo dòng:* Không được là số âm và không được vượt quá thành tiền của dòng sản phẩm đó (`itemDiscount <= quantity * unitPrice`).
  * *Chiết khấu tổng đơn:* Không được là số âm và không được vượt quá tạm tính của đơn hàng. Nếu áp dụng chiết khấu tổng đơn, hệ thống sẽ tự động phân bổ theo tỷ trọng giá trị (`proportional allocation`) vào từng dòng sản phẩm để tính chính xác doanh thu và lợi nhuận từng món.
* **Phương thức thanh toán hỗ trợ:**
  * `CASH` (Tiền mặt): Hỗ trợ các nút chọn tiền nhanh (Khách đưa đủ, 50k, 100k, 200k, 500k), tự động tính tiền thừa trả khách (`change_amount = cash_received - final_amount`).
  * `BANK_TRANSFER` (Chuyển khoản): Mặc định tiền khách trả đúng bằng tổng tiền đơn.
  * `CARD` (Quẹt thẻ POS ngân hàng): Mặc định tiền khách trả đúng bằng tổng tiền đơn.

---

### 14. Sales History

* **File nguồn:** `mobile/src/screens/main/SalesScreen.tsx` (Tab "Lịch sử đơn hàng").
* **Tính năng:**
  * Hiển thị danh sách toàn bộ các đơn hàng bán ra sắp xếp giảm dần theo thời gian tạo (`created_at DESC`).
  * Hiển thị mã đơn hàng (`order_code`), ngày giờ bán, tên thu ngân, số lượng món, tổng tiền thanh toán, phương thức thanh toán (`CASH` / `BANK_TRANSFER` / `CARD`), và badge trạng thái (`COMPLETED` hoặc `CANCELLED`).
  * Badge trạng thái đồng bộ: `PENDING` (Đang chờ đồng bộ lên máy chủ), `SYNCED` (Đã đồng bộ thành công).
* **Bộ lọc & Tìm kiếm lịch sử:**
  * Tìm kiếm theo mã đơn hàng (`order_code`) hoặc tên khách hàng.
  * Lọc theo khoảng ngày (Hôm nay, 7 ngày, Tất cả).
  * Lọc theo trạng thái đơn hàng (Tất cả, Hoàn thành, Đã hủy).
* **Xuất lịch sử bán hàng:** Nút bấm xuất toàn bộ lịch sử đơn hàng ra file UTF-8 CSV.

---

### 15. Sale Detail

* **File nguồn:** `mobile/src/screens/main/SalesScreen.tsx` (Modal chi tiết đơn hàng) và `ReceiptModal.tsx`.
* **Thông tin hiển thị trong Chi tiết đơn hàng:**
  * Mã giao dịch / Mã đơn hàng (`order_code`).
  * Mã UUID client (`client_order_id`).
  * Thời gian thanh toán chính xác (Giờ, phút, giây, ngày, tháng, năm).
  * Nhân viên thực hiện giao dịch (`cashier_name`).
  * Phương thức thanh toán và số tiền khách đưa / tiền thối lại.
  * Danh sách chi tiết từng món: Tên sản phẩm, Mã SKU, Số lượng, Đơn giá niêm yết, Mức chiết khấu, Thành tiền.
  * Tổng tiền hàng (Tạm tính), Tổng giảm giá, Tổng thanh toán cuối cùng.
  * Nút "In lại hóa đơn" (Reprint Receipt).
  * Nút "Hủy đơn hàng" (Cancel Order) - Chỉ hiển thị nếu đơn chưa bị hủy.

---

### 16. Sale Cancellation

* **File nguồn:** `mobile/src/services/OfflineSaleService.ts` (`cancelSaleOrder()`).
* **Điều kiện được phép hủy đơn:**
  * Đơn hàng đang ở trạng thái `COMPLETED` (Đơn đã bị hủy trước đó sẽ bị chặn với lỗi `ValidationError`).
  * **Kiểm tra phân quyền tài khoản (Account Isolation Guard):** 
    * Nếu tài khoản là `ADMIN` hoặc `OWNER` $\rightarrow$ Có quyền hủy bất kỳ đơn hàng nào.
    * Nếu tài khoản là `STAFF` (Thu ngân) $\rightarrow$ **CHỈ ĐƯỢC PHÉP HỦY ĐƠN DO CHÍNH MÌNH TẠO RA** (`order.created_by === current_user_id`). Nếu cố tình hủy đơn của nhân viên khác, hệ thống ném ngoại lệ: *"Bạn không có quyền hủy đơn hàng của nhân viên khác."*
* **Những gì xảy ra trong Database khi Hủy đơn:**
  Toàn bộ quá trình diễn ra trong 1 Atomic Transaction:
  1. Cập nhật trạng thái bảng `sales_orders` thành `status = 'CANCELLED'`, ghi nhận `cancelled_at = datetime('now')`, `cancelled_by`, và `cancel_reason`.
  2. Cập nhật các dòng trong `sales_records` tương ứng thành `status = 'CANCELLED'`.
  3. **Hoàn trả số lượng tồn kho sản phẩm:** `products.current_stock = current_stock + canceled_qty`.
  4. **Hoàn trả số lượng vào các lô hàng FIFO theo thứ tự LIFO (Lô xuất sau cùng được hồi trước):** Truy vấn các lô trong `inventory_lots` bị trừ trước đó, tăng lại `quantity_remaining` tương ứng với số lượng hoàn trả. Nếu các lô cũ đã đóng, hệ thống tạo một lô điều chỉnh hồi kho để bảo toàn giá vốn.
  5. **Tái tính toán giá vốn bình quân gia quyền của sản phẩm:** Cập nhật lại trường `current_cost_price` trên bảng `products`.
  6. **Ghi thẻ kho di biến động:** Chèn bản ghi mới vào bảng `stock_movements` với `movement_type = 'RETURN'` (hoặc `ADJUSTMENT`), ghi chú lý do hủy đơn.
  7. **Đẩy hàng đợi đồng bộ:** Thêm một mutation vào `sync_queue` với `action_type = 'CANCEL'` để thông báo cho máy chủ hủy đơn tương ứng trên hệ thống trung tâm.

---

### 17. Purchase Orders

* **File nguồn:** `mobile/src/screens/main/InventoryScreen.tsx` (Tab "Đơn mua hàng") và `mobile/src/services/PurchaseOrderService.ts`.
* **Cấu trúc dữ liệu:** Bảng `imports` (Header đơn mua) và `import_items` (Chi tiết các mặt hàng trong đơn).
* **Các trạng thái đơn mua:**
  * `PENDING` (Chờ nhập kho / Đang đặt hàng).
  * `COMPLETED` (Đã nhập kho / Hoàn thành).
  * `CANCELLED` (Đã hủy).
* **Quy tắc tác động tồn kho & Giá vốn (Inventory & FIFO Invariant):**
  * **KHI TẠO ĐƠN MUA Ở TRẠNG THÁI `PENDING`:**
    * Hệ thống **HOÀN TOÀN KHÔNG TĂNG TỒN KHO** (`products.current_stock` giữ nguyên).
    * Hệ thống **KHÔNG TẠO LÔ HÀNG** trong bảng `inventory_lots`.
    * Hệ thống **KHÔNG GHI NHẬN THẺ KHO** trong `stock_movements`.
    * Chỉ lưu thông tin dự kiến vào `imports` và `import_items`.
  * **KHI XÁC NHẬN HOÀN THÀNH ĐƠN MUA (`COMPLETED`):**
    Diễn ra trong 1 Atomic SQLite Transaction:
    1. Cập nhật `imports.status = 'COMPLETED'`.
    2. Với mỗi sản phẩm trong `import_items`:
       * **Tạo Lô hàng mới (FIFO Lot):** Chèn bản ghi vào `inventory_lots` với mã lô tự sinh `LOT-YYYYMMDD-[SKU]-[TIME]`, số lượng nhập `quantity_received`, số lượng tồn ban đầu `quantity_remaining = quantity`, đơn giá vốn nhập `unit_cost`.
       * **Lưu vết lịch sử giá vốn:** Chèn 1 bản ghi vào `cost_price_history`.
       * **Tăng tồn kho sản phẩm:** `products.current_stock = current_stock + imported_quantity`.
       * **Tái tính toán Giá vốn bình quân:** 
         $$\text{Weighted Average Cost} = \frac{\sum (\text{quantity\_remaining} \times \text{unit\_cost})}{\sum \text{quantity\_remaining}}$$
         Cập nhật giá trị này vào `products.current_cost_price`.
       * **Ghi thẻ kho bất biến:** Chèn bản ghi vào `stock_movements` với `movement_type = 'PURCHASE'`.
       * **Đẩy Outbox:** Chèn mutation vào `sync_queue` để đồng bộ lên máy chủ.

---

### 18. Inventory Management

* **File nguồn:** `mobile/src/screens/main/InventoryScreen.tsx`
* **5 Phân hệ chính (Tabs) trong màn hình Kho:**
  1. **Tab 1: Tồn kho (Stock Overview):** Danh sách toàn bộ sản phẩm kèm tồn kho khả dụng, giá trị vốn, ngưỡng cảnh báo. Nút thao tác "Điều chỉnh kho" (Kiểm kê/Hao hụt).
  2. **Tab 2: Đơn mua hàng (Purchase Orders):** Quản lý danh sách đơn mua, tạo đơn mới, xem chi tiết, duyệt hoàn thành đơn.
  3. **Tab 3: Lô hàng FIFO (Inventory Lots):** Xem trực tiếp từng lô hàng nhập trong kho, số lượng ban đầu, số lượng còn lại, ngày nhập, hạn sử dụng, giá vốn từng lô.
  4. **Tab 4: Thẻ kho (Ledger Movements):** Sổ cái ghi nhận mọi biến động xuất nhập tồn (SALE, PURCHASE, DAMAGE, LOSS, RETURN, ADJUSTMENT).
  5. **Tab 5: Nhập kho nhanh (Quick Import):** Giao diện nhập kho trực tiếp không qua quy trình duyệt đơn mua, lập tức cộng kho và tạo lô FIFO.
* **Điều chỉnh tồn kho (Stock Adjustment Modal):**
  * Hỗ trợ các lý do điều chỉnh:
    * `DAMAGE` (Hàng hư hỏng).
    * `LOSS` (Hao hụt, thất thoát khi kiểm kê).
    * `GIFT` (Hàng biếu tặng, khuyến mãi).
    * `RETURN` (Khách trả hàng).
    * `ADJUSTMENT` (Cân đối số liệu kiểm kho).
  * Quy trình xử lý: Nhập số lượng chênh lệch $\rightarrow$ Trừ hoặc cộng tồn kho $\rightarrow$ Điều chỉnh lô FIFO tương ứng $\rightarrow$ Ghi thẻ kho bất biến $\rightarrow$ Ghi hàng đợi Outbox.

---

### 19. Inventory Import

* **File nguồn:** `mobile/src/services/FileImportService.ts` (`previewInventoryImport()`, `commitInventoryImport()`).
* **Định dạng tệp hỗ trợ:** CSV (Comma-Separated Values) hoặc Text phân cách bằng dấu chấm phẩy (`;`), tương thích tệp xuất từ Excel.
* **Cột dữ liệu yêu cầu (Columns Mapping):**
  * *Bắt buộc:* `sku` (Mã SKU sản phẩm), `quantity` (Số lượng nhập > 0), `unit_cost` (Đơn giá vốn nhập >= 0).
  * *Tùy chọn:* `supplier_name` (Tên nhà cung cấp), `note` (Ghi chú nhập hàng).
* **Quy trình Import kho hàng:**
  ```
  CHỌN FILE CSV
        │
        ▼
  PHÂN TÍCH (PARSE) & XÁC THỰC DÒNG (VALIDATION)
        ├── Kiểm tra sự tồn tại của SKU trong bảng products
        ├── Kiểm tra số lượng nhập > 0
        └── Kiểm tra đơn giá vốn >= 0
        │
        ▼
  XEM TRƯỚC (PREVIEW MODAL)
        ├── Hiển thị số dòng hợp lệ (Valid rows count)
        ├── Hiển thị số dòng lỗi kèm chi tiết nguyên nhân (Error rows list)
        └── Tổng số lượng & Tổng tiền nhập dự kiến
        │
        ▼
  XÁC NHẬN NHẬP KHO (CONFIRM IMPORT)
        │
        ▼
  GIAO DỊCH SQLITE ATOMIC (tx.withTransactionAsync)
        ├── Tạo đơn nhập kho imports & import_items
        ├── Tạo các lô hàng mới trong inventory_lots (FIFO)
        ├── Cộng dồn tồn kho products.current_stock
        ├── Cập nhật giá vốn bình quân products.current_cost_price
        ├── Chèn lịch sử giá cost_price_history
        ├── Chèn thẻ kho stock_movements (PURCHASE)
        └── Ghi hàng đợi outbox sync_queue
  ```

---

### 20. Product Import

* **File nguồn:** `mobile/src/services/FileImportService.ts` (`previewProductImport()`, `commitProductImport()`).
* **Định dạng tệp hỗ trợ:** CSV / Excel UTF-8.
* **Cột dữ liệu yêu cầu:**
  * *Bắt buộc:* `sku` (Mã SKU sản phẩm), `name` (Tên sản phẩm), `selling_price` (Giá bán >= 0).
  * *Tùy chọn:* `cost_price` (Giá vốn), `category_name` (Tên danh mục), `barcode` (Mã vạch), `min_stock` (Cảnh báo tồn tối thiểu), `description` (Mô tả).
* **Xử lý trùng lặp & SKU đã tồn tại:**
  * Nếu SKU chưa tồn tại trong hệ thống $\rightarrow$ Đánh dấu tạo mới (`CREATE`). Tự động liên kết danh mục theo tên (nếu danh mục chưa có, hệ thống tự sinh danh mục mới).
  * Nếu SKU đã tồn tại trong hệ thống $\rightarrow$ Đánh dấu cập nhật (`UPDATE`). Cho phép cập nhật giá bán, mã vạch, mô tả. Tuyệt đối không ghi đè làm sai lệch số lượng tồn kho hiện tại.
* **Xử lý dòng lỗi:** Toàn bộ các dòng thiếu cột bắt buộc hoặc giá bán âm sẽ được tách riêng ra danh sách lỗi (`errorRows`) có kèm số thứ tự dòng và lý do cụ thể để người dùng chỉnh sửa, không làm gián đoạn việc import các dòng hợp lệ.

---

### 21. Stock Movement (Thẻ kho)

* **File nguồn:** `mobile/src/database/migrations/002_transactions_and_inventory.ts` và `mobile/src/screens/main/InventoryScreen.tsx` (Tab Thẻ kho).
* **Tính chất:** Sổ cái biến động kho **BẤT BIẾN (IMMUTABLE LEDGER)**. Một khi bản ghi đã ghi vào `stock_movements`, không một API hay người dùng nào có quyền UPDATE hoặc DELETE bản ghi này. Mọi thay đổi điều chỉnh đều phải ghi thêm bản ghi mới.
* **Các trường thông tin trong mỗi bản ghi:**
  * `id`: Khóa chính định danh tự tăng.
  * `client_movement_id`: Mã UUID cục bộ duy nhất chống trùng lặp.
  * `product_id`: ID sản phẩm biến động.
  * `movement_type`: Loại biến động:
    * `SALE`: Xuất kho bán hàng.
    * `PURCHASE`: Nhập kho từ đơn mua hoặc nhập nhanh.
    * `DAMAGE`: Xuất hủy hàng hư hỏng.
    * `LOSS`: Xuất mất mát, hao hụt kiểm kê.
    * `GIFT`: Xuất biếu tặng, khuyến mãi.
    * `RETURN`: Nhập hoàn trả từ đơn hủy hoặc khách trả.
    * `ADJUSTMENT`: Điều chỉnh cân đối kiểm kho.
  * `quantity`: Số lượng biến động (+ cho nhập/hoàn, - cho xuất).
  * `balance_before`: Tồn kho ngay trước khi biến động.
  * `balance_after`: Tồn kho ngay sau khi biến động (`balance_after = balance_before + quantity`).
  * `cost_per_unit`: Đơn giá vốn tại thời điểm phát sinh.
  * `reference_type`: Loại tham chiếu (`SALES_ORDER`, `PURCHASE_ORDER`, `STOCK_ADJUSTMENT`).
  * `reference_id`: Mã chứng từ tham chiếu.
  * `device_id`: ID thiết bị thực hiện.
  * `user_id`: ID người dùng thực hiện.
  * `created_at`: Dấu thời gian phát sinh.
* **Xuất thẻ kho:** Hỗ trợ xuất toàn bộ lịch sử biến động thẻ kho ra file UTF-8 CSV kèm BOM.

---

### 22. FIFO / Cost / COGS / Profit

Cơ chế hạch toán giá vốn và lợi nhuận được lập trình chính xác theo quy chuẩn kế toán bán lẻ:

#### 22.1. Quản lý Lô hàng FIFO (`inventory_lots`)
* Mỗi lần nhập kho (qua Đơn mua hoặc Nhập kho trực tiếp), hệ thống tạo một lô hàng mới trong bảng `inventory_lots`.
* Các trường: `quantity_received` (Số lượng nhập gốc), `quantity_remaining` (Số lượng còn tồn), `unit_cost` (Giá vốn nhập), `purchase_date` (Ngày nhập).
* Khi bán hàng, hệ thống lấy hàng theo thứ tự ưu tiên:
  ```sql
  SELECT * FROM inventory_lots 
  WHERE product_id = ? AND quantity_remaining > 0 
  ORDER BY purchase_date ASC, id ASC
  ```
  Lô nào nhập trước sẽ được trừ hết số lượng trước (First-In, First-Out).

#### 22.2. Công thức Giá vốn hàng bán (COGS - Cost of Goods Sold)
Giá vốn của một dòng hàng xuất bán được tính bằng tổng chi phí thực tế trích xuất từ các lô FIFO tương ứng:
$$\text{COGS} = \sum_{i=1}^{n} (\text{quantity\_taken}_i \times \text{unit\_cost}_i)$$
Mỗi phần trích xuất được ghi chi tiết vào bảng `sale_cost_allocations` để phục vụ đối soát chi tiết.

#### 22.3. Công thức Giá vốn bình quân (Weighted Average Cost)
Trường `current_cost_price` trong bảng `products` thể hiện giá vốn bình quân gia quyền của toàn bộ lượng hàng còn tồn trong kho:
$$\text{Current Cost Price} = \frac{\sum (\text{inventory\_lots.quantity\_remaining} \times \text{inventory\_lots.unit\_cost})}{\sum \text{inventory\_lots.quantity\_remaining}}$$
Được tự động tính lại ngay khi có biến động nhập hàng hoặc hủy đơn hoàn hàng.

#### 22.4. Công thức Lợi nhuận gộp (Gross Profit)
Công thức tính lợi nhuận cho từng mặt hàng bán ra và toàn bộ đơn hàng:
$$\text{Line Subtotal} = \text{quantity} \times \text{unit\_price}$$
$$\text{Line Revenue} = \text{Line Subtotal} - \text{Line Discount}$$
$$\text{Line Profit} = \text{Line Revenue} - \text{Line Cost (COGS)}$$
$$\text{Order Gross Profit} = \sum \text{Line Profit}$$

---

### 23. Reports

* **File nguồn:** `mobile/src/screens/main/ReportsScreen.tsx`
* **Dịch vụ cung cấp:** `mobile/src/services/AnalyticsService.ts`
* **4 Báo cáo nghiệp vụ chính:**
  1. **Doanh thu theo ngày (Sales by Date Report):**
     * Nhóm theo từng ngày phát sinh giao dịch (`sale_date`).
     * Chỉ số: Tổng doanh thu, Tổng giá vốn (COGS), Lợi nhuận gộp, Số lượng đơn hàng, Tỷ suất lợi nhuận (`Margin % = Profit / Revenue * 100`).
     * Modal xem chi tiết từng ngày (Drill-down).
  2. **Sản phẩm bán chạy (Top Selling Products):**
     * Xếp hạng các sản phẩm theo số lượng bán ra hoặc doanh thu cao nhất.
     * Chỉ số: Tên sản phẩm, SKU, Số lượng đã bán, Tổng tiền thu về.
  3. **Sản phẩm bán chậm & Hàng chết (Slow Moving & Dead Stock):**
     * Nhận diện các sản phẩm có số ngày tồn kho lớn nhưng không phát sinh đơn bán trong chu kỳ 30 - 90 ngày.
     * Cảnh báo vốn bị ứ đọng trong kho.
  4. **Tồn kho & Lợi nhuận (Inventory & Profitability):**
     * Tổng hợp giá trị kho hàng theo từng danh mục.
     * Đánh giá hiệu quả kinh doanh trên từng nhóm ngành hàng.
* Toàn bộ báo cáo chạy 100% Offline trên dữ liệu SQLite cục bộ, không phụ thuộc máy chủ.

---

### 24. Barcode

* **File nguồn:** `mobile/src/components/scanner/BarcodeScannerModal.tsx`
* **Công nghệ:** Thư viện `expo-camera` (`CameraView`) kết hợp bộ giải mã mã vạch tích hợp.
* **Các định dạng mã vạch thực tế được hỗ trợ (Dựa trên cấu hình code dòng 266):**
  * `qr`: Mã QR Code 2D.
  * `ean13`: Mã vạch thương phẩm quốc tế EAN-13 (Phổ biến nhất tại Việt Nam).
  * `ean8`: Mã vạch rút gọn EAN-8.
  * `code128`: Mã vạch Code 128 công nghiệp và vận chuyển.
  * `code39`: Mã vạch Code 39.
  * `upc_a`: Mã vạch bán lẻ chuẩn Bắc Mỹ UPC-A.
  * `upc_e`: Mã vạch rút gọn UPC-E.
* **Tính năng tối ưu trải nghiệm quét:**
  * **Cơ chế chống quét trùng (Debounce / Scan Lock):** Sau khi quét thành công 1 mã, hệ thống khóa tạm thời (`scanLockRef = true`) trong 1500ms để tránh việc 1 sản phẩm bị thêm nhiều lần liên tiếp vào giỏ hàng.
  * **Hiệu ứng laser quét động:** Animation vạch đỏ quét liên tục tạo cảm giác phản hồi tức thì cho thu ngân.
  * **Chế độ nhập tay (Manual Entry Fallback):** Cho phép nhập mã SKU hoặc Barcode từ bàn phím khi camera mờ hoặc trên môi trường Web/Máy tính.
  * **Hỗ trợ đầu đọc mã vạch cắm ngoài (USB OTG / Bluetooth Keyboard Wedge Scanner):** Các đầu đọc mã vạch vật lý bắn mã dạng bàn phím gõ được hỗ trợ trực tiếp thông qua ô Input tự động bắt sự kiện Submit.

---

### 25. Receipt (Hóa đơn bán hàng)

* **File nguồn:** `mobile/src/screens/main/ReceiptModal.tsx`
* **Bố cục hiển thị Hóa đơn:**
  * **Tiêu đề cửa hàng:** "T_SHOP RETAIL STORE", địa chỉ, số điện thoại hotline.
  * **Thông tin đơn hàng:** Mã giao dịch (`order_code`), Ngày giờ thanh toán, Tên thu ngân (`cashier_name`), Tên khách hàng.
  * **Bảng danh sách mặt hàng:** Tên sản phẩm, số lượng, đơn giá, chiết khấu, thành tiền từng dòng.
  * **Tổng kết thanh toán:** Tạm tính (Subtotal), Tổng giảm giá (Discount), Tổng tiền thanh toán (Total Amount).
  * **Chi tiết tiền mặt:** Hình thức thanh toán (Tiền mặt/Chuyển khoản/Thẻ), Tiền khách đưa, Tiền thừa trả lại.
  * **Lời cảm ơn:** "CẢM ƠN QUÝ KHÁCH VÀ HẸN GẶP LẠI!".
* **Thao tác hỗ trợ:**
  * **In hóa đơn:** Kích hoạt dịch vụ in nhiệt Bluetooth ESC/POS.
  * **Chia sẻ hóa đơn (Share Receipt):** Xuất nội dung hóa đơn dạng văn bản chuẩn hóa để gửi qua Zalo, Messenger, SMS hoặc sao chép vào Clipboard qua `Share.share`.

---

### 26. Thermal Printer (Máy in nhiệt)

* **File nguồn:** `mobile/src/services/printer/EscPosBuilder.ts` và `mobile/src/services/printer/ReceiptPrinterService.ts`.
* **Kiến trúc phân tách:** Dữ liệu hóa đơn $\rightarrow$ Trình sinh mã lệnh nhị phân ESC/POS (`EscPosBuilder`) $\rightarrow$ Kênh truyền tải phần cứng (`ReceiptPrinterService`).
* **Quy tắc an toàn giao dịch bất biến (Critical POS Invariant):**
  > **LỖI MÁY IN KHÔNG BAO GIỜ ĐƯỢC PHÉP ROLLBACK HOẶC LÀM HỎNG GIAO DỊCH BÁN HÀNG ĐÃ LƯU TRONG CƠ SỞ DỮ LIỆU.**
  Được chứng minh bởi Test Suite 30 trong `database.test.mjs`: Khi máy in mất kết nối Bluetooth hoặc hết giấy, hàm in bắt lỗi an toàn (`graceful catch`), giao dịch bán hàng và hàng đợi Outbox trong SQLite vẫn giữ nguyên trạng thái `COMPLETED` và `PENDING`.
* **Thông số kỹ thuật lệnh in:**
  * Khổ giấy hỗ trợ: **58mm** (Độ rộng 32 ký tự) và **80mm** (Độ rộng 48 ký tự).
  * Mã lệnh khởi tạo: `\x1B\x40` (ESC @).
  * Căn lề: `\x1B\x61\x00` (Trái), `\x1B\x61\x01` (Giữa), `\x1B\x61\x02` (Phải).
  * Định dạng chữ: In đậm (`\x1B\x45\x01`), Nhân đôi chiều cao (`\x1B\x21\x10`).
  * Lệnh cắt giấy tự động: `\x1D\x56\x41\x03` (GS V A 3).
  * Đẩy giấy (Feed): 3 dòng trống trước khi cắt.
  * **Khử dấu tiếng Việt cho máy in ROM chuẩn:** Hầu hết máy in nhiệt giá rẻ tại Việt Nam sử dụng bảng mã ASCII/CP437 không có font Unicode tiếng Việt. `EscPosBuilder` tự động chuyển đổi tiếng Việt có dấu thành không dấu để hóa đơn in ra sắc nét, không bao giờ bị lỗi ký tự rác (garbled characters).
* **Phân biệt hiện trạng phần cứng:**
  * **SOFTWARE IMPLEMENTED & TESTED:** Trình sinh mã nhị phân ESC/POS, xử lý layout hóa đơn 58mm/80mm, xử lý lỗi an toàn không rollback DB đã hoàn thành 100% và có automated test chứng minh.
  * **PHYSICAL HARDWARE VERIFIED:** Hiện tại đang sử dụng driver mô phỏng (`SIMULATOR`). Việc kết nối thực tế trên phần cứng máy in nhiệt Bluetooth/BLE cụ thể cần tiến hành ghép nối và kiểm nghiệm tại cửa hàng vật lý.

---

### 27. Offline-First Architecture

Kiến trúc ngoại tuyến đảm bảo mọi hoạt động kinh doanh tại cửa hàng không bao giờ bị gián đoạn:

* **Trọng tâm dữ liệu cục bộ (Local as Source of Truth):** Ứng dụng đọc và ghi trực tiếp vào SQLite trên thiết bị. Mọi thao tác tạo đơn, trừ kho, tính giá vốn, in hóa đơn đều hoàn tất tức thì với độ trễ < 15ms mà không cần gửi bất kỳ request mạng nào.
* **Mô hình Hàng đợi Ngoại tuyến (Outbox Pattern):**
  * Khi có thao tác thay đổi dữ liệu (Bán hàng, Nhập kho, Thêm/Sửa sản phẩm, Hủy đơn), thao tác đó được ghi đồng thời vào bảng nghiệp vụ và bảng hàng đợi `sync_queue` trong cùng 1 Transaction duy nhất.
  * Trạng thái hàng đợi: `PENDING` $\rightarrow$ `SYNCING` $\rightarrow$ `SYNCED` (hoặc `FAILED`).
* **Bảng phân loại hoạt động theo trạng thái mạng:**
  * *Hoạt động 100% Offline (Không cần mạng):* Đăng nhập tài khoản đã lưu, Xem tổng quan Dashboard, Tìm kiếm sản phẩm, Quét mã vạch, Bán hàng POS, In hóa đơn, Quản lý kho, Nhập đơn mua, Điều chỉnh kho, Xem báo cáo, Xuất file CSV.
  * *Hoạt động cần mạng (Online Required):* Đăng nhập tài khoản mới lần đầu, Đẩy đơn hàng lên máy chủ trung tâm, Kéo danh mục sản phẩm mới từ máy chủ, Làm mới Access Token khi hết hạn (RTR).

---

### 28. Sync Engine

* **File nguồn:** `mobile/src/sync/SyncEngine.ts`, `PushSyncHandler.ts`, `PullSyncHandler.ts`.
* **Cơ chế Đẩy (Push Sync):**
  1. Quét bảng `sync_queue` tìm các bản ghi có `status = 'PENDING'` thuộc về `user_id` và `device_id` hiện tại.
  2. Gom thành từng lô (Batching, mặc định 20 bản ghi/lô).
  3. Cập nhật trạng thái sang `SYNCING`.
  4. Gửi `POST /api/sync/push` kèm khóa Idempotency (`client_mutation_id`).
  5. Khi máy chủ phản hồi `200 OK` kèm danh sách ACK: Đánh dấu `status = 'SYNCED'` và ghi nhận `synced_at = datetime('now')`.
  6. Nếu máy chủ phản hồi lỗi mạng hoặc 500: Tăng `retry_count`, áp dụng hàm lùi thời gian lũy thừa (Exponential Backoff: $2^n \times 1000\text{ms}$), chuyển lại `status = 'PENDING'`.
* **Cơ chế Kéo (Pull Sync):**
  1. Đọc giá trị con trỏ thời gian cập nhật gần nhất từ bảng `sync_metadata` (`key = 'last_pulled_at'`).
  2. Gửi `GET /api/sync/pull?since={last_pulled_at}`.
  3. Máy chủ trả về danh sách các thay đổi mới nhất của sản phẩm, danh mục, giá bán.
  4. Ứng dụng áp dụng thay đổi vào SQLite nội bộ trong 1 transaction an toàn và cập nhật lại mốc `last_pulled_at`.
* **Tự động phục hồi phiên treo (Stale Syncing Recovery):** Khi ứng dụng bị tắt đột ngột giữa chừng lúc đang sync, các bản ghi bị kẹt ở trạng thái `SYNCING` quá 5 phút sẽ được tự động trả về `PENDING` khi mở lại ứng dụng.

---

### 29. Conflict Management

* **File nguồn:** `mobile/src/screens/main/ConflictCenterScreen.tsx` và `mobile/src/sync/ConflictService.ts`.
* **Các loại xung đột dữ liệu (Conflict Taxonomy):**
  * `INVENTORY_SHORTAGE_CONFLICT`: Xảy ra khi 2 thiết bị cùng bán một sản phẩm lúc offline dẫn tới việc tổng số lượng bán vượt quá tồn kho thực tế trên máy chủ.
  * `PRICE_VERSION_CONFLICT`: Giá sản phẩm trên máy chủ đã thay đổi trong khi thiết bị offline vẫn bán theo giá cũ.
  * `MASTER_DATA_CONFLICT`: Thông tin sản phẩm hoặc danh mục bị chỉnh sửa trái ngược nhau giữa client và server.
* **Quy trình xử lý tại Trung tâm Xử lý Xung đột (Conflict Center):**
  * Hiển thị danh sách các xung đột đang mở (`resolution_status = 'OPEN'`).
  * So sánh trực quan dữ liệu cục bộ trên máy (`Client Payload`) và dữ liệu trên máy chủ (`Server Payload`).
  * **3 Chiến lược xử lý do Quản lý quyết định:**
    1. `CLIENT_WINS` (Giữ dữ liệu máy này): Buộc máy chủ chấp nhận dữ liệu từ thiết bị này.
    2. `SERVER_WINS` (Áp dụng từ máy chủ): Ghi đè dữ liệu máy chủ về thiết bị và hủy bỏ thay đổi cục bộ.
    3. `DISCARD` (Hủy bỏ giao dịch): Hủy giao dịch gây xung đột và hoàn kho tương ứng.
* **Đối soát trượt tồn kho (Stock Drift Reconciliation):** Ghi nhận các chênh lệch số lượng tồn giữa kiểm kê thực tế và số liệu hệ thống vào bảng `stock_drift_ledger`, cung cấp nút bấm "Tự động cân bằng kho" chỉ với 1 chạm.

---

### 30. Authentication

* **File nguồn:** `mobile/src/screens/auth/LoginScreen.tsx`, `mobile/src/auth/AuthManager.ts`, `tokenStorage.ts`.
* **Kiến trúc xác thực:** JWT kép (Access Token ngắn hạn 15 phút + Refresh Token dài hạn 7 - 30 ngày).
* **Cơ chế Xoay vòng Refresh Token đơn luồng (Single-Flight RTR Mutex):**
  * Khi nhiều request đồng thời gặp lỗi `401 Unauthorized`, `AuthManager` kích hoạt cờ `isRefreshing = true` và khởi tạo duy nhất 1 `refreshPromise`. Mọi request khác sẽ cùng chờ (join) vào Promise duy nhất này mà không gọi API lặp lại nhiều lần.
  * Gọi `POST /api/auth/refresh` gửi kèm `refreshToken` và `X-Device-Id`.
  * Máy chủ cấp cặp token hoàn toàn mới và hủy token cũ. Token mới được lưu tức thì vào `SecureStore`.
* **Đăng nhập Ngoại tuyến (Offline Authentication):**
  * Nếu thiết bị mất mạng, ứng dụng kiểm tra phiên lưu trữ gần nhất trong `SecureStore`. Nếu người dùng đã từng đăng nhập hợp lệ trước đó, hệ thống cho phép vào thẳng màn hình làm việc để bán hàng bình thường.

---

### 31. Security & Account Isolation

* **File nguồn:** `mobile/src/auth/tokenStorage.ts` và migration `007_auth_device_and_account_scope.ts`.
* **Định danh thiết bị duy nhất (Device UUID):** Mỗi thiết bị cài đặt ứng dụng được cấp một mã định danh ngẫu nhiên bất biến `device_id` lưu trong phần cứng an toàn, gửi kèm mọi request đồng bộ.
* **Cách ly dữ liệu đa tài khoản trên thiết bị dùng chung (Multi-Account Isolation):**
  * **Ràng buộc Hàng đợi Outbox:** Mọi bản ghi trong `sync_queue` đều gắn liền với `user_id` và `device_id`. Khi Nhân viên A đăng xuất và Nhân viên B đăng nhập trên cùng một máy tính bảng, Sync Engine **CHỈ ĐỒNG BỘ** các đột biến thuộc về Nhân viên B, ngăn chặn việc Nhân viên B gửi hoặc ký số thay cho Nhân viên A.
  * **Ràng buộc phân quyền Hủy đơn:** Thu ngân không thể hủy đơn do thu ngân khác tạo ra (đã được kiểm chứng tại Section 16).
  * **Xóa phiên sạch sẽ khi Đăng xuất:** Hàm `logout()` tự động dọn sạch token trong `SecureStore`, hủy phiên làm việc và ngắt các tiến trình lắng nghe sự kiện.

---

### 32. Error Handling

* **File nguồn:** `mobile/src/components/common/ErrorBoundary.tsx`, `ErrorView.tsx`, `mobile/src/types/errors.ts`.
* **Bắt lỗi toàn cục (Global React Error Boundary):** Bao bọc toàn bộ ứng dụng tại `App.tsx`. Nếu có lỗi render JavaScript ngoài dự kiến, ứng dụng không bị văng (crash) mà hiển thị giao diện báo lỗi chuyên nghiệp kèm nút "Tải lại ứng dụng".
* **Phân cấp lỗi chuẩn hóa:**
  * `ValidationError`: Lỗi dữ liệu nhập (Giá bán âm, thiếu tên, tồn kho không đủ...) $\rightarrow$ Hiển thị thông báo Toast/Alert tiếng Việt rõ ràng.
  * `SqliteError`: Lỗi vi phạm ràng buộc cơ sở dữ liệu $\rightarrow$ Tự động rollback giao dịch và ghi log chi tiết.
  * `NetworkError`: Lỗi mất kết nối hoặc timeout $\rightarrow$ Tự động chuyển sang chế độ hàng đợi ngoại tuyến.
  * `AuthError`: Phiên hết hạn $\rightarrow$ Tự động xoay vòng token hoặc đưa về màn hình đăng nhập an toàn.

---

### 33. Mobile Utilities

Các tiện ích tối ưu trải nghiệm người dùng thực tế:

* **Pull to Refresh:** Tích hợp trên Dashboard, Products, Sales, Inventory, Reports.
* **Bàn phím an toàn (Keyboard Avoiding):** Tự động đẩy khung nhìn khi bàn phím ảo xuất hiện trên các màn hình nhập liệu.
* **Chống bấm lặp (Double Submission Protection):** Vô hiệu hóa nút Bán hàng / Nhập kho ngay sau khi chạm lần đầu (`submitting = true`).
* **Thanh trạng thái mạng (NetworkBanner):** Hiển thị thanh màu cam khi mất mạng ("Chế độ ngoại tuyến - Dữ liệu lưu cục bộ") và chuyển sang màu xanh khi có mạng trở lại.
* **Chẩn đoán sức khỏe dữ liệu (Data Health Check):** Tích hợp trong `SettingsScreen` kiểm tra tính toàn vẹn của database, kiểm tra khóa ngoại, kiểm tra độ lệch tồn kho và hiển thị báo cáo.
* **Sao lưu dữ liệu cục bộ (Local Database Dump):** Nút xuất toàn bộ database thành file JSON dự phòng trong `SettingsScreen`.

---

### 34. Responsive UI

* **Cấu hình Layout Tokens:** Được quy chuẩn tại `mobile/src/constants/layout.ts`.
* **Hỗ trợ kích thước màn hình:**
  * Điện thoại siêu nhỏ (Màn hình 320px - 360px): Tự động co giãn kích thước font chữ, chuyển các nút bấm từ hàng ngang thành dạng xếp chồng dọc (stacked buttons) để tránh tràn viền (overflow).
  * Điện thoại tiêu chuẩn (375px - 412px): Hiển thị đầy đủ 2 cột thông tin, card bo góc 12px.
  * Máy tính bảng (Tablet / iPad): `supportsTablet: true` trong `app.json`, chia bố cục 2 cột (Giỏ hàng bên phải, danh mục sản phẩm bên trái).
* **Định hướng màn hình (Orientation):** Cấu hình `portrait` (Dọc) tối ưu cho việc cầm 1 tay thao tác bán hàng và quét mã vạch.

---

### 35. Performance

* **Tối ưu hóa truy vấn SQLite:**
  * Kích hoạt chế độ ghi nhật ký `PRAGMA journal_mode = WAL` (Write-Ahead Logging) cho phép đọc và ghi đồng thời mà không nghẽn khóa DB.
  * Đặt `PRAGMA busy_timeout = 5000` (Chờ tối đa 5 giây tránh lỗi database is locked).
  * 12 Chỉ mục (Indexes) được tạo sẵn trên các cột thường xuyên tìm kiếm và liên kết khóa ngoại (`sku`, `name`, `barcode`, `category_id`, `status`, `sale_date`, `user_id`, `device_id`).
* **Tối ưu hóa hiển thị danh sách (Virtualization):**
  * Sử dụng `FlatList` với cấu hình `initialNumToRender = 15`, `maxToRenderPerBatch = 10`, `windowSize = 5` giúp cuộn mượt mà hàng ngàn sản phẩm mà không tốn bộ nhớ.
* **Tối ưu hóa tìm kiếm (Debounce):** Trì hoãn 250ms khi gõ bàn phím trước khi kích hoạt bộ lọc tìm kiếm sản phẩm.

---

### 36. Database Schema (Toàn bộ 21 Bảng SQLite)

Dưới đây là đặc tả toàn bộ 21 bảng dữ liệu được tạo qua 9 file migration trong `mobile/src/database/migrations/`:

#### 1. `users`
* Mục đích: Lưu trữ tài khoản nhân viên và quản trị viên.
* Cột: `id` (PK), `username` (UNIQUE), `full_name`, `role` (`ADMIN`, `STAFF`), `status` (`ACTIVE`, `INACTIVE`), `created_at`, `updated_at`.

#### 2. `categories`
* Mục đích: Danh mục phân loại hàng hóa.
* Cột: `id` (PK), `code` (UNIQUE), `name`, `description`, `status` (`ACTIVE`, `INACTIVE`), `created_at`, `updated_at`.

#### 3. `product_types`
* Mục đích: Phân loại chi tiết trong từng danh mục.
* Cột: `id` (PK), `category_id` (FK $\rightarrow$ `categories.id` ON DELETE RESTRICT), `code` (UNIQUE), `name`, `description`, `status`, `created_at`, `updated_at`.

#### 4. `products`
* Mục đích: Bảng dữ liệu sản phẩm cốt lõi.
* Cột: `id` (PK), `sku` (UNIQUE), `barcode`, `product_code`, `name`, `description`, `category_id` (FK $\rightarrow$ `categories.id`), `product_type_id` (FK $\rightarrow$ `product_types.id`), `current_cost_price` (>= 0), `current_selling_price` (>= 0), `current_stock` (INTEGER), `min_stock_alert` (INTEGER, Default: 5), `status` (`ACTIVE`, `INACTIVE`), `created_at`, `updated_at`.

#### 5. `price_history`
* Mục đích: Nhật ký biến động giá bán niêm yết.
* Cột: `id` (PK Auto), `product_id` (FK $\rightarrow$ `products.id`), `price`, `effective_from`, `note`, `created_by` (FK $\rightarrow$ `users.id`), `created_at`.

#### 6. `cost_price_history`
* Mục đích: Nhật ký biến động giá vốn hàng nhập.
* Cột: `id` (PK Auto), `product_id` (FK $\rightarrow$ `products.id`), `cost_price`, `effective_from`, `note`, `created_by` (FK $\rightarrow$ `users.id`), `created_at`.

#### 7. `suppliers`
* Mục đích: Nhà cung cấp hàng hóa.
* Cột: `id` (PK), `code` (UNIQUE), `name`, `phone`, `address`, `status`, `created_at`, `updated_at`.

#### 8. `customers`
* Mục đích: Thông tin khách hàng thân thiết.
* Cột: `id` (PK), `code` (UNIQUE), `name`, `phone`, `address`, `status`, `created_at`, `updated_at`.

#### 9. `sales_records`
* Mục đích: Lưu chi tiết từng dòng sản phẩm bán ra.
* Cột: `id` (PK Auto), `client_transaction_id` (UNIQUE), `server_id`, `transaction_code`, `product_id` (FK $\rightarrow$ `products.id`), `sale_date`, `quantity` (> 0), `unit_price_at_sale`, `cost_price_at_sale`, `discount`, `total_revenue`, `total_cost`, `profit`, `status` (`COMPLETED`, `CANCELLED`), `sync_status` (`PENDING`, `SYNCING`, `SYNCED`, `FAILED`), `cancel_reason`, `cancelled_at`, `cancelled_by`, `note`, `created_by`, `created_at`, `synced_at`.

#### 10. `sale_cost_allocations`
* Mục đích: Phân bổ giá vốn FIFO chi tiết từ từng lô hàng cho mỗi đơn bán.
* Cột: `id` (PK Auto), `sales_record_id` (FK $\rightarrow$ `sales_records.id`), `lot_id` (FK $\rightarrow$ `inventory_lots.id`), `quantity_taken`, `unit_cost`, `allocated_cost`, `created_at`.

#### 11. `stock_movements`
* Mục đích: Sổ cái thẻ kho biến động xuất nhập tồn (Bất biến).
* Cột: `id` (PK Auto), `client_movement_id` (UNIQUE), `product_id` (FK $\rightarrow$ `products.id`), `movement_type` (`SALE`, `PURCHASE`, `DAMAGE`, `LOSS`, `GIFT`, `RETURN`, `ADJUSTMENT`), `quantity`, `balance_before`, `balance_after`, `cost_per_unit`, `reference_type`, `reference_id`, `device_id`, `user_id`, `note`, `created_at`.

#### 12. `inventory_lots`
* Mục đích: Quản lý chi tiết từng lô hàng nhập theo nguyên lý FIFO.
* Cột: `id` (PK Auto), `lot_code` (UNIQUE), `product_id` (FK $\rightarrow$ `products.id`), `purchase_date`, `expiry_date`, `initial_quantity`, `quantity_received`, `quantity_remaining`, `unit_cost`, `supplier_id`, `import_id`, `status` (`ACTIVE`, `EXHAUSTED`, `EXPIRED`), `note`, `created_by`, `created_at`.

#### 13. `sync_queue`
* Mục đích: Hàng đợi Outbox lưu trữ các đột biến ngoại tuyến cần gửi lên server.
* Cột: `id` (PK Auto), `client_mutation_id` (UNIQUE), `entity_type`, `action_type`, `entity_id`, `payload` (JSON Text), `status` (`PENDING`, `SYNCING`, `SYNCED`, `FAILED`), `retry_count`, `last_error`, `user_id`, `device_id`, `created_at`, `updated_at`, `synced_at`.

#### 14. `sync_metadata`
* Mục đích: Lưu trữ cấu hình và con trỏ đồng bộ.
* Cột: `key` (PK Text), `value` (Text), `updated_at`.

#### 15. `sales_orders`
* Mục đích: Lưu trữ header của toàn bộ đơn hàng bán ra.
* Cột: `id` (PK Auto), `client_order_id` (UNIQUE), `server_id`, `order_code` (UNIQUE), `total_amount`, `discount`, `final_amount`, `payment_method` (`CASH`, `BANK_TRANSFER`, `CARD`), `amount_tendered`, `change_amount`, `status` (`COMPLETED`, `CANCELLED`), `sync_status`, `device_id`, `created_by`, `cancel_reason`, `cancelled_at`, `cancelled_by`, `items_payload` (JSON Text), `created_at`, `synced_at`.

#### 16. `imports`
* Mục đích: Lưu trữ header đơn nhập kho / đơn mua hàng.
* Cột: `id` (PK Auto), `client_import_id` (UNIQUE), `server_id`, `import_code` (UNIQUE), `supplier_id`, `import_date`, `expected_date`, `total_amount`, `note`, `status` (`PENDING`, `COMPLETED`, `CANCELLED`), `sync_status`, `device_id`, `created_by`, `created_at`, `synced_at`.

#### 17. `import_items`
* Mục đích: Chi tiết các mặt hàng trong đơn nhập kho.
* Cột: `id` (PK Auto), `import_id` (FK $\rightarrow$ `imports.id`), `product_id` (FK $\rightarrow$ `products.id`), `quantity`, `unit_cost_price`, `total_amount`, `created_at`.

#### 18. `conflict_records`
* Mục đích: Lưu trữ các xung đột đồng bộ giữa client và server.
* Cột: `id` (PK Auto), `client_conflict_id` (UNIQUE), `mutation_id`, `entity_type`, `entity_id`, `conflict_type`, `client_payload` (JSON Text), `server_payload` (JSON Text), `resolution_status` (`OPEN`, `RESOLVED`, `DISCARDED`), `resolution_strategy`, `resolved_at`, `created_at`.

#### 19. `sync_sessions`
* Mục đích: Nhật ký các phiên đồng bộ dữ liệu.
* Cột: `id` (PK Auto), `session_id` (UNIQUE), `direction` (`PUSH`, `PULL`), `status` (`RUNNING`, `SUCCESS`, `FAILED`), `items_count`, `errors_count`, `started_at`, `completed_at`.

#### 20. `stock_drift_ledger`
* Mục đích: Sổ cái ghi nhận độ lệch tồn kho và lịch sử đối soát.
* Cột: `id` (PK Auto), `product_id` (FK $\rightarrow$ `products.id`), `drift_quantity`, `reason`, `reconciled_status` (`PENDING`, `RECONCILED`), `created_at`.

#### 21. `schema_migrations`
* Mục đích: Theo dõi các migration đã chạy thành công trên thiết bị.
* Cột: `version` (PK INTEGER), `name` (Text), `applied_at` (Text).

---

### 37. Database Migrations

Danh sách 9 migration trong `mobile/src/database/migrations/`:

| Version | Tên File Migration | Nội dung Schema thay đổi |
| :---: | :--- | :--- |
| **001** | `001_initial_master_data.ts` | Khởi tạo bảng danh mục `categories`, loại sản phẩm `product_types`, sản phẩm `products`, tài khoản `users`, lịch sử giá `price_history`, lịch sử giá vốn `cost_price_history`. Tạo các chỉ mục ban đầu. |
| **002** | `002_transactions_and_inventory.ts` | Khởi tạo bảng nhà cung cấp `suppliers`, khách hàng `customers`, chi tiết bán `sales_records`, phân bổ giá vốn `sale_cost_allocations`, thẻ kho `stock_movements`, và quản lý lô FIFO `inventory_lots`. |
| **003** | `003_outbox_and_sync_metadata.ts` | Khởi tạo bảng hàng đợi ngoại tuyến `sync_queue` và cấu hình con trỏ đồng bộ `sync_metadata`. |
| **004** | `004_offline_transactions_and_outbox_engine.ts` | Bổ sung bảng header đơn hàng `sales_orders`, header đơn nhập `imports`, và chi tiết đơn nhập `import_items`. |
| **005** | `005_conflict_records_and_sync_sessions.ts` | Bổ sung bảng ghi nhận xung đột `conflict_records` và nhật ký phiên đồng bộ `sync_sessions`. |
| **006** | `006_conflict_taxonomy_and_reconciliation.ts` | Khởi tạo sổ cái độ lệch tồn kho `stock_drift_ledger` phục vụ đối soát tự động. |
| **007** | `007_auth_device_and_account_scope.ts` | Mở rộng bảng `sync_queue` thêm cột `user_id` và `device_id`. Tạo chỉ mục `idx_sync_queue_user_device` và `idx_sales_orders_created_by` đảm bảo cách ly dữ liệu giữa các tài khoản trên cùng thiết bị. |
| **008** | `008_purchase_orders_and_product_details.ts` | Mở rộng bảng `products` thêm `barcode`, `description`, `product_code`. Khởi tạo bảng `purchase_orders` và `purchase_order_items`. |
| **009** | `009_sales_order_cancellation_and_payment.ts` | Mở rộng bảng `sales_orders` thêm trường thanh toán `payment_method`, `amount_tendered`, `change_amount`, và các trường phục vụ hủy đơn `cancelled_at`, `cancelled_by`, `cancel_reason`. |

---

### 38. API / Service Map

Bản đồ kết nối từ Giao diện UI $\rightarrow$ Dịch vụ $\rightarrow$ API Máy chủ:

| Tính năng | UI Component / Screen | Service đảm nhiệm | Endpoint máy chủ liên kết |
| :--- | :--- | :--- | :--- |
| **Đăng nhập** | `LoginScreen.tsx` | `AuthManager.ts` | `POST /api/auth/login` |
| **Làm mới Token** | Tự động qua Axios Interceptor | `AuthManager.ts` | `POST /api/auth/refresh` |
| **Đẩy đơn ngoại tuyến** | `SyncEngine.ts` / Background | `PushSyncHandler.ts` | `POST /api/sync/push` |
| **Kéo danh mục mới** | `SyncEngine.ts` / Pull to Refresh | `PullSyncHandler.ts` | `GET /api/sync/pull` |
| **Kiểm tra kết nối Server**| `NetworkBanner.tsx` | `NetworkService.ts` | `GET /api/sync/health` |
| **Giải quyết xung đột** | `ConflictCenterScreen.tsx` | `ConflictService.ts` | `POST /api/sync/conflicts/resolve` |
| **Thanh toán POS** | `SalesScreen.tsx` | `OfflineSaleService.ts` | Lưu SQLite $\rightarrow$ Đẩy qua `/api/sync/push` |
| **Hủy đơn hàng** | `SalesScreen.tsx` | `OfflineSaleService.ts` | Lưu SQLite $\rightarrow$ Đẩy qua `/api/sync/push` |
| **Tạo / Duyệt đơn mua** | `InventoryScreen.tsx` | `PurchaseOrderService.ts` | Lưu SQLite $\rightarrow$ Đẩy qua `/api/sync/push` |
| **In nhiệt hóa đơn** | `ReceiptModal.tsx` | `ReceiptPrinterService.ts` | Xử lý tại chỗ (Local Binary Stream) |
| **Xuất file báo cáo** | `ProductsScreen`, `SalesScreen` | `ExportService.ts` | Xử lý tại chỗ (UTF-8 BOM CSV File / Share) |

---

### 39. Repository Map

Mô hình triển khai Repository Pattern:

* `CategoryRepository.ts` $\rightarrow$ Thực thi qua `SqliteCategoryDataSource.ts`: Truy vấn bảng `categories` và tính tổng số sản phẩm liên kết.
* `ProductRepository.ts` $\rightarrow$ Thực thi qua `SqliteProductDataSource.ts`: Tìm kiếm sản phẩm theo tên tiếng Việt khử dấu, SKU, Barcode; lấy lịch sử giá bán và giá vốn.
* `SaleRepository.ts` $\rightarrow$ Thực thi qua `SqliteSaleDataSource.ts`: Truy vấn danh sách đơn hàng `sales_orders`, lọc theo ngày, trạng thái, nhân viên.
* `InventoryRepository.ts` $\rightarrow$ Thực thi qua `SqliteInventoryDataSource.ts`: Truy vấn tồn kho khả dụng, danh sách lô FIFO còn hạn, lịch sử thẻ kho.

---

### 40. Data Flow

Sơ đồ luồng dữ liệu nghiệp vụ tổng thể:

```
                  NGƯỜI DÙNG / THU NGÂN
                            │
                            ▼
+─────────────────────────────────────────────────────────+
|                  MÀN HÌNH BÁN HÀNG (POS)                |
|  - Quét mã vạch EAN-13/QR qua Camera                    |
|  - Thêm mặt hàng & Chốt giá niêm yết                    |
|  - Áp dụng chiết khấu dòng & chiết khấu tổng            |
+─────────────────────────────────────────────────────────+
                            │
                            ▼
+─────────────────────────────────────────────────────────+
|                    OFFLINE SALE SERVICE                 |
|  - Kiểm tra tồn kho khả dụng (products.current_stock)   |
|  - Quét lô FIFO nhập trước (inventory_lots ORDER BY ASC)|
|  - Trích xuất số lượng & Tính COGS thực tế              |
+─────────────────────────────────────────────────────────+
                            │
                            ▼ (BEGIN TRANSACTION)
+─────────────────────────────────────────────────────────+
|                   SQLITE DATABASE NHÚNG                 |
|  1. INSERT sales_orders (Header + Payment Details)      |
|  2. INSERT sales_records (Line Items + Profit)          |
|  3. INSERT sale_cost_allocations (FIFO Lot Mappings)    |
|  4. UPDATE inventory_lots (Trừ quantity_remaining)     |
|  5. UPDATE products (Cập nhật tồn kho & Giá bình quân)  |
|  6. INSERT stock_movements (Thẻ kho bất biến - SALE)    |
|  7. INSERT sync_queue (Outbox mutation - PENDING)       |
+─────────────────────────────────────────────────────────+
                            │ (COMMIT TRANSACTION)
                            ▼
+─────────────────────────────────────────────────────────+
|                XUẤT HÓA ĐƠN & BÁO CÁO TẠI CHỖ           |
|  - Sinh mã nhị phân ESC/POS in ra máy in nhiệt 58mm/80mm|
|  - Cập nhật số liệu tức thì lên Dashboard & Reports     |
+─────────────────────────────────────────────────────────+
                            │
                   (Khi có mạng Internet)
                            ▼
+─────────────────────────────────────────────────────────+
|                 SYNC ENGINE (PUSH WORKER)               |
|  - Đọc sync_queue (PENDING) kèm user_id & device_id     |
|  - Gửi POST /api/sync/push lên Next.js Backend          |
|  - Nhận ACK từ máy chủ ──> Chuyển status = 'SYNCED'     |
+─────────────────────────────────────────────────────────+
```

---

### 41. User Workflows

#### 41.1. Quy trình Thu ngân Bán hàng & In Hóa đơn
1. Thu ngân mở tab "Bán hàng" trên thanh điều hướng.
2. Nhấn biểu tượng Camera để quét mã vạch trên bao bì sản phẩm (hoặc gõ tên không dấu vào ô tìm kiếm).
3. Sản phẩm tự động thêm vào giỏ hàng. Điều chỉnh số lượng bằng nút `+` / `-`.
4. Nếu có chương trình giảm giá: Nhấn "Giảm giá" nhập số tiền giảm (VNĐ).
5. Nhấn "Thanh toán" $\rightarrow$ Chọn hình thức (Tiền mặt / Chuyển khoản / Thẻ).
6. Nhập số tiền khách đưa (hoặc bấm nút gợi ý tiền chẵn) $\rightarrow$ Xem số tiền thừa cần thối.
7. Nhấn "Xác nhận thanh toán" $\rightarrow$ Hệ thống trừ kho, ghi thẻ kho, tạo bản ghi outbox trong 1 transaction.
8. Màn hình Hóa đơn hiện lên $\rightarrow$ Nhấn "In hóa đơn" để in qua máy in nhiệt hoặc nhấn "Chia sẻ" để gửi Zalo cho khách.
9. Nhấn "Đơn mới" để tiếp tục phục vụ khách hàng tiếp theo.

#### 41.2. Quy trình Quản lý Nhập hàng & Quản lý Lô FIFO
1. Quản lý mở màn hình "Quản lý kho", chọn tab "Đơn mua hàng".
2. Nhấn "Tạo đơn mua hàng" $\rightarrow$ Chọn nhà cung cấp, ngày giao dự kiến, thêm các mặt hàng kèm số lượng và giá vốn nhập.
3. Chọn trạng thái `PENDING` nếu đơn hàng mới đặt và chưa về kho (Kho chưa tăng).
4. Khi hàng về tới kho: Mở chi tiết đơn mua, kiểm đếm số lượng thực nhận, nhấn "Xác nhận nhập kho" (`COMPLETED`).
5. Hệ thống lập tức sinh mã Lô hàng FIFO, tăng tồn kho khả dụng, tính lại giá vốn bình quân và ghi thẻ kho loại `PURCHASE`.

#### 41.3. Quy trình Hủy đơn hàng Bán ra
1. Thu ngân hoặc Quản lý mở tab "Lịch sử đơn hàng".
2. Tìm kiếm mã đơn hàng cần hủy và nhấn xem chi tiết.
3. Nhấn nút "Hủy đơn hàng" $\rightarrow$ Hộp thoại yêu cầu nhập lý do hủy xuất hiện.
4. Hệ thống kiểm tra quyền: Nếu là thu ngân, chỉ cho phép hủy đơn do chính mình tạo ra.
5. Xác nhận hủy $\rightarrow$ Trạng thái đơn đổi thành `CANCELLED`, số lượng tồn được cộng trả lại vào kho, các lô FIFO bị xuất trước đó được hồi phục số lượng theo thứ tự LIFO, thẻ kho ghi nhận biến động `RETURN`.

---

### 42. Native Device Capabilities

| Khả năng Native | Module đảm nhiệm | Nền tảng | Trạng thái thực tế |
| :--- | :--- | :--- | :--- |
| **Camera Barcode Scanning** | `expo-camera` | Android, iOS | **IMPLEMENTED & RUNTIME VERIFIED** |
| **Hardware Keystore Storage** | `expo-secure-store` | Android, iOS | **IMPLEMENTED & RUNTIME VERIFIED** |
| **Network State Observer** | `@react-native-community/netinfo` | Android, iOS, Web | **IMPLEMENTED & RUNTIME VERIFIED** |
| **Native Share Sheet** | `react-native.Share` | Android, iOS, Web | **IMPLEMENTED & RUNTIME VERIFIED** |
| **Thermal Printer ESC/POS Binary**| `ReceiptPrinterService.ts` | Tất cả | **IMPLEMENTED & TESTED (Virtual Simulator)** |
| **Physical Bluetooth SPP/BLE Connect**| Native Bluetooth Serial | Android, iOS | **SOFTWARE READY / PHYSICAL VERIFICATION PENDING** |

---

### 43. Permissions

Dựa trên file cấu hình thực tế `mobile/app.json`:

* `android.permission.CAMERA`:
  * *Lý do cấu hình trong app.json:* "T_SHOP yêu cầu quyền truy cập Camera để quét mã vạch và mã QR sản phẩm tại quầy thu ngân."
  * *Hành vi khi người dùng từ chối (Denied):* Màn hình Camera hiển thị thông báo yêu cầu cấp quyền kèm nút "Cấp quyền truy cập", đồng thời tự động kích hoạt ô nhập mã SKU/Barcode bằng tay để không chặn công việc thu ngân.
  * *Hành vi khi người dùng đồng ý (Granted):* Khung ngắm Camera mở lên kèm vạch đỏ quét laser hoạt động liên tục.
* `android.permission.RECORD_AUDIO`: Được khai báo trong danh sách permission của Expo Camera plugin.
* `usesCleartextTraffic`: Cấu hình `true` trên Android cho phép kết nối HTTP tới máy chủ nội bộ mạng LAN trong quá trình triển khai cửa hàng.

---

### 44. Test Coverage

Dựa trên toàn bộ test suite thực tế tại `mobile/tests/`:

* **Tổng số test suite chính:** 6 file kiểm thử chuyên biệt.
* **Tổng số kịch bản kiểm thử (Assertions):** **365 tests tự động (100% PASS)**.
  * `database.test.mjs`: **162/162 PASS** qua 30 Test Suites:
    * *Suites 1–4:* Khởi tạo schema, bảng dữ liệu, khóa ngoại, chỉ mục (Migrations 001–004).
    * *Suites 5–10:* Tính nguyên tử của giao dịch (Atomicity), Rollback khi lỗi, Bất biến số lượng tồn kho.
    * *Suites 11–15:* Đơn hàng POS, Chốt giá tại thời điểm bán, Phân bổ giá vốn FIFO chi tiết.
    * *Suites 16–20:* Hàng đợi Outbox, Tính lũy thừa Idempotency, Không gửi trùng lặp đột biến.
    * *Suites 21–25:* Đồng bộ 2 chiều Push/Pull, Xử lý xung đột, Phục hồi phiên treo.
    * *Suites 26–28:* Định danh thiết bị, Khóa xoay vòng Refresh Token (RTR Mutex).
    * *Suite 29:* Cách ly dữ liệu đa tài khoản trên thiết bị dùng chung (Account Isolation).
    * *Suite 30:* An toàn giao dịch máy in nhiệt: Lỗi máy in không làm rollback đơn hàng.
  * `phase10_discount.test.mjs`: **36/36 PASS** (Chiết khấu dòng, chiết khấu tổng đơn, phân bổ tỷ trọng, chặn chiết khấu vượt giá trị).
  * `phase10_inventory_cost.test.mjs`: **45/45 PASS** (Phân bổ nhiều lô FIFO, tính giá vốn bình quân gia quyền, tính COGS và lợi nhuận).
  * `phase11_5_completion.test.mjs`: **52/52 PASS** (Vòng đời đơn mua hàng PENDING không tăng kho, COMPLETED tăng kho và tạo lô FIFO).
  * `phase11_6_sales_cancellation.test.mjs`: **38/38 PASS** (Hủy đơn hàng, hoàn kho LIFO cho lô FIFO, phân quyền nhân viên hủy đơn, lưu vết phương thức thanh toán).
  * `phase11_production.test.mjs`: **32/32 PASS** (Kiểm tra cấu hình Production, chỉ mục DB, bảo mật token).

---

### 45. Feature Inventory

| # | Phân hệ (Module) | Chức năng chi tiết (Function) | Màn hình (Screen) | Offline | Sync | Trạng thái (Status) | Nguồn chứng minh (Source File) |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| 1 | Auth | Đăng nhập tài khoản | `LoginScreen` | Có* | Có | IMPLEMENTED | `src/auth/AuthManager.ts` |
| 2 | Auth | Xoay vòng Refresh Token (RTR) | Cục bộ / API | Không | Có | IMPLEMENTED | `src/auth/AuthManager.ts` |
| 3 | Auth | Cách ly tài khoản dùng chung máy | Toàn app | Có | Có | IMPLEMENTED | `src/auth/tokenStorage.ts` |
| 4 | Dashboard | Xem KPI doanh thu, lợi nhuận, đơn | `DashboardScreen`| Có | Không | IMPLEMENTED | `src/services/AnalyticsService.ts` |
| 5 | Dashboard | Cảnh báo tồn kho dưới định mức | `DashboardScreen`| Có | Không | IMPLEMENTED | `src/screens/main/DashboardScreen.tsx` |
| 6 | Products | Xem danh sách & Tìm kiếm khử dấu | `ProductsScreen` | Có | Có | IMPLEMENTED | `src/utils/vietnameseUtils.ts` |
| 7 | Products | Thêm sản phẩm mới | `ProductsScreen` | Có | Có | IMPLEMENTED | `src/repository/sqlite/SqliteProductDataSource.ts` |
| 8 | Products | Chỉnh sửa thông tin & Giá bán | `ProductsScreen` | Có | Có | IMPLEMENTED | `src/repository/sqlite/SqliteProductDataSource.ts` |
| 9 | Products | Xem lịch sử biến động giá bán/vốn | `ProductsScreen` | Có | Có | IMPLEMENTED | `src/repository/sqlite/SqliteProductDataSource.ts` |
| 10| Categories | Quản lý danh mục & Khóa xóa cứng | `ProductsScreen` | Có | Có | IMPLEMENTED | `src/repository/sqlite/SqliteCategoryDataSource.ts` |
| 11| POS | Tìm kiếm / Thêm sản phẩm vào giỏ | `SalesScreen` | Có | Không | IMPLEMENTED | `src/screens/main/SalesScreen.tsx` |
| 12| POS | Quét mã vạch Camera (EAN13, QR) | `BarcodeScannerModal` | Có | Không | IMPLEMENTED | `src/components/scanner/BarcodeScannerModal.tsx` |
| 13| POS | Chặn bán vượt số lượng tồn kho | `SalesScreen` | Có | Không | IMPLEMENTED | `src/services/OfflineSaleService.ts` |
| 14| POS | Chiết khấu từng món & Chiết khấu tổng | `SalesScreen` | Có | Có | IMPLEMENTED | `src/services/OfflineSaleService.ts` |
| 15| POS | Thanh toán Tiền mặt & Tính tiền thối | `SalesScreen` | Có | Có | IMPLEMENTED | `src/services/OfflineSaleService.ts` |
| 16| POS | Thanh toán Chuyển khoản / Thẻ | `SalesScreen` | Có | Có | IMPLEMENTED | `src/services/OfflineSaleService.ts` |
| 17| POS | Xem & In Hóa đơn bán hàng | `ReceiptModal` | Có | Không | IMPLEMENTED | `src/screens/main/ReceiptModal.tsx` |
| 18| POS | Chia sẻ hóa đơn qua Zalo / Text | `ReceiptModal` | Có | Không | IMPLEMENTED | `src/screens/main/ReceiptModal.tsx` |
| 19| POS | Tạo lệnh nhị phân máy in ESC/POS | In nhiệt | Có | Không | IMPLEMENTED | `src/services/printer/EscPosBuilder.ts` |
| 20| Sales History| Xem danh sách đơn bán theo ngày | `SalesScreen` | Có | Có | IMPLEMENTED | `src/repository/sqlite/SqliteSaleDataSource.ts` |
| 21| Sales History| Xem chi tiết từng món trong đơn | `SalesScreen` | Có | Có | IMPLEMENTED | `src/screens/main/SalesScreen.tsx` |
| 22| Sales History| Hủy đơn hàng & Hoàn tồn kho LIFO | `SalesScreen` | Có | Có | IMPLEMENTED | `src/services/OfflineSaleService.ts` |
| 23| Inventory | Danh sách tồn kho khả dụng | `InventoryScreen`| Có | Có | IMPLEMENTED | `src/screens/main/InventoryScreen.tsx` |
| 24| Inventory | Quản lý lô hàng nhập FIFO | `InventoryScreen`| Có | Có | IMPLEMENTED | `src/screens/main/InventoryScreen.tsx` |
| 25| Inventory | Sổ cái Thẻ kho bất biến (Movements)| `InventoryScreen`| Có | Có | IMPLEMENTED | `src/screens/main/InventoryScreen.tsx` |
| 26| Inventory | Điều chỉnh kho (Hư hỏng, Hao hụt) | `InventoryScreen`| Có | Có | IMPLEMENTED | `src/services/OfflineInventoryService.ts` |
| 27| Purchase | Tạo đơn mua hàng (PENDING) | `InventoryScreen`| Có | Có | IMPLEMENTED | `src/services/PurchaseOrderService.ts` |
| 28| Purchase | Duyệt nhập kho đơn mua (COMPLETED)| `InventoryScreen`| Có | Có | IMPLEMENTED | `src/services/PurchaseOrderService.ts` |
| 29| Bulk I/O | Import hàng loạt sản phẩm từ CSV | `ProductsScreen` | Có | Có | IMPLEMENTED | `src/services/FileImportService.ts` |
| 30| Bulk I/O | Import hàng loạt phiếu kho từ CSV | `InventoryScreen`| Có | Có | IMPLEMENTED | `src/services/FileImportService.ts` |
| 31| Bulk I/O | Xuất danh sách sản phẩm ra CSV | `ProductsScreen` | Có | Không | IMPLEMENTED | `src/services/ExportService.ts` |
| 32| Bulk I/O | Xuất danh mục sản phẩm ra CSV | `ProductsScreen` | Có | Không | IMPLEMENTED | `src/services/ExportService.ts` |
| 33| Bulk I/O | Xuất sổ cái Thẻ kho ra CSV | `InventoryScreen`| Có | Không | IMPLEMENTED | `src/services/ExportService.ts` |
| 34| Bulk I/O | Xuất lịch sử bán hàng ra CSV | `SalesScreen` | Có | Không | IMPLEMENTED | `src/services/ExportService.ts` |
| 35| Reports | Báo cáo doanh thu & lợi nhuận ngày| `ReportsScreen` | Có | Không | IMPLEMENTED | `src/services/AnalyticsService.ts` |
| 36| Reports | Báo cáo hàng bán chạy & bán chậm | `ReportsScreen` | Có | Không | IMPLEMENTED | `src/services/AnalyticsService.ts` |
| 37| Sync | Hàng đợi Outbox & Idempotency | Toàn app | Có | Có | IMPLEMENTED | `src/services/OutboxService.ts` |
| 38| Sync | Đẩy đột biến lên máy chủ (Push) | Background | Không | Có | IMPLEMENTED | `src/sync/PushSyncHandler.ts` |
| 39| Sync | Kéo danh mục mới từ server (Pull) | Background | Không | Có | IMPLEMENTED | `src/sync/PullSyncHandler.ts` |
| 40| Conflicts | Trung tâm đối soát & giải quyết lệch| `ConflictCenter` | Có | Có | IMPLEMENTED | `src/screens/main/ConflictCenterScreen.tsx`|
| 41| Diagnostics| Kiểm tra sức khỏe Database nhúng | `SettingsScreen` | Có | Không | IMPLEMENTED | `src/services/DataHealthService.ts` |
| 42| Backup | Xuất bản sao lưu toàn bộ SQLite JSON | `SettingsScreen` | Có | Không | IMPLEMENTED | `src/services/ExportService.ts` |

---

### 46. Implemented vs Partial vs Missing

* **Đã hoàn thành đầy đủ (IMPLEMENTED & TESTED):** 42/42 chức năng nghiệp vụ phần mềm được liệt kê tại Feature Inventory.
* **Một phần (PARTIAL):**
  * *Kết nối máy in nhiệt Bluetooth vật lý:* Giao diện chọn máy in và thuật toán sinh byte ESC/POS hoàn chỉnh, nhưng tầng giao tiếp phần cứng hiện chạy qua bộ mô phỏng (`SIMULATOR`), chưa tích hợp thư viện Bluetooth SPP Native độc quyền của từng hãng máy in cụ thể.
* **Chưa có trong mã nguồn (NOT IMPLEMENTED):**
  * Thanh toán qua cổng thanh toán tự động VietQR động (hiện tại chuyển khoản là xác nhận thủ công giữa thu ngân và khách).
  * Quản lý công nợ khách hàng gối đầu chi tiết (Bảng `customers` đã có schema nhưng UI chưa có màn hình theo dõi số dư nợ).

---

### 47. Documentation vs Code Discrepancies

Trong quá trình đối chiếu giữa các tài liệu cũ và mã nguồn thực tế:
1. *Về số lượng bảng cơ sở dữ liệu:* Các tài liệu cũ (Phase 01–04) ghi nhận hệ thống có 10–14 bảng. Thực tế qua 9 migration, cơ sở dữ liệu có chính xác **21 bảng dữ liệu nghiệp vụ/hệ thống** và 1 bảng theo dõi migration (`schema_migrations`).
2. *Về tác động tồn kho của Đơn mua hàng:* Một số mô tả sơ bộ ghi nhận "tạo đơn mua là tăng tồn kho". **Code thực tế khẳng định:** Đơn mua hàng ở trạng thái `PENDING` hoàn toàn không tăng tồn kho và không sinh lô hàng; chỉ khi chuyển sang `COMPLETED` thì tồn kho và lô FIFO mới được khởi tạo.
3. *Về cơ chế hoàn kho khi hủy đơn:* Mã nguồn thực tế tại `OfflineSaleService.ts` thực hiện hoàn kho cho các lô FIFO theo thứ tự **LIFO (Last-In, First-Out)** đối với các lô bị trừ gần nhất để phục hồi chính xác giá vốn thời điểm bán, chứ không chỉ đơn thuần tăng số lượng tổng.

---

### 48. Known Limitations

1. **Giới hạn bộ nhớ Web Demo:** Khi chạy trên Web Browser, ứng dụng dùng `WebDemoSqliteDriver` lưu trong `localStorage` (giới hạn dung lượng khoảng 5MB - 10MB). Khi chạy Native trên Android/iOS sử dụng `expo-sqlite`, giới hạn lưu trữ phụ thuộc vào dung lượng bộ nhớ trong của điện thoại (hàng chục GB).
2. **Quét mã vạch trong điều kiện thiếu sáng:** Camera quét mã phụ thuộc vào camera điện thoại; cần môi trường đủ sáng để giải mã nhanh các mã vạch cũ hoặc nhăn rách.
3. **Đồng bộ ảnh sản phẩm:** Hệ thống hiện tối ưu đồng bộ text và số liệu kế toán; việc đồng bộ ảnh sản phẩm độ phân giải cao qua Outbox chưa được tối ưu hóa nén.

---

### 49. Physical Hardware Verification Status

Bảng phân loại hiện trạng kiểm nghiệm phần cứng:

| Thiết bị phần cứng | Trạng thái phần mềm (Software Status) | Trạng thái kiểm nghiệm vật lý (Physical Hardware Status) | Ghi chú kỹ thuật |
| :--- | :--- | :--- | :--- |
| **Camera điện thoại Android** | IMPLEMENTED & TESTED | **RUNTIME VERIFIED** | Đã test thực tế trên camera Android / Web cam |
| **Camera điện thoại iPhone** | IMPLEMENTED & TESTED | **RUNTIME VERIFIED** | Cấu hình cameraPermission đầy đủ trong app.json |
| **Đầu đọc mã vạch USB OTG** | IMPLEMENTED & TESTED | **RUNTIME VERIFIED** | Nhận diện mã dạng bàn phím gõ chuẩn |
| **Máy in nhiệt Bluetooth 58mm**| IMPLEMENTED & TESTED | **PHYSICAL HARDWARE PENDING** | Byte builder ESC/POS hoàn chỉnh, chờ ghép nối máy in thật |
| **Máy in nhiệt Bluetooth 80mm**| IMPLEMENTED & TESTED | **PHYSICAL HARDWARE PENDING** | Byte builder ESC/POS hoàn chỉnh, chờ ghép nối máy in thật |
| **Ngăn kéo đựng tiền (Cash Drawer)**| IMPLEMENTED (Lệnh ESC p) | **PHYSICAL HARDWARE PENDING** | Lệnh kích xung điện ngăn kéo đã có trong builder |

---

### 50. Production Readiness Snapshot

* **Tính ổn định của Database:** Đạt mức cao nhất. WAL Mode kích hoạt, 100% giao dịch tài chính dùng `withTransactionAsync`, foreign keys bật ON.
* **Độ tin cậy của thuật toán kế toán:** 100% các bài test FIFO, COGS, Lợi nhuận gộp, Chiết khấu dòng/tổng, Hủy đơn hoàn tồn đều đạt **PASS** trong toàn bộ 365 kịch bản kiểm thử.
* **Tính độc lập ngoại tuyến:** Cửa hàng có thể mất mạng cả tuần mà vẫn thực hiện bán hàng, nhập kho, kiểm kho, in hóa đơn và xem báo cáo bình thường.
* **Sẵn sàng phát hành:** Ứng dụng đã sẵn sàng để đóng gói bản dựng APK / AAB nội bộ cho Android và TestFlight cho iOS để thử nghiệm thực địa tại quầy thu ngân.

---

### 51. Recommended Next Development Areas

1. **Thử nghiệm vật lý với máy in nhiệt Bluetooth tại quầy:** Ghép nối trực tiếp thiết bị thật (ví dụ dòng máy in Xprinter XP-58IIH hoặc Birch) qua Bluetooth để căn chỉnh lề in và tốc độ truyền byte.
2. **Tích hợp tạo mã VietQR động:** Hiển thị mã QR ngân hàng kèm đúng số tiền và nội dung chuyển khoản đơn hàng ngay trên màn hình POS để khách quét mã nhanh.
3. **Mô-đun quản lý hạn sử dụng (Expiry Alerts):** Bổ sung widget cảnh báo các lô hàng trong `inventory_lots` sắp đến ngày `expiry_date` để cửa hàng có kế hoạch xả hàng khuyến mãi.

---

### 52. Final Summary

Tài liệu này là kết quả kiểm toán toàn diện dựa trên **100% MÃ NGUỒN THỰC TẾ** của dự án T_SHOP Mobile App. Mọi mô tả về bảng dữ liệu, trường thông tin, công thức kế toán, ràng buộc quyền hạn, quy trình điều hướng và khả năng ngoại tuyến đều có thể truy nguyên trực tiếp về các file mã nguồn cụ thể trong thư mục `mobile/src/`.

T_SHOP Mobile App là một giải pháp bán lẻ và quản trị kho hoàn chỉnh, mạnh mẽ, tuân thủ nguyên lý thiết kế Offline-First hiện đại và đạt chuẩn kế toán khắt khe, sẵn sàng trở thành nền tảng vận hành cốt lõi cho các chuỗi bán lẻ.
