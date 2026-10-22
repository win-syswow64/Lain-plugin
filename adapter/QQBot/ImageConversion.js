import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import sharp from 'sharp'

const scopes = new AsyncLocalStorage()

export const createImageScope = () => ({ sources: new Map(), replacements: new Map(), failures: new Map(), hosted: new Set(),
  images: new Map(), autoButtons: new Map() })
export const getImageScope = () => scopes.getStore()

export function clearImageScope (scope) {
  scope?.sources.clear()
  scope?.replacements.clear()
  scope?.failures.clear()
  scope?.hosted.clear()
  scope?.images.clear()
  scope?.autoButtons.clear()
}

/** 普通回复在 finally 释放临时图片；流式会话由完成/取消入口显式释放。 */
export async function withImageScope (callback, scope) {
  if (scope) return await scopes.run(scope, callback)
  if (scopes.getStore()) return await callback()
  const current = createImageScope()
  return await scopes.run(current, async () => {
    try { return await callback() } finally { clearImageScope(current) }
  })
}

// libvips may only expose the first APNG frame; read the animation control chunk too.
function pngFrames (buffer) {
  if (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return 1
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    if (offset + length + 12 > buffer.length) break
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'acTL' && length >= 8) return buffer.readUInt32BE(offset + 8)
    if (type === 'IDAT' || type === 'IEND') break
    offset += length + 12
  }
  return 1
}

/** 静态图片在内存转 WebP；多帧图片保留原始文件交给富媒体接口。 */
export async function convertImageToWebP (upload, { force = false } = {}) {
  if (!Buffer.isBuffer(upload?.buffer) || !upload.buffer.length) throw new Error('QQBot 图片转换失败：缺少图片数据')
  if (upload.image_animated || (!force && upload.image_format === 'webp')) return upload
  let buffer = upload.buffer
  let metadata = await sharp(buffer, { animated: true }).metadata()
  if (Number(metadata.pages) > 1 || pngFrames(buffer) > 1) {
    return { ...upload, name: !upload.name || upload.name === 'file' ? `image.${metadata.format}` : upload.name,
      image_format: metadata.format, image_animated: true,
      width: metadata.width, height: metadata.pageHeight || metadata.height }
  }
  if (force || metadata.format !== 'webp' || (metadata.orientation > 1 && !(metadata.pages > 1))) {
    const image = sharp(buffer, { animated: true })
    if (!(metadata.pages > 1)) image.rotate()
    buffer = await image.webp({ quality: 90, effort: 4 }).toBuffer()
    metadata = await sharp(buffer, { animated: true }).metadata()
  }
  const name = path.parse(upload.name || 'image').name || 'image'
  return { ...upload, buffer, name: `${name}.webp`, image_format: 'webp', content_type: 'image/webp',
    width: metadata.width, height: metadata.pageHeight || metadata.height }
}
