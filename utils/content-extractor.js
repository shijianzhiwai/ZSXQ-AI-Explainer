/**
 * 从知识星球帖子 DOM 提取文字 + 图片，输出适合 AI 总结的结构化数据。
 */
const ZSXQ_REFERER = 'https://wx.zsxq.com/';
const ZSXQ_TOPIC_URL_BASE = 'https://wx.zsxq.com';

const ZSXQContentExtractor = {
  getGroupName() {
    const title = document.title || '';
    const match = title.match(/^(.+?)[-–—]知识星球/);
    if (match) return match[1].trim();
    return title.replace(/知识星球/g, '').trim() || '知识星球';
  },

  getGroupId() {
    const fromPath = window.location.pathname.match(/\/group\/(\d+)/)?.[1];
    if (fromPath) return fromPath;
    const fromHref = window.location.href.match(/\/group\/(\d+)/)?.[1];
    return fromHref || '';
  },

  parseTopicIdFromScope(contentElement) {
    const topicRoot = contentElement?.closest?.('app-topic');
    if (!topicRoot) return '';

    const html = topicRoot.innerHTML || '';
    const idMatch = html.match(/topic_(?:id|uid)["']?\s*[:=]\s*["']?(-?\d+)/i);
    if (idMatch) return idMatch[1];

    const dataId = topicRoot.getAttribute?.('data-topic-id')
      || topicRoot.getAttribute?.('data-topic_uid');
    return dataId ? String(dataId) : '';
  },

  buildTopicUrl(topicId, groupId = this.getGroupId()) {
    if (!topicId || !groupId) return '';
    return `${ZSXQ_TOPIC_URL_BASE}/group/${groupId}/topic/${topicId}`;
  },

  resolveTopicId(contentElement, text, apiMeta) {
    if (apiMeta?.topic_id) return String(apiMeta.topic_id);
    const fromDom = this.parseTopicIdFromScope(contentElement);
    if (fromDom) return fromDom;
    return '';
  },

  getPostContainer(contentElement) {
    return contentElement?.closest?.('.talk-content-container') || null;
  },

  getPostScope(contentElement) {
    const topicRoot = contentElement?.closest?.('app-topic');
    if (topicRoot) return topicRoot;

    const container = this.getPostContainer(contentElement);
    if (!container) return null;
    return container.parentElement || container;
  },

  extractAuthor(scope) {
    if (!scope) return '';

    const selectors = [
      '.post-topic-head .name',
      'app-common-user .name',
      '.author .name',
      '.author-name',
      '.user-name',
      '.name.text-ellipsis',
      '.name.ng-star-inserted',
      '.topic-author .name',
      '[class*="author"] .name'
    ];
    for (const selector of selectors) {
      const el = scope.querySelector(selector);
      const name = el?.textContent?.trim();
      if (name && name.length < 40 && !/\d{4}-\d{2}-\d{2}/.test(name) && !name.startsWith('#')) {
        return name;
      }
    }

    const header = scope.querySelector('.post-topic-head, .topic-head, app-group-topic-header, [class*="topic-head"]');
    if (header) {
      const match = header.textContent.match(/([\u4e00-\u9fa5A-Za-z0-9_·]+)\s*\d{4}-\d{2}-\d{2}/);
      if (match) return match[1].trim();
    }

    return '';
  },

  extractPublishedAt(scope) {
    if (!scope) return '';

    const selectors = [
      'time',
      '.time',
      '.date',
      '.date-time',
      '.post-time',
      '.create-time',
      '[class*="publish"]',
      '[class*="time"]'
    ];
    for (const selector of selectors) {
      const el = scope.querySelector(selector);
      const time = el?.getAttribute?.('datetime') || el?.textContent?.trim();
      if (time && /\d{4}/.test(time) && time.length < 40) return time;
    }

    const headerText = scope.textContent || '';
    const match = headerText.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
    return match ? match[0] : '';
  },

  extractTags(scope, text) {
    const tags = new Set();
    if (scope) {
      scope.querySelectorAll('a').forEach((link) => {
        const label = link.textContent.trim();
        if (label.startsWith('#')) {
          tags.add(label.slice(1));
        }
      });
    }
    const inlineTags = text.match(/#[^\s#]+/g) || [];
    inlineTags.forEach((tag) => tags.add(tag.slice(1)));
    return [...tags];
  },

  isAvatarImg(img) {
    if (!img) return true;
    if (img.classList.contains('avatar') || img.classList.contains('avatar-item')) {
      return true;
    }
    if (img.classList.contains('item') || img.classList.contains('group-item') || img.classList.contains('single-img')) {
      return false;
    }
    return !!img.closest('.user-avatar, .avatars, .author, .post-topic-head');
  },

  imageKey(url) {
    const match = String(url).match(/images\.zsxq\.com\/([^?]+)/);
    return match ? match[1] : url;
  },

  isOriginalUrl(url) {
    if (!url) return false;
    return url.includes('quality/100') || (!url.includes('thumbnail') && !url.includes('blur/'));
  },

  isDirectCdnUrl(url) {
    return this.isOriginalUrl(url);
  },

  getNgContextValues(element) {
    const ctx = element?.__ngContext__;
    if (!ctx) return [];
    if (Array.isArray(ctx)) return ctx;
    if (typeof ctx === 'object') return Object.values(ctx);
    return [];
  },

  findGalleryImageList(gallery) {
    if (!gallery) return null;

    for (const value of this.getNgContextValues(gallery)) {
      if (value?.images?.length && (value.images[0].thumbnail || value.images[0].original || value.images[0].large)) {
        return value.images;
      }
      if (Array.isArray(value) && value.length && (value[0].thumbnail || value[0].original || value[0].large)) {
        return value;
      }
    }
    return null;
  },

  pickImageUrl(imageObj) {
    if (!imageObj) return '';
    const maxOriginalBytes = 5 * 1024 * 1024;

    if (imageObj.original?.url) {
      if (!imageObj.original.size || imageObj.original.size < maxOriginalBytes) {
        return imageObj.original.url;
      }
      if (imageObj.large?.url) return imageObj.large.url;
      return imageObj.original.url;
    }
    if (imageObj.large?.url) return imageObj.large.url;
    if (imageObj.thumbnail?.url) return imageObj.thumbnail.url;
    return imageObj.url || '';
  },

  mapComponentImages(images) {
    return images.map((img, index) => {
      const url = this.pickImageUrl(img);
      const imageKey = this.imageKey(url) || (img.image_id ? String(img.image_id) : `img-${index}`);
      return {
        index: index + 1,
        image_id: img.image_id || null,
        image_key: imageKey,
        url,
        width: img.original?.width || img.large?.width || img.thumbnail?.width || img.width,
        height: img.original?.height || img.large?.height || img.thumbnail?.height || img.height,
        size: img.original?.size || null,
        thumbnail_url: img.thumbnail?.url || null,
        original_url: img.original?.url || null,
        large_url: img.large?.url || null,
        ocr_text: '',
        url_accessible: this.isOriginalUrl(url),
        source: 'component'
      };
    });
  },

  extractImagesFromGallery(post, scope) {
    const roots = [...new Set([post, scope].filter(Boolean))];

    for (const root of roots) {
      const galleries = root.querySelectorAll('app-image-gallery');
      for (const gallery of galleries) {
        const images = this.findGalleryImageList(gallery);
        if (images?.length) {
          return this.mapComponentImages(images);
        }
      }
    }
    return null;
  },

  collectUrlMap(post, scope) {
    const map = new Map();
    const roots = [...new Set([post, scope].filter(Boolean))];

    roots.forEach((root) => {
      root.querySelectorAll('img.group-item, img.single-img').forEach((img) => {
        if (this.isAvatarImg(img)) return;
        const src = img.currentSrc || img.src;
        if (!src?.includes('images.zsxq.com')) return;
        const key = this.imageKey(src);
        const existing = map.get(key);
        if (!existing || (!this.isDirectCdnUrl(existing) && this.isDirectCdnUrl(src))) {
          map.set(key, src);
        }
      });
    });
    return map;
  },

  extractImages(post, scope, contentElement, text) {
    if (!post) return [];

    const fromComponent = this.extractImagesFromGallery(post, scope);
    if (fromComponent?.length) {
      return fromComponent;
    }

    if (typeof ZSXQTopicImageCache !== 'undefined' && contentElement) {
      const fromApi = ZSXQTopicImageCache.lookup(contentElement, text);
      if (fromApi?.length) {
        return fromApi;
      }
    }

    const urlByKey = this.collectUrlMap(post, scope);
    const orderedKeys = [];

    post.querySelectorAll('.image-gallery-container img.item').forEach((img) => {
      if (this.isAvatarImg(img)) return;
      const src = img.currentSrc || img.src;
      if (!src?.includes('images.zsxq.com')) return;
      const key = this.imageKey(src);
      orderedKeys.push(key);
      if (!urlByKey.has(key) || !this.isDirectCdnUrl(urlByKey.get(key))) {
        urlByKey.set(key, src);
      }
    });

    if (!orderedKeys.length) {
      const roots = [...new Set([post, scope].filter(Boolean))];
      roots.forEach((root) => {
        root.querySelectorAll('img.single-img, .image-container img.item, img.group-item').forEach((img) => {
        if (this.isAvatarImg(img)) return;
        const src = img.currentSrc || img.src;
        if (!src?.includes('images.zsxq.com')) return;
        const key = this.imageKey(src);
        orderedKeys.push(key);
        if (!urlByKey.has(key)) urlByKey.set(key, src);
        });
      });
    }

    const seen = new Set();
    const images = [];
    orderedKeys.forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      const url = urlByKey.get(key);
      if (!url) return;
      images.push({
        index: images.length + 1,
        image_key: key,
        url,
        ocr_text: '',
        url_accessible: this.isDirectCdnUrl(url),
        source: 'dom'
      });
    });

    if (typeof ZSXQTopicImageCache !== 'undefined' && images.length) {
      return ZSXQTopicImageCache.upgradeDomImages(images);
    }
    return images;
  },

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  closeImagePreview() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true
    }));
    const mask = document.querySelector('.image-full-screen-container, .flow-group-preview-container, .preview-mask');
    mask?.click?.();
  },

  getPreviewImageSrc() {
    const img = document.querySelector('img.image.can-scale, .flow-group-preview-container img.can-scale');
    return img?.currentSrc || img?.src || '';
  },

  async extractImagesFromPreview(post) {
    if (!post) return null;

    const thumb = post.querySelector('.image-gallery-container img.item, img.single-img');
    if (!thumb) return null;

    const expectedCount = Math.max(
      post.querySelectorAll('.image-gallery-container img.item').length,
      post.querySelectorAll('img.single-img').length,
      1
    );

    thumb.click();
    await this.delay(500);

    const collected = [];
    const seen = new Set();

    for (let i = 0; i < expectedCount && i < 30; i++) {
      const src = this.getPreviewImageSrc();
      if (src.includes('images.zsxq.com')) {
        const key = this.imageKey(src);
        if (!seen.has(key)) {
          seen.add(key);
          collected.push({
            index: collected.length + 1,
            image_key: key,
            url: src,
            ocr_text: '',
            url_accessible: this.isOriginalUrl(src),
            source: 'preview'
          });
        }
      }

      if (collected.length >= expectedCount) break;

      const right = document.querySelector('.right-arrow');
      if (!right || right.classList.contains('disabled')) break;

      const prevSrc = src;
      right.click();
      for (let wait = 0; wait < 15; wait++) {
        await this.delay(100);
        if (this.getPreviewImageSrc() !== prevSrc) break;
      }
    }

    this.closeImagePreview();
    await this.delay(150);

    return collected.length ? collected : null;
  },

  hasHdImages(images) {
    return (images || []).some((img) => (
      img.source === 'api'
      || img.source === 'component'
      || img.source === 'preview'
      || this.isOriginalUrl(img.url)
      || this.isOriginalUrl(img.original_url)
    ));
  },

  async extractImagesWithFallback(post, scope, contentElement, text, { usePreview = false } = {}) {
    const images = this.extractImages(post, scope, contentElement, text);
    if (!usePreview || this.hasHdImages(images)) return images;

    const previewImages = await this.extractImagesFromPreview(post);
    return previewImages || images;
  },

  buildAiPayload({ author, published_at, tags, text, images }) {
    const parts = [];
    if (author) parts.push(`作者：${author}`);
    if (published_at) parts.push(`时间：${published_at}`);
    if (tags?.length) parts.push(`标签：${tags.join(', ')}`);
    parts.push(`正文：${text || ''}`);
    (images || []).forEach((img) => {
      if (img.data_url) {
        parts.push(`【图${img.index}】已嵌入 images[${img.index - 1}].data_url（base64）`);
      } else if (img.url_accessible) {
        parts.push(`【图${img.index}】${img.url}`);
      } else {
        parts.push(`【图${img.index}】需登录访问，见 images[${img.index - 1}].data_url`);
      }
    });
    return parts.join('\n\n');
  },

  extractPostRecord(contentElement) {
    const post = this.getPostContainer(contentElement);
    const scope = this.getPostScope(contentElement);
    const text = (contentElement?.textContent || '').replace(/\s+/g, ' ').trim();
    const apiMeta = typeof ZSXQTopicImageCache !== 'undefined'
      ? ZSXQTopicImageCache.lookupMeta(contentElement, text)
      : null;
    const author = apiMeta?.author || this.extractAuthor(scope);
    const published_at = apiMeta?.published_at || this.extractPublishedAt(scope);
    const tags = this.extractTags(scope, text);
    const images = this.extractImages(post, scope, contentElement, text);
    const articleLinks = typeof ZSXQArticleLink !== 'undefined'
      ? ZSXQArticleLink.mergeArticleLinks(
        ZSXQArticleLink.extractArticleLinksFromDom(scope),
        apiMeta?.article_links || []
      )
      : (apiMeta?.article_links || []);
    const articleFields = typeof ZSXQArticleLink !== 'undefined'
      ? ZSXQArticleLink.buildArticleLinkFields(articleLinks)
      : {
        post_kind: articleLinks.length ? 'article_link' : 'talk',
        article_links: articleLinks,
        article_url: articleLinks[0]?.url || '',
        article_title: articleLinks[0]?.title || '',
        include_in_summary: !articleLinks.length
      };
    const topic_id = apiMeta?.topic_id || this.resolveTopicId(contentElement, text, apiMeta);
    const group_id = apiMeta?.group_id || this.getGroupId();
    const topic_url = apiMeta?.topic_url || this.buildTopicUrl(topic_id, group_id);
    const base = {
      source: 'zsxq',
      group: this.getGroupName(),
      group_id,
      topic_id,
      topic_url,
      author,
      published_at,
      text,
      tags,
      images,
      ...articleFields
    };
    return {
      ...base,
      ai_payload: this.buildAiPayload(base)
    };
  },

  extractPostByIndex(index = 0) {
    const containers = document.querySelectorAll('.talk-content-container');
    const post = containers[index];
    if (!post) return null;
    const content = post.querySelector('.content');
    if (!content) return null;
    return this.extractPostRecord(content);
  },

  extractPostAt(x, y) {
    const viewportX = x - window.scrollX;
    const viewportY = y - window.scrollY;
    const element = document.elementFromPoint(viewportX, viewportY);
    if (!element) return null;

    let current = element;
    while (current && current !== document.body) {
      if (current.tagName?.toLowerCase() === 'div' && current.classList.contains('content')) {
        return this.extractPostRecord(current);
      }
      current = current.parentElement;
    }
    return null;
  },

  findRecordByText(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    for (const content of document.querySelectorAll('.talk-content-container .content')) {
      if (content.textContent.replace(/\s+/g, ' ').trim() === normalized) {
        return this.extractPostRecord(content);
      }
    }
    return null;
  },

  extractAllVisible() {
    const results = [];
    const seen = new Set();
    document.querySelectorAll('.talk-content-container .content').forEach((content) => {
      const rect = content.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight - 100 && rect.bottom > 0;
      if (!isVisible) return;

      const record = this.extractPostRecord(content);
      const key = `${record.text}|${record.images.map((i) => i.image_key || this.imageKey(i.url)).join(',')}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(record);
    });
    return results;
  },

  hashRecord(record) {
    const payload = `${record.text}|${(record.images || []).map((i) => i.image_key || this.imageKey(i.url)).join(',')}`;
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      hash = ((hash << 5) - hash) + payload.charCodeAt(i);
      hash &= hash;
    }
    return hash.toString();
  },

  imgElementToDataUrl(img) {
    try {
      if (!img?.complete || !img.naturalWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      return null;
    }
  },

  findImageElement(scope, imageKey) {
    if (!imageKey) return null;
    const post = scope?.querySelector?.('.talk-content-container') || null;
    const roots = [...new Set([post, scope].filter(Boolean))];

    for (const root of roots) {
      for (const img of root.querySelectorAll('img')) {
        const src = img.currentSrc || img.src || '';
        if (src.includes(imageKey)) return img;
      }
    }
    return null;
  },

  async fetchImageAsDataUrl(url) {
    if (!url) return null;

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'fetchImageAsDataUrl',
          url
        });
        if (response?.dataUrl) return response.dataUrl;
      } catch (error) {
        console.warn('background fetch image failed:', error);
      }
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        referrer: ZSXQ_REFERER,
        headers: { Referer: ZSXQ_REFERER }
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  },

  async resolveImage(image, scope) {
    const urlsToTry = [];
    if (image.original_url) urlsToTry.push(image.original_url);
    if (image.large_url) urlsToTry.push(image.large_url);
    if (image.url) urlsToTry.push(image.url);

    if (scope && image.image_key) {
      const post = scope.querySelector('.talk-content-container') || scope;
      const urlMap = this.collectUrlMap(post, scope);
      const direct = urlMap.get(image.image_key);
      if (direct && !urlsToTry.includes(direct)) {
        urlsToTry.unshift(direct);
      }
    }

    for (const url of urlsToTry) {
      const dataUrl = await this.fetchImageAsDataUrl(url);
      if (dataUrl) {
        return {
          ...image,
          url: this.isDirectCdnUrl(url) ? url : image.url,
          data_url: dataUrl,
          url_accessible: true
        };
      }
    }

    if (scope && image.image_key) {
      const imgEl = this.findImageElement(scope, image.image_key);
      const dataUrl = this.imgElementToDataUrl(imgEl);
      if (dataUrl) {
        return { ...image, data_url: dataUrl, url_accessible: true };
      }
    }

    return { ...image, url_accessible: false };
  },

  async resolveImages(images, scope) {
    const resolved = [];
    for (const image of images || []) {
      resolved.push(await this.resolveImage(image, scope));
    }
    return resolved;
  },

  async enrichRecord(record, scope = null) {
    const images = await this.resolveImages(record.images, scope);
    const enriched = { ...record, images };
    enriched.ai_payload = this.buildAiPayload(enriched);
    return enriched;
  }
};

if (typeof window !== 'undefined') {
  window.ZSXQContentExtractor = ZSXQContentExtractor;
}
