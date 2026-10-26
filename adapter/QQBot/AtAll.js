import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { hasAllMention } from './Mentions.js'
import { getQQBotAPIErrorCode } from './APIPolicy.js'

const scope = new AsyncLocalStorage()
const DAY = 86400000
const LOCK_TTL = 90000
const ACQUIRE = `
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[3])
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`
const RENEW = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`
const RESERVE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return -1 end
local current = redis.call('GET', KEYS[2])
if current and current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
return 1
`
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
if ARGV[2] == '1' then
  for i = 2, #KEYS do
    if redis.call('GET', KEYS[i]) == ARGV[1] then redis.call('DEL', KEYS[i]) end
  end
end
return 1
`

function calendarDay () {
  const now = Date.now()
  const shifted = now + 8 * 3600000
  return { date: new Date(shifted).toISOString().slice(0, 10), ttl: Math.max(1, (Math.floor(shifted / DAY) + 1) * DAY - shifted) }
}

function failure (message, cause) {
  return Object.assign(new Error(message, { cause }), { qqbot_at_all_final: true })
}

const used = () => failure('QQBot @全体成员发送失败：本群今日额度已使用，每群每天只能发送 1 次，请在北京时间次日 00:00 后重试')

/** 预占每日额度，并用独立互斥锁保护跨午夜、并发发送和进程重启。 */
export async function withGroupAtAllLimit (botId, groupId, callback, client = globalThis.redis) {
  const token = randomUUID()
  const prefix = `lain:qqbot:at-all:${encodeURIComponent(String(botId))}:${encodeURIComponent(String(groupId))}`
  const lock = `${prefix}:sending`
  const day = calendarDay()
  const firstKey = `${prefix}:${day.date}`
  let acquired
  try {
    acquired = Number(await client.eval(ACQUIRE, { keys: [firstKey, lock], arguments: [token, String(day.ttl), String(LOCK_TTL)] }))
  } catch (cause) {
    throw failure('QQBot @全体成员本地冷却校验失败，请检查 Redis 后重试', cause)
  }
  if (acquired === 0) throw used()
  if (acquired !== 1) throw failure('QQBot @全体成员发送失败：本群有一条全体提醒正在发送，请稍后重试')

  const lease = {
    botId: String(botId), groupId: String(groupId), accepted: false, uncertain: false, lost: false,
    days: new Set([firstKey]),
    async reserveDay () {
      if (this.lost) throw failure('QQBot @全体成员本地发送锁已失效，已停止发送，请稍后重试')
      const current = calendarDay()
      const key = `${prefix}:${current.date}`
      try {
        const result = Number(await client.eval(RESERVE, { keys: [lock, key], arguments: [token, String(current.ttl)] }))
        if (result === 0) throw used()
        if (result !== 1) throw failure('QQBot @全体成员本地发送锁已失效，已停止发送，请稍后重试')
        this.days.add(key)
      } catch (cause) {
        if (cause.qqbot_at_all_final) throw cause
        throw failure('QQBot @全体成员本地冷却记录失败，请检查 Redis 后重试', cause)
      }
    }
  }
  const renewal = setInterval(() => {
    Promise.resolve().then(() => client.eval(RENEW, { keys: [lock], arguments: [token, String(LOCK_TTL)] }))
      .then(result => { if (Number(result) !== 1) lease.lost = true })
      .catch(() => { lease.lost = true })
  }, LOCK_TTL / 3)
  renewal.unref?.()
  try {
    return await scope.run(lease, callback)
  } finally {
    clearInterval(renewal)
    try {
      // 明确失败返还预占额度；成功、超时或无法确认的结果保留，避免重复提醒。
      await client.eval(RELEASE, { keys: [lock, ...lease.days], arguments: [token, !lease.accepted && !lease.uncertain ? '1' : '0'] })
    } catch {
      globalThis.logger?.warn?.('[QQBot] @全体成员冷却清理失败，暂时保留额度以避免重复发送')
    }
  }
}

/** 每次真正调用消息接口前检查；素材修复、格式降级共用同一份预占记录。 */
export async function sendWithAtAllLimit (botId, targetType, groupId, message, send) {
  if (targetType !== 'group' || !hasAllMention(message)) return await send()
  const lease = scope.getStore()
  if (!lease || lease.botId !== String(botId) || lease.groupId !== String(groupId)) {
    return await withGroupAtAllLimit(botId, groupId, () => sendWithAtAllLimit(botId, targetType, groupId, message, send))
  }
  if (lease.accepted || lease.uncertain) throw failure('QQBot @全体成员消息已发送或结果无法确认，已停止重复发送')
  await lease.reserveDay()
  let response
  try {
    response = await send()
  } catch (error) {
    const response = error.response || error.qqbot_response
    const code = getQQBotAPIErrorCode(error)
    const rejected = Number.isFinite(code) && code !== 0
    if (!rejected && (!response || Number(response.status) >= 500 || Number(response.status) === 408)) {
      lease.uncertain = true
      // 即使请求跨越午夜，也为结果不明的当前自然日保留额度。
      await lease.reserveDay()
      throw failure('QQBot @全体成员发送结果无法确认，为避免重复提醒，今日额度已保留，请检查群消息', error)
    }
    throw error
  }
  if (response?.id) lease.accepted = true
  else lease.uncertain = true
  await lease.reserveDay()
  if (!response?.id) throw failure('QQBot @全体成员发送未返回消息 ID，今日额度已保留，已停止重试')
  return response
}
