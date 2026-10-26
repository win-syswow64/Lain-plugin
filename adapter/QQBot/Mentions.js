export function atTarget (item) {
  return item?.qq || item?.id || item?.user_id || item?.data?.qq || item?.data?.id || item?.data?.user_id || item?.member_openid || item?.user_openid
}

export const isAtAll = item => item?.type === 'at' && [item.qq, item.id, item.user_id, item.data?.qq, item.data?.id, item.data?.user_id]
  .some(id => ['all', 'everyone'].includes(String(id)))

const allMentionPattern = () => /<qqbot-at-everyone\s*\/>|<@!?(?:all|everyone)>/gi
export const ALL_MENTION_TAG = '<qqbot-at-everyone />'

/** 只检查正文和模板参数，按钮标签、回调数据不会消耗 @全体成员额度。 */
export function hasAllMention (message) {
  return message.some(item => {
    if (typeof item === 'string') return allMentionPattern().test(item)
    if (isAtAll(item)) return true
    if (item?.type === 'text') return allMentionPattern().test(String(item.text || ''))
    if (item?.type !== 'markdown') return false
    const markdown = item.data ?? item
    return allMentionPattern().test(typeof markdown === 'string' ? markdown :
      String(markdown?.content || '') + (markdown?.params || []).flatMap(param => param.values || []).join(''))
  })
}

/** 2026-10-26：群文本与 Markdown 均使用同一个官方标签，C2C 删除全体提醒。 */
export function normalizeAllMentions (message, isGroup) {
  const text = value => String(value).replace(allMentionPattern(), isGroup ? ALL_MENTION_TAG : '')
  const markdown = value => {
    if (typeof value === 'string') return text(value)
    if (!value || typeof value !== 'object') return value
    return {
      ...value,
      ...(typeof value.content === 'string' ? { content: text(value.content) } : {}),
      ...(Array.isArray(value.params) ? { params: value.params.map(param => ({
        ...param,
        values: (param.values || []).map(value => typeof value === 'string' ? text(value) : value)
      })) } : {})
    }
  }
  return message.flatMap(item => {
    if (typeof item === 'string') return [{ type: 'text', text: text(item) }]
    if (isAtAll(item)) return isGroup ? [{ type: 'text', text: ALL_MENTION_TAG }] : []
    if (item?.type === 'text' && typeof item.text === 'string') return [{ ...item, text: text(item.text) }]
    if (item?.type === 'markdown') return [{ ...markdown(item), ...(item.data != null ? { data: markdown(item.data) } : {}) }]
    return [item]
  })
}

/** 官方 <@all> / <@member_openid> 与 ICQQ 的 at 消息段。 */
export function normalizeMentions (message, mentions = []) {
  if (!Array.isArray(mentions)) mentions = []
  const result = []
  for (const item of message) {
    if (item?.type === 'at') {
      const id = isAtAll(item) ? 'all' : atTarget(item)
      result.push({ ...item, qq: id, id, user_id: id, text: item.text || (id === 'all' ? '@全体成员' : '') })
      continue
    }
    if (item?.type !== 'text') { result.push(item); continue }
    const text = String(item.text || '')
    let offset = 0
    for (const match of text.matchAll(/<@!?([^>]+)>/g)) {
      if (match.index > offset) result.push({ type: 'text', text: text.slice(offset, match.index) })
      const id = ['all', 'everyone'].includes(match[1]) ? 'all' : match[1]
      const member = mentions.find(user => [user.id, user.member_openid, user.user_openid].includes(id))
      result.push({ type: 'at', qq: id, id, user_id: id, text: id === 'all' ? '@全体成员' : member?.username ? `@${member.username}` : '' })
      offset = match.index + match[0].length
    }
    if (!offset) result.push(item)
    else if (offset < text.length) result.push({ type: 'text', text: text.slice(offset) })
  }
  return result
}
