/**
 * Detect ZSXQ posts that are excerpt + full article / external link cards.
 */
const ZSXQArticleLink = {
  decodeAttr(value) {
    if (!value) return '';
    try {
      return decodeURIComponent(String(value));
    } catch {
      return String(value);
    }
  },

  parseWebTagsFromApiText(text) {
    const links = [];
    if (!text) return links;
    const re = /<e\s+[^>]*type=["']web["'][^>]*\/?>/gi;
    let match;
    while ((match = re.exec(text))) {
      const tag = match[0];
      const href = tag.match(/href=["']([^"']*)["']/i)?.[1];
      const title = tag.match(/title=["']([^"']*)["']/i)?.[1];
      if (!href) continue;
      links.push({
        title: this.decodeAttr(title || href).replace(/\s+/g, ' ').trim(),
        url: this.decodeAttr(href).trim()
      });
    }
    return links;
  },

  extractArticleLinksFromDom(scope) {
    if (!scope) return [];
    const seen = new Set();
    const links = [];
    scope.querySelectorAll('a.link-of-topic').forEach((anchor) => {
      const url = anchor.href?.trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      links.push({
        title: (anchor.textContent || '').replace(/\s+/g, ' ').trim() || url,
        url
      });
    });
    return links;
  },

  articleLinksFromApiTopic(topic) {
    const links = [];
    const article = topic?.talk?.article || topic?.article;
    if (article?.article_url) {
      links.push({
        title: (article.title || article.article_title || article.article_url || '').replace(/\s+/g, ' ').trim(),
        url: String(article.article_url).trim()
      });
    }
    const rawText = topic?.talk?.text || topic?.text || '';
    links.push(...this.parseWebTagsFromApiText(rawText));
    return links;
  },

  mergeArticleLinks(...lists) {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
      for (const link of list || []) {
        const url = link?.url?.trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        merged.push({
          title: (link.title || url).replace(/\s+/g, ' ').trim(),
          url
        });
      }
    }
    return merged;
  },

  pickPrimaryArticleLink(links) {
    if (!links?.length) return null;
    const zsxqArticle = links.find((link) => /articles\.zsxq\.com/i.test(link.url));
    return zsxqArticle || links[0];
  },

  buildArticleLinkFields(links) {
    const articleLinks = this.mergeArticleLinks(links);
    if (!articleLinks.length) {
      return {
        post_kind: 'talk',
        article_links: [],
        article_url: '',
        article_title: '',
        include_in_summary: true
      };
    }
    const primary = this.pickPrimaryArticleLink(articleLinks);
    return {
      post_kind: 'article_link',
      article_links: articleLinks,
      article_url: primary?.url || '',
      article_title: primary?.title || '',
      include_in_summary: false
    };
  }
};

if (typeof window !== 'undefined') {
  window.ZSXQArticleLink = ZSXQArticleLink;
}
