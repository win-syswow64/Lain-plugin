export const DIRECT_UPLOAD_LIMIT = 5 * 1024 * 1024
export const HARD_UPLOAD_LIMIT = 200 * 1024 * 1024
const SOFT_LIMITS = { 1: 20 * 1024 * 1024, 2: 30 * 1024 * 1024, 3: 20 * 1024 * 1024, 4: HARD_UPLOAD_LIMIT }

export function getUploadFileType (requested, size) {
  const type = Number(requested)
  if (!SOFT_LIMITS[type]) throw new Error('QQBot 上传失败：file_type 必须为 1、2、3 或 4')
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('QQBot 上传失败：文件大小无效')
  if (size > HARD_UPLOAD_LIMIT) throw new Error('QQBot 上传失败：文件超过 200MiB 硬限制')
  return size > SOFT_LIMITS[type] ? 4 : type
}

/** Read a URL once, enforce the hard limit even if Content-Length is missing or misleading. */
export async function downloadUploadFile (url, fetch, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`QQBot 下载上传文件失败：HTTP ${response.status}`)
    const declaredSize = Number(response.headers.get('content-length'))
    if (declaredSize > HARD_UPLOAD_LIMIT) {
      response.body?.destroy?.()
      throw new Error('QQBot 上传失败：文件超过 200MiB 硬限制')
    }
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > HARD_UPLOAD_LIMIT) {
        controller.abort()
        throw new Error('QQBot 上传失败：文件超过 200MiB 硬限制')
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks, size)
  } finally {
    clearTimeout(timer)
  }
}
