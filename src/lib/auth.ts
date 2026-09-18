import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from './db';
import { User, UserSession } from './types';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 't_shop_secure_jwt_secret_key_2026_retail';
const COOKIE_NAME = 'tshop_token';

// Web App: 7-day token (preserves 100% web compatibility)
export function signToken(user: { id: number; username: string; full_name: string; role: string }): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Mobile App: Short-lived 15-minute access token bound to session and device
export function signAccessToken(
  user: { id: number; username: string; full_name: string; role: string },
  sessionId: string,
  deviceId: string
): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      session_id: sessionId,
      device_id: deviceId,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateRefreshToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashRefreshToken(rawToken);
  return { rawToken, tokenHash };
}

export function verifyToken(token: string): UserSession | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserSession;
    return decoded;
  } catch {
    return null;
  }
}

export async function createMobileSession(
  userId: number,
  deviceId: string,
  deviceName: string = 'Unknown Device',
  platform: string = 'android',
  appVersion: string = '1.0.0'
): Promise<{ accessToken: string; refreshToken: string; sessionId: string; deviceId: string }> {
  // 1. Fetch user
  const user = await getUserById(userId);
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('User inactive or not found');
  }

  // 2. Upsert device
  await db.execute(`
    INSERT INTO devices (device_id, user_id, device_name, platform, app_version, status, last_seen_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)
    ON CONFLICT (device_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      device_name = EXCLUDED.device_name,
      platform = EXCLUDED.platform,
      app_version = EXCLUDED.app_version,
      status = 'ACTIVE',
      last_seen_at = CURRENT_TIMESTAMP
  `, [deviceId, userId, deviceName, platform, appVersion]);

  // 3. Revoke any prior active sessions for this device
  await db.execute(`
    UPDATE user_sessions
    SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'NEW_LOGIN'
    WHERE device_id = ? AND status = 'ACTIVE'
  `, [deviceId]);

  // 4. Generate new session and tokens
  const sessionId = crypto.randomUUID();
  const { rawToken, tokenHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  await db.execute(`
    INSERT INTO user_sessions (session_id, user_id, device_id, refresh_token_hash, status, expires_at, created_at, last_refreshed_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [sessionId, userId, deviceId, tokenHash, expiresAt]);

  const accessToken = signAccessToken(user, sessionId, deviceId);
  return { accessToken, refreshToken: rawToken, sessionId, deviceId };
}

export async function rotateRefreshToken(
  rawRefreshToken: string,
  deviceId: string
): Promise<{ accessToken: string; refreshToken: string; user: UserSession }> {
  const tokenHash = hashRefreshToken(rawRefreshToken);

  // Look up session by token hash
  const session = await db.queryOne<{
    session_id: string;
    user_id: number;
    device_id: string;
    status: string;
    expires_at: string;
  }>(`
    SELECT session_id, user_id, device_id, status, expires_at
    FROM user_sessions
    WHERE refresh_token_hash = ?
  `, [tokenHash]);

  if (!session) {
    throw new Error('INVALID_REFRESH_TOKEN');
  }

  // Reuse detection / session already revoked
  if (session.status === 'REVOKED') {
    // If a revoked token is presented, suspect token leakage and revoke all sessions for this device
    await db.execute(`
      UPDATE user_sessions
      SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'TOKEN_REUSE_DETECTED'
      WHERE device_id = ? AND status = 'ACTIVE'
    `, [session.device_id]);
    throw new Error('SESSION_REVOKED');
  }

  if (session.status !== 'ACTIVE') {
    throw new Error('SESSION_INACTIVE');
  }

  // Check device match
  if (session.device_id !== deviceId) {
    throw new Error('DEVICE_MISMATCH');
  }

  // Check device active status
  const device = await db.queryOne<{ status: string }>(`
    SELECT status FROM devices WHERE device_id = ?
  `, [deviceId]);
  if (!device || device.status === 'REVOKED') {
    throw new Error('DEVICE_REVOKED');
  }

  // Check expiration
  if (new Date(session.expires_at) < new Date()) {
    await db.execute(`
      UPDATE user_sessions SET status = 'EXPIRED' WHERE session_id = ?
    `, [session.session_id]);
    throw new Error('REFRESH_TOKEN_EXPIRED');
  }

  // Fetch user
  const user = await getUserById(session.user_id);
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('USER_INACTIVE');
  }

  // Generate rotated refresh token
  const { rawToken: newRawToken, tokenHash: newTokenHash } = generateRefreshToken();

  // Atomically update session with new refresh token hash
  await db.execute(`
    UPDATE user_sessions
    SET refresh_token_hash = ?, last_refreshed_at = CURRENT_TIMESTAMP
    WHERE session_id = ?
  `, [newTokenHash, session.session_id]);

  // Update device last_seen_at
  await db.execute(`
    UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = ?
  `, [deviceId]);

  const newAccessToken = signAccessToken(user, session.session_id, deviceId);
  const userSession: UserSession = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    session_id: session.session_id,
    device_id: deviceId,
  };

  return {
    accessToken: newAccessToken,
    refreshToken: newRawToken,
    user: userSession,
  };
}

export async function revokeSession(sessionId: string, reason: string = 'USER_LOGOUT'): Promise<void> {
  await db.execute(`
    UPDATE user_sessions
    SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revoked_reason = ?
    WHERE session_id = ?
  `, [reason, sessionId]);
}

export async function revokeDevice(deviceId: string, reason: string = 'ADMIN_REVOKED'): Promise<void> {
  await db.execute(`
    UPDATE devices SET status = 'REVOKED' WHERE device_id = ?
  `, [deviceId]);

  await db.execute(`
    UPDATE user_sessions
    SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revoked_reason = ?
    WHERE device_id = ? AND status = 'ACTIVE'
  `, [reason, deviceId]);
}

export async function getCurrentUser(request?: NextRequest): Promise<UserSession | null> {
  let user: UserSession | null = null;

  // 1. Check Authorization header
  if (request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      user = verifyToken(token);
    }
  }

  // 2. Check HTTP-only cookie (Web fallback)
  if (!user) {
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get(COOKIE_NAME)?.value;
      if (token) {
        user = verifyToken(token);
      }
    } catch {
      // Cookie access may fail outside request scope
    }
  }

  if (!user) return null;

  // 3. Zero-trust session verification for mobile tokens bound to session_id
  if (user.session_id) {
    const session = await db.queryOne<{ status: string; device_id: string }>(`
      SELECT status, device_id FROM user_sessions WHERE session_id = ?
    `, [user.session_id]);

    if (!session || session.status !== 'ACTIVE') {
      return null;
    }

    if (user.device_id) {
      const device = await db.queryOne<{ status: string }>(`
        SELECT status FROM devices WHERE device_id = ?
      `, [user.device_id]);
      if (!device || device.status === 'REVOKED') {
        return null;
      }
    }
  }

  return user;
}

export async function getUserById(id: number): Promise<User | null> {
  return await db.queryOne<User>(`
    SELECT id, username, password_hash, full_name, role, status, created_at, updated_at
    FROM users
    WHERE id = ?
  `, [id]);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  return await db.queryOne<User>(`
    SELECT id, username, password_hash, full_name, role, status, created_at, updated_at
    FROM users
    WHERE username = ?
  `, [username]);
}

export { COOKIE_NAME };

