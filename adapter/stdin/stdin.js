import fs from 'fs'
import { createInterface } from 'readline'
import common from '../../lib/common/common.js'
import Cfg from '../../lib/config/config.js'
const uin = 'stdin'
const pluginsLoader = (await import("../../../../lib/plugins/loader.js")).default
import _ from "lodash"
import { fileTypeFromBuffer } from 'file-type'
const path = process.cwd() + '/resources/stdin/imgs'

common.mkdirs(path)

export default async function stdin () {
  /** 自定义标准输入头像 */
  let avatar = process.cwd() + '/plugins/Lain-plugin/resources/stdin/default_avatar.jpg'
  if (fs.existsSync(process.cwd() + '/plugins/Lain-plugin/resources/stdin/avatar.jpg')) {
    avatar = process.cwd() + '/plugins/Lain-plugin/resources/stdin/avatar.jpg'
    }

  /** 构建基本参数 */
  Bot[uin] = {
    adapter: 'stdin',
    fl: new Map(),
    gl: new Map(),
    gml: new Map(),
    tl: new Map(),
    guilds: new Map(),
    id: uin,
    uin,
    name: Cfg.Stdin.name,
    nickname: Cfg.Stdin.name,
    avatar,
    stat: { start_time: Date.now() / 1000 },
    version: Bot.lain.adapter.stdin.version,
    /** 转发 */
    makeForwardMsg: async (forwardMsg) => await makeForwardMsg(forwardMsg),
    readMsg: async () => await common.recvMsg(uin, 'stdin', true),
    MsgTotal: async (type) => await common.MsgTotal(uin, 'stdin', type, true),
    pickUser: (userId) => {
      return {
        sendMsg: async (msg) => await sendMsg(msg),
        makeForwardMsg: async (forwardMsg) => await makeForwardMsg(forwardMsg)
      }
    }
  }

  Bot.adapter.unshift(uin)

  /** 监听控制台输入 */
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.on('SIGINT', () => { rl.close(); process.exit() })
  
  function getInput() {
    rl.question('', async (input) => {
        common.info(uin, `系统信息：${input}`)
        await pluginsLoader.deal(msg(input.trim()))
        getInput()
    })
}
getInput()
  rl.on('line', async (input) => await Bot.emit('message', msg(input.trim())))
  await common.init('Lain:restart:stdin')
}

async function makeBuffer(file) {
  if (Buffer.isBuffer(file)) return file
  if (file.match(/^base64:\/\//))
    return Buffer.from(file.replace(/^base64:\/\//, ''), 'base64')
  else if (file.match(/^https?:\/\//))
    return Buffer.from(await (await fetch(file)).arrayBuffer())
  else if (fs.existsSync(file))
    return Buffer.from(fs.readFileSync(file))
  return file
}

async function fileType(data) {
  const file = {}
  try {
    file.url = _.truncate(data, { length: 100 })
    file.buffer = await makeBuffer(data)
    file.type = await fileTypeFromBuffer(file.buffer)
    file.path = `${path}/${Date.now()}.${file.type.ext}`
  } catch (err) {
    common.error(uin, `文件类型检测错误：${logger.red(err)}`)
  }
  return file
}

function msg (msg) {
  const user_id = 55555
  const time = Date.now() / 1000

  let e = {
    adapter: 'stdin',
    message_id: 'test123456',
    message_type: 'private',
    post_type: 'message',
    sub_type: 'friend',
    self_id: uin,
    seq: 888,
    time,
    uin,
    user_id,
    message: [{ type: 'text', text: msg }],
    raw_message: msg,
    isMaster: true,
    toString: () => { return msg }
  }
  /** 用户个人信息 */
  e.sender = {
    card: Cfg.Stdin.name,
    nickname: Cfg.Stdin.name,
    role: '',
    user_id
  }

  /** 构建member */
  const member = {
    info: {
      user_id,
      nickname: Cfg.Stdin.name,
      last_sent_time: time
    },
    /** 获取头像 */
    getAvatarUrl: () => 'https://q1.qlogo.cn/g?b=qq&s=0&nk=528952540'
  }

  /** 赋值 */
  e.member = member

  /** 构建场景对应的方法 */
  e.friend = {
    sendMsg: async (reply) => {
      return await sendMsg(reply)
    },
    recallMsg: async (msg_id) => {
      return common.info(uin, `撤回消息：${msg_id}`)
    },
    makeForwardMsg: async (forwardMsg) => {
      return await makeForwardMsg(forwardMsg)
    }
  }

  /** 快速撤回 */
  e.recall = async () => {
    return common.info(uin, '撤回消息：123456')
  }
  /** 快速回复 */
  e.reply = async (reply) => {
    return await sendMsg(reply)
  }
  /** 保存消息次数 */
  try { common.recvMsg(e.self_id, e.adapter) } catch { }
  return e
}

async function makeForwardMsg (forwardMsg) {
  const msg = []
  try {
    for (const i of forwardMsg) {
      if (i?.message) {
        msg.push(i.message)
      } else {
        msg.push(JSON.stringify(i).slice(0, 2000))
      }
    }
    return msg
  } catch (error) {
    return forwardMsg
  }
}

/** 发送消息 */
async function sendMsg(msg) {
  if (!Array.isArray(msg)) msg = [msg]
  for (let i of msg) {
    if (typeof i != 'object')
      i = { type: 'text', data: { text: i } }
    else if (!i.data)
      i = { type: i.type, data: { ...i, type: undefined } }

    let file
    if (i.data.file)
      file = await fileType(i.data.file)

    switch (i.type) {
      case 'text':
        i.data.text = String(i.data.text).trim()
        if (!i.data.text) break
        if (i.data.text.match('\n'))
          i.data.text = `\n${i.data.text}`
        common.info(uin, `发送文本：${i.data.text}`)
        break
      case 'image':
        common.info(uin, `发送图片：${file.url}\n文件已保存到：${logger.cyan(file.path)}`)
        fs.writeFileSync(file.path, file.buffer)
        break
      case 'record':
        common.info(uin, `发送音频：${file.url}\n文件已保存到：${logger.cyan(file.path)}`)
        fs.writeFileSync(file.path, file.buffer)
        break
      case 'video':
        common.info(uin, `发送视频：${file.url}\n文件已保存到：${logger.cyan(file.path)}`)
        fs.writeFileSync(file.path, file.buffer)
        break
      case 'reply':
        break
      case 'at':
        break
      case 'node':
        sendForwardMsg(i.data)
        break
      default:
        if (!Array.isArray(i?.data) || Object.keys(i.data).length === 0) break
        i = JSON.stringify(i)
        if (i.match('\n')) i = `\n${i}`
        common.info(uin, `发送消息：${i}`)
    }
  }
  try { await common.MsgTotal(this.id, 'stdin') } catch { }
  return { message_id: 'test123456' }
}

async function sendFile(file, name = path.basename(file)) {
  const buffer = await makeBuffer(file)
  if (!Buffer.isBuffer(buffer)) {
    common.error(uin, `发送文件错误：找不到文件 ${logger.red(file)}`)
    return false
  }

  const files = `${path}/${Date.now()}-${name}`
  common.info(uin, `发送文件：${file}\n文件已保存到：${logger.cyan(files)}`)
  return fs.writeFileSync(files, buffer)
}

function sendForwardMsg(msg) {
  const messages = []
  for (const { message } of msg)
    messages.push(sendMsg(message))
  return { data: messages }
}

common.info('Lain-plugin', '标准输入适配器加载完成')
