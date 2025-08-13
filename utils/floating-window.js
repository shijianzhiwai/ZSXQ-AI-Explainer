// 悬浮小窗口功能
class FloatingWindow {
  constructor() {
    this.isDragging = false;
    this.currentX = 0;
    this.currentY = 0;
    this.initialX = 0;
    this.initialY = 0;
    this.xOffset = 0;
    this.yOffset = 0;
    this.counter = 0;
    this.contentHashes = new Set(); // 用于存储内容hash，去重
    this.contentArray = []; // 存储抓取的内容数组
    this.isProcessing = false; // 防止重复处理
    this.isCapturing = false; // 抓取状态：true=正在抓取，false=已停止
    this.resizeTimeout = null; // 窗口大小改变防抖定时器
    this.connectionLines = []; // 连接线数组，允许多条线同时存在
    this.init();
  }

  init() {
    // 创建悬浮窗口元素
    this.createFloatingWindow();
    // 绑定事件
    this.bindEvents();
    // 设置初始位置（右上角）
    this.setInitialPosition();
    // 检查可见性，如果不可见则重新定位
    this.checkVisibilityAndReposition();
    // 开始监听页面滚动
    this.startScrollListener();
  }

  createFloatingWindow() {
    // 创建悬浮窗口容器
    this.floatingWindow = document.createElement('div');
    this.floatingWindow.id = 'floating-window';
    this.floatingWindow.innerHTML = `
      <div class="floating-header">
        <div class="floating-label">抓取内容数量</div>
        <div class="floating-drag-handle">⋮⋮</div>
      </div>
      <div class="floating-content">
        <div class="floating-number">0</div>
        <div class="floating-controls">
          <button class="floating-clear-btn" id="clear-btn" title="清空抓取">🗑️ 清空</button>
          <div class="floating-toggle-group">
            <button class="floating-toggle-btn" id="toggle-btn" title="停止抓取">▶️ 开始</button>
          </div>
        </div>
        <button class="floating-summary-btn" id="summary-btn">一键汇总内容</button>
      </div>
    `;

    // 添加样式
    this.addStyles();
    
    // 添加到页面
    document.body.appendChild(this.floatingWindow);
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #floating-window {
        position: fixed;
        width: 100px;
        background: #ffffff;
        border: 2px solid #4a90e2;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        user-select: none;
        cursor: move;
        transition: box-shadow 0.3s ease;
      }

      #floating-window:hover {
        box-shadow: 0 6px 25px rgba(0, 0, 0, 0.2);
      }

      .floating-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        background: linear-gradient(135deg, #4a90e2, #1890ff);
        border-radius: 8px 8px 0 0;
        color: white;
      }

      .floating-label {
        font-size: 10px;
        font-weight: 500;
        opacity: 0.9;
      }

      .floating-drag-handle {
        font-size: 12px;
        opacity: 0.8;
        cursor: move;
      }

      .floating-content {
        padding: 8px;
        background: white;
        border-radius: 0 0 8px 8px;
        text-align: center;
      }

      .floating-number {
        font-size: 16px;
        font-weight: bold;
        color: #4a90e2;
        margin-bottom: 6px;
      }

      .floating-summary-btn {
        width: 80%;
        padding: 6px 8px;
        background: linear-gradient(135deg, #28a745, #20c997);
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 6px rgba(40, 167, 69, 0.3);
        margin: 0 auto;
        display: block;
      }

      .floating-summary-btn:hover {
        background: linear-gradient(135deg, #218838, #1ea085);
        transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(40, 167, 69, 0.4);
      }

      .floating-summary-btn:active {
        transform: translateY(0);
        box-shadow: 0 2px 6px rgba(40, 167, 69, 0.3);
      }

      .floating-summary-btn:disabled {
        background: #6c757d;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      /* 控制按钮样式 */
      .floating-controls {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 8px;
      }

      .floating-clear-btn {
        width: 80%;
        padding: 4px 8px;
        background: linear-gradient(135deg, #ff4d4f, #ff7875);
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 6px rgba(255, 77, 79, 0.3);
      }

      .floating-clear-btn:hover {
        background: linear-gradient(135deg, #ff7875, #ffa39e);
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(255, 77, 79, 0.4);
      }

      .floating-clear-btn:active {
        transform: translateY(0);
        box-shadow: 0 2px 6px rgba(255, 77, 79, 0.3);
      }

      .floating-toggle-group {
        display: flex;
        gap: 2px;
      }

      .floating-toggle-btn {
        flex: 1;
        padding: 4px 6px;
        background: linear-gradient(135deg, #1890ff, #40a9ff);
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 9px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 6px rgba(24, 144, 255, 0.3);
      }

      .floating-toggle-btn:hover {
        background: linear-gradient(135deg, #40a9ff, #69c0ff);
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(24, 144, 255, 0.4);
      }

      .floating-toggle-btn:active {
        transform: translateY(0);
        box-shadow: 0 2px 6px rgba(24, 144, 255, 0.3);
      }

      .floating-toggle-btn.active {
        background: linear-gradient(135deg, #52c41a, #73d13d);
      }

      .floating-toggle-btn.active:hover {
        background: linear-gradient(135deg, #73d13d, #95de64);
      }

      /* 内容标识样式 */
      .content-marker {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 8px;
        height: 8px;
        background: linear-gradient(135deg, #52c41a, #73d13d);
        border: 1px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 1px 3px rgba(82, 196, 26, 0.4);
        z-index: 1000;
        pointer-events: none;
        animation: markerPulse 0.6s ease-out;
        opacity: 0.8;
      }

      @keyframes markerPulse {
        0% {
          transform: scale(0);
          opacity: 0;
        }
        50% {
          transform: scale(1.2);
          opacity: 0.8;
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      /* 连接线样式 */
      .connection-line {
        position: fixed;
        pointer-events: none;
        z-index: 9999;
        opacity: 1;
        filter: drop-shadow(0 2px 4px rgba(82, 196, 26, 0.3));
      }
    `;
    document.head.appendChild(style);
  }

  setInitialPosition() {
    // 从localStorage恢复位置，如果没有则使用默认位置
    const savedPosition = localStorage.getItem('floating-window-position');
    if (savedPosition) {
      const { x, y } = JSON.parse(savedPosition);
      this.floatingWindow.style.left = x + 'px';
      this.floatingWindow.style.top = y + 'px';
      this.xOffset = x;
      this.yOffset = y;
    } else {
      // 默认位置：右上角
      const right = 20;
      const top = 20;
      this.floatingWindow.style.left = (window.innerWidth - 100 - right) + 'px';
      this.floatingWindow.style.top = top + 'px';
      this.xOffset = window.innerWidth - 100 - right;
      this.yOffset = top;
    }
  }

  // 检查可见性并重新定位
  checkVisibilityAndReposition() {
    // 延迟检查，确保DOM完全渲染
    setTimeout(() => {
      if (!this.isElementVisible()) {
        console.log('悬浮窗口不可见，重新定位到默认位置');
        this.repositionToDefault();
      }
    }, 500);
  }

  // 检查元素是否可见
  isElementVisible() {
    if (!this.floatingWindow) return false;
    
    const rect = this.floatingWindow.getBoundingClientRect();
    const style = window.getComputedStyle(this.floatingWindow);
    
    // 检查基本可见性
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    
    // 检查是否在视口内
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
    
    // 检查元素尺寸
    const hasSize = rect.width > 0 && rect.height > 0;
    
    return isInViewport && hasSize;
  }

  // 重新定位到默认位置
  repositionToDefault() {
    // 清除localStorage中的位置
    localStorage.removeItem('floating-window-position');
    
    // 重置位置变量并设置默认位置
    this.setDefaultPosition();
    
    console.log('悬浮窗口已重新定位到默认位置');
  }

  // 设置默认位置
  setDefaultPosition() {
    const right = 20;
    const top = 20;
    const left = window.innerWidth - 100 - right;
    
    this.xOffset = left;
    this.yOffset = top;
    
    this.floatingWindow.style.left = left + 'px';
    this.floatingWindow.style.top = top + 'px';
  }

  // 处理窗口大小改变
  handleWindowResize() {
    // 使用防抖，避免频繁触发
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this.checkAndAdjustPosition();
    }, 200);
  }

  // 检查并调整位置
  checkAndAdjustPosition() {
    if (!this.floatingWindow) return;
    
    const rect = this.floatingWindow.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let needsReposition = false;
    let newX = this.xOffset;
    let newY = this.yOffset;
    
    // 检查右边界
    if (rect.right > windowWidth) {
      newX = windowWidth - 100 - 20; // 100是窗口宽度，20是右边距
      needsReposition = true;
    }
    
    // 检查下边界
    if (rect.bottom > windowHeight) {
      newY = windowHeight - 150 - 20; // 150是预估高度，20是下边距
      needsReposition = true;
    }
    
    // 检查左边界
    if (rect.left < 0) {
      newX = 20;
      needsReposition = true;
    }
    
    // 检查上边界
    if (rect.top < 0) {
      newY = 20;
      needsReposition = true;
    }
    
    if (needsReposition) {
      console.log('窗口大小改变，调整悬浮窗口位置');
      this.xOffset = newX;
      this.yOffset = newY;
      this.floatingWindow.style.left = newX + 'px';
      this.floatingWindow.style.top = newY + 'px';
      
      // 保存新位置
      localStorage.setItem('floating-window-position', JSON.stringify({
        x: newX,
        y: newY
      }));
    }
  }

  bindEvents() {
    // 拖拽事件
    this.floatingWindow.addEventListener('mousedown', this.dragStart.bind(this));
    document.addEventListener('mousemove', this.drag.bind(this));
    document.addEventListener('mouseup', this.dragEnd.bind(this));

    // 窗口大小改变事件
    window.addEventListener('resize', this.handleWindowResize.bind(this));

    // 清空按钮事件
    const clearBtn = this.floatingWindow.querySelector('#clear-btn');
    clearBtn.addEventListener('click', this.handleClear.bind(this));

    // 开始/停止抓取按钮事件
    const toggleBtn = this.floatingWindow.querySelector('#toggle-btn');
    toggleBtn.addEventListener('click', this.handleToggle.bind(this));

    // 汇总按钮事件
    const summaryBtn = this.floatingWindow.querySelector('#summary-btn');
    summaryBtn.addEventListener('click', this.handleSummary.bind(this));

    // 防止拖拽时选中文本
    this.floatingWindow.addEventListener('selectstart', (e) => e.preventDefault());
  }

  dragStart(e) {
    if (e.target.closest('.floating-summary-btn')) {
      return; // 如果点击的是按钮，不启动拖拽
    }

    this.initialX = e.clientX - this.xOffset;
    this.initialY = e.clientY - this.yOffset;
    this.isDragging = true;
    
    // 添加拖拽时的样式
    this.floatingWindow.style.transition = 'none';
    this.floatingWindow.style.opacity = '0.9';
    
    // 确保拖拽时窗口在最上层
    this.floatingWindow.style.zIndex = '10001';
  }

  drag(e) {
    if (!this.isDragging) return;

    e.preventDefault();
    
    this.currentX = e.clientX - this.initialX;
    this.currentY = e.clientY - this.initialY;

    this.xOffset = this.currentX;
    this.yOffset = this.currentY;

    // 边界检查，确保窗口不会完全移出视口
    const maxX = Math.max(0, window.innerWidth - this.floatingWindow.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - this.floatingWindow.offsetHeight);
    
    this.xOffset = Math.max(0, Math.min(this.xOffset, maxX));
    this.yOffset = Math.max(0, Math.min(this.yOffset, maxY));

    // 使用left和top定位，而不是transform
    this.floatingWindow.style.left = this.xOffset + 'px';
    this.floatingWindow.style.top = this.yOffset + 'px';
  }

  dragEnd() {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    
    // 恢复样式
    this.floatingWindow.style.transition = 'box-shadow 0.3s ease';
    this.floatingWindow.style.opacity = '1';
    this.floatingWindow.style.zIndex = '10000';
    
    // 保存位置到localStorage
    localStorage.setItem('floating-window-position', JSON.stringify({
      x: this.xOffset,
      y: this.yOffset
    }));
  }

  // 更新数字
  updateNumber(num) {
    this.counter = num;
    const numberElement = this.floatingWindow.querySelector('.floating-number');
    if (numberElement) {
      numberElement.textContent = num;
    }
  }

  // 开始监听页面滚动
  startScrollListener() {
    let scrollTimeout;
    let isProcessing = false;

    // 监听滚动事件，使用节流避免频繁触发
    window.addEventListener('scroll', () => {
      if (isProcessing || !this.isCapturing) return; // 检查抓取状态
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.processScrollContent();
      }, 300); // 300ms节流
    }, { passive: true });

    // 初始处理一次
    setTimeout(() => {
      if (this.isCapturing) {
        this.processScrollContent();
      }
    }, 1000);
  }

  // 处理滚动内容
  async processScrollContent() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const newContents = this.getNewContentElements();
      let hasNewContent = false;

      for (const content of newContents) {
        const hash = await this.generateContentHash(content);
        
        if (!this.contentHashes.has(hash)) {
          this.contentHashes.add(hash);
          hasNewContent = true;
          
          // 提取内容信息并保存到数组
          const contentInfo = this.extractContentInfo(content, hash);
          this.contentArray.push(contentInfo);
          
          console.log('发现新内容:', contentInfo.text.substring(0, 50) + '...');
          console.log('内容数组长度:', this.contentArray.length);
          
          // 为新内容添加标识
          this.addContentMarker(content);
        }
      }

      if (hasNewContent) {
        this.updateNumber(this.contentHashes.size);
        console.log('内容总数更新为:', this.contentHashes.size);
        console.log('已保存内容数量:', this.contentArray.length);
      }
    } catch (error) {
      console.error('处理滚动内容时出错:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  // 获取新的内容元素
  getNewContentElements() {
    // 根据HTML结构，内容在.talk-content-container下的.content类中
    const contentElements = document.querySelectorAll('.talk-content-container .content');
    const newElements = [];

    contentElements.forEach(element => {
      // 检查元素是否在视口内或接近视口
      const rect = element.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight-100 && rect.bottom > 0;
      
      if (isVisible) {
        newElements.push(element);
      }
    });

    return newElements;
  }

  // 生成内容hash（简化版MD5）
  async generateContentHash(content) {
    // 使用简单的hash算法，实际项目中可以使用真正的MD5库
    const text = content.textContent || content.innerHTML || '';
    let hash = 0;
    
    if (text.length === 0) return hash.toString();
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    
    return hash.toString();
  }

  // 为内容添加标识
  addContentMarker(content) {
    // 检查是否已经有标识
    if (content.querySelector('.content-marker')) {
      return;
    }

    // 确保内容容器有相对定位
    if (getComputedStyle(content).position === 'static') {
      content.style.position = 'relative';
    }

    // 创建标识元素
    const marker = document.createElement('div');
    marker.className = 'content-marker';
    marker.title = '已抓取';
    
    // 尝试找到最佳位置，避免遮挡重要内容
    this.findBestMarkerPosition(content, marker);
    
    // 添加到内容元素
    content.appendChild(marker);

    // 创建连接线动画
    this.createConnectionLine(marker, this.floatingWindow);
  }

  // 找到标识的最佳位置
  findBestMarkerPosition(content, marker) {
    const rect = content.getBoundingClientRect();
    const contentWidth = rect.width;
    const contentHeight = rect.height;
    
    // 如果内容太小，调整标识位置
    if (contentWidth < 100 || contentHeight < 30) {
      marker.style.top = '1px';
      marker.style.right = '1px';
      marker.style.width = '6px';
      marker.style.height = '6px';
    }
    
    // 检查是否有重要的文本内容在右上角
    const textContent = content.textContent || '';
    if (textContent.length > 0) {
      // 如果内容较长，将标识稍微向右移动
      if (textContent.length > 50) {
        marker.style.right = '4px';
      }
    }
  }

  // 提取内容信息
  extractContentInfo(content, hash) {
    const rect = content.getBoundingClientRect();
    const parentContainer = content.closest('.talk-content-container');
    
    return {
      id: hash, // 唯一标识
      text: content.textContent || '', // 纯文本内容
      html: content.innerHTML || '', // HTML内容
      timestamp: Date.now(), // 抓取时间戳
      position: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      },
      parentInfo: parentContainer ? {
        hasImage: !!parentContainer.querySelector('img'),
        hasLink: !!parentContainer.querySelector('a'),
        hasGallery: !!parentContainer.querySelector('.image-gallery-container')
      } : {},
      element: content // 保留DOM元素引用（可选，用于后续操作）
    };
  }

  // 处理清空按钮点击
  handleClear() {
    if (this.contentArray.length === 0) {
      console.log('暂无内容可清空');
      return;
    }

    if (confirm(`确定要清空所有抓取的内容吗？\n当前已抓取 ${this.contentArray.length} 条内容`)) {
      this.clearContent();
      console.log('所有抓取内容已清空');
    }
  }

  // 处理开始/停止抓取按钮点击
  handleToggle() {
    const toggleBtn = this.floatingWindow.querySelector('#toggle-btn');
    
    this.isCapturing = !this.isCapturing;
    
    if (this.isCapturing) {
      // 开始抓取
      toggleBtn.textContent = '⏸️ 停止';
      toggleBtn.title = '停止抓取';
      toggleBtn.classList.add('active');
      console.log('开始抓取内容');
    } else {
      // 停止抓取
      toggleBtn.textContent = '▶️ 开始';
      toggleBtn.title = '开始抓取';
      toggleBtn.classList.remove('active');
      console.log('停止抓取内容');
    }
  }

  // 处理汇总按钮点击
  async handleSummary() {
    // this.exportContent();
    if (this.contentArray.length === 0) {
      console.log('暂无内容可汇总');
      return;
    }
    const summaryBtn = this.floatingWindow.querySelector('#summary-btn');
    summaryBtn.disabled = true;
    summaryBtn.textContent = '汇总中...';

    try {
      const content = this.contentArray.map(item => item.text).join('\n\n');
      await showStreamResponse(content, SUMMARY_SYSTEM_PROMPT);
    } catch (error) {
      console.error('汇总失败:', error);
    } finally {
      summaryBtn.disabled = false;
      summaryBtn.textContent = '一键汇总内容';
    }
  }

  // 模拟汇总过程
  async simulateSummary() {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('内容汇总完成（测试模式）');
        resolve();
      }, 2000);
    });
  }

  // 显示/隐藏悬浮窗口
  toggle() {
    this.floatingWindow.style.display = 
      this.floatingWindow.style.display === 'none' ? 'block' : 'none';
  }

  // 获取所有保存的内容
  getAllContent() {
    return this.contentArray;
  }

  // 根据ID获取特定内容
  getContentById(id) {
    return this.contentArray.find(item => item.id === id);
  }

  // 获取指定时间范围内的内容
  getContentByTimeRange(startTime, endTime) {
    return this.contentArray.filter(item => 
      item.timestamp >= startTime && item.timestamp <= endTime
    );
  }

  // 清空内容数组
  clearContent() {
    this.contentArray = [];
    this.contentHashes.clear();
    this.updateNumber(0);
    
    // 删除所有页面上的content-marker标记
    this.removeAllContentMarkers();
    
    // 清理所有连接线
    this.connectionLines.forEach(line => {
      if (line.parentNode) {
        line.parentNode.removeChild(line);
      }
    });
    this.connectionLines = [];
    
    console.log('内容数组已清空，所有标记已删除');
  }

  // 删除所有content-marker标记
  removeAllContentMarkers() {
    const markers = document.querySelectorAll('.content-marker');
    markers.forEach(marker => {
      marker.remove();
    });
    
    // 重置所有内容容器的position样式
    const contentElements = document.querySelectorAll('.talk-content-container .content');
    contentElements.forEach(element => {
      if (element.style.position === 'relative') {
        element.style.position = '';
      }
    });
    
    console.log(`已删除 ${markers.length} 个内容标记`);
  }

  // 导出内容为JSON
  exportContent() {
    const exportData = {
      exportTime: Date.now(),
      totalCount: this.contentArray.length,
      contents: this.contentArray
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zsxq-content-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('内容已导出为JSON文件');
  }

  // 销毁悬浮窗口
  destroy() {
    // 清理所有连接线
    this.connectionLines.forEach(line => {
      if (line.parentNode) {
        line.parentNode.removeChild(line);
      }
    });
    this.connectionLines = [];
    
    if (this.floatingWindow && this.floatingWindow.parentNode) {
      this.floatingWindow.parentNode.removeChild(this.floatingWindow);
    }
  }

  // 创建连接线动画
  createConnectionLine(fromElement, toElement) {
    // 创建连接线容器
    const connectionLine = document.createElement('div');
    connectionLine.className = 'connection-line';
    
    // 为每条线生成唯一ID
    const lineId = 'connection-line-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    connectionLine.id = lineId;
    
    // 保存连接线引用到数组
    this.connectionLines.push(connectionLine);

    // 创建SVG元素用于绘制线条
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = `
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
    `;

    // 创建虚线路径
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', '#52c41a');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-dasharray', '8,6');
    path.setAttribute('stroke-linecap', 'round');

    svg.appendChild(path);
    connectionLine.appendChild(svg);

    // 添加到页面
    document.body.appendChild(connectionLine);

    // 计算位置和尺寸
    const updateLinePosition = () => {
      const fromRect = fromElement.getBoundingClientRect();
      const toRect = toElement.getBoundingClientRect();
      
      // 计算连接线的位置和尺寸
      const fromX = fromRect.left + fromRect.width / 2;
      const fromY = fromRect.top + fromRect.height / 2;

      // 连接到 floating-window 的左边界
      const toX = toRect.left;
      const toY = toRect.top + toRect.height / 2;
      
      const lineWidth = Math.abs(toX - fromX);
      const lineHeight = Math.abs(toY - fromY);
      
      // 设置连接线容器的位置和尺寸
      const left = Math.min(fromX, toX);
      const top = Math.min(fromY, toY);
      
      connectionLine.style.left = left + 'px';
      connectionLine.style.top = top + 'px';
      connectionLine.style.width = lineWidth + 'px';
      connectionLine.style.height = lineHeight + 'px';
      
      // 计算SVG的viewBox
      svg.setAttribute('viewBox', `0 0 ${lineWidth} ${lineHeight}`);
      
      // 计算路径坐标（相对于SVG容器）
      const pathFromX = fromX - left;
      const pathFromY = fromY - top;
      const pathToX = toX - left;
      const pathToY = toY - top;
      
      const controlPoint1X = pathFromX + (pathToX - pathFromX) * 0.25;
      const controlPoint1Y = pathFromY + (pathToY - pathFromY) * 0.1;
      const controlPoint2X = pathFromX + (pathToX - pathFromX) * 0.75;
      const controlPoint2Y = pathToY - (pathToY - pathFromY) * 0.1;
      
      const pathData = `M ${pathFromX} ${pathFromY} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${pathToX} ${pathToY}`;
      path.setAttribute('d', pathData);
    };

    // 初始更新位置
    updateLinePosition();

    // 动画效果：从起点逐渐绘制到终点的虚线动画
    const animateLine = () => {
      // 获取路径总长度
      const pathLength = path.getTotalLength();
      
      // 设置虚线样式：8px实线 + 6px空白
      const dashLength = 8;
      const gapLength = 6;
      const dashArray = `${dashLength},${gapLength}`;
      
      path.style.strokeDasharray = dashArray;
      
      path.style.strokeDashoffset = pathLength/2;
      
      // 强制浏览器重新计算，确保初始状态生效
      path.getBoundingClientRect();
      
      // 开始绘制动画：将偏移量从初始值逐渐减少到0
      // 这样线条会从起点逐渐绘制到终点
      path.style.transition = 'stroke-dashoffset 5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      path.style.strokeDashoffset = '0';
      
      // 绘制完成后，延迟消失
      setTimeout(() => {
        // 渐隐
        connectionLine.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
        connectionLine.style.opacity = '0';
        
        // 完全消失后清理资源
        setTimeout(() => {
          if (connectionLine.parentNode) {
            connectionLine.parentNode.removeChild(connectionLine);
          }
          // 清理变量引用
          connectionLine.remove();
          svg.remove();
          path.remove();
          
          // 从数组中移除连接线引用
          const index = this.connectionLines.findIndex(line => line.id === lineId);
          if (index > -1) {
            this.connectionLines.splice(index, 1);
          }
        }, 800);
      }, 5000); // 线条绘制完成后等待1500ms再消失
    };

    // 开始动画
    animateLine();

    // 监听窗口大小变化，更新线条位置
    const resizeObserver = new ResizeObserver(() => {
      updateLinePosition();
    });
    
    // 监听滚动，更新线条位置
    const scrollHandler = () => {
      updateLinePosition();
    };
    
    window.addEventListener('scroll', scrollHandler, { passive: true });
    window.addEventListener('resize', updateLinePosition);
    
    // 在动画完成后清理事件监听器
    setTimeout(() => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('resize', updateLinePosition);
    }, 10000); // 10秒后清理，确保动画完成
  }
}

// 创建并初始化悬浮窗口
let floatingWindow = null;

// 等待页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    floatingWindow = new FloatingWindow();
  });
} else {
  floatingWindow = new FloatingWindow();
}
