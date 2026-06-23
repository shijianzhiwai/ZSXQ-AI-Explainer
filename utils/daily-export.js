/**
 * Incremental export helpers — checkpoint or lookback window.
 */
const ZSXQDailyExport = {
  DEFAULT_LOOKBACK_HOURS: 48,
  DEFAULT_MAX_POSTS: 50,

  todayDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  parsePublishedDate(publishedAt) {
    return this.parsePublishedDateLoose(publishedAt);
  },

  parsePublishedDateLoose(publishedAt, now = new Date()) {
    if (!publishedAt) return null;
    const s = String(publishedAt).trim();

    if (/刚刚|^\d+\s*分钟前|^\d+\s*小时前|^今天/.test(s)) return new Date(now);

    if (/昨天/.test(s)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(12, 0, 0, 0);
      return d;
    }

    if (/前天/.test(s)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 2);
      d.setHours(12, 0, 0, 0);
      return d;
    }

    const iso = new Date(s);
    if (!Number.isNaN(iso.getTime()) && /\d{4}/.test(s)) return iso;

    const ymd = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) return new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00`);

    const md = s.match(/(?:^|\D)(\d{1,2})-(\d{1,2})(?:\D|$)/);
    if (md) {
      return new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2]), 12, 0, 0);
    }

    const cn = s.match(/(\d{1,2})月(\d{1,2})日/);
    if (cn) {
      return new Date(now.getFullYear(), Number(cn[1]) - 1, Number(cn[2]), 12, 0, 0);
    }

    return null;
  },

  async loadExportSettings() {
    const data = await chrome.storage.local.get([
      'lastExportCheckpoint',
      'exportLookbackHours',
      'exportMaxPosts'
    ]);
    return {
      lastExportCheckpoint: data.lastExportCheckpoint || null,
      exportLookbackHours: Number(data.exportLookbackHours) || this.DEFAULT_LOOKBACK_HOURS,
      exportMaxPosts: Number(data.exportMaxPosts) || this.DEFAULT_MAX_POSTS
    };
  },

  resolveExportWindow(settings) {
    if (settings.lastExportCheckpoint) {
      const start = new Date(settings.lastExportCheckpoint);
      if (!Number.isNaN(start.getTime())) {
        return {
          start,
          mode: 'incremental',
          checkpoint: settings.lastExportCheckpoint,
          lookbackHours: null
        };
      }
    }

    const hours = settings.exportLookbackHours || this.DEFAULT_LOOKBACK_HOURS;
    const start = new Date(Date.now() - hours * 60 * 60 * 1000);
    return {
      start,
      mode: 'lookback',
      checkpoint: null,
      lookbackHours: hours
    };
  },

  async getExportWindow() {
    const settings = await this.loadExportSettings();
    return this.resolveExportWindow(settings);
  },

  async getExportConfig() {
    const settings = await this.loadExportSettings();
    return {
      exportWindow: this.resolveExportWindow(settings),
      maxPosts: settings.exportMaxPosts
    };
  },

  isAfterWindowStart(publishedAt, windowStart) {
    const parsed = this.parsePublishedDateLoose(publishedAt);
    if (!parsed || !windowStart) return false;
    return parsed.getTime() > windowStart.getTime();
  },

  isPublishedOnDate(publishedAt, dateStr) {
    const parsed = this.parsePublishedDateLoose(publishedAt);
    if (!parsed) return false;
    return this.todayDateString(parsed) === dateStr;
  },

  filterByDate(contents, dateStr = this.todayDateString()) {
    return (contents || []).filter((item) => this.isPublishedOnDate(item.published_at, dateStr));
  },

  filterByWindow(contents, windowStart, maxPosts = this.DEFAULT_MAX_POSTS) {
    const filtered = (contents || []).filter((item) => this.isAfterWindowStart(item.published_at, windowStart));
    return this.limitPostsNewestFirst(filtered, maxPosts);
  },

  sortByPublishedDesc(posts) {
    return [...(posts || [])].sort((a, b) => {
      const ta = this.parsePublishedDateLoose(a.published_at)?.getTime() || 0;
      const tb = this.parsePublishedDateLoose(b.published_at)?.getTime() || 0;
      return tb - ta;
    });
  },

  limitPostsNewestFirst(posts, maxPosts = this.DEFAULT_MAX_POSTS) {
    const limit = Number(maxPosts) || this.DEFAULT_MAX_POSTS;
    if (!limit || limit <= 0) return this.sortByPublishedDesc(posts);
    return this.sortByPublishedDesc(posts).slice(0, limit);
  },

  maxPublishedAt(posts) {
    return (posts || []).reduce((max, post) => {
      const parsed = this.parsePublishedDateLoose(post.published_at);
      if (!parsed) return max;
      return !max || parsed > max ? parsed : max;
    }, null);
  },

  async saveExportCheckpoint(posts) {
    const maxTime = this.maxPublishedAt(posts);
    if (!maxTime) return null;
    const checkpoint = maxTime.toISOString();
    await chrome.storage.local.set({ lastExportCheckpoint: checkpoint });
    return checkpoint;
  },

  formatWindowLabel(exportWindow) {
    if (exportWindow.mode === 'incremental') {
      return `上次截止点之后（${exportWindow.checkpoint}）`;
    }
    return `近 ${exportWindow.lookbackHours} 小时`;
  },

  sanitizeFileId(id) {
    return String(id || 'post').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  },

  imageFileName(postId, index) {
    return `images/${this.sanitizeFileId(postId)}-${index}.jpg`;
  },

  buildManifest(enrichedPosts, { date, group, exportTime, exportWindow, checkpointAfter, maxPosts }) {
    const posts = [];
    let imageCount = 0;

    for (const post of enrichedPosts) {
      const images = (post.images || []).map((img, idx) => {
        const index = img.index || idx + 1;
        const file = this.imageFileName(post.id, index);
        imageCount += 1;
        return {
          id: `${this.sanitizeFileId(post.id)}-${index}`,
          file,
          width: img.width || null,
          height: img.height || null,
        image_kind: img.image_kind || 'pending',
        ocr_text: img.ocr_text || '',
        ocr_confidence: img.ocr_confidence ?? null,
        chart_summary: img.chart_summary || '',
        needs_vision: img.needs_vision ?? null,
        vision_task: img.vision_task || null,
        include_in_summary: img.include_in_summary !== false,
          source: img.source || 'unknown'
        };
      });

      posts.push({
        id: post.id,
        topic_id: post.topic_id || post.id || '',
        topic_url: post.topic_url || '',
        group_id: post.group_id || '',
        author: post.author || '',
        published_at: post.published_at || '',
        tags: post.tags || [],
        text: post.text || '',
        images
      });
    }

    return {
      version: 1,
      kind: 'zsxq-daily-manifest',
      date,
      group: group || '',
      group_id: enrichedPosts[0]?.group_id || '',
      exported_at: exportTime || new Date().toISOString(),
      export_window: {
        mode: exportWindow?.mode || 'lookback',
        start: exportWindow?.start?.toISOString?.() || null,
        checkpoint_before: exportWindow?.checkpoint || null,
        lookback_hours: exportWindow?.lookbackHours ?? null
      },
      checkpoint_after: checkpointAfter || null,
      max_posts: maxPosts ?? this.DEFAULT_MAX_POSTS,
      post_count: posts.length,
      image_count: imageCount,
      posts,
      llm_hints: {
        input_tokens: 'Use posts[].text; images: ocr_text (text) or chart_summary (chart). Skip include_in_summary=false.',
        vision: 'Run enrich-manifest-images.mjs (OCR), then node scripts/build-daily-pipeline.mjs',
        output: 'Write summary sections as markdown; image refs as ![caption](relative-path).'
      }
    };
  },

  collectImagePayloads(enrichedPosts) {
    const payloads = [];
    for (const post of enrichedPosts) {
      (post.images || []).forEach((img, idx) => {
        const index = img.index || idx + 1;
        if (!img.data_url) return;
        payloads.push({
          id: `${this.sanitizeFileId(post.id)}-${index}`,
          file: this.imageFileName(post.id, index),
          data_url: img.data_url
        });
      });
    }
    return payloads;
  },

  async enrichPostsInWindow(rawContents, windowStart, maxPosts = this.DEFAULT_MAX_POSTS) {
    const filtered = this.filterByWindow(rawContents, windowStart, maxPosts);
    const enriched = [];

    for (const item of filtered) {
      const normalizedText = (item.text || '').replace(/\s+/g, ' ').trim();
      const liveContent = [...document.querySelectorAll('.talk-content-container .content')].find(
        (el) => el.textContent.replace(/\s+/g, ' ').trim() === normalizedText
      );
      const live = liveContent ? ZSXQContentExtractor.extractPostRecord(liveContent) : null;
      const liveScope = liveContent ? ZSXQContentExtractor.getPostScope(liveContent) : null;
      const images = live?.images?.length ? live.images : item.images;
      const resolvedImages = await ZSXQContentExtractor.resolveImages(images, liveScope);
      enriched.push({
        ...item,
        author: live?.author || item.author,
        published_at: live?.published_at || item.published_at,
        tags: live?.tags || item.tags,
        topic_id: live?.topic_id || item.topic_id || '',
        topic_url: live?.topic_url || item.topic_url || '',
        group_id: live?.group_id || item.group_id || '',
        images: resolvedImages
      });
    }

    return enriched;
  },

  /** @deprecated */
  async enrichPostsForDate(rawContents, dateStr) {
    const start = new Date(`${dateStr}T00:00:00`);
    return this.enrichPostsInWindow(rawContents, new Date(start.getTime() - 1));
  }
};

if (typeof window !== 'undefined') {
  window.ZSXQDailyExport = ZSXQDailyExport;
}
