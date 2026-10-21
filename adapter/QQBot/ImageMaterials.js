import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fetch from 'node-fetch'
import { getQQBotAPIErrorCode } from './APIPolicy.js'
import { convertImageToWebP, getImageScope } from './ImageConversion.js'

export const IMAGE_MATERIAL_LIMIT = 10 * 1024 * 1024
const MATERIAL_CACHE_LIMIT = 80
const MATERIAL_TTL = 90 * 24 * 60 * 60
const referencePattern = () => /qqbot-media:\/\/image\/v1\/[^\s)<>"']+/g
export const isMaterialURL = value => /^qqbot-media:\/\/image\/v1\/[^\s)]+$/.test(String(value || ''))
const reasons = {
  40035001: '图片格式不支持，WebP 文件名或 Content-Type 校验失败',
  40035002: '图片超过官方素材大小限制',
  40035003: '图片上传任务已失效或不属于当前机器人',
  40035006: '图片素材服务暂时异常，请稍后重试',
  40035007: '图片素材配额不足，无法释放更多自有素材',
  40035008: '图片素材不存在或已被删除',
  40035009: '图片素材已过期或已被删除',
  40035010: '图片引用无效或不属于当前机器人'
}
const sleep = () => new Promise(resolve => setTimeout(resolve, 300))

function materialError (error, detail) {
  const code = getQQBotAPIErrorCode(error)
  if (!reasons[code]) return error
  const wrapped = new Error(`QQBot ${detail || reasons[code]}（${code}）`, { cause: error })
  wrapped.code = code
  return wrapped
}

/** 磁盘只缓存素材索引；图片二进制仅在当前消息的临时作用域内保存。 */
export default class ImageMaterials {
  constructor (adapter) {
    this.adapter = adapter
    this.entries = new Map()
    this.pending = new Map()
    this.previews = new Map()
    this.queue = Promise.resolve()
    const directory = fileURLToPath(new URL('../../data/QQBot-materials/', import.meta.url))
    this.cacheFile = path.join(directory, `${String(adapter.id).replace(/[^\w-]/g, '_')}.json`)
    try {
      for (const entry of JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'))) {
        if (entry.md5 && entry.image_id && isMaterialURL(entry.url)) this.entries.set(entry.md5, entry)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') globalThis.logger?.warn?.('[QQBot] 图片素材缓存无法读取，将重新获取素材')
    }
    this.pruneExpired()
  }

  save () {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true })
      const temporary = `${this.cacheFile}.${process.pid}.tmp`
      try {
        fs.writeFileSync(temporary, JSON.stringify([...this.entries.values()]), { mode: 0o600 })
        fs.renameSync(temporary, this.cacheFile)
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      }
    } catch {
      globalThis.logger?.warn?.('[QQBot] 图片素材索引保存失败，本次上传结果仍可使用')
    }
  }

  key (url) { return `${this.adapter.id}:${url}` }
  find (url) { return [...this.entries.values()].find(entry => entry.url === url) }

  forget (entry) {
    if (!entry) return
    this.entries.delete(entry.md5)
    this.previews.delete(entry.url)
  }

  pruneExpired () {
    let changed = false
    for (const entry of this.entries.values()) {
      if (Number(entry.expires_at) > Date.now()) continue
      this.forget(entry)
      changed = true
    }
    for (const [url, preview] of this.previews) if (preview.expires <= Date.now()) this.previews.delete(url)
    if (changed) this.save()
  }

  remember (entry, upload) {
    getImageScope()?.sources.set(this.key(entry.url), upload)
    return { ...entry, width: upload.width, height: upload.height }
  }

  resolveURL (url) {
    const replacements = getImageScope()?.replacements
    const visited = new Set()
    while (replacements?.has(this.key(url)) && !visited.has(url)) {
      visited.add(url)
      url = replacements.get(this.key(url))
    }
    return url
  }

  source (url) { return getImageScope()?.sources.get(this.key(this.resolveURL(url))) }

  rewrite (message) {
    const replace = value => String(value).replace(referencePattern(), url => this.resolveURL(url))
    return message.map(item => {
      if (item.type === 'image' && isMaterialURL(item.file || item.url)) return { ...item, file: this.resolveURL(item.file || item.url) }
      if (item.type !== 'markdown') return item
      return { ...item,
        ...(this.references([item]).length ? { force_verify_image_resource: item.force_verify_image_resource ?? true } : {}),
        ...(typeof item.content === 'string' ? { content: replace(item.content) } : {}),
        ...(item.params ? { params: item.params.map(param => ({ ...param, values: (param.values || []).map(replace) })) } : {}) }
    })
  }

  references (message) {
    return [...new Set(message.flatMap(item => {
      const text = item.type === 'markdown' ? item.content || item.params?.flatMap(p => p.values || []).join('\n') || ''
        : item.type === 'image' ? item.file || item.url || '' : ''
      return String(text).match(referencePattern()) || []
    }))]
  }

  async request (callback) {
    try { return await callback() } catch (error) {
      if (getQQBotAPIErrorCode(error) !== 40035006) throw error
      await sleep()
      return await callback()
    }
  }

  async images () {
    const images = []
    let cursor = ''
    const cursors = new Set()
    do {
      if (cursors.has(cursor)) throw new Error('QQBot 图片素材列表返回了重复分页游标')
      cursors.add(cursor)
      const { data } = await this.request(() => this.adapter.sdk.request.get('/v2/media-images', { params: cursor ? { cursor } : {} }))
      if (!Array.isArray(data?.images)) throw new Error('QQBot 图片素材列表响应无效')
      images.push(...data.images)
      cursor = String(data.next_cursor || '')
    } while (cursor)
    return images
  }

  /** 配额错误时以官方有效列表校准；只管理本索引中已知的自有素材。 */
  async reconcile () {
    const valid = new Map((await this.images()).map(image => [image.image_id, image]))
    for (const entry of this.entries.values()) {
      const image = valid.get(entry.image_id)
      if (!image || Number(image.expires_at) * 1000 <= Date.now()) this.forget(entry)
      else if (Number.isFinite(Number(image.expires_at))) entry.expires_at = Number(image.expires_at) * 1000
    }
    this.save()
  }

  async withQuota (callback) {
    try { return await this.request(callback) } catch (error) {
      if (getQQBotAPIErrorCode(error) !== 40035007) throw error
      try { await this.reconcile() } catch (queryError) {
        if (getQQBotAPIErrorCode(queryError) === 11253 || queryError.qqbot_whitelist_denied) throw queryError
        this.pruneExpired()
      }
      await this.evictOldest()
      return await this.request(callback)
    }
  }

  async upload (source) {
    if (this.adapter.qqImageHostEnabled === false) return null
    const upload = await convertImageToWebP(source)
    if (upload.buffer.length >= IMAGE_MATERIAL_LIMIT) return null
    const md5 = crypto.createHash('md5').update(upload.buffer).digest('hex')
    const key = this.key(md5)
    const failed = getImageScope()?.failures.get(key)
    if (failed) throw failed
    if (this.pending.has(md5)) {
      const result = await this.pending.get(md5)
      if (result.disabled) return null
      return this.remember(result.entry, result.upload)
    }
    const task = this.queue.then(async () => {
      if (this.adapter.qqImageHostEnabled === false) return { disabled: true }
      this.pruneExpired()
      const cached = this.entries.get(md5)
      if (cached?.expires_at > Date.now() + 60000) return { entry: cached, upload }
      if (cached) await this.remove(cached)
      while (this.entries.size >= MATERIAL_CACHE_LIMIT) await this.evictOldest()
      return await this.uploadNew(upload)
    })
    this.pending.set(md5, task)
    this.queue = task.then(() => undefined, () => undefined)
    try {
      const result = await task
      if (result.disabled) return null
      return this.remember(result.entry, result.upload)
    } catch (error) {
      const wrapped = materialError(error)
      getImageScope()?.failures.set(key, wrapped)
      throw wrapped
    } finally { this.pending.delete(md5) }
  }

  async uploadNew (original) {
    let upload = original
    for (let attempt = 0; attempt < 2; attempt++) {
      const buffer = upload.buffer
      if (buffer.length >= IMAGE_MATERIAL_LIMIT) throw Object.assign(new Error(reasons[40035002]), { code: 40035002 })
      const md5 = crypto.createHash('md5').update(buffer).digest('hex')
      try {
        const { data: prepared } = await this.withQuota(() => this.adapter.sdk.request.post('/v2/media-images/prepare', {
          file_name: `${md5}.webp`, file_size: buffer.length, content_type: 'image/webp', md5,
          sha1: crypto.createHash('sha1').update(buffer).digest('hex')
        }))
        if (!prepared?.upload_id || !/^https?:\/\//.test(prepared.presigned_url || '')) throw new Error('QQBot 图片素材申请失败：缺少上传任务或预签名地址')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Number(this.adapter.config?.timeout) || 60000)
        let etag
        try {
          const response = await fetch(prepared.presigned_url, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: buffer, signal: controller.signal })
          await response.arrayBuffer()
          if (!response.ok) throw Object.assign(new Error(`QQBot 图片素材上传失败：HTTP ${response.status}`), { qqbot_material_restart: response.status === 403 })
          etag = String(response.headers.get('etag') || '').replace(/^W\//, '').replace(/^"|"$/g, '').toLowerCase()
          if (etag !== md5) throw Object.assign(new Error('QQBot 图片素材上传失败：ETag 与文件 MD5 不一致'), { qqbot_material_restart: true })
        } finally { clearTimeout(timer) }
        const { data } = await this.withQuota(() => this.adapter.sdk.request.post('/v2/media-images/complete', { upload_id: prepared.upload_id, md5: etag }))
        if (!data?.image_id || !isMaterialURL(data.url)) throw new Error('QQBot 图片素材完成响应缺少有效的图片引用')
        const ttl = Math.min(MATERIAL_TTL, Number(data.ttl) > 0 ? Number(data.ttl) : MATERIAL_TTL)
        const entry = { md5, image_id: data.image_id, url: data.url, file_name: `${md5}.webp`, ttl,
          created_at: Date.now(), expires_at: Date.now() + ttl * 1000, last_used_at: Date.now() }
        this.entries.set(md5, entry)
        if (data.preview_url) this.previews.set(data.url, { url: data.preview_url, expires: Date.now() + 60000 })
        this.save()
        return { entry, upload }
      } catch (error) {
        const code = getQQBotAPIErrorCode(error)
        if (attempt || ![40035001, 40035003].includes(code) && !error.qqbot_material_restart) throw error
        if (code === 40035001) upload = await convertImageToWebP(upload, { force: true })
      }
    }
  }

  async remove (entry) {
    try {
      await this.request(() => this.adapter.sdk.request.delete(`/v2/media-images/${encodeURIComponent(entry.image_id)}/delete`))
    } catch (error) {
      if (![40035008, 40035009, 40035010].includes(getQQBotAPIErrorCode(error))) throw materialError(error)
    }
    this.forget(entry)
    this.save()
  }

  async evictOldest () {
    this.pruneExpired()
    const oldest = this.entries.values().next().value
    if (oldest) await this.remove(oldest)
  }

  async repair (message, error) {
    if (this.adapter.qqImageHostEnabled === false) throw materialError(error, '官方图床已关闭，无法重建失效素材，请重新发送原图')
    const urls = this.references(message)
    const sources = urls.map(url => ({ url, upload: this.source(url), entry: this.find(url) }))
    const code = getQQBotAPIErrorCode(error)
    if (sources.some(source => !source.upload)) {
      for (const source of sources.filter(source => !source.upload)) {
        if (code === 40035001 && source.entry) await this.remove(source.entry)
        else this.forget(source.entry)
        this.previews.delete(source.url)
      }
      this.save()
      throw materialError(error, '图片素材已失效或不属于当前机器人，当前消息没有可恢复的原图，请重新发送原图')
    }
    for (const { url, entry } of sources) {
      // 单一引用的 08/09 已确认资源不存在；其他被重建的自有资源先删除，避免留下占额的孤立素材。
      if (entry && !(urls.length === 1 && [40035008, 40035009].includes(code))) await this.remove(entry)
      else this.forget(entry)
      this.previews.delete(url)
    }
    this.save()
    for (const { url, upload } of sources) {
      const next = await this.upload(getQQBotAPIErrorCode(error) === 40035001 ? await convertImageToWebP(upload, { force: true }) : upload)
      if (!next) throw materialError(error, 'WebP 图片超过素材大小限制，请重新发送原图')
      getImageScope()?.replacements.set(this.key(url), next.url)
    }
    return this.rewrite(message)
  }

  /** 只有被明确拒绝的素材引用才重新上传；不会重发已经成功的消息。 */
  async send (message, callback) {
    let current = this.rewrite(message)
    if (!this.references(current).length) return { response: await callback(current), message: current }
    let repaired = false
    let retried = false
    while (true) {
      try { return { response: await callback(current), message: current } } catch (error) {
        const code = getQQBotAPIErrorCode(error)
        if (code === 40035006 && !retried) { retried = true; await sleep(); continue }
        if ([40035001, 40035008, 40035009, 40035010].includes(code) && !repaired) {
          repaired = true
          try { current = await this.repair(current, error); continue } catch (repairError) {
            repairError.qqbot_material_final = true
            throw repairError
          }
        }
        if (reasons[code]) {
          if ([40035001, 40035002, 40035008, 40035009, 40035010].includes(code)) {
            const urls = this.references(current)
            for (const url of urls) {
              const entry = this.find(url)
              if (entry && !(urls.length === 1 && [40035008, 40035009].includes(code))) await this.remove(entry)
              else this.forget(entry)
            }
            this.save()
          }
          const wrapped = materialError(error)
          wrapped.qqbot_material_final = true
          throw wrapped
        }
        throw error
      }
    }
  }

  touch (message) {
    const referenced = new Set(this.references(this.rewrite(message)))
    let changed = false
    for (const entry of this.entries.values()) {
      if (!referenced.has(entry.url)) continue
      entry.last_used_at = Date.now()
      entry.expires_at = Date.now() + Math.min(MATERIAL_TTL, Number(entry.ttl) || MATERIAL_TTL) * 1000
      changed = true
    }
    if (changed) this.save()
  }

  async downloadURL (url) {
    url = this.resolveURL(url)
    const cached = this.previews.get(url)
    if (cached?.expires > Date.now()) return cached.url
    const image = (await this.images()).find(item => item.url === url)
    if (image?.preview_url && Number(image.expires_at) * 1000 > Date.now()) {
      this.previews.set(url, { url: image.preview_url, expires: Date.now() + 60000 })
      return image.preview_url
    }
    this.forget(this.find(url))
    this.save()
    throw Object.assign(new Error('QQBot 图片素材不存在或已过期，请重新发送原图'), { code: 40035009 })
  }
}
