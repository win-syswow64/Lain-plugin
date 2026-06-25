# QQBot 按钮消息使用文档

> 严格遵循 [QQ 官方按钮消息文档](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html)

## 官方消息格式

按钮消息以 `keyboard` 类型发送，与 `markdown` 同属 `msg_type: 2`：

```json
{
  "msg_type": 2,
  "markdown": { "content": "消息正文" },
  "keyboard": {
    "content": {
      "rows": [
        {
          "buttons": [
            {
              "id": "bt_xxx",
              "render_data": {
                "label": "按钮文本",
                "visited_label": "点击后文本",
                "style": 0
              },
              "action": {
                "type": 1,
                "permission": { "type": 2 },
                "data": "回调数据",
                "enter": false,
                "unsupport_tips": "暂不支持此按钮"
              }
            }
          ]
        }
      ]
    }
  }
}
```

## 按钮 action.type

| type | 说明 | data 字段 | enter 字段 |
|------|------|-----------|------------|
| 0 | 链接跳转 | URL 地址 | `false` |
| 1 | 回调（触发 interaction 事件） | 自定义回调数据 | `false` |
| 2 | 输入（直接发送文本） | 要发送的文本 | `true`=自动发送 |

## 按钮 permission.type

| type | 说明 |
|------|------|
| 0 | 指定用户（需配合 `specify_user_ids`） |
| 1 | 仅管理员 |
| 2 | 所有人（默认） |

## style

| 值 | 颜色 |
|----|------|
| 0 | 灰色 |
| 1 | 蓝色（默认） |

## 使用方式

### 方式一：Bot.Button 全局函数

适用于所有适配器，返回 `[{ type: 'button', buttons: [...] }]` 格式行数组。

```js
const buttons = Bot.Button([
  { label: '功能统计', data: '#功能统计' },     // type 2: 输入按钮
  { label: '百度', link: 'https://baidu.com' }, // type 0: 链接按钮
  { label: '回调', callback: '/mycmd' },        // type 1: 回调按钮
], 3)  // 每行最多 3 个按钮

// 二维数组控制行分组
const buttons = Bot.Button([
  [
    { label: '按钮A', data: '/a' },
    { label: '按钮B', data: '/b' },
  ],
  [
    { label: '按钮C', link: 'https://example.com' },
  ]
])
```

### 方式二：e.markdown / e.replyMarkdown

QQBot 适配器专用，发送 markdown + 按钮：

```js
// 基本用法
await e.markdown('消息正文', { buttons: [[{ label: '按钮', data: '/cmd' }]] })

// 二维按钮数组
const buttons = [
  [
    { label: '签到', data: '/签到' },
    { label: '帮助', data: '/帮助' },
  ]
]
await e.markdown('欢迎使用', { buttons })
```

### 方式三：直接回复

```js
await this.reply([
  { type: 'markdown', content: '消息正文' },
  {
    type: 'keyboard',
    content: {
      rows: [
        {
          buttons: [
            {
              id: 'bt_001',
              render_data: { label: '按钮', visited_label: '已点击', style: 1 },
              action: { type: 1, permission: { type: 2 }, data: '/cmd', enter: false, unsupport_tips: '不支持' }
            }
          ]
        }
      ]
    }
  }
])
```

### 方式四：22009-plugin Button 插件

在 `lain.support.js` 中定义按钮插件，自动为匹配的消息添加按钮行：

```js
export default class Button {
  constructor() {
    this.plugin = {
      name: '我的按钮',
      dsc: '按钮描述',
      priority: 100,
      rule: [
        { reg: '^#?菜单$', fnc: 'menu' }
      ]
    }
  }

  menu(e) {
    const button = [
      [
        { label: '功能A', data: '/功能A' },
        { label: '功能B', data: '/功能B' },
      ],
      [
        { label: '官网', link: 'https://example.com' },
      ]
    ]
    return Bot.Button(button)
  }
}
```

## 按钮字段映射

`Bot.Button` 接受的简写字段与官方字段的对应关系：

| 简写字段 | 官方字段 | 说明 |
|----------|----------|------|
| `label` / `text` | `render_data.label` | 按钮显示文本 |
| `visited_label` | `render_data.visited_label` | 点击后的文本 |
| `style` | `render_data.style` | 0=灰色, 1=蓝色 |
| `link` | `action.type=0`, `action.data` | 链接 URL |
| `callback` | `action.type=1`, `action.data` | 回调数据 |
| `data` | `action.data` | 自定义数据（无 link/callback/input 时） |
| `input` | `action.type=2`, `action.data` | 输入文本 |
| `send` / `enter` | `action.enter` | 是否自动发送 |
| `admin` | `permission.type=1` | 仅管理员可点 |
| `list` | `permission.type=0`, `specify_user_ids` | 指定用户可点 |
| `tips` | `action.unsupport_tips` | 不支持时的提示 |

## 回调按钮交互

当用户点击 `type=1`（callback）按钮时，机器人收到 `interaction` 事件。adapter 自动将其转为 `message` 事件：

```js
// 监听按钮回调
e.cmd = e.raw_message  // 回调数据
e.sub_type === 'callback'  // 标识为按钮回调
```

`toCallback` 配置项控制 callback 按钮的发送方式：
- `true`（默认）：type=1，触发 interaction 事件
- `false`：转为 type=2（输入），自动发送回调数据

## 约束

- 每行最多 **5** 个按钮
- 最多 **5** 行按钮
- 按钮 `id` 自动生成，无需手动指定
- `permission.specify_user_ids` 中的 ID 会自动剥离 `appid-` 前缀

## 自动附加按钮（插件无需改动）

QQBot adapter 内置了按钮自动附加机制。当任何插件调用 `e.reply()` 或 `e.markdown()` 时，adapter 会自动扫描已注册的 button 插件（`lain.support.js`），匹配当前消息并附加按钮。

### 工作原理

```
插件调用 e.reply('消息')
  → adapter 包装函数触发
  → 调用 this.button(e) 扫描所有 button 插件
  → 匹配 e.msg 的规则返回按钮行
  → 按钮自动追加到消息
  → 发送 [消息, keyboard]
```

### 如何注册按钮规则

在任意插件目录创建 `lain.support.js`：

```js
export default class Button {
  constructor() {
    this.plugin = {
      name: '我的按钮',
      dsc: '描述',
      priority: 100,  // 越小越先匹配
      rule: [
        { reg: '^#?菜单$', fnc: 'menu' },       // 精确匹配
        { reg: '', fnc: 'always' },               // 空字符串 = 全局匹配
      ]
    }
  }

  menu(e) {
    return Bot.Button([
      [{ label: '功能A', data: '/功能A' }],
      [{ label: '帮助', data: '/帮助' }],
    ])
  }

  always(e) {
    // 返回 false 或不返回 = 不附加按钮
    return false
  }
}
```

### 注意事项

- 只有 `e.adapter === 'QQBot'` 时才触发自动附加
- `e.markdown(msg, { buttons })` 已手动传入 buttons 时不会重复附加
- `quote?.markdown` 模式不触发自动附加（走 `sendMarkdownReplyMsg` 专用路径）
- 多个 button 插件按 `priority` 排序，只取第一个匹配结果
- 自动附加通过 `this.button(e)` 实现，与 `e.markdown` 内置的 button 扫描共用同一套插件系统

## plugins/button/ 目录

Lain 的按钮插件目录。放入此目录的 `.js` 文件会被 QQBot adapter 自动加载，支持热更新。

### 文件结构

```
plugins/button/
  菜单按钮.js      ← 匹配 #菜单 时附加导航按钮
  全局按钮.js      ← 匹配所有消息的兜底按钮
  你的按钮.js      ← 自定义按钮插件
  lain.support.js  ← 传统格式（兼容）
```

### 创建按钮插件

每个 `.js` 文件导出一个 class，结构如下：

```js
export default class MyButton {
  constructor () {
    this.plugin = {
      name: '插件名',          // 显示名称
      dsc: '描述',              // 功能描述
      priority: 100,            // 优先级，数字越小越先匹配
      rule: [
        {
          reg: '^#?菜单$',      // 匹配的正则
          fnc: 'onMenu'         // 匹配后调用的方法名
        },
        {
          reg: '',              // 空字符串 = 匹配所有消息
          fnc: 'onAll'
        }
      ]
    }
  }

  onMenu (e) {
    // 返回 Bot.Button(...) 格式的按钮行
    return Bot.Button([
      [{ label: '功能A', data: '#功能A' }],
      [{ label: '帮助', data: '#帮助' }],
    ])
  }

  onAll (e) {
    // 返回 false 或不返回 = 不附加按钮
    if (!e.group_id) return false
    return Bot.Button([[{ label: '菜单', data: '#菜单' }]])
  }
}
```

### 匹配规则

- `reg: '^#?菜单$'` — 精确匹配
- `reg: '关键词'` — 包含匹配
- `reg: ''` — 匹配所有消息（注意设低优先级 priority 值大）
- 多个插件按 `priority` 排序，**只取第一个匹配结果**

### 与 lain.support.js 的关系

`plugins/button/lain.support.js` 是传统格式，与 `plugins/button/*.js` 同时生效。
如果两者都匹配同一消息，按 `priority` 决定优先级。

### 热更新

修改 `plugins/button/` 下的 `.js` 文件后自动重新加载，无需重启。
日志中会显示 `[Lain-plugin][修改按钮插件][...]`。

## miao-plugin Button API 兼容

支持 `Bot.Button.create()` 和 `Bot.Button.nav()` 两种创建方式，与 miao-plugin 的 Button API 对齐。

### Bot.Button.create(rows)

从二维数组创建按钮：

```js
// 二维数组，每个子数组是一行
let btn = Bot.Button.create([
  [{ text: '签到', data: '#签到' }, { text: '帮助', data: '#帮助' }],
  [{ text: '官网', link: 'https://example.com' }]
])
await e.reply([msg, btn])
```

### Bot.Button.nav(items)

创建导航按钮（单行）：

```js
let nav = Bot.Button.nav([
  { text: '上一页', data: '#上一页' },
  { text: '下一页', data: '#下一页' }
])
await e.reply([msg, nav])
```

### Bot.Button.isButton(obj)

判断对象是否为 Button.create() 生成的按钮：

```js
if (Bot.Button.isButton(someObj)) { ... }
```

### Bot.Button.extract(msg)

从消息数组中分离按钮对象：

```js
const { msgs, button } = Bot.Button.extract([text, image, btnObj])
// msgs = [text, image]
// button = btnObj (或 null)
```

### 按钮字段

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `text` | 按钮文本 | 必填 |
| `data` | 回调/输入数据 | |
| `link` | 跳转链接（type=0） | |
| `callback` | 回调数据（type=1） | |
| `input` | 输入数据（type=2） | |
| `send` / `enter` | 是否自动发送 | type=2 默认 true |
| `style` | 0=灰色, 1=蓝色 | 行内交替 |
| `admin` | 仅管理员可点 | false |
| `list` | 指定用户 openid 列表 | |
| `tips` | 不支持时的提示 | |

### 在 button 插件中使用

```js
export default class MyButton {
  constructor() {
    this.plugin = {
      name: '我的按钮',
      dsc: '描述',
      priority: 100,
      rule: [{ reg: '#命令', fnc: 'cmd' }]
    }
  }

  // 方式一：Bot.Button() 函数（原生）
  cmd_old(e) {
    return Bot.Button([[{ label: '按钮', data: '#cmd' }]])
  }

  // 方式二：Bot.Button.create()（miao 风格）
  cmd(e) {
    return Bot.Button.create([
      [{ text: '按钮A', data: '#cmd' }],
      [{ text: '按钮B', link: 'https://...' }]
    ])
  }

  // 方式三：Bot.Button.nav()（导航行）
  cmd_nav(e) {
    return Bot.Button.nav([
      { text: '上一页', data: '#prev' },
      { text: '下一页', data: '#next' }
    ])
  }
}
```

### 在插件 reply 中直接使用

```js
// 插件代码中
async myFunc(e) {
  let nav = Bot.Button.nav([
    { text: '重试', data: '#重试' },
    { text: '帮助', data: '#帮助' }
  ])
  await e.reply(['操作完成', nav])
}
```

`e.reply()` 会自动识别消息数组中的 Button 对象并转换为 keyboard 格式发送。

## segment.button() 兼容（miao-plugin 原生风格）

在 `segment` 全局对象上提供了 `button()` 方法，直接兼容 miao-plugin 的 Button.js 写法。

### API

```js
segment.button(row1, row2, row3, ...)
```

每个参数是一行按钮数组，行结构完整保留。

### miao-plugin Button.js 完整兼容示例

```js
export default class Button {
  constructor(e = {}) {
    this.prefix = e.isSr ? "*" : "#"
  }

  gacha() {
    return segment.button(
      [{ text: "角色记录", callback: `${this.prefix}角色记录` },
       { text: "角色统计", callback: `${this.prefix}角色统计` }],
      [{ text: "武器记录", callback: `${this.prefix}武器记录` },
       { text: "武器统计", callback: `${this.prefix}武器统计` }],
      [{ text: "抽卡帮助", callback: `${this.prefix}抽卡帮助` }]
    )
  }

  profile(char = {}, uid = "") {
    return segment.button(
      [{ text: `${char.name}卡片`, callback: `${this.prefix}${char.name}卡片${uid}` },
       { text: `${char.name}面板`, callback: `${this.prefix}${char.name}面板${uid}` }],
      [{ text: `${char.name}排行`, callback: `${this.prefix}${char.name}排行` },
       { text: `${char.name}图鉴`, callback: `${this.prefix}${char.name}图鉴` }]
    )
  }

  // 动态行数也完全支持
  profileList(uid = "", charList = {}) {
    const button = [[]]
    let count = 0
    for (const name in charList) {
      if (count >= 10) break
      const array = button[button.length - 1]
      array.push({ text: `${name}面板`, callback: `${this.prefix}${name}面板${uid}` })
      if (array.length > 1) button.push([])
      count++
    }
    return segment.button(...button)
  }
}
```

### 三种 API 对照

| API | 风格 | 用法 |
|-----|------|------|
| `Bot.Button(list, line)` | Lain 原生 | `Bot.Button([{ label, data }], 3)` |
| `Bot.Button.create(rows)` | miao 风格（静态） | `Bot.Button.create([[{ text, data }]])` |
| `segment.button(...rows)` | miao 原生 | `segment.button([{ text, data }], [{ text, data }])` |

三种方式输出格式一致，adapter 统一处理。
