import fs from 'fs'
import path from 'path'

const WAIT_MS = 2000
const TIME_TOLERANCE = 2
const DATA_FILE = path.join(process.cwd(), 'data/lain-plugin/qqbot-openid-map.json')

const pendingQQBot = new Map()
const pendingQQ = new Map()
const recentQQBot = new Map()

class QQBotIdMap {
  static data = {
    version: 1,
    users: {},
    groups: {},
    enabled_groups: {}
  }

  static loaded = false
  static saveTimer = null

  static install () {
    this.load()
    Bot.QQBotIdMap = this
    Bot.QQToOpenid = async (id, e = {}, type = 'user') => {
      const self_id = String(e.self_id || e.bot?.uin || e.bot?.config?.appid || '')
      if (!self_id || id == null) return this.stripSelfId(id)

      if (type === 'group') {
        const group = this.findGroupByQQ(self_id, id)
        return this.stripSelfId(group?.group_openid || id)
      }

      const groupOpenid = this.getEventGroupOpenid(e, self_id)
      const groupQQ = this.getEventGroupQQ(e)
      const user = this.findUserByQQ(self_id, id, { groupOpenid, groupQQ })
      return this.stripSelfId(user?.user_openid || id)
    }
  }

  static load () {
    if (this.loaded) return
    this.loaded = true

    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
        this.data = {
          version: 1,
          users: data.users || {},
          groups: data.groups || {},
          enabled_groups: data.enabled_groups || {}
        }
      }
    } catch (error) {
      logger.error('[QQBotIdMap]读取映射数据失败', error)
    }
  }

  static saveSoon () {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 100)
  }

  static save () {
    try {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
      const tmp = `${DATA_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fs.renameSync(tmp, DATA_FILE)
      return true
    } catch (error) {
      logger.error('[QQBotIdMap]保存映射数据失败', error)
      return false
    }
  }

  static bind ({ self_id, user_openid, group_openid, qq, group_qq, nickname = '', group_name = '' }) {
    this.load()
    self_id = String(self_id || '')
    if (!self_id) return null

    const userOpenid = this.normalizeOpenid(user_openid, self_id)
    const groupOpenid = this.normalizeOpenid(group_openid, self_id)
    const userQQ = this.normalizeQQ(qq)
    const groupQQ = this.normalizeQQ(group_qq)
    const now = Date.now()

    if (!this.data.users[self_id]) this.data.users[self_id] = {}
    if (!this.data.groups[self_id]) this.data.groups[self_id] = {}
    if (!this.data.enabled_groups[self_id]) this.data.enabled_groups[self_id] = {}

    if (groupOpenid) {
      const old = this.data.groups[self_id][groupOpenid] || {}
      this.data.groups[self_id][groupOpenid] = {
        group_openid: groupOpenid,
        group_qq: groupQQ || old.group_qq || null,
        group_name: group_name || old.group_name || '',
        created_at: old.created_at || now,
        updated_at: now
      }
    }

    if (userOpenid && userQQ) {
      const old = this.data.users[self_id][userOpenid] || {}
      const groups = old.groups || {}
      if (groupOpenid) {
        groups[groupOpenid] = {
          group_openid: groupOpenid,
          group_qq: groupQQ || groups[groupOpenid]?.group_qq || null,
          updated_at: now
        }
      }

      this.data.users[self_id][userOpenid] = {
        user_openid: userOpenid,
        qq: userQQ,
        nickname: nickname || old.nickname || '',
        groups,
        created_at: old.created_at || now,
        updated_at: now
      }
    }

    const saved = this.save()
    return {
      self_id,
      user_openid: userOpenid,
      group_openid: groupOpenid,
      qq: userQQ,
      group_qq: groupQQ,
      saved
    }
  }

  static applyStoredMapping (e) {
    this.load()
    const self_id = String(e.self_id || '')
    if (!self_id) return { user: false, group: false }

    const userOpenid = this.normalizeOpenid(e.user_openid || e.member_openid || e.user_id, self_id)
    const groupOpenid = this.normalizeOpenid(e.group_openid || e.group_id, self_id)
    const user = this.data.users[self_id]?.[userOpenid]
    const group = this.data.groups[self_id]?.[groupOpenid]

    this.applyQQMapping(e, {
      qq: user?.qq || null,
      group_qq: group?.group_qq || user?.groups?.[groupOpenid]?.group_qq || null,
      nickname: user?.nickname || ''
    })

    return {
      user: !!user?.qq,
      group: !!(group?.group_qq || user?.groups?.[groupOpenid]?.group_qq)
    }
  }

  static async handleQQBotGroupMessage (e, emit) {
    if (!this.isGroupMessage(e) || this.isQQBotSelfMessage(e)) {
      await emit(e)
      return true
    }

    if (!this.isGroupEnabled(e.self_id, e.group_openid || e.group_id)) {
      await emit(e)
      return true
    }

    const stored = this.applyStoredMapping(e)
    const qqbot = this.createRecord(e, 'qqbot', emit)

    if (stored.user && stored.group) {
      this.clearStoredMappedQQRecords(qqbot)
      this.logDebug(e.self_id, 'QQBot模拟ICQQ data', e)
      await emit(e)
      this.rememberQQBotEmit(qqbot)
      return true
    }

    const qq = this.findMatchedRecord(qqbot, pendingQQ)

    if (qq) {
      this.clearRecord(qq, pendingQQ)
      await this.bindAndEmit(qqbot, qq)
      return true
    }

    this.setPending(qqbot, pendingQQBot, async () => {
      const fallbackStored = this.applyStoredMapping(qqbot.event)
      if (fallbackStored.user || fallbackStored.group) this.logDebug(qqbot.selfId, 'QQBot模拟ICQQ data', qqbot.event)
      await qqbot.emit(qqbot.event)
      this.rememberQQBotEmit(this.createRecord(qqbot.event, 'qqbot', qqbot.emit))
    })
    return true
  }

  static async handleQQGroupMessage (e, emit) {
    if (!this.isGroupMessage(e) || !this.hasQQBot() || !this.hasEnabledGroup() || !this.isNumericQQ(e.user_id) || !this.isNumericQQ(e.group_id) || e.user_id === e.self_id) {
      return false
    }

    if (!this.shouldHandleQQGroupMessage(e.group_id)) {
      return false
    }

    const qq = this.createRecord(e, 'qq', emit)
    if (this.hasStoredMappingForQQRecord(qq)) return true
    if (this.findMatchedRecord(qq, recentQQBot)) return true

    const qqbot = this.findMatchedRecord(qq, pendingQQBot)
    if (qqbot) {
      this.clearRecord(qqbot, pendingQQBot)
      await this.bindAndEmit(qqbot, qq)
      return true
    }

    this.setPending(qq, pendingQQ, async () => {
      lain.info(qq.selfId, `QQBot转换未匹配到QQBot事件，fallback放行其它适配器消息: 群 ${qq.groupQQ} 用户 ${qq.userQQ} ${qq.raw}`)
      await qq.emit(qq.event)
    })
    return true
  }

  static async bindAndEmit (qqbot, qq) {
    const mapping = this.bind({
      self_id: qqbot.selfId,
      user_openid: qqbot.userOpenid,
      group_openid: qqbot.groupOpenid,
      qq: qq.userQQ,
      group_qq: qq.groupQQ,
      nickname: qq.nickname || qqbot.nickname,
      group_name: qq.groupName
    })

    this.applyQQMapping(qqbot.event, {
      qq: mapping.qq || qq.userQQ,
      group_qq: mapping.group_qq || qq.groupQQ,
      nickname: qq.nickname || qqbot.nickname
    })
    this.logDebug(qqbot.selfId, 'QQBot模拟ICQQ data', qqbot.event)

    lain.info(qqbot.selfId, `QQBot身份映射: 群 ${mapping.group_openid}=>${mapping.group_qq} 用户 ${mapping.user_openid}=>${mapping.qq}`)
    await qqbot.emit(qqbot.event)
    this.rememberQQBotEmit(this.createRecord(qqbot.event, 'qqbot', qqbot.emit))
  }

  static applyQQMapping (e, mapping) {
    const qq = this.normalizeQQ(mapping.qq)
    const groupQQ = this.normalizeQQ(mapping.group_qq)
    const openidUserId = e.openid_user_id || e.user_id
    const openidGroupId = e.openid_group_id || e.group_id

    e.openid_user_id = openidUserId
    e.openid_group_id = openidGroupId
    e.qqbot_user_id = openidUserId
    e.qqbot_group_id = openidGroupId

    if (qq) {
      e.user_id = qq
      if (!e.sender) e.sender = {}
      e.sender.user_id = qq
      e.sender.qq = qq
      if (e.author) e.author.id = qq
      if (e.member) e.member.user_id = qq
      if (e.member?.info) e.member.info.user_id = qq
    }

    if (groupQQ) {
      e.group_id = groupQQ
      if (!e.sender) e.sender = {}
      e.sender.group_id = groupQQ
      if (e.member) e.member.group_id = groupQQ
      if (e.member?.info) e.member.info.group_id = groupQQ
    }

    if (mapping.nickname) {
      if (!e.sender) e.sender = {}
      e.sender.nickname = mapping.nickname
      e.sender.card = mapping.nickname
    }

    this.cacheBotRoute(e, qq, groupQQ, openidUserId, openidGroupId)
  }

  static setGroupEnabled ({ self_id, group_openid, enabled, group_qq = '', group_name = '' }) {
    this.load()
    self_id = String(self_id || '')
    const groupOpenid = this.normalizeOpenid(group_openid, self_id)
    if (!self_id || !groupOpenid) return null

    if (!this.data.enabled_groups[self_id]) this.data.enabled_groups[self_id] = {}
    const now = Date.now()
    this.data.enabled_groups[self_id][groupOpenid] = {
      group_openid: groupOpenid,
      enabled: !!enabled,
      group_qq: this.normalizeQQ(group_qq) || this.data.enabled_groups[self_id][groupOpenid]?.group_qq || null,
      group_name: group_name || this.data.enabled_groups[self_id][groupOpenid]?.group_name || '',
      updated_at: now
    }

    this.bind({
      self_id,
      group_openid: groupOpenid,
      group_qq,
      group_name
    })
    const saved = this.save()
    return {
      ...this.data.enabled_groups[self_id][groupOpenid],
      saved
    }
  }

  static isGroupEnabled (self_id, group_openid) {
    this.load()
    self_id = String(self_id || '')
    const groupOpenid = this.normalizeOpenid(group_openid, self_id)
    return !!this.data.enabled_groups[self_id]?.[groupOpenid]?.enabled
  }

  static hasEnabledGroup () {
    this.load()
    return Object.values(this.data.enabled_groups || {}).some(groups => {
      return Object.values(groups || {}).some(group => group?.enabled)
    })
  }

  static shouldHandleQQGroupMessage (group_qq) {
    this.load()
    const groupQQ = this.normalizeQQ(group_qq)
    if (!groupQQ) return false

    const mappedGroups = this.findGroupsByQQAny(groupQQ)
    if (mappedGroups.some(group => this.isGroupEnabled(group.self_id, group.group_openid))) return true
    if (mappedGroups.length > 0) return this.hasEnabledGroupWithoutQQ()
    return this.hasEnabledGroup()
  }

  static hasEnabledGroupWithoutQQ () {
    this.load()
    for (const groups of Object.values(this.data.enabled_groups || {})) {
      for (const group of Object.values(groups || {})) {
        if (group?.enabled && !group.group_qq) return true
      }
    }
    return false
  }

  static cacheBotRoute (e, qq, groupQQ, openidUserId, openidGroupId) {
    const self_id = String(e.self_id || '')
    if (!self_id || !Bot?.[self_id]) return

    try {
      if (groupQQ) {
        const group = {
          ...(Bot.gl?.get(groupQQ) || {}),
          group_id: groupQQ,
          uin: self_id,
          qqbot_group_id: openidGroupId
        }
        Bot.gl?.set(groupQQ, group)
        Bot[self_id].gl?.set(groupQQ, group)
      }

      if (qq) {
        const user = {
          ...(Bot.fl?.get(qq) || {}),
          user_id: qq,
          uin: self_id,
          qqbot_user_id: openidUserId
        }
        Bot.fl?.set(qq, user)
        Bot[self_id].fl?.set(qq, user)
      }
    } catch (error) {
      logger.debug('[QQBotIdMap]缓存Bot路由失败', error)
    }
  }

  static createRecord (e, source, emit) {
    const selfId = String(e.self_id || e.bot?.uin || '')
    return {
      key: `${source}:${Date.now()}:${Math.random()}`,
      source,
      event: e,
      emit,
      selfId,
      raw: this.normalizeText(e.data?.raw_message || e.data?.content || e.raw_message || e.msg),
      nickname: this.getNickname(e),
      groupName: e.group_name || e.data?.group_name || '',
      time: Number(e.time || e.timestamp || e.data?.timestamp || 0),
      userQQ: this.normalizeQQ(e.user_id),
      groupQQ: this.normalizeQQ(e.group_id),
      userOpenid: e.user_openid || e.member_openid || e.sender?.user_openid || e.sender?.member_openid || e.user_id,
      groupOpenid: e.group_openid || e.sender?.group_openid || e.group_id,
      timer: null
    }
  }

  static findMatchedRecord (record, records) {
    for (const candidate of records.values()) {
      if (this.isSameMessage(record, candidate)) return candidate
    }
    return null
  }

  static isSameMessage (a, b) {
    if (!a.raw || !b.raw || a.raw !== b.raw) return false
    if (a.time && b.time && Math.abs(a.time - b.time) > TIME_TOLERANCE) return false
    if (a.nickname && b.nickname && a.nickname !== b.nickname) return false
    if (a.groupQQ && b.groupQQ && a.groupQQ !== b.groupQQ) return false
    return true
  }

  static setPending (record, records, fallback) {
    records.set(record.key, record)
    record.timer = setTimeout(async () => {
      if (!records.has(record.key)) return
      records.delete(record.key)
      try {
        await fallback()
      } catch (error) {
        logger.error('[QQBotIdMap]消息放行失败', error)
      }
    }, WAIT_MS)
  }

  static clearRecord (record, records) {
    if (record.timer) clearTimeout(record.timer)
    records.delete(record.key)
  }

  static rememberQQBotEmit (record) {
    const key = `${record.raw}:${record.time}:${record.nickname}:${record.groupQQ || ''}:${record.userQQ || ''}`
    record.key = key
    recentQQBot.set(key, record)
    setTimeout(() => recentQQBot.delete(key), WAIT_MS * 3)
  }

  static clearStoredMappedQQRecords (qqbot) {
    for (const qq of pendingQQ.values()) {
      if (!this.isStoredMappedPair(qqbot, qq)) continue
      this.clearRecord(qq, pendingQQ)
    }
  }

  static isStoredMappedPair (qqbot, qq) {
    if (!qqbot?.userQQ || !qqbot?.groupQQ || !qq?.userQQ || !qq?.groupQQ) return false
    return qqbot.userQQ === qq.userQQ && qqbot.groupQQ === qq.groupQQ
  }

  static hasStoredMappingForQQRecord (record) {
    this.load()
    if (!record?.userQQ || !record?.groupQQ) return false

    const groups = this.findGroupsByQQAny(record.groupQQ).filter(group => {
      return this.isGroupEnabled(group.self_id, group.group_openid)
    })
    if (!groups.length) return false

    return groups.some(group => {
      const user = this.findUserByQQ(group.self_id, record.userQQ, {
        groupOpenid: group.group_openid,
        groupQQ: record.groupQQ
      })
      return !!user?.groups?.[group.group_openid]
    })
  }

  static findGroupByQQ (self_id, group_qq) {
    this.load()
    const groupQQ = this.normalizeQQ(group_qq)
    if (!groupQQ) return null
    return Object.values(this.data.groups[self_id] || {}).find(group => group.group_qq === groupQQ) || null
  }

  static findGroupByQQAny (group_qq) {
    return this.findGroupsByQQAny(group_qq)[0] || null
  }

  static findGroupsByQQAny (group_qq) {
    this.load()
    const groupQQ = this.normalizeQQ(group_qq)
    if (!groupQQ) return []

    const ret = []
    for (const [self_id, groups] of Object.entries(this.data.groups || {})) {
      for (const group of Object.values(groups || {})) {
        if (group.group_qq === groupQQ) ret.push({ ...group, self_id })
      }
    }
    return ret
  }

  static findUserByQQ (self_id, qq, { groupOpenid = '', groupQQ = '' } = {}) {
    this.load()
    const userQQ = this.normalizeQQ(qq)
    if (!userQQ) return null

    groupOpenid = groupOpenid ? this.normalizeOpenid(groupOpenid, self_id) : ''
    const group = groupOpenid ? null : this.findGroupByQQ(self_id, groupQQ)
    const currentGroupOpenid = groupOpenid || group?.group_openid || ''

    const users = Object.values(this.data.users[self_id] || {}).filter(user => user.qq === userQQ)
    if (currentGroupOpenid) {
      const user = users.find(user => user.groups?.[currentGroupOpenid])
      if (user) return user
    }
    return users[0] || null
  }

  static getEventGroupOpenid (e, self_id) {
    const value = String(e.group_openid || e.raw_sender?.group_openid || e.data?.group_id || e.openid_group_id || '').trim()
    if (!value) return ''
    if (this.isNumericQQ(value)) {
      const group = this.findGroupByQQ(self_id, value)
      return group?.group_openid || ''
    }
    return this.normalizeOpenid(value, self_id)
  }

  static getEventGroupQQ (e) {
    return this.normalizeQQ(e.group_id) || this.normalizeQQ(e.raw_group_id)
  }

  static hasQQBot () {
    return Object.values(Bot || {}).some(bot => bot?.adapter === 'QQBot')
  }

  static isGroupMessage (e) {
    return e?.post_type === 'message' && e?.message_type === 'group' && e?.group_id
  }

  static isQQBotSelfMessage (e) {
    return !!(e?.author?.bot || e?.data?.author?.bot)
  }

  static normalizeOpenid (value, self_id) {
    const text = String(value || '').trim()
    if (!text) return ''
    if (text.startsWith(`${self_id}-`)) return text
    return `${self_id}-${text.split('-').pop()}`
  }

  static normalizeQQ (value) {
    const text = String(value || '').trim()
    if (!/^\d+$/.test(text)) return null
    const number = Number(text)
    return Number.isSafeInteger(number) ? number : null
  }

  static isNumericQQ (value) {
    return !!this.normalizeQQ(value)
  }

  static stripSelfId (value) {
    const parts = String(value || '').trim().split('-')
    return parts[1] || parts[0] || ''
  }

  static normalizeText (text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
  }

  static getNickname (e) {
    return String(e.sender?.card || e.sender?.nickname || e.sender?.user_name || e.author?.username || '').trim()
  }

  static logInfo (id, title, data) {
    try {
      lain.info(id, `${title}: ${this.safeStringify(data)}`)
    } catch (error) {
      lain.info(id, `${title}: [日志序列化失败] ${error?.message || error}`)
    }
  }

  static logDebug (id, title, data) {
    try {
      lain.debug(id, `${title}: ${this.safeStringify(data)}`)
    } catch (error) {
      lain.debug(id, `${title}: [日志序列化失败] ${error?.message || error}`)
    }
  }

  static safeStringify (data) {
    const seen = new WeakSet()
    return JSON.stringify(data, (key, value) => {
      if (typeof value === 'function') return `[Function:${value.name || 'anonymous'}]`
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    })
  }
}

export default QQBotIdMap
