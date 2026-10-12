import fs from 'fs'
import path from 'path'

const WAIT_MS = 2000
const TIME_TOLERANCE = 2
const DATA_FILE = path.join(process.cwd(), 'data/lain-plugin/qqbot-openid-map.json')

const pendingQQBot = new Map()
const pendingQQ = new Map()
const recentQQBot = new Map()
const pendingQQPrivate = new Map()
const recentQQBotPrivate = new Map()

class QQBotIdMap {
  static data = {
    version: 1,
    users: {},
    groups: {},
    enabled_groups: {},
    bots: {},
    features: {}
  }

  static loaded = false
  static saveTimer = null

  static install () {
    this.load()
    Bot.QQBotIdMap = this
    Bot.QQToOpenid = async (id, e = {}, type = 'user') => {
      const self_id = String(e.qqbot_self_id || e.qqbot_appid || e.bot?.config?.appid || e.self_id || e.bot?.uin || '')
      if (!self_id || id == null) return this.stripSelfId(id, self_id)

      if (type === 'group') {
        const group = this.findGroupByQQ(self_id, id)
        return this.stripSelfId(group?.group_openid || id, self_id)
      }

      const groupOpenid = this.getEventGroupOpenid(e, self_id)
      const groupQQ = this.getEventGroupQQ(e)
      const preferPrivate = type === 'private' || e.message_type === 'private' || e.isPrivate
      const user = this.findUserByQQ(self_id, id, { groupOpenid, groupQQ, preferPrivate })
      return this.stripSelfId(user?.user_openid || id, self_id)
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
          enabled_groups: data.enabled_groups || {},
          bots: data.bots || {},
          features: data.features || {}
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

  static bind ({ self_id, user_openid, group_openid, qq, group_qq, nickname = '', group_name = '', qq_self_id = '', qq_adapter = '', private: isPrivate = false }) {
    this.load()
    self_id = String(self_id || '')
    if (!self_id) return null

    const userOpenid = this.normalizeOpenid(user_openid, self_id)
    const groupOpenid = this.normalizeOpenid(group_openid, self_id)
    const userQQ = this.normalizeQQ(qq)
    const groupQQ = this.normalizeQQ(group_qq)
    const qqSelfId = this.normalizeQQ(qq_self_id)
    const qqAdapter = String(qq_adapter || '').trim()
    const now = Date.now()

    if (!this.data.users[self_id]) this.data.users[self_id] = {}
    if (!this.data.groups[self_id]) this.data.groups[self_id] = {}
    if (!this.data.enabled_groups[self_id]) this.data.enabled_groups[self_id] = {}
    if (!this.data.bots) this.data.bots = {}
    if (!this.data.features) this.data.features = {}

    if (groupOpenid) {
      const old = this.data.groups[self_id][groupOpenid] || {}
      this.data.groups[self_id][groupOpenid] = {
        group_openid: groupOpenid,
        group_qq: groupQQ || old.group_qq || null,
        group_name: group_name || old.group_name || '',
        qq_self_id: qqSelfId || old.qq_self_id || null,
        qq_adapter: qqAdapter || old.qq_adapter || '',
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
          qq_self_id: qqSelfId || groups[groupOpenid]?.qq_self_id || null,
          qq_adapter: qqAdapter || groups[groupOpenid]?.qq_adapter || '',
          updated_at: now
        }
      }

      this.data.users[self_id][userOpenid] = {
        user_openid: userOpenid,
        qq: userQQ,
        nickname: nickname || old.nickname || '',
        qq_self_id: qqSelfId || old.qq_self_id || null,
        qq_adapter: qqAdapter || old.qq_adapter || '',
        c2c: !!(isPrivate || old.c2c),
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
      qq_self_id: qqSelfId,
      qq_adapter: qqAdapter,
      saved
    }
  }

  static bindBotQQ ({ self_id, qq_self_id }) {
    this.load()
    self_id = String(self_id || '')
    const qqSelfId = this.normalizeQQ(qq_self_id)
    if (!self_id || !qqSelfId) return null

    if (!this.data.bots) this.data.bots = {}
    const old = this.data.bots[self_id] || {}
    const now = Date.now()
    this.data.bots[self_id] = {
      self_id,
      qq_self_id: qqSelfId,
      created_at: old.created_at || now,
      updated_at: now
    }

    return {
      ...this.data.bots[self_id],
      saved: this.save()
    }
  }

  static getBoundBotQQ (self_id) {
    this.load()
    self_id = String(self_id || '')
    return this.normalizeQQ(this.data.bots?.[self_id]?.qq_self_id)
  }

  static getEffectiveQQSelfId (qqbotSelfId, mapping = {}, source = null) {
    return this.getBoundBotQQ(qqbotSelfId) ||
      this.normalizeQQ(mapping.qq_self_id || source?.self_id || source?.uin || source?.bot?.uin)
  }

  static getStoredMapping (e) {
    this.load()
    const self_id = String(e.self_id || '')
    if (!self_id) return { user: false, group: false, mentions: true, mapping: { mentions: {} } }

    const userOpenid = this.normalizeOpenid(e.user_openid || e.member_openid || e.user_id, self_id)
    const groupOpenid = this.normalizeOpenid(e.group_openid || e.group_id, self_id)
    const user = this.data.users[self_id]?.[userOpenid]
    const group = this.data.groups[self_id]?.[groupOpenid]
    const userGroup = user?.groups?.[groupOpenid] || {}
    const botQQ = this.getBoundBotQQ(self_id)
    const mapping = {
      qq: user?.qq || null,
      group_qq: group?.group_qq || userGroup.group_qq || null,
      nickname: user?.nickname || '',
      group_name: group?.group_name || '',
      qq_self_id: botQQ || group?.qq_self_id || userGroup.qq_self_id || user?.qq_self_id || null,
      qq_adapter: group?.qq_adapter || userGroup.qq_adapter || user?.qq_adapter || ''
    }
    const mentionMappings = this.getStoredAtMappings(e, self_id, groupOpenid)

    return {
      user: !!mapping.qq,
      group: !!mapping.group_qq,
      mentions: true,
      mapping: {
        ...mapping,
        mentions: mentionMappings
      }
    }
  }

  static applyStoredMapping (e) {
    const stored = this.getStoredMapping(e)
    if (stored.user && stored.group) {
      this.applyQQMapping(e, stored.mapping)
      return {
        ...stored,
        applied: true
      }
    }

    // Sender / group identity may be new while one of the @ targets already has
    // a saved QQ mapping. Convert each known target independently.
    this.applyAtMappings(e, stored.mapping.mentions)
    return {
      ...stored,
      applied: Object.keys(stored.mapping.mentions || {}).length > 0
    }
  }

  /** C2C 使用 user_openid；只接受该 OpenID 的显式映射，不用群 member_openid 猜测身份。 */
  static getStoredPrivateMapping (e) {
    this.load()
    const selfId = String(e.qqbot_self_id || e.qqbot_appid || e.self_id || '')
    const rawOpenid = e.user_openid || e.raw_sender?.user_openid || e.author?.user_openid
    if (!selfId || !rawOpenid) return null

    const userOpenid = this.normalizeOpenid(rawOpenid, selfId)
    const user = this.data.users[selfId]?.[userOpenid]
    const qq = this.normalizeQQ(user?.qq)
    const qqSelfId = this.getBoundBotQQ(selfId) || this.normalizeQQ(user?.qq_self_id)
    if (!qq || !qqSelfId) return null

    return {
      selfId,
      userOpenid,
      user,
      mapping: {
        qq,
        qq_self_id: qqSelfId,
        qq_adapter: user.qq_adapter || '',
        nickname: user.nickname || ''
      }
    }
  }

  static async handleQQBotPrivateMessage (e, emit) {
    if (!this.isPrivateMessage(e) || this.isQQBotSelfMessage(e)) {
      await emit(e)
      return true
    }

    const stored = this.getStoredPrivateMapping(e)
    if (!stored) {
      await emit(e)
      return true
    }

    const record = this.createRecord(e, 'qqbot', emit)
    record.userQQ = stored.mapping.qq
    record.qqSelfId = stored.mapping.qq_self_id
    this.applyQQMapping(e, stored.mapping)
    if (!stored.user.c2c) {
      stored.user.c2c = true
      stored.user.updated_at = Date.now()
      this.saveSoon()
    }

    for (const qq of pendingQQPrivate.values()) {
      if (this.isSamePrivateMessage(record, qq)) this.clearRecord(qq, pendingQQPrivate)
    }
    this.logDebug(stored.selfId, 'QQBot私聊模拟ICQQ data', e)
    await emit(e)
    this.rememberQQBotPrivateEmit(record)
    return true
  }

  /** 已建立 C2C 映射时等待对应 QQBot 事件，避免双适配器重复执行私聊指令。 */
  static async handleQQPrivateMessage (e, emit) {
    if (!this.isPrivateMessage(e) || !this.isNumericQQ(e.user_id) || !this.isNumericQQ(e.self_id) || this.normalizeQQ(e.user_id) === this.normalizeQQ(e.self_id)) return false
    this.load()

    const selfId = this.normalizeQQ(e.self_id)
    const userQQ = this.normalizeQQ(e.user_id)
    const mapped = Object.entries(this.data.users || {}).some(([qqbotSelfId, users]) => {
      if (Bot?.[qqbotSelfId]?.adapter !== 'QQBot') return false
      return Object.values(users || {}).some(user =>
        (user.c2c || !Object.keys(user.groups || {}).length) && this.normalizeQQ(user.qq) === userQQ &&
        (this.getBoundBotQQ(qqbotSelfId) || this.normalizeQQ(user.qq_self_id)) === selfId
      )
    })
    if (!mapped) return false

    const qq = this.createRecord(e, 'qq', emit)
    if (this.findMatchedPrivateRecord(qq, recentQQBotPrivate)) return true
    this.setPending(qq, pendingQQPrivate, async () => await emit(e))
    return true
  }

  static isSamePrivateMessage (a, b) {
    const qqbot = a.source === 'qqbot' ? a : b
    const qq = a.source === 'qq' ? a : b
    return !!(qqbot.raw && qqbot.raw === qq.raw && qqbot.time && qq.time &&
      Math.abs(qqbot.time - qq.time) <= TIME_TOLERANCE &&
      qqbot.userQQ && qqbot.userQQ === qq.userQQ &&
      qqbot.qqSelfId && qqbot.qqSelfId === this.normalizeQQ(qq.selfId))
  }

  static findMatchedPrivateRecord (record, records) {
    for (const candidate of records.values()) {
      if (this.isSamePrivateMessage(record, candidate)) return candidate
    }
    return null
  }

  static rememberQQBotPrivateEmit (record) {
    recentQQBotPrivate.set(record.key, record)
    setTimeout(() => recentQQBotPrivate.delete(record.key), WAIT_MS * 3)
  }

  /** 通知只转换已保存的身份，不进入消息配对队列，也不构造 message 字段。 */
  static applyQQBotGroupNoticeMapping (e) {
    const selfId = String(e.self_id || '')
    if (!this.isGroupEnabled(selfId, e.group_openid)) return false
    const groupOpenid = this.normalizeOpenid(e.group_openid, selfId)
    const group = this.data.groups[selfId]?.[groupOpenid]
    const groupQQ = this.normalizeQQ(group?.group_qq)
    if (!groupQQ) return false

    const botQQ = this.getEffectiveQQSelfId(selfId, group)
    const memberOpenid = this.normalizeOpenid(e.member_openid || e.user_id, selfId)
    const operatorOpenid = this.normalizeOpenid(e.operator_openid, selfId)
    const userQQ = e.qqbot_is_robot_change ? botQQ : this.normalizeQQ(this.data.users[selfId]?.[memberOpenid]?.qq)
    const operatorQQ = this.normalizeQQ(this.data.users[selfId]?.[operatorOpenid]?.qq)
    e.qqbot_self_id = selfId
    e.qqbot_appid = selfId
    e.qqbot_bot = e.bot
    e.openid_group_id = e.group_id
    e.openid_user_id = e.user_id
    e.openid_operator_id = e.operator_id
    e.group_id = groupQQ
    e.group = { ...e.group, group_id: groupQQ }
    if (group.group_name) e.group_name = group.group_name
    if (userQQ) e.user_id = userQQ
    if (operatorQQ) e.operator_id = operatorQQ
    if (e.member && userQQ) e.member = { ...e.member, group_id: groupQQ, user_id: userQQ }
    if (botQQ) {
      e.self_id = botQQ
      e.uin = botQQ
      e.bot = this.withQQBotAdapterMarker(this.ensureQQSelfBotAlias({
        qq_self_id: botQQ, qqbot_self_id: selfId, qqbot_bot: e.qqbot_bot
      }), e.qqbot_bot, botQQ)
      e.adapter = group.qq_adapter || 'OneBotV11'
    }
    return true
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

    const qqbot = this.createRecord(e, 'qqbot', emit)
    const stored = this.applyStoredMapping(e)

    if (stored.user && stored.group) {
      qqbot.userQQ = this.normalizeQQ(e.user_id)
      qqbot.groupQQ = this.normalizeQQ(e.group_id)
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
      if (fallbackStored.applied) this.logDebug(qqbot.selfId, 'QQBot模拟ICQQ data', qqbot.event)
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
    if (this.findMatchedRecord(qq, recentQQBot)) return true

    const qqbot = this.findMatchedRecord(qq, pendingQQBot)
    if (qqbot) {
      this.clearRecord(qqbot, pendingQQBot)
      await this.bindAndEmit(qqbot, qq)
      return true
    }

    if (this.hasStoredMappingForQQRecord(qq)) return true

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
      group_name: qq.groupName,
      qq_self_id: qq.selfId,
      qq_adapter: qq.event?.adapter || qq.event?.bot?.adapter || ''
    })
    const mentionMappings = this.bindMentionMappings(qqbot, qq)

    this.applyQQMapping(qqbot.event, {
      qq: mapping.qq || qq.userQQ,
      group_qq: mapping.group_qq || qq.groupQQ,
      nickname: qq.nickname || qqbot.nickname,
      mentions: mentionMappings,
      group_name: qq.groupName,
      qq_self_id: mapping.qq_self_id || qq.selfId,
      qq_adapter: mapping.qq_adapter || qq.event?.adapter || qq.event?.bot?.adapter || '',
      source_event: qq.event
    })
    this.logDebug(qqbot.selfId, 'QQBot模拟ICQQ data', qqbot.event)

    lain.info(qqbot.selfId, `QQBot身份映射: 群 ${mapping.group_openid}=>${mapping.group_qq} 用户 ${mapping.user_openid}=>${mapping.qq}`)
    await qqbot.emit(qqbot.event)
    this.rememberQQBotEmit(this.createRecord(qqbot.event, 'qqbot', qqbot.emit))
  }

  static applyQQMapping (e, mapping) {
    const qq = this.normalizeQQ(mapping.qq)
    const groupQQ = this.normalizeQQ(mapping.group_qq)
    const mentions = mapping.mentions || {}
    const openidUserId = e.openid_user_id || e.user_id
    const openidGroupId = e.openid_group_id || e.group_id

    this.applyICQQEventShape(e, mapping, { openidUserId, openidGroupId })

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
      e.sender.nickname = e.sender.nickname || mapping.nickname
      if (!mapping.source_event || e.sender.card == null) e.sender.card = e.sender.card || mapping.nickname
    }

    this.fillICQQIdentityFields(e, { qq, groupQQ, nickname: mapping.nickname })
    this.applyAtMappings(e, mentions)
    this.removeSelfAtSegment(e)
    this.finalizeICQQMessageFields(e)
    this.attachICQQRuntimeApis(e, { qq, groupQQ, openidGroupId })
    this.cacheBotRoute(e, qq, groupQQ, openidUserId, openidGroupId)
  }

  static applyICQQEventShape (e, mapping = {}, context = {}) {
    const source = mapping.source_event || null
    const qqAdapter = String(mapping.qq_adapter || source?.adapter || source?.bot?.adapter || '').trim()
    const originalSelfId = String(e.qqbot_self_id || e.qqbot_appid || e.self_id || e.bot?.config?.appid || '')
    const qqSelfId = this.getEffectiveQQSelfId(originalSelfId, mapping, source)

    e.qqbot_self_id = originalSelfId
    e.qqbot_appid = originalSelfId
    e.qqbot_adapter = e.qqbot_adapter || e.adapter || 'QQBot'
    e.qqbot_bot = e.qqbot_bot || e.bot
    e.qqbot_message_id = e.qqbot_message_id || e.message_id

    if (source) {
      for (const key of ['time', 'message_id', 'message_seq', 'message_type', 'font', 'sub_type', 'message_format', 'post_type', 'raw_pb', 'group_name']) {
        if (source[key] !== undefined) e[key] = source[key]
      }
      for (const key of ['sender', 'member', 'group']) {
        if (source[key] !== undefined) e[key] = this.clonePlain(source[key])
      }
    }

    if (qqSelfId) {
      e.self_id = qqSelfId
      e.uin = qqSelfId
      e.self = qqSelfId
      e.bot = this.ensureQQSelfBotAlias({
        qq_self_id: qqSelfId,
        qqbot_self_id: originalSelfId,
        bot: Bot?.[qqSelfId] || source?.bot || e.bot,
        qqbot_bot: e.qqbot_bot
      }) || Bot?.[qqSelfId] || source?.bot || e.bot
    }
    e.bot = this.withQQBotAdapterMarker(e.bot, e.qqbot_bot, qqSelfId || originalSelfId)

    if (qqAdapter || qqSelfId) e.adapter = qqAdapter || 'OneBotV11'

    e.post_type = e.post_type || 'message'
    e.message_type = e.message_type || 'group'
    e.sub_type = e.sub_type || 'normal'
    e.message_format = 'array'
    e.font = e.font ?? 14
    e.raw_pb = e.raw_pb ?? ''

    if (mapping.group_name && (!e.group_name || this.isQQBotOpenidText(e.group_name))) {
      e.group_name = mapping.group_name
    }

    if (!e.sender) e.sender = {}
    if (!e.member && e.message_type === 'group') e.member = {}
    if (!e.group && e.message_type === 'group') e.group = {}
  }

  static fillICQQIdentityFields (e, { qq, groupQQ, nickname = '' } = {}) {
    const selfId = this.normalizeQQ(e.self_id || e.uin)
    if (selfId) {
      e.self_id = selfId
      e.uin = selfId
      e.self = selfId
    }

    if (!e.sender) e.sender = {}
    if (qq) {
      e.user_id = qq
      e.sender.user_id = qq
      e.sender.qq = qq
    }
    if (groupQQ) {
      e.group_id = groupQQ
      e.sender.group_id = groupQQ
    }

    const senderName = e.sender.nickname || e.sender.card || nickname || ''
    e.sender.nickname = e.sender.nickname ?? senderName
    e.sender.card = e.sender.card ?? ''
    e.sender.role = e.sender.role || 'member'
    e.sender.level = e.sender.level == null ? '1' : e.sender.level
    e.sender.title = e.sender.title || ''

    if (e.message_type !== 'group') return

    const oldMember = e.member || {}
    const member = {
      group_id: groupQQ || oldMember.group_id,
      user_id: qq || oldMember.user_id,
      nickname: oldMember.nickname || senderName,
      card: oldMember.card ?? e.sender.card ?? '',
      card_or_nickname: oldMember.card_or_nickname || oldMember.card || senderName,
      sex: oldMember.sex || 'unknown',
      age: oldMember.age || 0,
      area: oldMember.area || '',
      level: oldMember.level == null ? e.sender.level : oldMember.level,
      qq_level: oldMember.qq_level || 0,
      join_time: oldMember.join_time || 0,
      last_sent_time: oldMember.last_sent_time || 0,
      title_expire_time: oldMember.title_expire_time || 0,
      unfriendly: oldMember.unfriendly || false,
      card_changeable: oldMember.card_changeable ?? true,
      is_robot: oldMember.is_robot || false,
      shut_up_timestamp: oldMember.shut_up_timestamp || 0,
      role: oldMember.role || e.sender.role || 'member',
      title: oldMember.title || e.sender.title || '',
      uin: oldMember.uin || selfId,
      ...oldMember
    }
    member.group_id = groupQQ || member.group_id
    member.user_id = qq || member.user_id
    member.info = {
      group_id: member.group_id,
      user_id: member.user_id,
      nickname: member.nickname,
      card: member.card,
      card_or_nickname: member.card_or_nickname,
      sex: member.sex,
      age: member.age,
      area: member.area,
      level: member.level,
      qq_level: member.qq_level,
      join_time: member.join_time,
      last_sent_time: member.last_sent_time,
      title_expire_time: member.title_expire_time,
      unfriendly: member.unfriendly,
      card_changeable: member.card_changeable,
      is_robot: member.is_robot,
      shut_up_timestamp: member.shut_up_timestamp,
      role: member.role,
      title: member.title,
      uin: member.uin,
      ...(oldMember.info || {})
    }
    member.info.group_id = member.group_id
    member.info.user_id = member.user_id
    member.is_admin = member.is_admin ?? (member.role === 'admin' || member.role === 'owner')
    member.is_owner = member.is_owner ?? (member.role === 'owner')
    e.member = member

    e.group = {
      ...(e.group || {}),
      name: e.group?.name || e.group_name || String(groupQQ || ''),
      is_admin: e.group?.is_admin ?? false,
      is_owner: e.group?.is_owner ?? false
    }
  }

  static attachICQQRuntimeApis (e, { qq, groupQQ, openidGroupId = '' } = {}) {
    const selfId = this.normalizeQQ(e.self_id || e.uin)
    const bot = selfId ? Bot?.[selfId] : null
    const isGroup = e.message_type === 'group' && !!groupQQ
    const qqbotSelfId = String(e.qqbot_self_id || e.qqbot_appid || '')
    const groupOpenid = openidGroupId || e.openid_group_id || e.qqbot_group_id || ''

    e.isGroup = isGroup
    e.isPrivate = e.message_type === 'private'
    e.at = this.getFirstAtQQ(e.message)
    e.img = this.getImageUrls(e.message)

    if (qq) {
      e.getAvatarUrl = (size = 0) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${qq}`
    }

    if (isGroup) {
      const pickedGroup = typeof bot?.pickGroup === 'function' ? bot.pickGroup(groupQQ) : null
      const qqbotGroup = e.group
      e.group = this.mergeApiObject(e.group, pickedGroup)
      // 消息仍来自 QQBot：这些接口必须保留原始 OpenID 场景，不能被原生 ICQQ 覆盖。
      for (const method of ['recallMsg', 'muteMember', 'getMsg', 'getChatHistory']) {
        if (typeof qqbotGroup?.[method] === 'function') e.group[method] = qqbotGroup[method].bind(qqbotGroup)
      }
      e.group_id = groupQQ
      e.group_name = e.group_name || e.group?.name || String(groupQQ)
      // ICQQ 兼容层也提供异步群权限方法。优先复用原生 QQBot 群对象，
      // 在身份映射路由尚未建立时再直接调用 QQBot 的 bot_state 接口。
      const getGroupState = async () => {
        if (typeof e.group?.getBotState === 'function') return await e.group.getBotState()
        const permissionBot = [
          bot,
          e.qqbot_bot,
          Bot?.[qqbotSelfId]
        ].find(item => typeof item?.getGroupBotState === 'function')
        if (!permissionBot) throw new Error('QQBot 群权限查询失败：缺少 QQBot Bot 实例')
        return await permissionBot.getGroupBotState(groupOpenid || groupQQ)
      }
      e.group.is_admin = async () => {
        const state = await getGroupState()
        return ['admin', 'owner'].includes(state.member_role)
      }
      e.group.is_owner = async () => {
        const state = await getGroupState()
        return state.member_role === 'owner'
      }
      if (this.isMemberListConvertEnabled(qqbotSelfId, groupOpenid)) {
        this.attachCachedMemberApis(e.group, {
          self_id: qqbotSelfId,
          group_openid: groupOpenid,
          group_qq: groupQQ,
          qq_self_id: selfId,
          fallbackBot: bot
        })
      } else {
        // The OneBot member-list API is always safe to serve from bound users.
        // Disabling member-list conversion must not leave a native ICQQ network request here.
        e.group.getMemberMap = async () => this.getCachedGroupMemberMap({
          self_id: qqbotSelfId, group_openid: groupOpenid, group_qq: groupQQ, qq_self_id: selfId
        })
        e.group.getMemberList = async () => Array.from((await e.group.getMemberMap()).values())
      }
      if (typeof e.group?.getChatHistory !== 'function') {
        e.group.getChatHistory = async () => []
      }
      if (typeof e.group?.pickMember !== 'function') {
        e.group.pickMember = userId => bot?.pickMember?.(groupQQ, userId) || {}
      }
    } else if (qq) {
      const pickedFriend = typeof bot?.pickFriend === 'function' ? bot.pickFriend(qq) : null
      // 入站 C2C 的 friend 带有 msg_id 被动回复上下文，不能被 QQ 侧
      // pickFriend 的同名方法覆盖，否则回复会走错适配器。
      e.friend = this.mergeApiObject(pickedFriend, e.friend)
      e.friend.user_id = qq
      e.friend.qqbot_user_id = e.qqbot_user_id || e.openid_user_id
      if (typeof e.friend?.getChatHistory !== 'function') {
        e.friend.getChatHistory = async () => []
      }
    }

    if (!e.source) e.source = this.getReplySource(e)
  }

  static attachCachedMemberApis (group, { self_id, group_openid, group_qq, qq_self_id, fallbackBot } = {}) {
    if (!group) return group

    const getMemberMap = async () => this.getCachedGroupMemberMap({
      self_id,
      group_openid,
      group_qq,
      qq_self_id
    })
    const getMemberList = async () => Array.from((await getMemberMap()).values())
    const pickMember = userId => this.pickCachedGroupMember({
      self_id,
      group_openid,
      group_qq,
      user_id: userId,
      qq_self_id
    }) || fallbackBot?.pickMember?.(group_qq, userId) || {}

    group.getMemberMap = getMemberMap
    group.getMemberList = getMemberList
    group.getMemberInfo = async userId => {
      const member = pickMember(userId)
      return member?.info || member || {}
    }
    group.pickMember = pickMember
    return group
  }

  static mergeApiObject (base, api) {
    return {
      ...(base || {}),
      ...(api || {})
    }
  }

  static withQQBotAdapterMarker (bot, qqbotBot, self_id = '') {
    const rawSelfId = String(self_id || bot?.uin || bot?.self_id || qqbotBot?.uin || qqbotBot?.self_id || '').trim()
    const selfId = this.normalizeQQ(self_id) ||
      this.normalizeQQ(bot?.uin || bot?.self_id) ||
      this.normalizeQQ(qqbotBot?.uin || qqbotBot?.self_id) ||
      rawSelfId
    if (!bot && !qqbotBot && !selfId) return bot

    try {
      const base = bot || qqbotBot || {}
      const wrapper = Object.create(base)
      if (selfId) {
        wrapper.uin = selfId
        wrapper.self_id = selfId
      }
      wrapper.adapter = {
        id: 'QQBot',
        name: 'QQBot',
        raw: bot?.adapter || qqbotBot?.adapter
      }
      wrapper.qqbot_bot = qqbotBot || bot?.qqbot_bot || null
      this.fillMinimalBotFields(wrapper, selfId)
      return wrapper
    } catch {
      const fallback = bot || {
        uin: selfId,
        self_id: selfId,
        adapter: {
          id: 'QQBot',
          name: 'QQBot',
          raw: qqbotBot?.adapter
        },
        qqbot_bot: qqbotBot || null
      }
      this.fillMinimalBotFields(fallback, selfId)
      return fallback
    }
  }

  static fillMinimalBotFields (bot, self_id = '') {
    if (!bot) return bot
    if (self_id) {
      bot.uin = bot.uin || self_id
      bot.self_id = bot.self_id || self_id
    }
    bot.fl = bot.fl || new Map()
    bot.gl = bot.gl || new Map()
    bot.gml = bot.gml || new Map()
    bot.tl = bot.tl || new Map()
    bot.guilds = bot.guilds || new Map()
    bot.stat = bot.stat || { start_time: Date.now() / 1000, recv_msg_cnt: 0 }
    if (typeof bot.getFriendMap !== 'function') bot.getFriendMap = () => bot.fl
    if (typeof bot.getGroupList !== 'function') bot.getGroupList = () => bot.gl
    if (typeof bot.getGuildList !== 'function') bot.getGuildList = () => bot.tl
    if (typeof bot.pickGroup !== 'function') bot.pickGroup = () => ({})
    if (typeof bot.pickFriend !== 'function') bot.pickFriend = () => ({})
    if (typeof bot.pickUser !== 'function') bot.pickUser = userId => bot.pickFriend(userId)
    return bot
  }

  static ensureQQSelfBotAlias ({ qq_self_id, qqbot_self_id = '', bot = null, qqbot_bot = null } = {}) {
    const qqSelfId = this.normalizeQQ(qq_self_id)
    if (!qqSelfId) return bot

    if (Bot?.[qqSelfId]) {
      this.fillMinimalBotFields(Bot[qqSelfId], qqSelfId)
      return Bot[qqSelfId]
    }

    const qqbotSelfId = String(qqbot_self_id || '').trim()
    const base = bot || qqbot_bot || (qqbotSelfId ? Bot?.[qqbotSelfId] : null)
    const alias = this.withQQBotAdapterMarker(base, qqbot_bot || (qqbotSelfId ? Bot?.[qqbotSelfId] : null), qqSelfId)
    if (!alias || !Bot) return alias || bot

    try {
      Bot[qqSelfId] = alias
      if (Array.isArray(Bot.adapter) && !Bot.adapter.includes(String(qqSelfId))) {
        Bot.adapter.push(String(qqSelfId))
      }
    } catch (error) {
      logger.debug('[QQBotIdMap]注册QQ Bot别名失败', error)
    }

    return alias
  }

  static patchQQSelfBotRoute ({ qq_self_id, qqbot_self_id, group_qq, group_openid } = {}) {
    const qqSelfId = this.normalizeQQ(qq_self_id)
    const groupQQ = this.normalizeQQ(group_qq)
    const qqbotSelfId = String(qqbot_self_id || '')
    const groupOpenid = String(group_openid || '').trim()
    if (!qqSelfId || !groupQQ || !qqbotSelfId || !groupOpenid) return false

    const bot = Bot?.[qqSelfId]
    const qqbot = Bot?.[qqbotSelfId]
    if (!bot || !qqbot || typeof qqbot.pickGroup !== 'function') return false

    try {
      if (!bot.__qqbotIdMapRoutes) {
        Object.defineProperty(bot, '__qqbotIdMapRoutes', {
          value: { groups: new Map() },
          enumerable: false,
          configurable: true
        })
      }
      bot.__qqbotIdMapRoutes.groups.set(groupQQ, { qqbotSelfId, groupOpenid })
      this.patchQQSelfBotGetMsg(bot)

      if (bot.__qqbotIdMapPickGroupPatched) return true

      const originalPickGroup = typeof bot.pickGroup === 'function' ? bot.pickGroup.bind(bot) : null
      Object.defineProperty(bot, '__qqbotIdMapPickGroupPatched', {
        value: true,
        enumerable: false,
        configurable: true
      })
      Object.defineProperty(bot, '__qqbotIdMapPickGroup', {
        value: originalPickGroup,
        enumerable: false,
        configurable: true
      })

      bot.pickGroup = groupId => {
        const route = bot.__qqbotIdMapRoutes?.groups?.get(this.normalizeQQ(groupId))
        if (route) {
          const targetBot = Bot?.[route.qqbotSelfId]
          const targetGroup = targetBot?.pickGroup?.(route.groupOpenid)
          if (targetGroup) return targetGroup
        }
        return originalPickGroup ? originalPickGroup(groupId) : {}
      }
      return true
    } catch (error) {
      logger.debug('[QQBotIdMap]绑定QQ Bot路由失败', error)
      return false
    }
  }

  static patchQQSelfBotGetMsg (bot) {
    if (!bot || bot.__qqbotIdMapGetMsgPatched || typeof bot.getMsg !== 'function') return false

    const originalGetMsg = bot.getMsg.bind(bot)
    Object.defineProperty(bot, '__qqbotIdMapGetMsgPatched', {
      value: true,
      enumerable: false,
      configurable: true
    })
    Object.defineProperty(bot, '__qqbotIdMapGetMsg', {
      value: originalGetMsg,
      enumerable: false,
      configurable: true
    })

    bot.getMsg = async (...args) => {
      try {
        return await originalGetMsg(...args)
      } catch (error) {
        if (String(error?.message || error).includes('client not online')) return null
        throw error
      }
    }
    return true
  }

  static getFirstAtQQ (message) {
    const item = Array.isArray(message) ? message.find(item => item?.type === 'at') : null
    return this.normalizeQQ(item?.qq || item?.id || item?.user_id || item?.data?.qq || item?.data?.id || item?.data?.user_id) || undefined
  }

  static getImageUrls (message) {
    if (!Array.isArray(message)) return []
    return message
      .filter(item => item?.type === 'image')
      .map(item => item.url || item.file || item.data?.url || item.data?.file)
      .filter(Boolean)
  }

  static getReplySource (e) {
    const reply = Array.isArray(e.message) ? e.message.find(item => item?.type === 'reply') : null
    const id = reply?.id || reply?.data?.id
    if (!id) return e.source
    return {
      id,
      seq: this.normalizeQQ(id) || id,
      time: this.normalizeQQ(id) || id
    }
  }

  static bindMentionMappings (qqbot, qq) {
    const ret = {}
    const count = Math.min(qqbot.ats.length, qq.ats.length)
    for (let index = 0; index < count; index++) {
      const userOpenid = this.normalizeOpenid(qqbot.ats[index]?.id, qqbot.selfId)
      const userQQ = this.normalizeQQ(qq.ats[index]?.id)
      if (!userOpenid || !userQQ) continue

      const mapping = this.bind({
        self_id: qqbot.selfId,
        user_openid: userOpenid,
        group_openid: qqbot.groupOpenid,
        qq: userQQ,
        group_qq: qq.groupQQ,
        nickname: qq.ats[index]?.text || qqbot.ats[index]?.text || '',
        group_name: qq.groupName,
        qq_self_id: qq.selfId,
        qq_adapter: qq.event?.adapter || qq.event?.bot?.adapter || ''
      })
      if (mapping?.qq) ret[userOpenid] = mapping.qq
    }
    return ret
  }

  static getStoredAtMappings (e, self_id, groupOpenid) {
    const mentions = {}
    for (const item of this.getAtList(e, 'qqbot')) {
      const userOpenid = this.normalizeOpenid(item.id, self_id)
      if (!userOpenid) continue

      const user = this.data.users[self_id]?.[userOpenid]
      const qq = this.normalizeQQ(user?.qq)
      if (!qq || !user?.groups?.[groupOpenid]) continue
      mentions[userOpenid] = qq
    }

    return mentions
  }

  static applyAtMappings (e, mentions = {}) {
    if (!mentions || !Object.keys(mentions).length) return

    const selfId = e.qqbot_self_id || e.qqbot_appid || e.self_id || ''
    if (Array.isArray(e.message)) {
      e.message = this.convertAtMessage(e.message, mentions, selfId)
    }

    e.raw_message = this.convertAtText(e.raw_message, mentions, selfId)

    if (Array.isArray(e.message) && this.hasAtSegment(e.message)) {
      const raw = this.buildRawMessageFromSegments(e.message)
      if (raw) e.raw_message = raw
    }

    // ⭐ 新增：清理 @数字ID 结构
    const cleanText = (text) => {
      if (!text) return text
      return text.replace(/@\d+/g, '') // 去掉 @3889011960 这种
    }

    const finalMsg = cleanText(e.raw_message)

    // 关键：写入 msg 时用清理后的文本
    if (Object.getOwnPropertyDescriptor(e, 'msg')?.set) {
      e.msg = finalMsg
    }
  }

  static finalizeICQQMessageFields (e) {
    if (!Array.isArray(e.message)) e.message = []
    for (const item of e.message) {
      if (item && item.text === undefined) item.text = ''
    }

    if (this.hasAtSegment(e.message)) {
      const raw = this.buildRawMessageFromSegments(e.message)
      if (raw) {
        e.raw_message = raw
        e.log_message = raw
        if (Object.getOwnPropertyDescriptor(e, 'msg')?.set) e.msg = this.buildMsgTextFromSegments(e.message) || raw
      }
    } else {
      e.raw_message = String(e.raw_message || e.msg || '').trim()
      e.log_message = e.log_message || e.raw_message
    }
  }

  /**
   * 机器人 @ 已在 QQBot 入口转换为 atme 标记并用于消息放行。
   * ICQQ 兼容层只应向插件传递其他人的 @，否则重建 raw_message 时会把机器人本身带回命令文本。
   */
  static removeSelfAtSegment (e) {
    if (!Array.isArray(e.message)) return

    const selfIds = new Set([
      e.self_id,
      e.uin,
      e.self,
      e.qqbot_self_id,
      e.qqbot_appid,
      e.tiny_id,
      e.data?.self_id,
      e.bot?.uin,
      e.bot?.self_id
    ].map(id => this.normalizeQQ(id)).filter(Boolean).map(String))

    if (!selfIds.size) return

    e.message = e.message.filter(item => {
      if (item?.type !== 'at') return true
      const ids = [item.qq, item.id, item.user_id, item.data?.qq, item.data?.id, item.data?.user_id]
        .map(id => this.normalizeQQ(id))
        .filter(Boolean)
        .map(String)
      return !ids.some(id => selfIds.has(id))
    })
  }

  static hasAtSegment (message) {
    return Array.isArray(message) && message.some(item => item?.type === 'at')
  }

  static buildRawMessageFromSegments (message) {
    if (!Array.isArray(message)) return ''
    return message.map(item => {
      if (!item) return ''
      if (item.type === 'at') return `@${item.qq || item.id || item.user_id || item.data?.qq || ''}`
      if (item.type === 'text') return item.text || item.data?.text || ''
      if (item.type === 'face') return `[${item.text || item.name || item.id || item.data?.id || '表情'}]`
      if (item.type === 'image') return '[图片]'
      if (item.type === 'record' || item.type === 'audio') return '[语音]'
      if (item.type === 'video') return '[视频]'
      if (item.type === 'file') return '[文件]'
      return item.text || item.data?.text || ''
    }).join('')
  }

  static buildMsgTextFromSegments (message) {
    if (!Array.isArray(message)) return ''
    return message
      .filter(item => item?.type !== 'at' && item?.type !== 'reply')
      .map(item => item?.type === 'text' ? item.text || item.data?.text || '' : item?.text || item?.data?.text || '')
      .join('')
      .trim()
  }

  static convertAtMessage (message, mentions, selfId = '') {
    const ret = []
    for (const item of message) {
      if (item?.type === 'at') {
        const id = this.normalizeOpenid(item.member_openid || item.user_openid || item.qq || item.id || item.user_id || item.data?.member_openid || item.data?.user_openid || item.data?.qq || item.data?.id || item.data?.user_id, selfId)
        const qq = this.normalizeQQ(mentions[id])
        ret.push(qq ? this.normalizeAtSegment({ ...item, qq, id: qq, user_id: qq, text: item.text || '' }, qq) : item)
        continue
      }

      if (item?.type === 'text') {
        ret.push(...this.convertAtTextSegment(item, mentions, selfId))
        continue
      }

      ret.push(item)
    }
    return ret
  }

  static convertAtTextSegment (item, mentions, selfId = '') {
    const text = String(item.text || item.data?.text || '')
    const parts = this.splitAtText(text, mentions, selfId)
    if (parts.length === 1 && parts[0].type === 'text') return [{ ...item, text: parts[0].text }]
    return parts.map(part => part.type === 'text' ? { type: 'text', text: part.text } : this.normalizeAtSegment({ type: 'at', qq: part.qq, text: '' }, part.qq))
  }

  static splitAtText (text, mentions, selfId = '') {
    const ret = []
    const regex = /<@!?([^>]+)>/g
    let lastIndex = 0
    let match
    while ((match = regex.exec(text))) {
      if (match.index > lastIndex) ret.push({ type: 'text', text: text.slice(lastIndex, match.index) })
      const openid = this.normalizeOpenid(match[1], selfId)
      const qq = this.normalizeQQ(mentions[openid])
      ret.push(qq ? { type: 'at', qq } : { type: 'text', text: match[0] })
      lastIndex = regex.lastIndex
    }
    if (lastIndex < text.length) ret.push({ type: 'text', text: text.slice(lastIndex) })
    return ret
  }

  static convertAtText (text, mentions, selfId = '') {
    if (!text) return text
    return this.splitAtText(String(text), mentions, selfId)
      .map(item => item.type === 'at' ? `@${item.qq}` : item.text)
      .join('')
  }

  static normalizeAtSegment (item, qq = item?.qq) {
    qq = this.normalizeQQ(qq || item?.id || item?.user_id || item?.data?.qq || item?.data?.id || item?.data?.user_id)
    if (!qq) return item
    return {
      ...item,
      type: 'at',
      qq,
      id: qq,
      user_id: qq,
      text: item?.text || '',
      data: {
        ...(item?.data || {}),
        qq
      },
      at: qq
    }
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

  static setGroupFeature ({ self_id, group_openid, feature, enabled, group_qq = '', group_name = '' }) {
    this.load()
    self_id = String(self_id || '')
    feature = String(feature || '').trim()
    const groupOpenid = this.normalizeOpenid(group_openid, self_id)
    if (!self_id || !groupOpenid || !feature) return null

    if (!this.data.features) this.data.features = {}
    if (!this.data.features[self_id]) this.data.features[self_id] = {}
    const old = this.data.features[self_id][groupOpenid] || {}
    const features = {
      ...(old.features || {}),
      [feature]: !!enabled
    }
    const now = Date.now()

    this.data.features[self_id][groupOpenid] = {
      group_openid: groupOpenid,
      group_qq: this.normalizeQQ(group_qq) || old.group_qq || null,
      group_name: group_name || old.group_name || '',
      features,
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
      ...this.data.features[self_id][groupOpenid],
      feature,
      enabled: features[feature],
      saved
    }
  }

  static isGroupEnabled (self_id, group_openid) {
    this.load()
    self_id = String(self_id || '')
    const groupOpenid = this.normalizeOpenid(group_openid, self_id)
    return !!this.data.enabled_groups[self_id]?.[groupOpenid]?.enabled
  }

  static isGroupFeatureEnabled (self_id, group_openid, feature, defaultEnabled = false) {
    this.load()
    self_id = String(self_id || '')
    feature = String(feature || '').trim()
    const groupOpenid = this.normalizeOpenid(group_openid, self_id)
    if (!self_id || !groupOpenid || !feature) return false

    const value = this.data.features?.[self_id]?.[groupOpenid]?.features?.[feature]
    return value == null ? !!defaultEnabled : !!value
  }

  static isMemberListConvertEnabled (self_id, group_openid) {
    if (!self_id || !group_openid) return false
    return this.isGroupFeatureEnabled(self_id, group_openid, 'member_list', this.isGroupEnabled(self_id, group_openid))
  }

  static getCachedGroupMemberMap ({ self_id, group_openid, group_qq = '', qq_self_id = '' } = {}) {
    this.load()
    self_id = String(self_id || '')
    if (!self_id) return new Map()

    const groupOpenid = this.resolveGroupOpenid(self_id, group_openid, group_qq)
    if (!groupOpenid) return new Map()

    const group = this.data.groups[self_id]?.[groupOpenid] || {}
    const groupQQ = this.normalizeQQ(group_qq) || this.normalizeQQ(group.group_qq)
    const qqSelfId = this.normalizeQQ(qq_self_id) || this.getBoundBotQQ(self_id) || this.normalizeQQ(group.qq_self_id)
    const ret = new Map()

    for (const user of Object.values(this.data.users[self_id] || {})) {
      const qq = this.normalizeQQ(user?.qq)
      const userGroup = user?.groups?.[groupOpenid]
      if (!qq || !userGroup) continue

      ret.set(qq, this.createCachedMember(user, userGroup, {
        groupQQ,
        groupOpenid,
        qqSelfId
      }))
    }

    return ret
  }

  static pickCachedGroupMember ({ self_id, group_openid, group_qq = '', user_id, qq_self_id = '' } = {}) {
    const qq = this.normalizeQQ(user_id)
    if (!qq) return null
    return this.getCachedGroupMemberMap({
      self_id,
      group_openid,
      group_qq,
      qq_self_id
    }).get(qq) || null
  }

  static createCachedMember (user, userGroup = {}, { groupQQ, groupOpenid, qqSelfId } = {}) {
    const userId = this.normalizeQQ(user.qq)
    const nickname = user.nickname || ''
    const groupId = groupQQ || userGroup.group_qq || null
    const role = userGroup.role || 'member'
    const member = {
      group_id: groupId,
      user_id: userId,
      nickname,
      card: userGroup.card || '',
      card_or_nickname: userGroup.card || nickname,
      sex: 'unknown',
      age: 0,
      area: '',
      level: '1',
      qq_level: 0,
      join_time: 0,
      last_sent_time: Math.floor((user.updated_at || userGroup.updated_at || Date.now()) / 1000),
      title_expire_time: 0,
      unfriendly: false,
      card_changeable: true,
      is_robot: false,
      shut_up_timestamp: 0,
      role,
      title: '',
      uin: qqSelfId || null,
      qqbot_user_id: user.user_openid,
      qqbot_group_id: groupOpenid
    }

    member.is_admin = role === 'admin' || role === 'owner'
    member.is_owner = role === 'owner'
    member.info = { ...member }
    member.getAvatarUrl = (size = 0) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${userId}`
    member.getInfo = async () => member.info
    member.sendMsg = async msg => Bot?.[qqSelfId]?.pickFriend?.(userId)?.sendMsg?.(msg)
    return member
  }

  static resolveGroupOpenid (self_id, group_openid = '', group_qq = '') {
    const openid = String(group_openid || '').trim()
    if (openid && !this.isNumericQQ(openid)) return this.normalizeOpenid(openid, self_id)

    const groupQQ = this.normalizeQQ(group_qq) || this.normalizeQQ(openid)
    if (!groupQQ) return openid ? this.normalizeOpenid(openid, self_id) : ''

    const group = this.findGroupByQQ(self_id, groupQQ)
    return group?.group_openid || ''
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
        this.patchQQSelfBotRoute({
          qq_self_id: self_id,
          qqbot_self_id: e.qqbot_self_id || e.qqbot_appid,
          group_qq: groupQQ,
          group_openid: openidGroupId
        })
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
      raw: this.getComparableRaw(e),
      nickname: this.getNickname(e),
      groupName: e.group_name || e.data?.group_name || '',
      time: this.normalizeRecordTime(e.time || e.timestamp || e.data?.timestamp),
      userQQ: this.normalizeQQ(e.user_id),
      groupQQ: this.normalizeQQ(e.group_id),
      userOpenid: e.user_openid || e.member_openid || e.sender?.user_openid || e.sender?.member_openid || e.user_id,
      groupOpenid: e.group_openid || e.sender?.group_openid || e.group_id,
      ats: this.getAtList(e, source),
      timer: null
    }
  }

  static normalizeRecordTime (value) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number > 1e12 ? number / 1000 : number
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed / 1000 : 0
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
      if (!user?.groups?.[group.group_openid]) return false

      // At-target mappings are partial: a converted sender may mention an
      // unmapped user, and that must not let the corresponding QQ event through
      // as a duplicate.
      return true
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

  static findUserByQQ (self_id, qq, { groupOpenid = '', groupQQ = '', preferPrivate = false } = {}) {
    this.load()
    const userQQ = this.normalizeQQ(qq)
    if (!userQQ) return null

    groupOpenid = groupOpenid ? this.normalizeOpenid(groupOpenid, self_id) : ''
    const group = groupOpenid ? null : this.findGroupByQQ(self_id, groupQQ)
    const currentGroupOpenid = groupOpenid || group?.group_openid || ''

    const users = Object.values(this.data.users[self_id] || {}).filter(user => user.qq === userQQ)
    if (preferPrivate) {
      return users.find(user => user.c2c) ||
        users.find(user => !Object.keys(user.groups || {}).length) || null
    }
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

  static isPrivateMessage (e) {
    return e?.post_type === 'message' && e?.message_type === 'private' && e?.user_id
  }

  static isQQBotSelfMessage (e) {
    return !!(e?.author?.bot || e?.data?.author?.bot)
  }

  static normalizeOpenid (value, self_id) {
    const text = String(value || '').trim()
    if (!text) return ''
    const prefix = self_id ? `${self_id}-` : ''
    if (prefix && text.startsWith(prefix)) return text
    return prefix ? `${prefix}${text}` : text
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

  static stripSelfId (value, self_id = '') {
    const text = String(value || '').trim()
    const prefix = self_id ? `${self_id}-` : ''
    return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text
  }

  static normalizeMappedOpenid (value) {
    return String(value || '').trim()
  }

  static isQQBotOpenidText (value) {
    return /^\d+-[^\s]+$/.test(String(value || '').trim())
  }

  static clonePlain (value) {
    if (value == null || typeof value !== 'object') return value
    try {
      return JSON.parse(JSON.stringify(value, (key, item) => {
        if (typeof item === 'function') return undefined
        return item
      }))
    } catch {
      return Array.isArray(value) ? [...value] : { ...value }
    }
  }

  static normalizeText (text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
  }

  static getAtList (e, source = '') {
    const message = Array.isArray(e.message) ? e.message : Array.isArray(e.data?.message) ? e.data.message : []
    const ret = []

    for (const item of message) {
      if (item?.type === 'at') {
        const id = item.member_openid || item.user_openid || item.qq || item.id || item.user_id || item.data?.member_openid || item.data?.user_openid || item.data?.qq || item.data?.id || item.data?.user_id
        if (id != null) ret.push({ id: String(id), text: String(item.text || item.data?.text || '') })
        continue
      }

      if (source === 'qqbot' && item?.type === 'text') {
        const text = String(item.text || item.data?.text || '')
        for (const match of text.matchAll(/<@!?([^>]+)>/g)) {
          ret.push({ id: match[1], text: '' })
        }
      }
    }

    if (source === 'qqbot' && !ret.length) {
      const text = String(e.data?.content || e.raw_message || e.msg || '')
      for (const match of text.matchAll(/<@!?([^>]+)>/g)) {
        ret.push({ id: match[1], text: '' })
      }
    }

    return ret
  }

  static getComparableRaw (e) {
    const message = Array.isArray(e.message) ? e.message : Array.isArray(e.data?.message) ? e.data.message : []
    const hasAt = message.some(item => item?.type === 'at')

    if (hasAt && message.every(item => item?.type === 'at' || item?.type === 'text')) {
      const text = message
        .filter(item => item?.type !== 'at')
        .map(item => this.getComparableSegmentText(item))
        .join('')
      const normalized = this.normalizeText(text)
      if (normalized) return normalized
    }

    let raw = this.normalizeText(e.data?.raw_message || e.data?.content || e.raw_message || e.msg)
      .replace(/<@!?[^>]+>/g, '')
      .trim()
    if (!hasAt) return raw

    for (const item of message) {
      if (item?.type !== 'at') continue
      const id = String(item.qq || item.id || item.user_id || item.data?.qq || item.data?.id || item.data?.user_id || '').trim()
      const text = String(item.text || item.data?.text || '').trim()
      if (id) raw = raw.replace(new RegExp(`@${this.escapeRegExp(id)}\\s*`, 'g'), '')
      if (text) raw = raw.replace(new RegExp(`@${this.escapeRegExp(text)}\\s*`, 'g'), '')
    }
    return this.normalizeText(raw)
  }

  static getComparableSegmentText (item) {
    if (!item) return ''
    if (item.type === 'text') return item.text || item.data?.text || ''
    return `[${item.type}]`
  }

  static escapeRegExp (text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
