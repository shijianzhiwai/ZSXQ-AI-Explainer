
const SYNC_LOGSEQ_BTN_TEXT = '👉 同步到笔记';


async function showStreamResponse(text, prompt=null, isSummary=false) {
  // 创建弹窗但先不显示内容
  const popup = await showResultPopup('正在加载...', false);
  const contentDiv = popup.querySelector('.popup-content');

  // 用于累积完整的 Markdown 文本
  window.fullContent = { done: false, content: '' };

  function updateContent(chunk) {
    window.fullContent.content += chunk;
    contentDiv.innerHTML = marked.parse(window.fullContent.content + '\n\n---\n\n*内容由AI生成，可能存在错误，仅供参考*');
  }

  try {
    // 流式获取 AI 响应
    const streamResponse = await fetchAIExplanation(text, prompt, isSummary);
    
    for await (const chunk of streamResponse) {
      updateContent(chunk);
    }
  } catch (error) {
    console.error('Error:', error);
    if (window.fullContent.content) {
      updateContent(error.message);
    } else {
      await showResultPopup('获取内容失败，请重试: ' + error.message, true);
    }
  } finally {
    window.fullContent.done = true;
  }
}

// 创建基础弹窗结构
function createPopupElement(content, isError, modelName, settings) {
  const popup = document.createElement('div');
  popup.className = 'ai-explanation-popup';
  
  popup.innerHTML = `
    <div class="popup-header ${isError ? 'error' : ''}">
      <div class="header-left">
        <span>AI 解释</span>
        <span class="model-name">(${modelName})</span>
      </div>
      <div class="header-right">
        <button class="sync-logseq-btn">${SYNC_LOGSEQ_BTN_TEXT}</button>
        <button class="close-btn">×</button>
      </div>
    </div>
    <div class="popup-content ${isError ? 'error' : ''}">${isError ? content : marked.parse(content)}</div>
    <div class="resize-handle"></div>
  `;

  applyPopupStyles(popup, settings, isError);
  return popup;
}

// 应用弹窗样式
function applyPopupStyles(popup, settings, isError) {
  popup.style.cssText = `
    position: fixed;
    top: ${settings.top};
    left: ${settings.left};
    width: ${settings.width};
    height: ${settings.height};
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 10000;
    border: 2px solid #1890ff;
    display: flex;
    flex-direction: column;
    resize: both;
    overflow: hidden;
  `;

  const header = popup.querySelector('.popup-header');
  header.style.cssText = `
    padding: 12px 15px;
    border-bottom: 1px solid #eee;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `;

  const contentDiv = popup.querySelector('.popup-content');
  contentDiv.style.cssText = `
    padding: 15px;
    overflow-y: auto;
    flex-grow: 1;
    max-height: calc(80vh - 50px);
    ${!isError ? 'line-height: 1.6; color: #24292e;' : ''}
  `;

  const closeBtn = popup.querySelector('.close-btn');
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 0 5px;
    color: #999;
  `;

  const headerRight = popup.querySelector('.header-right');
  headerRight.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  const syncBtn = popup.querySelector('.sync-logseq-btn');
  syncBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 0 5px;
    color: #666;
    display: flex;
    align-items: center;
  `;
}

// 添加样式表
function addPopupStyles(popup) {
  const style = document.createElement('style');
  style.textContent = `
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .model-name {
      font-size: 12px;
      color: #666;
      margin-left: 8px;
    }
    .ai-explanation-popup .popup-header {
      cursor: move;
      user-select: none;
    }
    .ai-explanation-popup .resize-handle {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 15px;
      height: 15px;
      cursor: se-resize;
    }
    ${getMarkdownStyles()}
  `;
  popup.appendChild(style);
}

// Markdown 样式
function getMarkdownStyles() {
  return `
    .popup-content h1, .popup-content h2, .popup-content h3 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
    }
    .popup-content h1 { font-size: 1.5em; }
    .popup-content h2 { font-size: 1.3em; }
    .popup-content h3 { font-size: 1.1em; }
    .popup-content p { margin: 0 0 16px; }
    .popup-content code {
      padding: 0.2em 0.4em;
      background-color: rgba(27,31,35,0.05);
      border-radius: 3px;
      font-family: monospace;
    }
    .popup-content pre {
      padding: 16px;
      overflow: auto;
      background-color: #f6f8fa;
      border-radius: 3px;
    }
    .popup-content pre code {
      padding: 0;
      background-color: transparent;
    }
    .popup-content ul, .popup-content ol {
      padding-left: 2em;
      margin-bottom: 16px;
    }
    .popup-content blockquote {
      padding: 0 1em;
      color: #6a737d;
      border-left: 0.25em solid #dfe2e5;
      margin: 0 0 16px;
    }
  `;
}

// 处理拖拽功能
function setupDragAndResize(popup, saveSettings) {
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;

  function initDrag(e) {
    isDragging = true;
    initialX = e.clientX - popup.offsetLeft;
    initialY = e.clientY - popup.offsetTop;

    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      currentX = Math.max(0, Math.min(currentX, window.innerWidth - popup.offsetWidth));
      currentY = Math.max(0, Math.min(currentY, window.innerHeight - popup.offsetHeight));

      popup.style.left = currentX + 'px';
      popup.style.top = currentY + 'px';
      popup.style.right = 'auto';
    }
  }

  function stopDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', stopDrag);
    saveSettings();
  }

  popup.querySelector('.popup-header').addEventListener('mousedown', initDrag);
  
  const resizeObserver = new ResizeObserver(() => {
    saveSettings();
  });
  resizeObserver.observe(popup);
}

// 同步到 Logseq
function syncToLogseqAction(popup) {
  // 添加同步按钮事件监听
  const syncBtn = popup.querySelector('.sync-logseq-btn');
  syncBtn.addEventListener('click', async () => {
    try {
      syncBtn.disabled = true;
      syncBtn.style.opacity = '0.5';
      syncBtn.textContent = '同步中...';
      
      function restoreSyncBtnText() {
        syncBtn.textContent = SYNC_LOGSEQ_BTN_TEXT;
        syncBtn.style.opacity = '1';
        syncBtn.disabled = false;
      }

      if (!window.fullContent.done) {
        throw new Error('内容未完全加载，请稍后再试');
      }

      await syncToLogseq(window.fullContent.content);
      
      // 显示成功提示
      const successTip = document.createElement('div');
      successTip.textContent = '✅ 同步成功';
      successTip.style.cssText = `
        position: absolute;
        top: 20%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
      `;
      popup.appendChild(successTip);
      setTimeout(() => {
        successTip.remove();
      }, 2000);
    } catch (error) {
      console.error('Sync to Logseq failed:', error);
      alert(error.message);
    } finally {
      restoreSyncBtnText();
    }
  });
}

// 主函数
async function showResultPopup(content, isError = false) {
  const { popupSettings } = await chrome.storage.local.get('popupSettings');
  const defaultSettings = {
    left: (window.innerWidth - 400 - 50) + 'px',
    top: '20px',
    width: '400px',
    height: '80vh'
  };
  const settings = popupSettings || defaultSettings;

  const existingPopup = document.querySelector('.ai-explanation-popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  const { selectedModel } = await chrome.storage.local.get('selectedModel');
  const modelName = selectedModel?.name || '默认模型';

  const popup = createPopupElement(content, isError, modelName, settings);
  addPopupStyles(popup);

  if (isError) {
    popup.querySelector('.popup-header').style.backgroundColor = '#fff2f0';
    popup.querySelector('.popup-content').style.color = '#ff4d4f';
    popup.querySelector('.popup-content').style.whiteSpace = 'pre-wrap';
  }

  document.body.appendChild(popup);

  // 添加窗口大小变化监听器，确保弹窗始终可见
  function ensurePopupVisible() {
    console.log('ensurePopupVisible');
    const rect = popup.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const windowWidth = window.innerWidth;
    
    let needsUpdate = false;
    let newWidth = popup.style.width;
    let newHeight = popup.style.height;
    
    // 检查宽度是否超出右侧边界
    if (rect.right > windowWidth - 20) {
      const maxWidth = windowWidth - parseInt(popup.style.left) - 20;
      newWidth = Math.max(300, maxWidth) + 'px'; // 最小宽度300px
      needsUpdate = true;
    }
    
    // 检查高度是否超出底部边界
    if (rect.bottom > windowHeight - 20) {
      const maxHeight = windowHeight - parseInt(popup.style.top) - 20;
      newHeight = Math.max(200, maxHeight) + 'px'; // 最小高度200px
      needsUpdate = true;
    }
    
    // 如果弹窗太小，确保最小尺寸
    const minHeight = 200;
    const minWidth = 300;
    if (rect.height < minHeight) {
      newHeight = minHeight + 'px';
      needsUpdate = true;
    }
    if (rect.width < minWidth) {
      newWidth = minWidth + 'px';
      needsUpdate = true;
    }
    
    // 应用尺寸调整
    if (needsUpdate) {
      popup.style.width = newWidth;
      popup.style.height = newHeight;
      savePopupSettings();
    }
  }

  // 监听窗口大小变化
  const resizeObserver = new ResizeObserver(ensurePopupVisible);
  resizeObserver.observe(document.body);
  
  // 监听窗口resize事件
  const handleResize = () => {
    // 延迟执行，确保DOM更新完成
    setTimeout(ensurePopupVisible, 100);
  };
  window.addEventListener('resize', handleResize);

  function savePopupSettings() {
    const settings = {
      top: popup.style.top,
      left: popup.style.left,
      width: popup.style.width,
      height: popup.style.height
    };
    chrome.storage.local.set({ popupSettings: settings });
  }

  setupDragAndResize(popup, savePopupSettings);
  syncToLogseqAction(popup);
  
  // 在弹窗关闭时清理事件监听器
  const closeBtn = popup.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', handleResize);
    popup.remove();
  });

  if (isError) {
    setTimeout(() => {
      if (document.body.contains(popup)) {
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleResize);
        popup.remove();
      }
    }, 5000);
  }

  // 初始检查一次，确保弹窗位置正确
  setTimeout(ensurePopupVisible, 100);

  return popup;
}
