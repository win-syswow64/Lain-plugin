import crypto from 'node:crypto'
import MiaoCfg from '../../../lib/config/config.js'
import QQBotIdMap from '../model/qqbot-id-map.js'
import Button from '../adapter/QQBot/Button.js'

const TTL = 60 * 60 * 1000
const requests = new Map()
const requestKeys = new Map()
const notifications = new Map()

function isGroup (e) {
  return e.isPrivate !== true && e.message_type !== 'private' && !!(e.group_id || e.group_openid)
}

/** Keep the same context when the ICQQ layer replaces AppID/OpenID with QQ numbers. */
function scope (e) {
  const selfId = String(e.qqbot_self_id || e.qqbot_appid || e.bot?.config?.appid || e.self_id || '')
  const qqbot = e.adapter === 'QQBot' || e.bot?.adapter === 'QQBot' || !!e.qqbot_self_id
  const group = isGroup(e)
  let target = group ? e.group_openid || e.group_id : e.user_openid || e.user_id
  if (qqbot) {
    target = group
      ? QQBotIdMap.resolveGroupOpenid(selfId, e.group_openid, e.group_id) || target
      : e.user_openid || QQBotIdMap.findUserByQQ(selfId, e.user_id, { preferPrivate: true })?.user_openid || target
    target = String(target || '').replace(new RegExp(`^(?:qg_)?${selfId}-`), '')
  }
  return JSON.stringify([selfId, group ? 'group' : 'private', String(target || '')])
}

function messageIds (sent) {
  if ((typeof sent === 'string' && sent) || typeof sent === 'number') return [String(sent)]
  const values = Array.isArray(sent) ? sent.flatMap(messageIds)
    : [...(sent?.message_ids || []), sent?.message_id, sent?.id]
  return [...new Set(values.filter(id => typeof id === 'string' || typeof id === 'number').map(String))]
}

function forget (record) {
  clearTimeout(record.timer)
  requests.delete(record.token)
  if (requestKeys.get(record.key) === record.token) requestKeys.delete(record.key)
  for (const key of record.notices) notifications.delete(key)
}

function rememberNotice (record, sent, context) {
  const ids = messageIds(sent)
  for (const id of ids) {
    const key = `${scope(context)}:${id}`
    notifications.set(key, record)
    record.notices.add(key)
  }
  return ids.length > 0
}

function success (result) {
  const code = result?.retcode ?? result?.err_code ?? result?.code
  if (result === false || result === null || result === '' || typeof result === 'string' ||
      result?.ok === false || result?.success === false || result?.status === 'failed' ||
      (code !== undefined && Number(code) !== 0)) {
    throw new Error(typeof result === 'string' ? result : result?.message || result?.msg || '适配器未成功审批申请')
  }
}

async function notify (record, content, buttons) {
  const e = record.event
  let group = e.group
  try { if (!group && Number(e.group_id)) group = Bot.pickGroup?.(e.group_id) } catch {}
  if (typeof group?.sendMsg === 'function') {
    try {
      const sent = await group.sendMsg(buttons ? [...content, buttons] : content)
      if (rememberNotice(record, sent, e)) return true
      throw new Error('未返回通知消息 ID')
    } catch (error) {
      logger.warn(`[入群申请] 群通知失败，改为通知主人：${error.message || error}`)
    }
  }
  for (const userId of MiaoCfg.masterQQ || []) {
    try {
      const selfId = Number(userId)
        ? Bot.fl?.get?.(Number(userId))?.uin || Bot.uin
        : String(userId).split('-')[0]
      const bot = Bot[selfId]
      const friend = bot?.pickFriend?.(userId)
      if (typeof friend?.sendMsg !== 'function') continue
      // Group-admin buttons are only meaningful in the original group.
      const sent = await friend.sendMsg(content)
      if (rememberNotice(record, sent, { self_id: selfId, bot, user_id: userId, isPrivate: true })) return true
    } catch (error) {
      logger.warn(`[入群申请] 主人通知失败：${error.message || error}`)
    }
  }
  return false
}

/** 移植附件的通知功能；ICQQ、OneBot 和 QQBot 均使用请求事件提供的群对象。 */
export class LainGroupJoinNotice extends plugin {
  constructor () {
    super({ name: 'Lain入群申请通知', dsc: '群通知与主人私聊兜底', event: 'request.group.add', priority: -9999999999 })
  }

  async accept (event = this.e) {
    if (typeof event.approve !== 'function') return false
    const key = `${scope(event)}:${event.join_request_id || event.flag || `${event.user_id}:${event.time || ''}`}`
    if (requestKeys.has(key)) return false
    const record = { key, token: crypto.randomBytes(16).toString('hex'), event, notices: new Set(),
      expires: Date.now() + TTL, pending: false, done: false }
    requests.set(record.token, record)
    requestKeys.set(key, record.token)
    record.timer = setTimeout(() => forget(record), TTL)
    record.timer.unref?.()
    const verify = event.verify_info || event.raw?.verify_info || {}
    const reason = event.comment || event.tips || verify.verify_message ||
      verify.review_qa_list?.map(qa => `${qa.question || '问题'}：${qa.answer || ''}`).join('\n') || '无'
    const lines = ['[加群申请通知]', `群：${event.group_name || event.group_id || event.group_openid}`,
      `申请人：${event.nickname || event.nick || event.username || event.user_id || '未知'}`,
      `申请理由：${reason}`, '——————————', '管理员可引用本通知回复“同意”或“拒绝”。', '主人也可私聊引用通知审批；通知有效期 1 小时。']
    const content = []
    try {
      let avatar = await event.member?.getAvatarUrl?.(640)
      if (!avatar && Number(event.group_id)) {
        const group = event.group || Bot.pickGroup?.(event.group_id)
        avatar = await group?.pickMember?.(event.user_id)?.getAvatarUrl?.(640)
      }
      if (avatar) content.push(segment.image(avatar), '\n')
    } catch (error) { logger.warn(`[入群申请] 无法获取头像：${error.message || error}`) }
    content.push(lines.join('\n'))
    let buttons
    if (event.adapter === 'QQBot' || event.bot?.adapter === 'QQBot') {
      buttons = Button.create([[{ label: '同意', callback: `#同意入群 ${record.token}`, admin: true },
        { label: '拒绝', callback: `#拒绝入群 ${record.token}`, admin: true }]])
      for (const row of buttons.content.rows) for (const button of row.buttons) button._lainCallbackTTL = TTL
    }
    if (!await notify(record, content, buttons)) {
      // An unusable avatar must not prevent the actual notification from being delivered.
      if (content.length === 1 || !await notify(record, [lines.join('\n')], buttons)) {
        logger.error('[入群申请] 群和主人通知均失败')
        forget(record)
      }
    }
    return false
  }
}

export class LainGroupJoinApprove extends plugin {
  constructor () {
    super({ name: 'Lain入群申请审批', dsc: '引用审批和管理员回调按钮', event: 'message', priority: 1,
      rule: [{ reg: /^#?(同意|拒绝)(?:入群\s+[a-f0-9]{32})?\s*$/, fnc: 'approve' }] })
  }

  async approve (e = this.e) {
    const match = String(e.msg || e.raw_message || '').trim().match(/^#?(同意|拒绝)(?:入群\s+([a-f0-9]{32}))?$/)
    if (!match) return false
    let record
    if (match[2]) {
      record = requests.get(match[2])
      if (record && scope(e) !== scope(record.event)) return false
    } else {
      const reference = e.source || e.message?.find?.(item => item.type === 'reply')
      if (!reference) return false
      const ids = [reference.message_id, reference.id, reference.seq, reference.data?.id].filter(id => id != null)
      for (const id of ids) record ||= notifications.get(`${scope(e)}:${id}`)
      if (!record && ids.length) {
        const chat = isGroup(e) ? e.group : e.friend
        try {
          const history = await chat?.getChatHistory?.(ids[0], 1)
          for (const message of history || []) for (const id of messageIds(message)) record ||= notifications.get(`${scope(e)}:${id}`)
        } catch { /* Cache misses must not consume another plugin's quoted command. */ }
      }
      if (!record) return false
    }
    if (!record || record.expires <= Date.now()) {
      await e.reply('未找到对应入群申请，通知已过期或机器人已重启。')
      return true
    }
    const role = e.member?.role || e.member?.info?.role || e.member?._info?.role || e.sender?.role
    const admin = isGroup(e) && (e.member?.is_admin === true || e.member?.is_owner === true || ['admin', 'owner'].includes(role))
    // Only locally registered, administrator-only callbacks grant the button path.
    // An arbitrary callback or an ordinary message containing the token cannot grant access.
    const callbackAdmin = !!match[2] && isGroup(e) && e.qqbot_event_type === 'INTERACTION_CREATE' &&
      e.qqbot_callback_permission?.type === 1 &&
      e.qqbot_callback_message === String(e.msg || '').trim() &&
      String(e.qqbot_callback_group_openid || '') === String(record.event.group_openid || '').replace(/^qg_/, '')
    if (e.isMaster !== true && !admin && !callbackAdmin) {
      await e.reply(isGroup(e) ? '该操作仅限群主、管理员或机器人主人；QQBot 管理员请点击通知下方的审批按钮。' : '私聊审批仅允许机器人主人使用。')
      return true
    }
    if (record.done || record.pending) {
      await e.reply(record.done ? '该入群申请已处理，请勿重复审批。' : '该入群申请正在处理中，请稍候。')
      return true
    }
    record.pending = true
    try {
      success(await record.event.approve(match[1] === '同意'))
      record.done = true
    } catch (error) {
      if (!error.qqbot_user_notified) await e.reply(`审批失败：${error.message || error}`)
      return true
    } finally { record.pending = false }
    await e.reply(`已${match[1]}该用户的入群申请。`)
    return true
  }
}
