import _ from 'lodash';
import fs from 'fs';
import Render from './render.js';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { Stream } from "stream";
import fetch from 'node-fetch';
import schedule from "node-schedule";

const TMP_DIR = process.cwd() + '/plugins/Lain-plugin/Temp'
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR)

schedule.scheduleJob('0 0 0 * * ?', function () {
    logger.mark('[Lain-plugin] 执行定时任务: 删除Temp')
    try {
        const files = fs.readdirSync(TMP_DIR)
        for (const file of files) {
            fs.unlink(join(TMP_DIR, file), () => { })
        }
    } catch (error) { }
});

const QRCode = await (async function () {
    try {
        return await import('qrcode')
    } catch (error) {
        return false
    }
})()

const toQRCodeRegExp = /https?:\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])?/g

async function makeQRCode(data) {
    return (await QRCode.toDataURL(data)).replace("data:image/png;base64,", "base64://")
}

const htmlCache = {}
let id = 1

/**
 * 将转发消息渲染成图片并发送,data为makeForwordMsg.data
 * @param {Object} data makeForwordMsg.data
 * @param {{user_id:number,nickname:string,reply:function}} e 直接丢e即可
 * @param cfg 渲染配置
 * @param cfg.retype
 * * default/空：自动发送图片，返回true
 * * msgId：自动发送图片，返回msg id
 * * base64: 不自动发送图像，返回图像base64数据
 * @param {boolean} cfg.returnID 返回ws查看对应id, 默认不返回
 */
async function toImg(data, e, cfg = { retType: 'base64' }) {
    let isNode = false
    if (e.wsCacheIsNode) {
        isNode = e.wsCacheIsNode
        delete e.wsCacheIsNode
    }
    let html = []
    const user_id = e.bot?.uin || e.bot?.user_id || e.user_id || 10000
    const nickname = e.bot?.nickname || e.nickname || '^_^'
    if (!Array.isArray(data)) data = [data]
    for (let i of data) {
        if (!i) continue
        if (typeof i === 'string') i = { type: 'text', text: i }
        let message = '<div class="text">'

        message += `<span class="id">ID: ${id}</span>`

        let node
        if (typeof i.message === 'string') i.message = { type: 'text', text: i.message || i.text }
        if (!i.message) i.message = { ...i }
        if (!Array.isArray(i.message)) i.message = [i.message]
        let img = 0, text = 0, OriginalMessage = []
        for (let m of i.message) {
            if (typeof m === 'string') m = { type: 'text', text: m }
            message += '<div>'
            OriginalMessage.push(m)
            switch (m.type) {
                case 'text':
                    if (QRCode) {
                        const match = m.text.match(toQRCodeRegExp)
                        if (match) {
                            for (const url of match) {
                                const qrcode = await makeQRCode(url)
                                m.text = m.text.replace(url, `${url}<br/><img src="${await saveImg(qrcode, '.png')}" /><br/>`)
                            }
                        }
                    }
                    message += m.text.replace(/\n/g, '<br />')
                    text++
                    break;
                case 'image':
                    try {
                        const tag = (m.file || m.url).includes('i.pximg.net') ? 'pixiv' : '';

                        let ext = 'webp';
                        if (typeof m.file === 'string' && m.file.startsWith('http')) { ext = extname(m.file) || 'webp'; }
                        else if (typeof m.url === 'string' && m.url) { ext = extname(m.url) || 'webp'; }

                        message += `<img src="${await saveImg(m.file || m.url, ext, tag)}" />`
                        img++
                    } catch (err) { console.log(err); }
                    break;
                case 'node':
                    e.wsCacheIsNode = true
                    node = await toImg(m.data, e)
                    break
                case "button":
                    message = message.replace(/<div>$/, '')
                    OriginalMessage.pop()
                    continue
                default:
                    message += JSON.stringify(m, null, '<br />')
                    text++
                    break;
            }
            message += '</div>'
        }
        message += '</div>'

        htmlCache[id] = OriginalMessage

        id++
        if (node) {
            html.push(...node)
        } else {
            let uin = i.uin || (!i.user_id || i.user_id == 88888) ? user_id : i.user_id
            if (Array.isArray(uin)) uin = user_id
            const avatar = i.avatar || e?.bot?.avatar || `https://q1.qlogo.cn/g?b=qq&s=0&nk=${uin}`
            const path = join(TMP_DIR, `${uin}${extname(avatar) || '.png'}`)
            if (!fs.existsSync(path)) {
                const img = await fetch(avatar)
                const arrayBuffer = await img.arrayBuffer()
                const buffer = Buffer.from(arrayBuffer)
                fs.writeFileSync(path, buffer)
            }
            // 只有一张图片
            if (img === 1 && text === 0) {
                message = message.replace('<div class="text">', '<div class="img">')
            }

            html.push({
                avatar: `<img src="${path}" />`,
                nickname: i.nickname || nickname,
                message
            })
        }
    }
    if (!isNode) {
        const configPath = process.cwd() + '/plugins/Lain-plugin/resources/chatHistory'
        let config
        if (fs.existsSync(`${configPath}/config.js`)) {
            config = await import(`file://${configPath}/config.js`)
        } else {
            config = await import(`file://${configPath}/config_default.js`)
        }
        const allTHeme = fs.readdirSync(configPath).filter(files => {
            const fullPath = join(configPath, files);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                return fullPath
            }
        })
        let target = 'default'
        if (typeof config.theme === 'string') {
            if (config.theme === 'all') {
                target = allTHeme[_.random(0, allTHeme.length - 1)]
            } else {
                target = config.theme
            }
        } else if (Array.isArray(config.theme)) {
            target = config.theme[_.random(0, config.theme.length - 1)]
        }
        let render = await Render.render(
            `chatHistory/${target}/index`,
            { data: html, target },
            { e, scale: 1.2, ...cfg }
        )

        return render
    }
    return html
}

/**
 * 
 * @param {String | Buffer | Stream.Readable} data | 图片地址或Buffer
 * @param {String} ext | 图片格式
 * @param {String} extend | 扩展信息
 * @returns {Promise<String>} | 返回保存图片的路径
 */
async function saveImg(data, ext = "webp", extend) {
    let buffer;
    if (Buffer.isBuffer(data)) {
        buffer = data;
    } else if (data instanceof Stream.Readable) {
        buffer = await streamToBuffer(data);
    } else if (data.match(/^base64:\/\//)) {
        buffer = Buffer.from(data.replace(/^base64:\/\//, ""), 'base64');
    } else if (data.startsWith('http')) {
        const headers = {
            'pixiv': {
                'Host': 'i.pximg.net',
                'Referer': 'https://www.pixiv.net/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.46'
            },
            'default': {}
        };
        const header = extend && headers[extend] || {};
        const img = await fetch(data, { headers: header });
        const arrayBuffer = await img.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
    } else if (data.startsWith('file://')) {
        try {
            buffer = fs.readFileSync(data.replace(/^file:\/\//, ''));
        } catch (error) {
            buffer = fs.readFileSync(data.replace(/^file:\/\/\//, ''));
        }
    } else if (/^.{32}\.image$/.test(data)) {
        const img = await fetch(`https://gchat.qpic.cn/gchatpic_new/0/0-0-${data.replace('.image', '').toUpperCase()}/0`);
        const arrayBuffer = await img.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
    } else {
        buffer = fs.readFileSync(data);
    }

    const path = join(TMP_DIR, `${randomUUID({ disableEntropyCache: true })}.${ext}`);
    fs.writeFileSync(path, buffer);
    return path;
}

export default toImg;
