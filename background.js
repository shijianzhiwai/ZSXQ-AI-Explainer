// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explainContent",
    title: "解释内容",
    contexts: ["all"],
    documentUrlPatterns: ["*://*.zsxq.com/group/28518511148841*"]  // 只在知识星球网站显示
  });
});

let lastClickedCoordinates = null;

const ZSXQ_REFERER = 'https://wx.zsxq.com/';

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

async function postToInboxServer(inboxUrl, date, manifest, images) {
  const response = await fetch(`${inboxUrl.replace(/\/$/, '')}/inbox/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, manifest, images })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Inbox server ${response.status}: ${body || response.statusText}`);
  }
  return response.json();
}


async function saveDailyBundle({ date, manifest, images, mode = 'auto' }) {
  const config = await getPipelineConfig();
  const prefix = `daily-inbox/${date}`;
  const manifestJson = JSON.stringify(manifest, null, 2);

  if (mode === 'inbox' || (mode === 'auto' && config.inboxServerUrl)) {
    try {
      const result = await postToInboxServer(config.inboxServerUrl, date, manifest, images);
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

  if (request.action === 'saveDailyBundle') {
    saveDailyBundle(request.payload)
      .then((result) => sendResponse({ ok: true, result }))
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
