import { exec } from 'child_process'
import fs from 'fs'
import lodash from 'lodash'
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

lain.DAU = {}

export default class adapterQQBot {
  /** 传入基本配置 */
  constructor(sdk, start) {
    /** 开发者id */
    this.id = String(sdk.config.appid)
    /** sdk */
    this.sdk = sdk
    /** 基本配置 */
    this.config = sdk.config

    /** 监听事件 */
    if (!start) this.StartBot()
  }

  async StartBot() {
    /** 群消息 */
    this.sdk.on('message.group', async (data) => {
      data = await this.message(data, true)
      if (data) {
        await Bot.emit('message.group', data)
        await Bot.emit('message', data)
      }
    })
    /** 私聊消息 */
    this.sdk.on('message.private.friend', async (data) => {
      data = await this.message(data)
      if (data) {
        await Bot.emit('message.private', data)
        await Bot.emit('message', data)
      }
    })

    /** 按钮交互事件（回调/表单） */
    this.sdk.on('interaction', async (event) => {
      await this.handleInteraction(event)
    })

    /** 群/好友 通知事件 */
    this.sdk.on('notice.group.increase', async (data) => {
      lain.info(this.id, '群增加: ' + (data.group_id || ''))
    })
    this.sdk.on('notice.group.decrease', async (data) => {
      lain.info(this.id, '群减少: ' + (data.group_id || ''))
    })
    this.sdk.on('notice.friend.increase', async (data) => {
      lain.info(this.id, '好友增加: ' + (data.user_id || ''))
    })
    this.sdk.on('notice.friend.decrease', async (data) => {
      lain.info(this.id, '好友减少: ' + (data.user_id || ''))
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
      readMsg: async () => common.recvMsg(this.id, 'QQBot', true),
      MsgTotal: async (type) => common.MsgTotal(this.id, 'QQBot', type, true),
      pickGroup: (groupID) => this.pickGroup(groupID),
      pickUser: (userId) => this.pickFriend(userId),
      pickFriend: (userId) => this.pickFriend(userId),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getGroupMemberInfo: (group_id, user_id) => Bot.getGroupMemberInfo(group_id, user_id)
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
      is_admin: false,
      is_owner: false,
      recallMsg: async (msg_id) => await this.recallGroupMsg(groupID, msg_id),
      sendMsg: async (msg) => await this.sendGroupMsg(groupID, msg),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getChatHistory: async () => [],
      pickMember: (userID) => this.pickMember(groupID, userID),
      /** 戳一戳 */
      pokeMember: async (operatorId) => '',
      /** 禁言 */
      muteMember: async (groupId, userId, time) => Promise.reject(new Error('QQBot未支持')),
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
  pickFriend(userId) {
    return {
      sendMsg: async (msg) => await this.sendFriendMsg(userId, msg),
      recallMsg: async (msg_id) => await this.recallPrivateMsg(userId, msg_id),
      makeForwardMsg: async (data) => await common.makeForwardMsg(data),
      getChatHistory: async () => [],
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
      mute: async (time) => ''
    }
    return member
  }

  getAvatarUrl(size = 0, id) {
    return Number(id) ? `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${id}` : `https://q.qlogo.cn/qqapp/${this.id}/${id.split('-')[1] || id}/${size}`
  }

  /** 撤回群消息 */
  async recallGroupMsg(group_id, message_id) {
    group_id = String(group_id).split('-').pop() || group_id
    return await this.sdk.recallGroupMessage(group_id, message_id)
  }

  /** 撤回私聊消息 */
  async recallPrivateMsg(user_id, message_id) {
    user_id = String(user_id).split('-').pop() || user_id
    return await this.sdk.recallPrivateMessage(user_id, message_id)
  }

  /** 转换格式给云崽处理 */
  async message(data, isGroup) {
    let { self_id: tinyId, ...e } = data
    const rawGroupId = e.group_openid || e.group_id
    const rawUserId = e.user_id
    const rawAuthorId = e.author?.id
    const senderOpenid = this.getMessageUserOpenid(e)
    const senderMemberOpenid = this.getMessageMemberOpenid(e)
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
    e.time = data.timestamp
    e.self_id = this.id
    e.sendMsg = data.reply
    e.raw_message = e.raw_message.trim()
    this.normalizeIncomingMessage(e, tinyId)

    if (Bot[this.id].config.other.Prefix) {
      e.message.some(msg => {
        if (msg.type === 'text') {
          msg.text = this.hasAlias(msg.text, e)
          return true
        }
        return false
      })
      this.normalizeIncomingMessage(e, tinyId)
    }

    /** 获取匹配的按钮行（供自动附加） */
    const getAutoButtons = async () => {
      try { return await this.button(e) } catch { return false }
    }

    /** 构建快速回复消息（自动附加按钮插件） */
    e.reply = async (msg, quote) => {
      if (quote?.markdown) return await this.sendMarkdownReplyMsg(e, msg, quote)
      if (e.adapter === 'QQBot') {
        // 提取 Button.create() 生成的按钮对象
        if (Array.isArray(msg)) {
          const extracted = QQBotButton.extract(msg)
          msg = extracted.msgs
          if (extracted.button) {
            msg = [...msg, extracted.button]
          }
        }
        // 自动附加 button 插件按钮
        const btnRows = await getAutoButtons()
        if (btnRows?.length) {
          msg = Array.isArray(msg) ? [...msg, ...btnRows] : [msg, ...btnRows]
        }
      }
      return await this.sendReplyMsg(e, msg, quote)
    }
    e.markdown = async (msg, options = {}) => {
      if (!options.buttons && !options.button && e.adapter === 'QQBot') {
        const btnRows = await getAutoButtons()
        if (btnRows?.length) options.buttons = btnRows
      }
      return await this.sendMarkdownReplyMsg(e, msg, options)
    }
    e.replyMarkdown = e.markdown
    e.sendMarkdown = e.markdown
    /** 快速撤回 */
    e.recall = async () => isGroup
      ? await this.recallGroupMsg(data.group_id, data.message_id)
      : await this.recallPrivateMsg(data.user_id, data.message_id)
    /** 将收到的消息转为字符串 */
    e.toString = () => e.raw_message
    /** 获取对应用户头像 */
    e.getAvatarUrl = (size = 0) => this.getAvatarUrl(size, data.user_id)

    /** 构建场景对应的方法 */
    if (isGroup) {
      try {
        const groupId = `${this.id}-${e.group_id}`
        if (!Bot[e.self_id].gl.get(groupId)) Bot[e.self_id].gl.set(groupId, { group_id: groupId })
        /** 缓存群列表 */
        if (await redis.get(`lain:gl:${e.self_id}:${groupId}`)) redis.set(`lain:gl:${e.self_id}:${groupId}`, JSON.stringify({ group_id: groupId, uin: this.id }))
      } catch { }

      e.member = this.member(e.group_id, e.user_id)
      e.group_name = `${this.id}-${e.group_id}`
      e.group = this.pickGroup(e.group_id)
      e.message_type = 'group'
      e.sub_type = 'normal'
    } else {
      e.friend = this.pickFriend(e.user_id)
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
    e.sender.user_id = e.user_id
    e.sender.user_openid = senderOpenid
    e.sender.member_openid = senderMemberOpenid
    e.sender.group_openid = rawGroupId
    /** 为什么本体会从群名片拿uid啊? */ /** 自动绑定，神奇吧 */
    e.sender.card = senderMemberOpenid || senderOpenid
    e.sender.nickname = e.user_id

    /** 缓存好友列表 */
    if (!Bot[e.self_id].fl.get(e.user_id)) Bot[e.self_id].fl.set(e.user_id, { user_id: e.user_id })
    if (await redis.get(`lain:fl:${e.self_id}:${e.user_id}`)) redis.set(`lain:fl:${e.self_id}:${e.user_id}`, JSON.stringify({ user_id: e.user_id }))

    /** 保存消息次数 */
    try { common.recvMsg(e.self_id, e.adapter) } catch { }
    lain.info(this.id, `<群:${e.group_id}><用户:${e.user_id}> -> ${this.messageLog(e.message)}`)
    /** dau统计 */
    this.msg_count(data)
    return e
  }

  normalizeIncomingMessage(e, tinyId) {
    const message = Array.isArray(e.message) ? e.message : []
    const cleanId = id => String(id ?? '').replace(/^qg_/, '').split('-').pop()
    const selfIds = new Set([cleanId(this.id), cleanId(tinyId), cleanId(e.tiny_id)].filter(Boolean))
    const isGroupAtEvent = String(e.event_id || '').startsWith('GROUP_AT_MESSAGE_CREATE:')

    e.atme = message.some(i => {
      if (i?.type !== 'at') return false
      return [i.qq, i.id, i.user_id, i.tiny_id].some(id => selfIds.has(cleanId(id)))
    })

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
    if (msg) e.raw_message = msg
    delete e.msg
  }

  getMessageUserOpenid(e) {
    return String(e.author?.member_openid || e.sender?.member_openid || e.sender?.user_openid || e.user_id || e.author?.id || '').trim()
  }

  getMessageMemberOpenid(e) {
    return String(e.author?.member_openid || e.sender?.member_openid || e.sender?.user_openid || e.user_id || '').trim()
  }

  formatQQBotId(id) {
    const text = String(id ?? '').trim()
    if (!text) return undefined
    return text.startsWith(`${this.id}-`) ? text : `${this.id}-${text.split('-').pop()}`
  }

  /** 前缀处理 */
  hasAlias(text, e, hasAlias = true) {
    text = text.trim()
    if (Bot[this.id].config.other.Prefix && text.startsWith('/')) {
      return text.replace(/^\s*\/\s*/, "#")
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
        if (Bot[this.id].config.other.Prefix) text = text.replace(/^\s*\/\s*/, "#")
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
          for (const p of this.HandleURL(text)) {
            if (p.type === 'button' || p.type === 'keyboard') buttonRows.push(...this.normalizeButtons(e, p))
            else appendText(p.text)
          }
          break
        }
        case 'at': {
          if ((i.qq || i.id) === 'all') {
            content += '<qqbot-at-everyone />'
          } else {
            let qq
            if (Bot.QQToOpenid) {
              try { qq = await Bot.QQToOpenid(i.qq || i.id, e) } catch { }
            }
            qq = String(qq || i.qq || i.id || '').trim().split('-')
            content += `<qqbot-at-user id="${qq[1] || qq[0]}" />`
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
          appendText(await this.makeMarkdownContent(e, i.data || i))
          break
        case 'reply':
          reply = i
          break
        case 'video':
        case 'record':
        case 'audio':
        case 'ark':
        case 'embed':
        case 'file':
        default:
          await flushMarkdown()
          if (i.type === 'record') i = await this.getAudio(i.file)
          else if (i.type === 'audio') i = await this.getAudio(i.file || i.url)
          else if (i.type === 'video') i = await this.getVideo(i?.url || i.file)
          else if (i.type === 'file' && i.file) i = { type: 'text', text: `文件：${i.file}` }
          message.push(i)
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
        const { width, height, url } = await Bot.imageToUrl(file)
        common.mark('Lain-plugin', `使用自定义图床发送图片：${url}`)
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
          buttons.push(btn)
        } else {
          const built = this.buildButton(e, {
            text: btn.text ?? btn.label ?? btn.data ?? btn.input ?? btn.callback ?? btn.link ?? '',
            clicked_text: btn.clicked_text ?? btn.visited_label,
            link: btn.link,
            callback: btn.callback,
            input: btn.input ?? (!btn.link && btn.callback == null ? btn.data : undefined),
            send: btn.send ?? btn.enter ?? (!btn.link && btn.callback == null && btn.data != null ? true : undefined),
            permission: btn.permission ?? btn.list,
            style: btn.style,
            tips: btn.tips ?? btn.unsupport_tips,
            QQBot: btn.QQBot,
          }, buttons.length % 2)
          if (built) buttons.push(built)
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
          if ((i.qq || i.id) === 'all') {
            content.push('<qqbot-at-everyone />')
          } else {
            let qq
            if (Bot.QQToOpenid) {
              try {
                qq = await Bot.QQToOpenid(i.qq || i.id, e)
              } catch { }
            }
            qq = String(qq || i.qq || i.id || '').trim().split('-')
            content.push(`<qqbot-at-user id="${qq[1] || qq[0]}" />`)
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
    const message = [markdown]

    const btnRows = this.normalizeButtons(e, options.buttons || options.button)
    if (btnRows.length) {
      message.push({ type: 'keyboard', content: { rows: btnRows } })
    }

    return message
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
      for (let p of Button) {
        for (let v of p.plugin.rule) {
          const regExp = new RegExp(v.reg)
          if (regExp.test(e.msg)) {
            p.e = e
            const button = await p[v.fnc](e)
            /** 无返回不添加 */
            if (button) return [...(Array.isArray(button) ? button : [button])]
          }
        }
      }
      return false
    } catch (error) {
      common.error('Lain-plugin', error)
      return false
    }
  }

  /** 发送好友消息 */
  async sendFriendMsg(userId, data) {
    userId = userId.split('-')?.[1] || userId
    /** 构建一个普通e给按钮用 */
    let e = {
      bot: Bot[this.id],
      user_id: userId,
      message: common.array(data)
    }

    e.message.forEach(i => { if (i.type === 'text') e.msg = (e.msg || '') + (i.text || '').trim() })
    const { Pieces, reply } = await this.getQQBot(data, e)
    if (Bot.QQToOpenid) {
      try {
        userId = await Bot.QQToOpenid(userId, e, 'user')
      } catch { }
    }
    Pieces.forEach(i => {
      if (reply) i = Array.isArray(i) ? [...i, reply] : [i, reply]
      this.sdk.sendPrivateMessage(userId, i, this.sdk)
      logger.debug('发送主动好友消息：', JSON.stringify(i))
      this.send_count()
    })
  }

  /** 发送群消息 */
  async sendGroupMsg(groupID, data) {
    /** 构建一个普通e给按钮用 */
    let e = {
      bot: Bot[this.id],
      group_id: groupID,
      user_id: 'QQBot',
      message: common.array(data)
    }

    e.message.forEach(i => { if (i.type === 'text') e.msg = (e.msg || '') + (i.text || '').trim() })
    const { Pieces, reply } = await this.getQQBot(data, e)
    /** 获取正确的id */
    if (Bot.QQToOpenid) {
      try {
        groupID = await Bot.QQToOpenid(groupID, e, 'group')
      } catch {
        groupID = groupID.split('-')[1] || groupID.split('-')[0] || groupID
      }
    }

    Pieces.forEach(i => {
      if (reply) i = Array.isArray(i) ? [...i, reply] : [i, reply]
      this.sdk.sendGroupMessage(groupID, i, this.sdk)
      this.send_count()
      logger.debug('发送主动群消息：', JSON.stringify(i))
    })
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
      msg = Array.isArray(msg) ? [{ type: 'reply', id: e.message_id }, ...msg] : [{ type: 'reply', id: e.message_id }, msg]
      if (!e.friend) {
        return { ok: true, data: await this.sdk.sendGroupMessage(e.data.group_id, msg, this.sdk) }
      } else {
        return { ok: true, data: await this.sdk.sendPrivateMessage(e.data.user_id, msg, this.sdk) }
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

    const data = {
      raw: event,
      bot: Bot[this.id],
      self_id: this.id,
      adapter: 'QQBot',
      post_type: 'message',
      message_type: callback?.group_id ? 'group' : 'private',
      sub_type: 'callback',
      message_id: event.event_id ? 'event_' + event.event_id : event.id,
      time: event.timestamp || Date.now() / 1000,
      user_id: this.id + '-' + operatorId,
      group_id: callback?.group_id ? this.id + '-' + callback.group_id : undefined,
      sender: { user_id: this.id + '-' + operatorId },
      message: [
        { type: 'at', qq: this.id },
        { type: 'text', text: msg },
      ],
      raw_message: msg,
      reply: async (replyMsg) => {
        if (callback?.group_id) {
          return this.sendGroupMsg(callback.group_id, replyMsg)
        } else {
          return this.sendFriendMsg(operatorId, replyMsg)
        }
      },
    }

    if (data.group_id) {
      data.group = this.pickGroup(callback.group_id)
      common.mark('Lain-plugin', '群按钮点击: [' + data.group_id + ', ' + data.user_id + '] ' + msg)
    } else {
      common.mark('Lain-plugin', '好友按钮点击: [' + data.user_id + '] ' + msg)
    }

    Bot.emit('message', data)
  }

  // ========== 新版本 Button 构建器 ==========

  /**
   * 构建单个按钮
   * btn: { text, link?, callback?, input?, send?, permission?, style?, clicked_text?, QQBot? }
   * action type: 0=link, 1=callback, 2=input
   * permission: 'all'(默认) | 'admin' | ['uid1', 'uid2']
   */
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

    return msg
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
