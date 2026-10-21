import { Bot as QQBot } from 'qq-group-bot'
import EventIndex from 'qq-group-bot/lib/event/index.js'
import Constans from 'qq-group-bot/lib/constans.js'
import axios from 'axios'
import Cfg from '../../../../lib/config/config.js'
import common from '../../lib/common/common.js'
import { installQQBotAPIPolicy } from './APIPolicy.js'
import { normalizeMentions, isAtAll } from './Mentions.js'

export default class QQSDK {
  constructor (config) {
    this.config = config
    QQSDK.patchSDKEvents()
    QQSDK.registerWebHook()
  }

  async start () {
    /** appid */
    this.id = this.config.appid
    /** 保留原始 at，后续由适配层统一识别和裁剪 */
    this.config.removeAt = false
    /** QQBotID */
    this.QQBot = this.config.appid
    /** QQGuidID */
    this.QQGuid = `qg_${this.config.appid}`
    /**
     * 最大重连次数。0 表示不限次数；以前使用 `||` 会把 0 重新设为 10。
     * 这里的次数用于连接失败后的退避重试，WebSocket 正常断线仍由 SDK 处理。
     */
    this.config.maxRetry = this.config.maxRetry ?? 10
    /** QQ OpenAPI 在网络较慢时 5 秒很容易超时，未配置时使用 10 秒。 */
    const timeout = Number(this.config.timeout)
    this.config.timeout = Number.isFinite(timeout) && timeout > 0 ? timeout : 10000
    /** 日志等级 */
    this.config.logLevel = Cfg.bot.log_level
    /** 频道模式 */
    this.sandbox = this.config.allMsg || false
    /** 监听事件 */
    this.config.intents = []

    /** 是否启用群 */
    if (this.config.model == 0 || this.config.model == 2) {
      /** 群聊和单聊事件 */
      this.config.intents.push('GROUP_AND_C2C_EVENT')
      this.config.intents.push('GROUP_MEMBER_EVENT')
      /** 可选接收群内全量消息；与需要 @ 机器人的默认群事件分开订阅。 */
      if (this.config.groupAllMsg) this.config.intents.push('GROUP_MESSAGE_CREATE')
    }

    /** 是否启用频道 */
    if (this.config.model == 0 || this.config.model == 1) {
      /** 频道变更事件 */
      this.config.intents.push('GUILDS')
      /** 频道成员变更事件 */
      this.config.intents.push('GUILD_MEMBERS')
      /** 频道私信事件 */
      this.config.intents.push('DIRECT_MESSAGE')
      /** 频道消息表态事件 */
      this.config.intents.push('GUILD_MESSAGE_REACTIONS')
      /** 公域 私域事件 */
      this.sandbox ? this.config.intents.push('GUILD_MESSAGES') : this.config.intents.push('PUBLIC_GUILD_MESSAGES')
    }

    /** 按钮交互事件（回调/表单） */
    this.config.intents.push('INTERACTION')
    /** 消息审核事件 */
    this.config.intents.push('MESSAGE_AUDIT')

    /** 创建机器人 */
    this.sdk = new QQBot(this.config)
    if (!this.config.sandbox) this.sdk.request.defaults.baseURL = 'https://api.bot.qq.com'
    installQQBotAPIPolicy(this.sdk)
    this.patchSessionManager()
    this.patchLogger()

    /** WebHook 模式：仅获取 token，不启动 WebSocket */
    if (this.config.webhook) {
      try {
        await this.getAccessToken()
      } catch (err) {
        this.logConnectionError('获取 access token 失败，将继续刷新', err)
        this.scheduleTokenRefresh(30)
      }
      this.active = true
    } else {
      /** WebSocket 模式：启动长连接 */
      await this.sdk.start()
    }
  }

  /** 修改 sdk 日志为喵崽日志，确保启动阶段的重试日志也能正常输出。 */
  patchLogger () {
    this.sdk.logger = {
      info: (...log) => this.logger(...log),
      trace: (...log) => lain.trace(this.id, ...log),
      debug: (...log) => lain.debug(this.id, ...log),
      mark: (...log) => lain.mark(this.id, ...log),
      warn: (...log) => lain.warn(this.id, ...log),
      error: (...log) => lain.error(this.id, ...log),
      fatal: (...log) => lain.fatal(this.id, ...log)
    }
  }

  /**
   * 修复 qq-group-bot 的两个不可恢复路径：
   *
   * 1. getWsUrl()/getAccessToken() 的 Axios 异常会直接让 start() reject；
   * 2. token 的 setTimeout 回调没有 catch，刷新失败后后续刷新会彻底停止。
   *
   * 补丁只作用于当前机器人实例，不修改 node_modules。
   */
  patchSessionManager () {
    const manager = this.sdk.sessionManager
    const sdkStart = manager.start.bind(manager)

    manager.getAccessToken = () => this.getAccessToken()
    manager.getWsUrl = () => this.getWsUrl()

    manager.start = async () => {
      if (manager.userClose) return
      if (this.connectingPromise) return this.connectingPromise

      const connect = sdkStart().catch(err => {
        this.scheduleReconnect(err)
      })
      this.connectingPromise = connect.finally(() => {
        this.connectingPromise = null
      })
      return this.connectingPromise
    }

    // SDK 在 maxRetry 次 WebSocket 断线后会触发 DEAD 并不再调用 start()。
    // 由适配器统一按照配置继续退避重试，0 表示无限重试。
    manager.on('DEAD', data => {
      manager.retry = 0
      this.scheduleReconnect(new Error(data?.msg || 'WebSocket 连接已停止'))
    })
    manager.on('EVENT_WS', data => {
      if (data?.eventType === 'READY') {
        this.connectionRetry = 0
        this.clearReconnectTimer()
      }
    })
  }

  /** 获取或刷新 AppAccessToken；并发调用共用同一个请求。 */
  async getAccessToken (force = false) {
    const manager = this.sdk.sessionManager
    if (!force && manager.access_token && this.accessTokenExpiresAt > Date.now() + 60 * 1000) {
      return { access_token: manager.access_token }
    }
    if (this.accessTokenPromise) return this.accessTokenPromise

    this.accessTokenPromise = axios.post(
      'https://api.bot.qq.com/app/getAppAccessToken',
      {
        appId: this.config.appid,
        clientSecret: this.config.secret || this.config.clientSecret
      },
      { timeout: this.config.timeout }
    ).then(({ data }) => {
      if (!data?.access_token) throw new Error('获取 access token 的响应不包含 access_token')

      const expiresIn = Number(data.expires_in)
      const validFor = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300
      manager.access_token = data.access_token
      this.accessTokenExpiresAt = Date.now() + validFor * 1000
      this.scheduleTokenRefresh(Math.max(30, validFor - 60))
      return data
    }).finally(() => {
      this.accessTokenPromise = null
    })
    return this.accessTokenPromise
  }

  /** 获取网关地址。异常会交给 manager.start 的重试逻辑处理。 */
  async getWsUrl () {
    const { data } = await this.sdk.request.get('/gateway/bot', {
      headers: {
        Accept: '*/*',
        'Accept-Encoding': 'utf-8',
        'Accept-Language': 'zh-CN,zh;q=0.8',
        Connection: 'keep-alive',
        'User-Agent': 'v1',
        Authorization: ''
      }
    })
    if (!data?.url) throw new Error('获取 WebSocket 网关地址失败：响应中没有 url')
    this.sdk.sessionManager.wsUrl = data.url
  }

  /** 到期前刷新 token；刷新失败后仍会在 30 秒后继续尝试。 */
  scheduleTokenRefresh (afterSeconds) {
    clearTimeout(this.tokenRefreshTimer)
    const delay = Math.max(1, Number(afterSeconds) || 30) * 1000
    this.tokenRefreshTimer = setTimeout(() => {
      this.getAccessToken(true).catch(err => {
        this.logConnectionError('刷新 access token 失败，30 秒后重试', err)
        this.scheduleTokenRefresh(30)
      })
    }, delay)
  }

  /** 网络错误后指数退避重连，避免超时时形成高频请求。 */
  scheduleReconnect (err) {
    const manager = this.sdk.sessionManager
    if (manager.userClose || this.reconnectTimer) return

    const maxRetry = Number(this.config.maxRetry)
    const retryLimit = Number.isFinite(maxRetry) && maxRetry >= 0 ? maxRetry : 10
    if (retryLimit > 0 && this.connectionRetry >= retryLimit) {
      this.logConnectionError(`连接连续失败 ${retryLimit} 次，已停止重试；将 maxRetry 设为 0 可无限重试`, err)
      return
    }

    this.connectionRetry = (this.connectionRetry || 0) + 1
    const delay = Math.min(5000 * 2 ** (this.connectionRetry - 1), 60000)
    this.logConnectionError(`连接失败，第 ${this.connectionRetry} 次重试将在 ${delay / 1000} 秒后进行`, err)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      manager.start().catch(error => this.scheduleReconnect(error))
    }, delay)
  }

  clearReconnectTimer () {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  logConnectionError (message, err) {
    const detail = err?.code || err?.response?.status || err?.message || String(err)
    lain.warn(this.id, `[QQBot] ${message}: ${detail}`)
  }

  /** WebHook 模式：将平台推送的事件注入 SDK */
  dispatchEvent (type, data) {
    this.sdk.dispatchEvent(type, data)
  }

  /** 兼容官方新版事件命名，补齐当前 qq-group-bot 尚未暴露的映射 */
  static patchSDKEvents () {
    if (QQSDK._sdkEventsPatched) return
    QQSDK._sdkEventsPatched = true

    const groupAndC2CIntent = Constans.Intends.C2C_MESSAGE_CREATE || Constans.Intends.GROUP_AT_MESSAGE_CREATE || 33554432
    if (Constans.Intends.GROUP_AND_C2C_EVENT === undefined) {
      Constans.Intends.GROUP_AND_C2C_EVENT = groupAndC2CIntent
    }
    // 群全量消息与群 @ 事件是不同的 gateway event / intent。
    if (Constans.Intends.GROUP_MESSAGE_CREATE === undefined) Constans.Intends.GROUP_MESSAGE_CREATE = 1 << 24
    if (Constans.Intends.GROUP_MEMBER_EVENT === undefined) Constans.Intends.GROUP_MEMBER_EVENT = 1 << 24

    // 成员事件与机器人事件使用相同的 ICQQ 通知名，由原始事件名区分对象。
    EventIndex.QQEvent.GROUP_MEMBER_ADD = 'notice.group.increase'
    EventIndex.QQEvent.GROUP_MEMBER_REMOVE = 'notice.group.decrease'
    for (const eventName of ['notice.group.increase', 'notice.group.decrease']) {
      EventIndex.EventParserMap.set(eventName, function (event, payload) {
        return {
          ...payload,
          bot: this,
          post_type: 'notice',
          notice_type: 'group',
          sub_type: event.split('.').at(-1),
          group_id: payload.group_openid,
          user_id: payload.member_openid,
          operator_id: payload.op_member_openid,
          // 官方事件的 timestamp 已经是秒，旧版 SDK 会再除以 1000。
          time: Number(payload.timestamp) || Math.floor(Date.now() / 1000)
        }
      })
    }

    /** GROUP_MESSAGE_CREATE 与 GROUP_AT_MESSAGE_CREATE 的 payload 同为群消息结构 */
    if (!EventIndex.QQEvent.GROUP_MESSAGE_CREATE) {
      EventIndex.QQEvent.GROUP_MESSAGE_CREATE = 'message.group'
    }
    // 将交互事件单独发给适配器监听器，保留原始 event_id 用于按钮回调的 C2C 回复。
    if (EventIndex.QQEvent.INTERACTION_CREATE === 'notice') {
      EventIndex.QQEvent.INTERACTION_CREATE = 'interaction'
      const parser = EventIndex.EventParserMap.get('notice')
      if (parser && !EventIndex.EventParserMap.has('interaction')) EventIndex.EventParserMap.set('interaction', parser)
    }
    /** 用户申请入群；旧版 SDK 尚未包含该事件映射。 */
    if (!EventIndex.QQEvent.GROUP_JOIN_REQUEST) {
      EventIndex.QQEvent.GROUP_JOIN_REQUEST = 'request.group.add'
    }
    if (!EventIndex.EventParserMap.has('message.group')) {
      EventIndex.EventParserMap.set('message.group', EventIndex.EventParserMap.get(EventIndex.QQEvent.GROUP_AT_MESSAGE_CREATE))
    }

    QQSDK.patchDispatchEventType()
    QQSDK.wrapMessageParser('message.group')
    QQSDK.wrapMessageParser('message.private.friend')
    for (const eventName of [
      'notice.friend.increase',
      'notice.friend.decrease',
      'notice.friend.receive_open',
      'notice.friend.receive_close'
    ]) {
      QQSDK.wrapNoticeEventId(eventName)
    }
  }

  /** qq-group-bot 将 GROUP_AT_MESSAGE_CREATE 与 GROUP_MESSAGE_CREATE 合并到 message.group；恢复原始事件名供适配器分流。 */
  static patchDispatchEventType () {
    const prototype = QQBot.prototype
    const dispatchEvent = prototype.dispatchEvent
    if (!dispatchEvent || dispatchEvent._lainEventTypeWrapped) return

    const wrapped = function (event, wsRes) {
      if (['GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE',
        'GROUP_ADD_ROBOT', 'GROUP_DEL_ROBOT', 'GROUP_MEMBER_ADD', 'GROUP_MEMBER_REMOVE'].includes(event) && wsRes?.d) {
        wsRes = {
          ...wsRes,
          d: { ...wsRes.d, qqbot_event_type: event }
        }
      }
      return dispatchEvent.call(this, event, wsRes)
    }
    wrapped._lainEventTypeWrapped = true
    prototype.dispatchEvent = wrapped
  }

  /** 保留好友增删、私聊消息许可通知的 event_id，供官方 C2C 被动回复使用。 */
  static wrapNoticeEventId (eventName) {
    const parser = EventIndex.EventParserMap.get(eventName)
    if (!parser || parser._lainEventIdWrapped) return

    const wrapped = function (event, payload) {
      const result = parser.apply(this, [event, payload])
      if (result && payload?.event_id) result.event_id = payload.event_id
      return result
    }
    wrapped._lainEventIdWrapped = true
    EventIndex.EventParserMap.set(eventName, wrapped)
  }

  static wrapMessageParser (eventName) {
    const parser = EventIndex.EventParserMap.get(eventName)
    if (!parser || parser._lainOfficialMessageWrapped) return

    const wrapped = function (event, payload) {
      payload = payload || {}
      if (!Array.isArray(payload.mentions)) payload.mentions = []
      const reference = QQSDK.getMessageReference(payload)
      // QQ 群消息的引用信息位于 message_scene.ext 和 msg_elements，旧 SDK
      // 只识别 message_reference，导致引用段与 source 丢失。
      if (reference && !payload.message_reference?.message_id) {
        payload.message_reference = { message_id: reference.messageId }
      }

      const officialMessage = Array.isArray(payload?.message)
        ? payload.message.map(i => ({ ...i }))
        : null
      if (reference && officialMessage && !officialMessage.some(i => i?.type === 'reply')) {
        officialMessage.unshift({ type: 'reply', id: reference.messageId })
      }
      const officialRawMessage = typeof payload?.raw_message === 'string' ? payload.raw_message : null
      const result = parser.apply(this, [event, payload])

      if (result && officialMessage?.length) {
        result.message = officialMessage
      }
      if (result && Array.isArray(result.message)) {
        result.message = normalizeMentions(result.message, payload.mentions || [])
        result.atall = result.message.some(isAtAll)
      }
      if (result && officialRawMessage !== null) {
        result.raw_message = officialRawMessage
      }
      if (result && reference) {
        result.source = {
          ...result.source,
          id: reference.messageId,
          message_id: reference.messageId,
          qqbot_ref_msg_idx: reference.msgIdx,
          raw_message: reference.content || result.source?.raw_message || ''
        }
      }
      return result
    }
    wrapped._lainOfficialMessageWrapped = true
    EventIndex.EventParserMap.set(eventName, wrapped)
  }

  /**
   * 解析群聊引用消息。
   * 官方 GROUP_MESSAGE_CREATE 回调将引用消息放在 msg_elements（message_type=103），
   * 并使用 message_scene.ext 中的 ref_msg_idx 与元素 msg_idx 关联。
   */
  static getMessageReference (payload = {}) {
    const directId = payload.message_reference?.message_id
    if (directId) return { messageId: String(directId) }

    const ext = Array.isArray(payload.message_scene?.ext) ? payload.message_scene.ext : []
    const prefix = 'ref_msg_idx='
    const msgIdx = ext.find(item => typeof item === 'string' && item.startsWith(prefix))?.slice(prefix.length)
    if (!msgIdx) return undefined

    const elements = Array.isArray(payload.msg_elements) ? payload.msg_elements : []
    const element = elements.find(item => item?.msg_idx === msgIdx) ||
      elements.find(item => Number(item?.message_type) === 103)
    const messageId = element?.message_id || element?.msg_id || element?.id || element?.msg_idx || msgIdx
    if (!messageId) return undefined

    return {
      messageId: String(messageId),
      msgIdx,
      content: typeof element?.content === 'string' ? element.content : ''
    }
  }

  /** 全局注册一次 WebHook Express 路由 */
  static registerWebHook () {
    if (QQSDK._webhookRegistered) return
    QQSDK._webhookRegistered = true

    Bot.express.use('/QQBot', (req, res) => {
      req.res = res
      QQSDK.handleWebHook(req)
    })
    if (Bot.express.quiet) {
      Bot.express.quiet.push('/QQBot')
    }
    common.mark('Lain-plugin', 'QQBot WebHook 路由已注册: /QQBot')
  }

  /** 全局 WebHook 请求处理 */
  static handleWebHook (req) {
    const appid = req.headers['x-bot-appid']
    // find bot by appid across all connected instances
    const bot = [Bot[appid], ...Object.values(Bot)].find(
      b => b?.sdk?.id && String(b.sdk.id) === String(appid)
    )

    if (!bot || !bot.sdk) {
      common.warn('Lain-plugin', 'WebHook 找不到对应 Bot: ' + appid)
      return req.res.sendStatus(404)
    }

    /** URL 验证 */
    if (req.body?.d && 'plain_token' in req.body.d) {
      /** 获取密钥 */
      const secret = bot.config?.secret || bot.config?.clientSecret || ''
      import('tweetnacl').then(({ default: nacl }) => {
        const { plain_token, event_ts } = req.body.d
        let paddedSecret = secret
        while (paddedSecret.length < 32) paddedSecret = paddedSecret.repeat(2).slice(0, 32)
        const signature = Buffer.from(
          nacl.sign.detached(
            Buffer.from(event_ts + plain_token),
            nacl.sign.keyPair.fromSeed(Buffer.from(paddedSecret)).secretKey
          )
        ).toString('hex')
        common.debug('Lain-plugin', 'QQBot WebHook 签名: ' + JSON.stringify({ plain_token, signature }))
        req.res.send({ plain_token, signature })
      }).catch(err => {
        common.error('Lain-plugin', 'WebHook 签名验证加载 tweetnacl 失败: ' + err)
        req.res.sendStatus(500)
      })
      return
    }

    /** 事件分发 */
    if (req.body?.t && bot.sdk.dispatchEvent) {
      bot.sdk.dispatchEvent(req.body.t, req.body)
    }

    req.res.sendStatus(200)
  }

  /** 修改一下日志 */
  logger (...data) {
    let msg = data[0]
    if (typeof msg !== 'string' || data.length > 1) return lain.info(this.id, ...data)
    msg = msg.trim()
    try {
      if (/^(recv from Group|recv from Guild|send to Channel)/.test(msg)) {
        return ''
      } else if (/^send to Group/.test(msg)) {
        msg = msg.replace(/^send to Group\([^)]+\): /, `<发送群聊:${this.id}-${msg.match(/\(([^)]+)\)/)[1]}> => `)
        return lain.info(this.QQBot, msg)
      }
    } catch { }
    return logger.info(msg)
  }
}
