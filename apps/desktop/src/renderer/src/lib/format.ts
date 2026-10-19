export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  const diff = Date.now() - timestamp
  const abs = Math.abs(diff)
  if (abs < 45_000) return diff >= 0 ? '刚刚' : '即将'
  if (abs < 3_600_000) {
    const minutes = Math.round(abs / 60_000)
    return diff >= 0 ? `${minutes} 分钟前` : `${minutes} 分钟后`
  }
  if (abs < 86_400_000) {
    const hours = Math.round(abs / 3_600_000)
    return diff >= 0 ? `${hours} 小时前` : `${hours} 小时后`
  }
  if (abs < 7 * 86_400_000) {
    const days = Math.round(abs / 86_400_000)
    return diff >= 0 ? `${days} 天前` : `${days} 天后`
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

export function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(timestamp)
}

export function formatDuration(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt) return '—'
  const end = finishedAt ?? Date.now()
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function truncate(value: string, limit = 120): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}
