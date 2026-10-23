function dimension (...values) {
  for (const value of values) {
    if (!['number', 'string'].includes(typeof value)) continue
    const number = Number(value)
    if (Number.isSafeInteger(number) && number > 0) return number
  }
}

/** ImageBed implementations return a URL string or differently shaped objects. */
export function normalizeImageHostResult (result, local = {}) {
  const candidates = [result, result?.url, result?.link, result?.data,
    result?.data?.url, result?.data?.link]
  let url
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    try {
      const parsed = new URL(candidate.trim())
      if (!['http:', 'https:'].includes(parsed.protocol)) continue
      url = parsed.href
      break
    } catch { /* Try the next supported response field. */ }
  }
  if (!url) throw new Error('图片图床未返回有效的 HTTP/HTTPS URL')
  const width = dimension(result?.width, result?.data?.width, local.width)
  const height = dimension(result?.height, result?.data?.height, local.height)
  if (!width || !height) throw new Error('图片图床返回的尺寸无效，且无法取得本地图片尺寸')
  return { url, width, height }
}
