import lodash from 'lodash'
import MiaoCfg from '../../../../lib/config/config.js'
import loader from '../../../../lib/plugins/loader.js'
import common from '../../lib/common/common.js'
import Cfg from '../../lib/config/config.js'
import { faceMap } from '../../model/shamrock/face.js'

export default class adapterQQGuild {
  /** 传入基本配置 */
  constructor(sdk) {
    /** sdk */
    this.sdk = sdk
    /** 基本配置 */
    this.config = sdk.config
    /** 开发者id */
    this.id = `qg_${this.config.appid}`
    /** 监听事件 */
    this.StartBot()
  }

  async StartBot() {
    this.sdk.on('message.guild', async (data) => {
      data = await this.GroupMessage(data)
      data && Bot.emit('message', data)
    })
    this.sdk.on('message.private.direct', async (data) => {
      data = await this.GroupMessage(data, 'friend')
      data && Bot.emit('message', data)
    })

    /** 按钮交互事件 */
    this.sdk.on('interaction', async (event) => {
      await this.handleInteraction(event)
    })

    /** 频道/子频道/成员 通知事件 */
    this.sdk.on('notice.guild.increase', async (data) => {
      lain.info(this.id, '频道增加: ' + (data.guild_id || ''))
    })
    this.sdk.on('notice.guild.decrease', async (data) => {
      lain.info(this.id, '频道减少: ' + (data.guild_id || ''))
    })
    this.sdk.on('notice.guild.update', async (data) => {
      lain.info(this.id, '频道更新: ' + (data.guild_id || ''))
    })
    this.sdk.on('notice.channel.increase', async (data) => {
      lain.info(this.id, '子频道增加: ' + (data.channel_id || ''))
    })
    this.sdk.on('notice.channel.decrease', async (data) => {
      lain.info(this.id, '子频道减少: ' + (data.channel_id || ''))
    })
    this.sdk.on('notice.guild.member.increase', async (data) => {
      lain.info(this.id, '频道成员增加: ' + (data.user_id || ''))
    })
    this.sdk.on('notice.guild.member.decrease', async (data) => {
      lain.info(this.id, '频道成员减少: ' + (data.user_id || ''))
    })

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
      username = 'QQGuild'
    }

    Bot[this.id] = {
      sdk: this.sdk,
      config: this.config,
      bkn: 0,
      avatar,
      adapter: 'QQGuild',
      uin: this.id,
      tiny_id: id,
      fl: new Map(),
      gl: new Map(),
      tl: new Map(),
      gml: new Map(),
      guilds: new Map(),
      nickname: username,
      stat: { start_time: Date.now() / 1000, recv_msg_cnt: 0 },
      apk: Bot.lain.adapter.QQGuild.apk,
      version: Bot.lain.adapter.QQGuild.version,
      getFriendMap: () => Bot[this.id].fl,
      getGroupList: () => Bot[this.id].gl,
      getGuildList: () => Bot[this.id].tl,
      readMsg: async () => common.recvMsg(this.id, 'QQGuild', true),
      MsgTotal: async (type) => common.MsgTotal(this.id, 'QQGuild', type, true),
      pickGroup: (groupID) => this.pickGroup(groupID),
      pickUser: (userId) => this.pickFriend(userId),
      pickFriend: (userId) => this.pickFriend(userId),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getGroupMemberInfo: (group_id, user_id) => Bot.getGroupMemberInfo(group_id, user_id)
    }

    if (!this.config.allMsg) Bot[this.id].version.id = '公域'
    if (!Bot.adapter.includes(String(this.id))) Bot.adapter.push(String(this.id))

    /** 重启 */
    await common.init('Lain:restart:QQGuild')
    return lain.info(this.id, `QQGuild：[${username}(${this.id})] 连接成功!`)
  }

  async gmlList(type = 'gl') {

  }

  async GroupMessage(e, friend) {
    let { self_id: _tiny_id, bot: _bot, ...data } = e
    const { guild_id, channel_id, member, author, src_guild_id } = e
    const { id: userId, username: nickname, avatar } = author

    const group_id = `qg_${guild_id}-${channel_id}`
    const user_id = `qg_${userId}`

    const is_owner = member.roles && (member.roles.includes('4') || false)
    const is_admin = member.roles && (member.roles.includes('2') || false)
    const role = is_owner ? 'owner' : (is_admin ? 'admin' : 'member')
    const group_name = await this.getGroupName(src_guild_id || guild_id, channel_id, friend)

    data.data = e
    data.uin = this.id // ???鬼知道哪来的这玩意，icqq都没有...
    data.adapter = 'QQGuild'
    data.user_id = user_id
    data.group_id = group_id
    data.sub_type = friend || 'normal'
    data.message_type = friend ? 'private' : 'group'
    data.time = data.timestamp
    data.atme = false
    data.atall = false
    data.self_id = this.id
    /** 这些字段还需要补充 */
    data.group_name = group_name
    data.group = { ...this.pickGroup(group_id) }
    data.sender = {
      ...data.sender,
      user_id,
      nickname,
      sub_id: 0,
      card: '',
      sex: 'unknown',
      age: 0,
      area: '',
      level: 1,
      role,
      title: ''
    }
    data.reply = async (msg, quote) => {
      if (quote?.markdown) return await this.sendMarkdownReplyMsg(data, msg, quote)
      return await this.sendReplyMsg(data, msg, quote)
    }
    data.markdown = async (msg, options = {}) => await this.sendMarkdownReplyMsg(data, msg, options)
    data.replyMarkdown = data.markdown
    data.sendMarkdown = data.markdown
    data.member = {
      card: '', // 名片
      client: '', // 客户端对象
      dm: false, // 是否是私聊
      group: { ...this.pickGroup(group_id) },
      group_id, // 群号
      info: { ...data.sender }, // 群员资料
      is_admin, // 是否是管理员
      is_friend: false, // 是否是好友
      is_owner, // 是否是群主
      mute_left: 0, // 禁言剩余时间
      target: user_id, // 目标
      title: '', // 头衔
      user_id, // 用户ID
      getAvatarUrl: () => avatar,
      kick: async () => await this.kick(),
      mute: async () => await this.mute(),
      recallMsg: async () => await data.recall(),
      sendMsg: async (msg, quote) => await data.reply(msg, quote),
      setAdmin: async () => await this.setAdmin()
    }
    let { message, raw_message, log_message, ToString } = await this.getMessage(data.message)
    data.message = message

    if (Bot[this.id].config.other.Prefix) {
      data.message.some(msg => {
        if (msg.type === 'text') {
          msg.text = this.hasAlias(msg.text, data)
          return true
        }
        return false
      })
    }

    data.raw_message = raw_message
    data.toString = () => ToString

    lain.info(this.id, `<${friend ? '私信' : '频道'}:${group_name}(${group_id})><用户:${nickname}(${user_id})> -> ${log_message}`)
    return data
  }

  /** 获取群名称 */
  async getGroupName(guildId, channelId, friend) {
    const group_id = `qg_${guildId}-${channelId}`
    let group_name = Bot.gl.get(group_id)
    if (group_name) return group_name.group_name
    const guild = await this.sdk.getGuildInfo(guildId)
    group_name = guild.guild_name
    if (friend) {
      group_name = `来自"${group_name}"频道`

      /** 一个子频道为一个群 */
      Bot.gl.set(group_id, { group_name })
      Bot[this.id].gl.set(group_id, { group_name })
    } else {
      let data = await this.sdk.getChannelInfo(channelId)
      group_name = `${group_name}-${data.channel_name}`

      /** 一个子频道为一个群 */
      Bot.gl.set(group_id, { ...data, group_name })
      Bot[this.id].gl.set(group_id, { ...data, group_name })
    }

    return group_name
  }

  /** 群对象 */
  pickGroup(groupID) {
    return {
      is_admin: false,
      is_owner: false,
      recallMsg: async () => Promise.reject(new Error('QQ频道未支持')),
      sendMsg: async (msg) => await this.sendGroupMsg(groupID, msg),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getChatHistory: async () => [],
      pickMember: (userID) => this.pickMember(groupID, userID),
      /** 戳一戳 */
      pokeMember: async (operatorId) => '',
      /** 禁言 */
      muteMember: async (groupId, userId, time) => Promise.reject(new Error('QQ频道未支持')),
      /** 全体禁言 */
      muteAll: async (type) => Promise.reject(new Error('QQ频道未支持')),
      getMemberMap: async () => Promise.reject(new Error('QQ频道未支持')),
      /** 退群 */
      quit: async () => Promise.reject(new Error('QQ频道未支持')),
      /** 设置管理 */
      setAdmin: async (qq, type) => Promise.reject(new Error('QQ频道未支持')),
      /** 踢 */
      kickMember: async (qq, rejectAddRequest = false) => Promise.reject(new Error('QQ频道未支持')),
      /** 头衔 **/
      setTitle: async (qq, title, duration) => Promise.reject(new Error('QQ频道未支持')),
      /** 修改群名片 **/
      setCard: async (qq, card) => Promise.reject(new Error('QQ频道未支持'))
    }
  }

  /** 好友对象 */
  pickFriend(userId) {
    return {
      sendMsg: async (group_id, msg) => await this.sendFriendMsg(group_id, userId, msg),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getChatHistory: async () => [],
      getAvatarUrl: async (size = 0, userID) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${userID.split('-')[1] || this.id}`
    }
  }

  pickMember(groupID, userID) {
    return {
      member: this.member(groupID, userID),
      getAvatarUrl: (size = 0, userID) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${userID.split('-')[1] || this.id}`
    }
  }

  /** 处理消息事件 */
  async getMessage(data) {
    const message = []
    const ToString = []
    const raw_message = []
    const log_message = []

    data.forEach(i => {
      switch (i.type) {
        case 'text':
          message.push(i)
          raw_message.push(i.text)
          log_message.push(i.text)
          ToString.push(i.text)
          break
        case 'image':
          message.push(i)
          raw_message.push('[图片]')
          log_message.push(`<图片:${i.url}>`)
          ToString.push(`{image:${i.url}}`)
          break
        case 'face':
          message.push(i)
          raw_message.push(`[${faceMap[Number(i)] || '动画表情'}]`)
          log_message.push(`<${faceMap[Number(i)] || `动画表情:${i}`}>`)
          ToString.push(`{face:${i}}`)
          break
        case 'link':
          message.push(i)
          raw_message.push('[link]')
          log_message.push(`<link:${i.channel_id}>`)
          ToString.push(`{link:${i.channel_id}}`)
          break
        case 'at':
          message.push({ ...i, qq: `qg_${i.user_id}`, text: i.username })
          raw_message.push(`@${i.username}`)
          log_message.push(`<提及:qg_${i.user_id}(${i.username})>`)
          ToString.push(`{at:qg_${i.user_id}}`)
          break
        case 'markdown':
          raw_message.push('[markdown]')
          log_message.push(`<markdown:${JSON.stringify(i)}>`)
          ToString.push(`{markdown:${JSON.stringify(i)}}`)
          break
        case 'button':
          raw_message.push('[按钮]')
          log_message.push(`<按钮:${JSON.stringify(i?.buttons || i)}>`)
          ToString.push(`{button:${JSON.stringify(i?.buttons || i)}}`)
          break
        case 'ark':
          raw_message.push(JSON.stringify(i))
          log_message.push(`<ark:${JSON.stringify(i)}>`)
          ToString.push(JSON.stringify(i))
          break
        default:
          raw_message.push(JSON.stringify(i))
          log_message.push(JSON.stringify(i))
          ToString.push(JSON.stringify(i))
          break
      }
    })

    return { message, raw_message: raw_message.join(''), log_message: log_message.join(''), ToString: ToString.join('') }
  }

  /** 处理回复消息 */
  async sendReplyMsg(data, msg, quote) {
    let { Pieces, messageLog } = await this.getQQGuild(msg)
    const info = data.message_type === 'group' ? '频道' : '私信'
    lain.info(this.id, `<回复${info}:${data.group_name}(${data.group_id})> => ${messageLog}`)
    for (const item of Pieces) {
      try {
        lain.debug(`发送回复${info}消息：`, JSON.stringify(item))
        let res = await data.data.reply(item, quote)
        res.message_id = res.id
        lain.debug(`回复${info}消息返回：`, res)
      } catch (error) {
        console.error(error)
      }
    }
  }

  /** 官方 Markdown 回复：统一使用 content 发送 */
  async sendMarkdownReplyMsg(data, msg, options = {}) {
    const markdown = await this.makeMarkdownSegment(data, msg, options)
    const message = [markdown]
    if (options.button) message.push(...this.normalizeButtons(data, options.button))
    else if (options.buttons) message.push(...this.normalizeButtons(data, options.buttons))
    try {
      const res = await data.data.reply(message, options.quote)
      res.message_id = res.id
      return res
    } catch (error) {
      logger.error('发送频道Markdown回复失败：', error)
      throw error
    }
  }

  async makeMarkdownSegment(e, data, options = {}) {
    return { type: 'markdown', content: await this.makeMarkdownContent(e, data, options) }
  }

  async makeMarkdownContent(e, data, options = {}) {
    if (typeof options.content === 'string') return options.content
    if (typeof data === 'string') return data
    if (data?.type === 'markdown') data = data.data || data
    if (typeof data?.content === 'string') return data.content
    if (Array.isArray(data?.params)) return data.params.flatMap(i => i.values || []).join('\r')

    const msg = common.array(data)
    const content = []
    for (const i of msg) {
      switch (i.type) {
        case 'text':
        case 'forward':
          if (i.text) content.push(String(i.text).replace(/@/g, '@\u200B').replace(/<qqbot-/g, '<qqbot-\u200B'))
          break
        case 'at':
          if ((i.qq || i.id) === 'all') content.push('<qqbot-at-everyone />')
          else content.push(`<qqbot-at-user id="${String(i.qq || i.id || '').replace(/^qg_/, '')}" />`)
          break
        case 'image':
          content.push(`![${i.summary || '图片'}](${await Bot.FormatFile(i.url || i.file)})`)
          break
        case 'markdown':
          if (typeof i.data === 'string') content.push(i.data)
          else if (i.data?.content) content.push(i.data.content)
          else if (i.content) content.push(i.content)
          break
        default:
          if (typeof i === 'string') content.push(i)
      }
    }
    return content.join('')
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
          buttons.push(btn)
          continue
        }
        const built = this.buildButton(e, {
          text: btn.text || btn.label || btn.data || btn.input || btn.callback || btn.link,
          clicked_text: btn.clicked_text || btn.visited_label,
          link: btn.link,
          callback: btn.callback,
          input: btn.input ?? (!btn.link && btn.callback == null ? btn.data : undefined),
          send: btn.send ?? btn.enter ?? (!btn.link && btn.callback == null && btn.data != null ? true : undefined),
          permission: btn.permission || btn.list,
          style: btn.style != null ? Number(btn.style) : undefined,
          tips: btn.tips || btn.unsupport_tips,
          QQBot: btn.QQBot,
        }, buttons.length % 2)
        if (built) buttons.push(built)
        if (buttons.length >= 5) break
      }
      if (buttons.length) result.push({ type: 'button', buttons: buttons.slice(0, 5) })
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

  /** 转换message为sdk可接收的格式 */
  async getQQGuild(data) {
    data = common.array(data)
    let reply
    const text = []
    const image = []
    const message = []
    const Pieces = []
    const messageLog = []

    for (let i of data) {
      switch (i.type) {
        case 'text':
        case 'forward':
          if (String(i.text).trim()) {
            messageLog.push(i.text)
            for (let item of (await Bot.HandleURL(i.text.trim()))) {
              item.type === 'image' ? image.push(item) : text.push(item.text)
            }
          }
          break
        case 'at':
          i.user_id = (i.qq || i.id).replace('qg_', '')
          message.push(i)
          messageLog.push(`<@:${i.qq || i.id}>`)
          break
        case 'image':
          i.file = await Bot.FormatFile(i.url || i.file)
          image.push(i)
          messageLog.push(`<图片:${typeof i.file === 'string' ? i.file.replace(/base64:\/\/.*/, 'base64://...') : 'base64://...'}>`)
          break
        case 'video':
          break
        case 'record':
          break
        case 'reply':
          reply = i
          break
        case 'ark':
        case 'button':
        case 'keyboard':
          message.push(...this.normalizeButtons(e, i))
          break
        case 'markdown':
          message.push(await this.makeMarkdownSegment(e, i.data || i))
          break
        default:
          message.push(i)
          messageLog.push(`<未知:${JSON.stringify(i)}>`)
          break
      }
    }

    if (text.length) message.push(text.length < 4 ? text.join('') : text.join('\n'))
    if (image.length) message.push(image.shift())
    if (image.length) Pieces.push(...image)

    /** 合并为一个数组 */
    return { Pieces: message.length ? [message, ...Pieces] : Pieces, reply, messageLog: messageLog.join('') }
  }

  /** 前缀处理 */
  hasAlias(text, e, hasAlias = true) {
    text = text.trim()
    if (Bot[this.id].config.other.Prefix && text.startsWith('/')) {
      return text.replace(/^\//, '#')
    }
    /** 兼容前缀 */
    let groupCfg = MiaoCfg.getGroup(e.group_id)
    let alias = groupCfg.botAlias
    if (!Array.isArray(alias)) {
      alias = [alias]
    }
    for (let name of alias) {
      if (text.startsWith(name)) {
        /** 先去掉前缀 再 / => # */
        text = lodash.trimStart(text, name)
        if (Bot[this.id].config.other.Prefix) text = text.replace(/^\//, '#')
        if (hasAlias) return name + text
        return text
      }
    }
    return text
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

  /** 转换message：新版仅使用 markdown.content + button */
  async getQQBot(data, e) {
    data = common.array(data)
    let reply
    const message = []
    const Pieces = []
    let content = ''
    const buttons = []

    const flushMarkdown = async () => {
      if (!content && !buttons.length) return
      const piece = [{ type: 'markdown', content: content || ' ' }]
      if (buttons.length) piece.push(...buttons.splice(0, 5))
      Pieces.push(piece)
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
        case 'forward':
          if (String(i.text || '').trim()) appendText(i.type === 'forward' ? String(i.text).trim() + '\n' : i.text)
          break
        case 'at':
          if ((i.qq || i.id) === 'all') content += '<qqbot-at-everyone />'
          else content += `<qqbot-at-user id="${String(i.qq || i.id || '').replace(/^qg_/, '')}" />`
          break
        case 'image':
          content += `![${i.summary || '图片'}](${await Bot.FormatFile(i.url || i.file)})`
          break
        case 'button':
        case 'keyboard':
          buttons.push(...this.normalizeButtons(e, i))
          break
        case 'markdown':
          appendText(await this.makeMarkdownContent(e, i.data || i))
          break
        case 'reply':
          reply = i
          break
        case 'ark':
        case 'video':
        case 'record':
        default:
          await flushMarkdown()
          message.push(i)
          break
      }
    }

    if (content || buttons.length) await flushMarkdown()
    if (message.length) Pieces.unshift(message)

    return { Pieces, reply }
  }

  /** 发送主动私信消息 */
  async sendFriendMsg(group_id, user_id, data) {
    /** 暂时屏蔽下 */
    if (!(group_id || user_id || data)) {
      throw new Error('不存在此频道，正确请求格式：Bot.pickFriend(user_id).sendMsg(group_id, msg)')
    }

    user_id = user_id.replace('qg_', '')
    const guild_id = group_id.replace('qg_', '').split('-')[0]
    let { Pieces, messageLog, reply } = await this.getQQGuild(data)
    lain.info(this.id, `<发送主动私信消息:${group_id})> => ${messageLog}`)
    /** 先创建私信会话 */
    const directData = await this.sdk.createDirectSession(guild_id, user_id)
    for (let item of Pieces) {
      try {
        if (reply) item = Array.isArray(item) ? [reply, ...item] : [reply, item]
        let res = await this.sdk.sendDirectMessage(directData.guild_id, item)
        res.message_id = res.id
        return res
      } catch (error) {
        logger.error('发送主动私信消息息失败：', error)
      }
    }
  }

  /** 发送主动群消息 */
  async sendGroupMsg(groupID, data) {
    const channel_id = groupID.replace('qg_', '').split('-')[1]
    let { Pieces, messageLog, reply } = await this.getQQGuild(data)
    lain.info(this.id, `<发送主动频道消息:${groupID})> => ${messageLog}`)
    for (let item of Pieces) {
      try {
        if (reply) item = Array.isArray(item) ? [reply, ...item] : [reply, item]
        let res = await this.sdk.sendGuildMessage(channel_id, item)
        res.message_id = res.id
        return res
      } catch (error) {
        logger.error('发送频道主动消息失败：', error)
      }
    }
  }

  /** 处理按钮交互事件（频道） */
  async handleInteraction (event) {
    const btnId = event.data?.resolved?.button_id
    const btnData = event.data?.resolved?.button_data
    // 兼容新旧字段: 新版用 operator_openid / group_member_openid
    const operatorId = event.operator_openid || event.group_member_openid || event.operator_id || event.user_id

    if (!operatorId) {
      try { event.reply(1) } catch {}
      return
    }

    const callback = btnId && Bot[this.id]?.callback?.[btnId]
    let msg = ''

    if (callback) {
      msg = callback.message || ''
    } else if (btnData) {
      msg = btnData
    }

    if (!msg) {
      try { event.reply(1) } catch {}
      return
    }

    try { event.reply(0) } catch {}

    const callbackGroupId = callback?.group_id
      ? (String(callback.group_id).startsWith('qg_') ? callback.group_id : 'qg_' + callback.group_id)
      : undefined

    const data = {
      raw: event,
      bot: Bot[this.id],
      self_id: this.id,
      adapter: 'QQGuild',
      post_type: 'message',
      message_type: callbackGroupId ? 'group' : 'private',
      sub_type: 'callback',
      message_id: event.event_id ? 'event_' + event.event_id : event.id,
      time: event.timestamp || Date.now() / 1000,
      user_id: this.id + '-' + operatorId,
      group_id: callbackGroupId,
      sender: { user_id: this.id + '-' + operatorId },
      message: [
        { type: 'text', text: msg },
      ],
      raw_message: msg,
    }

    common.mark('Lain-plugin', '频道按钮点击: [' + (data.group_id || '') + ', ' + data.user_id + '] ' + msg)
    Bot.emit('message', data)
  }

  buildButton (e, btn, style = 0) {
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

    if (btn.input) {
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: btn.input,
        enter: !!btn.send,
        unsupport_tips: btn.tips || '暂不支持此按钮',
        ...(btn.QQBot?.action || {}),
      }
    } else if (btn.callback) {
      if (this.config.toCallback !== false) {
        msg.action = {
          type: 1,
          permission: { type: 2 },
          data: btn.callback,
          enter: false,
          unsupport_tips: btn.tips || '暂不支持此按钮',
          ...(btn.QQBot?.action || {}),
        }
        this._trackCallback(e, msg.id, btn.callback)
      } else {
        msg.action = {
          type: 2,
          permission: { type: 2 },
          data: btn.callback,
          enter: true,
          unsupport_tips: btn.tips || '暂不支持此按钮',
          ...(btn.QQBot?.action || {}),
        }
      }
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

    if (btn.permission) {
      if (btn.permission === 'admin') {
        msg.action.permission.type = 1
      } else if (Array.isArray(btn.permission)) {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = btn.permission.map(
          id => String(id).replace(this.id + '-', '').replace(/^qg_/, ''),
        )
      }
    }

    return msg
  }

  _trackCallback (e, btnId, message) {
    if (!Bot[this.id].callback) Bot[this.id].callback = {}
    Bot[this.id].callback[btnId] = {
      id: e.message_id,
      user_id: e.user_id,
      group_id: e.group_id ? String(e.group_id).replace(this.id + '-', '').replace(/^qg_/, '') : undefined,
      message,
      message_id: e._ret_id || [],
    }
    setTimeout(() => {
      if (Bot[this.id]?.callback) delete Bot[this.id].callback[btnId]
    }, 300000)
  }

}

common.info('Lain-plugin', 'QQ频道适配器加载完成')
