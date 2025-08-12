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
    this.init();
  }

  init() {
    // 创建悬浮窗口元素
    this.createFloatingWindow();
    // 绑定事件
    this.bindEvents();
    // 设置初始位置（右上角）
    this.setInitialPosition();
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

  bindEvents() {
    // 拖拽事件
    this.floatingWindow.addEventListener('mousedown', this.dragStart.bind(this));
    document.addEventListener('mousemove', this.drag.bind(this));
    document.addEventListener('mouseup', this.dragEnd.bind(this));

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
      if (isProcessing) return;
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.processScrollContent();
      }, 300); // 300ms节流
    }, { passive: true });

    // 初始处理一次
    setTimeout(() => {
      this.processScrollContent();
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
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
      
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

  // 处理汇总按钮点击
  async handleSummary() {
    // this.exportContent();
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
    console.log('内容数组已清空');
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
    if (this.floatingWindow && this.floatingWindow.parentNode) {
      this.floatingWindow.parentNode.removeChild(this.floatingWindow);
    }
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
