/**
 * Strip manifest to token-efficient text payload for summary agent.
 */
import { resolvePostTopicUrl } from './topic-url.mjs';
import { isArticleLinkPost } from './article-link.mjs';

function mapLeanImages(post) {
  return (post.images || [])
    .filter((img) => img.include_in_summary !== false && img.image_kind !== 'photo')
    .map((img) => {
      const lean = {
        id: img.id,
        image_kind: img.image_kind || 'pending',
        file: img.file || ''
      };
      if (img.image_kind === 'chart' && img.chart_summary) {
        lean.chart_summary = img.chart_summary;
      } else if (img.image_kind === 'text' && img.ocr_text) {
        lean.image_content = img.ocr_text;
      } else if (img.ocr_text) {
        lean.image_content = img.ocr_text;
      }
      if (img.chart_summary && img.image_kind === 'chart') {
        lean.chart_summary = img.chart_summary;
      }
      return lean;
    });
}

function mapLeanPost(post, manifest) {
  return {
    id: post.id,
    topic_id: post.topic_id || post.id || '',
    topic_url: resolvePostTopicUrl(post, manifest),
    author: post.author || '',
    published_at: post.published_at || '',
    tags: post.tags || [],
    text: post.text || '',
    images: mapLeanImages(post)
  };
}

const MAX_ARTICLE_CONTENT_CHARS = 15000;

function truncateArticleContent(content) {
  const text = String(content || '').trim();
  if (!text) return '';
  if (text.length <= MAX_ARTICLE_CONTENT_CHARS) return text;
  return `${text.slice(0, MAX_ARTICLE_CONTENT_CHARS)}\n…（正文过长，已截断）`;
}

function mapReadingListItem(post, manifest) {
  return {
    id: post.id,
    topic_url: resolvePostTopicUrl(post, manifest),
    author: post.author || '',
    published_at: post.published_at || '',
    article_title: post.article_title || '',
    article_url: post.article_url || '',
    article_links: post.article_links || [],
    text: post.text || '',
    article_content: truncateArticleContent(post.article_content)
  };
}

export function buildLeanManifest(manifest) {
  const readingList = [];
  const posts = [];

  for (const post of manifest.posts || []) {
    if (isArticleLinkPost(post)) {
      readingList.push(mapReadingListItem(post, manifest));
      continue;
    }
    posts.push(mapLeanPost(post, manifest));
  }

  return {
    date: manifest.date,
    group: manifest.group || '',
    post_count: posts.length,
    reading_list_count: readingList.length,
    posts,
    reading_list: readingList,
    hints: {
      style: 'Write facts + analysis + takeaway per post/section; preserve numbers and names; do not over-compress',
      topic_url: 'Include topic_url as source link in posts[] when citing original',
      text_images: 'Merge image_content into facts naturally; never say OCR in output; do not put in posts[].images',
      chart_images: 'Merge chart_summary into facts/analysis naturally; put chart file in posts[].images with caption',
      article_links: 'reading_list[]: write a short digest into summary.json reading_list[] — use article_content (full text) when present, else 1-2 sentences from preview text; never merge into sections/posts',
      skip: 'photo and include_in_summary=false images; reading_list items never go into sections/posts'
    }
  };
}
