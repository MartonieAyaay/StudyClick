const STORAGE_KEY = 'studyclick_usage_v1'

export const DAILY_REQUEST_LIMIT = 1000

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { date: todayKey(), tokensUsed: 0, requestsUsed: 0 }
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.date !== todayKey()) {
      return { date: todayKey(), tokensUsed: 0, requestsUsed: 0 }
    }
    return {
      date: parsed.date,
      tokensUsed: parsed.tokensUsed || 0,
      requestsUsed: parsed.requestsUsed || 0,
    }
  } catch {
    return { date: todayKey(), tokensUsed: 0, requestsUsed: 0 }
  }
}

function persist(usage) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage))
  } catch {
    return
  }
}

export function getUsage() {
  const usage = loadRaw()
  persist(usage)
  return usage
}

export function recordUsage(tokens = 0, requests = 1) {
  const current = loadRaw()
  const next = {
    date: todayKey(),
    tokensUsed: current.tokensUsed + (tokens || 0),
    requestsUsed: current.requestsUsed + requests,
  }
  persist(next)
  return next
}

export function getRequestStatus(usage) {
  const used = usage.requestsUsed
  const remaining = Math.max(0, DAILY_REQUEST_LIMIT - used)
  const fractionUsed = used / DAILY_REQUEST_LIMIT

  if (fractionUsed >= 0.95) {
    return {
      level: 'red',
      remaining,
      message: "At or very close to today's request limit. New generations may start failing until it resets.",
    }
  }
  if (fractionUsed >= 0.7) {
    return {
      level: 'yellow',
      remaining,
      message: "Getting close to today's request limit — you may hit a wall before the day resets.",
    }
  }
  return {
    level: 'green',
    remaining,
    message: 'Plenty of requests left today.',
  }
}