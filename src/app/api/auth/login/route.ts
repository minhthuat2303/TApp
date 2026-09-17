import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByUsername, signToken, createMobileSession, COOKIE_NAME } from '@/lib/auth';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, device_id, device_name, platform, app_version } = body;

    if (!username || !password) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' },
        },
        { status: 400 }
      );
    }

    const user = await getUserByUsername(username);

    if (!user || user.status !== 'ACTIVE') {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'AUTH_FAILED', message: 'Tên đăng nhập hoặc mật khẩu không chính xác.' },
        },
        { status: 401 }
      );
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'AUTH_FAILED', message: 'Tên đăng nhập hoặc mật khẩu không chính xác.' },
        },
        { status: 401 }
      );
    }

    // Branch: Mobile Login with Device ID vs Standard Web Login
    if (device_id) {
      const mobileSession = await createMobileSession(
        user.id,
        device_id,
        device_name || 'Mobile Device',
        platform || 'android',
        app_version || '1.0.0'
      );

      // Log audit login
      try {
        await db.execute(`
          INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
          VALUES (?, 'USER_LOGIN_MOBILE', 'DEVICES', ?, ?)
        `, [user.id, device_id, JSON.stringify({ username: user.username, role: user.role, device_id, platform })]);
      } catch (e) {
        console.error('Failed to write audit log:', e);
      }

      const response = NextResponse.json({
        success: true,
        data: {
          token: mobileSession.accessToken,
          refreshToken: mobileSession.refreshToken,
          session_id: mobileSession.sessionId,
          device_id: mobileSession.deviceId,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            session_id: mobileSession.sessionId,
            device_id: mobileSession.deviceId,
          },
        },
      });

      return response;
    }

    // Standard Web Login
    const token = signToken({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
    });

    // Log audit login
    try {
      await db.execute(`
        INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
        VALUES (?, 'USER_LOGIN', 'USERS', ?, ?)
      `, [user.id, user.id.toString(), JSON.stringify({ username: user.username, role: user.role })]);
    } catch (e) {
      console.error('Failed to write audit log:', e);
    }

    const response = NextResponse.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
        },
      },
    });

    response.cookies.set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      sameSite: 'lax',
    });

    return response;
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message || 'Lỗi xử lý đăng nhập' },
      },
      { status: 500 }
    );
  }
}
