/**
 * 接收页面主世界拦截到的 topics API 数据，缓存 talk.images 与 topic_url。
 */
const ZSXQTopicImageCache = {
  byTopicId: new Map(),
  byTopicMeta: new Map(),
  byText: new Map(),
  byImageKey: new Map(),
  byTextMeta: new Map(),

  buildWxTopicUrl(topicId, groupId) {
    if (!topicId || !groupId) return '';
    return `https://wx.zsxq.com/group/${groupId}/topic/${topicId}`;
  },

  indexTopicMetaKeys(meta) {
    const keys = new Set();
    if (meta.topic_id) keys.add(String(meta.topic_id));
    keys.forEach((key) => {
      const prev = this.byTopicMeta.get(key) || {};
      this.byTopicMeta.set(key, { ...prev, ...meta });
    });
  },

  /** API 正文含 <e type="hashtag" title="..."/>，需转成与 DOM textContent 一致的纯文本 */
  normalizeTopicText(text) {
    if (!text) return '';

    const expanded = text.replace(
      /<e\s+[^>]*title="([^"]*)"[^>]*\/?>/gi,
      (_, title) => {
        try {
          return decodeURIComponent(title).replace(/^#|#$/g, '');
        } catch {
          return title.replace(/^#|#$/g, '');
        }
      }
    );

    return expanded
      .replace(/<[^>]+>/g, '')
      .replace(/#/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  normalizeText(text) {
    return this.normalizeTopicText(text);
  },

  textKey(text) {
    return this.normalizeText(text).slice(0, 120);
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

  isOriginalUrl(url) {
    if (!url) return false;
    return url.includes('quality/100') || (!url.includes('thumbnail') && !url.includes('blur/'));
  },

  imageKey(url) {
    const match = String(url).match(/images\.zsxq\.com\/([^?]+)/);
    return match ? match[1] : url;
  },

  mapApiImages(images) {
    return (images || []).map((img, index) => {
      const url = this.pickImageUrl(img);
      return {
        index: index + 1,
        image_id: img.image_id || null,
        image_key: this.imageKey(url) || (img.image_id ? String(img.image_id) : `img-${index}`),
        url,
        width: img.original?.width || img.large?.width || img.thumbnail?.width || img.width,
        height: img.original?.height || img.large?.height || img.thumbnail?.height || img.height,
        size: img.original?.size || null,
        thumbnail_url: img.thumbnail?.url || null,
        original_url: img.original?.url || null,
        large_url: img.large?.url || null,
        ocr_text: '',
        url_accessible: this.isOriginalUrl(url),
        source: 'api'
      };
    });
  },

  indexImageEntry(mappedItem, rawImg) {
    const keys = new Set();
    if (mappedItem.image_key) keys.add(mappedItem.image_key);
    if (mappedItem.thumbnail_url) keys.add(this.imageKey(mappedItem.thumbnail_url));
    if (mappedItem.original_url) keys.add(this.imageKey(mappedItem.original_url));
    if (mappedItem.large_url) keys.add(this.imageKey(mappedItem.large_url));
    if (rawImg?.image_id != null) keys.add(String(rawImg.image_id));

    keys.forEach((key) => {
      if (key) this.byImageKey.set(key, mappedItem);
    });
  },

  storeTopic(topic) {
    const images = topic?.talk?.images || topic?.images;
    const mapped = Array.isArray(images) && images.length ? this.mapApiImages(images) : [];
    mapped.forEach((item, index) => this.indexImageEntry(item, images[index]));

    const topicId = topic.topic_uid != null
      ? String(topic.topic_uid)
      : (topic.topic_id != null ? String(topic.topic_id) : '');
    const plainText = this.normalizeTopicText(topic.talk?.text || topic.text || topic.show_title);
    const groupId = topic.group?.group_id || topic.group_id || '';
    const groupIdStr = groupId != null ? String(groupId) : '';
    const meta = {
      topic_id: topicId,
      group_id: groupIdStr,
      topic_url: topicId && groupIdStr ? this.buildWxTopicUrl(topicId, groupIdStr) : '',
      author: topic.talk?.owner?.name || topic.owner?.name || '',
      published_at: topic.create_time || topic.talk?.create_time || '',
      text: plainText,
      group: topic.group?.name || ''
    };

    if (topicId) {
      if (mapped.length) this.byTopicId.set(topicId, mapped);
      this.indexTopicMetaKeys(meta);
    }

    if (plainText) {
      if (mapped.length) {
        this.byText.set(plainText, mapped);
        this.byText.set(this.textKey(plainText), mapped);
      }
      this.byTextMeta.set(plainText, meta);
      this.byTextMeta.set(this.textKey(plainText), meta);
    }
  },

  ingestPayload(payload) {
    if (!payload || typeof payload !== 'object') return;

    const topics = payload?.resp_data?.topics
      || (payload?.resp_data?.topic ? [payload.resp_data.topic] : null)
      || payload?.topics;

    if (Array.isArray(topics)) {
      topics.forEach((topic) => this.storeTopic(topic));
      return;
    }

    if (payload?.talk?.images) {
      this.storeTopic(payload);
    }
  },

  lookupByText(text) {
    const normalized = this.normalizeTopicText(text);
    if (this.byText.has(normalized)) return this.byText.get(normalized);

    const shortKey = this.textKey(normalized);
    if (this.byText.has(shortKey)) return this.byText.get(shortKey);

    for (const [key, images] of this.byText.entries()) {
      if (normalized.startsWith(key) || key.startsWith(normalized)) return images;
      if (this.textKey(key) === shortKey) return images;
    }
    return null;
  },

  upgradeDomImages(domImages) {
    if (!domImages?.length) return domImages;

    let upgradedCount = 0;
    const result = domImages.map((dom, index) => {
      const key = dom.image_key || this.imageKey(dom.url);
      const cached = this.byImageKey.get(key);
      if (cached?.source === 'api') {
        upgradedCount += 1;
        return { ...cached, index: index + 1 };
      }
      return dom;
    });

    return upgradedCount ? result : domImages;
  },

  lookupMeta(contentElement, text) {
    const normalized = this.normalizeTopicText(text);
    if (this.byTextMeta.has(normalized)) return this.byTextMeta.get(normalized);

    const shortKey = this.textKey(normalized);
    if (this.byTextMeta.has(shortKey)) return this.byTextMeta.get(shortKey);

    for (const [key, meta] of this.byTextMeta.entries()) {
      if (normalized.startsWith(key) || key.startsWith(normalized)) return meta;
      if (this.textKey(key) === shortKey) return meta;
    }

    const topicRoot = contentElement?.closest?.('app-topic');
    if (topicRoot) {
      const html = topicRoot.innerHTML || '';
      const idMatch = html.match(/topic_(?:id|uid)["']?\s*[:=]\s*["']?(-?\d+)/i);
      if (idMatch) {
        const fromTopic = this.byTopicMeta.get(idMatch[1]);
        if (fromTopic) return fromTopic;
        return { topic_id: idMatch[1] };
      }
    }

    return null;
  },

  lookup(contentElement, text) {
    const fromText = this.lookupByText(text);
    if (fromText?.length) return fromText;

    const topicRoot = contentElement?.closest?.('app-topic');
    if (!topicRoot) return null;

    const html = topicRoot.innerHTML || '';
    const idMatch = html.match(/topic_(?:id|uid)["']?\s*[:=]\s*["']?(-?\d+)/i);
    if (idMatch) {
      return this.byTopicId.get(idMatch[1]) || null;
    }

    return null;
  },

  install() {
    if (this._installed) return;
    this._installed = true;

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.source !== 'zsxq-ai-explainer') return;
      if (event.data?.type !== 'TOPIC_CACHE_INGEST') return;
      this.ingestPayload(event.data.payload);
    });

    console.log('[ZSXQ Explainer] topic image cache ready');
  }
};

ZSXQTopicImageCache.install();

if (typeof window !== 'undefined') {
  window.ZSXQTopicImageCache = ZSXQTopicImageCache;
}
