# 这里是一处Lain-Plugin备份仓库，有一定修改
## 简介
`Lain-plugin`是一个围绕喵崽`Miao-Yunzai`开发的多适配器插件，让喵崽接入`QQ频道`、`微信`、`shamrock`、`KOOK`等三方平台~，不再局限于ICQQ。


### 适用于`Lain-plugin`的`QQBot`适配器的统计插件:[22009-plugin](https://gitee.com/zzwh12/22009-plugin)

## 使用
### 0. 前置：跳过云崽的ICQQ登录
不想登录ICQQ并继续使用本插件：

- 更新喵崽到最新
- 打开喵崽的`config/config/bot.yaml`文件将 `skip_login: false` 修改为 `skip_login: true`
- 如果不存在这个，自行加一行  `skip_login: true` 即可。

### 1.安装插件

在`Miao-Yunzai`根目录执行

### Gitee:
```
git clone --depth=1 https://gitee.com/lylnspace/Lain-plugin ./plugins/Lain-plugin
```
### Gtihub:
```
git clone --depth=1 https://github.com/Circle-money-run/Lain-plugin ./plugins/Lain-plugin
```
### ghproxy安装:
```
git clone --depth=1 https://mirror.ghproxy.com/https://github.com/Circle-money-run/Lain-plugin ./plugins/Lain-plugin
```

### 2.安装依赖

```
pnpm install -P
```

`安装失败再用这个：`
```
pnpm config set sharp_binary_host "https://npmmirror.com/mirrors/sharp" && pnpm config set sharp_libvips_binary_host "https://npmmirror.com/mirrors/sharp-libvips" && pnpm install -P
```

### PS：若您使用的是ws地址是llonebot，请使用此椰奶进行点赞（止语的椰奶点不起）
```
https://gitee.com/lylnspace/yenai-plugin
```

### 3.使用适配器

请点击查看对应教程~
PS:LLOneBot地址支持大部分onebot协议,如napcat,ws-plugin,lagrange等

<details><summary>标准输入</summary><blockquote>
 作用：在控制台和在QQ一样执行指令，用于无法登录QQ情况下想执行指令。

 直接把`控制台`当成您的QQ`输入指令`即可！
 
 主人：`标准输入`默认为主人

 支持大部分基础指令，类似于锅巴登录等，不支持显示图片、适配、语音。
  
 自定义椰奶状态头像：在`./plugins/Lain-plugin/resources`文件夹下方创建一个名称为`avatar.jpg`的图片

 标准输入文件保存位置` ./resources/stdin `
 </blockquote></details>

- [PC微信](./docs/WeChat.md)

- [Shamrock](./docs/Shamrock.md)

- [QQBot(群和频道)](./docs/QQBot.md)

- [网页版微信](./docs/WeXin.md)

- [Lagrange.Core](./docs/Lagrange.Core.md)

<details><summary>LLOneBot</summary><blockquote>

  下载安装 [LLOneBot](https://github.com/LLOneBot/LLOneBot)，启用反向 WebSocket，添加地址：

  ```
  ws://localhost:2955/LLOneBot
  ```

</blockquote></details>
<details><summary>KOOK</summary><blockquote>
 
 #kook设置+token
 
 </blockquote></details>
<details><summary>Discord</summary><blockquote>
 
 #dc设置+token
 
 </blockquote></details>

### 4.设置主人

- 使用方法
  - 方法1：发送`#设置主人`，随后复制发送控制台的验证码即可成为主人
  - 方法2：发送`#设置主人@用户`，需要你是主人的情况下，指定此用户成为主人

主人可通过`#取消主人@用户`或者`#删除主人@用户`

## 插件更新

- #铃音更新 or #Lain更新

## 如何区分适配器

- `e.adapter` || `Bot[uin].adapter`
- 标准输入：`stdin`
- QQ频道：`QQGuild`
- Shamrock：`shamrock`
- PC微信：`ComWeChat`
- QQBot：`QQBot`
- 网页版微信：`WeXin`
- LagrangeCore: `LagrangeCore`
- LLOneBot: `LLOneBot`
- Kook: `Kook`
- Discord: `Discord`

## 适配进度

- [ ] 微信公众号适配器
- [ ] Telegram适配器
- [x] 标准输入
- [x] 跳过登录QQ
- [x] QQ频道适配器
- [x] PC微信适配器
- [x] 网页版微信适配器
- [x] Shamrock适配器
- [x] QQBot适配器
- [x] LagrangeCore
- [x] Kook(该适配器基于Yunzai-Kook-Plugin修改)
- [x] Discord
- [x] LLOneBot(XZhouQD贡献代码)
- [x] 转发消息改发送图片(该方法来源于小叶姐姐的ws-plugin)

## 特别鸣谢

以下排名不分先后

- [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai)
- [索引库](https://github.com/yhArcadia/Yunzai-Bot-plugins-index)
- [OpenShamrock](https://github.com/whitechi73/OpenShamrock)
- [ComWeChat](https://github.com/JustUndertaker/ComWeChatBotClient)
- [wechat4u](https://github.com/nodeWechat/wechat4u/blob/master/run-core.js)
- [qq-group-bot](https://github.com/lc-cn/qq-group-bot)
- [QQBot按钮库](https://gitee.com/lava081/button)
- [xiaoye12123](https://gitee.com/xiaoye12123)
- [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core)
- [LLOneBot](https://github.com/LLOneBot/LLOneBot)
- [XZhouQD-Lain](https://github.com/XZhouQD/Lain-plugin)
- [Yunzai-Kook-Plugin](https://github.com/TimeRainStarSky/Yunzai-KOOK-Plugin)
- [ws-plugin](https://github.com/XasYer/ws-plugin)
- [discord.js](https://discord.js.org)