import { exec } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import sizeOf from 'image-size'
import lodash from 'lodash'
import fetch from 'node-fetch'
import path from 'path'
import moment from 'moment'
import wasm from 'silk-wasm';
const { encode, isSilk } = wasm;
import Yaml from 'yaml'
import MiaoCfg from '../../../../lib/config/config.js'
import loader from '../../../../lib/plugins/loader.js'
import common from '../../lib/common/common.js'
import Cfg from '../../lib/config/config.js'
import Button from './plugins.js'
import QQBotButton from './Button.js'
import C2CStream from './C2CStream.js'
import QQBotIdMap from '../../model/qqbot-id-map.js'
import { installQQBotAPIPolicy, normalizeRestrictedAPIError } from './APIPolicy.js'

lain.DAU = {}

const MESSAGE_CACHE_TTL = 12 * 60 * 60
const nextQQBotMessageSeq = () => ((Date.now() % 100000000) ^ Math.floor(Math.random() * 65536)) % 65536

export default class adapterQQBot {
  /** 传入基本配置 */
  constructor(sdk, start) {
    /** 开发者id */
    this.id = String(sdk.config.appid)
    /** sdk */
    this.sdk = sdk
    installQQBotAPIPolicy(sdk)
    /** 基本配置 */
    this.config = sdk.config
    /** bot_state 仅 30 QPM；短时间内复用同一群的查询结果。 */
    this.groupBotStateCache = new Map()

    /** 监听事件 */
    if (!start) this.StartBot()
  }

  async StartBot() {
    /** 群消息 */
    this.sdk.on('message.group', async (data) => {
      if (await this.isDuplicateMessage(data, 'group')) return
      data = await this.message(data, true)
      if (data) {
        await QQBotIdMap.handleQQBotGroupMessage(data, async e => {
          QQBotIdMap.logDebug(this.id, 'QQBot传入云崽message.group', e)
          await Bot.emit('message.group', e)
          await Bot.emit('message', e)
        })
      }
    })
    /** 私聊消息 */
    this.sdk.on('message.private.friend', async (data) => {
      if (await this.isDuplicateMessage(data, 'private')) return
      data = await this.message(data)
      if (data) {
        await QQBotIdMap.handleQQBotPrivateMessage(data, async e => {
          await Bot.emit('message.private', e)
          await Bot.emit('message', e)
        })
      }
    })

    /** 用户申请加入机器人所在群，转换为 YunZai/icqq request.group.add 事件。 */
    this.sdk.on('request.group.add', async data => {
      await this.handleGroupJoinRequest(data)
    })

    /** 按钮交互事件（回调/表单） */
    this.sdk.on('interaction', async (event) => {
      await this.handleInteraction(event)
    })

    /** 群/好友通知：SDK 仅产生日志，适配器需要转发给 YunZai 和 OneBot */
    for (const event of [
      'notice.group.increase',
      'notice.group.decrease',
      'notice.group.receive_open',
      'notice.group.receive_close',
      'notice.friend.increase',
      'notice.friend.decrease',
      'notice.friend.receive_open',
      'notice.friend.receive_close',
    ]) {
      this.sdk.on(event, async data => {
        await this.handleNotice(event, data)
      })
    }

    // 有点怪 先简单处理下
    let id, avatar, username
    try {
      const info = await this.sdk.getSelfInfo()
      id = info.id
      avatar = info.avatar
      username = info.username
    } catch {
      id = this.id
      avatar = 'https://cdn.jsdelivr.net/gh/Zyy955/imgs/img/202402020757587.gif'
      username = 'QQBot'
    }

    /** miao-plugin 风格 Button API */
    if (!Bot.Button.create) {
      Bot.Button.create = QQBotButton.create
      Bot.Button.nav = QQBotButton.nav
      Bot.Button.isButton = QQBotButton.isButton
      Bot.Button.extract = QQBotButton.extract
    }

    Bot[this.id] = {
      sdk: this.sdk,
      config: this.config,
      bkn: 0,
      avatar,
      adapter: 'QQBot',
      uin: this.id,
      tiny_id: id,
      fl: new Map(),
      gl: new Map(),
      tl: new Map(),
      gml: new Map(),
      guilds: new Map(),
      nickname: username,
      stat: { start_time: Date.now() / 1000, recv_msg_cnt: 0 },
      apk: Bot.lain.adapter.QQBot.apk,
      version: Bot.lain.adapter.QQBot.version,
      getFriendMap: () => Bot[this.id].fl,
      getGroupList: () => Bot[this.id].gl,
      getGuildList: () => Bot[this.id].tl,
      // 与 OneBotV11 适配器保持一致：此入口始终是主动私聊发送。
      sendPrivateMsg: async (userId, msg) => await this.sendFriendMsg(userId, msg),
      /** 从 QQBot 半天消息缓存中读取消息，兼容 ICQQ 的 getMsg。 */
      getMsg: async (messageId) => await this.getCachedMessageById(messageId),
      readMsg: async () => common.recvMsg(this.id, 'QQBot', true),
      MsgTotal: async (type) => common.MsgTotal(this.id, 'QQBot', type, true),
      pickGroup: (groupID) => this.pickGroup(groupID),
      pickUser: (userId) => this.pickFriend(userId),
      pickFriend: (userId) => this.pickFriend(userId),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getGroupMemberInfo: (group_id, user_id) => Bot.getGroupMemberInfo(group_id, user_id),
      /** QQ Bot v2 群管理：群禁言与入群自动审批策略。 */
      getGroupMuteStatus: async groupId => await this.getGroupMuteStatus(groupId),
      getGroupBotState: async (groupId, options) => await this.getGroupBotState(groupId, options),
      setGroupMemberMute: async (groupId, userId, duration) => await this.setGroupMemberMute(groupId, userId, duration),
      setGroupMemberMutes: async (groupId, members) => await this.setGroupMemberMutes(groupId, members),
      getGroupJoinRequests: async (groupId, options) => await this.getGroupJoinRequests(groupId, options),
      approveGroupJoinRequest: async (groupId, memberId, approve, options) => await this.approveGroupJoinRequest(groupId, memberId, approve, options),
      setGroupAddRequest: async (groupId, memberId, approve, reason, options) => await this.approveGroupJoinRequest(groupId, memberId, approve, { ...options, reject_reason: reason }),
      getJoinApprovalStrategies: async options => await this.getJoinApprovalStrategies(options),
      createJoinApprovalStrategy: async strategy => await this.createJoinApprovalStrategy(strategy),
      updateJoinApprovalStrategy: async (strategyId, strategy) => await this.updateJoinApprovalStrategy(strategyId, strategy),
      deleteJoinApprovalStrategy: async strategyId => await this.deleteJoinApprovalStrategy(strategyId),
      executeJoinApprovalStrategy: async strategyId => await this.executeJoinApprovalStrategy(strategyId),
      updateJoinApprovalWhitelist: async (strategyId, op, users) => await this.updateJoinApprovalWhitelist(strategyId, op, users)
    }
    /** 加载缓存中的群列表 */
    this.gmlList('gl')
    /** 加载缓存中的好友列表 */
    this.gmlList('fl')
    /** 保存id到adapter */
    if (!Bot.adapter.includes(String(this.id))) Bot.adapter.push(String(this.id))
    /** 初始化dau统计 */
    if (Cfg.Other.QQBotdau) lain.DAU[this.id] = await this.getDAU()
    /** 重启 */
    await common.init('Lain:restart:QQBot')
    return `QQBot：[${username}(${this.id})] 连接成功!`
  }

  /** 将 QQBot 群/C2C 通知转换为 YunZai/OneBot 通知事件 */
  async handleNotice (event, data = {}) {
    const [, scene = '', subType = ''] = String(event).split('.')
    const isGroup = scene === 'group'
    const rawGroupId = data.group_id || data.group_openid
    const isRobotChange = isGroup && ['increase', 'decrease'].includes(subType) &&
      (['GROUP_ADD_ROBOT', 'GROUP_DEL_ROBOT'].includes(data.qqbot_event_type) ||
        (!data.member_openid && !['GROUP_MEMBER_ADD', 'GROUP_MEMBER_REMOVE'].includes(data.qqbot_event_type)))
    const rawUserId = isGroup
      ? (isRobotChange ? undefined : data.member_openid || data.user_id)
      : data.user_id || data.openid || data.operator_id
    const rawOperatorId = data.operator_id || data.op_member_openid
    const groupId = isGroup ? this.formatQQBotId(rawGroupId) : undefined
    if (isGroup && (!groupId || (!isRobotChange &&
      ['increase', 'decrease'].includes(subType) && !rawUserId))) {
      lain.warn(this.id, '[QQBot] 忽略缺少群或成员身份的群通知')
      return false
    }
    const userId = isRobotChange ? this.id : this.formatQQBotId(rawUserId)
    const operatorId = this.formatQQBotId(rawOperatorId)
    const time = Number(data.time || data.timestamp) || Date.now()
    const notice = {
      ...data,
      raw: data,
      post_type: 'notice',
      notice_type: scene,
      sub_type: subType,
      self_id: this.id,
      uin: this.id,
      bot: Bot[this.id],
      time: time > 1e12 ? Math.floor(time / 1000) : time,
      group_id: groupId,
      user_id: userId,
      operator_id: operatorId,
      group_openid: rawGroupId || '',
      user_openid: isGroup ? (data.user_openid ?? '') : rawUserId || '',
      member_openid: data.member_openid || '',
      operator_openid: rawOperatorId || '',
      qqbot_is_robot_change: isRobotChange,
      adapter: 'QQBot',
    }

    if (isGroup && groupId) {
      if (isRobotChange && subType === 'increase') Bot[this.id]?.gl.set(groupId, { group_id: groupId })
      if (isRobotChange && subType === 'decrease') {
        Bot[this.id]?.gl.delete(groupId)
        Bot[this.id]?.gml.delete(groupId)
        this.groupBotStateCache?.delete(this.stripQQBotId(rawGroupId))
      }
      notice.group = this.pickGroup(rawGroupId)
      notice.group.group_id = groupId
      notice.nickname = data.nickname || ''
      if (subType === 'decrease') notice.dismiss = false
      if (rawUserId) {
        notice.member = {
          ...this.pickMember(rawGroupId, rawUserId),
          group_id: groupId,
          user_id: userId,
          nickname: notice.nickname
        }
        if (subType === 'decrease') Bot[this.id]?.gml.get(groupId)?.delete(userId)
      }
      notice.reply = msg => notice.group.sendMsg(msg)
      QQBotIdMap.applyQQBotGroupNoticeMapping(notice)
    } else if (!isGroup && userId) {
      if (subType === 'increase') Bot[this.id]?.fl.set(userId, { user_id: userId })
      if (subType === 'decrease') Bot[this.id]?.fl.delete(userId)
      const canReplyToEvent = subType === 'increase' || subType === 'receive_open'
      notice.friend = this.pickFriend(rawUserId, {
        messageId: '',
        eventId: canReplyToEvent ? data.event_id || '' : ''
      })
      if (data.event_id && canReplyToEvent) {
        notice.reply = async msg => await this.sendFriendMsg(rawUserId, msg, { eventId: data.event_id })
      }
    }

    lain.info(this.id, `${isGroup ? '群' : '好友'}通知 ${subType}: ${rawGroupId || rawUserId || ''}`)
    await Bot.emit(`notice.${scene}`, notice)
    await Bot.emit(event, notice)
    await Bot.emit('notice', notice)
  }

  /**
   * 将 GROUP_JOIN_REQUEST 适配为 icqq/YunZai 的 request.group.add。
   * flag 保留官方 join_request_id，方便第三方插件直接调用 e.approve()。
   */
  async handleGroupJoinRequest (data = {}) {
    const groupOpenid = String(data.group_openid || data.group_id || '').trim()
    const memberOpenid = String(data.member_openid || data.user_id || '').trim()
    if (!groupOpenid || !memberOpenid) {
      lain.warn(this.id, '[QQBot] 忽略不完整的 GROUP_JOIN_REQUEST 事件')
      return false
    }

    const applyAt = new Date(data.apply_at || data.timestamp || Date.now())
    const time = Number.isNaN(applyAt.getTime())
      ? Math.floor(Date.now() / 1000)
      : Math.floor(applyAt.getTime() / 1000)
    const verifyInfo = data.verify_info || {}
    const comment = verifyInfo.verify_message || data.comment || ''
    const request = {
      ...data,
      raw: data,
      post_type: 'request',
      request_type: 'group',
      sub_type: 'add',
      self_id: this.id,
      uin: this.id,
      bot: Bot[this.id],
      adapter: 'QQBot',
      time,
      group_id: this.formatQQBotId(groupOpenid),
      user_id: this.formatQQBotId(memberOpenid),
      group_openid: groupOpenid,
      member_openid: memberOpenid,
      user_openid: memberOpenid,
      flag: data.join_request_id,
      join_request_id: data.join_request_id,
      comment,
      tips: comment,
      group: this.pickGroup(groupOpenid),
      member: this.member(groupOpenid, memberOpenid)
    }
    request.approve = async (approve = true, rejectReason = '', addToMemberBlacklist = false) => {
      return await this.approveGroupJoinRequest(groupOpenid, memberOpenid, approve, {
        join_request_id: data.join_request_id,
        reject_reason: rejectReason,
        add_to_member_blacklist: addToMemberBlacklist
      })
    }

    lain.info(this.id, `用户申请入群: ${data.username || memberOpenid}(${memberOpenid}) -> ${groupOpenid}`)
    await Bot.emit('request.group', request)
    await Bot.emit('request.group.add', request)
    await Bot.emit('request', request)
    return request
  }

  /**
   * 官方可能重复投递相同 msg_id；使用 Redis 跨重启去重，并在 Redis 不可用时
   * 回退到进程内缓存。保留十分钟，覆盖群聊/私聊被动回复的有效窗口。
   */
  async isDuplicateMessage (data, type) {
    const messageId = data?.id || data?.message_id
    if (!messageId) return false

    const now = Date.now()
    this.messageDedup ??= new Map()
    for (const [id, expiresAt] of this.messageDedup) {
      if (expiresAt <= now) this.messageDedup.delete(id)
    }

    const memoryKey = `${type}:${messageId}`
    if (this.messageDedup.has(memoryKey)) {
      lain.debug(this.id, `[QQBot] 忽略重复 ${type} 消息: ${messageId}`)
      return true
    }
    this.messageDedup.set(memoryKey, now + 10 * 60 * 1000)

    try {
      const key = `lain:qqbot:dedup:${this.id}:${type}:${messageId}`
      const result = await redis.set(key, '1', { NX: true, EX: 600 })
      if (result === null) {
        lain.debug(this.id, `[QQBot] 忽略重复 ${type} 消息: ${messageId}`)
        return true
      }
    } catch {
      // Redis 异常时保留内存去重，不影响消息收发。
    }
    return false
  }

  /** 加载缓存中的群、好友列表 */
  async gmlList(type = 'gl') {
    try {
      const List = await redis.keys(`lain:${type}:${this.id}:*`)
      List.forEach(async i => {
        const id = await redis.get(i)
        const info = JSON.parse(id)
        info.uin = this.id
        if (type === 'gl') {
          Bot[this.id].gl.set(id, info)
        } else {
          Bot[this.id].fl.set(id, info)
        }
      })
    } catch { }
  }

  /** 群对象 */
  pickGroup(groupID) {
    return {
      /** 查询机器人在群内是否为管理员；群主同时视为管理员。 */
      is_admin: async () => {
        const state = await this.getGroupBotState(groupID)
        return ['admin', 'owner'].includes(state.member_role)
      },
      /** 查询机器人在群内是否为群主。 */
      is_owner: async () => {
        const state = await this.getGroupBotState(groupID)
        return state.member_role === 'owner'
      },
      recallMsg: async (msg_id) => await this.recallGroupMsg(groupID, msg_id),
      sendMsg: async (msg) => await this.sendGroupMsg(groupID, msg),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getMsg: async (msg_id) => await this.getCachedMessage('group', groupID, msg_id),
      getChatHistory: async (msg_id, num = 1) => await this.getCachedChatHistory('group', groupID, msg_id, num),
      /** OneBot upload_group_file 兼容；QQ群 Bot 不支持目录，folder 参数会被忽略。 */
      fs: {
        upload: async (file, folder = '/', name) => await this.sendGroupFile(groupID, file, name)
      },
      sendFile: async (file, name) => await this.sendGroupFile(groupID, file, name),
      pickMember: (userID) => this.pickMember(groupID, userID),
      /** 戳一戳 */
      pokeMember: async (operatorId) => '',
      /** 禁言。time 为秒数，传 0 可解除禁言。 */
      muteMember: async (userId, time) => await this.setGroupMemberMute(groupID, userId, time),
      /** 查询群禁言状态（含当前被禁言成员）。 */
      getMuteStatus: async () => await this.getGroupMuteStatus(groupID),
      getBotState: async options => await this.getGroupBotState(groupID, options),
      /** 拉取待处理的入群申请列表。 */
      getJoinRequests: async options => await this.getGroupJoinRequests(groupID, options),
      /** 审批入群申请；approve=false 时可通过 options.reject_reason 填写拒绝理由。 */
      approveJoinRequest: async (memberId, approve = true, options) => await this.approveGroupJoinRequest(groupID, memberId, approve, options),
      /** 全体禁言 */
      muteAll: async (type) => Promise.reject(new Error('QQBot未支持')),
      getMemberMap: async () => Promise.reject(new Error('QQBot未支持')),
      /** 退群 */
      quit: async () => Promise.reject(new Error('QQBot未支持')),
      /** 设置管理 */
      setAdmin: async (qq, type) => Promise.reject(new Error('QQBot未支持')),
      /** 踢 */
      kickMember: async (qq, rejectAddRequest = false) => Promise.reject(new Error('QQBot未支持')),
      /** 头衔 **/
      setTitle: async (qq, title, duration) => Promise.reject(new Error('QQBot未支持')),
      /** 修改群名片 **/
      setCard: async (qq, card) => Promise.reject(new Error('QQBot未支持'))
    }
  }

  /** 好友对象 */
  pickFriend(userId, source = {}) {
    const sourceMessageId = source.messageId || source.msgId || source.id || ''
    const sourceEventId = source.eventId || ''
    return {
      sendMsg: async (msg) => await this.sendFriendMsg(userId, msg, { messageId: sourceMessageId, eventId: sourceEventId }),
      recallMsg: async (msg_id) => await this.recallPrivateMsg(userId, msg_id),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getMsg: async (msg_id) => await this.getCachedMessage('user', userId, msg_id),
      getChatHistory: async (msg_id, num = 1) => await this.getCachedChatHistory('user', userId, msg_id, num),
      /** OneBot upload_private_file 兼容。 */
      sendFile: async (file, name) => await this.sendFriendFile(userId, file, name, { messageId: sourceMessageId, eventId: sourceEventId }),
      /** 通过官方 C2C stream_messages 接口发送/更新 Markdown 流。 */
      openStream: (options = {}) => this.openC2CStream(userId, {
        messageId: sourceMessageId,
        ...options
      }),
      /** 通知客户端机器人正在输入；需要来自 C2C 消息的被动回复上下文。 */
      sendInputNotify: (options = {}) => this.sendInputNotify(userId, {
        messageId: sourceMessageId,
        ...options
      }),
      getAvatarUrl: (size = 0) => this.getAvatarUrl(size, userId)
    }
  }

  pickMember(groupID, userID) {
    return {
      member: this.member(groupID, userID),
      getAvatarUrl: (size = 0) => this.getAvatarUrl(size, userID)
    }
  }

  member(groupId, userId) {
    const member = {
      info: {
        group_id: `${this.id}-${groupId}`,
        user_id: `${this.id}-${userId}`,
        nickname: '',
        last_sent_time: ''
      },
      group_id: `${this.id}-${groupId}`,
      is_admin: false,
      is_owner: false,
      /** 获取头像 */
      getAvatarUrl: (size = 0) => this.getAvatarUrl(size, userId),
      /** 禁言当前成员；time 为秒数，传 0 可解除禁言。 */
      mute: async (time) => await this.setGroupMemberMute(groupId, userId, time)
    }
    return member
  }

  getAvatarUrl(size = 0, id) {
    const userId = String(id ?? '').trim()
    if (Number(userId)) return `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${userId}`
    return `https://q.qlogo.cn/qqapp/${this.id}/${this.stripQQBotId(userId)}/${size}`
  }

  stripQQBotId (id) {
    const text = String(id ?? '').trim()
    const prefix = `${this.id}-`
    return text.startsWith(prefix) ? text.slice(prefix.length) : text
  }

  /** 官方 /bot_state：主动推送、接收范围及机器人在群内的身份。 */
  async getGroupBotState (groupId, { fresh = false, required = true } = {}) {
    const groupOpenid = await this.resolveOpenid(groupId, 'group')
    const key = String(groupOpenid)
    const cached = this.groupBotStateCache.get(key)
    if (!fresh && cached && cached.expires > Date.now()) {
      if (cached.error) {
        if (required) throw cached.error
        return null
      }
      return cached.value
    }
    if (cached?.pending) {
      try { return await cached.pending } catch (error) {
        if (required) throw error
        return null
      }
    }
    const pending = this.sdk.request.get(`/v2/groups/${encodeURIComponent(groupOpenid)}/bot_state`)
      .then(({ data }) => {
        if (!data || typeof data.allow_proactive_msg !== 'boolean' || !data.recv_msg_setting || !data.member_role) {
          throw new Error('QQ群状态接口返回字段不完整，无法验证群权限')
        }
        this.groupBotStateCache.set(key, { value: data, expires: Date.now() + 15000 })
        return data
      })
      .catch(error => {
        const wrapped = normalizeRestrictedAPIError(this.sdk, error, {
          method: 'GET', path: `/v2/groups/${encodeURIComponent(groupOpenid)}/bot_state`
        })
        this.groupBotStateCache.set(key, { error: wrapped, expires: Date.now() + 10000 })
        throw wrapped
      })
    this.groupBotStateCache.set(key, { pending })
    try { return await pending } catch (error) {
      if (required) throw error
      return null
    }
  }

  /**
   * 查询群禁言状态。
   * https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_restrict_chat_setting.get.html
   */
  async getGroupMuteStatus (groupId) {
    const groupOpenid = await this.resolveOpenid(groupId, 'group')
    const state = await this.getGroupBotState(groupOpenid)
    if (!['admin', 'owner'].includes(state.member_role)) {
      throw new Error(`QQBot 查询群禁言失败：机器人在群内身份为 ${state.member_role}，需要群管理员权限`)
    }
    const { data } = await this.sdk.request.get(
      `/v2/groups/${encodeURIComponent(groupOpenid)}/restrict_chat_setting`
    )
    return data
  }

  /**
   * 设置一名群成员禁言。duration 为秒数、Date 或 RFC3339 时间；0 表示解除禁言。
   * QQ 官方接口要求机器人是群管理员，且仅能操作普通成员。
   */
  async setGroupMemberMute (groupId, userId, duration) {
    // 以兼容 ICQQ/OneBot 的输入形式交给批量入口，避免在 bot_state、
    // QQ 号映射等网络/异步操作之前就计算 mute_expire_at。
    return await this.setGroupMemberMutes(groupId, [{ user_id: userId, duration }])
  }

  /**
   * 批量设置群成员禁言。members 的元素为 { member_openid, op, mute_expire_at }；
   * 也兼容 { user_id, duration }，方便适配 OneBot 的禁言调用。
   * 不调用官方尚在内邀阶段的群成员详情接口做前置校验，成员权限由禁言接口判定。
   */
  async setGroupMemberMutes (groupId, members) {
    if (!Array.isArray(members) || !members.length) {
      throw new Error('QQBot 设置群成员禁言失败：members 不能为空')
    }
    if (members.length > 20) {
      throw new Error('QQBot 设置群成员禁言失败：单次最多操作 20 名成员')
    }

    const groupOpenid = await this.resolveOpenid(groupId, 'group')
    const state = await this.getGroupBotState(groupOpenid, { fresh: true })
    if (!['admin', 'owner'].includes(state.member_role)) {
      throw new Error(`QQBot 设置群成员禁言失败：机器人在群内身份为 ${state.member_role}，需要群管理员权限`)
    }
    // 禁言兼容 ICQQ/OneBot 的数字 QQ 号。把当前群上下文传给映射表，
    // 同一个 QQ 号在多个群存在不同 OpenID 时也能选中当前群成员。
    const memberResolveContext = {
      self_id: this.id,
      qqbot_self_id: this.id,
      qqbot_appid: this.id,
      bot: Bot[this.id],
      group_id: groupId,
      group_openid: groupOpenid,
      openid_group_id: groupOpenid,
      message_type: 'group'
    }
    const resolvedMembers = await Promise.all(members.map(async member => {
      let operation
      let memberId
      let duration
      if (member?.member_openid && member?.op) {
        operation = {
          op: this.normalizeMemberMuteOp(member.op),
          member_openid: member.member_openid,
          mute_expire_at: member.mute_expire_at ?? ''
        }
        memberId = operation.member_openid
      } else {
        memberId = member?.user_id ?? member?.userId
        duration = member?.duration ?? member?.time
      }
      const memberOpenid = await this.resolveOpenid(memberId, 'user', memberResolveContext)
      return {
        memberOpenid,
        operation,
        duration
      }
    }))

    // 所有权限检查和 ID 映射完成后再计算相对时长，避免网络耗时被计入禁言时间。
    const normalized = resolvedMembers.map(({ memberOpenid, operation, duration }) => operation
      ? { ...operation, member_openid: memberOpenid }
      : {
          ...this.createMemberMuteOperation(memberOpenid, duration),
          member_openid: memberOpenid
        })

    const { data } = await this.sdk.request.post(
      `/v2/groups/${encodeURIComponent(groupOpenid)}/restrict_chat_setting`,
      { members: normalized }
    )
    return data ?? true
  }

  createMemberMuteOperation (userId, duration) {
    const memberOpenid = String(userId ?? '').trim()
    if (!memberOpenid) throw new Error('QQBot 设置群成员禁言失败：缺少成员 OpenID')

    if (duration === 0 || duration === '0' || duration === false || duration == null) {
      return { op: 'del', member_openid: memberOpenid, mute_expire_at: '' }
    }
    return {
      op: 'add',
      member_openid: memberOpenid,
      mute_expire_at: this.normalizeMuteExpireAt(duration)
    }
  }

  normalizeMemberMuteOp (op) {
    if (!['add', 'update', 'del'].includes(op)) {
      throw new Error('QQBot 设置群成员禁言失败：op 只能是 add、update 或 del')
    }
    return op
  }

  normalizeMuteExpireAt (duration) {
    let expiresAt
    if (duration instanceof Date) {
      expiresAt = duration
    } else if (typeof duration === 'number' || /^\d+(?:\.\d+)?$/.test(String(duration))) {
      const seconds = Number(duration)
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('QQBot 设置群成员禁言失败：禁言时长必须大于 0 秒')
      }
      expiresAt = new Date(Date.now() + seconds * 1000)
    } else {
      expiresAt = new Date(duration)
    }
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error('QQBot 设置群成员禁言失败：禁言到期时间必须是有效的 RFC3339 时间或秒数')
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('QQBot 设置群成员禁言失败：禁言到期时间必须晚于当前时间')
    }
    if (expiresAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
      throw new Error('QQBot 设置群成员禁言失败：最大禁言时长为 30 天')
    }
    return expiresAt.toISOString()
  }

  /**
   * 拉取群入群申请列表，options 支持 cursor、limit（默认 20，最大 100）。
   * https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_join_request_list.get.html
   */
  async getGroupJoinRequests (groupId, options = {}) {
    const groupOpenid = await this.resolveOpenid(groupId, 'group')
    const limit = options.limit === undefined ? undefined : Number(options.limit)
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw new Error('QQBot 拉取入群申请失败：limit 必须是 1 至 100 的整数')
    }
    const { data } = await this.sdk.request.get(
      `/v2/groups/${encodeURIComponent(groupOpenid)}/join_request_list`,
      { params: { cursor: options.cursor, limit } }
    )
    return data
  }

  /**
   * 审批群入群申请。approve=true 通过，false 拒绝；options 可传 join_request_id、
   * reject_reason 与 add_to_member_blacklist。
   */
  async approveGroupJoinRequest (groupId, memberId, approve = true, options = {}) {
    const groupOpenid = await this.resolveOpenid(groupId, 'group')
    const memberOpenid = await this.resolveOpenid(memberId, 'user')
    const op = typeof approve === 'string' ? approve : (approve ? 'approve' : 'decline')
    if (!['approve', 'decline'].includes(op)) {
      throw new Error('QQBot 审批入群申请失败：审批动作只能是 approve 或 decline')
    }
    if (options.add_to_member_blacklist && op !== 'decline') {
      throw new Error('QQBot 审批入群申请失败：仅拒绝申请时可加入群黑名单')
    }

    const { data } = await this.sdk.request.post(
      `/v2/groups/${encodeURIComponent(groupOpenid)}/approval_join_request/${encodeURIComponent(memberOpenid)}`,
      {
        op,
        join_request_id: options.join_request_id ?? options.request_id ?? options.flag,
        reject_reason: op === 'decline' ? options.reject_reason : undefined,
        add_to_member_blacklist: op === 'decline' ? options.add_to_member_blacklist : undefined
      }
    )
    return data ?? true
  }

  /** 查询入群自动审批策略，options 支持 cursor、limit。 */
  async getJoinApprovalStrategies (options = {}) {
    const { data } = await this.sdk.request.get('/v2/groups/join_approval_strategy', {
      params: { cursor: options.cursor, limit: options.limit }
    })
    return data
  }

  /** 创建入群自动审批策略。group_openids 与 group_ids 必须二选一。 */
  async createJoinApprovalStrategy (strategy = {}) {
    this.validateJoinApprovalStrategyGroups(strategy)
    const { data } = await this.sdk.request.post('/v2/groups/join_approval_strategy', strategy)
    return data
  }

  /** 修改入群自动审批策略的状态、失效时间或关联群。 */
  async updateJoinApprovalStrategy (strategyId, strategy = {}) {
    const id = this.requireStrategyId(strategyId)
    const { data } = await this.sdk.request.patch(
      `/v2/groups/join_approval_strategy/${encodeURIComponent(id)}`,
      strategy
    )
    return data ?? true
  }

  /** 删除入群自动审批策略。 */
  async deleteJoinApprovalStrategy (strategyId) {
    const id = this.requireStrategyId(strategyId)
    const { data } = await this.sdk.request.delete(
      `/v2/groups/join_approval_strategy/${encodeURIComponent(id)}`
    )
    return data ?? true
  }

  /** 执行策略，对关联群扫描并审批白名单成员的入群申请。 */
  async executeJoinApprovalStrategy (strategyId) {
    const id = this.requireStrategyId(strategyId)
    const { data } = await this.sdk.request.post(
      `/v2/groups/join_approval_strategy/${encodeURIComponent(id)}/execute`,
      {}
    )
    return data ?? true
  }

  /** 批量新增或删除自动审批策略的 QQ 号白名单。 */
  async updateJoinApprovalWhitelist (strategyId, op, users) {
    const id = this.requireStrategyId(strategyId)
    if (!['add', 'del'].includes(op)) throw new Error('QQBot 修改自动审批白名单失败：op 只能是 add 或 del')
    if (!Array.isArray(users) || !users.length || users.length > 10000) {
      throw new Error('QQBot 修改自动审批白名单失败：单次需提供 1 至 10000 个 QQ 号')
    }
    const whitelistUsers = users.map(user => String(user).trim())
    if (whitelistUsers.some(user => !/^\d+$/.test(user))) {
      throw new Error('QQBot 修改自动审批白名单失败：白名单成员必须是 QQ 号字符串')
    }
    const { data } = await this.sdk.request.post(
      `/v2/groups/join_approval_strategy/${encodeURIComponent(id)}/whitelist_users`,
      { op, whitelist_users: whitelistUsers }
    )
    return data
  }

  requireStrategyId (strategyId) {
    const id = String(strategyId ?? '').trim()
    if (!id) throw new Error('QQBot 入群自动审批策略操作失败：缺少 strategy_id')
    return id
  }

  validateJoinApprovalStrategyGroups (strategy) {
    const hasOpenids = Array.isArray(strategy.group_openids) && strategy.group_openids.length > 0
    const hasGroupIds = Array.isArray(strategy.group_ids) && strategy.group_ids.length > 0
    if (hasOpenids === hasGroupIds) {
      throw new Error('QQBot 创建自动审批策略失败：group_openids 与 group_ids 必须二选一')
    }
    const groups = hasOpenids ? strategy.group_openids : strategy.group_ids
    if (groups.length > 100) throw new Error('QQBot 创建自动审批策略失败：关联群最多 100 个')
  }

  /**
   * 将云崽/OneBot 使用的 ID 还原为 QQ 官方接口所需的 OpenID。
   * 数字 QQ 号会通过映射表查询；官方 OpenID 仅移除本机器人添加的前缀，
   * 避免错误截断 OpenID 中可能存在的连字符。
   */
  async resolveOpenid (id, type, context = {}) {
    let openid = String(id ?? '').trim()
    if (!openid) throw new Error(`QQBot 缺少${type === 'group' ? '群' : '用户'} OpenID`)

    const prefix = `${this.id}-`
    if (openid.startsWith(prefix)) {
      const unprefixed = openid.slice(prefix.length)
      if (!/^\d+$/.test(unprefixed)) return unprefixed
      openid = unprefixed
    }

    // 非纯数字 ID 已是官方 OpenID，不应交由 QQ 号映射表再次转换。
    if (/^\d+$/.test(openid)) {
      const resolveEvent = {
        ...context,
        bot: context.bot || Bot[this.id],
        self_id: context.self_id || this.id,
        qqbot_self_id: context.qqbot_self_id || this.id,
        qqbot_appid: context.qqbot_appid || this.id
      }
      let resolved = ''
      try {
        if (type === 'group') {
          resolved = QQBotIdMap.findGroupByQQ(this.id, openid)?.group_openid || ''
        } else {
          const groupOpenid = resolveEvent.group_openid || resolveEvent.openid_group_id || ''
          const groupQQ = /^\d+$/.test(String(resolveEvent.group_id || ''))
            ? resolveEvent.group_id
            : ''
          resolved = QQBotIdMap.findUserByQQ(this.id, openid, {
            groupOpenid,
            groupQQ,
            preferPrivate: type === 'private'
          })?.user_openid || ''
        }
      } catch {
        // 映射表不可用时继续尝试全局转换函数。
      }
      if (!resolved && Bot.QQToOpenid) {
        try {
          resolved = await Bot.QQToOpenid(openid, resolveEvent, type)
        } catch {
          // 映射不存在时保留原始 ID，后续给出明确错误。
        }
      }
      if (resolved) openid = String(resolved).trim()
    }

    if (type === 'private' && /^\d+$/.test(openid)) {
      throw new Error('QQBot 私聊 QQ 号尚未绑定 C2C 用户 OpenID')
    }
    if (type === 'user' && context.message_type === 'group' && /^\d+$/.test(openid)) {
      throw new Error('QQBot 群成员 QQ 号尚未绑定当前群 OpenID')
    }

    return openid.startsWith(prefix) ? openid.slice(prefix.length) : openid
  }

  /** QQBot 消息缓存键；同时按 msg_idx 与 message_id 建索引，保存 12 小时。 */
  getMessageCacheKey (type, targetId, keyType, value) {
    return `lain:qqbot:message:${this.id}:${type}:${targetId}:${keyType}:${value}`
  }

  async getMessageCacheTarget (type, targetId) {
    try {
      return await this.resolveOpenid(targetId, type === 'group' ? 'group' : 'user')
    } catch {
      return String(targetId ?? '').trim()
    }
  }

  getMessageSceneIndex (data = {}) {
    const ext = Array.isArray(data.message_scene?.ext) ? data.message_scene.ext : []
    const prefix = 'msg_idx='
    return ext.find(item => typeof item === 'string' && item.startsWith(prefix))?.slice(prefix.length)
  }

  async getCachedMessage (type, targetId, identifier) {
    const id = String(identifier ?? '').trim()
    if (!id) return undefined

    const target = await this.getMessageCacheTarget(type, targetId)
    try {
      const byIndex = await redis.get(this.getMessageCacheKey(type, target, 'idx', id))
      const byId = byIndex || await redis.get(this.getMessageCacheKey(type, target, 'id', id))
      return byId ? JSON.parse(byId) : undefined
    } catch {
      return undefined
    }
  }

  async getCachedMessageById (messageId) {
    const id = String(messageId ?? '').trim()
    if (!id) return undefined

    try {
      const data = await redis.get(`lain:qqbot:message:${this.id}:id:${id}`)
      return data ? JSON.parse(data) : undefined
    } catch {
      return undefined
    }
  }

  async getCachedChatHistory (type, targetId, messageId, num = 1) {
    const message = await this.getCachedMessage(type, targetId, messageId)
    // QQ 官方暂未提供历史消息接口；此处返回缓存命中的锚点消息，
    // 兼容依赖 getChatHistory(messageId, 1) 的 ICQQ 插件。
    return message && Number(num) > 0 ? [message] : []
  }

  async cacheIncomingMessage (e, data, isGroup) {
    const msgIdx = this.getMessageSceneIndex(data)
    const messageId = String(data?.message_id || data?.id || e?.message_id || '').trim()
    if (!msgIdx || !messageId) return

    const type = isGroup ? 'group' : 'user'
    const rawTargetId = isGroup
      ? data.group_openid || data.group_id
      : this.getMessageUserOpenid(data)
    const targetId = await this.getMessageCacheTarget(type, rawTargetId)
    if (!targetId) return

    const record = {
      id: messageId,
      message_id: messageId,
      msg_idx: msgIdx,
      time: e.time,
      seq: messageId,
      message: e.message,
      raw_message: e.raw_message,
      content: data.content || '',
      user_id: e.user_id,
      group_id: e.group_id,
      group_openid: data.group_openid || data.group_id || '',
      user_openid: this.getMessageUserOpenid(data),
      message_type: isGroup ? 'group' : 'private',
      sender: e.sender
    }
    const value = JSON.stringify(record)

    try {
      await Promise.all([
        redis.set(this.getMessageCacheKey(type, targetId, 'idx', msgIdx), value, { EX: MESSAGE_CACHE_TTL }),
        redis.set(this.getMessageCacheKey(type, targetId, 'id', messageId), value, { EX: MESSAGE_CACHE_TTL }),
        redis.set(`lain:qqbot:message:${this.id}:id:${messageId}`, value, { EX: MESSAGE_CACHE_TTL })
      ])
    } catch {
      // Redis 不可用时不影响正常收发；引用消息将无法跨进程恢复。
    }
  }

  async hydrateReferenceMessage (e, data, isGroup) {
    const refIdx = e.source?.qqbot_ref_msg_idx
    if (!refIdx) return

    const type = isGroup ? 'group' : 'user'
    const rawTargetId = isGroup
      ? data.group_openid || data.group_id
      : this.getMessageUserOpenid(data)
    const cached = await this.getCachedMessage(type, rawTargetId, refIdx)
    if (!cached) return

    e.source = {
      ...e.source,
      ...cached,
      id: cached.message_id,
      message_id: cached.message_id,
      qqbot_ref_msg_idx: refIdx
    }
    for (const message of e.message || []) {
      if (message?.type === 'reply' && (message.id === refIdx || message.data?.id === refIdx)) {
        message.id = cached.message_id
        if (message.data?.id !== undefined) message.data.id = cached.message_id
      }
    }
  }

  /** 发送响应的 ext_info.ref_idx 可还原用户后来引用的机器人消息 ID。 */
  async cacheSentMessage (type, targetId, result, message = []) {
    const id = result?.id || result?.message_id
    if (!id) return
    const target = await this.getMessageCacheTarget(type, targetId)
    const msgIdx = result?.ext_info?.ref_idx
    const record = {
      id: String(id),
      message_id: String(id),
      msg_idx: msgIdx,
      seq: String(id),
      time: Math.floor(new Date(result.timestamp).getTime() / 1000),
      message: Array.isArray(message) ? message : [message],
      user_id: this.id,
      group_id: type === 'group' ? target : undefined,
      message_type: type === 'group' ? 'group' : 'private'
    }
    try {
      const value = JSON.stringify(record)
      const writes = [
        redis.set(this.getMessageCacheKey(type, target, 'id', id), value, { EX: MESSAGE_CACHE_TTL }),
        redis.set(`lain:qqbot:message:${this.id}:id:${id}`, value, { EX: MESSAGE_CACHE_TTL })
      ]
      if (msgIdx) writes.push(redis.set(this.getMessageCacheKey(type, target, 'idx', msgIdx), value, { EX: MESSAGE_CACHE_TTL }))
      await Promise.all(writes)
    } catch {
      // 缓存失败不能影响已成功发送的消息；引用撤回会明确提示缓存未命中。
    }
  }

  /**
   * 撤回群消息。
   * https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages_message_id.delete.html
   */
  async recallGroupMsg (group_id, message_id) {
    const groupOpenid = await this.resolveOpenid(group_id, 'group')
    const messageId = String(message_id ?? '').trim()
    if (!messageId) throw new Error('QQBot 撤回群消息失败：缺少消息 ID')

    const response = await this.sdk.request.delete(
      `/v2/groups/${encodeURIComponent(groupOpenid)}/messages/${encodeURIComponent(messageId)}`
    )
    // 官方接口成功时返回 HTTP 200，且没有响应体。
    return this.checkRecallResponse(response)
  }

  /** 撤回私聊消息。 */
  async recallPrivateMsg (user_id, message_id) {
    const userOpenid = await this.resolveOpenid(user_id, 'private')
    const messageId = String(message_id ?? '').trim()
    if (!messageId) throw new Error('QQBot 撤回私聊消息失败：缺少消息 ID')

    const response = await this.sdk.request.delete(
      `/v2/users/${encodeURIComponent(userOpenid)}/messages/${encodeURIComponent(messageId)}`
    )
    return this.checkRecallResponse(response)
  }

  checkRecallResponse (response) {
    const code = response?.data?.err_code ?? response?.data?.code
    if (code !== undefined && Number(code) !== 0) {
      throw new Error(`QQBot 撤回失败（${code}）：${response.data.message || response.data.msg || '接口拒绝撤回'}`)
    }
    return response?.status === 200
  }

  /** QQ 富媒体文件：上传后通过 msg_type=7 发送 file_info。 */
  async uploadRichFile (targetType, targetId, file, name) {
    let upload = await this.resolveUploadFile(file, name)
    const collection = `${targetType}s`
    const encodedTargetId = encodeURIComponent(targetId)
    const sendUpload = async value => await this.sdk.request.post(`/v2/${collection}/${encodedTargetId}/files`, {
      file_type: 4,
      // false 时只取得 file_info，随后由发送消息接口统一发送。
      srv_send_msg: false,
      file_name: value.name,
      ...(value.buffer ? { file_data: value.buffer.toString('base64') } : { url: value.url })
    })

    let response
    try {
      // 官方群与 C2C 文件接口支持 URL 直传；本地文件和 URL 下载失败后的回退使用
      // UploadPrepare → PUT 分片 → UploadPartFinish → /files 合并流程。
      response = upload.buffer
        ? await this.uploadFileInParts(targetType, targetId, upload)
        : await sendUpload(upload)
    } catch (error) {
      // URL 直传在 QQ 服务端下载失败（850011）或内部代理失败（850012）时，
      // 文件改由本机下载并执行官方分片上传。
      if (!upload.buffer && this.isQQFileProxyError(error)) {
        upload = await this.resolveUploadFile(file, name, true)
        response = await this.uploadFileInParts(targetType, targetId, upload)
      } else {
        throw error
      }
    }

    const { data } = response
    if (!data?.file_info) throw new Error('QQBot 文件上传失败：响应中没有 file_info')
    return { ...data, name: upload.name, url: upload.url }
  }

  /**
   * 群与 C2C 文件官方分片上传。
   * 1. /upload_prepare 申请 upload_id 和预签名 PUT 地址；
   * 2. PUT 每个分片并调用 /upload_part_finish；
   * 3. /files 携带 upload_id 完成合并并取得 file_info。
   */
  async uploadFileInParts (targetType, targetId, upload) {
    const buffer = upload.buffer
    if (!Buffer.isBuffer(buffer)) throw new Error('QQBot 分片上传失败：缺少文件数据')
    if (buffer.length > 200 * 1024 * 1024) throw new Error('QQBot 分片上传失败：文件超过 200MB 限制')

    const collection = `${targetType}s`
    const endpoint = `/v2/${collection}/${encodeURIComponent(targetId)}`
    const md5 = data => crypto.createHash('md5').update(data).digest('hex')
    const sha1 = data => crypto.createHash('sha1').update(data).digest('hex')
    const { data: prepared } = await this.sdk.request.post(`${endpoint}/upload_prepare`, {
      file_type: 4,
      file_size: String(buffer.length),
      file_name: upload.name,
      md5: md5(buffer),
      sha1: sha1(buffer),
      // 官方定义为文件前 10002432 字节的 MD5。
      md5_10m: md5(buffer.subarray(0, 10002432))
    })

    const uploadId = prepared?.upload_id
    const blockSize = Number(prepared?.block_size)
    const parts = Array.isArray(prepared?.parts) ? [...prepared.parts].sort((a, b) => Number(a.index) - Number(b.index)) : []
    if (!uploadId || !parts.length || !Number.isFinite(blockSize) || blockSize <= 0) {
      throw new Error('QQBot 分片上传失败：预上传响应缺少 upload_id、block_size 或 parts')
    }

    const uploadConfig = prepared.upload_config || {}
    const retryTimeout = Math.max(1, Number(uploadConfig.retry_timeout) || 300) * 1000
    const retryDelay = Math.max(1, Number(uploadConfig.retry_delay) || 1) * 1000
    let offset = 0

    for (const part of parts) {
      const partSize = Math.min(Number(part.block_size) || blockSize, buffer.length - offset)
      if (partSize <= 0 || !part.presigned_url) throw new Error('QQBot 分片上传失败：分片信息无效')
      const chunk = buffer.subarray(offset, offset + partSize)
      await this.putUploadPart(part.presigned_url, chunk, retryTimeout, retryDelay)
      await this.sdk.request.post(`${endpoint}/upload_part_finish`, {
        upload_id: uploadId,
        part_index: Number(part.index),
        block_size: String(chunk.length),
        md5: md5(chunk)
      })
      offset += partSize
    }

    if (offset !== buffer.length) throw new Error('QQBot 分片上传失败：服务端返回的分片数量与文件大小不匹配')

    return await this.sdk.request.post(`${endpoint}/files`, {
      file_type: 4,
      file_name: upload.name,
      srv_send_msg: false,
      upload_id: uploadId
    })
  }

  /** 向 QQ 返回的预签名地址上传单个分片，并按 upload_config 重试。 */
  async putUploadPart (url, chunk, retryTimeout, retryDelay) {
    const deadline = Date.now() + retryTimeout
    let error

    do {
      const controller = new AbortController()
      const requestTimeout = Number(this.config.timeout) > 0 ? Number(this.config.timeout) : 60000
      const timeout = setTimeout(() => controller.abort(), requestTimeout)
      try {
        const response = await fetch(url, { method: 'PUT', body: chunk, signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
        return
      } catch (err) {
        error = err
      } finally {
        clearTimeout(timeout)
      }

      if (Date.now() + retryDelay > deadline) break
      await common.sleep(retryDelay)
    } while (Date.now() < deadline)

    throw new Error(`QQBot 分片上传失败：${error?.message || error}`)
  }

  /** 发送 QQ 富媒体文件消息。C2C / 群被动回复时附带消息上下文。 */
  async sendRichFile (targetType, targetId, file, name, source = {}) {
    const uploaded = await this.uploadRichFile(targetType, targetId, file, name)
    const payload = {
      content: uploaded.name || '文件',
      msg_type: 7,
      media: { file_info: uploaded.file_info }
    }
    const context = typeof source === 'string' ? { messageId: source } : (source || {})
    const sourceMessageId = context.messageId || context.msgId || context.id || ''
    const sourceEventId = context.eventId || ''
    if (sourceMessageId) {
      payload.msg_id = sourceMessageId
      payload.msg_seq = nextQQBotMessageSeq()
    } else if (sourceEventId) {
      payload.event_id = sourceEventId
    }
    const { data } = await this.sdk.request.post(`/v2/${targetType}s/${encodeURIComponent(targetId)}/messages`, payload)
    if (!data?.id) throw new Error('QQBot 文件消息发送失败：响应中没有消息 ID')
    await this.cacheSentMessage(targetType === 'group' ? 'group' : 'user', targetId, data, [{ type: 'file', name: uploaded.name }])
    return { ...data, file_id: uploaded.file_uuid, file_info: uploaded.file_info }
  }

  /** 兼容本地路径、base64、Buffer 与 URL；本地文件走官方分片上传。 */
  async resolveUploadFile (file, name, preferFileData = false) {
    const source = file?.url || file?.file || file
    if (!source) throw new Error('QQBot 文件上传失败：缺少 file 参数')

    const normalized = await Bot.FormatFile(source)
    const fileName = name || file?.name || this.getUploadFileName(source)
    const isHttpUrl = typeof normalized === 'string' && /^https?:\/\//.test(normalized)
    if (isHttpUrl && !preferFileData) {
      return { url: normalized, name: fileName }
    }

    const data = await Bot.Buffer(normalized)
    return {
      name: fileName,
      buffer: Buffer.isBuffer(data) ? data : Buffer.from(data)
    }
  }

  isQQFileProxyError (error) {
    const code = Number(error?.response?.data?.code)
    return [850011, 850012].includes(code) || /code\(850011|850012\)|download file error|call inner proxy error/i.test(String(error?.message || error))
  }

  getUploadFileName (file) {
    if (typeof file !== 'string') return 'file'
    const clean = file.replace(/^file:\/\//, '').split('?')[0]
    try {
      const pathname = /^https?:\/\//.test(file) ? new URL(file).pathname : clean
      return decodeURIComponent(path.basename(pathname)) || 'file'
    } catch {
      return path.basename(clean) || 'file'
    }
  }

  /** 转换格式给云崽处理 */
  async message(data, isGroup) {
    QQBotIdMap.logDebug(this.id, 'QQBot转换前data', data)
    let { self_id: tinyId, ...e } = data
    const rawGroupId = e.group_openid || e.group_id
    const rawUserId = e.user_id
    const rawAuthorId = e.author?.id
    const senderOpenid = this.getMessageUserOpenid(e)
    const senderMemberOpenid = this.getMessageMemberOpenid(e)
    const memberRole = this.getMemberRole(e)
    const nickname = e.author?.username || e.sender?.user_name || e.sender?.nickname || e.user_id || ''
    const rawSender = {
      user_id: rawUserId,
      author_id: rawAuthorId,
      user_openid: e.author?.user_openid || e.sender?.user_openid || '',
      member_openid: senderMemberOpenid,
      group_openid: e.group_openid || rawGroupId || ''
    }
    e.data = data
    e.post_type = 'message'
    e.uin = this.id // ???鬼知道哪来的这玩意，icqq都没有...
    e.tiny_id = tinyId
    e.qqbot_event_type = e.qqbot_event_type || data.qqbot_event_type || ''
    e.qqbot_event_id = e.event_id || data.event_id || ''
    e.time = data.timestamp
    e.self_id = this.id
    e.bot = Bot[this.id]
    e.sendMsg = data.reply
    e.message = this.normalizeIncomingAttachments(Array.isArray(e.message) ? e.message : [])
    e.qqbot_message = e.message.map(i => ({ ...i }))
    e.raw_message = String(e.raw_message || '').trim()
    this.normalizeIncomingMessage(e, tinyId)
    if (isGroup && rawGroupId) {
      try {
        const state = await this.getGroupBotState(rawGroupId, { required: false })
        if (state) {
          e.qqbot_group_state = state
          e.qqbot_recv_msg_setting = state.recv_msg_setting
          e.qqbot_allow_proactive_msg = state.allow_proactive_msg
        } else {
          e.qqbot_recv_msg_setting = e.qqbot_is_group_all ? 'all' : 'only_mention'
        }
      } catch (error) {
        e.qqbot_group_state_error = error.message
        // 全量事件自身仍能确定按钮不应自动 @，不依赖受限的查询接口。
        e.qqbot_recv_msg_setting = e.qqbot_is_group_all ? 'all' : 'only_mention'
      }
    }

    if (Bot[this.id].config.other.Prefix) {
      e.message.some(msg => {
        if (msg.type === 'text') {
          if (this.isMentionText(msg.text)) return false
          const mentionPrefix = String(msg.text || '').match(/^(\s*<@!?[^>]+>\s*)([\s\S]+)$/)
          if (mentionPrefix) {
            msg.text = mentionPrefix[1] + this.hasAlias(mentionPrefix[2], e)
            return true
          }
          msg.text = this.hasAlias(msg.text, e)
          return true
        }
        return false
      })
    }
    // 同步消息段与 raw_message。否则装载器重建 e.msg 时会再次拼入未反转义的文本。
    for (const item of e.message) {
      if (item?.type === 'text') item.text = this.normalizeCommandText(item.text)
    }
    this.normalizeIncomingMessage(e, tinyId)
    this.defineIncomingMsg(e)
    // 上游插件可能为了匹配规则改写 e.msg；按钮匹配需要保留适配器收到的原始命令。
    this.rememberButtonCommand(e)
    // 先用 ref_msg_idx 恢复被引用消息的真实 message_id，再缓存当前消息的
    // msg_idx → message_id 映射，供后续引用、撤回和历史消息查询使用。
    await this.hydrateReferenceMessage(e, data, isGroup)
    await this.cacheIncomingMessage(e, data, isGroup)

    /** 获取匹配的按钮行（供自动附加） */
    const getAutoButtons = async () => {
      try { return await this.button(e) } catch { return false }
    }

    /** 构建快速回复消息（自动附加按钮插件） */
    e.reply = async (msg, quote) => {
      if (quote?.markdown) return await e.markdown(msg, quote)
      // 此回复函数始终由 QQBot 创建。身份转译可能改写 e.adapter，
      // 但按钮仍需通过原始 QQBot 通道发送。
      const hasExplicitButtons = common.array(msg).some(item =>
        item?.type === 'keyboard' || item?.type === 'button' || QQBotButton.isButton(item)
      )
      const isProfilePanel = /^#面板(?:\s*\d{9,10})?$/.test(String(e.msg || ''))
      if (!hasExplicitButtons || isProfilePanel) {
        const btnRows = await getAutoButtons()
        if (btnRows?.length) {
          const content = isProfilePanel
            ? common.array(msg).filter(item => item?.type !== 'keyboard' && item?.type !== 'button')
            : common.array(msg)
          msg = [...content, ...btnRows]
        }
      }
      return await this.sendReplyMsg(e, msg, quote)
    }
    e.markdown = async (msg, options = {}) => {
      if (!options.buttons && !options.button) {
        const btnRows = await getAutoButtons()
        if (btnRows?.length) options.buttons = btnRows
      }
      return await this.sendMarkdownReplyMsg(e, msg, options)
    }
    e.replyMarkdown = e.markdown
    e.sendMarkdown = e.markdown
    /** 快速撤回 */
    e.recall = async () => isGroup
      ? await this.recallGroupMsg(rawGroupId, e.message_id || data.id)
      : await this.recallPrivateMsg(senderOpenid, e.message_id || data.id)
    /** 将收到的消息转为字符串 */
    e.toString = () => e.raw_message
    /** 获取对应用户头像 */
    e.getAvatarUrl = (size = 0) => this.getAvatarUrl(size, senderOpenid)

    /** 构建场景对应的方法 */
    if (isGroup) {
      try {
        const groupId = `${this.id}-${e.group_id}`
        if (!Bot[e.self_id].gl.get(groupId)) Bot[e.self_id].gl.set(groupId, { group_id: groupId })
        /** 缓存群列表 */
        if (await redis.get(`lain:gl:${e.self_id}:${groupId}`)) redis.set(`lain:gl:${e.self_id}:${groupId}`, JSON.stringify({ group_id: groupId, uin: this.id }))
      } catch { }

      e.member = this.member(e.group_id, e.user_id)
      e.member.is_owner = memberRole === 'owner'
      e.member.is_admin = memberRole === 'admin' || memberRole === 'owner'
      e.group_name = `${this.id}-${e.group_id}`
      e.group = this.pickGroup(e.group_id)
      e.message_type = 'group'
      e.sub_type = 'normal'
    } else {
      e.friend = this.pickFriend(this.formatQQBotId(senderOpenid), {
        messageId: e.message_id || data.id,
        eventId: e.qqbot_event_id
      })
      e.message_type = 'private'
      e.sub_type = 'friend'
    }

    /** 添加适配器标识 */
    e.adapter = 'QQBot'
    e.user_id = this.formatQQBotId(senderOpenid)
    e.group_id = isGroup ? this.formatQQBotId(rawGroupId) : undefined
    if (e.author?.id) e.author.id = this.formatQQBotId(e.author.id)
    e.user_openid = senderOpenid
    e.member_openid = senderMemberOpenid
    e.group_openid = rawGroupId || ''
    e.raw_sender = rawSender
    if (!e.sender) e.sender = {}
    e.sender.user_id = e.user_id
    e.sender.user_openid = senderOpenid
    e.sender.member_openid = senderMemberOpenid
    e.sender.group_openid = rawGroupId
    e.sender.nickname = nickname
    e.sender.card = nickname
    e.sender.role = memberRole
    e.sender.title = e.sender.title || ''
    e.sender.level = e.sender.level || 1
    if (e.member?.info) {
      e.member.info = { ...e.member.info, ...e.sender }
      e.member.info.group_id = e.group_id
      e.member.info.user_id = e.user_id
    }

    /** 缓存好友列表 */
    if (!Bot[e.self_id].fl.get(e.user_id)) Bot[e.self_id].fl.set(e.user_id, { user_id: e.user_id })
    if (await redis.get(`lain:fl:${e.self_id}:${e.user_id}`)) redis.set(`lain:fl:${e.self_id}:${e.user_id}`, JSON.stringify({ user_id: e.user_id }))

    /** 保存消息次数 */
    try { common.recvMsg(e.self_id, e.adapter) } catch { }
    lain.info(this.id, `<群:${e.group_id}><用户:${e.user_id}> -> ${this.messageLog(e.message)}`)
    QQBotIdMap.logDebug(this.id, 'QQBot转换后data', e)
    /** dau统计 */
    this.msg_count(data)
    return e
  }

  /** 将官方附件转换成云崽/OneBot 可识别的 image、record、video、file 段。 */
  normalizeIncomingAttachments (message) {
    return message.map(item => {
      if (!item || typeof item !== 'object') return item
      const type = String(item.type || '').toLowerCase()
      const url = item.url || item.voice_wav_url

      if (type === 'voice' || type === 'audio') {
        return { ...item, type: 'record', file: item.voice_wav_url || url, url }
      }
      if (type === 'image' || type === 'video') {
        return { ...item, file: item.file || url, url }
      }
      // 官方 file 附件可能是 file，也可能因 MIME 类型被 SDK 解析成 application。
      if (type === 'file' || type === 'application' || (url && item.name && !['text', 'at', 'face'].includes(type))) {
        return {
          ...item,
          type: 'file',
          file: item.file || url,
          url,
          name: item.name || item.filename || this.getUploadFileName(url || 'file')
        }
      }
      return item
    })
  }

  normalizeIncomingMessage(e, tinyId) {
    const message = Array.isArray(e.message) ? e.message : []
    const cleanId = id => {
      const text = String(id ?? '').trim().replace(/^qg_/, '')
      const prefix = `${this.id}-`
      return text.startsWith(prefix) ? text.slice(prefix.length) : text
    }
    const selfIds = new Set([cleanId(this.id), cleanId(tinyId), cleanId(e.tiny_id)].filter(Boolean))
    const eventType = e.qqbot_event_type || e.data?.qqbot_event_type || ''
    const isGroupAtEvent = eventType === 'GROUP_AT_MESSAGE_CREATE'
    const isGroupAllEvent = eventType === 'GROUP_MESSAGE_CREATE'
    e.qqbot_is_group_at = isGroupAtEvent
    e.qqbot_is_group_all = isGroupAllEvent
    const contentMention = String(e.content || '').match(/^<@!?([^>]+)>/)

    const isSelfAt = i => {
      if (i?.type !== 'at') return false
      if (i.is_you || i.is_bot || i.is_self) return true
      return [i.qq, i.id, i.user_id, i.tiny_id, i.member_openid, i.user_openid]
        .some(id => selfIds.has(cleanId(id)))
    }
    e.atme = message.some(isSelfAt) || isGroupAtEvent || !!(contentMention && selfIds.has(cleanId(contentMention[1])))

    // QQBot 的 @ 事件本身已表达“调用机器人”。去掉消息数组里的机器人
    // at 段，避免 ICQQ 兼容层把它当作普通目标用户 @；其他用户的 at 保留。
    if (!e.qqbot_at_normalized) {
      let removedSelfAt = false
      if (Array.isArray(e.message)) {
        e.message = e.message.filter(item => {
          if (item?.type !== 'at') return true
          const ids = [item.qq, item.id, item.user_id, item.tiny_id, item.member_openid, item.user_openid]
          const selfMention = isSelfAt(item) || (contentMention && ids.some(id => cleanId(id) === cleanId(contentMention[1])))
          if (selfMention) removedSelfAt = true
          return !selfMention
        })
      }
      // GROUP_AT_MESSAGE_CREATE 保证机器人被 @。某些 SDK 版本不会把机器人的
      // OpenID 放进 at 段，因而用事件语义移除首个 at 段作为兼容回退。
      if (isGroupAtEvent && !removedSelfAt && Array.isArray(e.message)) {
        const index = e.message.findIndex(item => item?.type === 'at')
        if (index >= 0) e.message.splice(index, 1)
      }
      e.qqbot_at_normalized = true
    }

    const text = message
      .filter(i => i?.type === 'text')
      .map(i => i.text || '')
      .join('')
      .trim()

    let msg = text || String(e.msg || e.raw_message || '').trim()
    const leadingMention = msg.match(/^<@!?([^>]+)>\s*/)
    if (!e.atme && leadingMention) {
      e.atme = isGroupAtEvent || selfIds.has(cleanId(leadingMention[1]))
    }
    if (e.atme) msg = msg.replace(/^<@!?.+?>\s*/, '').trim()
    if (msg) e.raw_message = this.normalizeMsgText(msg)
    delete e.msg
  }

  defineIncomingMsg(e) {
    const base = this.normalizeMsgText(e.raw_message)
    e.raw_message = base
    let msg = base

    Object.defineProperty(e, 'msg', {
      enumerable: true,
      configurable: true,
      get: () => msg,
      set: value => {
        msg = this.normalizeMsgText(value, base)
      }
    })
  }

  rememberButtonCommand(e) {
    if (!e || Object.prototype.hasOwnProperty.call(e, 'qqbot_button_command')) return
    Object.defineProperty(e, 'qqbot_button_command', {
      value: String(e.msg ?? e.raw_message ?? '').trim(),
      enumerable: false,
      configurable: true,
      writable: true
    })
  }

  getButtonCommand(e) {
    const original = String(e?.qqbot_button_command ?? '').trim()
    // 非斜杠/井号命令可能被上游插件改写成标准 # 命令；自动按钮仍按原始前缀匹配。
    if (original && !/^[#＃/／]/.test(original)) return original
    return String(e?.msg ?? original).trim()
  }

  normalizeMsgText(value, base = '') {
    let text = this.normalizeCommandText(String(value || '').replace(/<@!?[^>]+>\s*/g, '').trim())
    const normalizedBase = String(base || '').trim()
    if (normalizedBase) {
      const repeated = new RegExp(`^(?:${this.escapeRegExp(normalizedBase)}\\s*)+$`)
      if (repeated.test(text)) return normalizedBase
      const atPrefix = text.match(/^((?:@\d+\s*)+)(?=\S)/)
      if (atPrefix) {
        const body = text.slice(atPrefix[0].length).trim()
        if (repeated.test(body)) return atPrefix[0] + normalizedBase
      }
    }
    text = this.collapseRepeatedCommandText(text)
    return text
  }

  normalizeCommandText(text) {
    return String(text || '')
      .replace(/(^|\s)＃(?=\S)/g, '$1#')
      // 显式反转义：\/命令保留为 /命令，不参与斜杠前缀转换。
      .replace(/^(\s*(?:<@!?[^>]+>\s*)?)\\(?=[\/／])/, '$1')
  }

  collapseRepeatedCommandText(text) {
    text = String(text || '').trim()
    if (!text.startsWith('#')) return text

    for (const match of text.slice(1).matchAll(/#/g)) {
      const index = match.index + 1
      const command = text.slice(0, index).trim()
      const rest = text.slice(index).trim()
      if (!command || !rest) continue

      const repeated = new RegExp(`^(?:${this.escapeRegExp(command)}\\s*)+$`)
      if (repeated.test(rest)) return command
    }

    return text
  }

  escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  getMessageUserOpenid(e) {
    return String(e.author?.member_openid || e.sender?.member_openid || e.author?.user_openid || e.sender?.user_openid || e.user_id || e.author?.id || '').trim()
  }

  getMessageMemberOpenid(e) {
    return String(e.author?.member_openid || e.sender?.member_openid || e.sender?.user_openid || e.user_id || '').trim()
  }

  getMemberRole(e) {
    const role = String(e.author?.member_role || e.member?.member_role || e.sender?.role || '').toLowerCase()
    if (role === 'owner' || role === 'admin') return role
    return 'member'
  }

  isMentionText(text) {
    return /^<@!?[^>]+>$/.test(String(text || '').trim())
  }

  formatQQBotId(id) {
    const text = String(id ?? '').trim()
    if (!text) return undefined
    return text.startsWith(`${this.id}-`) ? text : `${this.id}-${text}`
  }

  /** 前缀处理 */
  hasAlias(text, e, keepAlias = true) {
    text = String(text ?? '').trim()
    if (this.isSlashToHashEnabled() && this.isSlashCommand(text)) {
      return this.slashToHash(text)
    }
    /** 兼容前缀 */
    let groupCfg = MiaoCfg.getGroup(e.group_id)
    let alias = groupCfg.botAlias
    if (!Array.isArray(alias)) {
      alias = [alias]
    }
    for (const name of alias) {
      const prefix = String(name ?? '')
      if (!prefix || !text.startsWith(prefix)) continue

      // 只有去掉别名后仍以 / 开头时才转换；%、*、普通文字等前缀保持原样。
      const command = text.slice(prefix.length)
      const normalized = this.isSlashToHashEnabled() && this.isSlashCommand(command)
        ? this.slashToHash(command)
        : command
      return keepAlias ? prefix + normalized : normalized
    }
    return text
  }

  isSlashToHashEnabled() {
    return !!Bot[this.id]?.config?.other?.Prefix
  }

  isSlashCommand(text) {
    return /^[\/／]/.test(String(text || '').trim())
  }

  slashToHash(text) {
    return String(text || '').replace(/^\s*[\/／]\s*/, '#')
  }

  /** 日志 */
  messageLog(message) {
    const logMessage = []
    message.forEach(i => {
      switch (i.type) {
        case 'image':
          logMessage.push(`<图片:${i.url}>`)
          break
        case 'face':
          logMessage.push(`<face:${i.id}>`)
          break
        case 'text':
          logMessage.push(i.text)
          break
        default:
          logMessage.push(JSON.stringify(i))
      }
    })
    return logMessage.join('')
  }
  /** ffmpeg转码 转为pcm */
  async runFfmpeg(input, output) {
    let cm
    let ret = await new Promise((resolve, reject) => exec('ffmpeg -version', { windowsHide: true }, (error, stdout, stderr) => resolve({ error, stdout, stderr })))
    return new Promise((resolve, reject) => {
      if (ret.stdout) {
        cm = 'ffmpeg'
      } else {
        const cfg = Yaml.parse(fs.readFileSync('./config/config/bot.yaml', 'utf8'))
        cm = cfg.ffmpeg_path ? `"${cfg.ffmpeg_path}"` : null
      }

      if (!cm) {
        throw new Error('未检测到 ffmpeg ，无法进行转码，请正确配置环境变量或手动前往 bot.yaml 进行配置')
      }

      exec(`${cm} -i "${input}" -f s16le -ar 48000 -ac 1 "${output}"`, async (error, stdout, stderr) => {
        if (error) {
          common.error('Lain-plugin', `执行错误: ${error}`)
          reject(error)
          return
        }
        resolve()
      }
      )
    })
  }

  /** 转换message：QQBot 新版仅使用 markdown.content + button */
  async getQQBot(data, e) {
    data = common.array(data)
    let reply
    const message = []
    const Pieces = []
    let normalMsg = []
    let content = ''
    const buttonRows = []

    const flushMarkdown = async () => {
      if (!content && !buttonRows.length) return
      do {
        const piece = []
        piece.push({ type: 'markdown', content: content || ' ' })
        if (buttonRows.length) {
          piece.push({ type: 'keyboard', content: { rows: buttonRows.splice(0, 5) } })
        }
        Pieces.push(piece)
        content = ''
      } while (buttonRows.length)
      content = ''
    }

    const appendText = text => {
      if (!text) return
      content += String(text).replace(/@/g, '@\u200B').replace(/<qqbot-/g, '<qqbot-\u200B')
    }

    for (let i of data) {
      if (typeof i !== 'object' || i === null) i = { type: 'text', text: String(i) }
      switch (i.type) {
        case 'text':
        case 'forward': {
          if (!String(i.text || '').trim()) break
          let text = i.type === 'forward' ? String(i.text).trim() + '\n' : String(i.text).trim()
          text = text.replace('@everyone', 'everyone')
          const inlineCommands = this.extractMqqapiInlineCommands(text)
          text = inlineCommands.content
          if (inlineCommands.buttons.length) {
            buttonRows.push(...this.normalizeButtons(e, [inlineCommands.buttons]))
          }
          for (const p of this.HandleURL(text)) {
            if (p.type === 'button' || p.type === 'keyboard') buttonRows.push(...this.normalizeButtons(e, p))
            else appendText(p.text)
          }
          break
        }
        case 'at': {
          // C2C 只有当前会话用户；官方私聊消息不接受 qqbot-at-user 标签。
          if (!e?.group_id) break
          if ((i.qq || i.id) === 'all') {
            content += '<qqbot-at-everyone />'
          } else {
            let qq
            if (Bot.QQToOpenid) {
              try { qq = await Bot.QQToOpenid(i.qq || i.id, e) } catch { }
            }
            qq = this.stripQQBotId(qq || i.qq || i.id || '')
            content += `<qqbot-at-user id="${qq}" />`
          }
          break
        }
        case 'image': {
          const image = await this.getImage(i?.url || i.file, e)
          content += `![${i.summary || '图片'} #${image.width || 0}px #${image.height || 0}px](${String(image.file).replace(/_/g, '%5F')})`
          break
        }
        case 'button':
          buttonRows.push(...this.normalizeButtons(e, i))
          break
        case 'keyboard':
          buttonRows.push(...this.normalizeButtons(e, i))
          break
        case 'markdown':
          {
            const inlineCommands = this.extractMqqapiInlineCommands(await this.makeMarkdownContent(e, i.data || i))
            appendText(inlineCommands.content)
            if (inlineCommands.buttons.length) {
              buttonRows.push(...this.normalizeButtons(e, [inlineCommands.buttons]))
            }
          }
          break
        case 'reply':
          reply = i
          break
        case 'video':
        case 'record':
        case 'audio':
        case 'ark':
        case 'embed':
        default:
          await flushMarkdown()
          if (i.type === 'record') i = await this.getAudio(i.file)
          else if (i.type === 'audio') i = await this.getAudio(i.file || i.url)
          else if (i.type === 'video') i = await this.getVideo(i?.url || i.file)
          message.push(i)
          break
        case 'file':
          await flushMarkdown()
          message.push({
            type: 'file',
            file: i.file || i.url || i.data?.file,
            name: i.name || i.data?.name
          })
          break
      }
    }

    if (content || buttonRows.length) await flushMarkdown()
    if (message.length) Pieces.unshift(message)
    normalMsg = message.length ? [message] : []

    common.log('Lain-plugin', `${this.id} 发送消息: ${JSON.stringify(Pieces)}`)
    return { Pieces, reply, normalMsg }
  }

  /** 处理图片 */
  async getImage(file, e) {
    file = await Bot.FormatFile(file)
    const type = 'image'
    try {
      /** 自定义图床 */
      if (Bot?.imageToUrl) {
        const res = await Bot.imageToUrl(file)
        // 打印一次，方便排查
        common.mark('Lain-plugin', 'imageToUrl 原始返回: ' + JSON.stringify(res)?.slice(0, 500))
        
         // 兼容各种返回结构：字符串 / {url} / {link} / {data:{url}} / {data:{link}}
        const url = typeof res === 'string'
          ? res
          : res?.url || res?.link || res?.data?.url || res?.data?.link
      
        if (!url) {
          logger.error('[Lain-plugin] imageToUrl 未返回有效 URL:', JSON.stringify(res)?.slice(0, 500))
          const err = new Error('imageToUrl 返回空 URL')
          err.noFallback = true
          throw err
        }
      
        // width/height 缺失时，从 buffer 本地计算
        let width = Number(res?.width) || 0
        let height = Number(res?.height) || 0
        if (!width || !height) {
          try {
            const buffer = await Bot.Buffer(file)
            const dim = sizeOf(buffer)
            width = width || dim.width || 0
            height = height || dim.height || 0
            common.mark('Lain-plugin', `本地计算图片尺寸: ${width}x${height}`)
          } catch (error) {
            logger.error('[Lain-plugin] 本地计算图片尺寸失败:', error)
          }
        }
      
        common.mark('Lain-plugin', `使用自定义图床发送图片：${url} (${width}x${height})`)
        return { type, file: url, width, height }
      } else if (Bot?.uploadFile) {
        /** 老接口，后续废除 */
        const url = await Bot.uploadFile(file)
        common.mark('Lain-plugin', `使用自定义图床发送图片：${url}`)
        const { width, height } = sizeOf(await Bot.Buffer(file))
        console.warn('[Bot.uploadFile]接口即将废除，请查看文档更换新接口！')
        return { type, file: url, width, height }
      }
      /** ICQQ */
      if (Cfg.ICQQ && lain?.file?.uploadImage) {
        const { url, width, height } = await lain.file.uploadImage(file)
        common.mark('Lain-plugin', `使用ICQQ发送图片：${url}`)
        return { type, file: url, width, height }
      }
    } catch (error) {
      logger.error('[调用错误][自定义图床] 将继续公网发送图片')
      logger.error(error)
    }

    try {
      /** QQ图床 预留 */
      const QQ = Bot[this.id].config.other.QQ
      if (QQ) {
        const { width, height, url } = await Bot.uploadQQ(file, QQ)
        common.mark('Lain-plugin', `QQ图床上传成功：${url}`)
        return { type, file: url, width, height }
      }
    } catch (error) {
      logger.error('[调用错误][QQ图床] 将继续公网发送图片')
      logger.error(error)
    }

    /** 公网 */
    const { width, height, url } = await Bot.FileToUrl(file)
    common.mark('Lain-plugin', `使用公网临时服务器：${url}`)
    return { type, file: url, width, height }
  }

  /** 处理视频 */
  async getVideo(file) {
    return { type: 'video', file: await Bot.FormatFile(file) }
  }
  
  async silkEncode(file, mp3, pcm) {
    const buffer = await Bot.Buffer(file);
    if (isSilk(buffer)) return buffer;

    fs.writeFileSync(mp3, buffer)

    await this.runFfmpeg(mp3, pcm)
    common.mark('Lain-plugin', 'mp3 => pcm 完成!')
    common.mark('Lain-plugin', 'pcm => silk 进行中!')
    const pamBuffer = await fs.promises.readFile(pcm)
    const { data } = await encode(pamBuffer, 48000)
    return Buffer.from(data)
  }

  /** 处理语音 */
  async getAudio(file) {
    /** icqq高清语音 */
    if (typeof file === 'string' && file.startsWith('protobuf://')) {
      return { type: 'audio', file: await Bot.getPttUrl(Bot.ICQQproto(file)[3]) }
    }

    try {
      /** 自定义语音接口 */
      if (Bot?.silkToUrl) {
        const url = await Bot.silkToUrl(file)
        if (url) {
          common.mark('Lain-plugin', `<云转码:${url}>`)
          return { type: 'audio', file: url }
        }
      }
    } catch (error) {
      logger.error('云转码失败')
      logger.error(error)
    }

    const type = 'audio'
    const start = Date.now();
    const _path = process.cwd() + '/resources/temp'
    try { await fs.promises.mkdir(_path) } catch (error) { }  // 尝试创建文件夹
    const mp3 = path.join(_path, `${start}.mp3`)
    const pcm = path.join(_path, `${start}.pcm`)
    const silk = path.join(_path, `${start}.silk`)
    fs.writeFileSync(silk, await this.silkEncode(file, mp3, pcm))
    common.mark('Lain-plugin', 'pcm => silk 完成!')
    /** 保存为MP3文件 */
    // fs.writeFileSync(mp3, await Bot.Buffer(file))
    // /** mp3 转 pcm */
    // await this.runFfmpeg(mp3, pcm)
    // common.mark('Lain-plugin', 'mp3 => pcm 完成!')
    // common.mark('Lain-plugin', 'pcm => silk 进行中!')

    /** pcm 转 silk */
    // await encodeSilk(fs.readFileSync(pcm), 48000)
    //   .then((silkData) => {
    //     /** 转silk完成，保存 */
    //     fs.writeFileSync(silk, silkData?.data || silkData)
    //     /** 删除初始mp3文件 */
    //     fs.promises.unlink(mp3, () => { })
    //     /** 删除pcm文件 */
    //     fs.promises.unlink(pcm, () => { })
    //     common.mark('Lain-plugin', 'pcm => silk 完成!')
    //   })
    //   .catch((err) => {
    //     /** 删除初始mp3文件 */
    //     fs.promises.unlink(mp3, () => { })
    //     /** 删除pcm文件 */
    //     fs.promises.unlink(pcm, () => { })
    //     common.error('Lain-plugin', `转码失败${err}`)
    //     return { type: 'text', text: `转码失败${err}` }
    //   })
    try {
      if (Bot?.audioToUrl) {
        const { url } = await Bot.audioToUrl(silk)
        common.mark('Lain-plugin', `使用自定义图床发送语音：${url}`)
        common.log('Lain-plugin', `url：${url}`)
        fs.promises.unlink(mp3, () => { })
        fs.promises.unlink(pcm, () => { })
        fs.promises.unlink(silk, () => { })
        return { type, file: url }
      }
    } catch (error) {
      logger.error('[调用错误][自定义图床] 将继续公网发送语音')
      logger.error(error)
    }

    const { url } = await Bot.FileToUrl(file)
    common.mark('Lain-plugin', `使用公网临时服务器：${url}`)
    fs.promises.unlink(mp3, () => { })
    fs.promises.unlink(pcm, () => { })
    fs.promises.unlink(silk, () => { })
    return { type, file: url }
  }

  /** 新版 Markdown：仅使用 content */
  async markdown(e, data, Button = true) {
    const message = [{ type: 'markdown', content: await this.makeMarkdownContent(e, data) }]
    if (Button) {
      const buttonRows = this.normalizeButtons(e, await this.button(e))
      if (buttonRows?.length) {
        message.push({ type: 'keyboard', content: { rows: buttonRows } })
      }
    }
    return message
  }

  normalizeButtons(e, input) {
    const result = []
    const pushRow = row => {
      if (row?.type === 'keyboard' && row.content?.rows) {
        for (const item of row.content.rows) pushRow(item)
        return
      }
      if (row?.type === 'button' && Array.isArray(row.buttons)) {
        pushRow(row.buttons)
        return
      }
      if (row?.buttons && Array.isArray(row.buttons)) {
        pushRow(row.buttons)
        return
      }

      const items = Array.isArray(row) ? row : [row]
      const buttons = []
      for (const btn of items) {
        if (!btn) continue
        if (btn.render_data && btn.action) {
          const inlineCommand = Number(btn.action.type) === 0
            ? this.parseMqqapiInlineCommand(btn.action.data)
            : null
          const requiresInput = this.isInputRequiredButton(btn)
          if (inlineCommand) {
            buttons.push(this.normalizeConversationButtonAction(e, {
              ...btn,
              action: {
                ...btn.action,
                type: 2,
                data: inlineCommand.command,
                enter: inlineCommand.enter
              }
            }, true, false))
          } else {
            buttons.push(this.normalizeConversationButtonAction(
              e,
              btn,
              !!btn.inlineCommand || requiresInput,
              requiresInput
            ))
          }
        } else {
          const inlineCommand = btn.link ? this.parseMqqapiInlineCommand(btn.link) : null
          const requiresInput = this.isInputRequiredButton(btn)
          const built = this.buildButton(e, {
            text: btn.text ?? btn.label ?? btn.data ?? btn.input ?? btn.callback ?? btn.link ?? '',
            clicked_text: btn.clicked_text ?? btn.visited_label,
            link: inlineCommand ? undefined : btn.link,
            callback: btn.callback,
            input: inlineCommand?.command ?? btn.input ?? (!btn.link && btn.callback == null ? btn.data : undefined),
            send: inlineCommand?.enter ?? btn.send ?? btn.enter ?? false,
            permission: btn.permission ?? (btn.admin ? 'admin' : btn.list),
            style: btn.style,
            tips: btn.tips ?? btn.unsupport_tips,
            QQBot: btn.QQBot,
          }, buttons.length % 2, !!(inlineCommand || btn.inlineCommand), requiresInput)
          if (built) {
            buttons.push(this.normalizeConversationButtonAction(
              e,
              built,
              !!(inlineCommand || btn.inlineCommand || requiresInput),
              requiresInput
            ))
          }
        }
        if (buttons.length >= 5) {
          result.push({ buttons: buttons.splice(0, 5) })
          if (result.length >= 5) return
        }
      }
      if (buttons.length) result.push({ buttons })
    }

    if (input?.type === 'keyboard' && input.content?.rows) {
      for (const row of input.content.rows) pushRow(row)
      return result.slice(0, 5)
    }

    if (input?.type === 'button' && Array.isArray(input.buttons)) {
      pushRow(input.buttons)
      return result.slice(0, 5)
    }

    if (input?.buttons && Array.isArray(input.buttons)) {
      pushRow(input)
      return result.slice(0, 5)
    }

    const rows = input?.type === 'button' ? input.data : input
    const source = Array.isArray(rows) ? rows : [rows]
    for (const row of source) {
      if (!row) continue
      pushRow(row)
      if (result.length >= 5) break
    }
    return result
  }

  /** 官方 Markdown 消息构造：统一使用 content 发送 */
  async makeMarkdownSegment(e, data, options = {}) {
    return {
      type: 'markdown',
      content: await this.makeMarkdownContent(e, data, options)
    }
  }

  async makeMarkdownContent(e, data, options = {}) {
    if (typeof options.content === 'string') return options.content
    if (typeof data === 'string') return data
    if (data?.type === 'markdown') data = data.data || data
    if (typeof data?.content === 'string') return data.content
    if (Array.isArray(data?.params)) return data.params.flatMap(i => i.values || []).join('\r')

    const msg = common.array(data)
    const content = []

    for (let i of msg) {
      switch (i.type) {
        case 'text':
        case 'forward':
          if (i.text) content.push(String(i.text).replace(/@/g, '@\u200B').replace(/<qqbot-/g, '<qqbot-\u200B'))
          break
        case 'at':
          if (!e?.group_id) break
          if ((i.qq || i.id) === 'all') {
            content.push('<qqbot-at-everyone />')
          } else {
            let qq
            if (Bot.QQToOpenid) {
              try {
                qq = await Bot.QQToOpenid(i.qq || i.id, e)
              } catch { }
            }
            qq = this.stripQQBotId(qq || i.qq || i.id || '')
            content.push(`<qqbot-at-user id="${qq}" />`)
          }
          break
        case 'image': {
          const image = await this.getImage(i?.url || i.file, e)
          content.push(`![${i.summary || '图片'} #${image.width || 0}px #${image.height || 0}px](${String(image.file).replace(/_/g, '%5F')})`)
          break
        }
        case 'markdown':
          if (typeof i.data === 'string') content.push(i.data)
          else if (i.data?.content) content.push(i.data.content)
          else if (i.content) content.push(i.content)
          break
        default:
          if (typeof i === 'string') content.push(i)
          break
      }
    }

    return content.join('')
  }

  async makeMarkdownMessage(e, data, options = {}) {
    const markdown = await this.makeMarkdownSegment(e, data, options)
    const inlineCommands = this.extractMqqapiInlineCommands(markdown.content)
    markdown.content = inlineCommands.content || (inlineCommands.buttons.length ? ' ' : inlineCommands.content)
    const message = [markdown]

    const btnRows = this.normalizeButtons(e, options.buttons || options.button)
    const inlineButtonRows = this.normalizeButtons(e, [inlineCommands.buttons])
    const allButtonRows = [...inlineButtonRows, ...btnRows].slice(0, 5)
    if (allButtonRows.length) {
      message.push({ type: 'keyboard', content: { rows: allButtonRows } })
    }

    return message
  }

  /** 解析 QQ 内联命令链接，用原生输入按钮发送命令，避免按外部应用链接打开。 */
  parseMqqapiInlineCommand (link) {
    try {
      const url = new URL(String(link || '').replace(/&amp;/g, '&'))
      if (url.protocol !== 'mqqapi:' || url.hostname !== 'aio' || url.pathname !== '/inlinecmd') return null
      const command = url.searchParams.get('command')
      if (command == null || !command.trim()) return null
      return {
        command,
        enter: /^(true|1)$/i.test(url.searchParams.get('enter') || '')
      }
    } catch {
      return null
    }
  }

  /** 从 Markdown 正文提取 mqqapi inlinecmd 链接并保留为底部原生按钮。 */
  extractMqqapiInlineCommands (content) {
    const buttons = []
    const markdown = String(content || '').replace(
      /\[([^\]]+)\]\s*\(\s*(mqqapi:\/\/aio\/inlinecmd\?[^\s)]+)\s*\)/gi,
      (link, label, url) => {
        const command = this.parseMqqapiInlineCommand(url)
        if (!command) return link
        buttons.push({ text: label.trim(), input: command.command, send: command.enter, inlineCommand: true })
        return ''
      }
    )

    return {
      content: markdown.replace(/\n{3,}/g, '\n\n').trim(),
      buttons
    }
  }

  async sendMarkdownReplyMsg(e, data, options = {}) {
    const message = await this.makeMarkdownMessage(e, data, options)
    const ret = await this.sendMsg(e, message)
    if (!ret.ok) throw new Error(ret.data)
    return this.returnResult(ret.data)
  }

  /** 按钮添加 */
  async button(e) {
    try {
      // 合并后的扩展文件含有来自多个旧文件的规则；按规则原优先级统一排序。
      const rules = []
      for (const module of Button) {
        for (const rule of module.plugin.rule) {
          rules.push({
            module,
            rule,
            priority: Number(rule.priority ?? module.plugin.priority),
            source: String(rule.sourceFile ?? module.plugin._path ?? '')
          })
        }
      }
      rules.sort((a, b) => a.priority - b.priority || a.source.localeCompare(b.source, 'zh-CN'))
      for (const { module, rule } of rules) {
        if (new RegExp(rule.reg).test(this.getButtonCommand(e))) {
          module.e = e
          const button = await module[rule.fnc](e)
          if (button) return [...(Array.isArray(button) ? button : [button])]
        }
      }
      return false
    } catch (error) {
      common.error('Lain-plugin', error)
      return false
    }
  }

  /** 建立以当前 C2C 入站消息为锚点的流式 Markdown 回复。 */
  async openC2CStream (userId, { messageId, msgId, throttleMs = 500 } = {}) {
    const userOpenid = await this.resolveOpenid(userId, 'private')
    const sourceMessageId = String(messageId || msgId || '').trim()
    if (!sourceMessageId) throw new Error('QQBot C2C 流式消息需要入站消息 ID')

    return new C2CStream({
      msgId: sourceMessageId,
      // stream_messages 的 event_id 锚定入站消息；腾讯当前 SDK 默认同 msg_id。
      eventId: sourceMessageId,
      throttleMs,
      logger,
      send: payload => this.sdk.request.post(
        `/v2/users/${encodeURIComponent(userOpenid)}/stream_messages`,
        payload
      )
    })
  }

  /** C2C 输入状态通知（msg_type=6）。 */
  async sendInputNotify (userId, { messageId, msgId, inputSecond = 60 } = {}) {
    const userOpenid = await this.resolveOpenid(userId, 'private')
    const sourceMessageId = String(messageId || msgId || '').trim()
    if (!sourceMessageId) throw new Error('QQBot 输入状态通知需要 C2C 入站消息 ID')

    const seconds = Number(inputSecond)
    const payload = {
      msg_type: 6,
      msg_seq: nextQQBotMessageSeq(),
      input_notify: {
        input_type: 1,
        input_second: Number.isFinite(seconds) ? Math.max(1, Math.min(60, Math.floor(seconds))) : 60
      }
    }
    payload.msg_id = sourceMessageId

    const { data } = await this.sdk.request.post(
      `/v2/users/${encodeURIComponent(userOpenid)}/messages`,
      payload
    )
    return data
  }

  /** 发送私聊消息；未传入 source 时按主动消息发送，有上下文时使用被动回复字段。 */
  async sendFriendMsg(userId, data, source = {}) {
    userId = await this.resolveOpenid(userId, 'private')
    /** 构建一个普通e给按钮用 */
    let e = {
      bot: Bot[this.id],
      user_id: userId,
      message: common.array(data)
    }

    e.message.forEach(i => { if (i.type === 'text') e.msg = (e.msg || '') + (i.text || '').trim() })
    const { Pieces, reply } = await this.getQQBot(data, e)
    let result
    for (let i of Pieces) {
      if (reply) i = Array.isArray(i) ? [...i, reply] : [i, reply]
      const res = await this.sendQQBotPiece('user', userId, i, source)
      // OneBot 一条消息可能被拆分为多个官方消息；返回第一个消息 ID。
      result ||= res
      logger.debug('发送主动好友消息：', JSON.stringify(i))
      this.send_count()
    }
    if (!result) throw new Error('QQBot 未返回私聊消息 ID')
    return this.returnResult(result)
  }

  /**
   * 发送群主动消息。
   * 不携带 msg_id/event_id；群主须开启机器人主动发言权限。
   */
  async sendGroupMsg(groupID, data, source = {}) {
    const context = typeof source === 'string' ? { messageId: source } : (source || {})
    let state
    if (!context.messageId && !context.msgId && !context.id && !context.eventId) {
      state = await this.getGroupBotState(groupID)
      if (!state.allow_proactive_msg) {
        throw new Error('QQBot 群主动消息发送失败：该群未开启机器人主动推送，请群主在群机器人设置中开启')
      }
    }
    /** 构建一个普通e给按钮用 */
    let e = {
      bot: Bot[this.id],
      group_id: groupID,
      qqbot_recv_msg_setting: context.recvMsgSetting || state?.recv_msg_setting,
      user_id: 'QQBot',
      message: common.array(data)
    }

    e.message.forEach(i => { if (i.type === 'text') e.msg = (e.msg || '') + (i.text || '').trim() })
    const { Pieces, reply } = await this.getQQBot(data, e)
    groupID = await this.resolveOpenid(groupID, 'group')

    let result
    for (let i of Pieces) {
      if (reply) i = Array.isArray(i) ? [...i, reply] : [i, reply]
      const res = await this.sendQQBotPiece('group', groupID, i, source)
      // OneBot 一条消息可能被拆分为多个官方消息；返回第一个消息 ID。
      result ||= res
      this.send_count()
      logger.debug('发送主动群消息：', JSON.stringify(i))
    }
    if (!result) throw new Error('QQBot 未返回群消息 ID')
    return this.returnResult(result)
  }

  /** 主动发送 OneBot 文件。 */
  async sendFriendFile (userId, file, name, source = {}) {
    userId = await this.resolveOpenid(userId, 'private')
    return this.returnResult(await this.sendRichFile('user', userId, file, name, source))
  }

  /** 主动发送 OneBot 文件。 */
  async sendGroupFile (groupID, file, name) {
    const state = await this.getGroupBotState(groupID)
    if (!state.allow_proactive_msg) {
      throw new Error('QQBot 群主动文件发送失败：该群未开启机器人主动推送，请群主在群机器人设置中开启')
    }
    groupID = await this.resolveOpenid(groupID, 'group')
    return this.returnResult(await this.sendRichFile('group', groupID, file, name))
  }

  /** 私聊 Markdown 不支持 @ 标签；也清理插件直接提供的 Markdown 内容。 */
  stripC2CAtTags (content) {
    return String(content ?? '').replace(/<qqbot-at-(?:user|everyone)\b[^>]*\/>/gi, '')
  }

  /** 一条云崽消息可包含普通内容和文件；文件通过富媒体接口单独发送。 */
  async sendQQBotPiece (targetType, targetId, message, source = {}) {
    const parts = common.array(message)
    const files = parts.filter(item => item?.type === 'file')
    const normal = parts.filter(item => item?.type !== 'file')
    const reply = normal.find(item => item?.type === 'reply')
    const normalContent = normal.filter(item => item?.type !== 'reply').map(item => {
      if (targetType !== 'user' || item?.type !== 'markdown' || typeof item.content !== 'string') return item
      return { ...item, content: this.stripC2CAtTags(item.content) }
    })
    const context = typeof source === 'string' ? { messageId: source } : (source || {})
    const sourceMessageId = context.messageId || context.msgId || context.id || reply?.id || ''
    const sourceEventId = context.eventId || reply?.event_id || ''
    const sendSource = sourceEventId
      ? (sourceMessageId ? { messageId: sourceMessageId } : { eventId: sourceEventId })
      : sourceMessageId ? { messageId: sourceMessageId } : {}
    let result

    for (const file of files) {
      const sent = await this.sendRichFile(targetType, targetId, file.file || file.url, file.name, sendSource)
      result ||= sent
    }
    // 文件消息的 reply 段已被转换为 msg_id；避免再单独发送一个空引用消息。
    if (normalContent.length) {
      const send = targetType === 'group' ? this.sdk.sendGroupMessage.bind(this.sdk) : this.sdk.sendPrivateMessage.bind(this.sdk)
      const useEventReply = !!sourceEventId && !sourceMessageId
      const sendable = useEventReply
        ? [{ type: 'reply', event_id: sourceEventId }, ...normalContent]
        : normalContent
      // 只传 SDK source.id，让 SDK 设置官方 msg_id/msg_seq；不传 reply 段，
      // 避免其额外写入 C2C 暂不支持的 message_reference 字段。
      const sdkSource = !useEventReply && sourceMessageId ? { id: sourceMessageId } : undefined
      const sent = await send(encodeURIComponent(targetId), sendable, sdkSource)
      await this.cacheSentMessage(targetType === 'group' ? 'group' : 'user', targetId, sent, normalContent)
      result ||= sent
    }
    if (!result) throw new Error('QQBot 消息内容为空')
    return result
  }

  /** 快速回复 */
  async sendReplyMsg(e, msg) {
    if (typeof msg === 'string' && msg.includes('歌曲分享失败：')) return false
    let res
    const { Pieces, normalMsg } = await this.getQQBot(msg, e)
    common.log('Lain-plugin', `Pieces: ${JSON.stringify(Pieces)}, normalMsg: ${JSON.stringify(normalMsg)}`)

    for (const i in Pieces) {
      if (!Pieces[i] || Object.keys(Pieces[i]).length === 0) continue
      let { ok, data } = await this.sendMsg(e, Pieces[i])
      if (ok) { res = data; continue }

      /** 错误文本处理 */
      data = data.match(/code\(\d+\): .*/)?.[0] || data

      /** 新版Markdown失败时降级为普通消息 */
      if (normalMsg.length) {
        let val
        for (const p of normalMsg) try { val = await this.sendMsg(e, p) } catch { }
        if (val?.ok) return this.returnResult(val.data)
      }
      const val = await this.sendMsg(e, data)
      return this.returnResult(val.data)
    }

    return this.returnResult(res)
  }

  /** 发送消息 */
  async sendMsg(e, msg) {
    try {
      this.send_count()
      logger.debug('发送回复消息：', JSON.stringify(msg))
      const replyId = e.qqbot_message_id || e.message_id || e.data?.id
      const source = { messageId: replyId }
      if (replyId) msg = Array.isArray(msg) ? [{ type: 'reply', id: replyId }, ...msg] : [{ type: 'reply', id: replyId }, msg]
      if (!e.friend) {
        return { ok: true, data: await this.sendQQBotPiece('group', e.group_openid || e.data?.group_openid || e.data?.group_id, msg, source) }
      } else {
        return { ok: true, data: await this.sendQQBotPiece('user', e.user_openid || e.member_openid || e.data?.author?.user_openid || e.data?.user_id, msg, source) }
      }
    } catch (err) {
      const error = err.message || err
      common.error(e.self_id, error)
      return { ok: false, data: error }
    }
  }

  /** 返回结果 */
  returnResult(res) {
    const { timestamp } = res
    const time = (new Date(timestamp)).getTime()
    res = {
      ...res,
      rand: 1,
      time,
      message_id: res?.id
    }
    common.debug('Lain-plugin', res)
    return res
  }

  /** 转换文本中的URL为图片 */
  HandleURL(msg) {
    const message = []
    if (msg?.text) msg = msg.text
    /** 需要处理的url */
    let urls = Bot.getUrls(msg, Cfg.WhiteLink)

    urls.forEach(link => {
      message.push(...Bot.Button([{ link }]))
      msg = msg.replace(link, '[链接(请点击按钮查看)]')
      msg = msg.replace(link.replace(/^http:\/\//g, ''), '[链接(请点击按钮查看)]')
      msg = msg.replace(link.replace(/^https:\/\//g, ''), '[链接(请点击按钮查看)]')
    })
    message.unshift({ type: 'text', text: msg })
    return message
  }

  /** 获取日期 */
  getNowDate() {
    const date = new Date()
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    const [{ value: month }, , { value: day }, , { value: year }] = dtf.formatToParts(date)
    return `${year}-${month}-${day}`
  }

  /** 初始化 */
  async getDAU() {
    const time = this.getNowDate()
    const msg_count = (await redis.get(`QQBotDAU:msg_count:${this.id}`)) || 0
    const send_count = (await redis.get(`QQBotDAU:send_count:${this.id}`)) || 0
    let data = await redis.get(`QQBotDAU:${this.id}`)
    if (data) {
      data = JSON.parse(data)
      data.msg_count = Number(msg_count)
      data.send_count = Number(send_count)
      data.time = time
      return data
    } else {
      return {
        user_count: 0, // 上行消息人数
        group_count: 0, // 上行消息群数
        msg_count, // 上行消息量
        send_count, // 下行消息量
        user_cache: {},
        group_cache: {},
        time
      }
    }
  }

  /** dau统计 */
  async dau() {
    try {
      if (!Cfg.Other.QQBotdau) return
      if (!lain.DAU[this.id]) lain.DAU[this.id] = await this.getDAU()
      lain.DAU[this.id].send_count++
      const time = moment(Date.now()).add(1, 'days').format('YYYY-MM-DD 00:00:00')
      const EX = Math.round((new Date(time).getTime() - new Date().getTime()) / 1000)
      redis.set(`QQBotDAU:send_count:${this.id}`, lain.DAU[this.id].send_count * 1, { EX })
    } catch (error) {
      logger.error(error)
    }
  }

  /** 下行消息量 */
  async send_count() {
    try {
      if (!Cfg.Other.QQBotdau) return
      if (!lain.DAU[this.id]) lain.DAU[this.id] = await this.getDAU()
      lain.DAU[this.id].send_count++
      const time = moment(Date.now()).add(1, 'days').format('YYYY-MM-DD 00:00:00')
      const EX = Math.round((new Date(time).getTime() - new Date().getTime()) / 1000)
      redis.set(`QQBotDAU:send_count:${this.id}`, lain.DAU[this.id].send_count * 1, { EX })
    } catch (error) {
      logger.error(error)
    }
  }

  /** 上行消息量 */
  async msg_count(data) {
    try {
      if (!Cfg.Other.QQBotdau) return
      let needSetRedis = false
      if (!lain.DAU[this.id]) lain.DAU[this.id] = await this.getDAU()
      lain.DAU[this.id].msg_count++
      if (data.group_id && !lain.DAU[this.id].group_cache[data.group_id]) {
        lain.DAU[this.id].group_cache[data.group_id] = 1
        lain.DAU[this.id].group_count++
        needSetRedis = true
      }
      if (data.user_id && !lain.DAU[this.id].user_cache[data.user_id]) {
        lain.DAU[this.id].user_cache[data.user_id] = 1
        lain.DAU[this.id].user_count++
        needSetRedis = true
      }
      const time = moment(Date.now()).add(1, 'days').format('YYYY-MM-DD 00:00:00')
      const EX = Math.round((new Date(time).getTime() - new Date().getTime()) / 1000)
      if (needSetRedis) redis.set(`QQBotDAU:${this.id}`, JSON.stringify(lain.DAU[this.id]), { EX })
      redis.set(`QQBotDAU:msg_count:${this.id}`, lain.DAU[this.id].msg_count * 1, { EX })
    } catch (error) {
      logger.error(error)
    }
  }

  // ========== 交互事件处理 ==========

  /** 处理按钮交互事件 */
  async handleInteraction (event) {
    // SDK 的互动事件同时广播给 QQBot 与 QQGuild；只处理群和 C2C 场景。
    const scene = event.notice_type || event.scene ||
      (event.group_id || event.group_openid ? 'group' : event.user_openid ? 'c2c' : '')
    if (!['group', 'friend', 'c2c'].includes(scene)) return
    const interactionType = Number(event.data?.type ?? event.type)
    // 官方仅要求消息按钮和单聊快捷菜单回调；反馈、授权等互动不是命令。
    if (Number.isFinite(interactionType) && ![11, 12].includes(interactionType)) return
    const btnId = event.data?.resolved?.button_id
    const btnData = event.data?.resolved?.button_data
    // SDK 将互动事件体的 d.id 存在 notice_id，Gateway 最外层的 id 存在 event_id。
    // PUT /interactions 使用前者；群/C2C 被动消息的 event_id 必须使用后者。
    const interactionId = event.notice_id || event.id
    const replyEventId = event.event_id
    const operatorId = event.operator_id || event.user_openid || event.group_member_openid || event.operator_openid || event.user_id
    const ownCallback = btnId && Bot[this.id]?.callback?.[btnId]
    // 旧消息可能由频道按钮构造器生成；只借用其命令文本，群上下文始终取官方事件。
    const callback = ownCallback || (btnId && Bot[`qg_${this.id}`]?.callback?.[btnId])
    const groupId = event.group_id || event.group_openid || ownCallback?.group_id

    const acknowledge = async code => {
      try {
        const ok = typeof event.reply === 'function'
          ? await event.reply(code)
          : await this.sdk.replyAction(interactionId, code)
        if (ok === false) logger.warn(`QQBot 按钮互动回应失败：${interactionId}`)
      } catch (error) {
        logger.error(`QQBot 按钮互动回应失败：${interactionId} ${error?.message || error}`)
      }
    }

    if (!operatorId) {
      await acknowledge(1)
      return
    }

    let msg = ''

    if (callback) {
      msg = callback.message || ''
    } else if (btnData) {
      msg = btnData
    }

    if (!msg) {
      logger.warn(`QQBot 按钮回调缺少命令：scene=${scene} button_id=${btnId || ''}`)
      await acknowledge(1)
      return
    }

    if (!replyEventId) {
      logger.error(`QQBot 按钮回调缺少 Gateway 事件 ID：interaction=${interactionId || ''}`)
      await acknowledge(1)
      return
    }

    await acknowledge(0)

    // 回调 data 与用户发来的指令走同一套斜杠、别名前缀处理。
    msg = String(msg)
    try {
      if (this.isSlashToHashEnabled() && (groupId || this.isSlashCommand(msg))) {
        msg = this.hasAlias(msg, { group_id: groupId ? this.formatQQBotId(groupId) : undefined })
      }
      msg = this.normalizeCommandText(msg)
    } catch (error) {
      logger.error(`QQBot 按钮命令转换失败：${interactionId} ${error?.message || error}`)
    }

    const data = {
      raw: event,
      bot: Bot[this.id],
      self_id: this.id,
      adapter: 'QQBot',
      post_type: 'message',
      message_type: groupId ? 'group' : 'private',
      isGroup: !!groupId,
      isPrivate: !groupId,
      sub_type: 'callback',
      qqbot_event_type: 'INTERACTION_CREATE',
      qqbot_event_id: replyEventId,
      qqbot_interaction_id: interactionId,
      message_id: 'event_' + replyEventId,
      time: Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) / 1000 : Date.now() / 1000,
      user_id: this.formatQQBotId(operatorId),
      user_openid: groupId ? undefined : operatorId,
      member_openid: groupId ? operatorId : undefined,
      group_id: groupId ? this.formatQQBotId(groupId) : undefined,
      group_openid: groupId || undefined,
      sender: {
        user_id: this.formatQQBotId(operatorId),
        user_openid: groupId ? undefined : operatorId,
        member_openid: groupId ? operatorId : undefined
      },
      message: [
        { type: 'text', text: msg },
      ],
      atme: true,
      qqbot_recv_msg_setting: callback?.recv_msg_setting,
      raw_message: msg,
      msg,
      reply: async (replyMsg) => {
        const hasExplicitButtons = common.array(replyMsg).some(item =>
          item?.type === 'keyboard' || item?.type === 'button' || QQBotButton.isButton(item)
        )
        const isProfilePanel = /^#面板(?:\s*\d{9,10})?$/.test(String(data.msg || ''))
        if (!hasExplicitButtons || isProfilePanel) {
          const buttons = await this.button(data)
          if (buttons?.length) {
            const content = isProfilePanel
              ? common.array(replyMsg).filter(item => item?.type !== 'keyboard' && item?.type !== 'button')
              : common.array(replyMsg)
            replyMsg = [...content, ...buttons]
          }
        }
        if (groupId) {
          return this.sendGroupMsg(groupId, replyMsg, {
            eventId: replyEventId,
            recvMsgSetting: callback?.recv_msg_setting
          })
        } else {
          return this.sendFriendMsg(operatorId, replyMsg, { eventId: replyEventId })
        }
      },
    }

    // YunZai 装载器会将 text 段再次拼入 e.msg；与普通入站消息使用同一赋值器去重。
    this.defineIncomingMsg(data)
    this.rememberButtonCommand(data)

    if (data.group_id) {
      data.group = this.pickGroup(groupId)
      common.mark('Lain-plugin', '群按钮点击: [' + data.group_id + ', ' + data.user_id + '] ' + msg)
    } else {
      data.friend = this.pickFriend(data.user_id, { eventId: replyEventId })
      common.mark('Lain-plugin', '好友按钮点击: [' + data.user_id + '] ' + msg)
    }

    data.sendMsg = data.reply
    // 回调也可能执行调用 e.markdown() 的插件；沿用互动 ID 的被动回复上下文。
    data.markdown = async (content, options = {}) => {
      if (!options.buttons && !options.button) {
        const buttons = await this.button(data)
        if (buttons?.length) options = { ...options, buttons }
      }
      return data.reply(await this.makeMarkdownMessage(data, content, options))
    }
    data.replyMarkdown = data.markdown
    data.sendMarkdown = data.markdown

    try {
      if (groupId) {
        QQBotIdMap.applyStoredMapping(data)
        await Bot.emit('message.group', data)
      } else {
        await QQBotIdMap.handleQQBotPrivateMessage(data, async e => {
          await Bot.emit('message.private', e)
          await Bot.emit('message', e)
        })
        return
      }
      await Bot.emit('message', data)
    } catch (error) {
      logger.error(`QQBot 按钮命令处理失败：${interactionId} ${error?.stack || error}`)
    }
  }

  // ========== 新版本 Button 构建器 ==========

  /**
   * 构建单个按钮
   * btn: { text, link?, callback?, input?, send?, permission?, style?, clicked_text?, QQBot? }
   * action type: 0=link, 1=callback, 2=input
   * permission: 'all'(默认) | 'admin' | ['uid1', 'uid2']
   */
  buildButton (e, btn, style = 0, preserveInput = false, requiresInput) {
    const keepInput = requiresInput ?? this.isInputRequiredButton(btn)
    const id = 'bt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    const msg = {
      id,
      render_data: {
        label: btn.text || '',
        visited_label: btn.clicked_text || btn.text || '',
        style: btn.style != null ? Number(btn.style) : style,
        ...(btn.QQBot?.render_data || {}),
      },
    }

    if (btn.callback != null) {
      msg.action = {
        type: 1,
        permission: { type: 2 },
        data: btn.callback,
        enter: false,
        unsupport_tips: btn.tips || '暂不支持此按钮',
        ...(btn.QQBot?.action || {}),
      }
      msg.action.type = 1
    } else if (!btn.link && (btn.input != null || btn.data != null)) {
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: btn.input ?? btn.data,
        enter: keepInput ? false : !!btn.send,
        unsupport_tips: btn.tips || '暂不支持此按钮',
        ...(btn.QQBot?.action || {}),
      }
      msg.action.type = 2
    } else if (btn.link) {
      msg.action = {
        type: 0,
        permission: { type: 2 },
        data: btn.link,
        enter: false,
        unsupport_tips: btn.tips || '暂不支持此按钮',
        ...(btn.QQBot?.action || {}),
      }
    } else {
      return false
    }

    /** 权限控制 */
    if (btn.permission) {
      if (btn.permission === 'admin') {
        msg.action.permission.type = 1
      } else if (Array.isArray(btn.permission)) {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = btn.permission.map(
          id => String(id).replace(this.id + '-', ''),
        )
      }
    }

    return this.normalizeConversationButtonAction(e, msg, preserveInput || keepInput, keepInput)
  }

  /** 判断需要用户继续填写内容的按钮，避免被转换成点击即执行的回调。 */
  isInputRequiredButton (button) {
    const action = button?.action || button || {}
    const explicit = [
      button?._lainRequiresInput,
      button?.requiresInput,
      button?.requires_input,
      button?.inputOnly,
      button?.input_only,
      button?.keepInput,
      button?.keep_input,
      action?.requiresInput,
      action?.requires_input,
      action?.inputOnly,
      action?.input_only
    ].find(value => value !== undefined)
    // callback 是作者明确选择的动作，不能按命令内容猜测成输入按钮。
    if (Number(action.type) === 1 || button?.callback != null) return false
    if (explicit !== undefined) return !!explicit

    const inferredType = button?.link
      ? 0
      : button?.callback
        ? 1
        : (button?.input !== undefined || button?.data !== undefined ? 2 : undefined)
    const type = Number(action.type ?? button?.type ?? inferredType)
    if (![1, 2].includes(type)) return false

    const label = String(button?.render_data?.label ?? button?.label ?? button?.text ?? '').trim()
    const data = String(action.data ?? button?.data ?? button?.input ?? button?.callback ?? '').trim()
    const text = `${label} ${data}`.replace(/\s+/g, '')
    if (!text) return false

    // 扫码/帮助类按钮本身不需要用户再填写参数。
    if (/(扫码|二维码|绑定帮助|登录帮助|教程|说明)/i.test(text)) return false

    // 常见需要继续输入 UID、账号或角色的入口。保留“语音接口切换”“换一批”等无需输入的操作，
    // 对其他不确定场景可使用 requiresInput: true 显式标记。
    return /(?:绑定(?:uid|账号|账户)?|切换(?:uid|账号|账户|角色|面板)|(?:删除|解绑)uid|(?:登录|登陆)(?:uid|账号|账户)|(?:账号|账户)(?:登录|登陆))/i.test(text) ||
      /(?:面板|角色).*(?:更换|换)|(?:更换|换)(?:面板|角色)/i.test(text) ||
      /[^换\s]{2,}换[^换\s]{1,}/i.test(text)
  }

  /** 保留作者指定的动作类型；只有回调按钮需要登记互动上下文。 */
  normalizeConversationButtonAction (e, button, preserveInput = false, requiresInput) {
    const keepInput = requiresInput ?? this.isInputRequiredButton(button)
    const actionType = Number(button?.action?.type)
    if (keepInput && actionType === 2) {
      const normalized = {
        ...button,
        action: {
          ...button.action,
          type: 2,
          enter: false,
          reply: false
        }
      }
      Object.defineProperty(normalized, '_lainRequiresInput', {
        value: true,
        enumerable: false,
        configurable: true
      })
      return normalized
    }

    if (actionType === 2) return button
    if (actionType !== 1) return button
    if (String(button.id).startsWith('bt_') && Bot[this.id]?.callback?.[button.id]) return button
    const id = 'bt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    const converted = {
      ...button,
      id,
      action: { ...button.action, enter: false, reply: false }
    }
    this._trackCallback(e, id, converted.action.data)
    return converted
  }

  /** 构建按钮行（支持二维数组） */
  buildButtons (e, rows) {
    const result = []
    for (const row of rows) {
      const buttons = []
      let idx = 0
      for (const btn of (Array.isArray(row) ? row : [row])) {
        const built = this.buildButton(e, btn, idx % 2)
        if (built) buttons.push(built)
        idx++
        if (buttons.length >= 5) break
      }
      if (buttons.length) result.push({ buttons })
      if (result.length >= 5) break
    }
    return result
  }

  /** 追踪回调按钮 */
  _trackCallback (e, btnId, message) {
    if (!Bot[this.id].callback) Bot[this.id].callback = {}
    Bot[this.id].callback[btnId] = {
      id: e.message_id,
      user_id: e.user_id,
      group_id: e.group_id ? String(e.group_id).replace(this.id + '-', '') : undefined,
      message,
      recv_msg_setting: e.qqbot_recv_msg_setting,
      message_id: e._ret_id || [],
    }
    setTimeout(() => {
      if (Bot[this.id]?.callback) delete Bot[this.id].callback[btnId]
    }, 300000)
  }

  // ========== Markdown 内容构建 ==========

  /**
   * 将消息数组转为新版 Markdown content 字符串
   * 支持: text, at, image
   */
  buildMarkdownContent (e, msg) {
    const parts = []
    for (const i of (Array.isArray(msg) ? msg : [msg])) {
      if (typeof i !== 'object') {
        parts.push(String(i))
        continue
      }
      switch (i.type) {
        case 'text':
          parts.push(i.text)
          break
        case 'at':
          if (!e?.group_id) break
          if (i.qq === 'all') {
            parts.push('<qqbot-at-everyone />')
          } else {
            const uid = String(i.qq || i.id || '').replace(this.id + '-', '')
            parts.push('<qqbot-at-user id="' + uid + '" />')
          }
          break
        case 'image': {
          const url = i.file || i.url || ''
          const w = i.width || 0
          const h = i.height || 0
          parts.push('![img #' + w + 'px #' + h + 'px](' + url + ')')
          break
        }
        default:
          break
      }
    }
    return parts.join('')
  }

}

common.info('Lain-plugin', 'QQ群Bot适配器加载完成')
