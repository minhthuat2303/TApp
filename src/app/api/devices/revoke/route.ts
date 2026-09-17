import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser, revokeDevice } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const deviceId = body.device_id || body.deviceId;
    const reason = body.reason || 'USER_REQUESTED_REVOCATION';

    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Thiếu device_id.' } },
        { status: 400 }
      );
    }

    // Check ownership if STAFF
    if (user.role !== 'ADMIN') {
      const device = await db.queryOne<{ user_id: number }>(`
        SELECT user_id FROM devices WHERE device_id = ?
      `, [deviceId]);

      if (!device || device.user_id !== user.id) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Bạn không có quyền thu hồi thiết bị của người dùng khác.',
            },
          },
          { status: 403 }
        );
      }
    }

    await revokeDevice(deviceId, reason);

    // Audit log
    try {
      await db.execute(`
        INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
        VALUES (?, 'REVOKE_DEVICE', 'DEVICES', ?, ?)
      `, [user.id, deviceId, JSON.stringify({ device_id: deviceId, reason, revoked_by: user.username })]);
    } catch {}

    return NextResponse.json({
      success: true,
      data: { message: `Thiết bị ${deviceId} đã được thu hồi quyền truy cập thành công.` },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: error.message || 'Lỗi khi thu hồi thiết bị.' } },
      { status: 500 }
    );
  }
}
