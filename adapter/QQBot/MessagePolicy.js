/** Per-account message mode, also accepts the reference plugin's string configuration. */
export function getMessagePolicy (config = {}) {
  const value = config.markdown ?? 'raw'
  const settings = value && typeof value === 'object' ? value : {}
  const selected = typeof value === 'string' ? value : settings.mode || 'raw'
  const mode = ['raw', 'legacy', 'template'].includes(selected) ? selected : 'template'
  const templateId = settings.templateId || settings.custom_template_id ||
    config.markdownTemplateId || (mode === 'template' && selected !== 'template' ? selected : '')
  const keys = settings.params || settings.keys || config.template || []
  return {
    mode,
    templateId: String(templateId),
    keys: Array.isArray(keys) ? keys.map(String) : String(keys).split(/[,，]/).filter(Boolean),
    small: settings.smallbtn ?? config.smallbtn ?? config.micro ?? false
  }
}

/** A setting can live on the extension, rule, returned keyboard, or button definition. */
export function getSmallSetting (value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined
  seen.add(value)
  for (const key of ['small', 'smallbtn', 'micro']) {
    if (typeof value[key] === 'boolean') return value[key]
  }
  if (['small', 'micro'].includes(value.type)) return true
  if (value.style?.font_size === 'small') return true
  const children = Array.isArray(value) ? value : ['data', 'buttons', 'button', 'content', 'rows'].map(key => value[key])
  let setting
  for (const child of children) {
    const flag = getSmallSetting(child, seen)
    if (flag === true) return true
    if (flag === false) setting = false
  }
  return setting
}

/** Small keyboards use exactly the same wire format as @windtrace/qq-group-bot. */
export function withMicroKeyboard (message, enabled) {
  return message.map(item => {
    if (item?.type !== 'keyboard') return item
    const { small, smallbtn, micro, ...keyboard } = item
    const style = { ...item.content?.style }
    if (enabled) style.font_size = 'small'
    else if (style.font_size === 'small') delete style.font_size
    const content = { ...item.content }
    if (Object.keys(style).length) content.style = style
    else delete content.style
    return { ...keyboard, content }
  })
}

function legacyMarkdown (content, isGroup) {
  const parts = []
  const pattern = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|<qqbot-at-user\s+id=["']([^"']+)["']\s*\/>|<qqbot-at-everyone\s*\/>/gi
  let offset = 0
  const text = value => {
    const plain = value.replace(/<qqbot-at-(?:user|everyone)\b[^>]*\/>/gi, '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
      .replace(/@\u200B/g, '@').replace(/<qqbot-\u200B/g, '<qqbot-')
    if (plain.trim()) parts.push({ type: 'text', text: plain })
  }
  for (const match of String(content).matchAll(pattern)) {
    text(String(content).slice(offset, match.index))
    if (match[1]) parts.push({ type: 'image', file: match[1] })
    else if (isGroup) parts.push({ type: 'at', user_id: match[2] || 'all' })
    offset = match.index + match[0].length
  }
  text(String(content).slice(offset))
  return parts
}

export function makeLegacyMessage (message, isGroup) {
  const result = []
  for (const item of message) {
    if (item.type === 'markdown') {
      result.push(...legacyMarkdown(item.content || item.params?.flatMap(p => p.values || []).join('\n') || '', isGroup))
    } else if (item.type === 'keyboard') {
      const hints = (item.content?.rows || []).flatMap(row => row.buttons || []).map(button =>
        `${button.render_data?.label || '按钮'}：${button.action?.data || ''}`)
      if (hints.length) result.push({ type: 'text', text: '\n' + hints.join('\n') })
    } else result.push(item)
  }
  return result.length ? result : [{ type: 'text', text: ' ' }]
}

export function makeTemplateMessage (message, policy) {
  if (!policy.templateId || !policy.keys.length) return null
  return message.map(item => {
    if (item.type !== 'markdown') return item
    const text = String(item.content ?? '')
    // Fill keys in order: the last key carries the remaining content, so nothing is discarded.
    const lines = text.split('\n')
    return {
      type: 'markdown',
      custom_template_id: policy.templateId,
      params: policy.keys.map((key, index) => ({ key, values: [
        index === policy.keys.length - 1 ? lines.slice(index).join('\n') || ' ' : lines[index] || ' '
      ] }))
    }
  })
}

/** Only retry a rejected piece, never a piece that was already sent successfully. */
export function getMessageVariants (message, policy, isGroup) {
  const raw = withMicroKeyboard(message, getSmallSetting(message) ?? policy.small)
  const legacy = makeLegacyMessage(message, isGroup)
  if (policy.mode === 'legacy') return [{ mode: 'legacy', message: legacy, attempts: 2 }]
  const template = makeTemplateMessage(raw, policy)
  if (policy.mode === 'template' && !template) throw new Error('模板模式需要 templateId 和至少一个参数名')
  const primary = policy.mode === 'template'
    ? { mode: 'template', message: template, attempts: 2 }
    : { mode: 'raw', message: raw, attempts: 2 }
  const fallback = policy.mode === 'template'
    ? { mode: 'raw', message: raw, attempts: 1 }
    : template ? { mode: 'template', message: template, attempts: 1 } : null
  // Media-only messages have no alternate Markdown representation.
  if (!message.some(item => item.type === 'markdown' || item.type === 'keyboard')) return [primary]
  return [primary, ...(fallback ? [fallback] : []), { mode: 'legacy', message: legacy, attempts: 1 }]
}
