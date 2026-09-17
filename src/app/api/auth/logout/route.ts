import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, getCurrentUser, revokeSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {}

    const user = await getCurrentUser(request);
    const sessionId = body?.session_id || body?.sessionId || user?.session_id;

    if (sessionId) {
      await revokeSession(sessionId, 'USER_LOGOUT');
    }

    const response = NextResponse.json({
      success: true,
      data: { message: 'Đăng xuất thành công.' },
    });

    response.cookies.set({
      name: COOKIE_NAME,
      value: '',
      httpOnly: true,
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'LOGOUT_ERROR', message: error.message || 'Lỗi khi đăng xuất' },
      },
      { status: 500 }
    );
  }
}

