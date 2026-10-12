# QQBot 底部按钮：使用与开发

Lain-plugin 为 QQBot 提供原生 `keyboard` 按钮消息。按钮可以发送指令、触发回调或打开网页；扩展按钮可在插件回复时自动附加到底部。按钮消息遵循 [QQ 机器人官方按钮文档](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html)。

## 使用现成按钮

小按钮（micro）沿用 Yunzai-QQBot-Plugin 的格式：发送 `#QQBot小按钮 AppID:true` 为该账号全局开启，或为单条消息附加 `segment.custom('small')`，也支持 `{ type: 'micro' }`。两者设置 `keyboard.content.style.font_size = "small"`，不改变输入、回调或链接动作及按钮权限。`e.markdown()` 可传 `{ smallbtn: true }` 或 `{ micro: true }`。legacy 普通消息模式不发送原生键盘，按钮以文字指令提示显示。

```js
await e.reply(['请选择操作', Button.create([[{ text: '帮助', data: '#帮助' }]]), segment.custom('small')])
await e.markdown('请选择操作', { buttons: [[{ label: '帮助', data: '#帮助' }]], micro: true })
```

QQBot 的 `e.reply()` 和 `e.markdown()` 会根据当前消息扫描已加载的按钮扩展。消息匹配某个扩展文件的规则后，适配器将该文件返回的按钮附加到回复底部。

按钮点击后有三种动作：

| 动作 | 简写 | 点击后的行为 |
| --- | --- | --- |
| 输入 | `data` 或 `input` | 把文本放入当前会话输入框；`send: true` 时直接发送 |
| 回调 | `callback` | 触发 QQBot `interaction` 回调，再作为消息交给 YunZai 插件 |
| 链接 | `link` | 打开 HTTP/HTTPS 网页 |

`data` 或 `input` 始终构建普通指令按钮（`action.type: 2`），默认只把文本填入输入框；设置 `send: true` 或 `enter: true` 才立即发送。`callback` 始终构建回调按钮（`action.type: 1`），点击后触发互动事件，用户不发送聊天消息。私聊、群 @ 消息和群全量消息使用相同规则，不会根据会话类型自动转换动作。原生官方按钮按 `action.type` 保留动作，`action.data` 是所有动作共有的数据字段，不等同于简写的 `data`。按钮行最多 5 个按钮，键盘最多 5 行。显式 `mqqapi://aio/inlinecmd` 保留输入动作。

```js
[
  { label: '绑定 UID', data: '/绑定' }, // 填入输入框，等待补充 UID
  { label: '发送帮助', data: '/帮助', send: true }, // 用户发送聊天消息
  { label: '更新面板', callback: '/更新面板' } // 触发回调，由机器人执行
]
```

需要用户继续填写参数的输入按钮点击后只把命令放入输入框，不会立即执行。适配器会识别“绑定/切换 UID”“登录账号”“面板更换”等常见入口，并排除扫码、帮助和“换一批”等无需填写内容的操作。自定义按钮建议显式标记 `requiresInput: true`；`inputOnly`、`requires_input` 也可用：

```js
{
  label: '绑定 UID',
  data: '/绑定',
  requiresInput: true
}
```

如果某个输入按钮命令虽然包含上述关键词、但不需要补充参数，可设置 `requiresInput: false` 并配合 `send: true` 立即发送。此标记不会把显式 `callback` 改为输入按钮；需要补充参数时请使用 `data`。

回调点击会产生 `INTERACTION_CREATE` 事件。机器人先用事件体 `d.id` 确认互动，再用 Gateway 事件最外层的 `id` 作为消息接口的 `event_id` 被动回复。这两个 ID 不可混用，否则消息接口可能返回 `40034025`。该回复受官方被动回复时效和次数限制；脱离入站消息或互动上下文发送的消息按主动消息处理。参考[官方互动事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/interaction_create.html)和[单聊消息发送接口](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)。

开启斜杠前缀转换时，按钮命令 `/面板` 会作为 `#面板` 传给插件。想让插件收到字面量 `/面板`，让按钮的 `callback` 或 `data` 实际内容为 `\/面板`；在 JavaScript 源码中写作 `callback: '\\/面板'`。反斜杠在传给插件前会被移除，普通消息也遵循相同规则。

回调按钮只处理群消息和 C2C 私聊中的消息按钮/单聊快捷菜单互动；频道互动由 `QQGuild` 适配器处理。适配器会先确认互动，再把按钮数据作为一次 YunZai 消息交给对应场景的插件。按钮上下文中的 `e.reply()`、`e.markdown()` 和 `e.sendMsg()` 会继续使用这次互动的被动回复上下文；不要把互动事件体的 `d.id` 当作消息接口的 `event_id`。

## 独立按钮仓库与升级迁移

按钮库在 `plugins/button` 有自己的 `.git`，Lain-plugin 本体通过 `.gitignore` 排除整个目录，既不保存按钮文件，也不保存子模块指针。因此修改按钮不会阻塞本体的 `git pull` 或更新命令。`resources/button.bundle` 是首次安装的离线 Git 种子；本体更新不会使用新种子覆盖已有按钮仓库。

两个仓库分别提交和更新：在本体提交适配器与文档；用 `git -C plugins/button` 管理按钮改动。首次初始化的 origin 为 `https://github.com/win-syswow64/Lain-plugin-button.git`，不会指向本体仓库；已有仓库的 origin 保持原配置。需要使用个人分支时执行 `git -C plugins/button remote set-url origin <你的按钮仓库Git地址>`。单独更新按钮用 `git -C plugins/button pull --ff-only`，有已跟踪按钮冲突时由按钮仓库自行处理。

`example/demo.js` 提供输入、回调和链接按钮示例。个人文件放到 `example` 或其子目录，默认不被按钮仓库跟踪；需要发布时在按钮仓库执行 `git add -f example/文件名.js`，或在 example 子目录建立自己的仓库。所有自定义扩展仍须满足下文按钮类接口；普通 YunZai 消息插件应安装在 YunZai/plugins。

首次从旧版升级时，旧本体可能仍跟踪按钮文件。新的更新命令会先备份完整按钮目录及已暂存的按钮补丁，再清理本体中这些文件的改动；更新结束后恢复按钮并初始化独立仓库。备份保存在 `data/button-backups/`，不会删除你的旧文件。更新失败也会尝试恢复按钮。

手动 git pull 的旧安装需要先载入迁移脚本（适用于远程仓库已包含此版本）：

```bash
# 在 Lain-plugin 根目录，先获取脚本，不覆盖按钮。
 git fetch origin
 mkdir -p temp
 git show FETCH_HEAD:scripts/button-repository.js > temp/button-repository.mjs
 node temp/button-repository.mjs --prepare-update
 git pull --ff-only
 node scripts/button-repository.js
```

该过程只清理本体曾跟踪的 button 文件，其他本体修改仍由 Git 正常检查。迁移记录在 `data/button-migration.json`，不要在恢复前删除它或对应备份。已使用独立按钮仓库的安装不再需要此步骤。初始化失败时保留备份和暂存目录，并在日志中给出错误。

## 在插件代码中添加按钮

### `Bot.Button()`

```js
await e.reply([
  '请选择操作：',
  ...Bot.Button([
    { label: '签到', data: '#签到' },
    { label: '帮助', data: '#帮助' },
    { label: '项目主页', link: 'https://example.com' }
  ])
])
```

也可以用二维数组明确指定行：

```js
await e.reply([
  '常用功能',
  ...Bot.Button([
    [
      { label: '体力', data: '#原神体力' },
      { label: '面板', data: '#角色面板帮助' }
    ],
    [
      { label: '帮助', data: '#喵喵帮助' }
    ]
  ])
])
```

### `e.markdown()`

```js
await e.markdown('# 今日状态\n请选择下一步：', {
  buttons: [[
    { label: '刷新', data: '#刷新状态' },
    { label: '帮助', data: '#帮助' }
  ]]
})
```

`buttons` 或 `button` 已经提供按钮时，适配器不会再自动附加另一组规则按钮，避免重复。按钮字段也可使用 `text` 替代 `label`，使用 `visited_label` 设置点击后的显示文字；`style` 为样式数值，`Bot.Button()` 常用 `0`/`1`。

权限字段：

```js
{ label: '管理员操作', data: '#管理操作', admin: true }
{ label: '指定用户', data: '#用户操作', list: ['用户 OpenID'] }
```

`admin: true` 将按钮限制给管理员；`list` 只允许列表中的用户点击。官方权限仍受 QQ 平台和机器人权限配置约束。

### `Bot.Button.create()` 与 `Bot.Button.nav()`

适配器也提供保留二维行结构的按钮构造器，适合直接返回一个官方 `keyboard` 消息段：

```js
return Bot.Button.create([
  [
    { text: '上一页', data: '#上一页' },
    { text: '下一页', data: '#下一页' }
  ],
  [{ text: '打开主页', link: 'https://example.com' }]
])

// nav() 等价于只有一行的 create()
return Bot.Button.nav([
  { text: '返回', data: '#返回' },
  { text: '帮助', data: '#帮助' }
])
```

`create()` 返回带 `_isButton` 标记的 `keyboard` 段；发送时适配器最多保留 5 行、每行最多 5 个按钮。把它作为 `e.reply()` 消息的一部分传入时，适配器不会再叠加规则按钮。`Bot.Button()` 仍适合与旧版按钮扩展兼容。

## mqqapi 内联命令

Markdown 中的 `mqqapi://aio/inlinecmd` 链接会自动转换成 QQBot 原生输入按钮。点击时在当前会话发送 `command` 的内容，不会把自定义协议作为第三方应用外链打开。

```js
await e.markdown(
  '[设置免艾特](mqqapi://aio/inlinecmd?command=权限设置&reply=false&enter=true)'
)
```

适配器会显示“设置免艾特”作为按钮文字，并将 `权限设置` 作为输入内容。`enter=true` 表示点击后立即发送；`enter=false` 表示先填入输入框。这个显式内联命令即使在私聊或群全量模式下也保留输入动作。链接可带 URL 编码后的中文，`&` 查询参数也可以按 Markdown 原样书写。

`Bot.Button()` 和自定义扩展文件中的 `link` 如果填写同类 mqqapi 链接，也会转换成输入按钮。普通 HTTP/HTTPS 链接仍作为网页按钮发送。

发送 `#面板` 时，安装了 `miao-plugin` 的环境会使用其专属按钮扩展，显示“更新面板 / 绑定UID / 扫码绑定”和当前 UID 的本地面板角色按钮（最多 12 个）。miao 面板按钮同时兼容 `*角色面板`、`*更新面板`；ZZZ 按钮兼容 `%角色面板`。即使喵喵插件的回复自带一组按钮，`#面板` 也会以这组角色按钮为准。`#面板按钮示例` 才会显示仓库自带的四个通用演示按钮。

普通指令按钮和回调按钮不会使用第三方应用跳转动作。适配器只会对 `mqqapi://aio/inlinecmd` 做协议解析并转换为原生输入按钮；显式填写的 HTTP/HTTPS `link` 仍按网页链接处理。

官方按钮文档中，`enter` 控制指令按钮是否自动发送，`reply` 控制是否引用原消息，两者默认都是 `false`，需要支持这些字段的 QQ 客户端版本。普通指令按钮的 @ 和输入行为由客户端处理；需要点击后不产生用户聊天消息时，请明确使用 `callback`。

## 回调按钮测试

回调示例已整理为独立的 `plugins/button/archive-+1.js`，配套消息命令在 `apps/qqbot_button_test.js`。向 QQBot 发送 `#回调按钮测试`，回复底部应出现“测试回调 +1”；点击后应收到“回调按钮测试成功”。该示例在群聊和私聊都可用。群全量模式下，点击不会把机器人自己的 @ 段传给插件。

原始归档中的组件已按上游插件合并到仓库的 `plugins/button/`：喵喵、逍遥、绝区零、星铁、椰奶、原神、铃音和鸣潮各使用一个顶层扩展文件。同一文件内的原规则仍保留各自的优先级；没有重复归属的示例继续作为独立 `archive-*.js` 文件。原始压缩包无需下载或放入插件目录。缺少 `requiredPlugin` 指定的插件时跳过加载。含静态导入的扩展在文件首行使用 `// @requiredPlugin <目录名>`，以便加载器在导入前检查依赖。

## 创建自定义底部按钮文件

### 1. 创建文件

在 Miao-Yunzai 的 Lain-plugin 目录执行 `node scripts/button-repository.js` 初始化独立按钮仓库（首次启动也会自动初始化）。自定义文件放在 `plugins/button/example/`，可以创建任意层级的子目录。添加、修改或删除按钮文件时会热更新，无需重启 YunZai。目录示例：

```text
Miao-Yunzai/
└── plugins/
    └── Lain-plugin/
        └── plugins/
            └── button/
                └── miao-plugin.js
```

加载器读取 button 顶层的 `.js` 文件，并递归读取 example 下的 `.js` 文件。隐藏文件、隐藏目录和 node_modules 被忽略，example 以外的子目录不会加载。新增、修改和删除均支持热更新，包括启动后才创建的 example 子目录。文件必须默认导出一个构造函数。

### 2. 填写插件规则和按钮方法

下面的例子为 `miao-plugin` 的帮助回复增加操作按钮：

```js
export default class MiaoButtons {
  constructor () {
    this.plugin = {
      name: '喵喵插件按钮',
      dsc: '为喵喵帮助回复添加快捷入口',
      requiredPlugin: 'miao-plugin',
      priority: 100,
      rule: [
        {
          reg: '^#喵喵帮助$',
          fnc: 'help'
        }
      ]
    }
  }

  help (e) {
    return Bot.Button([
      [
        { label: '角色面板帮助', data: '#角色面板帮助' },
        { label: '更新面板', data: '#更新面板' }
      ],
      [
        { label: '喵喵版本', data: '#喵喵版本' }
      ]
    ])
  }
}
```

规则中的 `reg` 通常匹配当前事件的 `e.msg`，`fnc` 指向同一类中的方法。QQBot 自动附加按钮会保留适配器收到的原始非斜杠命令；如果上游插件把 `%`、`*` 或其他前缀的命令改写成 `#`，按钮仍按原始前缀匹配，避免误触发另一组按钮规则。方法返回 `Bot.Button(...)` 后，适配器会将按钮附加在当前回复底部。返回 `false` 或空值时不附加按钮，后续优先级规则仍可继续匹配。

### 3. 只在对应插件存在时加载

为插件专属按钮声明 `requiredPlugin`：

```js
requiredPlugin: 'miao-plugin'
```

适配器会检查 `Miao-Yunzai/plugins/miao-plugin` 目录。插件目录不存在时跳过这个按钮文件；该字段也可以是目录名数组。安装了插件后重启 YunZai，或重新保存按钮文件触发加载。

不依赖外部插件的自定义按钮可以省略 `requiredPlugin`。路径填写 Yunzai `plugins` 目录下的插件目录名，不要填写 `Lain-plugin/plugins/button`。

### 4. 设置匹配优先级

适配器按规则优先级从小到大检查，优先读取 `rule.priority`，未设置时使用所在按钮文件的 `plugin.priority`。第一个匹配并返回按钮的规则会提供这次回复的按钮；如果方法返回 `false` 或空值，则继续检查后面的规则。全局兜底规则应使用较大的优先级数值，并在方法中判断是否需要显示。

## 按钮字段参考

| 字段 | 用途 |
| --- | --- |
| `label` / `text` | 按钮显示文字 |
| `data` / `input` | 输入到当前会话的文本 |
| `send` / `enter` | 是否点击后立即发送输入文本 |
| `requiresInput` / `inputOnly` / `requires_input` | 输入按钮需要继续填写参数，强制关闭自动发送；可设为 `false` 覆盖自动判断，显式 `callback` 不受影响 |
| `callback` | 回调按钮的数据，触发 interaction 事件 |
| `link` | HTTP/HTTPS 网页地址；mqqapi inlinecmd 会转为输入按钮 |
| `style` | 样式数值；`Bot.Button()` 常用 `0` 灰色、`1` 蓝色，具体可用值以 QQ 客户端为准 |
| `visited_label` / `clicked_text` | 点击后的按钮文字 |
| `admin` | 仅管理员可点击 |
| `list` / `permission` | 限制可点击的用户 |
| `tips` / `unsupport_tips` | 客户端不支持时显示的提示 |

## 插件包内的按钮文件

也可以在插件包顶层使用 `lain.support.js` 导出同样的按钮类。此方式适合插件作者把扩展和自己的插件一起发布。个人配置或跨插件快捷入口建议放在 `plugins/button/example/<文件名>.js`，并用 `requiredPlugin` 声明目标插件。两种来源使用同一套 `plugin.rule` 和按钮构造方式。

## 排查

- QQBot 来源消息的 `e.reply()`、`e.markdown()` 都会检查自动按钮。启用 ICQQ 身份转译后，即使 `e.adapter` 显示兼容适配器名称，回复仍由 QQBot 发送并保留按钮。
- 回复中已经提供 `keyboard` 或 `button` 时，不再叠加规则按钮；`e.reply(msg, { markdown: true })` 也支持自动按钮。
- 检查 `rule.reg` 是否匹配当前 `e.msg`，以及 `fnc` 方法是否返回按钮。
- 检查目标插件的目录名是否与 `requiredPlugin` 完全相同。
- 顶层 `.js` 和 `example` 下任意层级的 `.js` 会加载；其他子目录、隐藏目录及 node_modules 不会加载。
- 点击后无响应时，确认按钮是输入动作且 `data` 是插件可识别的指令；回调动作则检查 QQBot interaction 事件权限。
- 回调按钮点击成功但机器人未回复时，查看日志中的“QQBot 按钮互动回应失败”或“QQBot 按钮命令处理失败”；回调回复使用官方互动 ID，并会按群聊或私聊消息交给插件。
- 同一 AppID 同时接入 QQ 群和频道时，按钮互动按官方 `scene` 分流；群和 C2C 按钮由 QQBot 适配器处理，频道按钮由 QQGuild 适配器处理。
- 回调上下文只在互动被确认后交给插件；`qqbot_interaction_id` 用于确认，`qqbot_event_id` 用于被动回复。若日志提示缺少 Gateway 事件 ID，需检查 SDK 是否保留了事件信封的 `id`。
