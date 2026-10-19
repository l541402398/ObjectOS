import { z } from 'zod'

export const ERROR_CODES = [
  'BAD_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_ERROR',
  'SECRET_STORAGE_UNAVAILABLE',
  'RUNTIME_UNAVAILABLE',
  'TIMEOUT',
  'WORKSPACE_OUTSIDE_ROOT',
  'NOT_IMPLEMENTED',
  'CANCELLED',
  'INTERNAL',
] as const

export const ErrorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export interface SerializedAppError {
  code: ErrorCode
  message: string
  details?: unknown
  retryable?: boolean
}

export const SerializedAppErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().optional(),
})

export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown
  readonly retryable: boolean

  constructor(code: ErrorCode, message: string, options?: { details?: unknown; retryable?: boolean }) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = options?.details
    this.retryable = options?.retryable ?? false
  }

  toJSON(): SerializedAppError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      retryable: this.retryable,
    }
  }
}

export function serializeError(error: unknown): SerializedAppError {
  if (error instanceof AppError) return error.toJSON()
  if (error instanceof z.ZodError) {
    return {
      code: 'BAD_REQUEST',
      message: '请求参数不合法',
      details: z.treeifyError(error),
      retryable: false,
    }
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL', message: error.message, retryable: false }
  }
  return { code: 'INTERNAL', message: String(error), retryable: false }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

export function assert(condition: unknown, code: ErrorCode, message: string): asserts condition {
  if (!condition) throw new AppError(code, message)
}
