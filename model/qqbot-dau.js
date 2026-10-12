export const GROUP_TTL = 24 * 60 * 60
export const TOTAL_TTL = 30 * GROUP_TTL
const PREFIX = 'lain:qqbot:dau:v2:'

// All increments and TTL initialization are atomic. Existing TTLs are not extended.
const COUNT = `
local totalTTL = tonumber(ARGV[1])
local groupTTL = tonumber(ARGV[2])
local direction = ARGV[3]
local images = tonumber(ARGV[4])
local now = ARGV[5]
for i = 1, 2 do
  redis.call('HSETNX', KEYS[i], 'started_at', now)
  redis.call('HSET', KEYS[i], 'updated_at', now)
  redis.call('HINCRBY', KEYS[i], direction, 1)
  redis.call('HINCRBY', KEYS[i], 'images', images)
  if redis.call('TTL', KEYS[i]) < 0 then redis.call('EXPIRE', KEYS[i], totalTTL) end
end
if KEYS[3] ~= '' then
  redis.call('HSETNX', KEYS[3], 'started_at', now)
  redis.call('HSET', KEYS[3], 'updated_at', now)
  redis.call('HINCRBY', KEYS[3], direction, 1)
  redis.call('HINCRBY', KEYS[3], 'images', images)
  if redis.call('TTL', KEYS[3]) < 0 then redis.call('EXPIRE', KEYS[3], groupTTL) end
end
for i = 4, #KEYS, 3 do
  local ttl = math.max(1, redis.call('TTL', KEYS[1]))
  redis.call('SET', KEYS[i], redis.call('HGET', KEYS[1], 'sent') or '0', 'EX', ttl)
  redis.call('SET', KEYS[i + 1], redis.call('HGET', KEYS[1], 'received') or '0', 'EX', ttl)
  redis.call('SET', KEYS[i + 2], redis.call('HGET', KEYS[1], 'images') or '0', 'EX', ttl)
end
return redis.call('HGETALL', KEYS[1])
`

export function dauKey (botId, scope = 'total', target = '') {
  return `${PREFIX}${encodeURIComponent(String(botId))}:${scope}${target ? ':' + encodeURIComponent(String(target)) : ''}`
}

function dayString () {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
}

export async function recordQQBotCount ({ botId, aliases = [], groupId = '', direction, images = 0 }, client = globalThis.redis) {
  if (!['sent', 'received'].includes(direction)) throw new TypeError('未知统计方向')
  const keys = [dauKey(botId), dauKey(botId, 'day', dayString()), groupId ? dauKey(botId, 'group', groupId) : '']
  for (const id of new Set([String(botId), ...aliases.map(String)].filter(Boolean))) {
    keys.push(`Yz:count:send:msg:bot:${id}:total`, `Yz:count:receive:msg:bot:${id}:total`, `Yz:count:send:image:bot:${id}:total`)
  }
  await client.eval(COUNT, { keys, arguments: [String(TOTAL_TTL), String(GROUP_TTL), direction, String(images), String(Math.floor(Date.now() / 1000))] })
  const counters = await client.hGetAll(dauKey(botId))
  return normalizeCounters(counters)
}

export function normalizeCounters (value = {}) {
  return { received: Number(value.received || 0), sent: Number(value.sent || 0), images: Number(value.images || 0), started_at: Number(value.started_at || 0), updated_at: Number(value.updated_at || 0) }
}

export async function readQQBotCount (botId, groupId = '', client = globalThis.redis) {
  const key = dauKey(botId, groupId ? 'group' : 'total', groupId)
  return normalizeCounters(await client.hGetAll(key))
}

export async function readQQBotRecords (botId = '', client = globalThis.redis) {
  const records = []
  const match = botId ? `${PREFIX}${encodeURIComponent(String(botId))}:*` : `${PREFIX}*`
  for await (const batch of client.scanIterator({MATCH:match,COUNT:100})) {
    for (const key of Array.isArray(batch) ? batch : [batch]) {
      const value = await client.hGetAll(key)
      if (!Object.keys(value).length) continue
      const [id, scope, target = ''] = String(key).slice(PREFIX.length).split(':')
      records.push({botId:decodeURIComponent(id),scope,target:decodeURIComponent(target),...normalizeCounters(value)})
    }
  }
  return records.sort((a,b) => a.botId.localeCompare(b.botId) || a.scope.localeCompare(b.scope) || a.target.localeCompare(b.target))
}
