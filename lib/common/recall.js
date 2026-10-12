/** 保留原生 ICQQ 引用的 seq/rand/time，而不是把 seq/time 强转为消息 ID。 */
export function getRecallReference (e) {
  const source = e.source
  if (source?.qqbot_ref_msg_idx &&
      String(source.message_id ?? source.id ?? source.seq ?? '') === String(source.qqbot_ref_msg_idx)) {
    throw new Error('QQBot 引用缓存未命中，无法取得真实消息 ID；请重新引用近期消息或使用 #测试撤回')
  }
  if (source && (hasId(source.message_id) || hasId(source.id) || hasId(source.seq))) return source
  const reply = e.message?.find?.(item => item?.type === 'reply')
  const id = reply?.id ?? reply?.data?.id
  return hasId(id) ? { message_id: id } : undefined
}

function hasId (id) {
  return (typeof id === 'string' && id.trim() !== '') || (typeof id === 'number' && Number.isFinite(id))
}

function checkResult (result) {
  if (Array.isArray(result)) {
    if (!result.length) throw new Error('适配器未返回撤回结果')
    for (const item of result) checkResult(item)
    return
  }
  if (result === false || result === null || result === '') throw new Error('适配器未成功撤回消息')
  if (typeof result === 'string') throw new Error(result)
  if (result && typeof result === 'object') {
    const code = result.retcode ?? result.code
    if (result.status === 'failed' || result.ok === false || result.success === false ||
        (code !== undefined && Number(code) !== 0)) {
      throw new Error(result.message || result.msg || result.error?.message || `适配器撤回失败（${code ?? result.status ?? '失败'}）`)
    }
  }
  // 部分适配器成功时只返回空响应（undefined），也属于正常结果。
}

/** 仅使用场景对象的 recallMsg，不能用 e.recall() 误撤回当前命令。 */
export async function recallMessage (e, reference) {
  const isGroup = e.message_type === 'private' || e.isPrivate === true
    ? false
    : e.isGroup === true || e.message_type === 'group' || (e.group_id !== undefined && e.group_id !== null)
  const bot = e.bot || globalThis.Bot?.[e.self_id]
  const candidates = isGroup
    ? [e.group, () => bot?.pickGroup?.(e.group_id)]
    : [e.friend, () => bot?.pickFriend?.(e.user_id), () => bot?.pickUser?.(e.user_id)]
  let target
  for (const candidate of candidates) {
    const value = typeof candidate === 'function' ? candidate() : candidate
    if (typeof value?.recallMsg === 'function') { target = value; break }
  }
  if (!target) throw new Error(`当前适配器未提供${isGroup ? '群聊' : '私聊'} recallMsg 接口`)

  const messages = Array.isArray(reference) ? reference : Array.isArray(reference?.message_ids) ? reference.message_ids : [reference]
  if (!messages.length) throw new Error('未取得可撤回的消息信息')
  let count = 0
  for (const message of messages) {
    const id = typeof message === 'object' && message !== null
      ? message.message_id ?? message.id
      : message
    let result
    if (hasId(id)) {
      result = await target.recallMsg(id)
    } else if (hasId(message?.seq)) {
      // ICQQ：群聊 recallMsg(seq, rand, pktnum)，私聊 recallMsg(seq, rand, time)。
      result = await target.recallMsg(message.seq, message.rand ?? 0,
        isGroup ? message.pktnum ?? 1 : message.time ?? 0)
    } else {
      throw new Error('未取得消息 ID 或 ICQQ 消息序列；不使用时间戳代替消息 ID')
    }
    checkResult(result)
    count++
  }
  return count
}
