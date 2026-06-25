import Yaml from 'yaml'
import fs from 'node:fs'
import chokidar from 'chokidar'
import YamlHandler from '../../model/YamlHandler.js'
import common from '../common/common.js'

/** 配置文件 */
class Cfg {
  constructor() {
    this._path = './plugins/Lain-plugin/config/'
    this.config = {}

    /** 监听文件 */
    this.watcher = { config: {}, defSet: {} }

    this.initCfg()
    this.delFile()
  }

  /** 初始化配置 */
  initCfg() {
    // 初始化配置文件
    this.path = this._path + 'config/'
    this.pathDef = this._path + 'defSet/'
    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
      console.log(`[Lain-Plugin] 创建配置文件夹...`);
    }
    // 读取defSet文件夹下的所有以.yaml结尾的文件
    const files = fs.readdirSync(this.pathDef).filter(file => file.endsWith('.yaml'))
    // 遍历文件
    for (let file of files) {
      // 如果配置文件不存在，则将defSet中的文件复制到config文件夹中
      if (!fs.existsSync(`${this.path}${file}`)) {
        fs.copyFileSync(`${this.pathDef}${file}`, `${this.path}${file}`)
      }
    }
    // 加载配置文件
    this.lodCfg()
    // 如果FileToUrl文件夹不存在，则创建FileToUrl文件夹
    if (!fs.existsSync('./temp/FileToUrl')) fs.mkdirSync('./temp/FileToUrl')
  }

  /** 旧版本配置迁移 */
  async lodCfg() {
    const QQBot = this._path + 'QQBot.yaml'
    const bot = this._path + 'bot.yaml'
    let state = false
    if (fs.existsSync(QQBot)) {
      state = true
      const config = new YamlHandler(this.path + 'token.yaml')
      const QQBotCfg = Object.values(Yaml.parse(fs.readFileSync(QQBot, 'utf8')))
      for (const i of QQBotCfg) {
        if (!i?.appid) continue
        let val = {
          model: 2,
          appid: i.appid,
          token: i.token,
          sandbox: i.sandbox,
          allMsg: i.allMsg,
          removeAt: i.removeAt,
          secret: i.secret,
          toCallback: true,
          other: {
            Prefix: true,
            QQ: '',
            Tips: false,
            'Tips-GroupId': ''
          }
        }
        config.addVal('token', { [i.appid]: val }, 'object')
        await common.sleep(2000)
      }
      fs.renameSync(QQBot, this._path + 'QQBot.yaml-old')
    }

    if (fs.existsSync(bot)) {
      state = true
      const config = new YamlHandler(this.path + 'token.yaml')
      const botCfg = Object.values(Yaml.parse(fs.readFileSync(bot, 'utf8')))
      for (const i of botCfg) {
        if (!i?.appID) continue
        if (config.value('token', i.appID)) {
          config.set(`token.${i.appID}.model`, 0)
          await common.sleep(2000)
        } else {
          let val = {
            model: 2,
            appid: i.appID,
            token: i.token,
            sandbox: i.sandbox,
            allMsg: i.allMsg,
            removeAt: '',
            secret: '',
            toCallback: true,
            other: {
              Prefix: true,
              QQ: '',
              Tips: false,
              'Tips-GroupId': ''
            }
          }
          config.addVal('token', { [i.appID]: val }, 'object')
          await common.sleep(2000)
        }
      }
      fs.renameSync(bot, this._path + 'bot.yaml-old')
    }
    if (state) logger.warn('[Lain-plugin] 旧版本配置迁移完毕，请重启生效')
  }
  
  /** 适配器 */
  getAdapter() {
    let defSet = this.getdefSet('Config-Adapter')
    let config = this.getConfig('Config-Adapter')
    return { ...defSet, ...config }
  }

  /** other配置 */
  getOther() {
    let defSet = this.getdefSet('Config-other')
    let config = this.getConfig('Config-other')
    return { ...defSet, ...config }
  }

  /** QQ频道配置 */
  getQQGuild(guild_id = '') {
    let defSet = this.getdefSet('Config-QQGuild')
    let config = this.getConfig('Config-QQGuild')
    return { ...defSet.default, ...config.default, ...config[guild_id] }
  }

  /** QQ群、频道机器人token配置 */
  getToken(appid = 'all') {
    let config = this.getConfig('token')
    if (config.token?.[appid]) {
      return config.token[appid]
    }
    return config.token || {}
  }

  /** HTTP服务器配置 */
  get Server() {
    return this.getConfig('Config-Server')
  }

  /** HTTP服务器端口 */
  get port () {
    return Number(this.Server.port)
  }

  /** link替换白名单配置 */
  get WhiteLink() {
    return this.getConfig('Config-other').WhiteLink
  }

  /** 标准输入 */
  get Stdin() {
    return this.getConfig('Config-Adapter').Stdin
  }

  /** ComWeChat */
  get ComWeChat() {
    return this.getConfig('Config-Adapter').ComWeChat
  }

  /** Milky */
  get Milky() {
    const defSet = this.getdefSet('Config-Milky')
    const config = this.getConfig('Config-Milky')
    return { ...defSet, ...config }
  }

  /** QQ频道基本配置 */
  get GuildCfg() {
    return this.getConfig('Config-QQGuild')
  }

  /** 其他配置 */
  get Other() {
    let defSet = this.getdefSet('Config-other')
    let config = this.getConfig('Config-other')
    return { ...defSet, ...config }
  }

  /** ICQQ */
  get ICQQ() {
    let defSet = this.getdefSet('Config-other')
    let config = this.getConfig('Config-other')
    return { ...defSet, ...config }.ICQQToFile
  }

  /** 本体package.json */
  get YZPackage() {
    if (this._YZPackage) return this._YZPackage

    this._YZPackage = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
    return this._YZPackage
  }

  /** package.json */
  get package() {
    if (this._package) return this._package

    this._package = JSON.parse(fs.readFileSync(this._path + '../package.json', 'utf8'))
    return this._package
  }

  /**
   * @param name 配置文件名称
   */
  getdefSet(name) {
    return this.getYaml('defSet', name)
  }

  /** 用户配置 */
  getConfig(name) {
    return this.getYaml('config', name)
  }

  /**
   * 获取配置yaml
   * @param type 默认跑配置-defSet，用户配置-config
   * @param name 名称
   */
  getYaml(type, name) {
    let file = `${this._path}/${type}/${name}.yaml`
    let key = `${type}.${name}`
    if (this.config[key]) return this.config[key]

    this.config[key] = Yaml.parse(
      fs.readFileSync(file, 'utf8')
    )

    this.watch(file, name, type)

    return this.config[key]
  }

  /** 监听配置文件 */
  watch(file, name, type = 'defSet') {
    let key = `${type}.${name}`

    if (this.watcher[key]) return

    const watcher = chokidar.watch(file)
    watcher.on('change', path => {
      delete this.config[key]
      if (typeof Bot == 'undefined') return
      logger.mark(`[修改配置文件][${type}][${name}]`)
      if (this[`change_${name}`]) {
        this[`change_${name}`]()
      }
    })

    this.watcher[key] = watcher
  }

  /** 更新全局Bot中的配置 */
  change_token() {
    const CfgList = Object.values(this.getToken())
    if (CfgList.length) for (const i of CfgList) if (typeof Bot[i.appid] !== 'undefined') Bot[i.appid].config = i
  }

  /** 删除临时文件 */
  delFile() {
    try {
      const files = fs.readdirSync('./temp/FileToUrl')
      files.map((file) => fs.promises.unlink(`./temp/FileToUrl/${file}`, () => { }))
    } catch { }
  }
}

export default new Cfg()
