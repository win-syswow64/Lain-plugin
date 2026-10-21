export function atTarget (item) {
  return item?.qq || item?.id || item?.user_id || item?.data?.qq || item?.data?.id || item?.data?.user_id || item?.member_openid || item?.user_openid
}

export const isAtAll = item => item?.type === 'at' && [item.qq, item.id, item.user_id, item.data?.qq, item.data?.id, item.data?.user_id]
  .some(id => ['all', 'everyone'].includes(String(id)))

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
