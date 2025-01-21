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
