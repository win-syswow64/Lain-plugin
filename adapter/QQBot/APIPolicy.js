import { AsyncLocalStorage } from 'node:async_hooks'

const messageContext = new AsyncLocalStorage()

/** 官方标注仅白名单/内邀可用的接口（2026-10-21 核对 API v2 文档）。 */
export const restrictedAPIs = [
  ['GET', '/v2/groups/{group_openid}/info', '获取群基本信息'],
  ['GET', '/v2/groups/{group_openid}/bot_state', '获取机器人群内状态'],
  ['GET', '/v2/groups/{group_openid}/members', '获取群成员列表'],
  ['GET', '/v2/groups/{group_openid}/members/{member_openid}', '获取群成员信息'],
  ['POST', '/v2/groups/{group_openid}/batch_remove_members', '移除群成员'],
  ['GET', '/v2/groups/{group_openid}/member_blacklist', '查询群黑名单'],
  ['POST', '/v2/groups/{group_openid}/member_blacklist', '操作群黑名单']
].map(([method, path, name]) => ({
  method,
  path,
  name,
  pattern: new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '/?$')
}))

function getAPI (method, path) {
  const pathname = String(path || '').replace(/^https?:\/\/[^/]+/i, '').split('?')[0]
  return restrictedAPIs.find(api => api.method === String(method).toUpperCase() && api.pattern.test(pathname))
}

function getAPIName (method, pathname) {
  const material = pathname.match(/^\/v2\/media-images(?:\/(prepare|complete)|\/[^/]+\/delete)?\/?$/)
  if (material) return ({ prepare: '申请图片素材上传', complete: '完成图片素材上传' })[material[1]] ||
    (String(method).toUpperCase() === 'DELETE' ? '删除图片素材' : '查询图片素材')
  if (/\/restrict_chat_setting$/.test(pathname)) return String(method).toUpperCase() === 'GET' ? '查询群禁言' : '设置群禁言'
  return pathname
}

export function getQQBotAPIErrorCode (error) {
  const body = error?.response?.data || error?.qqbot_response?.data || {}
  return Number(body.err_code ?? body.code ?? error?.code ?? String(error?.message || '').match(/code\((\d+)\)/)?.[1])
}

/** 每条消息独立保存回复上下文，避免多个群并发请求时将错误发错群。 */
export function withQQBotAPIContext (event, callback) {
  return messageContext.run({ event, reported: new Map() }, callback)
}

export async function reportQQBotAPIError (error) {
  if (!error?.qqbot_whitelist_denied) return
  const context = messageContext.getStore()
  const key = error.qqbot_api_key || error.qqbot_api || error.message
  if (!context?.event?.reply) return
  if (!context.reported.has(key)) {
    const notification = (async () => {
      try {
        // 权限错误的回复自身不再触发自动回复，防止递归。
        const result = await messageContext.exit(() => context.event.reply(error.message))
        if (result === false) throw new Error('reply failed')
        return true
      } catch {
        globalThis.logger?.warn?.(`[QQBot] 接口权限提示发送失败：${error.qqbot_api_name}`)
        return false
      }
    })()
    context.reported.set(key, notification)
  }
  if (await context.reported.get(key)) error.qqbot_user_notified = true
}

function safeMessage (value) {
  return String(value ?? '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:access_token|token|secret|authorization)\s*[=:]\s*)[^\s&,;]+/gi, '$1[redacted]')
    .slice(0, 500)
}

/** 只保存错误码、文字和追踪 ID；不记录请求体、凭据或响应中的用户资料。 */
export function normalizeRestrictedAPIError (sdk, error, { method = 'GET', path = '' } = {}) {
  if (error?.qqbot_api_error) return error
  let api = getAPI(method, path)
  const code = getQQBotAPIErrorCode(error)
  if (!api && code !== 11253) return error
  if (!api) {
    const pathname = String(path || '').replace(/^https?:\/\/[^/]+/i, '').split('?')[0]
      .replace(/\/(groups|users|guilds|channels)\/[^/]+/g, '/$1/{id}')
    api = { method: String(method).toUpperCase(), path: pathname, name: getAPIName(method, pathname) }
  }
  const response = error?.response || error?.qqbot_response
  const body = response?.data || {}
  const message = safeMessage(body.message || body.msg || error?.message || error)
    .replace(String(path), api.path)
  const noAccess = code === 11253 || /(?:白名单|whitelist|应用无接口访问权限)/i.test(message)
  const wrapped = new Error(noAccess
    ? `当前机器人暂无${api.name}接口权限`
    : `QQBot 接口调用失败（${api.method} ${api.path}）：${message}`, { cause: error })
  wrapped.qqbot_api_error = true
  wrapped.qqbot_whitelist_denied = noAccess
  wrapped.qqbot_api = api.path
  wrapped.qqbot_api_key = `${api.method}:${api.path}`
  wrapped.qqbot_api_name = api.name
  if (Number.isFinite(code)) wrapped.code = code
  const sample = {
    appid: String(sdk?.config?.appid || ''),
    method: api.method,
    api: api.path,
    status: response?.status,
    code: Number.isFinite(code) ? code : undefined,
    message,
    trace_id: safeMessage(body.trace_id || response?.headers?.['x-tps-trace-id'] || '')
  }
  const key = `${api.method}:${api.path}:${sample.code ?? sample.status ?? message}`
  sdk.qqbotAPIFailureSamples ||= new Map()
  const previous = sdk.qqbotAPIFailureSamples.get(key) || 0
  // 同一机器人、接口与错误一分钟留样一次，避免每条群消息都输出相同错误。
  if (Date.now() - previous >= 60000) {
    sdk.qqbotAPIFailureSamples.set(key, Date.now())
    globalThis.logger?.warn?.(`[QQBot 白名单接口异常留样] ${JSON.stringify(sample)}`)
  }
  return wrapped
}

/**
 * 保护 SDK 中的白名单接口调用；普通接口保持原有异常行为。
 * 可选请求显式传 { qqbotOptional: true }，失败返回 data:null 与错误信息。
 * 默认视为功能必需接口，拒绝 Promise，让插件将错误回复给用户。
 */
export function installQQBotAPIPolicy (sdk) {
  const request = sdk?.request
  if (!request || request._lainAPIPolicy) return
  Object.defineProperty(request, '_lainAPIPolicy', { value: true })
  // qq-group-bot 的响应拦截器只读取 code，随后丢弃原始 response。
  // 在它执行前保留新版 err_code、HTTP 状态和 TraceID，不保存请求头或请求体。
  if (request.defaults?.transformResponse) {
    request.defaults.transformResponse = [...[].concat(request.defaults.transformResponse), (data, headers, status) => {
      const code = Number(data?.err_code ?? data?.code ?? 0)
      if (status >= 400 && code !== 0 && Number.isFinite(code)) {
        const error = new Error(`QQBot API error with code(${code}): ${safeMessage(data.message || data.msg || '')}`)
        error.code = code
        error.qqbot_response = { status, data: { code, message: data.message || data.msg, trace_id: data.trace_id },
          headers: { 'x-tps-trace-id': headers?.get?.('x-tps-trace-id') || headers?.['x-tps-trace-id'] } }
        throw error
      }
      return data
    }]
  }
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request']) {
    if (typeof request[method] !== 'function') continue
    const original = request[method].bind(request)
    request[method] = async (...args) => {
      const config = method === 'request' ? (typeof args[0] === 'string' ? { ...args[1], url: args[0] } : args[0]) :
        ['post', 'put', 'patch'].includes(method) ? args[2] : args[1]
      const path = method === 'request' ? config?.url : args[0]
      const verb = method === 'request' ? config?.method || 'GET' : method
      const restricted = getAPI(verb, path)
      try {
        const response = await original(...args)
        // 有的网关用 HTTP 200 携带业务错误；不能把它当作成功或空数据。
        const code = Number(response?.data?.err_code ?? response?.data?.code ?? 0)
        if (code !== 0) {
          throw Object.assign(new Error(response.data.message || response.data.msg || '接口返回异常响应'), { response })
        }
        return response
      } catch (error) {
        const wrapped = normalizeRestrictedAPIError(sdk, error, { method: verb, path })
        if (config?.qqbotOptional === true && (restricted || wrapped?.qqbot_whitelist_denied)) {
          return { data: null, qqbot_api_error: wrapped }
        }
        await reportQQBotAPIError(wrapped)
        throw wrapped
      }
    }
  }
}
