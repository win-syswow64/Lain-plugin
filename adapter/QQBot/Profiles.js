import QQBotIdMap from '../../model/qqbot-id-map.js'
import { getQQBotAPIErrorCode } from './APIPolicy.js'

/** 只合并文档中的资料字段；旧事件的空昵称/头像不清除已知资料。 */
export function profileFields (value = {}, group = false) {
  value ||= {}
  const result = {}
  const names = group
    ? ['group_name', 'group_finger_memo', 'group_class_text', 'union_group_openid']
    : ['username', 'avatar', 'union_openid']
  for (const key of names) {
    if (typeof value[key] === 'string' && value[key]) result[key] = value[key]
  }
  if (group) {
    if (Number.isInteger(value.group_member_num) && value.group_member_num >= 0) result.group_member_num = value.group_member_num
    if (Array.isArray(value.group_tags)) result.group_tags = value.group_tags.filter(tag => typeof tag === 'string')
  } else {
    if (typeof value.member_nickname === 'string') result.member_nickname = value.member_nickname
    if (['owner', 'admin', 'member'].includes(value.member_role)) result.member_role = value.member_role
    if (typeof value.bot === 'boolean') result.bot = value.bot
    if (typeof value.allow_proactive_msg === 'boolean') result.allow_proactive_msg = value.allow_proactive_msg
  }
  return result
}

/** 2026-11-16 用户/群资料。用户与群成员的 OpenID 不互相猜测或替换。 */
export default class QQBotProfiles {
  constructor (adapter) {
    this.adapter = adapter
    QQBotIdMap.load()
    this.users = new Map()
    this.groups = new Map()
    this.pending = new Map()
  }

  key (id, group = false) {
    const raw = this.adapter.stripQQBotId(id)
    if (!QQBotIdMap.normalizeQQ(raw)) return raw
    const binding = group ? QQBotIdMap.findGroupByQQ(this.adapter.id, raw)
      : QQBotIdMap.findUserByQQ(this.adapter.id, raw, { preferPrivate: true })
    return this.adapter.stripQQBotId((group ? binding?.group_openid : binding?.user_openid) || raw)
  }

  peekUser (id) {
    const key = this.key(id)
    const stored = QQBotIdMap.data.users[this.adapter.id]?.[QQBotIdMap.normalizeOpenid(key, this.adapter.id)]
    const cached = globalThis.Bot?.[this.adapter.id]?.fl?.get(this.adapter.formatQQBotId(key))
    return { ...profileFields({ ...stored, username: stored?.nickname }),
      ...profileFields({ ...cached, username: cached?.nickname || cached?.username }), ...this.users.get(key)?.value }
  }

  peekGroup (id) {
    const key = this.key(id, true)
    const stored = QQBotIdMap.data.groups[this.adapter.id]?.[QQBotIdMap.normalizeOpenid(key, this.adapter.id)]
    const cached = globalThis.Bot?.[this.adapter.id]?.gl?.get(this.adapter.formatQQBotId(key))
    return { ...profileFields(stored, true), ...profileFields(cached, true), ...this.groups.get(key)?.value }
  }

  userInfo (id) {
    const openid = this.key(id)
    const value = this.peekUser(openid)
    const binding = QQBotIdMap.data.users[this.adapter.id]?.[QQBotIdMap.normalizeOpenid(openid, this.adapter.id)]
    const qq = binding?.c2c && QQBotIdMap.getBoundBotQQ(this.adapter.id) && QQBotIdMap.normalizeQQ(binding.qq)
    return {
      ...value,
      user_id: qq || this.adapter.formatQQBotId(openid),
      user_openid: openid,
      nickname: value.username || '',
      avatar: value.avatar || '',
      union_openid: value.union_openid || '',
      sex: 'unknown', age: 0, area: '', remark: '', class_id: 0
    }
  }

  groupInfo (id) {
    const openid = this.key(id, true)
    const value = this.peekGroup(openid)
    const binding = QQBotIdMap.data.groups[this.adapter.id]?.[QQBotIdMap.normalizeOpenid(openid, this.adapter.id)]
    const qq = QQBotIdMap.isGroupEnabled(this.adapter.id, openid) && QQBotIdMap.normalizeQQ(binding?.group_qq)
    return {
      ...value,
      group_id: qq || this.adapter.formatQQBotId(openid),
      group_openid: openid,
      group_name: value.group_name || '',
      group_memo: value.group_finger_memo || '',
      member_count: value.group_member_num ?? 0,
      union_group_openid: value.union_group_openid || '',
      max_member_count: 0, owner_id: 0, admin_flag: false,
      last_join_time: 0, last_sent_time: 0, shutup_time_whole: 0, shutup_time_me: 0,
      update_time: Math.floor(Date.now() / 1000)
    }
  }

  observeUser (id, value) {
    const key = this.key(id)
    if (!key) return
    const previous = this.users.get(key)
    const info = { ...this.peekUser(key), ...profileFields(value) }
    this.users.set(key, { value: info, expires: previous?.expires || 0 })
    QQBotIdMap.updateOfficialProfile(this.adapter.id, key, info)
    const fl = globalThis.Bot?.[this.adapter.id]?.fl
    const userId = this.adapter.formatQQBotId(key)
    const normalized = this.userInfo(key)
    fl?.set(userId, { ...fl.get(userId), ...normalized, user_id: userId })
    if (typeof normalized.user_id === 'number') {
      const selfId = QQBotIdMap.getBoundBotQQ(this.adapter.id)
      globalThis.Bot?.[selfId]?.fl?.set(normalized.user_id, normalized)
      globalThis.Bot?.fl?.set(normalized.user_id, normalized)
    }
    return normalized
  }

  observeGroup (id, value) {
    const key = this.key(id, true)
    if (!key) return
    const previous = this.groups.get(key)
    const info = { ...this.peekGroup(key), ...profileFields(value, true) }
    this.groups.set(key, { value: info, expires: previous?.expires || 0 })
    QQBotIdMap.updateOfficialProfile(this.adapter.id, '', info, key)
    const gl = globalThis.Bot?.[this.adapter.id]?.gl
    const groupId = this.adapter.formatQQBotId(key)
    const normalized = this.groupInfo(key)
    gl?.set(groupId, { ...gl.get(groupId), ...normalized, group_id: groupId })
    if (typeof normalized.group_id === 'number') {
      const binding = QQBotIdMap.data.groups[this.adapter.id]?.[QQBotIdMap.normalizeOpenid(key, this.adapter.id)]
      const selfId = QQBotIdMap.getBoundBotQQ(this.adapter.id) || binding?.qq_self_id
      globalThis.Bot?.[selfId]?.gl?.set(normalized.group_id, normalized)
      globalThis.Bot?.gl?.set(normalized.group_id, normalized)
    }
    return normalized
  }

  /** 同一对象合并并发请求；群信息 30 QPM，查询结果默认缓存一分钟。 */
  async query (kind, id, noCache = false) {
    const group = kind === 'group'
    const openid = await this.adapter.resolveOpenid(id, group ? 'group' : 'private')
    const cache = group ? this.groups : this.users
    const key = `${kind}:${openid}`
    const normalize = () => group ? this.groupInfo(openid) : this.userInfo(openid)
    if (!noCache && cache.get(openid)?.expires > Date.now()) return normalize()
    if (this.pending.has(key)) return await this.pending.get(key)
    const task = (async () => {
      let data
      try {
        ({ data } = await this.adapter.sdk.request.get(`/v2/${group ? 'groups' : 'users'}/${encodeURIComponent(openid)}/info`))
      } catch (error) {
        // 用户无好友关系时，明确失败，不返回旧资料伪装查询成功。
        const code = getQQBotAPIErrorCode(error)
        if (!group && code === 40184001) {
          const wrapped = new Error('QQBot 获取用户基本信息失败：用户与机器人无好友关系', { cause: error })
          wrapped.code = code
          throw wrapped
        }
        throw error
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
        (group ? typeof data.group_name !== 'string' : typeof data.username !== 'string' || typeof data.allow_proactive_msg !== 'boolean')) {
        throw new Error(`QQBot 获取${group ? '群' : '用户'}基本信息失败：响应字段不完整`)
      }
      if (group) this.observeGroup(openid, data)
      else this.observeUser(openid, data)
      cache.get(openid).expires = Date.now() + (group ? 60000 : 30000)
      return normalize()
    })()
    this.pending.set(key, task)
    try { return await task } finally { this.pending.delete(key) }
  }
}
