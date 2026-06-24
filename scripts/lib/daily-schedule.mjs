/**
 * Schedule a callback once per day at a fixed local time (hour:minute).
 */
export function scheduleDailyAt(hour, minute, fn, { label = 'daily task' } = {}) {
  function msUntilNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  function logNextRun() {
    const delay = msUntilNext();
    const nextAt = new Date(Date.now() + delay);
    const formatted = nextAt.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    console.log(`[schedule] ${label} next run at ${formatted}`);
  }

  async function runAndReschedule() {
    try {
      await fn();
    } catch (error) {
      console.error(`[schedule] ${label} failed:`, error.message);
    }
    logNextRun();
    setTimeout(runAndReschedule, msUntilNext());
  }

  logNextRun();
  setTimeout(runAndReschedule, msUntilNext());
}

export function parseScheduleTime(value, fallbackHour = 13, fallbackMinute = 0) {
  if (!value) return { hour: fallbackHour, minute: fallbackMinute };
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`invalid schedule time "${value}", use HH:MM`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`invalid schedule time "${value}"`);
  }
  return { hour, minute };
}
