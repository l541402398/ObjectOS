export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '发生未知错误'
}

export function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return null
}

export function isProviderMissing(error: unknown): boolean {
  return errorCode(error) === 'PROVIDER_NOT_CONFIGURED' || errorMessage(error).includes('尚未配置模型 Provider')
}
