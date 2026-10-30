# Lain-plugin

Lain-plugin 是为 [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) 提供多平台接入的适配器插件。本仓库在原项目基础上维护了 QQBot API v2、群聊与 C2C 私聊、ICQQ 身份转译和按钮扩展等功能。

## 安装

在 `Miao-Yunzai` 根目录执行：

```bash
git clone --depth=1 https://github.com/win-syswow64/Lain-plugin.git ./plugins/Lain-plugin
pnpm install -P
```

如果只使用本插件接入机器人，无需登录 ICQQ，可在 `config/config/bot.yaml` 中设置 `skip_login: true`。请先安装并启动所需平台的连接端，再按对应文档配置账号。

| 适配器 | 接入说明 |
| --- | --- |
| QQBot（QQ群、频道、C2C 私聊） | [QQBot 接入与使用](./docs/QQBot.md) |
| PC 微信 | [WeChat](./docs/WeChat.md) |
| 网页版微信 | [WeXin](./docs/WeXin.md) |
| Shamrock | [Shamrock](./docs/Shamrock.md) |
| Lagrange.Core | [Lagrange.Core](./docs/Lagrange.Core.md) |
| LLOneBot、NapCat 等 OneBot 连接端 | 启用反向 WebSocket，地址为 `ws://localhost:2955/LLOneBot`；[LLOneBot 项目](https://github.com/LLOneBot/LLOneBot) |

插件还包含标准输入、QQ 频道、KOOK、Discord 等适配器。标准输入可在控制台输入 YunZai 指令，默认以主人身份执行；需要自定义状态头像时，将图片放在 `plugins/Lain-plugin/resources/avatar.jpg`。

## QQBot 主要功能

- 使用官方 API v2 接入 QQ 群、频道与 C2C 私聊。群消息可订阅“@ 机器人”或全量事件，并保留事件类型供插件判断。
- 支持 WebSocket 与 WebHook 两种 QQBot 连接方式；WebHook 回调入口为 `/QQBot`，群全量消息和频道私域模式分别配置。
- 在获得官方接口权限时，查询群接收类型和主动推送状态；可选白名单接口失败只留日志，功能必需接口被拒绝时返回账户不在接口白名单内的提示。发送主动群消息及禁言前检查权限。
- 按 AppID 选择 raw、legacy 或模板消息，支持失败重试和格式降级；支持全局及单条消息的小按钮（micro）。
- 提供 C2C 收发、文件、撤回、输入状态和流式 Markdown 回复，并缓存消息引用。私聊也可使用 ICQQ 身份转译。
- 支持群入群申请查询/审批、拒绝拉黑和自动审批策略 API。
- 将机器人及成员进退群事件转换为 ICQQ 的 `notice.group.increase` / `notice.group.decrease` 通知，并使用已保存的身份映射。
- 群聊和私聊可使用原生按钮、回调按钮和自定义底部按钮文件；`data` 默认填入输入框，`callback` 触发回调。缺少目标插件时跳过其专属按钮。Markdown 中的 `mqqapi://aio/inlinecmd` 会转换为原生输入按钮。
- 保存 QQ 与 QQBot 的身份映射；混合已映射和未映射用户时仍可转换已知的 @ 目标。
- 群收发统计使用 Redis 24 小时窗口，总计和每日记录保留 30 天；兼容 yenai-plugin 的收发及图片计数。`#QQBotDAU` 查询当前群，主人使用 `#QQBotDAUPro` 查询全部保留记录。
- ws-plugin 的 QQBot 成员列表从本地 QQ 绑定记录返回，缺少绑定时返回空数组，不请求官方受限成员接口。

接入指令、配置字段、平台权限及代码示例见 [QQBot 接入与使用](./docs/QQBot.md)。按钮格式、测试指令和自定义文件写法见 [QQBot 按钮使用与开发](./docs/QQBot-Buttons.md)。

## 按钮扩展

`plugins/button/` 现在是[独立 Git 仓库](https://github.com/win-syswow64/Lain-plugin-button)，本体不再跟踪按钮文件。首次启动会从 `resources/button.bundle` 离线初始化，保留已有按钮文件并备份；已有独立仓库不会被本体更新覆盖。每个目标插件仍对应一个顶层 `.js` 文件，缺少目标插件时跳过加载。

个人自定义按钮放在 `plugins/button/example/`，允许创建子目录，新增、修改、删除会热更新。个人文件默认由按钮仓库忽略，更新本体不会受按钮修改影响。

```bash
# 在 Lain-plugin 目录手动初始化或检查独立仓库
node scripts/button-repository.js
git -C plugins/button status

# 单独更新按钮库
 git -C plugins/button pull --ff-only
```

本体的 `#铃音更新` / `#Lain更新` 只更新本体，不执行按钮仓库的 pull。不要在本体中重新跟踪 `plugins/button/`。独立仓库说明在 `plugins/button/README.md`，按钮接口、旧安装迁移和示例见[开发文档](./docs/QQBot-Buttons.md)。

发送 `#回调按钮测试` 可查看仓库自带的回调按钮示例，点击“测试回调 +1”后会收到确认回复。

撤回测试已统一：引用机器人消息发送 `#撤回`（或 `#引用撤回`）；发送 `#测试撤回` 会发送一条测试消息并撤回，带引用时则撤回引用消息。`#QQBot测试撤回` 和 `#QQBot撤回测试` 保留为别名。群聊、私聊及各适配器统一调用 ICQQ 风格的 `recallMsg`；适配器不支持或平台拒绝撤回时会回复失败原因。

## 常用指令

- `#设置主人`：按控制台验证码设置主人；已有主人可用 `#设置主人@用户` 指定其他主人。
- `#取消主人@用户` 或 `#删除主人@用户`：移除指定主人。
- `#铃音更新` 或 `#Lain更新`：更新插件。

插件可通过 `e.adapter` 或 `Bot[uin].adapter` 判断适配器。常见值包括 `QQBot`、`QQGuild`、`LagrangeCore`、`LLOneBot`、`shamrock`、`ComWeChat`、`WeXin`、`Kook`、`Discord` 和 `stdin`。

## 致谢

[Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai)、[原 Lain-plugin](https://github.com/Circle-money-run/Lain-plugin)、[ws-plugin](https://gitee.com/xiaoye12123/ws-plugin)、[OpenShamrock](https://github.com/whitechi73/OpenShamrock)、[LLOneBot](https://github.com/LLOneBot/LLOneBot)、[Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core)、[Yunzai-Kook-Plugin](https://github.com/TimeRainStarSky/Yunzai-KOOK-Plugin)、[XZhouQD-Lain](https://github.com/XZhouQD/Lain-plugin) 及其他贡献者。
