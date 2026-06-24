export const DEFAULT_GROUP_TAB_URL = 'https://wx.zsxq.com/group/28518511148841';

export const DEFAULT_EXPORT_TRIGGER = {
  reload: true,
  wait: true,
  timeoutMs: 300_000,
  tabUrl: DEFAULT_GROUP_TAB_URL
};

/**
 * Dispatch refresh_and_export to a connected extension via WebSocket hub.
 */
export async function triggerExport(wsHub, options = {}) {
  const reload = options.reload !== false;
  const wait = options.wait !== false;
  const timeoutMs = Number(options.timeoutMs ?? options.timeout_ms) || DEFAULT_EXPORT_TRIGGER.timeoutMs;
  const tabUrl = options.tabUrl || options.tab_url || DEFAULT_GROUP_TAB_URL;

  const commandPromise = wsHub.dispatchCommand('refresh_and_export', { reload, tabUrl }, { timeoutMs });

  if (!wait) {
    commandPromise.catch(() => {});
    return { ok: true, accepted: true, reload };
  }

  const result = await commandPromise;
  return { ok: true, data: result.data };
}
