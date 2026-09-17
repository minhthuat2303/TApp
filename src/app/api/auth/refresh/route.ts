import { NextRequest, NextResponse } from 'next/server';
import { rotateRefreshToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawRefreshToken = body.refreshToken || body.refresh_token;
    const deviceId = body.deviceId || body.device_id || request.headers.get('x-device-id');

    if (!rawRefreshToken || !deviceId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Thiếu refreshToken hoặc deviceId trong yêu cầu làm mới phiên.',
          },
        },
        { status: 400 }
      );
    }

    const result = await rotateRefreshToken(rawRefreshToken, deviceId);

    return NextResponse.json({
      success: true,
      data: {
        token: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    });
  } catch (error: any) {
    const message = error.message || '';
    let status = 401;
    let code = 'AUTH_ERROR';

    if (message === 'SESSION_REVOKED' || message === 'TOKEN_REUSE_DETECTED') {
      code = 'SESSION_REVOKED';
      status = 401;
    } else if (message === 'REFRESH_TOKEN_EXPIRED') {
      code = 'AUTH_EXPIRED';
      status = 401;
    } else if (message === 'DEVICE_REVOKED') {
      code = 'DEVICE_REVOKED';
      status = 401;
    } else if (message === 'DEVICE_MISMATCH' || message === 'INVALID_REFRESH_TOKEN') {
      code = 'INVALID_REFRESH_TOKEN';
      status = 401;
    } else if (message === 'USER_INACTIVE' || message === 'SESSION_INACTIVE') {
      code = 'USER_INACTIVE';
      status = 401;
    } else {
      status = 500;
      code = 'SERVER_ERROR';
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code,
          message: message || 'Không thể làm mới token xác thực.',
        },
      },
      { status }
    );
  }
}
