/** QQBot 官方 C2C stream_messages 会话。每次 update 传入完整内容快照。 */
export default class C2CStream {
  constructor ({ send, msgId, eventId, throttleMs = 500, logger = null, onClose = null }) {
    if (typeof send !== 'function') throw new TypeError('C2C stream 缺少发送函数')
    if (!msgId) throw new Error('C2C stream 需要入站消息 ID')

    this.send = send
    this.msgId = String(msgId)
    this.eventId = String(eventId || msgId)
    this.msgSeq = Math.floor(Math.random() * 0x10000)
    this.throttleMs = Math.max(300, Number(throttleMs) || 500)
    this.logger = logger
    this.pendingText = ''
    this.lastSentText = ''
    this.lastFlushAt = 0
    this.streamMsgId = ''
    this.index = 0
    this.timer = null
    this.flushPromise = null
    this.completed = false
    this.onClose = onClose
  }

  /** 用完整 Markdown 快照替换当前流内容；中间更新按间隔合并。 */
  async update (fullText) {
    if (this.completed) return
    this.pendingText = String(fullText ?? '')

    if (this.flushPromise) return
    const remaining = this.throttleMs - (Date.now() - this.lastFlushAt)
    if (remaining <= 0) return this.flush(1)
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        if (!this.completed) this.flush(1).catch(error => this.logError(error))
      }, remaining)
    }
  }

  /** 发送最后一帧并结束 C2C 流。可传入最终完整快照。 */
  async complete (fullText) {
    if (this.completed) return undefined
    if (fullText !== undefined) this.pendingText = String(fullText ?? '')
    this.completed = true
    clearTimeout(this.timer)
    this.timer = null

    try {
      if (this.flushPromise) await this.flushPromise
      return await this.flush(10)
    } finally { this.cleanup() }
  }

  /** 取消尚未发送的节流更新。已创建的 QQ 流需要 complete() 才能正常收尾。 */
  cancel () {
    this.completed = true
    clearTimeout(this.timer)
    this.timer = null
    if (this.flushPromise) this.flushPromise.then(() => this.cleanup(), () => this.cleanup())
    else this.cleanup()
  }

  cleanup () {
    const close = this.onClose
    this.onClose = null
    close?.()
  }

  async flush (inputState) {
    if (this.flushPromise) return this.flushPromise
    if (inputState !== 10 && this.pendingText === this.lastSentText) return undefined

    const payload = {
      input_mode: 'replace',
      input_state: inputState,
      content_type: 'markdown',
      content_raw: this.pendingText,
      event_id: this.eventId,
      msg_id: this.msgId,
      msg_seq: this.msgSeq,
      index: this.index
    }
    if (this.streamMsgId) payload.stream_msg_id = this.streamMsgId

    const request = this.sendWithRetry(payload).then(response => {
      const data = response?.data || response
      if (!this.streamMsgId && data?.id) this.streamMsgId = String(data.id)
      this.index++
      this.lastSentText = payload.content_raw
      this.lastFlushAt = Date.now()
      return data
    })
    this.flushPromise = request
    try {
      return await request
    } catch (error) {
      this.completed = true
      clearTimeout(this.timer)
      this.timer = null
      this.cleanup()
      throw error
    } finally {
      this.flushPromise = null
      if (!this.completed && this.pendingText !== this.lastSentText && !this.timer) {
        const remaining = Math.max(0, this.throttleMs - (Date.now() - this.lastFlushAt))
        this.timer = setTimeout(() => {
          this.timer = null
          if (!this.completed) this.flush(1).catch(error => this.logError(error))
        }, remaining)
      }
    }
  }

  logError (error) {
    this.logger?.debug?.(`[QQBot C2C stream] ${error?.message || error}`)
  }

  async sendWithRetry (payload) {
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        return await this.send(payload)
      } catch (error) {
        const message = String(error?.message || error)
        const status = Number(error?.response?.status)
        const code = Number(error?.response?.data?.code || error?.code || error?.err_code)
        const rateLimited = status === 429 || code === 50002 || /rate limit|code\(50002\)/i.test(message)
        if (!rateLimited || attempt === 3) throw error
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
        // A throttled index may already have reached the platform; advance it
        // before retrying, matching the official SDK's stream sequencer.
        payload.index = ++this.index
      }
    }
  }
}
