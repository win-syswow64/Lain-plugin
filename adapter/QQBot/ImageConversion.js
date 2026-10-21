import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import sharp from 'sharp'

const scopes = new AsyncLocalStorage()

export const createImageScope = () => ({ sources: new Map(), replacements: new Map(), failures: new Map() })
export const getImageScope = () => scopes.getStore()

export function clearImageScope (scope) {
  scope?.sources.clear()
  scope?.replacements.clear()
  scope?.failures.clear()
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

/** 纯内存转换；不生成临时文件，也不修改调用者的原文件。 */
export async function convertImageToWebP (upload, { force = false } = {}) {
  if (!Buffer.isBuffer(upload?.buffer) || !upload.buffer.length) throw new Error('QQBot 图片转换失败：缺少图片数据')
  if (!force && upload.image_format === 'webp') return upload
  let buffer = upload.buffer
  let metadata = await sharp(buffer, { animated: true }).metadata()
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
