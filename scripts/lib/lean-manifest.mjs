/**
 * Strip manifest to token-efficient text payload for summary agent.
 */
import { resolvePostTopicUrl } from './topic-url.mjs';

export function buildLeanManifest(manifest) {
  const posts = (manifest.posts || []).map((post) => ({
    id: post.id,
    topic_id: post.topic_id || post.id || '',
    topic_url: resolvePostTopicUrl(post, manifest),
    author: post.author || '',
    published_at: post.published_at || '',
    tags: post.tags || [],
    text: post.text || '',
    images: (post.images || [])
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
      })
  }));

  return {
    date: manifest.date,
    group: manifest.group || '',
    post_count: posts.length,
    posts,
    hints: {
      style: 'Write facts + analysis + takeaway per post/section; preserve numbers and names; do not over-compress',
      topic_url: 'Include topic_url as source link in posts[] when citing original',
      text_images: 'Merge image_content into facts naturally; never say OCR in output; do not put in posts[].images',
      chart_images: 'Merge chart_summary into facts/analysis naturally; put chart file in posts[].images with caption',
      skip: 'photo and include_in_summary=false'
    }
  };
}
