import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fetch from 'node-fetch'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { getQQBotAPIErrorCode } from './APIPolicy.js'

export const IMAGE_MATERIAL_LIMIT = 10 * 1024 * 1024
const MATERIAL_CACHE_LIMIT = 80
export const isMaterialURL = value => /^qqbot-media:\/\/image\/v1\/[^\s)]+$/.test(String(value || ''))
const formats = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** 只管理本适配器上传的素材，不删除其他插件或开发者创建的图片。 */
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
  }

  save () {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true })
      const temporary = `${this.cacheFile}.${process.pid}.tmp`
      fs.writeFileSync(temporary, JSON.stringify([...this.entries.values()]), { mode: 0o600 })
      fs.renameSync(temporary, this.cacheFile)
    } catch {
      globalThis.logger?.warn?.('[QQBot] 图片素材缓存保存失败，本次上传结果仍可使用')
    }
  }

  async upload (upload) {
    const buffer = upload.buffer
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length >= IMAGE_MATERIAL_LIMIT) return null
    const format = await fileTypeFromBuffer(buffer)
    const extension = formats[format?.mime]
    if (!extension) return null
    const metadata = await sharp(buffer).metadata()
    const md5 = crypto.createHash('md5').update(buffer).digest('hex')
    if (this.pending.has(md5)) return await this.pending.get(md5)
    const task = this.queue.then(async () => {
      const cached = this.entries.get(md5)
      if (cached?.expires_at > Date.now() + 60000) {
        cached.last_used_at = Date.now()
        return { ...cached, width: metadata.width, height: metadata.pageHeight || metadata.height }
      }
      if (cached) await this.remove(cached)
      // 最多缓存 80 张自有素材；兼容旧缓存超额的情况，按上传顺序释放配额。
      // 并发上传通过队列串行管理，复用已有图片不会触发删除。
      while (this.entries.size >= MATERIAL_CACHE_LIMIT) await this.evictOldest()
      const fileName = `${md5}.${extension}`
      const prepare = () => this.adapter.sdk.request.post('/v2/media-images/prepare', {
        file_name: fileName,
        file_size: buffer.length,
        content_type: format.mime,
        md5,
        sha1: crypto.createHash('sha1').update(buffer).digest('hex')
      })
      let prepared
      try { prepared = await prepare() } catch (error) {
        if (getQQBotAPIErrorCode(error) !== 40035007 || !this.entries.size) throw error
        await this.evictOldest()
        prepared = await prepare()
      }
      const { upload_id: uploadId, presigned_url: url } = prepared.data || {}
      if (!uploadId || !/^https?:\/\//.test(url || '')) throw new Error('QQBot 图片素材申请失败：缺少上传任务或预签名地址')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Number(this.adapter.config?.timeout) || 60000)
      let etag
      try {
        const response = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': format.mime },
          body: buffer,
          signal: controller.signal
        })
        if (!response.ok) throw new Error(`QQBot 图片素材上传失败：HTTP ${response.status}`)
        etag = String(response.headers.get('etag') || '').replace(/^W\//, '').replace(/^"|"$/g, '').toLowerCase()
        if (etag !== md5) throw new Error('QQBot 图片素材上传失败：ETag 与文件 MD5 不一致')
        await response.arrayBuffer()
      } finally { clearTimeout(timer) }
      const complete = () => this.adapter.sdk.request.post('/v2/media-images/complete', { upload_id: uploadId, md5: etag })
      let completed
      try { completed = await complete() } catch (error) {
        if (getQQBotAPIErrorCode(error) !== 40035007 || !this.entries.size) throw error
        await this.evictOldest()
        completed = await complete()
      }
      const { data } = completed
      if (!data?.image_id || !isMaterialURL(data.url)) throw new Error('QQBot 图片素材完成响应缺少有效的图片引用')
      const entry = {
        md5,
        image_id: data.image_id,
        url: data.url,
        file_name: fileName,
        ttl: Number(data.ttl) || 7776000,
        created_at: Date.now(),
        expires_at: Date.now() + (Number(data.ttl) || 7776000) * 1000,
        last_used_at: Date.now()
      }
      this.entries.set(md5, entry)
      if (data.preview_url) this.previews.set(data.url, { url: data.preview_url, expires: Date.now() + 60000 })
      this.save()
      return { ...entry, width: metadata.width, height: metadata.pageHeight || metadata.height }
    })
    this.pending.set(md5, task)
    this.queue = task.catch(() => {})
    try { return await task } finally { this.pending.delete(md5) }
  }

  async remove (entry) {
    try {
      await this.adapter.sdk.request.delete(`/v2/media-images/${encodeURIComponent(entry.image_id)}/delete`)
    } catch (error) {
      if (![40035008, 40035009].includes(getQQBotAPIErrorCode(error))) throw error
    }
    this.entries.delete(entry.md5)
    this.previews.delete(entry.url)
    this.save()
  }

  async evictOldest () {
    // Map 和磁盘缓存均按上传顺序保存；引用或命中缓存不会改变先后顺序。
    const oldest = this.entries.values().next().value
    if (oldest) await this.remove(oldest)
  }

  /** 只有消息实际成功引用后才更新 90 天滑动期限。 */
  touch (message) {
    const text = message.filter(item => item.type === 'markdown')
      .map(item => item.content || item.params?.flatMap(p => p.values || []).join('\n') || '').join('\n')
    let changed = false
    for (const entry of this.entries.values()) {
      if (!text.includes(entry.url)) continue
      entry.last_used_at = Date.now()
      entry.expires_at = Date.now() + entry.ttl * 1000
      changed = true
    }
    if (changed) this.save()
  }

  /** 仅在降级到普通媒体消息时读取临时预览链接，绝不持久化 preview_url。 */
  async downloadURL (url) {
    const cached = this.previews.get(url)
    if (cached?.expires > Date.now()) return cached.url
    let cursor = ''
    const cursors = new Set()
    do {
      if (cursors.has(cursor)) throw new Error('QQBot 图片素材列表返回了重复分页游标')
      cursors.add(cursor)
      const { data } = await this.adapter.sdk.request.get('/v2/media-images', { params: cursor ? { cursor } : {} })
      if (!Array.isArray(data?.images)) throw new Error('QQBot 图片素材列表响应无效')
      const image = data.images.find(item => item.url === url)
      if (image?.preview_url) {
        this.previews.set(url, { url: image.preview_url, expires: Date.now() + 60000 })
        return image.preview_url
      }
      cursor = data.next_cursor || ''
    } while (cursor)
    throw new Error('QQBot 图片素材不存在或已过期，请重新发送图片')
  }
}
