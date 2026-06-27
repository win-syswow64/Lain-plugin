import { randomUUID } from 'crypto'
import path from 'path'
import { WebSocketServer } from 'ws'
import common from '../../lib/common/common.js'
import { faceMap, pokeMap } from '../../model/shamrock/face.js'
import api from './api.js'
import cfg from '../../../../lib/config/config.js'
import QQBotIdMap from '../../model/qqbot-id-map.js'

class OneBotV11 {
  constructor (bot, request) { 
    if(!bot && !request) return false
    /** 存一下 */
    bot.request = request
    /** 机器人QQ号 */
    this.id = Number(request.headers['x-self-id'])
    /** ws */
    this.bot = bot
    /** 监听事件 */
    this.bot.on('message', (data) => this.event(data))
    /** 监听连接关闭事件 */
    bot.on('close', () => logger.warn(`[Lain-plugin] [OneBotV11] QQ ${this.id} 连接已断开`))
  }

  /** 收到请求 */
  async event (data) {
    /** 解析得到的JSON */
    data = JSON.parse(data)
    /** debug日志 */
    common.debug(this.id, '[ws] received -> ', JSON.stringify(data))
    /** 带echo事件为主动请求得到的响应，另外保存 */
    if (data?.echo) {
      lain.echo[data.echo] = data
      return true
    }
    try {
      /** 处理事件 */
      this[data?.post_type](data)
    } catch (error) {
      /** 处理错误打印日志 */
      logger.error('[onebot]事件处理错误', error)
      logger.mark('[onebot]事件处理错误', data)
    }
  }

  /** 元事件 */
  async meta_event (data) {
    switch (data.meta_event_type) {
      /** 生命周期 */
      case 'lifecycle':
        this.LoadBot()
        common.info('Lain-plugin', `[OneBotV11] QQ ${this.id} 建立连接成功，正在加载资源中`)
        break
      /** 心跳 */
      case 'heartbeat':
        common.debug('Lain-plugin', `[OneBotV11] QQ ${this.id} 收到心跳：${JSON.stringify(data.status, null, 2)}`)
        break
      default:
        logger.error(`[onebot][未知事件] ${JSON.stringify(data)}`)
        break
    }
  }

  /** 消息事件 */
async message (data) {
  const e = await this.ICQQEvent(data)

  if (data.message_type === "group") {
    const handled = await QQBotIdMap.handleQQGroupMessage(e, async event => {
      await Bot.emit('message.group', event)
      await Bot.emit('message', event)
    })
    if (handled) return
    await Bot.emit('message.group', e)
  } else {
    await Bot.emit('message.private', e)
  }

  await Bot.emit('message', e)
}


  /** 自身消息事件 */
  async message_sent (data) {
    data.post_type = 'message'
    /** 屏蔽由喵崽处理过后发送后的消息 */
    await common.sleep(1500)
    if (await redis.get(`OneBotV11:${this.id}:${data.message_id}`)) return
    /** 转置消息后给喵崽 */
    await Bot.emit('message', await this.ICQQEvent(data))
  }

  /** 通知事件 */
  async notice (data) {
    /** 啊啊啊，逼死强迫症 */
    data.post_type = 'notice';
    (async () => {
      if (['group_increase', 'group_decrease', 'group_admin'].includes(data.notice_type)) {
        // 加载或刷新该群的信息
        let group = await api.get_group_info(this.id, data.group_id, true)
        if (group?.group_id) {
          Bot.gl.set(data.group_id, group)
          Bot[this.id].gl.set(data.group_id, group)
          // 加载或刷新该群的群成员列表
          this.loadGroupMemberList(data.group_id)
        }
      }
    })().catch(common.error)
    switch (data.notice_type) {
      case "group_recall":
        data.sub_type = 'recall'
        data.notice_type = 'group'
        try {
          let gl = Bot[this.id].gl.get(data.group_id)
          data = { ...data, ...gl }
        } catch { }
        if (data.operator_id === data.user_id) {
          common.info(this.id, `群消息撤回：[${data.group_id}，${data.user_id}] ${data.message_id}`)
        } else {
          common.info(this.id, `群消息撤回：[${data.group_id}]${data.operator_id} 撤回 ${data.user_id}的消息 ${data.message_id} `)
        }
        return await Bot.emit('notice.group', await this.ICQQEvent(data))
      case 'group_increase': {
        data.notice_type = 'group'
        let subType = data.sub_type
        data.sub_type = 'increase'
        if (this.id === data.user_id) {
          common.info(this.id, `机器人加入群聊：[${data.group_id}}]`)
        } else {
          switch (subType) {
            case 'invite': {
              common.info(this.id, `[${data.operator_id}]邀请[${data.user_id}]加入了群聊[${data.group_id}] `)
              break
            }
            default: {
              common.info(this.id, `新人${data.user_id}加入群聊[${data.group_id}] `)
            }
          }
        }
        const e = await this.ICQQEvent(data);
        await Bot.emit('notice.group', e)
        return await Bot.emit('notice.group.increase', e)
      }
      case 'group_decrease': {
        switch (data.sub_type) {
          case 'leave': {
            data.operator_id = data.user_id
            break
          }
        }
        data.notice_type = 'group'
        data.sub_type = 'decrease'
        if (this.id === data.user_id) {
          common.info(this.id, (data.operator_id === data.user_id)
            ? `机器人被[${data.operator_id}]踢出群聊：[${data.group_id}}]`
            : `机器人退出群聊：[${data.group_id}}]`)
          // 移除该群的信息
          Bot.gl.delete(data.group_id)
          Bot[this.id].gl.delete(data.group_id)
          Bot[this.id].gml.delete(data.group_id)
        } else {
          common.info(this.id, (data.operator_id !== data.user_id)
            ? `成员[${data.user_id}]被[${data.operator_id}]踢出群聊：[${data.group_id}]`
            : `成员[${data.user_id}]退出群聊[${data.group_id}}]`)
        }
        const e = await this.ICQQEvent(data);
        await Bot.emit('notice.group', e)
        return await Bot.emit('notice.group.decrease', e)
      }
      case 'group_admin': {
        data.notice_type = 'group'
        data.set = data.sub_type === 'set'
        data.sub_type = 'admin'
        if (this.id === data.user_id) {
          let gml = await Bot[this.id].gml.get(data.group_id)
          gml[this.id] = { ...gml.get(this.id) }
          if (data.set) {
            gml[this.id].role = 'admin'
            common.info(this.id, `机器人[${this.id}]在群[${data.group_id}]被设置为管理员`)
          } else {
            gml[this.id].role = 'member'
            common.info(this.id, `机器人[${this.id}]在群[${data.group_id}]被取消管理员`)
          }
          Bot[this.id].gml.set(data.group_id, { ...gml })
        } else {
          let gml = await Bot[this.id].gml.get(data.group_id)
          gml[data.user_id] = { ...gml.get(data.user_id) }
          if (data.set) {
            gml[data.user_id].role = 'admin'
            common.info(this.id, `成员[${data.user_id}]在群[${data.group_id}]被设置为管理员`)
          } else {
            gml[data.user_id].role = 'member'
            common.info(this.id, `成员[${data.user_id}]在群[${data.group_id}]被取消管理员`)
          }
          Bot[this.id].gml.set(data.group_id, { ...gml })
        }
        const e = await this.ICQQEvent(data);
        await Bot.emit('notice.group', e)
        return await Bot.emit('notice.group.admin', e)
      }
      case 'group_ban': {
        data.notice_type = 'group'
        if (data.sub_type === 'lift_ban') {
          data.sub_type = 'ban'
          data.duration = 0
        } else {
          data.sub_type = 'ban'
        }
        if (this.id === data.user_id) {
          common.info(this.id, data.duration === 0
            ? `机器人[${this.id}]在群[${data.group_id}]被[${data.operator_id}]解除禁言`
            : `机器人[${this.id}]在群[${data.group_id}]被[${data.operator_id}]禁言${data.duration}秒`)
        } else {
          common.info(this.id, data.duration === 0
            ? `成员[${data.user_id}]在群[${data.group_id}]被[${data.operator_id}]解除禁言`
            : `成员[${data.user_id}]在群[${data.group_id}]被[${data.operator_id}]禁言${data.duration}秒`)
        }
        // 异步加载或刷新该群的群成员列表以更新禁言时长
        this.loadGroupMemberList(data.group_id)
        const e = await this.ICQQEvent(data);
        await Bot.emit('notice.group', e)
        return await Bot.emit('notice.group.ban', e)
      }
      case 'poke':
      common.info("poke")
        if (!data.group_id) {
          common.info(this.id, `好友[${data.user_id}]戳了戳[${data.target_id}]`)
          data.notice_type = 'friend'
          data.operator_id = data.user_id
          return await Bot.emit('notice.friend', await this.ICQQEvent(data))
        } else {
          common.info(this.id, `群[${data.group_id}]成员[${data.user_id}]戳了戳[${data.target_id}]`)
          data.notice_type = 'group'
          data.operator_id = data.user_id
          data.user_id = data.target_id
          return await Bot.emit('notice.group', await this.ICQQEvent(data))
        }
      case 'notify':
        switch (data.sub_type) {
          case 'poke': {
            let action = data.poke_detail?.action || '戳了戳'
            let suffix = data.poke_detail?.suffix || ''
            if (!data.group_id) {
            	data.notice_type = 'friend'
          	data.operator_id = data.user_id
            } else {
            	data.notice_type = 'group'
	          data.operator_id = data.user_id
	          data.user_id = data.target_id
            }
            common.info(this.id, `[${data.user_id}]${action}[${data.target_id}]${suffix}`)
            break
          }
          case 'title': {
            common.info(this.id, `群[${data.group_id}]成员[${data.user_id}]获得头衔[${data.title}]`)
            let gml = Bot[this.id].gml.get(data.group_id)
            let user = gml.get(data.user_id)
            user.title = data.title
            gml[data.user_id] = user
            Bot[this.id].gml.set(data.group_id, gml)
            break
          }
          default:
        }
        // const time = Date.now()
        // if (time - pokeCD < 1500) return false
        // pokeCD = time
        break
      case 'friend_add':{
        common.info(this.id, `新增好友[${data.user_id}]`)
        this.loadFriendList()
        break
      }
      case 'essence': {
        // todo
        common.info(this.id, `群[${data.group_id}]成员[${data.sender_id}]的消息[${data.message_id}]被[${data.operator_id}]${data.sub_type === 'add' ? '设为' : '移除'}精华`)
        break
      }
      case 'group_card': {
        common.info(this.id, `群[${data.group_id}]成员[${data.user_id}]群名片变成为${data.card_new}`)
        let gml = Bot[this.id].gml.get(data.group_id)
        let user = gml.get(data.user_id)
        user.card = data.card_new
        gml[data.user_id] = user
        Bot[this.id].gml.set(data.group_id, gml)
        return await Bot.emit('notice.group', await this.ICQQEvent(data))
      }
      case 'friend_recall':
        data.sub_type = 'recall'
        data.notice_type = 'friend'
        try {
          let fl = Bot[this.id].fl.get(data.user_id)
          data = { ...data, ...fl }
        } catch { }
        common.info(this.id, `好友消息撤回：[(${data.user_id})] ${data.message_id}`)
        return await Bot.emit('notice.friend', await this.ICQQEvent(data))
      default:
    }
    return await Bot.emit('notice', await this.ICQQEvent(data))
  }

  /** 请求事件 */
  async request (data) {
    data.post_type = 'request'
    switch (data.request_type) {
      case 'group': {
        data.tips = data.comment
        try {
          let gl = Bot[this.id].gl.get(data.group_id)
          let fl = await Bot[this.id].api.get_stranger_info(Number(data.user_id))
          data = { ...data, ...gl, ...fl }
          data.group_id = Number(data.group_id)
          data.user_id = Number(data.user_id)
        } catch { }
        if (data.sub_type === 'add') {
          common.info(this.id, `[${data.user_id}]申请入群[${data.group_id}]: ${data.tips}`)
        } else {
          // invite
          common.info(this.id, `[${data.user_id}]邀请机器人入群[${data.group_id}]: ${data.tips}`)
        }
        break
      }
      case 'friend': {
        data.sub_type = 'add'
        common.info(this.id, `[${data.user_id}]申请加机器人[${this.id}]好友: ${data.comment}`)
        break
      }
    }
    data.post_type = 'request'
    switch (data.request_type) {
      case 'group': {
        data.tips = data.comment
        try {
          let gl = Bot[this.id].gl.get(data.group_id)
          let fl = await Bot[this.id].api.get_stranger_info(Number(data.user_id))
          data = { ...data, ...gl, ...fl }
          data.group_id = Number(data.group_id)
          data.user_id = Number(data.user_id)
        } catch { }
        if (data.sub_type === 'add') {
          common.info(this.id, `[${data.user_id}]申请入群[${data.group_id}]: ${data.tips}`)
        } else {
          // invite
          common.info(this.id, `[${data.user_id}]邀请机器人入群[${data.group_id}]: ${data.tips}`)
        }
        break
      }
      case 'friend': {
        data.sub_type = 'add'
        try {
          let fl = await Bot[this.id].api.get_stranger_info(Number(data.user_id))
          data = { ...data, ...fl }
          data.user_id = Number(data.user_id)
        } catch { }
        common.info(this.id, `[${data.user_id}]申请加机器人[${this.id}]好友: ${data.comment}`)
        break
      }
    }
    return await Bot.emit('request', await this.ICQQEvent(data))
  }

  /** 注册Bot */
  async LoadBot () {
    /** 构建基本参数 */
    Bot[this.id] = {
      ws: this.bot,
      bkn: 0,
      fl: new Map(),
      gl: new Map(),
      tl: new Map(),
      gml: new Map(),
      guilds: new Map(),
      adapter: 'OneBotv11',
      uin: this.id,
      tiny_id: String(this.id),
      avatar: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${this.id}`,
      sendApi: async (action, params) => await this.sendApi(action, params),
      pickMember: (group_id, user_id) => this.pickMember(group_id, user_id),
      pickUser: (user_id) => this.pickFriend(Number(user_id)),
      pickFriend: (user_id) => this.pickFriend(Number(user_id)),
      pickGroup: (group_id) => this.pickGroup(Number(group_id)),
      setEssenceMessage: async (msg_id) => await this.setEssenceMessage(msg_id),
      sendPrivateMsg: async (user_id, msg) => await this.sendFriendMsg(Number(user_id), msg),
      getGroupMemberInfo: async (group_id, user_id, no_cache) => await this.getGroupMemberInfo(Number(group_id), Number(user_id), no_cache),
      removeEssenceMessage: async (msg_id) => await this.removeEssenceMessage(msg_id),
      makeForwardMsg: async (message) => await this.makeForwardMsg(message),
      getMsg: (msg_id) => '',
      quit: (group_id) => this.quit(group_id),
      getFriendMap: () => Bot[this.id].fl,
      getGroupList: () => Bot[this.id].gl,
      getGuildList: () => Bot[this.id].tl,
      getMuteList: async (group_id) => await this.getMuteList(group_id),
      getChannelList: async (guild_id) => this.getChannelList(guild_id),
      _loadGroup: this.loadGroup,
      _loadGroupMemberList: this.loadGroupMemberList,
      _loadFriendList: this.loadFriendList,
      _loadAll: this.LoadAll,
      readMsg: async () => common.recvMsg(this.id, 'OneBotV11', true),
      MsgTotal: async (type) => common.MsgTotal(this.id, 'OneBotV11', type, true),
      api: new Proxy(api, {
        get: (target, prop) => {
          try {
            if (typeof target[prop] === 'function') {
              return (...args) => target[prop](this.id, ...args)
            } else {
              return target[prop]
            }
          } catch (error) {
            logger.error(error)
          }
        }
      })
    }

    const version_info = await api.SendApi(this.id, 'get_version_info', {})
    /** 获取版本信息 */
    this.version = version_info
    /** QQ登录协议版本 */
    this.QQVersion = version_info.nt_protocol
    const apk = version_info.nt_protocol//.split('|')

    Bot[this.id].stat = { start_time: Date.now() / 1000, recv_msg_cnt: 0 }
    //Bot[this.id].apk = { display: apk[0].trim(), version: apk[1].trim() }
    Bot[this.id].version = { id: 'QQ', name: version_info.app_name, version: version_info.app_version }

    /** 重启 */
    await common.init('Lain:restart:OneBotV11')
    /** 保存uin */
    if (!Bot.adapter.includes(this.id)) Bot.adapter.push(this.id)
    /** 加载缓存资源 */
    this.LoadAll()
  }

  /** 加载缓存资源 */
  async LoadAll () {
    /** 获取bot自身信息 */
    const info = await api.get_login_info(this.id)
    Bot[this.id].nickname = info?.nickname || ''
    this.nickname = info?.nickname || ''
    let _this = this
    await Promise.all([
      // 加载群信息
      (async () => {
        // 加载群列表
        let groupList = await _this.loadGroup()
        // 加载群员
        await Promise.all(groupList.map(async (group, index) => {
          await common.sleep(50 * Math.floor(index / 10))
          await _this.loadGroupMemberList(group.group_id)
        }))
      })(),
      // 加载好友信息
      _this.loadFriendList()
    ])

    Bot[this.id].cookies = {}

    const log = `onebot加载资源成功：加载了${Bot[this.id].fl.size}个好友，${Bot[this.id].gl.size}个群。`
    common.info(this.id, log)
    return log
  }

  /** 群列表 */
  async loadGroup (id = this.id) {
    let groupList
    for (let retries = 0; retries < 5; retries++) {
      groupList = await api.get_group_list(id)
      if (!(groupList && Array.isArray(groupList))) {
        common.error(this.id, `OneBotV11群列表获取失败，正在重试：${retries + 1}`)
      }
      await common.sleep(50)
    }

    if (groupList && typeof groupList === 'object') {
      for (const i of groupList) {
        i.uin = this.id
        /** 给锅巴用 */
        Bot.gl.set(i.group_id, i)
        /** 自身参数 */
        Bot[id].gl.set(i.group_id, i)
      }
    }
    common.debug(id, '加载群列表完成')
    return groupList
  }

  /** 获取群成员，缓存到gml中 */
  async loadGroupMemberList (groupId, id = this.id) {
    try {
      let gml = new Map()
      let memberList = await api.get_group_member_list(id, groupId)
      for (const user of memberList) {
        user.uin = this.id
        gml.set(user.user_id, user)
      }
      Bot.gml.set(groupId, gml)
      Bot[id].gml.set(groupId, gml)
      common.debug(id, `加载[${groupId}]群成员完成`)
    } catch (error) { }
  }

  /** 好友列表 */
  async loadFriendList (id = this.id) {
    let friendList
    for (let retries = 0; retries < 5; retries++) {
      friendList = await api.get_friend_list(id)
      if (!(friendList && Array.isArray(friendList))) {
        common.error(this.id, `OneBotV11好友列表获取失败，正在重试：${retries + 1}`)
      }
      await common.sleep(50)
    }

    /** 好友列表获取失败 */
    if (!friendList || !(typeof friendList === 'object')) {
      common.error(this.id, 'OneBotV11好友列表获取失败次数过多，已停止重试')
    }

    if (friendList && typeof friendList === 'object') {
      for (let i of friendList) {
        i.nickname = i.user_remark || i.user_displayname || i.user_name
        i.uin = this.id
        /** 给锅巴用 */
        Bot.fl.set(i.user_id, i)
        /** 自身参数 */
        Bot[id].fl.set(i.user_id, i)
      }
    }
    common.debug(id, '加载好友列表完成')
  }

  /** 群对象 */
  pickGroup (group_id) {
    const name = Bot[this.id].gl.get(group_id)?.group_name || group_id
    const is_admin = Bot[this.id].gml.get(group_id)?.get(this.id)?.role === 'admin'
    const is_owner = Bot[this.id].gml.get(group_id)?.get(this.id)?.role === 'owner'
    return {
      name,
      is_admin: is_owner || is_admin,
      is_owner,
      /** 发送消息 */
      sendMsg: async (msg) => await this.sendGroupMsg(group_id, msg),
      /** 撤回消息 */
      recallMsg: async (msg_id) => await this.recallMsg(msg_id),
      /** 制作转发 */
      makeForwardMsg: async (message) => await this.makeForwardMsg(message),
      /** 戳一戳 */
      pokeMember: async (operator_id) => await api.group_touch(this.id, group_id, operator_id),
      /** 禁言 */
      muteMember: async (user_id, time) => await api.set_group_ban(this.id, group_id, Number(user_id), Number(time)),
      /** 全体禁言 */
      muteAll: async (type) => await api.set_group_whole_ban(this.id, group_id, type),
      /** 设置群名称 */
      setName: async (name) => await api.set_group_name(this.id, group_id, name),
      /** 退群 */
      quit: async () => await api.set_group_leave(this.id, group_id),
      /** 设置管理 */
      setAdmin: async (qq, type) => await api.set_group_admin(this.id, group_id, qq, type),
      /** 踢 */
      kickMember: async (qq, reject_add_request = false) => { await api.set_group_kick(this.id, group_id, qq, reject_add_request); return true },
      /** 头衔 **/
      setTitle: async (qq, title, duration) => { await api.set_group_special_title(this.id, group_id, qq, title); return true },
      /** 修改群名片 **/
      setCard: async (qq, card) => await api.set_group_card(this.id, group_id, qq, card),
      pickMember: (id) => this.pickMember(group_id, id),
      /** 获取群成员列表 */
      getMemberMap: async () => await this.getMemberMap(group_id),
      /** 设置精华 */
      setEssenceMessage: async (msg_id) => await this.setEssenceMessage(msg_id),
      /** 移除群精华消息 **/
      removeEssenceMessage: async (msg_id) => await this.removeEssenceMessage(msg_id),
      /** 上传群文件 */
      sendFile: async (filePath) => await this.upload_group_file(group_id, filePath),
      /** 打卡 */
      sign: async () => await api.send_group_sign(this.id, group_id),
      /** 音乐分享 */
      shareMusic: async (platform, id, value) => await this.shareMusic(group_id, platform, id, value, true),
      /** 获取文件下载地址 */
      getFileUrl: async (file_id) => await this.getFileUrl(file_id),
      /**
       * 获取聊天历史记录
       * @param msg_id 起始消息的message_id（默认为0，表示从最后一条发言往前）
       * @param num 数量
       * @param reply 是否展开回复引用的消息(source)（实测数量大的时候耗时且可能出错）
       * @return {Promise<Awaited<unknown>[]>}
       */
      getChatHistory: async (msg_id, num, reply) => {
        let { messages } = await api.get_group_msg_history(this.id, group_id, num, msg_id)
        logger.info(JSON.stringify(messages));
        if (!messages) {
          logger.warn('获取历史消息失败')
          return []
        }
        let group = Bot[this.id].gl.get(group_id)
        messages = messages.map(async m => {
          m.group_name = group?.group_name || group_id
          m.atme = !!m.message.find(msg => msg.type === 'at' && msg.data?.qq == this.id)
          let result = await this.getMessage(m.message, group_id, reply)
          m = Object.assign(m, result)
          return m
        })
        return Promise.all(messages)
      }
    }
  }

  /** 好友对象 */
  pickFriend (user_id) {
    return {
      sendMsg: async (msg) => await this.sendFriendMsg(user_id, msg, false),
      recallMsg: async (msg_id) => await this.recallMsg(msg_id),
      makeForwardMsg: async (message) => await this.makeForwardMsg(message),
      getAvatarUrl: (size = 0) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${user_id}`,
      sendFile: async (filePath) => await this.upload_private_file(user_id, filePath),
      /** 获取文件下载地址 */
      getFileUrl: async (file_id) => await this.getFileUrl(file_id),
      shareMusic: async (platform, id, value) => await this.shareMusic(user_id, platform, id, value, false),
      
      /**
       * 获取私聊聊天记录
       * @param msg_id 起始消息的message_id（默认为0，表示从最后一条发言往前）
       * @param num 数量
       * @param reply 是否展开回复引用的消息(source)（实测数量大的时候耗时且可能出错）
       * @return {Promise<Awaited<unknown>[]>}
       */
      getChatHistory: async (msg_id, num, reply) => {
        msg_id = Number(msg_id)
        let { messages } = await api.get_friend_msg_history(this.id, user_id, num, msg_id)
        messages = messages.map(async m => {
          let result = await this.getMessage(m.message, null, reply)
          m = Object.assign(m, result)
          return m
        })
        return Promise.all(messages)
      }
    }
  }

  /** 群员对象 */
  pickMember (group_id, user_id, refresh = false, cb = () => { }) {
    if (!refresh) {
      /** 取缓存！！！别问为什么，因为傻鸟同步 */
      let member = Bot[this.id].gml.get(group_id)?.get(user_id) || {}
      member.info = { ...member }
      member.getAvatarUrl = (size = 0) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${user_id}`
      return member
    } else {
      api.get_group_member_info(this.id, group_id, user_id, true).then(res => {
        if (typeof cb === 'function') {
          cb(res)
        }
      })
      return {}
    }
  }

  /** 群成员列表 */
  async getMemberMap (group_id) {
    let group_Member = Bot[this.id].gml.get(group_id)
    if (group_Member && Object.keys(group_Member) > 0) return group_Member
    group_Member = new Map()
    let member_list = await api.get_group_member_list(this.id, group_id)
    member_list.forEach(user => {
      group_Member.set(user.user_id, user)
    })
    return group_Member
  }

  /** 频道成员列表 */
  getChannelList (guild_id) {
    return {
      channel_id: 'string',
      channel_name: 'string',
      channel_type: 'ChannelType',
      guild_id: 'string'
    }
  }

  /** 上传群文件 */
  async upload_group_file (group_id, file) {
    
    file = await Bot.FormatFile(file)
    if (!file?.match(/^file:\/\//)) {
      file = await Bot.FileToPath(file)
      file = await Bot.FormatFile(file)
    }
    file = file.replace(/^file:\/\//, '')
    const name = path.basename(file) || Date.now() + path.extname(file)
    //file = 'base64://' + await Bot.Base64(file)
    return await api.upload_group_file(this.id, group_id, file, name)
  }

  /** 上传好友文件 */
  async upload_private_file (user_id, file) {
    file = await Bot.FormatFile(file)
    if (!file.match(/^file:\/\//)) {
      file = await Bot.FileToPath(file)
      file = await Bot.FormatFile(file)
    }
    file = file.replace(/^file:\/\//, '')
    const name = path.basename(file) || Date.now() + path.extname(file)
    //file = 'base64://' + await Bot.Base64(file)
    return await api.upload_private_file(this.id, user_id, file, name)
  }

  /** 获取文件下载链接 */
  async getFileUrl (file_id) {
    return await api.get_file(this.id, file_id)
  }

  /** 音乐分享 */
	async shareMusic(group_id, platform, id, value = {}, isGroup = true) {
	  // 1. 平台为 QQ 或 163，直接走内置音乐卡片
	  if (['qq', '163'].includes(platform)) {
	  	if (isGroup)
	  	{
	  		return await this.sendGroupMsg(group_id, {
		      type: 'music',
		      data: { type: platform, id }
		    })
	  	} 
	  	else
	  	{
	  		return await this.sendFriendMsg(group_id, {
		      type: 'music',
		      data: { type: platform, id }
		    })
	  	}
	    
	  }
	
	  // 2. 自定义音乐卡片必须提供必要字段
	  if (!value || !value.url || !value.audio) {
	    return 'platform not supported yet or missing required fields'
	  }

	  // 3. 发送自定义音乐卡片
	  if (isGroup)
	  {
	  	return await this.sendGroupMsg(group_id, {
		    type: 'music',
		    data: {
		      type: 'custom',
		      url: value.url,
		      audio: value.audio,
		      title: value.title ?? '',
		      image: value.image ?? ''
		    }
		  })
	  }
	  else
	  {
	  	return await this.sendFriendMsg(group_id, {
		    type: 'music',
		    data: {
		      type: 'custom',
		      url: value.url,
		      audio: value.audio,
		      title: value.title ?? '',
		      image: value.image ?? ''
		    }
		  })
	  }
	}


  /** 设置精华 */
  async setEssenceMessage (msg_id) {
    let res = await api.set_essence_msg(this.id, msg_id)
    return res?.message === '成功' ? '加精成功' : res?.message
  }

  /** 移除群精华消息 **/
  async removeEssenceMessage (msg_id) {
    let res = await api.delete_essence_msg(this.id, msg_id)
    return res?.message === '成功' ? '加精成功' : res?.message
  }

  /** 获取群成员信息 */
  async getGroupMemberInfo (group_id, user_id, refresh) {
    /** 被自己坑了 */
    if (user_id == '88888' || user_id == 'stdin') user_id = this.id
    try {
      let member = await api.get_group_member_info(this.id, group_id, user_id, refresh)
      return member
    } catch {
      return { card: 'OneBotV11', nickname: 'OneBotV11' }
    }
  }

  /** 退群 */
  async quit (group_id) {
    return await api.set_group_leave(this.id, group_id)
  }

  /** 制作转发消息 */
  async makeForwardMsg (data) {
    if (!Array.isArray(data)) data = [data]
    let makeForwardMsg = {
      /** 标记下，视为转发消息，防止套娃 */
      test: true,
      message: [],
      data: { type: 'test', text: 'forward', app: 'com.tencent.multimsg', meta: { detail: { news: [{ text: '1' }] }, resid: '', uniseq: '', summary: '' } }
    }

    let msg = []
    for (let i in data) {
      /** 该死的套娃，能不能死一死啊... */
      if (typeof data[i] === 'object' && (data[i]?.test || data[i]?.message?.test)) {
        if (data[i]?.message?.test) {
          makeForwardMsg.message.push(...data[i].message.message)
        } else {
          makeForwardMsg.message.push(...data[i].message)
        }
      } else {
        if (!data[i]?.message) continue
        msg.push(data[i])
      }
    }

    if (msg.length) {
      for (let i of msg) {
        try {
          const { message: content } = await this.getOneBotV11(i.message)

          // const id = await this.sendApi('send_forward_msg', { messages: [{ type: 'node', data: { name: this.nickname || 'LagrangeCore', uin: String(this.id), content } }] })
          makeForwardMsg.message.push({ type: 'node', data: { type: 'node', data: { name: this.nickname || data[0].nickname, uin: String(this.id || data[0].user_id), content } } })
        } catch (err) {
          common.error(this.id, err)
        }
      }
    }
    return makeForwardMsg
  }


  /** 撤回消息 */
  async recallMsg (msg_id) {
    return await api.delete_msg(this.id, msg_id)
  }

  /** 获取禁言列表 */
  async getMuteList (group_id) {
    return await api.get_prohibited_member_list(this.id, group_id)
  }

  /** 转换消息为ICQQ格式 */
  async ICQQEvent (data) {
    const { post_type, group_id, user_id, message_type, message_id, sender } = data
    /** 初始化e */
    let e = data

    /** 消息事件 */
    const messagePostType = async function () {
      /** 处理message、引用消息、toString、raw_message */
      const { message, ToString, raw_message, log_message, source, file } = await this.getMessage(data.message, group_id)

      /** 通用数据 */
      e.uin = this.id // ???鬼知道哪来的这玩意，icqq都没有...
      e.message = message
      /** 兼容 ws-plugin：确保每个消息段有 text 属性避免 undefined.startsWith 报错 */
      for (const m of e.message) { if (m.text === undefined) m.text = '' }
      e.raw_message = raw_message
      e.log_message = log_message
      e.toString = () => ToString
      if (file) e.file = file
      if (source) e.source = source

      /** 群消息 */
      if (message_type === 'group') {
        let group_name
        try {
          group_name = Bot[this.id].gl.get(group_id).group_name
          group_name = group_name ? `${group_name}(${group_id})` : group_id
        } catch {
          group_name = group_id
        }
        e.log_message && common.info(this.id, `<群:${group_name || group_id}><用户:${sender?.card || sender?.nickname}(${user_id})> -> ${e.log_message}`)
        /** 手动构建member */
        e.member = {
          ...this.pickMember(group_id, user_id),
          is_admin: sender?.role === 'admin' || false,
          is_owner: sender?.role === 'owner' || false,
          /** 禁言 */
          mute: async (time) => await api.set_group_ban(this.id, group_id, user_id, time)
        }
        e.group = { ...this.pickGroup(group_id) }
      } else {
        /** 私聊消息 */
        e.log_message && common.info(this.id, `<好友:${sender?.card || sender?.nickname}(${user_id})> -> ${e.log_message}`)
        e.friend = { ...this.pickFriend(user_id) }
      }
    }
    /** 通知事件 */
    const noticePostType = async function () {
      if (e.sub_type === 'poke') {
        e.action = e.poke_detail?.action
        e.raw_message = `${e.operator_id} ${e.action} ${e.user_id}`
      }

      if (e.group_id) {
        e.notice_type = 'group'
        e.group = { ...this.pickGroup(group_id) }
        e.member = await Bot[this.id].api.get_stranger_info(Number(e.user_id))
        e.nickname = e.member?.nickname
      } else {
        e.notice_type = 'friend'
        e.friend = { ...this.pickFriend(user_id) }
      }
    }

    /** 请求事件 */
    const requestPostType = async function () {
      switch (e.request_type) {
        case 'friend': {
          e.approve = async (approve = true) => {
            if (e.flag) {
              return await api.set_friend_add_request(this.id, e.flag, approve)
            } else {
              common.error(this.id, '处理好友申请失败：缺少flag参数')
              return false
            }
          }
          break
        }
        case 'group': {
          try {
            let gl = Bot[this.id].gl.get(e.group_id)
            let fl = await Bot[this.id].api.get_stranger_info(Number(e.user_id))
            e = { ...e, ...gl, ...fl }
            e.group_id = Number(data.group_id)
            e.user_id = Number(data.user_id)
          } catch { }
          e.approve = async (approve = true) => {
            if (e.flag) return await api.set_group_add_request(this.id, e.flag, e.sub_type, approve)
            if (e.sub_type === 'add') {
              common.error(this.id, '处理入群申请失败：缺少flag参数')
            } else {
              // invite
              common.error(this.id, '处理邀请机器人入群失败：缺少flag参数')
            }
            return false
          }
          break
        }
        default:
      }
    }

    switch (post_type) {
      /** 消息事件 */
      case 'message':
        await messagePostType.call(this)
        break
      /** 通知事件 */
      case 'notice':
        await noticePostType.call(this)
        break
      /** 请求事件 */
      case 'request':
        await requestPostType.call(this)
        break
    }

    /** 快速撤回 */
    e.recall = async () => await api.delete_msg(this.id, message_id)
    /** 快速回复 */
    e.reply = async (msg, quote) => await this.sendReplyMsg(e, group_id, user_id, msg, quote)
    /** 点赞 */
    e.sendLike = async (user_id, times) => await api.send_like(this.id, user_id, times)
    /** 获取对应用户头像 */
    e.getAvatarUrl = (size = 0) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${user_id}`

    /** 添加适配器标识 */
    e.adapter = 'OneBotV11'

    /** 某些事件需要e.bot，走监听器没有。 */
    e.bot = Bot[this.id]
    /** 保存消息次数 */
    try { common.recvMsg(this.id, e.adapter) } catch { }
    return e
  }

  /**
 * 处理云崽的message
 * @param msg
 * @param group_id
 * @param reply 是否处理引用消息，默认处理
 * @return {Promise<{source: (*&{user_id, raw_message: string, reply: *, seq}), message: *[]}|{source: string, message: *[]}>}
 */
  async getMessage (msg, group_id, reply = true) {
    let file
    let source
    let message = []
    let ToString = []
    let log_message = []
    let raw_message = []

    for (let i of msg) {
      switch (i.type) {
        /** AT 某人 */
        case 'at':
          message.push({ type: 'at', qq: Number(i.data.qq) })
          try {
            let qq = i.data.qq
            ToString.push(`{at:${qq}}`)
            let groupMemberList = Bot[this.id].gml.get(group_id)?.get(qq)
            let at = groupMemberList?.card || groupMemberList?.nickname || qq
            raw_message.push(`@${at}`)
            log_message.push(at == qq ? `@${qq}` : `<@${at}:${qq}>`)
          } catch (err) {
            raw_message.push(`@${i.data.qq}`)
            log_message.push(`@${i.data.qq}`)
          }
          break
        case 'text':
          message.push({ type: 'text', text: i.data.text })
          raw_message.push(i.data.text)
          log_message.push(i.data.text)
          ToString.push(i.data.text)
          break
        /** 表情 */
        case 'face':
          message.push({ type: 'face', ...i.data })
          raw_message.push(`[${faceMap[Number(i.data.id)] || '动画表情'}]`)
          log_message.push(`<${faceMap[Number(i.data.id)] || `动画表情:${i.data.id}`}>`)
          ToString.push(`{face:${i.data.id}}`)
          break
        /** 回复 */
        case 'reply':
          logger.info("reply")
          if (reply) {
            source = await this.source(i, group_id)
            if (source && group_id) {
              let qq = Number(source.sender.user_id)
              let text = source.sender.nickname
              for (let m of source.message) {
              	logger.info("m: " + m);
			  message.push(m)
			}
              message.unshift({ type: 'at', qq, text })

              raw_message.unshift(`@${text}`)
              log_message.unshift(`<回复:${text}(${qq})>`)
            }
          }
          break
        /** 图片 */
        case 'image':
          message.push({ ...i.data, type: 'image' })
          raw_message.push('[图片]')
          log_message.push(`<图片:${i.data?.url || i.data.file}>`)
          ToString.push(`{image:${i.data.file}}`)
          break
        /** 语音 */
        case 'record':
          message.push({ type: 'record', ...i.data })
          raw_message.push('[语音]')
          log_message.push(`<语音:${i.data?.url || i.data.file}>`)
          ToString.push(`{record:${i.data.file}}`)
          break
        /** 视频 */
        case 'video':
          message.push({ type: 'video', ...i.data })
          raw_message.push('[视频]')
          log_message.push(`<视频:${i.data?.url || i.data.file}>`)
          ToString.push(`{video:${i.data.file}}`)
          break
        /** 文件 */
        case 'file':
          file = { ...i.data, fid: i.data.id }
          log_message.push(`<文件:${i.data.file_id}>`)
          message.push({ type: 'file', ...i.data, text: i.data.file, fid: i.data.file_id })
          log_message.push(`<文件:${i.data?.url || i.data.file}>`)
          ToString.push(`{file:${i.data.id}}`)

          break
        /** 转发 */
        case 'forward':
          message.push({ type: 'node', ...i.data })
          raw_message.push('[转发消息]')
          log_message.push(`<转发消息:${JSON.stringify(i.data)}>`)
          ToString.push(`{forward:${i.data.id}}`)
          break
        /** JSON 消息 */
        case 'json':
          //i.data.data = i.data.data.replaceAll("\\", "")
          message.push({ type: 'json', ...i.data})
          raw_message.push('[json消息]')
          log_message.push(`<json消息:${i.data.data.replaceAll("\\", "")}>`)
          ToString.push(i.data.data.replaceAll("\\", "")) 
          break
        /** XML消息 */
        case 'xml':
          message.push({ type: 'xml', ...i.data })
          raw_message.push('[xml消息]')
          log_message.push(`<xml消息:${i.data}>`)
          ToString.push(i.data.data)
          break
        /** 篮球 */
        case 'basketball':
          message.push({ type: 'basketball', ...i.data })
          raw_message.push('[篮球]')
          log_message.push(`<篮球:${i.data.id}>`)
          ToString.push(`{basketball:${i.data.id}}`)
          break
        /** 新猜拳 */
        case 'new_rps':
          message.push({ type: 'new_rps', ...i.data })
          raw_message.push('[猜拳]')
          log_message.push(`<猜拳:${i.data.id}>`)
          ToString.push(`{new_rps:${i.data.id}}`)
          break
        /** 新骰子 */
        case 'new_dice':
          message.push({ type: 'new_dice', ...i.data })
          raw_message.push('[骰子]')
          log_message.push(`<骰子:${i.data.id}>`)
          ToString.push(`{new_dice:${i.data.id}}`)
          break
        /** 骰子 (NTQQ废弃) */
        case 'dice':
          message.push({ type: 'dice', ...i.data })
          raw_message.push('[骰子]')
          log_message.push(`<骰子:${i.data.id}>`)
          ToString.push(`{dice:${i.data}}`)
          break
        /** 剪刀石头布 (NTQQ废弃) */
        case 'rps':
          message.push({ type: 'rps', ...i.data })
          raw_message.push('[剪刀石头布]')
          log_message.push(`<剪刀石头布:${i.data.id}>`)
          ToString.push(`{rps:${i.data}}`)
          break
        /** 戳一戳 */
        case 'poke':
          message.push({ type: 'poke', ...i.data })
          raw_message.push(`[${pokeMap[Number(i.data.id)]}]`)
          log_message.push(`<${pokeMap[Number(i.data.id)]}>`)
          ToString.push(`{poke:${i.data.id}}`)
          break
        /** 戳一戳(双击头像) */
        case 'touch':
          message.push({ type: 'touch', ...i.data })
          raw_message.push('[双击头像]')
          log_message.push(`<<双击头像:${i.data.id}>`)
          ToString.push(`{touch:${i.data.id}}`)
          break
        /** 音乐 */
        case 'music':
          message.push({ type: 'music', ...i.data })
          raw_message.push('[音乐]')
          log_message.push(`<音乐:${i.data.id}>`)
          ToString.push(`{music:${i.data.id}}`)
          break
        /** 音乐(自定义) */
        case 'custom':
          message.push({ type: 'custom', ...i.data })
          raw_message.push('[自定义音乐]')
          log_message.push(`<自定义音乐:${i.data.url}>`)
          ToString.push(`{custom:${i.data.url}}`)
          break
        /** 天气 */
        case 'weather':
          message.push({ type: 'weather', ...i.data })
          raw_message.push('[天气]')
          log_message.push(`<天气:${i.data.city}>`)
          ToString.push(`{weather:${i.data.city}}`)
          break
        /** 位置 */
        case 'location':
          message.push({ type: 'location', ...i.data })
          raw_message.push('[位置分享]')
          log_message.push(`<位置分享:${i.data.lat}-${i.data.lon}>`)
          ToString.push(`{location:${i.data.lat}-${i.data.lon}}`)
          break
        /** 链接分享 */
        case 'share':
          message.push({ type: 'share', ...i.data })
          raw_message.push('[链接分享]')
          log_message.push(`<<链接分享:${i.data.url}>`)
          ToString.push(`{share:${i.data.url}}`)
          break
        /** 礼物 */
        case 'gift':
          message.push({ type: 'gift', ...i.data })
          raw_message.push('[礼物]')
          log_message.push(`<礼物:${i.data.id}>`)
          ToString.push(`{gift:${i.data.id}}`)
          break
        default:
          message.push({ type: 'text', ...i.data })
          i = JSON.stringify(i)
          raw_message.push(i)
          log_message.push(i)
          ToString.push(i)
          break
      }
    }

    ToString = ToString.join('').trim()
    raw_message = raw_message.join('').trim()
    log_message = log_message.join(' ').trim()
    return { message, ToString, raw_message, log_message, source, file }
  }

  /**
   * 获取被引用的消息
   * @param {object} i
   * @param {number} group_id
   * @return {array|false} -
   */
  async source (i, group_id) {
    /** 引用消息的id */
    const msg_id = i.data.id
    /** id不存在滚犊子... */
    if (!msg_id) return false
    let source
    try {
      let retryCount = 0

      while (retryCount < 2) {
        source = await api.get_msg(this.id, msg_id)
        if (typeof source === 'string') {
          common.error(this.id, `获取引用消息内容失败，正在重试：第 ${retryCount} 次`)
          retryCount++
        } else {
          break
        }
      }

      if (typeof source === 'string') {
        common.error(this.id, '获取引用消息内容失败，重试次数上限，已终止')
        return false
      }
      common.debug('', source)

      let { message, raw_message } = await this.getMessage(source.message, group_id, false)

      source = {
        ...source,
        time: source.message_id,
        seq: source.message_id,
        user_id: source.sender.user_id,
        message: message,
        raw_message
      }

      return source
    } catch (error) {
      logger.error(error)
      return false
    }
  }

  /**
 * 回被动消息
 * @param {object} e - 接收的e - 喵崽格式
 * @param {number} group_id
 * @param {number} user_id
 * @param {string|object|array} msg - 消息内容
 * @param {boolean} quote - 是否引用回复
 */
  async sendReplyMsg (e, group_id, user_id, msg, quote) {
    let { message, raw_message, node } = await this.getOneBotV11(msg)

    if (quote) {
      message.unshift({ type: 'reply', data: { id: String(e.message_id) } })
      raw_message = '[回复]' + raw_message
    }

    if (group_id) return await api.send_group_msg(this.id, group_id, message, raw_message, node)
    return await api.send_private_msg(this.id, user_id, message, raw_message, node)
  }

  /**
   * 发送好友消息 - 主动消息
   * @param {number} user_id - 好友QQ
   * @param {string|object|array} msg - 消息内容
   */
  async sendFriendMsg (user_id, msg) {
    const { message, raw_message, node } = await this.getOneBotV11(msg)
    return await api.send_private_msg(this.id, user_id, message, raw_message, node)
  }

  /**
   * 发送群消息 - 主动消息
   * @param {number} group_id - 群聊QQ
   * @param {string|object|array} msg - 消息内容
   */
  async sendGroupMsg (group_id, msg) {
    const { message, raw_message, node } = await this.getOneBotV11(msg)
    return await api.send_group_msg(this.id, group_id, message, raw_message, node)
  }

  /**
   * 转换message为OneBotV11格式
   * @param {string|Array|object} data - 消息内容
   */
  async getOneBotV11 (data) {
    let node = data?.test || false
    /** 标准化消息内容 */
    data = common.array(data)
    /** 保存 OneBotV11标准 message */
    let message = []
    /** 打印的日志 */
    let raw_message = []

    /** chatgpt-plugin */
    if (data?.[0]?.type === 'xml') data = data?.[0].msg

    /** 转为OneBotV11标准 message */
    for (let i of data) {
      switch (i.type) {
        case 'at':
          message.push({ type: 'at', data: { qq: String(i.qq) } })
          raw_message.push(`<@${i.qq}>`)
          break
        case 'face':
          message.push({ type: 'face', data: { id: i.id + '' } })
          raw_message.push(`<${faceMap[Number(i.id)]}>`)
          break
        case 'text':
          if (i.text && typeof i.text !== 'number' && !i.text.trim()) break
          message.push({ type: 'text', data: { text: i.text } })
          raw_message.push(i.text)
          break
        case 'file':
          try {
            /** 笨比复读! */
            if (i?.url) i.file = i.url
            let file = await Bot.FormatFile(i.file)
            /** 转换buffer,但愿吧 */
            if (!/^http(s)?:\/\/|^file:\/\//.test(file)) {
              file = 'base64://' + await Bot.Base64(file)
              raw_message.push(`<文件:base64://...>`)
            } else {
              raw_message.push(`<文件:${file}>`)
            }
            message.push({ type: 'file', data: { file } })
          } catch (err) {
            common.error(this.id, '文件上传失败:', err)
            message.push({ type: 'text', data: { text: JSON.stringify(err) } })
            raw_message.push(JSON.stringify(err))
          }
          break
        case 'record':
          try {
            let file = await Bot.FormatFile(i.file)
            /** 转换buffer,但愿吧 */
            if (!/^http(s)?:\/\/|^file:\/\//.test(file)) {
              file = 'base64://' + await Bot.Base64(file)
              raw_message.push(`<语音:base64://...>`)
            } else {
              raw_message.push(`<语音:${file}>`)
            }
            message.push({ type: 'record', data: { file } })
          } catch (err) {
            common.error(this.id, '语音上传失败:', err)
            /** 都报错了还发啥？...我以前写的什么牛马 */
            // msg.push(await this.getFile(i, 'record'))
            message.push({ type: 'text', data: { text: JSON.stringify(err) } })
            raw_message.push(JSON.stringify(err))
          }
          break
        case 'video':
          try {
            /** 笨比复读! */
            if (i?.url) i.file = i.url
            let file = await Bot.FormatFile(i.file)
            /** 转换buffer,但愿吧 */
            if (!/^http(s)?:\/\/|^file:\/\//.test(file)) {
              file = 'base64://' + await Bot.Base64(file)
              raw_message.push(`<视频:base64://...>`)
            } else {
              raw_message.push(`<视频:${file}>`)
            }
            message.push({ type: 'video', data: { file } })
          } catch (err) {
            common.error(this.id, '视频上传失败:', err)
            message.push({ type: 'text', data: { text: JSON.stringify(err) } })
            raw_message.push(JSON.stringify(err))
          }
          break
        case 'image':
          try {
            /** 笨比复读! */
            if (i?.url) i.file = i.url
            let file = await Bot.FormatFile(i.file)
            /** 转换buffer,但愿吧 */
            if (!/^http(s)?:\/\/|^file:\/\//.test(file)) {
              file = 'base64://' + await Bot.Base64(file)
              raw_message.push('<图片:base64://...>')
            } else {
              raw_message.push(`<图片:${file}>`)
            }
            message.push({ type: 'image', data: { file } })
          } catch (err) {
            message.push({ type: 'text', data: { text: JSON.stringify(err) } })
            raw_message.push(JSON.stringify(err))
          }
          break
        case 'poke':
          message.push({ type: 'poke', data: { type: i.id, id: 0, strength: i?.strength || 0 } })
          raw_message.push(`<${pokeMap[Number(i.id)]}>` || `<戳一戳:${i.id}>`)
          break
        case 'touch':
          message.push({ type: 'touch', data: { id: i.id } })
          raw_message.push(`<拍一拍:${i.id}>`)
          break
        case 'weather':
          message.push({ type: 'weather', data: { code: i.code, city: i.city } })
          raw_message.push(`<天气:${i?.city || i?.code}>`)
          break
        case 'json':
          try {
            let json = i.data
            if (typeof i.data !== 'string') json = JSON.stringify(i.data)
            message.push({ type: 'json', data: { data: json } })
            raw_message.push(`<json:${json}>`)
          } catch (err) {
            message.push({ type: 'text', data: { text: JSON.stringify(err) } })
            raw_message.push(JSON.stringify(err))
          }
          break
        case 'music': {
		  const data = i.data
		
		  // 1. QQ / 163 官方音乐卡片
		  if (['qq', '163'].includes(data.type)) {
		    message.push({
		      type: 'music',
		      data: {
		        type: data.type,
		        id: data.id
		      }
		    })
		
		    raw_message.push(`<音乐:${data.type},id:${data.id}>`)
		    break
		  }
		
		  // 2. 自定义音乐卡片 custom
		  if (data.type === 'custom') {
		    message.push({
		      type: 'music',
		      data: {
		        type: 'custom',
		        url: data.url,
		        audio: data.audio,
		        title: data.title ?? '',
		        image: data.image ?? ''
		      }
		    })
		
		    raw_message.push(
		      `<音乐:custom,url:${data.url},audio:${data.audio},title:${data.title ?? ''}>`
		    )
		    break
		  }
		
		  // 3. 未知类型兜底
		  raw_message.push(`<音乐:unknown>`)
		  break
        }
        case 'location':
          try {
            const { lat, lng: lon } = data
            message.push({ type: 'location', data: { lat, lon } })
            raw_message.push(`<位置:纬度=${lat},经度=${lon}>`)
          } catch (err) {
            message.push({ type: 'text', data: { text: JSON.stringify(err) } })
            raw_message.push(JSON.stringify(err))
          }
          break
        case 'share':
          try {
            const { url, title, image, content } = data
            message.push({ type: 'share', data: { url, title, content, image } })
            raw_message.push(`<链接分享:${url},标题=${title},图片链接=${image},内容=${content}>`)
          } catch (err) {
            message.push({ type: 'text', data: { text: JSON.stringify(err) } })
            raw_message.push(JSON.stringify(err))
          }
          break
        case 'forward':
          message.push(i)
          raw_message.push(`<转发消息:${i.id}>`)
          break
        case 'node':
        default:
          // 为了兼容更多字段，不再进行序列化，风险是有可能未知字段导致OneBotV11
          message.push({ type: i.type, data: { ...i.data } })
          raw_message.push(`<${i.type}:${JSON.stringify(i.data)}>`)
          break
      }
    }

    raw_message = raw_message.join('')

    return { message, raw_message, node }
  }

  /**
  * 发送 WebSocket 请求
  * @param {string} action - 请求 API 端点
  * @param {string} params - 请求参数
  */
  async sendApi (action, params) {
    const echo = randomUUID()
    /** 序列化 */
    const log = JSON.stringify({ echo, action, params })

    common.debug(this.id, '[ws] send -> ' + log)
    this.bot.send(log)

    /** 等待响应 */
    for (let i = 0; i < 1200; i++) {
      const data = lain.echo[echo]
      if (data) {
        delete lain.echo[echo]
        if (data.status === 'ok') return data.data
        else common.error(this.id, data); throw data
      } else {
        await common.sleep(50)
      }
    }
    throw new Error({ status: 'error', message: '请求超时' })
  }
}

/** OneBotV11eWS is not defined的WebSocket服务器实例 */
const OneBotV11WS = new WebSocketServer({ noServer: true })

/** 连接 */
OneBotV11WS.on('connection', async (bot, request) => new OneBotV11(bot, request))

/** 捕获错误 */
OneBotV11WS.on('error', async error => logger.error(error))

export default OneBotV11WS

common.info('Lain-plugin', 'OneBotV11适配器加载完成')


/* 修改转发 */

if (cfg.bot.skip_login) 
Bot.makeForwardMsg = async (data) => {
  let one = new OneBotV11()
  return one.makeForwardMsg(data)
}

Bot.on('message', async (e) => {
  // 检查 e.message 是否包含 type 为 'file' 的对象
  if (e.bot?.sendUni) return false
  const fileMessage = e.message.find(item => item.type === 'file')
  if (fileMessage) {
      // 如果存在文件类型的消息，则进行处理
      e.file = fileMessage;
      e.file.name = e.file.file;
  }
})







