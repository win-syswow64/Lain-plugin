# QQBot 接入与使用

本文按 QQ 机器人官方“启动接入”文档同步，并补充 Lain-plugin 当前支持的群聊、C2C 私聊和配置方式。

> 官方页面显示更新时间为 **2026-07-21**。页面响应的 `Last-Modified` 为 **2026-09-24**；本文于 **2026-10-05** 核对。官方文档：[启动接入](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)。

## 官方接入准备

1. 在 [QQ 开放平台](https://q.qq.com/) 注册并创建机器人。
2. 在开发设置中获取机器人 `AppID` 与 `AppSecret`。`AppID` 是机器人 ID，`AppSecret` 用于申请访问凭证。
3. 按官方 [获取访问凭证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html) 文档使用 Access Token。官方已经废弃 `Token` 鉴权，不要再把旧 Token 当作当前鉴权凭证。
4. 按需选择官方 SDK 示例：[Go](https://github.com/tencent-connect/botgo)、[Python](https://github.com/tencent-connect/botpy)、[Node.js](https://github.com/tencent-connect/qqbot-nodejs)。SDK 只作为接入参考，能力和限制以 QQ 机器人官方文档为准。

## 在 Miao-Yunzai 中添加机器人

在 QQ 开放平台创建机器人后，在 Miao-Yunzai 控制台执行以下指令。请将示例值替换为自己的凭证，不要公开 AppSecret。

```text
#QQ群设置 0:1:你的AppID::你的AppSecret
```

配置格式：

```text
#QQBot设置 沙盒:私域:AppID:旧Token占位:AppSecret
```

- `沙盒`、`私域` 使用 `1` 或 `0`，沿用插件现有配置指令的字段顺序。
- 官方 Token 已废弃。适配器为兼容旧配置保留了第四个字段；无需填写时保留两个冒号，例如 `AppID::AppSecret`。
- `#QQBot设置` 同时连接 QQ 群与频道；`#QQ群设置` 只连接 QQ 群；`#QQ频道设置` 只连接频道。
- 默认群模式只订阅“群 @ 机器人”消息。需要收取机器人所在群的全量消息时，在配置末尾添加第 7 个字段 `1`，并确保开放平台已给机器人开通对应事件权限。例如：

  ```text
  #QQ群设置 0:0:你的AppID::你的AppSecret::1
  ```

  第 6 个字段是 WebHook 开关；没有使用 WebHook 时填 `0`，再用第 7 个字段启用群全量消息。`#QQBot账号` 会显示这一配置。
- 查询已添加账号：`#QQBot账号`。再次使用相同指令可删除对应账号配置，重启后生效。

凭证会写入 Lain-plugin 的 `config/token.yaml`。该文件包含密钥，请勿提交到公开仓库或粘贴到公开聊天中。

## 连接方式与高级配置

默认使用 WebSocket 长连接。若要使用 QQ 开放平台的 WebHook，在配置的第 6 个字段填入 `webhook`（也接受 `1`、`yes` 或 `on`）：

```text
#QQ群设置 0:1:你的AppID::你的AppSecret:webhook
```

WebHook 模式不启动 WebSocket，只保留 Access Token 刷新和 HTTP 事件接收。将 QQ 开放平台的回调地址指向实例的公开地址加 `/QQBot`，并确保反向代理保留 `X-Bot-Appid` 请求头；URL 验证和事件分发由适配器处理。公开部署时必须填写正确的 `AppSecret`，并只将 `/QQBot` 暴露给可信的回调入口。

设置命令中各字段的含义如下：

| 字段 | 含义 |
| --- | --- |
| 1 | 沙盒开关：`1` 开启，`0` 关闭 |
| 2 | 频道私域/公域模式：`1` 私域，`0` 公域；不代表QQ群全量消息 |
| 3 | `AppID` |
| 4 | 旧版 Token 占位字段，当前鉴权不再使用 |
| 5 | `AppSecret` |
| 6 | WebHook 开关；不用 WebHook 时填 `0` |
| 7 | 群全量消息开关；填 `1` 后额外订阅 `GROUP_MESSAGE_CREATE` |

也可以在 `config/token.yaml` 对已创建的账号设置高级选项，修改后重启生效：

```yaml
token:
  "你的AppID":
    maxRetry: 10       # WebSocket 连续失败重试次数；0 表示不限次数
    timeout: 10000     # OpenAPI 和文件分片请求超时，单位毫秒
    toCallback: true   # QQGuild 频道兼容选项；QQ群/C2C 的 callback 始终是回调
    other:
      Prefix: true     # 将 /命令转换为 #命令
```

`groupAllMsg` 只控制QQ群是否订阅全量消息；`allMsg` 控制的是频道消息范围。两者不要混用。

## 消息、Markdown 与媒体

QQBot 每个 AppID 可以单独选择消息格式。默认 `raw` 使用原生 Markdown；`legacy` 使用普通文本/媒体，按钮转为可复制的文字指令提示；模板模式使用已申请的模板 ID。`e.reply()`、`e.markdown()`、主动群/私聊发送以及回调回复共用同一发送策略。

由主人发送以下命令，配置立即生效并保存在 `config/config/token.yaml`。机器人标识可以填写 AppID 或通过 `#绑定机器人qq` 保存的机器人 QQ 号；在 QQBot 会话中可省略标识：

```text
#QQBotMD AppID:raw
#QQBotMD AppID:legacy
#QQBotMD AppID:模板ID:标题参数名,正文参数名
#QQBotMD AppID:template:模板ID:标题参数名,正文参数名
#QQBot小按钮 AppID:true
#QQBotmicro AppID:false
```

也可为对应账号填写 YAML：

```yaml
markdown:
  mode: raw              # raw / legacy / template
  templateId: "模板ID"   # template 模式必需；raw 失败时也可降级到此模板
  params: [title, text]   # 参数名，不是参数正文
smallbtn: false
```

模板参数按正文各行顺序填写，最后一个参数接收剩余正文，空参数使用空格填充。选择 raw 或 template 后，首选格式失败会重试一次，然后尝试已配置的另一种 Markdown 格式，最后降级普通文本/媒体；legacy 只重试普通格式。已发送成功的片段不会重复发送，超时等无法确定服务端是否已接收的错误不自动重发。只对成功发送的官方消息计数。模板和原生按钮仍需要账号对应权限。

```js
await e.markdown('# 查询结果\n已完成。')

await e.markdown('请选择操作：', {
  buttons: [[
    { label: '查看详情', data: '#详情' },
    { label: '返回帮助', data: '#帮助' }
  ]]
})
```

有关按钮自动附加、交互类型、mqqapi 内联命令转换，以及自定义底部按钮扩展文件，请看[QQBot 按钮使用与开发](./QQBot-Buttons.md)。

图片、语音和视频需要可供 QQ 平台访问的公网 URL。可通过 `Bot.imageToUrl`、`Bot.audioToUrl`、`Bot.videoToUrl` 提供自定义转换，也可按 Lain-plugin 配置启用公网临时文件服务。具体代码示例见仓库内的 `plugins/纯文模板.js` 和 `plugins/纯文模板-优化混排.js`。

## 白名单接口的异常处理

按当前官方文档的“仅白名单机器人可用”和“内邀接入”标记，适配器统一处理以下 7 个 API：

| 方法 | 接口 | 功能 |
| --- | --- | --- |
| GET | `/v2/groups/{group_openid}/info` | 群基本信息 |
| GET | `/v2/groups/{group_openid}/bot_state` | 机器人群内状态 |
| GET | `/v2/groups/{group_openid}/members` | 成员列表 |
| GET | `/v2/groups/{group_openid}/members/{member_openid}` | 成员详情 |
| POST | `/v2/groups/{group_openid}/batch_remove_members` | 批量移除成员 |
| GET | `/v2/groups/{group_openid}/member_blacklist` | 查询黑名单 |
| POST | `/v2/groups/{group_openid}/member_blacklist` | 操作黑名单 |

统一策略处理 HTTP 请求失败及 HTTP 200 中的非零业务错误码，不会把异常响应当作成功数据。同一机器人、方法、接口与错误每分钟记录一份样例，日志前缀为 `[QQBot 白名单接口异常留样]`，包含 AppID、接口模板、错误码、可取得的 HTTP 状态、错误文字与追踪 ID；不记录凭据、请求体或成员资料。

接收消息时查询群状态属于可选接口，失败返回未知状态，消息仍正常分发。失败状态短暂缓存 10 秒，避免每条消息重复请求。功能必须依赖该接口时，例如查询管理员身份、禁言前确认权限、主动消息或文件发送前确认推送权限，调用仍会失败，并返回可由插件回复的错误信息。官方 `11253` 或明确的白名单拒绝文字会转换为“账户不在接口白名单内，无法使用该功能（方法 接口）”；网络故障、限流、字段不完整及普通权限不足保留各自原因，不误报白名单。

```js
// 可选状态查询：失败返回 null，只记录日志。
const state = await bot.getGroupBotState(groupOpenid, { required: false })
if (state) console.log(state.recv_msg_setting)

// 功能必需的查询：插件应把返回的错误文字通过当前消息上下文回复。
try {
  const isAdmin = await e.group.is_admin()
  await e.reply(isAdmin ? '机器人是群管理员' : '机器人不是群管理员')
} catch (error) {
  await e.reply(error.message)
}
```

自定义 SDK 调用中，可选白名单请求可以传 `qqbotOptional: true`。失败响应为 `{ data: null, qqbot_api_error: Error }`，必须先检查错误或空数据；未标记可选的调用默认属于功能必需调用，失败拒绝 Promise。该选项只作用于上表 API，普通消息、上传、撤回及其他接口保留原有错误处理。

```js
const response = await bot.sdk.request.get(
  `/v2/groups/${groupOpenid}/info`,
  { qqbotOptional: true }
)
if (response.data) console.log(response.data.group_name)
```

接口范围和错误码依据官方[群基本信息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_info.get.html)、[群内状态](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html)、[成员列表](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members.get.html)、[成员详情](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members_member_openid.get.html)、[批量移除](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_batch_remove_members.post.html)、[黑名单查询](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_member_blacklist.get.html)与[黑名单操作](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_member_blacklist.post.html)。入群自动审批策略中的 QQ 号码白名单是群管理数据，与这里的接口访问白名单不同。

## 群成员进退群通知

群聊模式自动订阅 `GROUP_MEMBER_EVENT (1 << 24)` 和 `GROUP_AND_C2C_EVENT (1 << 25)`，WebSocket 与 WebHook 都使用同一解析路径。

| 官方事件 | ICQQ / YunZai 通知 | `user_id` 的含义 |
| --- | --- | --- |
| `GROUP_MEMBER_ADD` | `notice.group.increase` | 加入的成员 |
| `GROUP_MEMBER_REMOVE` | `notice.group.decrease` | 离开的成员 |
| `GROUP_ADD_ROBOT` | `notice.group.increase` | 机器人自身 |
| `GROUP_DEL_ROBOT` | `notice.group.decrease` | 机器人自身 |

通知包含 `post_type: 'notice'`、`notice_type: 'group'`、`sub_type`、`group_id`、`user_id`、Unix 秒级 `time` 和可调用的 `group` 对象。`qqbot_event_type` 保留官方事件名，`qqbot_is_robot_change` 表示是否为机器人自身进退群。机器人事件的 `op_member_openid` 只映射为 `operator_id`，不会被误当成进退群成员；成员事件没有操作人字段时不猜测操作人，也无法据此区分主动退群和被踢。

原始 `group_openid`、`member_openid`、`user_openid`、`operator_openid` 和 `raw` 均保留。成员身份使用 `member_openid`，不把可能为空的 `user_openid` 当作 C2C 可用身份。未启用身份转译时使用 AppID 加 OpenID 的标识；群已启用 ICQQ 身份转译且有保存的映射时，群、机器人、成员与操作人分别转换为已知 QQ 号，未知成员仍保留 OpenID 标识。通知不进入消息配对或消息插件执行层。

只有机器人进退群才更新机器人群列表；普通成员退群不会删除机器人所在群。插件可以监听 `notice.group.increase` 或 `notice.group.decrease`，通过 `e.qqbot_is_robot_change` 区分对象，并用 `e.group.sendMsg()` 或 `e.reply()` 发送消息。通知中的发送采用主动群消息规则，需群开启主动推送并通过权限检查。

参考官方[机器人加入群聊](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_add_robot.html)、[机器人退出群聊](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_del_robot.html)、[群成员加入](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_member_add.html)和[群成员退出](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_member_remove.html)。

## QQ 群全量消息与 @ 机器人消息

QQBot 将 `GROUP_AT_MESSAGE_CREATE`（群 @ 机器人）和 `GROUP_MESSAGE_CREATE`（群全量消息）作为不同 Gateway 事件处理。适配器把原始事件名保存在 `e.qqbot_event_type`，并提供 `e.qqbot_is_group_at`、`e.qqbot_is_group_all` 两个布尔值。`e.atme` 表示这条消息调用了机器人。

收到群消息时，适配器调用官方 `GET /v2/groups/{group_openid}/bot_state`，并在事件上设置 `e.qqbot_group_state`、`e.qqbot_recv_msg_setting`（`all`、`only_mention` 或 `mention_and_context`）和 `e.qqbot_allow_proactive_msg`。状态短暂缓存 15 秒，避免超过官方 30 QPM 限制。该查询在接收消息时是可选操作：接口未开放、网络错误或返回字段不完整时只在日志中留样，继续分发消息；接收类型按 Gateway 事件回退判断，不伪造主动推送权限或管理员身份。该接口仅对获白名单权限的机器人开放。

按钮由定义字段决定动作：`data` / `input` 是普通可输入按钮，默认不立即发送；`callback` 是回调按钮，点击后用户不发送聊天消息。私聊和群聊均保留作者指定的动作，不因 `recv_msg_setting` 自动转换。原生官方按钮保留 `action.type`，mqqapi 内联命令保留输入动作。回调事件在兼容层中标记 `atme=true`，但消息数组不会传入一个指向机器人自己的 `at` 段。回调回复使用 Gateway 最外层事件 ID，属于被动回复；互动事件体的 `d.id` 只用于 PUT 确认。主动调用 `Bot[appid].pickGroup(groupOpenID).sendMsg(...)` 时先检查 `allow_proactive_msg`，未开启或无法查询时抛出明确错误；被动回复仍使用消息或事件 ID。

开启 `other.Prefix` 后，入站消息和按钮回调开头的 `/命令` 会转换成 `#命令`。需要保留斜杠时，在前面输入反斜杠：`\/命令` 会传给插件为 `/命令`。这个反转义在 `other.Prefix` 关闭时也可用。回调在 ICQQ 身份兼容层中只向插件传递一次命令文本。

群 @ 事件自身已经表示“@ 机器人”。适配器会从供插件使用的 `e.message` 中移除机器人自己的 at 段，避免 ICQQ 兼容层再次将它识别成普通 @ 目标；消息正文、`e.atme` 和其他用户的 at 段仍然保留。全量消息不设置 `e.atme`，除非消息内容确实包含机器人 mention。

只有开放平台授予全量群消息权限后，`groupAllMsg` 配置才能收到全量事件。不开启该选项时仍接收群 @ 机器人消息。

### 事件字段速查

QQBot 事件会保留官方 OpenID，同时把未完成映射的 ID 格式化为 `<AppID>-<OpenID>`，便于多个 QQBot 账号共存。常用字段如下：

| 字段 | 说明 |
| --- | --- |
| `e.qqbot_event_type` | 原始 Gateway 事件名，如 `GROUP_AT_MESSAGE_CREATE`、`GROUP_MESSAGE_CREATE` 或 `C2C_MESSAGE_CREATE` |
| `e.qqbot_event_id` | 官方事件 ID；回调按钮消息中是 Gateway 信封最外层的 `id`，可用于被动回复 |
| `e.qqbot_interaction_id` | 仅回调按钮存在，对应互动事件体 `d.id`，只用于确认 interaction |
| `e.qqbot_is_group_at` / `e.qqbot_is_group_all` | 是否来自群 @ 事件或群全量事件 |
| `e.qqbot_recv_msg_setting` | 群接收范围：`all`、`only_mention` 或 `mention_and_context` |
| `e.qqbot_allow_proactive_msg` | 当前群是否允许主动发消息 |
| `e.qqbot_group_state_error` | 查询群状态失败时的错误文本 |
| `e.user_openid` / `e.member_openid` / `e.group_openid` | 官方 C2C 用户、群成员和群 OpenID |

群 @ 事件已经表达了“机器人被调用”，所以适配器会设置 `e.atme=true` 并从供插件使用的 `e.message` 移除机器人自己的 at 段；其他用户的 at 段仍然保留。回调按钮同样设置 `atme=true`，但不会伪造机器人 at 消息段。

## C2C 私聊 API

QQ 机器人 C2C 私聊使用 `user_openid`，群聊使用 `member_openid`。两种 OpenID 不能按字符串相同处理；适配器会保留完整 OpenID，包括其中可能出现的连字符。私聊 OpenID 已绑定 QQ 号及机器人 QQ 号时，事件会按 ICQQ 兼容结构呈现；未绑定时仍使用带 AppID 前缀的 QQBot 用户 ID。

需要私聊身份转译时，在与机器人单聊中发送 `#绑定qq<自己的QQ号>`，并用 `#绑定机器人qq<机器人QQ号>` 建立机器人身份映射。后续私聊事件会保留 `e.user_openid` 和 QQBot 回复接口，同时提供数字 `e.user_id`、`e.self_id`、ICQQ 风格的 `e.sender` 和 `e.friend`。如果 C2C 与群聊使用同一个 OpenID，已有群用户映射也可在收到私聊时复用；如果 OpenID 不同，需要在私聊里单独绑定。两侧适配器都收到同一条已映射私聊消息时，转译层会按发送者、正文和时间窗口去重。

适配器支持 C2C 消息收发、被动回复、私聊撤回、文件上传、输入状态通知和流式 Markdown 消息：

```js
// e.friend 来自这条 C2C 入站消息，sendMsg 使用该消息的被动回复上下文。
await e.friend.sendMsg('收到，正在查询。')

// 输入状态通知：提示客户端机器人正在输入。
await e.friend.sendInputNotify({ inputSecond: 30 })

// 流式内容通过完整快照替换；update 会按间隔合并请求。
const stream = e.friend.openStream()
await stream.update('# 查询中\n正在读取数据…')
await stream.update('# 查询中\n找到 3 条结果…')
await stream.complete('# 查询完成\n共找到 3 条结果。')

// 也可用 OneBot 兼容文件入口发送文件。
await e.friend.sendFile('/path/to/report.pdf', 'report.pdf')
```

`openStream()` 需要来自 C2C 入站消息的上下文；从 `Bot[appid].pickFriend(openid)` 主动取得的好友对象没有该上下文，不能直接创建被动流。流式更新是 Markdown 全量快照，默认节流 500ms，最短 300ms；`complete(text)` 发送最终快照并结束流，结束后不能继续更新。

C2C 主要接口和行为：

- 普通私聊消息：`POST /v2/users/{openid}/messages`。`msg_type` 支持文本 `0`、Markdown `2`、Ark `3`、Embed `4`、媒体 `7`；输入状态通知使用 `msg_type: 6`。
- 回复使用前置消息的 `msg_id` 与 `msg_seq`；按钮交互、C2C 接收许可通知和好友添加通知可使用官方允许的 `event_id`。`message_reference` 目前不支持，适配器不会把它发给 C2C 接口。
- 流式回复：`POST /v2/users/{openid}/stream_messages`，适配器按官方 `input_mode: "replace"` 协议更新同一条消息，并在结束时发送 `input_state: 10`。
- 撤回：`DELETE /v2/users/{openid}/messages/{message_id}`。
- C2C 文件使用 `/files`、`/upload_prepare` 与 `/upload_part_finish` 上传流程，发送消息时携带 `msg_type: 7` 和 `media.file_info`。
- 私聊入站消息的 `e.reply()`、`e.friend.sendMsg()` 使用消息 ID 被动回复；按钮交互和好友通知可使用 `event_id` 回复。主动调用 `Bot[appid].sendPrivateMsg()` 或无入站上下文的 `pickFriend().sendMsg()` 不带被动回复 ID。
- C2C 私聊不支持 Markdown 的 `<qqbot-at-user />` 和 `<qqbot-at-everyone />`。适配器会在私聊回复中省略 `at` 消息段对应的标签，并在发送前清理插件直接提供的此类标签；其余文字、图片和按钮照常发送。群聊仍保留 @ 功能。
- 私聊被动回复窗口为 60 分钟，每条入站消息最多被动回复 4 次。主动发送受平台频率、用户设置和机器人权限限制；消息类型、权限及限制请以官方发送消息文档为准。

流式协议和输入状态通知由 QQ 官方 Node SDK 的当前实现提供参考；如平台修改字段或限制，请以 [官方 C2C 消息 API 文档](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)、[官方单聊事件文档](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html)、[官方流式会话实现](https://github.com/tencent-connect/qqbot-nodejs/blob/main/src/streaming.ts) 与 [腾讯 QQBot Node.js SDK](https://github.com/tencent-connect/qqbot-nodejs) 为准。

## 消息引用、缓存与撤回

适配器会把带有官方 `msg_idx` 和消息 ID 的入站消息写入 Redis，缓存时间为 12 小时。以下接口优先读取这份缓存：

- `Bot[appid].getMsg(messageId)`；
- `e.group.getMsg(messageId)`、`e.friend.getMsg(messageId)`；
- `e.group.getChatHistory(messageId, num)`、`e.friend.getChatHistory(messageId, num)`。

QQ 官方暂未提供可等价替代的历史消息接口，因此 `getChatHistory` 目前只会返回命中的锚点消息，不会拉取完整历史。`e.recall()`、`e.group.recallMsg()` 和 `e.friend.recallMsg()` 可撤回对应消息；引用消息的 `ref_msg_idx` 会在缓存命中后恢复为真实消息 ID。Redis 不可用时不影响正常收发，但跨进程的引用和缓存查询可能失败。

引用撤回与撤回测试统一由 `apps/recall.js` 处理，使用 `e.group.recallMsg()` / `e.friend.recallMsg()`，不直接访问 QQBot SDK。引用机器人消息发送 `#撤回` 或 `#引用撤回`；无引用发送 `#测试撤回` 会发送测试消息并立即撤回，有引用时撤回被引用消息。旧命令 `#QQBot测试撤回`、`#QQBot撤回测试` 仍可使用，命令不再限制适配器。原生 ICQQ 的引用保留 `seq/rand/time/pktnum`，其他适配器优先使用实际消息 ID。实际撤回仍受平台权限和时间限制约束，不支持撤回的适配器会明确报错。

QQBot 发送成功后会缓存响应中的 `ext_info.ref_idx` 与真实消息 ID 的映射，支持后来引用机器人消息撤回；引用索引缓存未命中时明确报错，不会直接将索引交给撤回 API。开启 ICQQ 转译时，群对象仍保留 QQBot 的撤回、禁言和消息缓存接口。撤回测试仅允许群主、管理员或机器人主人使用，私聊仅允许机器人主人。官方撤回时限为 2 分钟；群聊机器人为管理员时可撤回普通成员消息，普通机器人只可撤回自己的消息；C2C 只支持撤回机器人发送的消息。详见[官方群聊撤回](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages_message_id.delete.html)和[官方单聊撤回](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages_message_id.delete.html)。

## QQ 与 QQBot 用户映射

转换记录按机器人、群和成员 OpenID 保存。用户有映射时，适配器会在该群的 QQBot 事件和 ICQQ 事件间建立对应关系。

- 一条消息中即使只有部分 @ 目标已有映射，已保存的目标仍会转换为 QQ 号。
- 未映射的 @ 目标保留为原始 OpenID；它不会阻断已映射目标的转换。
- 发言用户尚未映射时，仍会尝试将消息中已映射的 @ 目标转换；消息与 QQ 侧事件匹配后会补充发言用户映射。
- 发言用户已映射但 @ 目标未映射时，发言用户和群仍按已有映射转换，未映射目标保留原 ID。

这允许未转换状态用户 @ 已保存转换信息的用户，也允许已转换用户 @ 尚未保存转换信息的用户。

## QQ 群管理

QQ 群机器人可以使用官方 API v2 查询入群申请、审批申请、管理禁言规则。禁言和查询禁言前会先查询 `bot_state.member_role`，确认机器人具有群管理员身份；禁言请求不再调用官方群成员详情接口做前置校验，因为该接口目前仍处于内邀阶段。目标为群主、管理员或机器人时，由官方禁言接口拒绝操作。群禁言最长 30 天，批量一次最多 20 人。

仓库提供禁言测试 Demo：群内由主人发送 `#禁言测试 @成员`，默认禁言 60 秒；也可以发送 `#禁言测试 120 @成员` 或 `#QQBot禁言测试 120 @成员` 指定秒数，`#禁言测试 0 @成员` 解除禁言。命令从消息中的 `at` 段获取第一个非机器人的目标成员，统一调用 ICQQ 风格的 `e.group.muteMember(成员ID, 秒数)`，支持提供此接口的群聊适配器。QQBot 仍由适配器查询官方 API 验证机器人管理员权限、转换成员 OpenID 并执行禁言；白名单或权限不足时回复失败原因。

禁言接口兼容 ICQQ/OneBot 风格的数字 QQ 号：`group.muteMember(1004148094, 60)` 或 `bot.setGroupMemberMute(群号, QQ号, 60)` 会根据当前群映射自动转换为 QQBot OpenID；数字时长会在权限检查和映射完成后计算，避免网络耗时被计入禁言时间。如果当前群没有该 QQ 号的映射，会返回明确的绑定提示。

```js
const bot = Bot['机器人 AppID']
const group = bot.pickGroup('群 OpenID')

// 群权限方法查询的是机器人自身在群内的角色；群主同时属于管理员
const isAdmin = await group.is_admin()
const isOwner = await group.is_owner()

// 禁言 10 分钟；传 0 解除禁言
try {
  await group.muteMember('成员 OpenID', 600)
} catch (error) {
  await e.reply(error.message)
}

// 查询机器人在群内的官方状态
const state = await group.getBotState()
// state.member_role / state.recv_msg_setting / state.allow_proactive_msg

// 获取禁言状态
const status = await group.getMuteStatus()

// 查看待处理入群申请
const { list, next_cursor } = await group.getJoinRequests({ limit: 20 })

// 审批申请
await group.approveJoinRequest('成员 OpenID', true, {
  join_request_id: list[0].join_request_id
})
```

收到入群申请时，适配器会发送兼容事件 `request.group.add`，可用 `e.approve(true)` 同意申请。主人也可在 QQ 群或私聊中使用：

```text
#QQBot入群申请列表 [单页数量] [cursor]
#QQBot审批入群申请 <成员OpenID> <同意|拒绝> [申请ID] [理由]
```

在非目标群或私聊中操作时，首个参数使用群 OpenID：

```text
#QQBot入群申请列表 <群OpenID> [单页数量] [cursor]
#QQBot审批入群申请 <群OpenID> <成员OpenID> <同意|拒绝> [申请ID] [理由]
```

拒绝申请时，可在理由中加入 `--拉黑`，同时把成员加入群黑名单；只有拒绝操作支持该选项。命令也兼容 `#QQ群加群申请...` 和 `#QQBot处理入群申请...` 形式。

适配器还暴露自动审批策略 API，供插件直接调用：

```js
const bot = Bot['机器人 AppID']
await bot.getJoinApprovalStrategies({ limit: 20 })
const strategy = await bot.createJoinApprovalStrategy({
  group_openids: ['群 OpenID'],
  whitelist_users: ['QQ号']
})
await bot.updateJoinApprovalWhitelist(strategy.strategy_id, 'add', ['另一个QQ号'])
await bot.executeJoinApprovalStrategy(strategy.strategy_id)
await bot.updateJoinApprovalStrategy(strategy.strategy_id, { enable: true })
await bot.deleteJoinApprovalStrategy(strategy.strategy_id)
```

创建策略时 `group_openids` 与 `group_ids` 必须二选一，最多关联 100 个群；白名单单次最多 10000 个 QQ 号。执行后会异步扫描关联群的申请。

官方文档显示，群成员列表与成员详情接口目前处于“内邀接入中”，不能作为禁言的前置校验；适配器只使用 `/bot_state` 检查机器人自身的群角色，然后直接调用设置成员禁言接口，由 QQ 官方完成目标成员权限校验。`/bot_state` 仍属于白名单能力，未获权限时会报告接口错误；可查看[启动接入](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)、[机器人群内状态](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html)、[群成员详情](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members_member_openid.get.html)、[设置成员禁言](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_restrict_chat_setting.post.html)及[群消息发送](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)。

QQBot 的 `pickGroup()` 在原生事件和 ICQQ 兼容事件中都提供异步 `is_admin()`、`is_owner()` 方法，依据 `/bot_state.member_role` 判断机器人权限；接口未授权或查询失败时方法会抛出错误，调用方应使用 `try/catch` 处理。

## DAU 与 yenai-plugin 统计

- `#QQBotDAU`：查询当前群的接收消息、成功发送消息和成功发送图片数量。
- `#QQBotDAUPro`：主人查询所有 QQBot 账号的总计、各群窗口及每日统计记录；可追加 AppID 或已绑定机器人 QQ 号限定账号。
- 群统计从首次计数起保留 24 小时；账号总计从首次计数起保留 30 天，每日记录各保留 30 天。窗口内递增不延长过期时间，Redis 自动删除，到下一条消息再创建新窗口。采用固定保留窗口，不是永久累加，也不是精确滚动的“过去 24 小时”。
- 接收的是官方真实消息，按钮回调不计作用户发消息；重试失败、媒体上传、输入状态通知不增加发送消息量，流式回复只计一条。Markdown 中的图片也进入图片计数。
- 开关仍为 `config/config/Config-other.yaml` 中的 `QQBotdau: true`。新统计不再写无限保留的月度 JSON 文件，旧文件不参与查询。

Redis 中的统计记录使用 `lain:qqbot:dau:v2:<AppID>:total`、`:group:<群OpenID>` 和 `:day:<日期>`。同时维护 yenai-plugin 查询的字符串键，镜像账号当前总计，并按总计窗口剩余时间自动过期：

```text
Yz:count:send:msg:bot:<机器人ID>:total
Yz:count:receive:msg:bot:<机器人ID>:total
Yz:count:send:image:bot:<机器人ID>:total
```

机器人 ID 包含 AppID 和已绑定的数字机器人 QQ 号，保证原生 QQBot 与 ICQQ 转译后的 `bot.uin` 都能查询。计数通过 Redis Lua 原子递增，并发消息不会因读写覆盖丢失。

## ws-plugin 群成员列表

Lain-plugin 不再跟踪 `ws-plugin/` 和 `22009-plugin/` 目录，保留已有本地插件及独立仓库；兼容补丁仍随本体维护。

`get_group_member_list` 对 QQBot 只读取目标群已绑定 QQ 的成员，每名成员返回一个对象；其他群成员、没有 QQ 绑定的用户不会进入结果，没有匹配成员时 `data: []`。无需启用成员列表转译开关，也不调用官方成员列表 API。

响应由 ws-plugin 包装为 `{ status: 'ok', retcode: 0, data: [...] }`，保留请求的 echo。字段遵循 OneBot 类型：`group_id/user_id` 为数字，昵称/群名片/角色使用已缓存的资料，其他不支持的字符串使用一个空格、普通数值为 0、布尔值为 false；`join_time/last_sent_time/title_expire_time` 缺失时使用当前 Unix 秒时间戳。

对应兼容补丁在 `patches/ws-plugin-qqbot.patch`，包含 `model/api.js`、`model/makeMsg.js` 和新增的 `model/groupMembers.js`。ws-plugin 是独立 Git 仓库，应将补丁应用到实际安装目录，不能只更新 Lain-plugin 后期待 ws-plugin 文件自动更新。

## 大文件与分片上传

群聊、C2C 私聊共用同一上传入口。普通文件、图片、视频、语音均检查实际字节数，来源支持本地路径、Buffer、base64 和 HTTP/HTTPS URL。阈值按 `5 * 1024 * 1024` 字节（5MiB）计算：不超过阈值使用 `/files` 的 `file_data` 二进制直传；超过阈值一律使用官方分片流程，URL 也先下载核实大小，不仅依赖 Content-Length。

1. 调用对应会话的 `/upload_prepare`，传入 `file_type`、文件名、大小、完整 MD5/SHA1，以及前 10002432 字节的 MD5。
2. 按返回的分片大小和序号 PUT 到预签名 URL，每片成功后调用 `/upload_part_finish`；失败按服务端给出的重试超时和延迟重试。兼容服务端从 0 或 1 开始的连续分片序号，完成通知透传原序号；重复、缺失或不连续的序号会返回错误。
3. 全部分片完成后调用 `/files`，携带 `upload_id` 合并取得 `file_info`；上传阶段使用 `srv_send_msg: false`。
4. 通过该会话的消息接口发送 `msg_type: 7` 和 `media.file_info`，保留原有的 `msg_id/event_id` 回复上下文。

官方硬限制为 200MiB，超过直接报错。图片/语音超过 20MiB、视频超过 30MiB 时按官方软限制降级为普通文件上传。下载和上传都按实际大小检查，未知长度的 URL 不会绕过限制。

Markdown 中的大图片也分片上传，并使用合并响应的 `raw_url` 显示；遇到软限制降级或没有可用 `raw_url` 时，以附件发送并保留正文提示。legacy 模式的大媒体、普通文件及 C2C 流式回复中的大图片也使用此流程。文件必须可由机器人服务器读取；本地无法下载的 URL 会回复上传失败原因。

协议依据：[官方群富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html)、[官方单聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html)、[群预上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_prepare.post.html)与[单聊预上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html)。

## 相关文档

- [QQBot 按钮使用与开发](./QQBot-Buttons.md)
- [官方启动接入](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)
- [官方获取访问凭证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)
- [官方发送消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html)
- [腾讯 QQBot Node.js SDK](https://github.com/tencent-connect/qqbot-nodejs)
