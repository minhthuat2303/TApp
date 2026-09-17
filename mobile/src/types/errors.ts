export type ErrorCode = 
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'AUTH_FAILED'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR';

export interface AppError {
  code: ErrorCode;
  message: string;
  statusCode?: number;
  details?: Record<string, unknown>;
  originalError?: unknown;
}

export class MobileError extends Error implements AppError {
  code: ErrorCode;
  statusCode?: number;
  details?: Record<string, unknown>;
  originalError?: unknown;

  constructor(code: ErrorCode, message: string, statusCode?: number, details?: Record<string, unknown>, originalError?: unknown) {
    super(message);
    this.name = 'MobileError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.originalError = originalError;
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof MobileError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.message.includes('Network') || error.message.includes('Failed to fetch') || error.message.includes('network')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng hoặc chuyển sang chế độ ngoại tuyến.',
        originalError: error,
      };
    }
    if (error.message.includes('timed out') || error.message.includes('timeout')) {
      return {
        code: 'TIMEOUT_ERROR',
        message: 'Yêu cầu kết nối quá thời gian chờ (Timeout). Vui lòng thử lại.',
        originalError: error,
      };
    }
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'Đã xảy ra lỗi không xác định.',
      originalError: error,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'Đã xảy ra lỗi không xác định.',
    originalError: error,
  };
}
