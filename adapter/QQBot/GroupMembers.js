import QQBotIdMap from '../../model/qqbot-id-map.js'

/** 官方群成员管理与 ICQQ 返回结构之间的转换。 */
export default class GroupMembers {
  constructor (adapter) {
    this.adapter = adapter
    this.cache = new Map()
    this.pending = new Map()
  }

  async group (groupId) {
    return await this.adapter.resolveOpenid(groupId, 'group')
  }

  async memberId (groupOpenid, userId) {
    if (['all', 'everyone'].includes(this.adapter.stripQQBotId(userId))) throw new Error('QQBot 群成员操作不能以全体成员为目标')
    const numeric = QQBotIdMap.normalizeQQ(this.adapter.stripQQBotId(userId))
    if (numeric) {
      const bound = QQBotIdMap.findUserByQQ(this.adapter.id, numeric, { groupOpenid })
      const groupKey = QQBotIdMap.normalizeOpenid(groupOpenid, this.adapter.id)
      if (!bound?.groups?.[groupKey]) throw new Error('QQBot 群成员 QQ 号尚未绑定当前群 OpenID')
      return this.adapter.stripQQBotId(bound.user_openid)
    }
    return await this.adapter.resolveOpenid(userId, 'user', { message_type: 'group', group_openid: groupOpenid })
  }

  normalize (groupOpenid, user) {
    const id = String(user.member_openid || '').trim()
    if (!id) throw new Error('QQBot 群成员信息缺少 member_openid')
    QQBotIdMap.load()
    const convert = QQBotIdMap.isMemberListConvertEnabled(this.adapter.id, groupOpenid)
    const groupKey = QQBotIdMap.normalizeOpenid(groupOpenid, this.adapter.id)
    const group = QQBotIdMap.data.groups[this.adapter.id]?.[groupKey]
    const binding = QQBotIdMap.data.users[this.adapter.id]?.[QQBotIdMap.normalizeOpenid(id, this.adapter.id)]
    const userQQ = binding?.groups?.[groupKey] && QQBotIdMap.normalizeQQ(binding.qq)
    const groupId = convert && QQBotIdMap.normalizeQQ(group?.group_qq)
    const role = ['admin', 'owner'].includes(user.member_role) ? user.member_role : 'member'
    const joined = Math.floor(Date.parse(user.joined_at) / 1000)
    return {
      group_id: groupId || this.adapter.formatQQBotId(groupOpenid),
      user_id: (convert && userQQ) || this.adapter.formatQQBotId(id),
      member_openid: id,
      group_openid: groupOpenid,
      union_openid: user.union_openid || '',
      nickname: String(user.username || ''),
      card: binding?.groups?.[groupKey]?.card || '',
      sex: 'unknown',
      age: 0,
      area: '',
      level: 0,
      role,
      title: '',
      title_expire_time: 0,
      join_time: Number.isFinite(joined) ? joined : 0,
      last_sent_time: 0,
      shutup_time: 0,
      is_robot: user.bot === true,
      update_time: Math.floor(Date.now() / 1000)
    }
  }

  async page (groupId, { cursor = '' } = {}) {
    const groupOpenid = await this.group(groupId)
    const { data } = await this.adapter.sdk.request.get(`/v2/groups/${encodeURIComponent(groupOpenid)}/members`, {
      params: cursor ? { cursor: String(cursor) } : {}
    })
    if (!Array.isArray(data?.members)) throw new Error('QQBot 获取群成员列表失败：响应缺少 members')
    return data
  }

  async list (groupId, noCache = false) {
    const groupOpenid = await this.group(groupId)
    const cached = this.cache.get(groupOpenid)
    if (!noCache && cached?.expires > Date.now()) return new Map(cached.members.map(member => {
      const info = this.normalize(groupOpenid, member)
      return [info.user_id, info]
    }))
    if (this.pending.has(groupOpenid)) return await this.pending.get(groupOpenid)
    const pending = (async () => {
      const members = []
      const cursors = new Set()
      let cursor = ''
      do {
        if (cursors.has(cursor)) throw new Error('QQBot 群成员列表返回了重复分页游标')
        cursors.add(cursor)
        const data = await this.page(groupOpenid, { cursor })
        members.push(...data.members)
        cursor = String(data.next_cursor || '')
      } while (cursor)
      const result = new Map(members.map(member => {
        const info = this.normalize(groupOpenid, member)
        return [info.user_id, info]
      }))
      this.cache.set(groupOpenid, { members, expires: Date.now() + 30000 })
      return result
    })()
    this.pending.set(groupOpenid, pending)
    try { return await pending } finally { this.pending.delete(groupOpenid) }
  }

  peek (groupId, userId) {
    const groupOpenid = this.adapter.stripQQBotId(QQBotIdMap.resolveGroupOpenid(this.adapter.id, this.adapter.stripQQBotId(groupId)))
    const cached = this.cache.get(groupOpenid)
    const member = cached?.members.find(member => {
      const info = this.normalize(groupOpenid, member)
      return String(info.user_id) === String(userId) || info.member_openid === this.adapter.stripQQBotId(userId)
    })
    return member ? this.normalize(groupOpenid, member) : null
  }

  async info (groupId, userId, noCache = false) {
    const groupOpenid = await this.group(groupId)
    const memberOpenid = await this.memberId(groupOpenid, userId)
    const cached = this.cache.get(groupOpenid)
    const member = !noCache && cached?.expires > Date.now() && cached.members.find(item => item.member_openid === memberOpenid)
    if (member) return this.normalize(groupOpenid, member)
    const { data } = await this.adapter.sdk.request.get(`/v2/groups/${encodeURIComponent(groupOpenid)}/members/${encodeURIComponent(memberOpenid)}`)
    const info = this.normalize(groupOpenid, data || {})
    if (cached) {
      const index = cached.members.findIndex(item => item.member_openid === memberOpenid)
      if (index < 0) cached.members.push(data)
      else cached.members[index] = data
    }
    return info
  }

  async targets (groupOpenid, users) {
    const values = Array.isArray(users) ? users : [users]
    if (!values.length || values.length > 20) throw new Error('QQBot 群成员操作每次需要 1 至 20 名成员')
    return [...new Set(await Promise.all(values.map(id => this.memberId(groupOpenid, id))))]
  }

  async remove (groupId, users, block = false) {
    if (typeof block !== 'boolean') throw new Error('QQBot 拉黑选项必须是布尔值')
    const groupOpenid = await this.group(groupId)
    const targets = await this.targets(groupOpenid, users)
    const { data } = await this.adapter.sdk.request.post(`/v2/groups/${encodeURIComponent(groupOpenid)}/batch_remove_members`, {
      member_openids: targets,
      add_to_member_blacklist: block
    })
    if (data?.remove_members_result !== 'success') throw new Error('QQBot 移除群成员失败：接口未返回 success')
    this.cache.delete(groupOpenid)
    if (data.add_to_member_blacklist_fail_openids?.length) {
      const error = new Error(`QQBot 已移除群成员，但有 ${data.add_to_member_blacklist_fail_openids.length} 名成员加入黑名单失败`)
      error.qqbot_partial_success = true
      error.failed_member_openids = data.add_to_member_blacklist_fail_openids
      throw error
    }
    return data
  }

  async kick (groupId, userId, message, block = false) {
    // ICQQ 为 (uid, message, block)，兼容旧插件的 (uid, rejectAddRequest)。
    if (typeof message === 'boolean') block = message
    await this.remove(groupId, [userId], block)
    return true
  }

  async blacklistPage (groupId, { cursor = '', limit = 20 } = {}) {
    const groupOpenid = await this.group(groupId)
    if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) throw new Error('QQBot 黑名单单页数量必须为 1 至 100')
    const { data } = await this.adapter.sdk.request.get(`/v2/groups/${encodeURIComponent(groupOpenid)}/member_blacklist`, {
      params: { ...(cursor ? { cursor: String(cursor) } : {}), limit: Number(limit) }
    })
    if (!Array.isArray(data?.users)) throw new Error('QQBot 查询群黑名单失败：响应缺少 users')
    return data
  }

  async blacklist (groupId) {
    const groupOpenid = await this.group(groupId)
    const users = new Map()
    let cursor = ''
    const cursors = new Set()
    do {
      if (cursors.has(cursor)) throw new Error('QQBot 群黑名单返回了重复分页游标')
      cursors.add(cursor)
      const data = await this.blacklistPage(groupOpenid, { cursor, limit: 100 })
      for (const user of data.users) {
        const info = this.normalize(groupOpenid, user)
        users.set(info.user_id, { ...info, banned_at: user.banned_at || '' })
      }
      cursor = String(data.next_cursor || '')
    } while (cursor)
    return users
  }

  async setBlacklist (groupId, users, enabled = true) {
    if (typeof enabled !== 'boolean') throw new Error('QQBot 黑名单开关必须是布尔值')
    const groupOpenid = await this.group(groupId)
    const targets = await this.targets(groupOpenid, users)
    const { data } = await this.adapter.sdk.request.post(`/v2/groups/${encodeURIComponent(groupOpenid)}/member_blacklist`, {
      op: enabled ? 'add' : 'del', member_openids: targets
    })
    if (!Array.isArray(data?.fail_openids)) throw new Error('QQBot 操作群黑名单失败：响应缺少 fail_openids')
    if (data.fail_openids.length) {
      const error = new Error(`QQBot ${enabled ? '加入' : '移出'}群黑名单失败：${data.fail_openids.length} 名成员操作失败`)
      error.failed_member_openids = data.fail_openids
      throw error
    }
    return true
  }
}
