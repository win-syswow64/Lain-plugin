/**
*  模板源码
*  {{.text_0}}{{.text_1}}{{.text_2}}{{.text_3}}{{.text_4}}{{.text_5}}{{.text_6}}{{.text_7}}{{.text_8}}{{.text_9}}
*  正常设置模板ID 模式设置4：#QQBotMD4
*/

import plugin from '../Lain-plugin/adapter/QQBot/plugins.js'

/** 违规关键字 */
let mdSymbols = ['](', '] (', '***', '**', '*', '__', '_', '~~', '~', '``', '`']

Bot.ContentToMarkdown = async function (e, content, button = []) {
  /** 数组转字符串 */
  content = content.join('\r')
  /** 处理二笔语法，分割为数组 */
  content = parseMD(content)

  return await combination(e, content, button)
}

/** 处理md标记 */
function parseMD (str) {
  /** 处理第一个标题 */
  str = str.replace(/^#/, '\r#').replace(/\n/g, '\r')
  let msg = str.split(/(\]\(|\] \(|\*\*\*|\*\*|\*|__|_|~~|~|``|`)/).filter(Boolean)
  let result = []
  let temp = ''

  for (let i = 0; i < msg.length; i++) {
    if (mdSymbols.includes(msg[i])) {
      temp += msg[i]
    } else {
      if (temp !== '') {
        result.push(temp)
        temp = ''
      }
      temp += msg[i]
    }
  }

  if (temp !== '') result.push(temp)
  return result
}

/** 按9进行分类 */
function sort (arr) {
  const Array = []
  for (let i = 0; i < arr.length; i += 9) {
    if (Array.length) {
      // 处理第九张图
      if (arr[i - 1].match(/\[/)) {
        Array[Array.length - 1][9] = arr[i].substring(0, arr[i].indexOf(')') + 1)
        arr[i] = arr[i].substring(arr[i].indexOf(')') + 1)
      } else {
        Array[Array.length - 1][9] = arr[i]
        i++
      }
    }
    if (!arr[i]) break
    Array.push(arr.slice(i, i + 9))
  }
  return Array
}

/** 组合 */
async function combination (e, data, but) {
  const all = []
  /** 按9分类 */
  data = sort(data)
  for (let p of data) {
    const params = []
    const length = p.length
    for (let i = 0; i < length; i++) {
      params.push({ key: 'text_' + (i), values: [p[i]] })
    }

    /** 转为md */
    const markdown = {
      type: 'markdown',
      custom_template_id: e.bot.config.markdown.id,
      params
    }

    logger.debug(params)

    /** 按钮 */
    const button = await Button(e)
    button && button?.length ? all.push([markdown, ...button, ...but]) : all.push([markdown, ...but])
  }
  return all
}

/** 按钮添加 */
async function Button (e) {
  try {
    for (let p of plugin) {
      for (let v of p.plugin.rule) {
        const regExp = new RegExp(v.reg)
        if (regExp.test(e.msg)) {
          p.e = e
          const button = await p[v.fnc](e)
          /** 无返回不添加 */
          if (button) return [...(Array.isArray(button) ? button : [button])]
        }
      }
    }
    return false
  } catch (error) {
    logger.error('Lain-plugin', error)
    return false
  }
}
