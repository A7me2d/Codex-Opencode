function allowance(window) {
  if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) {
    return { available: false, remainingPercent: null, resetsAt: null }
  }
  return { available: true, remainingPercent: Math.round((100 - Math.max(0, Math.min(100, window.usedPercent))) * 10) / 10,
    resetsAt: typeof window.resetsAt === 'number' ? window.resetsAt : null }
}

/** Match each actual Codex allowance by duration, independent of primary/secondary order. */
export function codexWeeklyQuota(response) {
  const bucket = response?.rateLimitsByLimitId?.codex
    ?? (response?.rateLimits?.limitId == null || response.rateLimits.limitId === 'codex' ? response?.rateLimits : null)
  const windows = [bucket?.primary, bucket?.secondary]
  return { ...allowance(windows.find(value => value?.windowDurationMins === 7 * 24 * 60)),
    fiveHour: allowance(windows.find(value => value?.windowDurationMins === 5 * 60)) }
}
