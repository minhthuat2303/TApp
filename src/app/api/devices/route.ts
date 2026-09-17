import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để xem danh sách thiết bị.' } },
        { status: 401 }
      );
    }

    let sql = `
      SELECT 
        d.device_id,
        d.user_id,
        d.device_name,
        d.platform,
        d.app_version,
        d.status,
        d.created_at,
        d.last_seen_at,
        u.username,
        u.full_name,
        (
          SELECT s.session_id 
          FROM user_sessions s 
          WHERE s.device_id = d.device_id AND s.status = 'ACTIVE' 
          LIMIT 1
        ) as active_session_id
      FROM devices d
      LEFT JOIN users u ON d.user_id = u.id
    `;
    const params: any[] = [];

    // STAFF can only view their own devices; ADMIN can view all
    if (user.role !== 'ADMIN') {
      sql += ` WHERE d.user_id = ? `;
      params.push(user.id);
    }

    sql += ` ORDER BY d.last_seen_at DESC `;

    const devices = await db.query(sql, params);

    return NextResponse.json({
      success: true,
      data: devices,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: error.message || 'Lỗi tải danh sách thiết bị.' } },
      { status: 500 }
    );
  }
}
