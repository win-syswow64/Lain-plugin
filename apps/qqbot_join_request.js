/** QQBot 群入群申请的手动查询与审批命令。 */
export class QQBotJoinRequest extends plugin {
  constructor () {
    super({
      name: 'QQBot入群申请管理',
      dsc: '查询并审批 QQBot 群入群申请',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: /^#(?:qqbot|qq群)(?:入群|加群)申请(?:列表)?(?:\s+.*)?$/i,
          fnc: 'list',
          permission: 'master'
        },
        {
          reg: /^#(?:qqbot|qq群)(?:审批|处理)(?:入群|加群)申请\s+.+$/i,
          fnc: 'approve',
          permission: 'master'
        }
      ]
    })
  }

  /** #QQBot入群申请列表 [limit] [cursor]；私聊时首参为群 OpenID。 */
  async list (e) {
    const bot = this.getQQBot(e)
    if (!bot) return await e.reply('该命令仅支持 QQBot 账号。', true)

    const args = this.getArgs(e, /^#(?:qqbot|qq群)(?:入群|加群)申请(?:列表)?/i)
    const target = this.getGroupTarget(e, args)
    if (!target) return await e.reply(this.listUsage(e), true)

    const [limitArg, cursorArg] = target.args
    const limit = limitArg === undefined ? 20 : Number(limitArg)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return await e.reply('单页数量必须是 1 至 100 的整数。', true)
    }

    try {
      const result = await bot.getGroupJoinRequests(target.groupId, {
        limit,
        cursor: cursorArg || undefined
      })
      return await e.reply(this.formatRequestList(result, target.groupId), true)
    } catch (error) {
      if (error.qqbot_user_notified) return true
      return await e.reply(`拉取入群申请失败：${error?.message || error}`, true)
    }
  }

  /**
   * 群内：#QQBot审批入群申请 <成员OpenID> <同意|拒绝> [申请ID] [理由]
   * 私聊：#QQBot审批入群申请 <群OpenID> <成员OpenID> <同意|拒绝> [申请ID] [理由]
   */
  async approve (e) {
    const bot = this.getQQBot(e)
    if (!bot) return await e.reply('该命令仅支持 QQBot 账号。', true)

    const args = this.getArgs(e, /^#(?:qqbot|qq群)(?:审批|处理)(?:入群|加群)申请/i)
    const target = this.getGroupTarget(e, args)
    if (!target || target.args.length < 2) return await e.reply(this.approveUsage(e), true)

    const [memberOpenid, action, requestId, ...reasonParts] = target.args
    const approve = /^(同意|通过|approve)$/i.test(action)
    const decline = /^(拒绝|驳回|decline)$/i.test(action)
    if (!approve && !decline) return await e.reply('审批动作只能是“同意”或“拒绝”。', true)

    let rejectReason = reasonParts.join(' ')
    let addToMemberBlacklist = false
    if (decline && /(?:^|\s)(?:--拉黑|拉黑)(?:\s|$)/.test(rejectReason)) {
      addToMemberBlacklist = true
      rejectReason = rejectReason.replace(/(?:^|\s)(?:--拉黑|拉黑)(?=\s|$)/g, ' ').trim()
    }

    try {
      await bot.approveGroupJoinRequest(target.groupId, memberOpenid, approve, {
        join_request_id: requestId || undefined,
        reject_reason: rejectReason || undefined,
        add_to_member_blacklist: addToMemberBlacklist
      })
    } catch (error) {
      if (error.qqbot_user_notified) return true
      return await e.reply(`审批入群申请失败：${error?.message || error}`, true)
    }

    const actionText = approve ? '已通过' : `已拒绝${addToMemberBlacklist ? '并加入群黑名单' : ''}`
    return await e.reply(`${actionText}成员 ${memberOpenid} 的入群申请。`, true)
  }

  getQQBot (e) {
    const bot = e.bot?.adapter === 'QQBot' ? e.bot : Bot[e.self_id]
    return (e.adapter === 'QQBot' || bot?.adapter === 'QQBot') &&
      typeof bot?.getGroupJoinRequests === 'function' &&
      typeof bot?.approveGroupJoinRequest === 'function'
      ? bot
      : undefined
  }

  getArgs (e, prefix) {
    return String(e.msg || e.raw_message || '')
      .replace(prefix, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  }

  /** 群聊优先使用当前群；私聊/其他场景要求首参显式传入群 OpenID。 */
  getGroupTarget (e, args) {
    const currentGroup = e.group_openid || e.group_id
    if (currentGroup) return { groupId: currentGroup, args }
    const [groupId, ...rest] = args
    return groupId ? { groupId, args: rest } : undefined
  }

  listUsage (e) {
    return e.group_id
      ? '用法：#QQBot入群申请列表 [单页数量] [cursor]'
      : '用法：#QQBot入群申请列表 <群OpenID> [单页数量] [cursor]'
  }

  approveUsage (e) {
    return e.group_id
      ? '用法：#QQBot审批入群申请 <成员OpenID> <同意|拒绝> [申请ID] [理由]\n拒绝时在理由中加入“--拉黑”可同时加入群黑名单。'
      : '用法：#QQBot审批入群申请 <群OpenID> <成员OpenID> <同意|拒绝> [申请ID] [理由]'
  }

  formatRequestList (result = {}, groupId) {
    const list = Array.isArray(result.list) ? result.list : []
    if (!list.length) return `群 ${groupId} 当前没有待审批的入群申请。`

    const rows = list.map((item, index) => {
      const verify = item.verify_info?.verify_message ||
        item.verify_info?.review_qa_list?.map(qa => `${qa.question || '问题'}：${qa.answer || ''}`).join('；') ||
        '无验证信息'
      const risk = item.risk_tips ? `\n安全提示：${item.risk_tips}` : ''
      return [
        `${index + 1}. ${item.username || '未知用户'} (${item.member_openid || ''})`,
        `申请ID：${item.join_request_id || ''}`,
        `申请时间：${item.apply_at || ''}`,
        `验证信息：${verify}${risk}`
      ].join('\n')
    })
    const nextCursor = result.next_cursor
    const next = nextCursor
      ? `\n\n下一页：#QQBot入群申请列表 ${list.length} ${nextCursor}`
      : '\n\n已到最后一页。'
    return `群 ${groupId} 的待审批入群申请（${list.length} 条）：\n\n${rows.join('\n\n')}${next}`
  }
}
