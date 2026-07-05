// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explainContent",
    title: "解释内容",
    contexts: ["all"],
    documentUrlPatterns: ["*://*.zsxq.com/group/28518511148841*"]  // 只在知识星球网站显示
  });
  chrome.alarms.create('inbox-ws-reconnect', { periodInMinutes: 1 });
  ensureInboxWebSocket();
});

chrome.runtime.onStartup.addListener(() => {
  ensureInboxWebSocket();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'inbox-ws-reconnect') {
    ensureInboxWebSocket();
  }
});

let lastClickedCoordinates = null;

const ZSXQ_REFERER = 'https://wx.zsxq.com/';
const DEFAULT_GROUP_URL = 'https://wx.zsxq.com/group/28518511148841';

let inboxWs = null;
let inboxWsConnecting = false;
let inboxWsUrlStored = null;

function httpToWsUrl(httpUrl) {
  const parsed = new URL(httpUrl.replace(/\/$/, ''));
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/ws';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function sendInboxWs(message) {
  if (inboxWs?.readyState === WebSocket.OPEN) {
    inboxWs.send(JSON.stringify(message));
  }
}

async function ensureInboxWebSocket() {
  const config = await getPipelineConfig();
  const wsUrl = httpToWsUrl(config.inboxServerUrl);

  if (inboxWs && inboxWsUrlStored === wsUrl) {
    if (inboxWs.readyState === WebSocket.OPEN || inboxWs.readyState === WebSocket.CONNECTING) {
      return;
    }
  }

  if (inboxWsConnecting) return;
  inboxWsConnecting = true;

  try {
    if (inboxWs) {
      inboxWs.onclose = null;
      inboxWs.onerror = null;
      inboxWs.onmessage = null;
      inboxWs.close();
      inboxWs = null;
    }

    inboxWsUrlStored = wsUrl;
    const socket = new WebSocket(wsUrl);
    inboxWs = socket;

    socket.onopen = () => {
      inboxWsConnecting = false;
      sendInboxWs({
        type: 'hello',
        role: 'extension',
        version: chrome.runtime.getManifest().version
      });
      console.log('[inbox-ws] connected', wsUrl);
    };

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'ping') {
        sendInboxWs({ type: 'pong', ts: message.ts });
        return;
      }

      if (message.type === 'command' && message.action === 'refresh_and_export') {
        handleRefreshAndExportCommand(message);
      }

      if (message.type === 'command' && message.action === 'debug_export_feed') {
        handleDebugExportFeedCommand(message);
      }
    };

    socket.onclose = () => {
      inboxWsConnecting = false;
      if (inboxWs === socket) inboxWs = null;
      console.log('[inbox-ws] disconnected');
    };

    socket.onerror = () => {
      inboxWsConnecting = false;
    };
  } catch (error) {
    inboxWsConnecting = false;
    console.warn('[inbox-ws] connect failed:', error.message);
  }
}

async function handleRefreshAndExportCommand(message) {
  const { id, payload = {} } = message;
  try {
    const data = await runRefreshAndExport(payload);
    sendInboxWs({
      type: 'command_result',
      id,
      ok: data?.ok !== false,
      data,
      error: data?.ok === false ? data.error : undefined
    });
  } catch (error) {
    sendInboxWs({
      type: 'command_result',
      id,
      ok: false,
      error: error.message
    });
  }
}

async function handleDebugExportFeedCommand(message) {
  const { id, payload = {} } = message;
  try {
    const data = await runDebugFeedExport(payload);
    sendInboxWs({
      type: 'command_result',
      id,
      ok: data?.ok !== false,
      data,
      error: data?.ok === false ? data.error : undefined
    });
  } catch (error) {
    sendInboxWs({
      type: 'command_result',
      id,
      ok: false,
      error: error.message
    });
  }
}

function waitForTabLoad(tabId, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab load timeout'));
    }, timeoutMs);

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 2000);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 2000);
      }
    }).catch((error) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
  });
}

async function findGroupTab(tabUrl) {
  const pattern = '*://*.zsxq.com/group/*';
  const tabs = await chrome.tabs.query({ url: pattern });
  const target = tabUrl || DEFAULT_GROUP_URL;
  const groupId = target.match(/group\/(\d+)/)?.[1];
  if (groupId) {
    const matched = tabs.find((tab) => tab.url?.includes(`/group/${groupId}`));
    if (matched) return matched;
  }
  return tabs[0] || null;
}

// 后台/不可见标签页会被 Chrome 限流（Intensive Throttling），滚动抓取用的 setTimeout
// 链在这种情况下会被严重拖慢，是导出超时的主因之一。导出前临时前台化目标标签页，
// 结束后尽量恢复原先的活动标签页/窗口。
async function captureFocusState() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const win = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
    return {
      activeTabId: activeTab?.id ?? null,
      focusedWindowId: win?.focused ? win.id : null
    };
  } catch {
    return { activeTabId: null, focusedWindowId: null };
  }
}

async function restoreFocusState(state) {
  if (!state) return;
  try {
    if (state.focusedWindowId != null) {
      await chrome.windows.update(state.focusedWindowId, { focused: true });
    }
    if (state.activeTabId != null) {
      await chrome.tabs.update(state.activeTabId, { active: true });
    }
  } catch {
    // 原标签页/窗口可能已关闭，尽力而为即可
  }
}

async function activateTabForExport(tab) {
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } catch (error) {
    console.warn('[export] activate tab failed:', error.message);
  }
}

async function runRefreshAndExport({ reload = true, tabUrl, since = null, bucketByDate = false, maxPosts = null } = {}) {
  const targetUrl = tabUrl || DEFAULT_GROUP_URL;
  let tab = await findGroupTab(targetUrl);
  const focusState = await captureFocusState();

  try {
    if (!tab) {
      tab = await chrome.tabs.create({ url: targetUrl, active: true });
      await activateTabForExport(tab);
      await waitForTabLoad(tab.id);
    } else {
      await activateTabForExport(tab);
      if (reload) {
        await chrome.tabs.reload(tab.id);
        await waitForTabLoad(tab.id);
      }
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'runDailyExport',
      silent: true,
      since,
      bucketByDate,
      maxPosts
    });

    if (!response) {
      throw new Error('content script did not respond');
    }
    return response;
  } finally {
    await restoreFocusState(focusState);
  }
}

async function runDebugFeedExport({
  slug,
  count = 10,
  reload = false,
  navigate_digests = true,
  tabUrl
} = {}) {
  const targetUrl = tabUrl || DEFAULT_GROUP_URL;
  let tab = await findGroupTab(targetUrl);
  const focusState = await captureFocusState();

  try {
    if (!tab) {
      tab = await chrome.tabs.create({ url: targetUrl, active: true });
      await activateTabForExport(tab);
      await waitForTabLoad(tab.id);
    } else {
      await activateTabForExport(tab);
      if (reload) {
        await chrome.tabs.reload(tab.id);
        await waitForTabLoad(tab.id);
      }
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'runDebugFeedExport',
      silent: true,
      slug,
      count,
      navigate_digests
    });

    if (!response) {
      throw new Error('content script did not respond');
    }
    return response;
  } finally {
    await restoreFocusState(focusState);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.inboxServerUrl) {
    ensureInboxWebSocket();
  }
});

async function fetchImageAsDataUrl(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Referer: ZSXQ_REFERER,
      'User-Agent': navigator.userAgent
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const mime = blob.type || 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

async function fetchArticleHtml(url) {
  if (!/^https:\/\/articles\.zsxq\.com\//i.test(url || '')) {
    throw new Error('not a zsxq article url');
  }
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Referer: ZSXQ_REFERER }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (/\/login/i.test(response.url || '')) {
    throw new Error('redirected to login (not logged in)');
  }
  const html = await response.text();
  if (html.includes('<app-root>')) {
    throw new Error('got SPA shell instead of article content');
  }
  return html;
}

const DEFAULT_INBOX_URL = 'http://127.0.0.1:3921';

async function getPipelineConfig() {
  const stored = await chrome.storage.local.get(['inboxServerUrl']);
  return {
    inboxServerUrl: stored.inboxServerUrl || DEFAULT_INBOX_URL
  };
}

function toJsonDataUrl(text) {
  return `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
}

async function downloadTextFile(filename, text) {
  await chrome.downloads.download({
    url: toJsonDataUrl(text),
    filename,
    saveAs: false
  });
}

async function downloadDataUrlFile(filename, dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    throw new Error('invalid image data url');
  }
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false
  });
}

async function postToInboxServer(inboxUrl, date, manifest, images, merge = false) {
  const response = await fetch(`${inboxUrl.replace(/\/$/, '')}/inbox/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, manifest, images, merge })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Inbox server ${response.status}: ${body || response.statusText}`);
  }
  return response.json();
}


async function saveDailyBundle({ date, manifest, images, mode = 'auto', merge = false }) {
  const config = await getPipelineConfig();
  const prefix = `daily-inbox/${date}`;
  const manifestJson = JSON.stringify(manifest, null, 2);

  if (mode === 'inbox' || (mode === 'auto' && config.inboxServerUrl)) {
    try {
      const result = await postToInboxServer(config.inboxServerUrl, date, manifest, images, merge);
      return { method: 'inbox', ...result };
    } catch (error) {
      if (mode === 'inbox') throw error;
      console.warn('Inbox server unavailable, falling back to downloads:', error.message);
    }
  }

  await downloadTextFile(`${prefix}/manifest.json`, manifestJson);
  for (const image of images || []) {
    await downloadDataUrlFile(`${prefix}/${image.file}`, image.data_url);
  }
  return { method: 'downloads', files: 1 + (images?.length || 0) };
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'rightClickCoordinates') {
    lastClickedCoordinates = {
      x: request.x,
      y: request.y
    };
    return;
  }

  if (request.action === 'fetchImageAsDataUrl') {
    fetchImageAsDataUrl(request.url)
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'fetchArticleHtml') {
    fetchArticleHtml(request.url)
      .then((html) => sendResponse({ ok: true, html }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === 'saveDailyBundle') {
    saveDailyBundle(request.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === 'ensureInboxWebSocket') {
    ensureInboxWebSocket()
      .then(() => sendResponse({ ok: true, connected: inboxWs?.readyState === WebSocket.OPEN }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "explainContent" && lastClickedCoordinates) {
    chrome.tabs.sendMessage(tab.id, {
      action: "getTextNearCursor",
      x: lastClickedCoordinates.x,
      y: lastClickedCoordinates.y
    });
    lastClickedCoordinates = null; // 清除坐标
  }
});

ensureInboxWebSocket();
