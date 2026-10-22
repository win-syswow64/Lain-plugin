import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileTypeFromBuffer } from 'file-type'
import wasm from 'silk-wasm'

const run = promisify(execFile)

/** Keep the extension consistent with the uploaded bytes, including Buffer/base64 inputs. */
export async function prepareAudioUpload (upload, { silk = false, ffmpegPath = 'ffmpeg' } = {}) {
  if (!Buffer.isBuffer(upload?.buffer) || !upload.buffer.length) throw new Error('QQBot 语音上传失败：缺少音频数据')
  const alreadySilk = wasm.isSilk(upload.buffer)
  const detected = alreadySilk ? { ext: 'silk' } : await fileTypeFromBuffer(upload.buffer)
  const parsed = path.parse(upload.name || 'audio')
  const base = !parsed.name || parsed.name === 'file' ? 'audio' : parsed.name
  const format = upload.buffer.subarray(0, 4).toString('ascii') === 'OggS'
    ? 'ogg' : detected?.ext || parsed.ext.slice(1)
  const source = { ...upload, name: format ? `${base}.${format}` : base, audio_format: format }
  if (!silk || alreadySilk) return source

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lain-qqbot-audio-'))
  try {
    const input = path.join(directory, `input.${format || 'audio'}`)
    const pcm = path.join(directory, 'audio.pcm')
    await fs.writeFile(input, source.buffer)
    try {
      await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
        '-vn', '-f', 's16le', '-ar', '48000', '-ac', '1', pcm], { windowsHide: true, timeout: 120000 })
    } catch (error) {
      throw new Error(error.code === 'ENOENT'
        ? 'QQBot Silk 转码失败：未找到 FFmpeg，请安装 FFmpeg 或关闭 silk 配置'
        : 'QQBot Silk 转码失败：FFmpeg 无法解码该音频', { cause: error })
    }
    const encoded = await wasm.encode(await fs.readFile(pcm), 48000)
    const buffer = Buffer.from(encoded.data || encoded)
    if (!buffer.length || !wasm.isSilk(buffer)) throw new Error('QQBot Silk 转码失败：编码器未返回有效 Silk 数据')
    // A converted payload must not retain a URL pointing at the original MP3.
    const { url, ...local } = source
    return { ...local, buffer, name: `${base}.silk`, audio_format: 'silk' }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
