/**
 * Auto-scroll the ZSXQ feed and capture posts within an export window, then stop.
 */
const ZSXQAutoScrollCapture = {
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  findScrollableParent(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const oy = style.overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight + 20) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  },

  getScrollRoot() {
    const viewport = document.querySelector('cdk-virtual-scroll-viewport');
    if (viewport) return viewport;

    const anchor = document.querySelector('app-topic, .talk-content-container, app-group-topics');
    const parent = anchor ? this.findScrollableParent(anchor) : null;
    if (parent) return parent;

    const candidates = [
      document.querySelector('app-group-topics .scroll-container'),
      document.querySelector('.group-content'),
      document.querySelector('.main-content')
    ].filter(Boolean);

    for (const el of candidates) {
      if (el.scrollHeight > el.clientHeight + 80) return el;
    }
    return document.scrollingElement || document.documentElement;
  },

  isWindowScrollRoot(root) {
    return root === document.documentElement
      || root === document.body
      || root === document.scrollingElement;
  },

  getScrollTop(root) {
    return this.isWindowScrollRoot(root) ? window.scrollY : root.scrollTop;
  },

  scrollToTop(root) {
    if (this.isWindowScrollRoot(root)) {
      window.scrollTo(0, 0);
    } else {
      root.scrollTop = 0;
    }
  },

  scrollStep(root, ratio = 0.8) {
    const delta = (this.isWindowScrollRoot(root) ? window.innerHeight : root.clientHeight) * ratio;
    if (this.isWindowScrollRoot(root)) {
      window.scrollBy(0, delta);
    } else {
      root.scrollTop += delta;
    }
  },

  getOrderedPostElements() {
    return [...document.querySelectorAll('app-topic .talk-content-container .content, .talk-content-container .content')];
  },

  getPostPublishedAt(contentEl) {
    const scope = ZSXQContentExtractor.getPostScope(contentEl);
    const text = (contentEl?.textContent || '').replace(/\s+/g, ' ').trim();
    const apiMeta = typeof ZSXQTopicImageCache !== 'undefined'
      ? ZSXQTopicImageCache.lookupMeta(contentEl, text)
      : null;
    const fromApi = apiMeta?.published_at;
    if (fromApi) return fromApi;

    const fromDom = ZSXQContentExtractor.extractPublishedAt(scope);
    if (fromDom) return fromDom;

    const header = scope?.querySelector?.('.post-topic-head, .topic-head, [class*="topic-head"]');
    const headerText = header?.textContent || scope?.textContent?.slice(0, 120) || '';
    const rel = headerText.match(/刚刚|\d+\s*分钟前|\d+\s*小时前|今天|昨天|前天/);
    if (rel) return rel[0];
    const ymd = headerText.match(/\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/);
    if (ymd) return ymd[0];
    return '';
  },

  classifyPostWindow(publishedAt, windowStart) {
    if (!publishedAt) return 'unknown';
    const parsed = ZSXQDailyExport.parsePublishedDateLoose(publishedAt);
    if (!parsed) return 'unknown';
    return parsed.getTime() > windowStart.getTime() ? 'in_window' : 'before_window';
  },

  scanDomWindow(elements, windowStart) {
    let hasInWindow = false;
    let hasBefore = false;
    let known = 0;

    for (const el of elements) {
      const kind = this.classifyPostWindow(this.getPostPublishedAt(el), windowStart);
      if (kind === 'in_window') hasInWindow = true;
      if (kind === 'before_window') hasBefore = true;
      if (kind !== 'unknown') known += 1;
    }
    return { hasInWindow, hasBefore, known };
  },

  getBottomPostKey() {
    const els = this.getOrderedPostElements();
    const last = els[els.length - 1];
    if (!last) return '';
    return ZSXQContentExtractor.hashRecord(ZSXQContentExtractor.extractPostRecord(last));
  },

  shouldStop({
    step,
    maxScrolls,
    elapsedMs,
    maxMs,
    scrollStuckRounds,
    noNewInWindowRounds,
    inWindowCount,
    maxPosts,
    domScan,
    passedBoundary
  }) {
    if (step >= maxScrolls) return 'max_scrolls';
    if (elapsedMs >= maxMs) return 'timeout';
    if (scrollStuckRounds >= 3) return 'scroll_stuck';
    if (maxPosts > 0 && inWindowCount >= maxPosts) return 'max_posts';

    if (passedBoundary && noNewInWindowRounds >= 1) return 'past_window';
    if (inWindowCount > 0 && noNewInWindowRounds >= 3) return 'no_new_in_window';
    if (domScan.hasInWindow && domScan.hasBefore && noNewInWindowRounds >= 1) return 'window_boundary';
    if (domScan.hasBefore && !domScan.hasInWindow && inWindowCount > 0) return 'only_older_left';

    return null;
  },

  async captureInWindow(floatingWindow, { windowStart, maxPosts, onProgress } = {}) {
    if (!windowStart) throw new Error('windowStart is required');

    const postLimit = Number(maxPosts) || ZSXQDailyExport.DEFAULT_MAX_POSTS;

    const root = this.getScrollRoot();
    const maxScrolls = 35;
    const maxMs = 90000;
    const startedAt = Date.now();

    let scrollStuckRounds = 0;
    let noNewInWindowRounds = 0;
    let passedBoundary = false;
    let lastScrollTop = this.getScrollTop(root);

    this.scrollToTop(root);
    await this.delay(700);

    for (let step = 0; step < maxScrolls; step += 1) {
      const elements = this.getOrderedPostElements();
      const domScan = this.scanDomWindow(elements, windowStart);

      let newInWindow = 0;
      const currentInWindow = ZSXQDailyExport.filterByWindow(
        floatingWindow.contentArray,
        windowStart,
        postLimit
      ).length;

      for (const content of elements) {
        if (currentInWindow + newInWindow >= postLimit) break;

        const publishedAt = this.getPostPublishedAt(content);
        if (this.classifyPostWindow(publishedAt, windowStart) !== 'in_window') continue;

        const record = ZSXQContentExtractor.extractPostRecord(content);
        const hash = ZSXQContentExtractor.hashRecord(record);
        if (floatingWindow.contentHashes.has(hash)) continue;

        floatingWindow.contentHashes.add(hash);
        floatingWindow.contentArray.push(floatingWindow.extractContentInfo(content, hash, record));
        newInWindow += 1;
      }

      if (newInWindow > 0) {
        floatingWindow.updateNumber(floatingWindow.contentHashes.size);
        noNewInWindowRounds = 0;
      } else {
        noNewInWindowRounds += 1;
      }

      if (domScan.hasBefore) passedBoundary = true;

      const inWindowCount = ZSXQDailyExport.filterByWindow(
        floatingWindow.contentArray,
        windowStart,
        postLimit
      ).length;
      const elapsedMs = Date.now() - startedAt;

      onProgress?.({
        step: step + 1,
        inWindowCount,
        newInWindow,
        domScan,
        passedBoundary,
        scrollStuckRounds
      });

      const stopReason = this.shouldStop({
        step,
        maxScrolls,
        elapsedMs,
        maxMs,
        scrollStuckRounds,
        noNewInWindowRounds,
        inWindowCount,
        maxPosts: postLimit,
        domScan,
        passedBoundary
      });

      if (stopReason) {
        console.log(`[导出增量] 停止滚动: ${stopReason}，窗口内 ${inWindowCount}/${postLimit} 帖，第 ${step + 1} 步`);
        break;
      }

      const beforeTop = lastScrollTop;
      const beforeBottomKey = this.getBottomPostKey();
      this.scrollStep(root);
      await this.delay(800);
      const afterTop = this.getScrollTop(root);
      const afterBottomKey = this.getBottomPostKey();
      lastScrollTop = afterTop;

      const scrollMoved = Math.abs(afterTop - beforeTop) >= 8;
      const contentMoved = beforeBottomKey && afterBottomKey && beforeBottomKey !== afterBottomKey;
      if (!scrollMoved && !contentMoved) {
        scrollStuckRounds += 1;
      } else {
        scrollStuckRounds = 0;
      }
    }

    return {
      inWindowCount: ZSXQDailyExport.filterByWindow(
        floatingWindow.contentArray,
        windowStart,
        postLimit
      ).length,
      totalCaptured: floatingWindow.contentArray.length,
      maxPosts: postLimit
    };
  },

  /** @deprecated */
  async captureToday(floatingWindow, options = {}) {
    const dateStr = options.dateStr || ZSXQDailyExport.todayDateString();
    const start = new Date(`${dateStr}T00:00:00`);
    start.setMilliseconds(start.getMilliseconds() - 1);
    return this.captureInWindow(floatingWindow, { ...options, windowStart: start });
  }
};

if (typeof window !== 'undefined') {
  window.ZSXQAutoScrollCapture = ZSXQAutoScrollCapture;
}
