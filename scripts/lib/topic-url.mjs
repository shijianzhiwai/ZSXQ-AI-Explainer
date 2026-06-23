const ZSXQ_TOPIC_URL_BASE = 'https://wx.zsxq.com';

/** Default group from extension target (background.js documentUrlPatterns). */
export const DEFAULT_ZSXQ_GROUP_ID = '28518511148841';

export function resolveGroupId(manifest = {}, post = {}) {
  return String(
    post.group_id || manifest.group_id || process.env.ZSXQ_GROUP_ID || DEFAULT_ZSXQ_GROUP_ID || ''
  );
}

export function buildTopicUrl(topicId, groupId) {
  if (!topicId || !groupId) return '';
  return `${ZSXQ_TOPIC_URL_BASE}/group/${groupId}/topic/${topicId}`;
}

export function resolvePostTopicUrl(post, manifest = {}) {
  if (post?.topic_url) return post.topic_url;
  if (post?.source_url) return post.source_url;
  const topicId = post?.topic_id || post?.id;
  const groupId = resolveGroupId(manifest, post);
  return buildTopicUrl(topicId, groupId);
}

export function attachTopicUrls(manifest) {
  const groupId = resolveGroupId(manifest);
  const posts = (manifest?.posts || []).map((post) => {
    const topic_id = String(post.topic_id || post.id || '');
    const topic_url = resolvePostTopicUrl({ ...post, topic_id }, { group_id: post.group_id || groupId });
    return { ...post, topic_id, topic_url, group_id: post.group_id || groupId };
  });
  return { ...manifest, group_id: manifest.group_id || groupId, posts };
}
