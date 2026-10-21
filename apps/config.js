import YAML from '../model/YamlHandler.js'
import common from '../lib/common/common.js'
import Cfg from '../lib/config/config.js'
import QQBotIdMap from '../model/qqbot-id-map.js'

export class adapter extends plugin {
  constructor () {
    super({
      name: 'Bot配置',
      dsc: 'QQ频道、QQ群Bot基本配置',
      event: 'message',
      priority: 1,
      rule: [
        {
          reg: /^#QQ图床(开|关)(?:\s*[:：]?\s*\d+)?\s*$/i,
          fnc: 'imageHost',
          permission: 'master'
        },
        {
          reg: /^#QQ(群|Bot|频道)设置(QQ图床|前缀|斜杠转#|斜杠转换|\/转#|\/转换为?#?|防倒卖(群号)?).+/i,
          fnc: 'other',
          permission: 'master'
        },
        {
          reg: /^#QQ(群|Bot|频道)?设置(?!MD|markdown|小按钮|micro|smallbtn).+/i,
          fnc: 'bot',
          permission: 'master'
        },
        {
          reg: /^#QQ(群|Bot|频道)?账号/i,
          fnc: 'account',
          permission: 'master'
        },
        {
          reg: /^#QQ(群|Bot|频道)(设置)?(MD|markdown|小按钮|micro|smallbtn).*/i,
          fnc: 'markdown',
          permission: 'master'
        },
      ]
    })
  }

  /** bot相关配置 */
  async bot () {
    let config = {
      model: 0,
      appid: '',
      token: '',
      sandbox: false,
      allMsg: false,
      groupAllMsg: false,
      removeAt: false,
      secret: '',
      toCallback: true,
      qqImageHost: true,
      other: {
        Prefix: true,
        QQ: '',
        Tips: false,
        'Tips-GroupId': ''
      }
    }

    const msg = this.e.msg.replace(/^#QQ(群|Bot|频道)?设置/i, '').trim().replace(/：/g, ':').split(':')
    const cfg = new YAML(lain._pathCfg + '/token.yaml')
    const QQSDK = (await import('../adapter/QQBot/QQSDK.js')).default
    const QQBot = (await import('../adapter/QQBot/index.js')).default
    const QQGuild = (await import('../adapter/QQBot/QQGuild.js')).default

    /** 最低要求 */
    if (msg.length < 4) return await this.reply('格式错误', true, { at: true })
    /** AppID 为数字且长度并非固定 9 位，兼容现有 10 位及后续长度。 */
    if (!/^\d+$/.test(String(msg[2] || ''))) return await this.reply('appid输入错误!', true, { at: true })

    /** 看下是否配置已存在 */
    if (cfg.value('token', msg[2])) {
      cfg.delVal('token', msg[2])
      return await this.reply('删除成功~请重启 Miao-Yunzai 生效~', true, { at: true })
    } else {
      /** 不存在加一下配置 */
      config.sandbox = msg[0] == 1
      config.allMsg = msg[1] == 1
      config.appid = String(msg[2])
      config.token = msg[3]
      if (msg[4]) config.secret = msg[4]
      // Optional 6th field: webhook true/false
      if (msg[5] !== undefined) config.webhook = ['true', '1', 'webhook', 'yes', 'on'].includes(String(msg[5]).toLowerCase())
      // Optional 7th field: subscribe to GROUP_MESSAGE_CREATE as well as @ events.
      if (msg[6] !== undefined) config.groupAllMsg = ['true', '1', 'all', 'yes', 'on'].includes(String(msg[6]).toLowerCase())

      /** 获取模式 */
      if (/#QQ频道设置/i.test(this.e.msg)) {
        config.model = 1
      } else if (/#QQ群设置/i.test(this.e.msg)) {
        config.model = 2
      } else {
        config.model = 0
      }
      cfg.addVal('token', { [config.appid]: config }, 'object')
    }

    try {
      await this.reply('正在建立连接，请稍等~', true, { at: true })
      const SDK = new QQSDK(config)
      await SDK.start()
      switch (config.model) {
        case 0:
          /** 同时接群和频道 */
          try {
            const QQB = new QQBot(SDK.sdk, true)
            await this.reply(await QQB.StartBot())
            await common.sleep(5000)
            return await this.reply(await new QQGuild(SDK.sdk, true).StartBot())
          } catch {
            return await this.reply('连接失败，请查看控制台日志')
          }
        case 1:
          /** 开始连接QQ频道Bot */
          return await this.reply(await new QQGuild(SDK.sdk, true).StartBot())
        case 2:
          try {
            const bot = new QQBot(SDK.sdk, true)
            return await this.reply(await bot.StartBot())
          } catch {
            return await this.reply('连接失败，请查看控制台日志')
          }
        default:
      }
    } catch (error) {
      /** 异常处理 */
      return this.reply(error?.message || error)
    }
    return await this.reply('格式错误', true, { at: true })
  }

  /** QQ群、频道Bot账号列表 */
  async account () {
    let list = []
    if (this.e.isGroup) return await this.reply('请私聊查看', true, { at: true })
    let token = Object.values(Cfg.getToken())

    // if (!Array.isArray(token)) token = [token] // 感觉没啥必要。
    if (!token.length) return await this.reply('当前还没有绑定过账号~', true, { at: true })
    const formatConfig = (label, config) => {
      let value = `${label}-${config.sandbox ? 1 : 0}:${config.allMsg ? 1 : 0}:${config.appid}:${config.token}`
      if (config.secret || config.webhook || config.groupAllMsg) value += `:${config.secret || ''}`
      if (config.webhook || config.groupAllMsg) value += `:${config.webhook ? 'webhook' : '0'}`
      if (config.groupAllMsg) value += ':1'
      return value
    }
    token.forEach(i => {
      switch (Number(i.model)) {
        case 0:
          list.push(formatConfig('全量', i))
          break
        case 1:
          list.push(formatConfig('QQ频道', i))
          break
        case 2:
          list.push(formatConfig('QQ群', i))
          break
        default:
          list.push(formatConfig('未启用', i))
          break
      }
    })

    return await this.reply(`QQ群、频道账号列表：\n${list.join('\n')}\n\n共 ${list.length} 个账号`)
  }

  /** Per-account raw / legacy / template settings and micro keyboard switch. */
  async markdown () {
    const text = String(this.e.msg || '').replace(/^#QQ(群|Bot|频道)(设置)?(MD|markdown|小按钮|micro|smallbtn)/i, '').replace(/：/g, ':').trim()
    const values = text.split(':')
    const current = this.getQQBotConfigSelfId(this.e)
    const id = values.length > 1 && /^\d+$/.test(values[0]) ? values.shift() : current
    const cfg = new YAML(lain._pathCfg + '/token.yaml')
    const accounts = cfg.get('token') || {}
    const accountId = accounts[id] ? id : Object.keys(accounts).find(key => String(QQBotIdMap.getBoundBotQQ(key)) === id)
    if (!accountId) return await this.reply('未找到机器人账号，请指定 AppID 或已绑定的机器人 QQ 号。')
    const account = accounts[accountId]
    if (/小按钮|micro|smallbtn/i.test(this.e.msg)) {
      if (!/^(true|false|开启|关闭)$/i.test(values[0] || '')) return await this.reply('格式：#QQBot小按钮 AppID:true 或 AppID:false')
      account.smallbtn = /^(true|开启)$/i.test(values[0])
    } else {
      const selected = values[0]
      if (/^(raw|legacy)$/i.test(selected || '')) {
        const old = typeof account.markdown === 'object' ? account.markdown : {}
        account.markdown = { ...old, mode: selected.toLowerCase() }
      } else {
        const templateId = selected?.toLowerCase() === 'template' ? values[1] : selected
        const keys = ((selected?.toLowerCase() === 'template' ? values[2] : values[1]) || '').split(/[,，]/).map(key => key.trim()).filter(Boolean)
        if (!templateId || !keys.length) return await this.reply('格式：#QQBotMD AppID:raw / AppID:legacy / AppID:模板ID:参数名1,参数名2')
        account.markdown = { mode: 'template', templateId, params: keys }
      }
    }
    cfg.set('token', accounts)
    for (const botId of [accountId, `qg_${accountId}`]) {
      if (Bot?.[botId]?.config) Object.assign(Bot[botId].config, { markdown: account.markdown, smallbtn: account.smallbtn })
    }
    const policy = typeof account.markdown === 'object' ? account.markdown : { mode: account.markdown || 'raw' }
    return await this.reply(`QQBot ${accountId}：模式 ${policy.mode}，小按钮 ${account.smallbtn ? '开启' : '关闭'}，配置已生效。`)
  }

  /** Official image materials are configured independently for each QQBot account. */
  async imageHost () {
    const match = String(this.e.msg || '').trim().match(/^#QQ图床(开|关)(?:\s*[:：]?\s*(\d+))?$/i)
    if (!match) return false
    const cfg = new YAML(lain._pathCfg + '/token.yaml')
    const accounts = cfg.get('token') || {}
    const ids = Object.keys(accounts).filter(id => ![1, 3].includes(Number(accounts[id]?.model)))
    const current = this.getQQBotConfigSelfId(this.e).replace(/^qg_/, '')
    const requested = match[2] || current || String(this.e.self_id || '')
    const bound = ids.filter(id => String(QQBotIdMap.getBoundBotQQ(id)) === requested)
    let accountId = ids.includes(requested) ? requested : bound.length === 1 ? bound[0] : undefined
    if (!accountId && !match[2] && !current && ids.length === 1) accountId = ids[0]
    if (!accountId) return await this.reply('未找到唯一的 QQBot 账号，请指定 AppID 或已绑定的机器人 QQ 号，例如：#QQ图床开 102089931')
    const enabled = match[1] === '开'
    accounts[accountId].qqImageHost = enabled
    cfg.set('token', accounts)
    for (const botId of [accountId, `qg_${accountId}`]) {
      if (Bot?.[botId]?.config) Bot[botId].config.qqImageHost = enabled
      if (Bot?.[botId]?.sdk?.config) Bot[botId].sdk.config.qqImageHost = enabled
    }
    return await this.reply(`QQBot ${accountId}：官方图床已${enabled ? '开启' : '关闭'}，配置已保存并生效。`)
  }

  /** 旧版模板模式已废弃 */
  async type () {
    return await this.markdown()
  }

  /** 其他 */
  async other () {
    const msg = this.e.msg.replace(/^#QQ(群|Bot|频道)设置(QQ图床|前缀|斜杠转#|斜杠转换|\/转#|\/转换为?#?|防倒卖(群号)?)/i, '').replace(/：/g, ':').trim().split(':')
    const cfg = new YAML(lain._pathCfg + '/token.yaml')
    if (msg.length != 1 && msg.length != 2) return await this.reply('格式错误!', true, { at: true })

    let self_id
    if (msg.length == 2) {
      self_id = msg[0]
    } else {
      self_id = this.getQQBotConfigSelfId(this.e)
      if (!self_id) return await this.reply('格式错误!', true, { at: true })
    }
    if (cfg.value('token', self_id)) {
      let val = cfg.get('token')
      if (this.e.msg.includes('图床')) {
        val[self_id].other.QQ = Number(msg[1] || msg[0])
      } else if (this.isPrefixConvertSetting(this.e.msg)) {
        const enabled = (msg[1] || msg[0]) === '开启'
        val[self_id].other.Prefix = enabled
        if (Bot?.[self_id]?.config) {
          if (!Bot[self_id].config.other) Bot[self_id].config.other = {}
          Bot[self_id].config.other.Prefix = enabled
        }
      } else if (this.e.msg.includes('防倒卖群号')) {
        val[self_id].other.Tips = Number(msg[1] || msg[0]) || String(msg[1] || msg[0])
      } else if (this.e.msg.includes('防倒卖')) {
        val[self_id].other['Tips-GroupId'] = Number(msg[1] || msg[0]) || String(msg[1] || msg[0])
      }
      await this.reply(`bot(${self_id}):修改配置文件`, true, { at: true })
      /** 保存 */
      cfg.set('token', val)
      /** 渲染 */
    } else {
      return await this.reply('不存在此appid对应的bot!', true, { at: true })
    }
  }

  isPrefixConvertSetting (msg) {
    return /前缀|斜杠|\/转|\/转换/i.test(String(msg || ''))
  }

  getQQBotConfigSelfId (e) {
    if (!e) return ''
    return String(e.qqbot_self_id || e.qqbot_appid || e.bot?.config?.appid || (e.adapter === 'QQBot' ? e.self_id : '') || '')
  }
}
