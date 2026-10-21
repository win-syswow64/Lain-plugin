import QQBotIdMap from '../model/qqbot-id-map.js'

/** 通过 ICQQ 兼容群对象测试禁言：在群内发送 #禁言测试 并 @ 一名成员。 */
export class qqbotMuteTest extends plugin {
  constructor () {
    super({
      name: 'QQBot 禁言测试',
      dsc: '获取被 @ 的群成员并默认禁言 60 秒',
      event: 'message',
      priority: 200,
      rule: [{
        reg: /^#(?:qqbot)?禁言测试(?:\s+\d+(?:秒|s)?)?$/i,
        fnc: 'run',
        permission: 'master'
      }]
    })
  }

  async run (e) {
    if (e.message_type === 'private' || e.isPrivate || !(e.group_openid || e.group_id)) {
      return await e.reply('请在群聊中使用此测试命令。')
    }

    const target = this.getMentionedMember(e)
    if (!target) return await e.reply('请 @ 一名群成员，例如：#禁言测试 @某人')

    try {
      const duration = this.getDuration(e)
      const bot = e.bot || globalThis.Bot?.[e.self_id]
      const group = typeof e.group?.muteMember === 'function'
        ? e.group
        : bot?.pickGroup?.(e.group_id || e.group_openid)
      if (typeof group?.muteMember !== 'function') throw new Error('当前适配器未提供群 muteMember 接口')
      const result = await group.muteMember(target, duration)
      const code = result?.retcode ?? result?.err_code ?? result?.code
      if (result === false || result === null || result === '' || typeof result === 'string' ||
          result?.ok === false || result?.success === false || result?.status === 'failed' ||
          (code !== undefined && Number(code) !== 0)) {
        throw new Error(typeof result === 'string' ? result : result?.message || result?.msg || '适配器未成功执行禁言')
      }
      return await e.reply(duration === 0
        ? `禁言测试成功：已解除 ${target} 的禁言。`
        : `禁言测试成功：已将 ${target} 禁言 ${duration} 秒。`)
    } catch (error) {
      if (error.qqbot_user_notified) return true
      return await e.reply(`禁言测试失败：${error?.message || error}`)
    }
  }

  getDuration (e) {
    const text = String(e.msg || e.raw_message || '')
    const match = text.match(/^#(?:qqbot)?禁言测试(?:\s+(\d+)(?:秒|s)?)?$/i)
    const duration = Number(match?.[1] ?? 60)
    if (!Number.isInteger(duration) || duration < 0 || duration > 30 * 24 * 60 * 60) {
      throw new Error('禁言时长必须是 0～2592000 的整数秒数；0 表示解除禁言')
    }
    return duration
  }

  getMentionedMember (e) {
    const selfIds = new Set([
      e.self_id,
      e.qqbot_self_id,
      e.qqbot_appid,
      e.tiny_id,
      e.data?.self_id,
      e.bot?.uin,
      e.bot?.tiny_id,
      e.bot?.config?.appid
    ].map(id => this.cleanId(id)).filter(Boolean))

    const mentions = QQBotIdMap.getAtList(e, 'qqbot')
    const target = [...mentions, ...(e.at ? [{ id: e.at }] : [])].find(item => {
      const id = String(item?.id || '').trim()
      if (!id || /^(?:all|everyone)$/i.test(id)) return false
      return !selfIds.has(this.cleanId(id, selfIds))
    })
    return target?.id ? String(target.id).trim() : ''
  }

  cleanId (id, selfIds = new Set()) {
    let value = String(id || '').trim().replace(/^qg_/, '')
    for (const selfId of selfIds) {
      if (value.startsWith(`${selfId}-`)) value = value.slice(selfId.length + 1)
    }
    return value
  }
}
