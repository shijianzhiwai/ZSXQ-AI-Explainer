/**
 * Fetch and extract full text of ZSXQ long articles (articles.zsxq.com)
 * so the daily summary agent can generate a reading-list digest.
 */
const ZSXQArticleContent = {
  MAX_CONTENT_CHARS: 30000,

  isZsxqArticleUrl(url) {
    return /articles\.zsxq\.com/i.test(url || '');
  },

  /**
   * Parse the server-rendered article HTML and return plain text.
   * Article body lives in `.content.ql-editor` (falls back to `.content`).
   */
  extractArticleText(html) {
    if (!html) return '';
    let doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      return '';
    }
    const node = doc.querySelector('.content.ql-editor') || doc.querySelector('.content');
    if (!node) return '';

    // Detached documents have no layout, so build paragraphs manually
    // instead of relying on innerText.
    const blocks = node.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre');
    let text = [...blocks]
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (!text) {
      text = node.textContent.replace(/\s+/g, ' ').trim();
    }
    if (text.length > this.MAX_CONTENT_CHARS) {
      text = `${text.slice(0, this.MAX_CONTENT_CHARS)}\n…（正文过长，已截断）`;
    }
    return text;
  },

  pickArticleUrl(post) {
    if (this.isZsxqArticleUrl(post?.article_url)) return post.article_url;
    const link = (post?.article_links || []).find((item) => this.isZsxqArticleUrl(item?.url));
    return link?.url || '';
  },

  /**
   * Fetch article HTML via background (carries login cookies) and extract text.
   * Returns '' on any failure — export must never block on this.
   */
  async fetchArticleContent(url) {
    if (!this.isZsxqArticleUrl(url)) return '';
    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetchArticleHtml', url });
      if (!response?.ok || !response.html) {
        console.warn('[article-content] fetch failed:', url, response?.error || 'empty response');
        return '';
      }
      return this.extractArticleText(response.html);
    } catch (error) {
      console.warn('[article-content] fetch error:', url, error.message);
      return '';
    }
  },

  /** Attach `article_content` to article_link posts in place. */
  async attachArticleContents(posts) {
    for (const post of posts || []) {
      if (post?.post_kind !== 'article_link') continue;
      if (post.article_content) continue;
      const url = this.pickArticleUrl(post);
      post.article_content = url ? await this.fetchArticleContent(url) : '';
    }
    return posts;
  }
};

if (typeof window !== 'undefined') {
  window.ZSXQArticleContent = ZSXQArticleContent;
}
