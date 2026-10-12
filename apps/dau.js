import QQBotIdMap from '../model/qqbot-id-map.js'
import { readQQBotCount, readQQBotRecords } from '../model/qqbot-dau.js'

export class QQBotDAU extends plugin {
  constructor () {
    super({
      name: 'QQBot DAU',
      event: 'message',
      priority: 100,
      rule: [{ reg: /^#QQBotDAU(?:Pro)?(?:\s+\S+)?$/i, fnc: 'DAUStat' }]
    })
  }

  async DAUStat (event) {
    const e = event || this.e
    const match = String(e.msg || '').match(/^#QQBotDAU(Pro)?(?:\s+(\S+))?$/i)
    if (!match) return false
    const selfId = this.getBotId(e, match[2])
    if (match[1]) {
      // Only masters may inspect other groups' statistics.
      if (!e.isMaster) return await e.reply('暂无权限，QQBotDAUPro 仅允许机器人主人查询。')
      const records = await readQQBotRecords(match[2] ? selfId : '')
      if (!records.length) return await e.reply('暂无 QQBot 消息统计记录。')
      const lines = records.map(record => `${record.botId} / ${record.scope === 'total' ? '总计（30天窗口）' : record.scope === 'day' ? '日期 ' + record.target : '群 ' + record.target}：收 ${record.received}，发 ${record.sent}，图片 ${record.images}`)
      // Bound output size per reply, without silently discarding records.
      for (let index = 0; index < lines.length; index += 25) {
        await e.reply('QQBot 消息统计记录\n' + lines.slice(index, index + 25).join('\n'))
      }
      return true
    }
    if (!selfId) return await e.reply('未找到 QQBot 账号，请在 QQBot 群聊查询或指定 AppID。')
    if (e.message_type === 'private' || e.isPrivate || !e.group_id) {
      return await e.reply('请在群聊使用 #QQBotDAU；机器人主人可用 #QQBotDAUPro 查看全部统计。')
    }
    const mappedGroupId = QQBotIdMap.getEventGroupOpenid(e, selfId) ||
      QQBotIdMap.resolveGroupOpenid(selfId, /^\d+$/.test(String(e.group_id)) ? '' : e.group_id, e.group_id)
    const groupId = QQBotIdMap.stripSelfId(mappedGroupId, selfId)
    if (!groupId) return await e.reply('未找到当前群的 QQBot OpenID 绑定。')
    const counts = await readQQBotCount(selfId, groupId)
    return await e.reply(`QQBot ${selfId} / 当前群\n24小时统计窗口\n接收消息：${counts.received}\n发送消息：${counts.sent}\n发送图片：${counts.images}`)
  }

  getBotId (e, requested) {
    const id = String(requested || e.qqbot_self_id || e.qqbot_appid || e.bot?.config?.appid || '')
    QQBotIdMap.load()
    const bound = Object.keys(QQBotIdMap.data.bots || {}).find(appid => String(QQBotIdMap.getBoundBotQQ(appid)) === String(id || e.self_id))
    if (bound) return bound
    if (id) {
      return id
    }
    return e.bot?.adapter === 'QQBot' ? String(e.self_id) : ''
  }
}
