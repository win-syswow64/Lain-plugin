import fs from 'fs'
import moment from 'moment'
import chokidar from 'chokidar'

class Button {
  constructor () {
    this.plugin = './plugins'
    this.botModules = []
    this.initialize()
  }

  /** 加载按钮 */
  async loadModule (filePath) {
    filePath = filePath.replace(/\\/g, '/')
    try {
      let Plugin = (await import(`../../${filePath}?${moment().format('x')}`)).default
      Plugin = new Plugin()
      Plugin.plugin._path = filePath
      this.botModules.push(Plugin)
      /** 排序 */
      this.botModules.sort((a, b) => a.plugin.priority - b.plugin.priority)
      logger.debug(`按钮模块 ${filePath} 已加载。`)
    } catch (error) {
      logger.error(`导入按钮模块 ${filePath} 时出错：${error.message}`)
    }
  }

  /** 卸载指定文件路径的模块 */
  unloadModule (filePath) {
    const index = this.botModules.findIndex(module => module.plugin._path === filePath)
    if (index !== -1) this.botModules.splice(index, 1)
    /** 排序 */
    this.botModules.sort((a, b) => a.plugin.priority - b.plugin.priority)
  }

  /**
   * 处理文件变化事件
   * @param {string} filePath - 文件路径
   * @param {string} eventType - 事件类型 ('add', 'change', 'unlink')
   */
  async handleFileChange (filePath, eventType, state) {
    filePath = filePath.replace(/\\/g, '/')
    if (filePath.endsWith('.js')) {
      if (eventType === 'add') {
        this.unloadModule(filePath)
        await this.loadModule(filePath)
        if (!state) logger.mark(`[Lain-plugin][新增按钮插件][${filePath}]`)
      } else if (eventType === 'change') {
        this.unloadModule(filePath)
        await this.loadModule(filePath)
        logger.mark(`[Lain-plugin][修改按钮插件][${filePath}]`)
      } else if (eventType === 'unlink') {
        this.unloadModule(filePath)
        logger.mark(`[Lain-plugin][卸载按钮插件][${filePath}]`)
      }
    }
  }

  /** 初始化 */
  async initialize () {
    try {
      const filesList = []
      /** 遍历插件目录 */
      const List = fs.readdirSync(this.plugin)
      for (let folder of List) {
        const folderPath = this.plugin + `/${folder}`
        /** 检查是否为文件夹 */
        if (!fs.lstatSync(folderPath).isDirectory()) continue
        /** 保存插件包目录 */
        filesList.push(this.plugin + `/${folder}/lain.support.js`)
      }

      /** 获取插件包内的文件夹，进行热更 */
      const pluginList = fs.readdirSync(this.plugin + '/Lain-plugin/plugins')
      /** 支持插件包按钮 */
      for (let folder of pluginList) {
        const folderPath = this.plugin + `/Lain-plugin/plugins/${folder}`
        /** 检查是否为文件夹 */
        if (!fs.lstatSync(folderPath).isDirectory()) continue
        /** 保存 */
        filesList.push(folderPath)
      }

      /** 热更新 */
      filesList.map(folder => {
        let state = true
        const watcher = chokidar.watch(folder, { ignored: /[\/\\]\./, persistent: true })
        watcher
          .on('add', async filePath => {
            await this.handleFileChange(filePath, 'add', state)
            if (state) state = false
          })
          .on('change', async filePath => await this.handleFileChange(filePath, 'change'))
          .on('unlink', async filePath => await this.handleFileChange(filePath, 'unlink'))

        return watcher
      })

      /** plugins/button/ 独立按钮插件目录热更新 */
      const buttonDir = this.plugin + '/button'
      if (fs.existsSync(buttonDir)) {
        /** 初始加载 */
        const btnFiles = fs.readdirSync(buttonDir).filter(f => f.endsWith('.js'))
        for (const file of btnFiles) {
          const relPath = 'plugins/button/' + file
          this.unloadModule(relPath)
          await this.loadModule(relPath)
          logger.mark(`[Lain-plugin][加载按钮插件][${relPath}]`)
        }
        /** 监听 button 目录变化 */
        const btnWatcher = chokidar.watch(buttonDir, {
          ignored: /[\/\\]\./,
          persistent: true,
          ignoreInitial: true
        })
        btnWatcher
          .on('add', async filePath => {
            const file = filePath.split('/').pop()
            if (!file.endsWith('.js')) return
            const relPath = 'plugins/button/' + file
            this.unloadModule(relPath)
            await this.loadModule(relPath)
            logger.mark(`[Lain-plugin][新增按钮插件][${relPath}]`)
          })
          .on('change', async filePath => {
            const file = filePath.split('/').pop()
            if (!file.endsWith('.js')) return
            const relPath = 'plugins/button/' + file
            this.unloadModule(relPath)
            await this.loadModule(relPath)
            logger.mark(`[Lain-plugin][热更新按钮插件][${relPath}]`)
          })
          .on('unlink', async filePath => {
            const file = filePath.split('/').pop()
            if (!file.endsWith('.js')) return
            const relPath = 'plugins/button/' + file
            this.unloadModule(relPath)
            logger.mark(`[Lain-plugin][卸载按钮插件][${relPath}]`)
          })
      }

      return this.botModules
    } catch (error) {
      logger.error(`读取插件目录时出错：${error.message}`)
    }
  }
}

const plugin = new Button()
export default plugin.botModules
