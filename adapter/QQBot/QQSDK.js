import { Bot as QQBot } from 'qq-group-bot'
import EventIndex from 'qq-group-bot/lib/event/index.js'
import Constans from 'qq-group-bot/lib/constans.js'
import Cfg from '../../../../lib/config/config.js'
import common from '../../lib/common/common.js'

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
    /** 最大重连次数 */
    this.config.maxRetry = this.config.maxRetry || 10
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

    /** WebHook 模式：仅获取 token，不启动 WebSocket */
    if (this.config.webhook) {
      await this.sdk.sessionManager.getAccessToken()
      this.active = true
    } else {
      /** WebSocket 模式：启动长连接 */
      await this.sdk.start()
    }

    /** 修改sdk日志为喵崽日志 */
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
    if (Constans.Intends.GROUP_MESSAGE_CREATE === undefined) {
      Constans.Intends.GROUP_MESSAGE_CREATE = groupAndC2CIntent
    }

    /** GROUP_MESSAGE_CREATE 与 GROUP_AT_MESSAGE_CREATE 的 payload 同为群消息结构 */
    if (!EventIndex.QQEvent.GROUP_MESSAGE_CREATE) {
      EventIndex.QQEvent.GROUP_MESSAGE_CREATE = 'message.group'
    }
    if (!EventIndex.EventParserMap.has('message.group')) {
      EventIndex.EventParserMap.set('message.group', EventIndex.EventParserMap.get(EventIndex.QQEvent.GROUP_AT_MESSAGE_CREATE))
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
