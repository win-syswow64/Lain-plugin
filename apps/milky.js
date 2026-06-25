import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import Milky from '../adapter/Milky/index.js'

const milkyCfgPath = path.join(process.cwd(), 'plugins', 'Lain-plugin', 'config', 'config', 'Config-Milky.yaml')
const milkyDefPath = path.join(process.cwd(), 'plugins', 'Lain-plugin', 'config', 'defSet', 'Config-Milky.yaml')

if (!fs.existsSync(milkyCfgPath)) {
  fs.copyFileSync(milkyDefPath, milkyCfgPath)
}

export class milkyCfg extends plugin {
  constructor () {
    super({
      name: 'Milky设置',
      dsc: 'Milky适配器设置',
      event: 'message',
      priority: 1,
      rule: [
        {
          reg: /^#milky设置.+/i,
          fnc: 'set',
          permission: 'master'
        },
        {
          reg: /^#milky(开启|启用|关闭|禁用)$/i,
          fnc: 'enable',
          permission: 'master'
        },
        {
          reg: /^#milky上线$/i,
          fnc: 'online',
          permission: 'master'
        },
        {
          reg: /^#milky状态$/i,
          fnc: 'status',
          permission: 'master'
        }
      ]
    })
  }

  readCfg () {
    return YAML.parse(fs.readFileSync(milkyCfgPath, 'utf8'))
  }

  writeCfg (cfg) {
    fs.writeFileSync(milkyCfgPath, YAML.stringify(cfg), 'utf8')
  }

  async set () {
    const cfg = this.readCfg()
    const msg = this.e.msg.replace(/^#milky设置/i, '').trim().replace(/：/g, ':')
    const [host, port, accessToken = '', connection = 'ws', prefix = ''] = msg.split(':')

    if (!host || !port) {
      return this.reply('格式错误：#milky设置 host:port[:access_token][:ws|webhook][:prefix]', true)
    }

    cfg.host = host
    cfg.port = Number(port)
    cfg.access_token = accessToken
    cfg.connection = connection || 'ws'
    cfg.prefix = prefix || ''
    cfg.enable = true

    this.writeCfg(cfg)
    this.reply('Milky配置已保存，正在尝试连接...', true)
    await new Milky(cfg)
  }

  enable () {
    const cfg = this.readCfg()
    cfg.enable = /开启|启用/i.test(this.e.msg)
    this.writeCfg(cfg)
    return this.reply(`Milky已${cfg.enable ? '开启' : '关闭'}，重启后生效`, true)
  }

  async online () {
    const cfg = this.readCfg()
    cfg.enable = true
    this.writeCfg(cfg)
    this.reply('正在连接Milky...', true)
    await new Milky(cfg)
  }

  status () {
    const cfg = this.readCfg()
    const list = Array.from(Bot.adapter || []).filter(i => Bot[i]?.adapter === 'Milky')
    return this.reply([
      `Milky: ${cfg.enable ? '已开启' : '已关闭'}`,
      `连接方式: ${cfg.connection}`,
      `地址: ${cfg.host}:${cfg.port}${cfg.prefix || ''}`,
      `在线: ${list.length ? list.join(', ') : '无'}`
    ].join('\n'), true)
  }
}
