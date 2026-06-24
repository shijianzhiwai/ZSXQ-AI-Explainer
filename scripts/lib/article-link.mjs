/**
 * Article-link post helpers (Node — mirror utils/article-link.js).
 */

export function decodeAttr(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

export function parseWebTagsFromApiText(text) {
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
      title: decodeAttr(title || href).replace(/\s+/g, ' ').trim(),
      url: decodeAttr(href).trim()
    });
  }
  return links;
}

export function mergeArticleLinks(...lists) {
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
}

export function pickPrimaryArticleLink(links) {
  if (!links?.length) return null;
  const zsxqArticle = links.find((link) => /articles\.zsxq\.com/i.test(link.url));
  return zsxqArticle || links[0];
}

export function isArticleLinkPost(post) {
  return post?.post_kind === 'article_link'
    || post?.include_in_summary === false
    || (Array.isArray(post?.article_links) && post.article_links.length > 0);
}

export function collectReadingListFromManifest(manifest) {
  return (manifest.posts || [])
    .filter(isArticleLinkPost)
    .map((post) => ({
      id: post.id,
      topic_url: post.topic_url || '',
      author: post.author || '',
      published_at: post.published_at || '',
      article_title: post.article_title || pickPrimaryArticleLink(post.article_links || [])?.title || '',
      article_url: post.article_url || pickPrimaryArticleLink(post.article_links || [])?.url || '',
      article_links: post.article_links || []
    }));
}
