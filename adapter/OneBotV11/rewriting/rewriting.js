import md5 from "md5"
import fs from 'node:fs'
import _ from "lodash"
import lodash from 'lodash'
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import GachaLog from '../../../../genshin/model/gachaLog.js'

export default class rewriting {
    
    async logJson() {
        let uid = /([1-9]|18)[0-9]{8}/g.exec(this.e.file.name)[0]
        this.path = this.e.isSr ? path.resolve(`./data/srJson/${this.e.user_id}/`) : path.resolve(`./data/gachaJson/${this.e.user_id}/`)
        let textPath = path.join(this.path, this.e.file.name)
        /** 获取文件下载链接 */
        let fileUrl
        if (this.e.file.url) {
            fileUrl = this.e.file.url
        } else {
            if (this.e.bot?.adapter === 'OneBotv11') {
                const fileInfo = await (this.e.friend || this.e.group).getFileUrl(this.e.file.file_id)
                //logger.info("文件", fileInfo)
                if(fileInfo.file) fileUrl = fileInfo.file
            } else {
                fileUrl = await (this.e.friend || this.e.group).getFileUrl(this.e.file.fid)
            }
        }

        let ret = await download(fileUrl, textPath)
        if (!ret) {
            this.e.reply('下载json文件错误')
            return false
        }
        let json = {}
        try {
            json = JSON.parse(fs.readFileSync(textPath, 'utf8'))
        } catch (error) {
            this.e.reply(`${this.e.file.name},json格式错误`)
            return false
        }

        if (lodash.isEmpty(json) || !json.list) {
            this.e.reply('json文件内容错误：非统一祈愿记录标准')
            return false
        }

        if (json.info.srgf_version) {
            this.e.isSr = true
            this.game = 'sr'
        }

        let data = this.dealJson(json.list)
        if (!data) return false

        /** 保存json */
        let msg = []
        for (let type in data) {
            let typeName = this.typeName(this.game)
            if (!typeName[type]) continue
            let gachLog = new GachaLog(this.e)
            gachLog.uid = uid
            gachLog.type = type
            gachLog.writeJson(data[type])

            msg.push(`${typeName[type]}记录：${data[type].length}条`)
        }

        /** 删除文件 */
        fs.unlink(textPath, () => { })

        await this.e.reply(`${this.e.file.name}，${this.e.isSr ? '星铁' : '原神'}记录导入成功\n${msg.join('\n')}`)
    }
}

async function download(url, file, opts) {
    let buffer
    if (!file || (await fsStat(file))?.isDirectory?.()) {
        const type = await fileType(url, opts)
        file = file ? path.join(file, type.name) : type.name
        buffer = type.buffer
    } else {
        await mkdir(path.dirname(file))
        buffer = await Bufferfile(url, opts)
    }
    fs.writeFileSync(file, buffer)
    return { url, file, buffer }
}

async function fsStat(path) {
    if (fs.existsSync(path)) {
        return path
    } else {
        return false
    }
}

async function mkdir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true })
        return true
    } catch (err) {
        logger.error("创建", dir, "错误", err)
        return false
    }
}

async function fileType(data, opts = {}) {
    const file = { name: data.name }
    try {
        if (Buffer.isBuffer(data.file)) {
            file.url = data.name || "Buffer"
            file.buffer = data.file
        } else {
            file.url = data.file.replace(/^base64:\/\/.*/, "base64://...")
            file.buffer = await Bufferfile(data.file, opts)
        }
        if (Buffer.isBuffer(file.buffer)) {
            file.type = await fileTypeFromBuffer(file.buffer)
            file.md5 = md5(file.buffer)
            if (!file.name)
                file.name = `${Date.now()}.${file.md5.slice(0, 8)}.${file.type.ext}`
        }
    } catch (err) {
        logger.error("文件类型检测错误", file, err)
    }
    if (!file.name)
        file.name = `${Date.now()}-${path.basename(file.url)}`
    return file
}

async function Bufferfile(data, opts = {}) {
    if (Buffer.isBuffer(data)) return data
    data = await Stringdata(data)

    if (data.startsWith("base64://"))
        return Buffer.from(data.replace("base64://", ""), "base64")
    else if (data.match(/^https?:\/\//))
        return opts.http ? data : Buffer.from(await (await fetch(data, opts)).arrayBuffer())
    else if (await fsStat(data.replace(/^file:\/\//, "")))
        return opts.file ? data : Buffer.from(fs.readFileSync(data.replace(/^file:\/\//, "")))
    return data
}

async function getCircularReplacer() {
    const ancestors = []
    return async function (key, value) {
      switch (typeof value) {
        case "function":
          return String(value)
        case "object":
          if (value === null)
            return null
          if (value instanceof Map || value instanceof Set)
            return Array.from(value)
          if (value instanceof Error)
            return value.stack
          if (value.type == "Buffer" && Array.isArray(value.data)) try {
            return await StringOrBuffer(Buffer.from(value), true)
          } catch {}
          break
        default:
          return value
      }
      while (ancestors.length > 0 && ancestors.at(-1) !== this)
        ancestors.pop()
      if (ancestors.includes(value))
        return `[Circular ${await StringOrNull(value)}]`
      ancestors.push(value)
      return value
    }
}

async function StringOrBuffer(data, base64) {
    const string = String(data)
    return string.includes("\ufffd") ? (base64 ? `base64://${data.toString("base64")}` : data) : string
}

async function StringOrNull(data) {
    if (typeof data == "object" && typeof data.toString != "function")
        return "[object null]"
    return String(data)
}

async function Stringdata (data, opts) {
    switch (typeof data) {
      case "string":
        return data
      case "function":
        return String(data)
      case "object":
        if (data instanceof Error)
          return data.stack
        if (Buffer.isBuffer(data))
          return await StringOrBuffer(data, true)
    }

    try {
      return JSON.stringify(data, await getCircularReplacer(), opts) || await StringOrNull(data)
    } catch (err) {
      return await StringOrNull(data)
    }
}