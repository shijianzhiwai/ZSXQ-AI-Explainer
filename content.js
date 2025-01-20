// 在 content.js 开头添加
console.log('ZSXQ Extension version:', chrome.runtime.getManifest().version);

// 监听来自 background.js 的消息
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "getTextNearCursor") {
    const text = getContentDivText(request.x, request.y);
    if (text) {

      // 创建弹窗但先不显示内容
      const popup = await showResultPopup('正在加载...', false);
      const contentDiv = popup.querySelector('.popup-content');

      // 用于累积完整的 Markdown 文本
      let fullContent = '';

      function updateContent(chunk) {
        fullContent += chunk;
        contentDiv.innerHTML = marked.parse(fullContent + '\n\n---\n\n*内容由AI生成，可能存在错误，仅供参考*');
      }

      try {
        // 流式获取 AI 响应
        const streamResponse = await fetchAIExplanation(text);
        
        for await (const chunk of streamResponse) {
          updateContent(chunk);
        }
      } catch (error) {
        console.error('Error:', error);
        
        if (fullContent) {
          updateContent(error.message);
        } else {
          await showResultPopup('获取内容失败，请重试: ' + error.message, true);
        }
      }
    } else {
      await showResultPopup('未找到有效内容，请在内容区域右键', true);
    }
  }
});

// 获取带有 class="content" 的 div 内容
function getContentDivText(x, y) {
  console.log('Getting content div text at:', { x, y });
  console.log('Window scroll position:', {
    scrollX: window.scrollX,
    scrollY: window.scrollY
  });

  // Validate coordinates
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    console.error('Invalid coordinates:', { x, y });
    return null;
  }

  // 将页面坐标转换为相对于视口的坐标
  const viewportX = x - window.scrollX;
  const viewportY = y - window.scrollY;
  
  console.log('Viewport coordinates:', { viewportX, viewportY });

  // Validate viewport coordinates
  if (!Number.isFinite(viewportX) || !Number.isFinite(viewportY)) {
    console.error('Invalid viewport coordinates:', { viewportX, viewportY });
    return null;
  }

  // 获取点击位置的元素
  const element = document.elementFromPoint(viewportX, viewportY);
  console.log('Element found:', {
    element,
    tag: element?.tagName,
    classes: element?.classList?.toString(),
    rect: element?.getBoundingClientRect()
  });
  if (!element) return null;

  // 查找最近的 content div
  const contentDiv = findClosestContentDiv(element);
  if (!contentDiv) return null;

  // 获取并清理文本内容
  const text = contentDiv.textContent.trim();
  return text.replace(/\s+/g, ' ');
}

// 查找最近的带有 class="content" 的 div
function findClosestContentDiv(element) {
  let current = element;
  
  // 清除所有现有的高亮效果
  document.querySelectorAll('.content-highlight').forEach(el => {
    el.classList.remove('content-highlight');
    el.style.removeProperty('box-shadow');
    el.style.removeProperty('transition');
    el.style.removeProperty('border-radius');
  });
  
  // 向上遍历 DOM 树
  while (current && current !== document.body) {
    if (current.tagName.toLowerCase() === 'div' && 
        current.classList.contains('content')) {
      
      // 添加高亮类和样式
      current.classList.add('content-highlight');
      current.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      current.style.boxShadow = '0 0 0 2px rgba(255, 77, 79, 0.2), 0 0 0 4px rgba(255, 77, 79, 0.3)';
      current.style.borderRadius = '8px';
      
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

// 优化弹窗显示函数，添加不同状态的样式
async function showResultPopup(content, isError = false) {
  // 获取保存的位置和大小
  const { popupSettings } = await chrome.storage.local.get('popupSettings');
  const defaultSettings = {
    left: (window.innerWidth - 400 - 50) + 'px',
    top: '20px',
    width: '400px',
    height: '80vh'
  };
  console.log('popupSettings:', popupSettings);
  const settings = popupSettings || defaultSettings;

  // 移除已存在的弹窗
  const existingPopup = document.querySelector('.ai-explanation-popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  const popup = document.createElement('div');
  popup.className = 'ai-explanation-popup';
  
  const { selectedModel } = await chrome.storage.local.get('selectedModel');
  const modelName = selectedModel?.name || '默认模型';

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

  // 更新弹窗样式
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

  // 更新 header 样式
  const header = popup.querySelector('.popup-header');
  header.style.cssText = `
    padding: 12px 15px;
    border-bottom: 1px solid #eee;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `;

  // 添加模型选择器样式
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
  `;
  popup.appendChild(style);

  const contentDiv = popup.querySelector('.popup-content');
  contentDiv.style.cssText = `
    padding: 15px;
    overflow-y: auto;
    flex-grow: 1;
    max-height: calc(80vh - 50px);
  `;

  // 添加 Markdown 样式
  if (!isError) {
    contentDiv.style.cssText += `
      line-height: 1.6;
      color: #24292e;
    `;
    
    // 为 Markdown 内容添加基础样式
    const style = document.createElement('style');
    style.textContent = `
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
    popup.appendChild(style);
  }

  // 更新关闭按钮样式
  const closeBtn = popup.querySelector('.close-btn');
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 0 5px;
    color: #999;
  `;

  // 添加错误状态的样式
  if (isError) {
    popup.querySelector('.popup-header').style.backgroundColor = '#fff2f0';
    popup.querySelector('.popup-content').style.color = '#ff4d4f';
    popup.querySelector('.popup-content').style.whiteSpace = 'pre-wrap';
  }

  document.body.appendChild(popup);

  // 实现拖动功能
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;

  popup.querySelector('.popup-header').addEventListener('mousedown', initDrag);

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

      // 确保弹窗不会被拖出视口
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
    
    // 保存位置设置
    savePopupSettings();
  }

  // 监听大小改变
  const resizeObserver = new ResizeObserver(() => {
    savePopupSettings();
  });
  resizeObserver.observe(popup);

  // 保存弹窗设置
  function savePopupSettings() {
    const settings = {
      top: popup.style.top,
      left: popup.style.left,
      width: popup.style.width,
      height: popup.style.height
    };
    chrome.storage.local.set({ popupSettings: settings });
  }

  // 添加关闭事件监听
  popup.querySelector('.close-btn').addEventListener('click', () => {
    popup.remove();
  });

  // 如果是错误信息，5秒后自动关闭
  if (isError) {
    setTimeout(() => {
      if (document.body.contains(popup)) {
        popup.remove();
      }
    }, 5000);
  }

  return popup;
}

// 添加右键点击事件监听
document.addEventListener('contextmenu', function(e) {
  // 检查当前URL是否匹配知识星球指定链接
  if (!window.location.href.includes('zsxq.com/group/28518511148841')) {
    return;
  }
  console.log('Right click event:', {
    clientX: e.clientX,
    clientY: e.clientY,
    pageX: e.pageX,
    pageY: e.pageY,
    screenX: e.screenX,
    screenY: e.screenY
  });

  // 创建点击指示器
  const indicator = document.createElement('div');
  indicator.className = 'click-indicator';
  indicator.style.cssText = `
    position: absolute;
    width: 20px;
    height: 20px;
    background-color: rgba(255, 0, 0, 0.5);
    border: 2px solid red;
    border-radius: 50%;
    pointer-events: none;
    z-index: 10000;
    transform: translate(-50%, -50%);
    left: ${e.pageX}px;
    top: ${e.pageY}px;
  `;

  document.body.appendChild(indicator);

  // 1秒后移除指示器
  setTimeout(() => {
    indicator.remove();
  }, 1000);

  // 发送坐标给 background script
  chrome.runtime.sendMessage({
    type: 'rightClickCoordinates',
    x: e.pageX,
    y: e.pageY
  });
});
