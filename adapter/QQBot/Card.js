import fetch from 'node-fetch'

const platforms = { qq: 'QQ音乐', '163': '网易云音乐', migu: '咪咕音乐', kugou: '酷狗音乐', kuwo: '酷我音乐' }
const aliases = { qqmusic: 'qq', netease: '163', neteasecloud: '163', kugo: 'kugou' }

function shareJSON (item) {
  if (item?.type !== 'json') return null
  try {
    const raw = item.data?.data ?? item.data
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!['com.tencent.structmsg', 'com.tencent.qzone.structmsg'].includes(value?.app)) return null
    return value.meta?.music || value.meta?.news || null
  } catch { return null }
}

export function isCardMessage (item) {
  return ['card', 'tuwen', 'share', 'music'].includes(item?.type) || !!shareJSON(item)
}

function stringField (value, name, max, compat) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`QQBot 图文卡片 ${name} 不能为空`)
  const chars = Array.from(value.trim())
  if (chars.length > max && !compat) throw new Error(`QQBot 图文卡片 ${name} 最多 ${max} 个字符`)
  return chars.slice(0, max).join('')
}

function httpsURL (value, name, compat) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`QQBot 图文卡片 ${name} 需要公网 HTTPS 链接`)
  let url
  try { url = new URL(value.trim()) } catch { throw new Error(`QQBot 图文卡片 ${name} 链接无效`) }
  if (compat && url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || !url.hostname) throw new Error(`QQBot 图文卡片 ${name} 必须使用 HTTPS 链接`)
  if (url.href.length > 1024) throw new Error(`QQBot 图文卡片 ${name} 链接最多 1024 个字符`)
  return url.href
}

/** 仅构造官方允许的四个字段；不转发 audio/musicUrl、媒体或应用配置。 */
export function normalizeCard (input, { compat = false } = {}) {
  const card = input?.card ?? input
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new TypeError('QQBot 图文卡片需要对象参数')
  if (card.type && card.type !== 'tuwen') throw new Error('QQBot 当前仅支持 type=tuwen 的图文卡片')
  const value = card.content && typeof card.content === 'object' ? card.content : card
  const title = value.title
  const description = compat
    ? value.description || value.summary || value.desc || value.singer || (typeof value.content === 'string' ? value.content : '') || title
    : value.description
  return {
    type: 'tuwen',
    content: {
      title: stringField(title, 'title', 50, compat),
      description: stringField(description, 'description', 200, compat),
      url: httpsURL(compat ? value.url || value.jumpUrl : value.url, 'url', compat),
      pic_url: httpsURL(compat ? value.pic_url || value.image || value.preview || value.pic : value.pic_url, 'pic_url', compat)
    }
  }
}

function fields (item) {
  const data = item?.data && typeof item.data === 'object' ? item.data : {}
  return { ...item, ...data }
}

/** 图文卡片与 ICQQ / OneBot 分享字段之间的转换，不获取音频或播放地址。 */
export default class QQBotCards {
  constructor (adapter) {
    this.adapter = adapter
    this.pending = new Map()
  }

  async prepare (item) {
    const data = fields(item)
    if (item?.type === 'music') {
      return await this.music(data.platform || (data.type !== 'music' ? data.type : 'qq'), data.id, data)
    }
    if (item?.type === 'share') {
      const { type, ...value } = data
      return normalizeCard(value, { compat: true })
    }
    if (item?.type === 'json') {
      const value = shareJSON(item)
      if (!value) throw new Error('QQBot 仅支持将音乐/网址分享 JSON 转为图文卡片')
      return normalizeCard(value, { compat: true })
    }
    if (item?.type === 'card') {
      const { type, data: nested, ...value } = item
      return normalizeCard(item.card ?? nested ?? (typeof item.content === 'object' ? { type: 'tuwen', content: item.content } : value))
    }
    if (item?.type === 'tuwen' && item.data) return normalizeCard({ type: 'tuwen', content: item.data })
    return normalizeCard(item)
  }

  async music (platform, id, details = {}) {
    if (platform && typeof platform === 'object') {
      details = fields(platform)
      id = details.id
      platform = details.platform || (details.type !== 'music' ? details.type : null) || 'custom'
    }
    if (id && typeof id === 'object') { details = fields(id); id = details.id }
    details = details && typeof details === 'object' ? details : {}
    platform = String(platform || 'custom').toLowerCase()
    platform = aliases[platform] || platform
    // 已有完整资料时不访问音乐站点，custom 也不要求 id 或音频链接。
    if (details.title && (details.url || details.jumpUrl) && (details.pic_url || details.image || details.preview || details.pic)) {
      return normalizeCard({
        title: details.title,
        description: details.description || details.summary || details.desc || details.singer || (typeof details.content === 'string' ? details.content : '') || platforms[platform] || '音乐分享',
        url: details.url || details.jumpUrl,
        pic_url: details.pic_url || details.image || details.preview || details.pic
      }, { compat: true })
    }
    if (!platforms[platform]) throw new Error('QQBot 音乐分享请提供完整的 title、url、image；或使用 qq/163/migu/kugou/kuwo 与歌曲 ID')
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('QQBot 音乐分享缺少歌曲 ID')
    id = String(id).trim()
    if (!id || id.length > 256) throw new Error('QQBot 音乐分享歌曲 ID 无效')
    const key = `${platform}:${id}`
    let task = this.pending.get(key)
    if (!task) {
      task = this.metadata(platform, id)
      this.pending.set(key, task)
    }
    let metadata
    try { metadata = await task } catch (cause) {
      throw new Error(`QQBot ${platforms[platform]}歌曲信息获取失败，请改用完整的自定义图文资料`, { cause })
    } finally { if (this.pending.get(key) === task) this.pending.delete(key) }
    const value = { ...metadata }
    // 只覆盖确实提供的字段，避免 undefined 清空查到的封面。
    const overrides = { title: details.title, description: details.description || details.summary || details.desc || details.singer || (typeof details.content === 'string' ? details.content : ''),
      url: details.url || details.jumpUrl, pic_url: details.pic_url || details.image || details.preview || details.pic }
    for (const [name, field] of Object.entries(overrides)) if (field != null && field !== '') value[name] = field
    return normalizeCard(value, { compat: true })
  }

  async json (url, headers) {
    const controller = new AbortController()
    const configured = Number(this.adapter.config?.timeout)
    const timer = setTimeout(() => controller.abort(), configured > 0 ? configured : 10000)
    try {
      const response = await fetch(url, { headers, signal: controller.signal })
      if (!response.ok) throw new Error(`音乐信息接口返回 HTTP ${response.status}`)
      return await response.json()
    } finally { clearTimeout(timer) }
  }

  /** 元数据请求参照已安装 ICQQ 的 musicFactory；省略它的音频/vkey 请求。 */
  async metadata (platform, id) {
    if (platform === 'qq') {
      const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg')
      url.searchParams.set('format', 'json')
      url.searchParams.set('data', JSON.stringify({ comm: { ct: 24, cv: 0 }, songinfo: {
        module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq',
        param: { song_type: 0, song_mid: /^\d+$/.test(id) ? '' : id, song_id: /^\d+$/.test(id) ? Number(id) : 0 }
      } }))
      const data = await this.json(url)
      const track = data.songinfo?.data?.track_info
      if (!track?.name) throw new Error('歌曲不存在或音乐站点未返回资料')
      const jump = new URL('https://i.y.qq.com/v8/playsong.html')
      jump.searchParams.set(track.mid ? 'songmid' : 'songid', track.mid || id)
      return { title: track.name, description: track.singer?.map(item => item.name).filter(Boolean).join(' / ') || platforms.qq,
        url: jump.href, pic_url: track.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${encodeURIComponent(track.album.mid)}.jpg` : undefined }
    }
    if (platform === '163') {
      const url = new URL('https://music.163.com/api/song/detail/')
      url.searchParams.set('id', id)
      url.searchParams.set('ids', JSON.stringify([id]))
      const data = await this.json(url)
      const track = data.songs?.[0]
      if (!track?.name) throw new Error('歌曲不存在或音乐站点未返回资料')
      return { title: track.name, description: (track.artists || track.ar || []).map(item => item.name).filter(Boolean).join(' / ') || platforms['163'],
        url: `https://y.music.163.com/m/song/${encodeURIComponent(id)}`, pic_url: (track.album || track.al)?.picUrl }
    }
    if (platform === 'kugou') {
      const url = new URL('https://wwwapi.kugou.com/yy/index.php')
      for (const [name, value] of Object.entries({ r: 'play/getdata', callback: '', hash: id, dfid: '', mid: id, platid: '4', _: String(Date.now()) })) url.searchParams.set(name, value)
      const data = (await this.json(url)).data
      if (!data?.audio_name) throw new Error('歌曲不存在或音乐站点未返回资料')
      return { title: data.audio_name, description: data.author_name || platforms.kugou,
        url: `https://www.kugou.com/song/#hash=${encodeURIComponent(id)}&album_id=${encodeURIComponent(data.album_id || '')}`, pic_url: data.img }
    }
    if (platform === 'kuwo') {
      const data = (await this.json(`https://yinyue.kuwo.cn/api/www/music/musicInfo?mid=${encodeURIComponent(id)}&httpsStatus=1`, { csrf: id, cookie: `kw_token=${encodeURIComponent(id)}` })).data
      if (!data?.name) throw new Error('歌曲不存在或音乐站点未返回资料')
      return { title: data.name, description: data.artist || platforms.kuwo,
        url: `https://yinyue.kuwo.cn/play_detail/${encodeURIComponent(id)}`, pic_url: data.pic }
    }
    const data = await this.json(`https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${encodeURIComponent(id)}&resourceType=2`)
    const track = data.resource?.[0]
    if (!track?.songName) throw new Error('歌曲不存在或音乐站点未返回资料')
    const [picture, share] = await Promise.all([
      this.json(`https://music.migu.cn/v3/api/music/audioPlayer/getSongPic?songId=${encodeURIComponent(track.songId)}`, { referer: 'https://music.migu.cn/v3/music/player/audio' }),
      this.json(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/shareInfo.do?contentId=${encodeURIComponent(track.contentId)}&contentName=${encodeURIComponent(track.songName)}&resourceType=2&targetUserName=${encodeURIComponent(track.singer || '')}`)
    ])
    return { title: track.songName, description: track.singer || platforms.migu,
      url: share.url, pic_url: picture.smallPic }
  }
}
