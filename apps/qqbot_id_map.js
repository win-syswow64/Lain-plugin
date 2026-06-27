import QQBotIdMap from '../model/qqbot-id-map.js'

export class qqbotIdMap extends plugin {
  constructor () {
    super({
      name: 'QQBot身份映射',
      dsc: 'QQBot Openid与QQ号映射',
      event: 'message',
      priority: -100,
      rule: [
        {
          reg: /^#?绑定qq\d+$/i,
          fnc: 'bindQQ'
        },
        {
          reg: /^#?(开启|关闭)转换$/i,
          fnc: 'toggleConvert'
        }
      ]
    })
  }

  async bindQQ (e) {
    if (!this.isQQBot(e)) return false

    const match = String(e.msg || e.raw_message || '').match(/^#?绑定qq(\d+)$/i)
    const qq = match?.[1]
    const openid = this.getUserOpenid(e)
    if (!qq || !openid) return await this.reply('绑定失败，缺少QQ或Openid')

    const mapping = QQBotIdMap.bind({
      self_id: e.self_id,
      user_openid: openid,
      group_openid: this.getGroupOpenid(e),
      qq,
      group_qq: QQBotIdMap.normalizeQQ(e.group_id) || '',
      nickname: e.sender?.card || e.sender?.nickname || e.author?.username || ''
    })

    return await this.reply(`QQ（${mapping.qq}）绑定Openid（${QQBotIdMap.stripSelfId(mapping.user_openid)}）`)
  }

  async toggleConvert (e) {
    if (!this.isQQBot(e)) return false
    if (e.message_type !== 'group') return await this.reply('请在QQ群聊使用')

    const enabled = /^#?开启转换$/i.test(String(e.msg || e.raw_message || '').trim())
    const groupOpenid = this.getGroupOpenid(e)
    if (!groupOpenid) return await this.reply('操作失败，缺少群Openid')

    QQBotIdMap.setGroupEnabled({
      self_id: e.self_id,
      group_openid: groupOpenid,
      enabled,
      group_qq: QQBotIdMap.normalizeQQ(e.group_id) || '',
      group_name: e.group_name || ''
    })

    return await this.reply(`${enabled ? '已开启' : '已关闭'}本群QQBot转换`)
  }

  isQQBot (e) {
    return e?.adapter === 'QQBot'
  }

  getUserOpenid (e) {
    return e.user_openid || e.member_openid || e.sender?.user_openid || e.sender?.member_openid || e.openid_user_id || e.qqbot_user_id || e.user_id
  }

  getGroupOpenid (e) {
    return e.group_openid || e.sender?.group_openid || e.openid_group_id || e.qqbot_group_id || e.group_id
  }
}
