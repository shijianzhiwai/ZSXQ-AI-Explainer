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
    this.isAutoScrolling = false;
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
        <button class="floating-export-btn" id="export-btn">导出 JSON</button>
        <button class="floating-daily-btn" id="daily-btn">导出增量</button>
        <button class="floating-copy-btn" id="copy-btn">复制 JSON</button>
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
        width: 110px;
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

      .floating-export-btn,
      .floating-daily-btn,
      .floating-copy-btn {
        width: 80%;
        padding: 6px 8px;
        margin: 4px auto 0;
        display: block;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .floating-export-btn {
        background: linear-gradient(135deg, #722ed1, #9254de);
        box-shadow: 0 2px 6px rgba(114, 46, 209, 0.3);
      }

      .floating-export-btn:hover {
        background: linear-gradient(135deg, #531dab, #722ed1);
      }

      .floating-daily-btn {
        background: linear-gradient(135deg, #fa8c16, #ffa940);
        box-shadow: 0 2px 6px rgba(250, 140, 22, 0.3);
      }

      .floating-daily-btn:hover {
        background: linear-gradient(135deg, #d46b08, #fa8c16);
      }

      .floating-copy-btn {
        background: linear-gradient(135deg, #13c2c2, #36cfc9);
        box-shadow: 0 2px 6px rgba(19, 194, 194, 0.3);
      }

      .floating-copy-btn:hover {
        background: linear-gradient(135deg, #08979c, #13c2c2);
      }

      .floating-export-btn:disabled,
      .floating-daily-btn:disabled,
      .floating-copy-btn:disabled {
        background: #6c757d;
        cursor: not-allowed;
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

    const exportBtn = this.floatingWindow.querySelector('#export-btn');
    exportBtn.addEventListener('click', this.handleExport.bind(this));

    const dailyBtn = this.floatingWindow.querySelector('#daily-btn');
    dailyBtn.addEventListener('click', this.handleDailyExport.bind(this));

    const copyBtn = this.floatingWindow.querySelector('#copy-btn');
    copyBtn.addEventListener('click', this.handleCopy.bind(this));

    // 防止拖拽时选中文本
    this.floatingWindow.addEventListener('selectstart', (e) => e.preventDefault());
  }

  dragStart(e) {
    if (e.target.closest('.floating-summary-btn, .floating-export-btn, .floating-daily-btn, .floating-copy-btn, .floating-clear-btn, .floating-toggle-btn')) {
      return;
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
    if (this.isProcessing || this.isAutoScrolling) return;
    this.isProcessing = true;

    try {
      await this.ingestContentElements(this.getNewContentElements());
    } catch (error) {
      console.error('处理滚动内容时出错:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async ingestContentElements(elements, { skipMarkers = false } = {}) {
    let newCount = 0;

    for (const content of elements) {
      const record = ZSXQContentExtractor.extractPostRecord(content);
      const hash = ZSXQContentExtractor.hashRecord(record);

      if (!this.contentHashes.has(hash)) {
        this.contentHashes.add(hash);
        newCount += 1;

        const contentInfo = this.extractContentInfo(content, hash, record);
        this.contentArray.push(contentInfo);

        const imageHint = record.images.length ? ` [${record.images.length}图]` : '';
        console.log('发现新内容:', record.text.substring(0, 50) + '...' + imageHint);

        if (!skipMarkers) {
          this.addContentMarker(content);
        }
      }
    }

    if (newCount > 0) {
      this.updateNumber(this.contentHashes.size);
    }

    return newCount;
  }

  /** 从当前 DOM 采集已加载帖子（不依赖「开始」开关） */
  async captureLoadedPostsFromDom() {
    const elements = typeof ZSXQAutoScrollCapture !== 'undefined'
      ? ZSXQAutoScrollCapture.getOrderedPostElements()
      : [...document.querySelectorAll('.talk-content-container .content')];
    return this.ingestContentElements(elements, { skipMarkers: true });
  }

  /** 导出/复制前确保有数据；返回是否可用 */
  async ensureContentForExport() {
    if (this.contentArray.length > 0) return true;
    const added = await this.captureLoadedPostsFromDom();
    if (this.contentArray.length > 0) {
      console.log(`[导出] 已从当前页面采集 ${added} 条新帖子（共 ${this.contentArray.length} 条）`);
      return true;
    }
    return false;
  }

  async autoScrollCaptureWindow(windowStart, onProgress, maxPosts) {
    const wasCapturing = this.isCapturing;
    this.isCapturing = true;
    this.isAutoScrolling = true;
    try {
      return await ZSXQAutoScrollCapture.captureInWindow(this, { windowStart, maxPosts, onProgress });
    } finally {
      this.isAutoScrolling = false;
      this.isCapturing = wasCapturing;
    }
  }

  async autoScrollCaptureTopPosts(maxPosts, onProgress) {
    const wasCapturing = this.isCapturing;
    this.isCapturing = true;
    this.isAutoScrolling = true;
    try {
      return await ZSXQAutoScrollCapture.captureTopPosts(this, { maxPosts, onProgress });
    } finally {
      this.isAutoScrolling = false;
      this.isCapturing = wasCapturing;
    }
  }

  async ensureDigestsFeed() {
    const active = document.querySelector('.menu-item.active, .tab-item.active, .active');
    if (active?.textContent?.trim() === '精华') return true;

    const candidates = [...document.querySelectorAll('a, button, li, div, span')];
    const digestsTab = candidates.find((el) => {
      if (el.textContent?.trim() !== '精华') return false;
      if (el.closest('app-topic, .talk-content-container')) return false;
      return true;
    });

    if (!digestsTab) return false;
    digestsTab.click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return true;
  }

  resetCapturedContent() {
    this.contentArray = [];
    this.contentHashes.clear();
    this.updateNumber(0);
  }

  async handleDebugFeedExport(options = {}) {
    const silent = options.silent === true;
    const slug = String(options.slug || options.inbox_slug || '').trim();
    const count = Number(options.count) || 10;
    const navigateDigests = options.navigate_digests !== false;

    if (!slug) {
      return { ok: false, error: 'slug is required' };
    }

    const dailyBtn = this.floatingWindow?.querySelector('#daily-btn');
    if (dailyBtn && !silent) {
      dailyBtn.disabled = true;
      dailyBtn.textContent = '调试导出中...';
    }

    try {
      if (navigateDigests) {
        const switched = await this.ensureDigestsFeed();
        if (!switched) {
          console.warn('[debug export] 未找到「精华」标签，将导出当前页面可见帖子');
        }
      }

      this.resetCapturedContent();

      const scrollResult = await this.autoScrollCaptureTopPosts(
        count,
        ({ captured, step, target }) => {
          if (dailyBtn && !silent) {
            dailyBtn.textContent = `调试抓取 ${captured}/${target}…`;
          }
          if (step % 5 === 0) {
            console.log(`[debug export] 滚动第 ${step} 步，${captured}/${target} 帖`);
          }
        }
      );

      const topItems = ZSXQDailyExport.takeTopPosts(this.contentArray, count);
      if (topItems.length === 0) {
        const error = '当前页面未采集到帖子，请确认已打开知识星球并切换到「精华」';
        if (!silent) alert(error);
        return { ok: false, error, scrollResult };
      }

      if (dailyBtn && !silent) dailyBtn.textContent = '调试导出中...';

      const enriched = await ZSXQDailyExport.enrichTopPosts(topItems, count);
      const group = enriched[0]?.group || ZSXQContentExtractor.getGroupName();
      const exportTime = new Date().toISOString();
      const manifest = ZSXQDailyExport.buildManifest(enriched, {
        date: slug,
        inboxSlug: slug,
        group,
        exportTime,
        exportMode: 'debug_digests',
        feed: 'digests',
        exportWindow: {
          mode: 'debug_top_n',
          count,
          feed: 'digests'
        },
        maxPosts: count,
        checkpointAfter: null
      });
      const images = ZSXQDailyExport.collectImagePayloads(enriched);

      const response = await chrome.runtime.sendMessage({
        action: 'saveDailyBundle',
        payload: { date: slug, manifest, images, mode: 'auto' }
      });

      if (!response?.ok) {
        throw new Error(response?.error || '导出失败');
      }

      const articleLinks = enriched.filter((post) => post.post_kind === 'article_link').length;
      const msg = `调试导出完成：${manifest.post_count} 帖（${articleLinks} 篇待读长文）→ daily-inbox/${slug}/`;
      if (!silent) alert(msg);
      console.log('[debug export]', response.result, manifest);

      return {
        ok: true,
        slug,
        manifest,
        result: response.result,
        scrollResult,
        article_link_count: articleLinks
      };
    } catch (error) {
      console.error('[debug export] failed:', error);
      if (!silent) alert(`调试导出失败：${error.message}`);
      return { ok: false, error: error.message };
    } finally {
      if (dailyBtn && !silent) {
        dailyBtn.disabled = false;
        dailyBtn.textContent = '导出增量';
      }
    }
  }

  /** @deprecated */
  async autoScrollCaptureToday(dateStr, onProgress) {
    const exportWindow = await ZSXQDailyExport.getExportWindow();
    return this.autoScrollCaptureWindow(exportWindow.start, onProgress);
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
    const record = ZSXQContentExtractor.extractPostRecord(content);
    return ZSXQContentExtractor.hashRecord(record);
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

  // 提取内容信息（目标 JSON 格式）
  extractContentInfo(content, hash, record = null) {
    const rect = content.getBoundingClientRect();
    const data = record || ZSXQContentExtractor.extractPostRecord(content);

    return {
      ...data,
      id: data.topic_id || hash,
      captured_at: Date.now(),
      position: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }
    };
  }

  async getExportPayload({ embedImages = true } = {}) {
    const rawContents = this.contentArray.map(({ position, ...item }) => item);

    if (!embedImages) {
      return {
        source: 'zsxq',
        exportTime: new Date().toISOString(),
        totalCount: rawContents.length,
        contents: rawContents
      };
    }

    const contents = [];
    for (const item of rawContents) {
      const normalizedText = item.text.replace(/\s+/g, ' ').trim();
      const liveContent = [...document.querySelectorAll('.talk-content-container .content')].find(
        (el) => el.textContent.replace(/\s+/g, ' ').trim() === normalizedText
      );
      const live = liveContent ? ZSXQContentExtractor.extractPostRecord(liveContent) : null;
      const liveScope = liveContent ? ZSXQContentExtractor.getPostScope(liveContent) : null;
      const images = live?.images?.length ? live.images : item.images;
      const resolvedImages = await ZSXQContentExtractor.resolveImages(images, liveScope);
      const enriched = {
        ...item,
        author: live?.author || item.author,
        published_at: live?.published_at || item.published_at,
        images: resolvedImages
      };
      enriched.ai_payload = ZSXQContentExtractor.buildAiPayload(enriched);
      contents.push(enriched);
    }

    return {
      source: 'zsxq',
      exportTime: new Date().toISOString(),
      totalCount: contents.length,
      contents
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
      const content = this.contentArray
        .map((item) => item.ai_payload || item.text)
        .join('\n\n---\n\n');
      await showStreamResponse(content, null, true);
    } catch (error) {
      console.error('汇总失败:', error);
    } finally {
      summaryBtn.disabled = false;
      summaryBtn.textContent = '一键汇总内容';
    }
  }

  async handleDailyExport(options = {}) {
    const silent = options.silent === true;
    const { exportWindow, maxPosts } = await ZSXQDailyExport.getExportConfig();
    const dateStr = ZSXQDailyExport.todayDateString();
    const windowLabel = `${ZSXQDailyExport.formatWindowLabel(exportWindow)}，最多 ${maxPosts} 条`;
    const dailyBtn = this.floatingWindow?.querySelector('#daily-btn');

    if (dailyBtn && !silent) {
      dailyBtn.disabled = true;
      dailyBtn.textContent = '抓取中...';
    }

    try {
      const scrollResult = await this.autoScrollCaptureWindow(
        exportWindow.start,
        ({ inWindowCount, step }) => {
          if (dailyBtn && !silent) {
            dailyBtn.textContent = `抓取 ${inWindowCount}/${maxPosts}…`;
          }
          if (step % 5 === 0) {
            console.log(`[导出增量] 滚动第 ${step} 步，${inWindowCount}/${maxPosts} 帖（${windowLabel}）`);
          }
        },
        maxPosts
      );

      const windowItems = ZSXQDailyExport.filterByWindow(this.contentArray, exportWindow.start, maxPosts);
      if (windowItems.length === 0) {
        const error = `导出窗口内未找到帖子。范围：${windowLabel}，已扫描 ${scrollResult.totalCaptured} 条 DOM 记录。`;
        if (!silent) alert(`导出窗口内未找到帖子。\n范围：${windowLabel}\n已扫描 ${scrollResult.totalCaptured} 条 DOM 记录。`);
        return { ok: false, error };
      }

      if (dailyBtn && !silent) dailyBtn.textContent = '导出中...';

      const enriched = await ZSXQDailyExport.enrichPostsInWindow(
        this.contentArray,
        exportWindow.start,
        maxPosts
      );
      const group = enriched[0]?.group || ZSXQContentExtractor.getGroupName();
      const manifest = ZSXQDailyExport.buildManifest(enriched, {
        date: dateStr,
        group,
        exportTime: new Date().toISOString(),
        exportWindow,
        maxPosts,
        checkpointAfter: ZSXQDailyExport.maxPublishedAt(enriched)?.toISOString() || null
      });
      const images = ZSXQDailyExport.collectImagePayloads(enriched);

      const response = await chrome.runtime.sendMessage({
        action: 'saveDailyBundle',
        payload: { date: dateStr, manifest, images, mode: 'auto' }
      });

      if (!response?.ok) {
        throw new Error(response?.error || '导出失败');
      }

      const checkpointAfter = await ZSXQDailyExport.saveExportCheckpoint(enriched);
      if (checkpointAfter) {
        manifest.checkpoint_after = checkpointAfter;
      }

      const method = response.result?.method || 'unknown';
      const msg = method === 'inbox'
        ? `增量内容已写入仓库 inbox（${manifest.post_count} 帖，${manifest.image_count} 图）`
        : `增量内容已下载到 daily-inbox/${dateStr}/（${manifest.post_count} 帖，${manifest.image_count} 图）`;
      if (!silent) {
        alert(`${msg}\n\n范围：${windowLabel}\n新截止点：${checkpointAfter || '—'}`);
      }
      console.log('Incremental export result:', response.result, manifest);
      return {
        ok: true,
        manifest,
        result: response.result,
        checkpointAfter,
        windowLabel
      };
    } catch (error) {
      console.error('Incremental export failed:', error);
      if (!silent) alert(`导出失败：${error.message}`);
      return { ok: false, error: error.message };
    } finally {
      if (dailyBtn && !silent) {
        dailyBtn.disabled = false;
        dailyBtn.textContent = '导出增量';
      }
    }
  }

  async handleExport() {
    const exportBtn = this.floatingWindow.querySelector('#export-btn');
    exportBtn.disabled = true;
    exportBtn.textContent = '采集中...';

    try {
      if (!(await this.ensureContentForExport())) {
        alert('暂无内容可导出。\n\n• 「导出 JSON / 复制 JSON」导出当前页面已加载的帖子\n• 若列表使用虚拟滚动，请先向下滚动加载更多，或点「开始」边滚边抓\n• 需要按时间窗口批量抓取请用「导出增量」');
        return;
      }

      exportBtn.textContent = '导出中...';
      await this.exportContent();
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = '导出 JSON';
    }
  }

  async handleCopy() {
    const copyBtn = this.floatingWindow.querySelector('#copy-btn');
    copyBtn.disabled = true;
    copyBtn.textContent = '采集中...';

    try {
      if (!(await this.ensureContentForExport())) {
        alert('暂无内容可复制。\n\n• 请先向下滚动让帖子出现在页面中\n• 或使用「导出增量」自动滚动抓取');
        return;
      }

      copyBtn.textContent = '处理图片...';
      const exportData = await this.getExportPayload({ embedImages: true });
      copyBtn.textContent = '复制中...';
      const json = JSON.stringify(exportData, null, 2);
      await navigator.clipboard.writeText(json);
      copyBtn.textContent = '已复制';
      console.log('JSON 已复制到剪贴板（含 data_url）');
    } catch (error) {
      console.error('复制失败:', error);
      copyBtn.textContent = '复制失败';
    } finally {
      setTimeout(() => {
        copyBtn.disabled = false;
        copyBtn.textContent = '复制 JSON';
      }, 1500);
    }
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
      item.captured_at >= startTime && item.captured_at <= endTime
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
  async exportContent() {
    const exportData = await this.getExportPayload({ embedImages: true });
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zsxq-content-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const embedded = exportData.contents.reduce(
      (sum, item) => sum + (item.images || []).filter((img) => img.data_url).length,
      0
    );
    console.log(`内容已导出为 JSON（${embedded} 张图片已嵌入 data_url）`, exportData);
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
const FLOATING_WINDOW_HOST = 'wx.zsxq.com';

function shouldShowFloatingWindow() {
  return location.hostname === FLOATING_WINDOW_HOST;
}

function initZsxqExtractorApi() {
  const api = {
    extractPost: (index) => ZSXQContentExtractor.extractPostByIndex(index),
    extractPostAt: (x, y) => ZSXQContentExtractor.extractPostAt(x, y),
    extractAllVisible: () => ZSXQContentExtractor.extractAllVisible(),
    extractHdImages: async (index = 0) => {
      const content = document.querySelectorAll('.talk-content-container .content')[index];
      if (!content) return null;
      const post = ZSXQContentExtractor.getPostContainer(content);
      const scope = ZSXQContentExtractor.getPostScope(content);
      const text = content.textContent.replace(/\s+/g, ' ').trim();
      return ZSXQContentExtractor.extractImagesWithFallback(post, scope, content, text, { usePreview: true });
    },
    getCaptured: () => floatingWindow?.getAllContent() || [],
    enrichRecord: (record) => ZSXQContentExtractor.enrichRecord(record),
    cacheStats: () => ({
      byText: ZSXQTopicImageCache?.byText?.size || 0,
      byTopicId: ZSXQTopicImageCache?.byTopicId?.size || 0,
      byImageKey: ZSXQTopicImageCache?.byImageKey?.size || 0
    }),
    exportJson: () => floatingWindow?.exportContent(),
    exportToday: () => floatingWindow?.handleDailyExport(),
    exportIncremental: (options) => floatingWindow?.handleDailyExport(options),
    exportDebugFeed: (options) => floatingWindow?.handleDebugFeedExport(options),
    autoScrollWindow: (windowStart) => floatingWindow?.autoScrollCaptureWindow(windowStart),
    autoScrollToday: () => floatingWindow?.handleDailyExport(),
    copyJson: () => floatingWindow?.handleCopy()
  };
  window.zsxqExtractor = api;
  window.ZSXQExtractor = api;
}

function bootFloatingWindow() {
  if (shouldShowFloatingWindow()) {
    floatingWindow = new FloatingWindow();
  }
  initZsxqExtractorApi();
}

// 等待页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFloatingWindow);
} else {
  bootFloatingWindow();
}
