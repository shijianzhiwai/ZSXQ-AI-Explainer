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
      <button class="close-btn">×</button>
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
}

// 添加样式表
function addPopupStyles(popup, isError) {
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
  addPopupStyles(popup, isError);

  if (isError) {
    popup.querySelector('.popup-header').style.backgroundColor = '#fff2f0';
    popup.querySelector('.popup-content').style.color = '#ff4d4f';
    popup.querySelector('.popup-content').style.whiteSpace = 'pre-wrap';
  }

  document.body.appendChild(popup);

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

  popup.querySelector('.close-btn').addEventListener('click', () => {
    popup.remove();
  });

  if (isError) {
    setTimeout(() => {
      if (document.body.contains(popup)) {
        popup.remove();
      }
    }, 5000);
  }

  return popup;
}

// 导出函数
window.showResultPopup = showResultPopup; 