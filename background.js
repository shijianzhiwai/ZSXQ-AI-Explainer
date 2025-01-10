// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explainContent",
    title: "解释内容",
    contexts: ["all"],
    documentUrlPatterns: ["*://*.zsxq.com/*"]  // 只在知识星球网站显示
  });
});

let lastClickedCoordinates = null;

// 监听鼠标右键点击事件
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'rightClickCoordinates') {
    lastClickedCoordinates = {
      x: request.x,
      y: request.y
    };
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
