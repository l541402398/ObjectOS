import type { AIErrorCode } from '@projectos/contracts'

export interface ClassifiedConnectionError {
  code: AIErrorCode
  message: string
  suggestion: string
  retryable: boolean
}

const MESSAGES: Record<AIErrorCode, { message: string; suggestion: string; retryable: boolean }> = {
  INVALID_KEY: {
    message: 'API Key 无效或没有访问权限',
    suggestion: '检查 API Key、账号权限和 Base URL 是否属于同一服务商。',
    retryable: false,
  },
  INSUFFICIENT_QUOTA: {
    message: '账户额度不足',
    suggestion: '充值或更换有额度的账号后重试。',
    retryable: false,
  },
  RATE_LIMITED: {
    message: '请求被服务商限流',
    suggestion: '稍后重试，或降低并发。',
    retryable: true,
  },
  MODEL_NOT_FOUND: {
    message: '模型不存在或当前账号不可用',
    suggestion: '从模型目录选择可用模型，或手动填写正确的模型 ID。',
    retryable: false,
  },
  PROTOCOL_MISMATCH: {
    message: '服务响应不符合所选协议',
    suggestion: '确认服务是 OpenAI-compatible 接口，并检查 Base URL 是否包含正确路径。',
    retryable: false,
  },
  TLS_ERROR: {
    message: 'TLS/证书校验失败',
    suggestion: '检查系统时间、代理证书和企业网络策略。',
    retryable: false,
  },
  PROXY_ERROR: {
    message: '代理连接失败',
    suggestion: '检查系统代理、代理地址和代理认证。',
    retryable: true,
  },
  TIMEOUT: {
    message: '连接超时',
    suggestion: '检查网络或提高超时时间。',
    retryable: true,
  },
  NETWORK_UNREACHABLE: {
    message: '无法连接服务地址',
    suggestion: '检查 Base URL、DNS 和网络连通性。',
    retryable: true,
  },
  UNKNOWN: {
    message: '连接失败',
    suggestion: '查看错误详情并检查服务状态。',
    retryable: true,
  },
}

export function classifyHttpStatus(status: number, body = ''): ClassifiedConnectionError {
  const detail = body.trim().slice(0, 300)
  let code: AIErrorCode = 'UNKNOWN'
  if (status === 401 || status === 403) code = 'INVALID_KEY'
  else if (status === 402) code = 'INSUFFICIENT_QUOTA'
  else if (status === 429) code = 'RATE_LIMITED'
  else if (status === 404) code = 'MODEL_NOT_FOUND'
  else if (status === 400 || status === 405 || status === 422) code = 'PROTOCOL_MISMATCH'
  const base = MESSAGES[code]
  return {
    code,
    message: detail ? `${base.message}（HTTP ${status}：${detail}）` : `${base.message}（HTTP ${status}）`,
    suggestion: base.suggestion,
    retryable: base.retryable,
  }
}

export function classifyFetchError(error: unknown): ClassifiedConnectionError {
  const record = error as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  const name = record?.name ?? ''
  const message = `${record?.message ?? ''} ${record?.cause?.code ?? ''} ${record?.cause?.message ?? ''}`.trim()
  let code: AIErrorCode = 'UNKNOWN'
  if (name === 'AbortError' || /timeout|timed out|ETIMEDOUT/i.test(message)) code = 'TIMEOUT'
  else if (/CERT|TLS|SSL|self[- ]signed|UNABLE_TO_VERIFY/i.test(message)) code = 'TLS_ERROR'
  else if (/proxy|ECONNRESET|ECONNREFUSED.*proxy|tunnel/i.test(message)) code = 'PROXY_ERROR'
  else if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|network|fetch failed/i.test(message)) {
    code = 'NETWORK_UNREACHABLE'
  } else if (/JSON|Unexpected token|invalid response|protocol/i.test(message)) code = 'PROTOCOL_MISMATCH'
  const base = MESSAGES[code]
  return {
    code,
    message: message ? `${base.message}：${message.slice(0, 300)}` : base.message,
    suggestion: base.suggestion,
    retryable: base.retryable,
  }
}

export function diagnosticFor(code: AIErrorCode): ClassifiedConnectionError {
  const base = MESSAGES[code]
  return { code, ...base }
}
