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
          reg: /^#?绑定qq群\d+$/i,
          fnc: 'bindGroupQQ'
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
      self_id: this.getQQBotSelfId(e),
      user_openid: openid,
      group_openid: this.getGroupOpenid(e),
      qq,
      group_qq: this.getGroupQQ(e) || '',
      nickname: e.sender?.card || e.sender?.nickname || e.author?.username || ''
    })
    if (!mapping?.saved) return await this.reply('绑定失败，映射配置保存失败')

    return await this.reply(`QQ（${mapping.qq}）绑定Openid（${QQBotIdMap.stripSelfId(mapping.user_openid)}）`)
  }

  async bindGroupQQ (e) {
    if (!this.isQQBot(e)) return false
    if (e.message_type !== 'group') return await this.reply('请在QQ群聊使用')

    const match = String(e.msg || e.raw_message || '').match(/^#?绑定qq群(\d+)$/i)
    const groupQQ = match?.[1]
    const selfId = this.getQQBotSelfId(e)
    const groupOpenid = this.getGroupOpenid(e)
    if (!selfId || !groupOpenid || !groupQQ) return await this.reply('绑定失败，缺少QQ群号或群Openid')

    const mapping = QQBotIdMap.bind({
      self_id: selfId,
      group_openid: groupOpenid,
      group_qq: groupQQ,
      group_name: e.group_name || e.group?.name || ''
    })
    if (!mapping?.saved) return await this.reply('绑定失败，映射配置保存失败')

    return await this.reply(`QQ群（${mapping.group_qq}）绑定Openid（${QQBotIdMap.stripSelfId(mapping.group_openid)}）`)
  }

  async toggleConvert (e) {
    if (!this.isQQBot(e)) return false
    if (e.message_type !== 'group') return await this.reply('请在QQ群聊使用')

    const enabled = /^#?开启转换$/i.test(String(e.msg || e.raw_message || '').trim())
    const groupOpenid = this.getGroupOpenid(e)
    if (!groupOpenid) return await this.reply('操作失败，缺少群Openid')

    const state = QQBotIdMap.setGroupEnabled({
      self_id: this.getQQBotSelfId(e),
      group_openid: groupOpenid,
      enabled,
      group_qq: this.getGroupQQ(e) || '',
      group_name: e.group_name || ''
    })
    if (!state?.saved) return await this.reply('操作失败，转换配置保存失败')

    return await this.reply(`${enabled ? '已开启' : '已关闭'}本群QQBot转换`)
  }

  isQQBot (e) {
    return e?.adapter === 'QQBot' || !!e?.qqbot_self_id || !!e?.qqbot_appid
  }

  getQQBotSelfId (e) {
    return e.qqbot_self_id || e.qqbot_appid || e.bot?.config?.appid || e.self_id
  }

  getUserOpenid (e) {
    return e.user_openid || e.member_openid || e.sender?.user_openid || e.sender?.member_openid || e.openid_user_id || e.qqbot_user_id || e.user_id
  }

  getGroupOpenid (e) {
    return e.group_openid || e.sender?.group_openid || e.openid_group_id || e.qqbot_group_id || e.group_id
  }

  getGroupQQ (e) {
    const value = QQBotIdMap.normalizeQQ(e.group_id)
    return value && !String(e.group_id).includes('-') ? value : ''
  }
}
