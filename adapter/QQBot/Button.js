/**
 * QQBot Button 工具类
 * 兼容 miao-plugin Button API 风格
 *
 * 用法：
 *   import Button from '../adapter/QQBot/Button.js'   // 或相对路径
 *
 *   // 创建按钮（2D 数组）
 *   let btn = Button.create([
 *     [{ text: '签到', data: '#签到' }, { text: '帮助', data: '#帮助' }],
 *     [{ text: '官网', link: 'https://example.com' }]
 *   ])
 *   await e.reply([msg, btn])
 *
 *   // 创建导航按钮（单行）
 *   let nav = Button.nav([
 *     { text: '上一页', data: '/page prev' },
 *     { text: '下一页', data: '/page next' }
 *   ])
 *   await e.reply([msg, nav])
 */

export default class Button {
  /**
   * 创建按钮
   * @param {Array} rows - 二维数组，每个子数组是一行按钮
   *   按钮字段: { text, data?, link?, callback?, input?, send?, style?, admin?, list?, permission?, tips? }
   * @returns {{ type: string, content: { rows: Array }, _isButton: boolean }}
   */
  static create (rows = []) {
    if (!Array.isArray(rows)) rows = [[rows]]
    if (!rows.length) return null
    if (!Array.isArray(rows[0])) rows = [rows]

    const builtRows = rows.map(row => {
      const buttons = (Array.isArray(row) ? row : [row]).map((btn, idx) => {
        if (!btn) return null
        if (btn.render_data && btn.action) return btn
        return Button._buildButton(btn, idx)
      }).filter(Boolean)
      return { buttons }
    }).filter(row => row.buttons.length > 0)

    if (!builtRows.length) return null

    return {
      type: 'keyboard',
      content: { rows: builtRows },
      _isButton: true
    }
  }

  /**
   * 创建导航按钮（单行）
   * @param {Array} items - 按钮定义数组
   * @returns {{ type: string, content: { rows: Array }, _isButton: boolean }}
   */
  static nav (items = []) {
    return Button.create([items])
  }

  /**
   * 从 miao-plugin 风格的按钮定义构建官方格式按钮
   * @param {object} btn
   * @param {number} idx - 行内索引（用于默认 style）
   * @returns {object} 官方格式按钮
   */
  static _buildButton (btn, idx = 0) {
    const id = btn.id || ('bt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8))
    const label = btn.text ?? btn.label ?? btn.link ?? ''

    // 确定 action type: 0=link, 1=callback, 2=input
    let type = btn.type
    if (type == null) {
      if (btn.link) type = 0
      else if (btn.callback) type = 1
      else type = 2
    }
    type = Number(type)

    // 确定 data
    const data = btn.data ?? btn.input ?? btn.callback ?? btn.link ?? ''

    // 确定 enter
    let enter = btn.send ?? btn.enter
    if (enter == null) {
      enter = type === 2 ? true : false
    }

    // 确定 permission
    let permission = btn.permission
    if (permission == null) {
      if (btn.admin) {
        permission = { type: 1 }
      } else if (btn.list?.length) {
        permission = { type: 0, specify_user_ids: btn.list }
      } else {
        permission = { type: 2 }
      }
    }

    return {
      id: String(id),
      render_data: {
        label,
        visited_label: btn.visited_label ?? label,
        style: btn.style != null ? Number(btn.style) : (idx % 2)
      },
      action: {
        type,
        permission,
        data,
        enter,
        unsupport_tips: btn.tips ?? '暂不支持此按钮'
      }
    }
  }

  /**
   * 判断一个对象是否为 Button.create() 生成的按钮
   * @param {any} obj
   * @returns {boolean}
   */
  static isButton (obj) {
    return obj?._isButton === true && obj?.type === 'keyboard'
  }

  /**
   * 从消息数组中提取按钮对象，返回 { msgs, button }
   * @param {Array} msg
   * @returns {{ msgs: Array, button: object|null }}
   */
  static extract (msg) {
    if (!Array.isArray(msg)) return { msgs: [msg], button: null }
    let button = null
    const msgs = msg.filter(i => {
      if (Button.isButton(i)) {
        button = i
        return false
      }
      return true
    })
    return { msgs, button }
  }
}
