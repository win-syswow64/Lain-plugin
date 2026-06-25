import fs from "fs";
import _ from "lodash";
import path from "path";
import YAML from "yaml";
import Kasumi from "kasumi.js";
import forward from "../../model/tool.js";
import common from "../../lib/common/common.js";
import Runtime from "../../../../lib/plugins/runtime.js";

export default class Kook {
    constructor() {
        this.adapter = "Kook";
        this.cfgPath = path.join(process.cwd(), "plugins", "Lain-plugin", "config", "config", "Kook.yaml");
        this.card_theme = ["primary", "success", "danger", "warning", "info", "secondary", "none"];

        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf-8"));

        if (cfg.autoConnect) {
            this.autoConnect();
        }
    }

    // 自动连接KOOK
    async autoConnect() {
        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf-8"));
        if (!cfg.bot || cfg.bot.length === 0) {
            common.warn("Lain-plugin", `KOOK配置文件中未找到bot配置`);
            common.info("Lain-plugin", `请使用 '#kook设置'+token 配置KOOK`);
            return false;
        }
        else {
            for (const item of cfg.bot) {
                // 如果已经连接过了, 则跳过
                if (Bot?.adapter?.includes(`${item.uin}`)) { continue; }

                await this.connect(item.token);
            }
        }
    }

    // 连接KOOK
    async connect(token) {
        this.bot = new Kasumi({ type: "websocket", token: token });
        await new Promise((resolve) => {
            this.bot.once("connect.*", resolve);
            this.bot.connect();
        });

        if (!this.bot.me?.userId) {
            return `KOOK连接失败`;
        }

        this.id = `ko_${this.bot.me.userId}`;

        common.info(this.id, `KOOK适配器连接成功, 正在加载资源...`);

        Bot[this.id] = {
            ...this.bot,
            sdk: this.bot,
            stop: () => this.stop(this.id),
            bkn: 0,
            adapter: this.adapter,
            uin: this.id,
            tiny_id: this.id,

            nickname: this.bot.me.username || "KOOK",
            avatar: this.bot.me.avatar || "https://img.kookapp.cn/assets/item/resources/logo.png",
            stat: { start_time: Date.now() / 1000, recv_msg_cnt: 0, send_msg_cnt: 0, send_img_cnt: 0 },

            apk: Bot.lain.adapter.Kook.apk,
            version: Bot.lain.adapter.Kook.version,

            fl: new Map(),
            gl: new Map(),
            gml: new Map(),
            guilds: new Map(),
            roles: new Map(),

            pickFriend: user_id => this.pickFriend(this.id, user_id),
            get pickUser() { return this.pickFriend },

            pickMember: (group_id, user_id) => this.pickMember(this.id, group_id, user_id),
            pickGroup: group_id => this.pickGroup(this.id, group_id),

            getGroupArray: () => this.getGroupArray(this.id),
            getGroupList: () => this.getGroupList(this.id),
            getGroupMap: () => this.getGroupMap(this.id),

            getUserIntimacy: (user_id) => this.getUserIntimacy(this.id, user_id),

            readMsg: async () => await common.recvMsg(this.id, "Kook", true),
            MsgTotal: async (type) => await common.MsgTotal(this.id, "Kook", type, true),
        }

        if (!Bot.adapter.includes(String(this.id))) { Bot.adapter.push(String(this.id)); }

        this.bot.on("message.*", data => this.makeMessage(this.id, data));
        this.bot.on("event.*", data => this.makeEvent(this.id, data));

        const startTime = Date.now();
        await this.loadAllResources(this.id);
        const endTime = Date.now();

        // 更新配置文件中的bot信息
        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf-8"));
        const item = cfg.bot.find(item => item.token === token);
        if (item) {
            item.uin = this.id;
            item.name = Bot[this.id].nickname;
            fs.writeFileSync(this.cfgPath, YAML.stringify(cfg), "utf-8");
        }

        common.info(this.id, `Kook加载资源完成, 用时: ${(endTime - startTime) / 1000}s`);
    }

    // 构造ICQQ消息并传递给喵崽, 如果有未知消息类型则会打印警告
    async makeMessage(id, event) {
        const data = {
            bot: Bot[id],
            adapter: this.adapter,
            post_type: "message",
            self_id: id,
            user_id: `ko_${event.authorId}`,
            raw: event,
            raw_message: "",
            message: [],
            message_id: event.messageId,
            sender: event.author,
            atme: false,
        }
        data.bot.fl.set(data.user_id, data.sender);

        // At all
        if (event.isMentionAll) {
            data.message.push({ type: "at", qq: "all", text: "@全体成员" });
            data.raw_message += "@全体成员 ";
        }

        // At online
        if (event.isMentionHere) {
            data.message.push({ type: "at", qq: "online", text: "@在线成员" });
            data.raw_message += "@在线成员 ";
        }

        // At user(s)
        if (Array.isArray(event.mention) && event.mention.length > 0) {
            for (const user of event.mention) {
                const userInfo = await getUserInfo(id, `ko_${user}`);
                data.message.push({ type: "at", qq: `ko_${user}`, text: `@${userInfo?.nickname || userInfo?.username || "未知用户"}` });
                data.raw_message += `@ko_${user} `;
            }
            if (data.at.includes(data.self_id)) {
                data.atme = true;
            }
        }

        // Quote message
        if (event?.rawEvent?.extra?.quote) {
            data.source = {
                user_id: data.user_id,
                time: event.rawEvent.extra.quote?.create_at,
                message_id: event.rawEvent.extra.quote?.rong_id,
                seq: 0,
                rand: 0,
                message: event.rawEvent.extra.quote?.content,
            }
        }

        // Message type
        switch (event.messageType) {
            // 1是文本消息(现在文本消息似乎都转成了MarkDown消息, 应该是不需要处理的...)
            case 1:
                common.debug(id, `文本消息: ${event.content}`);
                break

            // 2是图片消息
            case 2:
                data.message.push({ type: "image", url: event.content, file: `${event.content.split('/').pop()}` })
                data.raw_message += `[图片: ${event.content}]`;
                break

            // 3是视频消息
            case 3:
                data.message.push({ type: "video", url: event.content, file: `${event.content.split('/').pop()}` })
                data.raw_message += `[视频: ${event.content}]`
                break

            // 4是文件消息
            case 4:
                data.message.push({ type: "file", url: event.content })
                data.raw_message += `[文件: ${event.content}]`
                break

            // 8是语音消息
            case 8:
                data.message.push({ type: "record", url: event.content })
                data.raw_message += `[音频: ${event.content}]`
                break

            // 9是MarkDown消息, 现在正常用户发的好像都是MarkDown消息?
            case 9:
                data.content = event.content.replace(/\\(.)/g, "$1");
                data.content = data.content.replace(/\(met\)/, '@');
                data.content = data.content.replace(/\(met\)/, '');
                data.content = data.content.replace(/\\/g, '');
                data.content = data.content.replace(/@(.*) /, '');
                data.message.push({ type: "text", text: data.content });

                data.raw_message += event.content;
                data.raw_message = data.raw_message.replace(/\(met\)(.*)\(met\) /g, '');

                break

            // 10是卡片消息, 但我不知道除了文件还有什么其他类型的卡片消息, 所以其他类型的卡片消息都当作文本消息处理
            case 10:
                const eventObj = JSON.parse(event.content);
                const modules = eventObj[0]?.modules;
                console.log(modules);
                if (modules && Array.isArray(modules)) {
                    // 文件卡片消息
                    if (modules.filter(item => item.type === "file").length) {
                        for (const item of modules.filter(item => item.type === "file")) {
                            if (item.canDownload) {
                                data.message.push({ type: "file", url: item?.src });
                                data.raw_message += `[文件: ${item?.src}]`;
                            }
                        }
                    }
                    // 容器卡片消息
                    if (modules.filter(item => item.type === 'container').length) {
                        for (const item of modules.filter(item => item.type === 'container')) {
                            // 图片消息
                            if (item.elements.filter(i => i.type === 'image').length) {
                                for (const i of item.elements.filter(i => i.type === 'image')) {
                                    data.message.push({ type: "image", url: i.src });
                                    data.raw_message += `[图片: ${i.src}]`;
                                }
                            }
                        }
                    }
                    // 带图片的文本消息
                    if (modules.filter(item => item.type === 'section').length) {
                        for (const item of modules.filter(item => item.type === 'section')) {
                            item.text.content = item.text.content.replace(/\\(.)/g, "$1");
                            item.text.content = item.text.content.replace(/\(met\)/, '@');
                            item.text.content = item.text.content.replace(/\(met\)/, '');
                            item.text.content = item.text.content.replace(/\\/g, '');
                            item.text.content = item.text.content.replace(/@(.*) /, '');

                            data.message.push({ type: 'text', text: item.text.content });
                            data.raw_message += item.text.content;
                        }

                    }
                    // 其他的不知道, 暂不处理
                    else { common.warn(id, `未知卡片消息: ${JSON.stringify(eventObj)}`); }
                }
                else {
                    data.message.push({ type: "text", text: event.content })
                    data.raw_message += event.content
                }
                break

            // 255是系统消息
            case 255:
                common.debug(id, `系统消息: ${event.content}`);
                break

            default:
                data.message.push({ type: "text", text: event.content })
                data.raw_message += event.content
                common.warn(id, `未知消息类型: ${event.messageType}`);
                console.log(event);
        }

        const user_name = data.sender?.nickname || data.sender?.username || "未知用户";

        // 获取当前频道的管理员列表
        let adminList;
        let soraAdmin;
        if (event.channelType === "GROUP") {
            const groupInfo = await Bot[id].gl.get(`ko_${event.channelId}`) || {};
            const guild_id = groupInfo?.guild_id || "";

            // 获取服务器的信息, soraAdmin是服务器主人.
            const guildInfo = Bot[id].guilds.get(`ko_${guild_id}`) || {};
            soraAdmin = `ko_${guildInfo?.user_id}`;

            const roles = Bot[id].roles.get(`ko_${guild_id}`) || [];
            adminList = roles?.filter(item => item.name.includes("管理员") || item.name === Bot[id].nickname).map(item => item.role_id) || [];
        }

        // Content type
        switch (event.channelType) {
            // 私聊消息
            case "PERSON":
                data.message_type = "private";
                data.sub_type = "friend";
                common.info(id, `<好友: ${user_name}(${data.user_id})> -> ${data.raw_message}`);
                data.friend = { ...this.pickFriend(id, data.user_id) }
                break;

            // 频道消息
            case "GROUP":
                data.message_type = "group";
                data.sub_type = "normal";
                data.group_id = `ko_${event.channelId}`;
                data.group_name = event.rawEvent?.extra?.channel_name || event?.channel_name || "未知群";
                data.member = {
                    info: {
                        group_id: data.group_id,
                        user_id: data.user_id,
                        nickname: user_name,
                        last_sent_time: event?.timestamp
                    },
                    card: user_name,
                    nickname: user_name,
                    group_id: data.group_id,
                    is_admin: hasIntersection(event.author.roles, adminList) || false,
                    is_owner: soraAdmin === data?.user_id || false,
                    avatar: event.author?.avatar
                }
                common.info(id, `<群: ${data.group_name}(${data.group_id})><用户: ${user_name}(${data.user_id})> -> ${data.raw_message}`);
                data.group = { ...this.pickGroup(id, event.channelId) }
                break;

            // 也许有用吧...
            case "BROADCAST":
                common.info(id, `<广播: ${user_name}> -> ${data.raw_message}`);
                break;

            // 这又是什么鬼类型的消息...
            default:
                common.warn(id, `未知类型消息: ${JSON.stringify(event)}`);
        }

        // 消息撤回函数
        data.recall = async () => this.recallMsg(data, data.bot.sdk.API.message.delete(message_id), data.message_id);

        // 伪造一个消息对象, 用于回复消息
        let e = Object.assign({}, data);
        e.user_id = e.user_id.replace(/^ko_/, "");
        if (e.group_id) { e.group_id = e.group_id.replace(/^ko_/, ""); }

        // 消息回复函数
        data.reply = async (message, quote) => event.channelType === "GROUP"
            ? await this.sendGroupMsg(e, message, quote)
            : await this.sendPrivateMsg(e, message, quote);

        // 消息统计
        try {
            data.bot.stat.recv_msg_cnt++;
            common.recvMsg(id, "Kook");
            redis.set(`Yz:count:receive:msg:bot:${id}:total`, data.bot.stat.recv_msg_cnt);
        } catch { }

        // 传递给喵崽
        await Bot.emit('message', data);
    }

    // 构造按钮点击事件并传递给喵崽
    async makeMessageBtnClick(id, event) {
        const data = {
            bot: Bot[id],
            adapter: this.adapter,
            self_id: id,
            raw: event,

            post_type: "message",
            user_id: `ko_${event.authorId}`,
            sender: event.author,
            message_id: event.messageId,

            message: [{ type: "reply", id: event.targetMsgId }],
            raw_message: `[回复]: ${event.targetMsgId}`,
        }
        data.bot.fl.set(data.user_id, data.sender);

        if (event.channelType === "GROUP") {
            data.message_type = "group";
            data.group_id = `ko_${event.channelId}`;
            const groupInfo = await Bot[id].gl.get(data.group_id) || {};
            data.group_name = event.rawEvent?.extra?.channel_name || groupInfo?.name || "未知群";
            common.info(id, `<群: ${data.group_name}><用户: ${data.sender.nickname || data.sender.username}> -> [回复]: ${event.targetMsgId}`);
        }
        else {
            data.message_type = "private";
            common.info(id, `<好友: ,${data.sender.nickname || data.sender.username}(${data.user_id})> -> [回复]: ${event.targetMsgId}`);
        }

        try {
            data.value = JSON.parse(event.value);
        } catch (err) { common.error(id, `按钮点击事件解析失败: ${err}`); return false; }

        if (data.value?.input) {
            if (data.value.send) {
                data.message.push({ type: "text", text: data.value.input });
                data.raw_message += data.value.input;
            }
            else {
                const msg = [
                    // segment.reply(event.targetMsgId),
                    segment.markdown(`请输入'${data.value.input}'`),
                ];
                if (data.message_type === "group") {
                    return data.bot.pickGroup(data.group_id).sendMsg(msg);
                }
                else {
                    return data.bot.pickFriend(data.user_id).sendMsg(msg);
                }
            }
        }
        else if (data.value?.callback) {
            data.message.push({ type: "text", text: data.value.callback });
            data.raw_message += data.value.callback;
        }

        if (data.message_type === "group") {
            data.group = { ...this.pickGroup(id, data.group_id) }
        }
        else {
            data.friend = { ...this.pickFriend(id, data.user_id) }
        }

        await Bot.emit('message', data);
    }

    // 群消息更新处理函数, 格式化消息并传递给makeMessage
    async makeGroupMessageUpdated(id, event) {
        const message_id = event.body?.msg_id;
        try {
            const message = await Bot[id].sdk.API.message.view(message_id);
            const new_event = {
                authorId: message.data?.author?.id,
                messageId: message_id,
                mention: message.data?.mention,
                mentionAll: message.data?.mentionAll,
                mentionHere: message.data?.mentionHere,
                messageType: message.data?.type,
                author: message.data?.author,
                channelType: "GROUP",
                channelId: message.data?.channel_id,
                channel_name: await Bot[id].gl.get(`ko_${message.data?.channel_id}`)?.name,
                content: message.data?.content,
            }

            this.makeMessage(id, new_event);
        } catch (err) {
            common.error(id, `消息更新失败: ${err}`);
        }
    }

    // 私聊消息更新处理函数, 格式化消息并传递给makeMessage
    async makePrivateMessageUpdated(id, event) {
        const message_id = event.body?.msg_id;
        const chatCode = event.body?.chat_code;
        try {
            const message = await Bot[id].sdk.API.directMessage.view(message_id, chatCode);

            const userId = `ko_${message.data?.author_id}`;
            const userInfo = await getUserInfo(id, userId);
            if (userInfo || !_.isEmpty(userInfo)) { Bot.fl.set(userId, userInfo); } else { userInfo.user_id = userId; };

            const new_event = {
                authorId: userId,
                messageId: message_id,
                messageType: message.data?.type,
                author: userInfo || message.data?.author || {},
                channelType: "PERSON",
                channelId: id.replace(/^ko_/, ""),
                content: message.data?.content,
            }

            this.makeMessage(id, new_event);
        } catch (err) {
            common.error(id, `消息更新失败: ${JSON.stringify(err)}`);
        }
    }

    // TODO: 既然都挖坑了, 不妨多挖几个, 消息置顶, 取消消息置顶, 添加响应消息, 删除响应消息...
    // 坑挖的多了, 以后填的时候就不会那么累了...

    // 进裙事件
    async increaseEvent(id, event) {
        // 重载该服务器的用户列表
        await this.loadUserList(id, [event.guildId]);

        // 获取用户信息
        const userInfo = await Bot[id].gml.get(event.guildId).get(`ko_${event.body?.user_id}`);

        const guildInfo = await Bot[id].guilds.get(`${event.guildId}`);

        const newEvent = {
            // 这里应该pickGroup一下, 但得抓一下event.body里面的数据, 看看到底是啥...
            group: await this.pickGroup(id, guildInfo?.welcome_channel_id) || {},
            group_id: guildInfo?.welcome_channel_id || "",
            nickname: userInfo?.nickname || userInfo?.username || "未知用户",
            notice_type: "group",
            post_type: "notice",
            sub_type: "increase",
            user_id: event.body?.user_id,
        }

        // 然后再emit一下, 交给喵崽处理...
        await Bot.emit('notice', newEvent);
    }

    // TODO: 褪裙事件
    async decreaseEvent(id, event) {
        const newEvent = {
            // 这个如果为True, 则表示是群解散事件, 否则是群员退群事件, 不过这个得抓一下event.body里面的数据, 看看到底是啥...
            dimiss: false,
            // 这里应该pickGroup一下, 但得抓一下event.body里面的数据, 看看到底是啥...
            group: {},
            group_id: event.body?.channelId,
            // 这里似乎是代表褪裙的用户对象, 但是这个得抓一下event.body里面的数据, 看看到底是啥...
            member: {},
            notice_type: "group",
            // 操作人, 一般是退群的人自己, 或者是 踢人/解散群 的人...
            operator_id: event.body?.userId,
            post_type: "notice",
            sub_type: "decrease",
            // 退群的人, 或者是 被踢的人...
            user_id: event.body?.userId,
        }

        // 然后再emit一下, 交给喵崽处理...
        // await Bot.emit('notice', newEvent);
    }

    // 上线事件, 不过椰奶没有处理这个事件的方法, 等我想起来了再说...
    async onlineEvent(id, event) {
        const newEvent = {
            // 这里应该pickGroup一下, 但得抓一下event.body里面的数据, 看看到底是啥...
            group: {},
            group_id: event.body?.channelId,
            nickname: "who?",
            notice_type: "group",
            post_type: "notice",
            sub_type: "online",
            user_id: event.body?.userId,
        }
        // 然后再emit一下, 交给喵崽处理...
        // await Bot.emit('notice', newEvent);
    }

    // 下线事件, 不过椰奶没有处理这个事件的方法, 等我想起来了再说...
    async offlineEvent(id, event) {
        const newEvent = {
            // 这里应该pickGroup一下, 但得抓一下event.body里面的数据, 看看到底是啥...
            group: {},
            group_id: event.body?.channelId,
            nickname: "who?",
            notice_type: "group",
            post_type: "notice",
            sub_type: "offline",
            user_id: event.body?.userId,
        }
        // 然后再emit一下, 交给喵崽处理...
        // await Bot.emit('notice', newEvent);
    }

    // 群聊消息撤回事件
    async groupRecallEvent(id, event) {
        const userId = `ko_${event.body?.author_id}`;

        // 不上报自己撤回的消息
        if (userId == this.id) { return false; }

        const newEvent = {
            // 这里应该pickGroup一下, 但得抓一下event.body里面的数据, 看看到底是啥...
            group: await this.pickGroup(id, `ko_${event.body?.channel_id}`),
            adapter: "Kook",
            group_id: `ko_${event.body?.channel_id}`,
            message_id: event.body?.msg_id,
            notice_type: "group",
            // 操作人, 一般是撤回消息的人自己, 不过这tm居然没有返回数据, 先传个1吧...表示系统撤回...
            operator_id: `ko_1`,
            post_type: "notice",
            // 下面2个不知道是啥, 先传个0吧...
            rand: 0,
            seq: 0,
            sub_type: "recall",
            time: event?.timestamp,
            // 撤回的人, 或者是被撤回的人...
            user_id: userId,
        }
        // 然后再emit一下, 交给喵崽处理...
        await Bot.emit('notice', newEvent);
    }

    // 私聊消息撤回事件
    async privateRecallEvent(id, event) {
        const userId = `ko_${event.body?.author_id}`;
        // 不上报自己撤回的消息
        if (userId == this.id) { return false; }

        const userInfo = await getUserInfo(id, userId);

        if (userInfo || !_.isEmpty(userInfo)) { Bot.fl.set(userId, userInfo); } else { userInfo.user_id = userId; };

        const newEvent = {
            // 这里应该pickFriend一下, 但得抓一下event.body里面的数据, 看看到底是啥...
            friend: await this.pickFriend(id, userId),
            message_id: event.body?.msg_id,
            adapter: "Kook",
            notice_type: "friend",
            // 操作人, 撤回消息的人自己, 毕竟你总不能撤回对方的消息吧...
            operator_id: userId,
            post_type: "notice",
            // 下面2个不知道是啥, 先传个0吧...
            rand: 0,
            seq: 0,
            sub_type: "recall",
            time: event.body?.deleted_at,
            user_id: userId,
        }

        // 然后再emit一下, 交给喵崽处理...
        await Bot.emit('notice', newEvent);
    }

    // 构造事件并传递给对应的处理函数, 如果有未知消息类型则会打印警告
    makeEvent(id, event) {
        // Kook的事件是真tm多, 而且大部分都是没卵用...
        switch (event.rawEvent?.extra?.type) {
            /** 消息相关事件 */
            // 按钮点击事件(这个还算有点用...)
            case "message_btn_click":
                common.debug(id, `按钮点击事件: ${JSON.stringify(event.body)}`);
                this.makeMessageBtnClick(id, event);
                break;

            // 消息撤回事件(发了, 撤回了, 就是没发???)
            case "deleted_message":
                common.debug(id, `撤回(删除)消息: ${JSON.stringify(event.body?.content || event.body)}`);
                this.groupRecallEvent(id, event);
                break;

            // 私聊消息撤回事件(发了, 撤回了, 就是没发???)
            case "deleted_private_message":
                common.debug(id, `撤回(删除)私聊消息: ${JSON.stringify(event.body)}`);
                this.privateRecallEvent(id, event);
                break;

            // 修改频道消息事件(怎么会有人发明这种东西...)
            case "updated_message":
            case "message_updated":
                common.debug(id, `修改消息: ${JSON.stringify(event.body)}`);
                this.makeGroupMessageUpdated(id, event);
                break;

            // 修改私聊消息事件
            case "updated_private_message":
            case "private_message_updated":
                common.debug(id, `修改私聊消息: ${JSON.stringify(event.body)}`);
                this.makePrivateMessageUpdated(id, event);
                break;

            // 添加响应事件(这个是干嘛的...)
            case "added_reaction":
                common.debug(id, `添加响应消息: ${JSON.stringify(event.body)}`);
                break;

            // 删除响应事件(也许是删除点赞之类的...)
            case "deleted_reaction":
                common.debug(id, `删除响应消息: ${JSON.stringify(event.body)}`);
                break;

            // 消息置顶事件(置顶的消息真的会有人看吗...)
            case "pinned_message":
                common.debug(id, `消息置顶: ${JSON.stringify(event.body)}`);
                break;

            // 取消消息置顶事件(你看看这些人干的事...)
            case "unpinned_message":
                common.debug(id, `取消消息置顶: ${JSON.stringify(event.body)}`);
                break;

            /** 频道相关事件 */
            // 新增频道事件(坑多了不愁)
            case "added_channel":
                common.debug(id, `添加频道: ${JSON.stringify(event.body)}`);
                break;

            // 频道信息更新事件(我接收, 但是我就是不处理...额, 好像不能不处理, 得更新一下Bot.gl)
            case "updated_channel":
                common.debug(id, `频道信息更新: ${JSON.stringify(event.body)}`);
                break;

            // 这个…似乎是成员进入语音频道的事件
            case "joined_channel":
                common.debug(id, `加入语音频道: ${JSON.stringify(event.body)}`);
                break;

            // 有进入当然就有退出~
            case "exited_channel":
                common.debug(id, `退出语音频道: ${JSON.stringify(event.body)}`);
                break;

            /** 服务器相关事件 */
            // 成员加入服务器事件(进裙事件)
            case "joined_guild":
                common.debug(id, `成员加入服务器 ko_${event.guildId}: ${JSON.stringify(event.body)}`);
                this.increaseEvent(id, event);
                break;

            // 成员退出服务器事件(退裙事件)
            // 没捕获到, 到时候再说...
            /**
             * case "exited_guild":
             *    common.debug(id, `成员退出服务器: ${JSON.stringify(event.body)}`);
             *    this.decreaseEvent(id, event);
             *    break;
             */

            // 服务器成员上线事件(总算能够统计一下你们的摸鱼时间了...)
            case "guild_member_online":
                common.debug(id, `频道成员上线: ${JSON.stringify(event.body)}`);
                break;

            // 服务器成员下线事件(本次摸鱼时间一共长达...)
            case "guild_member_offline":
                common.debug(id, `频道成员下线: ${JSON.stringify(event.body)}`);
                break;

            // 捕获未知事件(都是些什么鬼事件啊...)
            default:
                common.warn(id, `未知事件: ${JSON.stringify(event)}`);
        }
    }

    // 上传文件
    async uploadFile(data, file) {
        return (await data.bot.sdk.API.asset.create(await Bot.Buffer(file))).data.url
    }

    // 制作按钮
    makeButton(button, theme) {
        const msg = {
            type: "button",
            text: button.text,
            theme,
            ...button.KOOKBot,
        }

        if (button.input) {
            msg.click = "return-val"
            msg.value = JSON.stringify({ input: button.input, send: button.send })
        } else if (button.callback) {
            msg.click = "return-val"
            msg.value = JSON.stringify({ callback: button.callback })
        } else if (button.link) {
            msg.click = "link"
            msg.value = button.link
        } else return false

        return msg
    }

    // 制作多按钮
    makeButtons(button_square) {
        const modules = []
        let random = Math.floor(Math.random() * 6)
        for (const button_row of button_square) {
            let elements = []
            for (let button of button_row) {
                button = this.makeButton(button, this.card_theme[random % 6])
                if (button) {
                    if (elements.length == 4) {
                        modules.push({ type: "action-group", elements })
                        elements = []
                    }
                    elements.push(button)
                    random++
                }
            }
            if (elements.length)
                modules.push({ type: "action-group", elements })
        }
        return modules
    }

    // 选中一个群, 返回一个群对象
    pickGroup(id, group_id) {
        const groupInfo = Bot[id].gl.get(group_id.startsWith("ko_") ? group_id : `ko_${group_id}`) || {};
        const i = {
            ...Bot[id].gl.get(group_id),
            self_id: id,
            bot: Bot[id],
            group_id: group_id?.replace(/^ko_/, "") || group_id,
        }
        return {
            ...i,
            sendMsg: msg => this.sendGroupMsg(i, msg),
            sendFile: file => { this.sendGroupMsg(i, { type: "file", file: file }) },
            recallMsg: message_id => this.recallMsg(i, message_id => i.bot.sdk.API.message.delete(message_id), message_id),
            getInfo: () => this.getGroupInfo(i),
            getAvatarUrl: async () => (await this.getGroupInfo(i)).guild.icon,
            getMemberMap: async () => await Bot[id].gml.get(`ko_${groupInfo.guild_id}`),
            pickMember: user_id => this.pickMember(id, group_id, user_id),
            getChatHistory: message_id => this.getGroupChatHistory(id, message_id),
            makeForwardMsg: message => this.makeForwardMsg(id, message),
        }
    }

    // 获取群信息
    async getGroupInfo(data) {
        const channel = (await data.bot.sdk.API.channel.view(data.group_id)).data;
        const guild = (await data.bot.sdk.API.guild.view(channel.guild_id)).data;
        return {
            guild,
            channel,
            group_id: `ko_${channel.id}`,
            group_name: `${guild.name}-${channel.name}`,
        }

    }

    // 选中一个群员, 返回一个群员对象
    pickMember(id, group_id, user_id) {
        const i = {
            ...Bot[id].fl.get(user_id),
            self_id: id,
            bot: Bot[id],
            group_id: group_id?.replace(/^ko_/, "") || group_id,
            user_id: user_id?.replace(/^ko_/, "") || user_id,
        }
        return {
            ...this.pickFriend(id, user_id),
            ...i,
            getInfo: () => this.getMemberInfo(i),
            getAvatarUrl: async () => (await this.getMemberInfo(i)).avatar,
        }
    }

    // 获取成员信息
    async getMemberInfo(data) {
        const i = (await data.bot.sdk.API.user.view(data.user_id,
            (await this.getGroupInfo(data)).guild.id)).data
        return {
            ...i,
            user_id: `ko_${i.id}`,
        }
    }

    // 选中一个好友, 返回一个好友对象
    pickFriend(id, user_id) {
        const i = {
            ...Bot[id].fl.get(user_id),
            self_id: id,
            bot: Bot[id],
            user_id: user_id?.replace(/^ko_/, "") || user_id,
        }
        return {
            ...i,
            sendMsg: msg => this.sendFriendMsg(i, msg),
            sendFile: file => this.sendFriendMsg(i, { type: "file", file: file }),
            recallMsg: message_id => this.recallMsg(i, message_id => i.bot.sdk.API.message.delete(message_id), message_id),
            getInfo: () => this.getFriendInfo(i),
            getAvatarUrl: async () => (await this.getFriendInfo(i)).avatar,
            getChatHistory: message_id => this.getPrivateChatHistory(id, user_id, message_id),
            makeForwardMsg: message => this.makeForwardMsg(id, message),
            getIntimacy: async () => (await this.getUserIntimacy(id, user_id)).score,
        }
    }

    // 制作转发消息
    async makeForwardMsg(id, message) {
        const e = {
            bot: Bot[id],
            user_id: id,
            adapter: this.adapter
        }
        await Runtime.init(e);
        const msg = await forward(message, e);
        if (msg && msg.file) { return segment.image(msg.file); }
    }

    // 获取好友信息
    async getFriendInfo(data) {
        const i = (await data.bot.sdk.API.user.view(data.user_id)).data
        return {
            ...i,
            user_id: `ko_${i.id}`,
        }
    }

    // 获取群历史消息
    async getGroupChatHistory(id, message_id) {
        const message = await Bot[id].sdk.API.message.view(message_id).data;
        if (!message) { return []; }

        const formatMessage = await this.formatMessage(id, message, "group");
        if (!formatMessage) { common.error(id, `消息格式化失败: ${JSON.stringify(message)}`); return []; }

        return [formatMessage] || [];
    }

    // 获取私聊历史消息
    async getPrivateChatHistory(id, user_id, message_id) {
        // 获取私聊列表, 再从私聊列表中找到对应的chat_code, 然后再获取对应的消息...
        let chat_code;
        let chatList = [];
        for await (const { data, err } of Bot[id].sdk.API.directMessage.chat.list()) {
            if (err) {
                common.error(id, `获取私聊列表失败: ${err}`);
                return [];
            }
            if (data.items.length > 0) {
                chatList.push(...data.items);
            }
        }

        chat_code = chatList.filter(item => item?.target_info?.id === user_id.replace(/^ko_/, ""))[0]?.code || "";

        if (!chat_code) {
            common.error(id, `未获取到用户私聊会话: ${user_id}`);
            return [];
        }

        const message = (await Bot[id].sdk.API.directMessage.view(message_id, chat_code)).data;
        if (!message) { common.error(id, `未获取到与 ${user_id} 会话中消息ID为 ${message_id} 的消息`); return []; }

        const formatMessage = await this.formatMessage(id, message, "private");
        if (!formatMessage) { common.error(id, `消息格式化失败: ${JSON.stringify(message)}`); return []; }

        return [formatMessage] || [];
    }

    // 格式化历史消息
    async formatMessage(id, data, tag) {
        const message = {
            adapter: this.adapter,
            post_type: "message",
            time: data.create_at,
            seq: 0,
            rand: 0,
            message: [],
            raw_message: "",
        }

        switch (data.type) {
            // 1是文本消息(现在文本消息似乎都转成了MarkDown消息, 应该是不需要处理的...)
            case 1:
                common.debug(id, `文本消息: ${data.content}`);
                break

            // 2是图片消息
            case 2:
                message.img = [];
                message.message.push({ type: "image", url: data.content })
                message.raw_message += `[图片: ${data.content}]`;
                message.img.push(data.content);
                break

            // 3是视频消息
            case 3:
                message.message.push({ type: "video", url: data.content })
                message.raw_message += `[视频: ${data.content}]`
                break

            // 4是文件消息
            case 4:
                message.message.push({ type: "file", url: data.content })
                message.raw_message += `[文件: ${data.content}]`
                break

            // 8是语音消息
            case 8:
                message.message.push({ type: "record", url: data.content })
                message.raw_message += `[音频: ${data.content}]`
                break

            // 9是MarkDown消息
            case 9:
                message.content = data.content.replace(/\\(.)/g, "$1");
                message.content = data.content.replace(/\(met\)/, '@');
                message.content = data.content.replace(/\(met\)/, '');
                message.message.push({ type: "text", text: data.content })
                message.raw_message += data.content
                message.raw_message.replace(/\(met\)(.*)\(met\)/g, '');
                break

            // 10是卡片消息, 但我不知道除了文件还有什么其他类型的卡片消息, 所以其他类型的卡片消息都当作文本消息处理
            case 10:
                const eventObj = JSON.parse(data.content);
                const modules = eventObj[0]?.modules;
                if (modules && Array.isArray(modules)) {
                    // 文件卡片消息
                    if (modules.filter(item => item.type === "file").length) {
                        for (const item of modules.filter(item => item.type === "file")) {
                            if (item.canDownload) {
                                message.message.push({ type: "file", url: item?.src });
                                message.raw_message += `[文件: ${item?.src}]`;
                            }
                        }
                    }
                    // 容器卡片消息
                    if (modules.filter(item => item.type === 'container').length) {
                        for (const item of modules.filter(item => item.type === 'container')) {
                            // 图片消息
                            if (item.elements.filter(i => i.type === 'image').length) {
                                for (const i of item.elements.filter(i => i.type === 'image')) {
                                    message.message.push({ type: "image", url: i.src });
                                    message.raw_message += `[图片: ${i.src}]`;
                                }
                            }
                        }
                    }
                    if (modules.filter(item => item.type === 'section').length) {
                        for (const item of modules.filter(item => item.type === 'section')) {
                            item.text.content = item.text.content.replace(/\\(.)/g, "$1");
                            item.text.content = item.text.content.replace(/\(met\)/, '@');
                            item.text.content = item.text.content.replace(/\(met\)/, '');
                            item.text.content = item.text.content.replace(/\\/g, '');
                            item.text.content = item.text.content.replace(/@(.*) /, '');

                            data.message.push({ type: 'text', text: item.text.content });
                            data.raw_message += item.text.content;
                        }

                    }
                    // 其他的不知道, 暂不处理
                    else { common.warn(id, `未知卡片消息: ${JSON.stringify(eventObj)}`); }
                }
                else {
                    message.message.push({ type: "text", text: data.content })
                    message.raw_message += data.content
                }
                break

            // 255是系统消息
            case 255:
                common.debug(id, `系统消息: ${data.content}`);
                break

            default:
                message.message.push({ type: "text", text: data.content })
                message.raw_message += data.content
                common.warn(id, `未知消息类型: ${data.messageType}`);
                console.log(data);
        }

        if (tag === "group") {
            message.user_id = `ko_${data.author.id}`;
            message.group_id = `ko_${data.channel_id}`;
            const groupInfo = Bot[id].gl.get(`ko_${data.channel_id}`) || {};
            if (!_.isEmpty(groupInfo)) {
                message.group_name = groupInfo.name;
            }
            message.sub_type = "normal";
            message.anonymous = null;

            message.sender = {
                user_id: `ko_${data.author.id}`,
                nickname: data.author.nickname,
                sub_id: undefined,
                card: data.author.username,
                sex: "unknown",
                age: 0,
                area: "",
                level: 0,
                role: "",
                title: "",
            }

            message.block = false;
            message.atme = data.mention_info?.mention_part?.includes(this.id);
            message.atall = false;
        }
        else if (tag === "private") {
            message.sub_type = "friend";

            // ...我他妈的, 这个地方的数据结构和群消息的数据结构居然不一样...
            const userInfo = await getUserInfo(id, `ko_${data.author_id}`);

            message.sender = {
                user_id: `ko_${data.author_id}`,
                nickname: userInfo?.nickname || userInfo?.username,
                sub_id: undefined,
                card: userInfo?.username || "",
            }

            message.from_id = `ko_${data.author_id}`;
            message.auto_reply = false;
        } else { return false; }

        return message;
    }

    // 发送消息
    async sendMsg(data, msg, quoteMsg = false, send, log) {
        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf-8"));

        // 是否发送按钮
        if (!cfg.sendButton && Array.isArray(msg)) { msg = msg?.filter(i => i.type !== "button") || msg; }

        const rets = { message_id: [], data: [] }
        let msgs;

        const sendMsg = async () => {
            for (const i of msgs.msgs) try {
                common.debug(this.id, `发送消息: ${i}`);
                const ret = await send(...i);
                common.debug(this.id, `发送消息返回: ${JSON.stringify(ret)}`);

                if (ret.err) {
                    common.error(this.id, `发送消息错误: ${JSON.stringify(ret.err)}`);
                    return false
                }

                rets.data.push(ret)
                if (ret.data?.msg_id) {
                    rets.message_id.push(ret.data.msg_id);
                    data.bot.stat.send_msg_cnt++;
                    redis.set(`Yz:count:send:msg:bot:${this.id}`, data.bot.stat.send_msg_cnt);
                }
            } catch (err) {
                common.error(this.id, `发送消息错误: ${JSON.stringify(err)}`);
                return false
            }
        }

        if (cfg.sendCard) {
            const { msg_log, modules, quote, at } = await this.makeCardMsg(data, msg, quoteMsg);
            msgs = { msgs: [], msg_log }
            if (modules.length) {
                const random = Math.floor(Math.random() * 7)
                for (let i = 0; i < modules.length; i += 50) {
                    msgs.msgs.push([10, JSON.stringify([{
                        type: "card",
                        theme: this.card_theme[(random + i / 50) % 7],
                        modules: modules.slice(i, i + 50),
                    }]), quote, at]);
                }
            }
        } else {
            msgs = await this.makeMsg(data, msg, quoteMsg);
        }

        log(msgs.msg_log)
        if (await sendMsg() === false) {
            msgs = await this.makeMsg(data, msg, quoteMsg);
            await sendMsg();
        }

        return rets;
    }

    // 发送好友消息
    sendFriendMsg(data, msg, quote = false) {
        return this.sendMsg(data, msg, quote,
            (type, content, quote) => data.bot.sdk.API.directMessage.create(type, data.user_id, content, quote),
            log => common.info(this.id, `<发送好友消息: ko_${data.user_id}> -> ${log}`),
        )
    }

    // 发送私聊消息
    sendPrivateMsg(data, msg, quote = false) {
        return this.sendFriendMsg(data, msg, quote);
    }

    // 发送群消息
    sendGroupMsg(data, msg, quote = false) {
        return this.sendMsg(data, msg, quote,
            (type, content, quote, at) => data.bot.sdk.API.message.create(type, data.group_id, content, quote, at,),
            log => common.info(this.id, `<发送群消息: ko_${data.group_id}> -> ${log}`)
        )
    }

    // 制作卡片消息
    async makeCardMsg(data, msg, quote = false) {
        if (!Array.isArray(msg)) { msg = [msg] }
        const msgs = []
        const modules = []
        let msg_log = ""
        // let quote
        let at

        if (quote && data.message_id) {
            const userName = data?.member?.nickname || data?.member?.card || data?.sender?.username || data?.sender?.nickname || data?.sender?.card || `Message_id: ${quote}`;
            msg_log += `[回复: ${userName}]`;
            quote = data.message_id;
        }

        // 构造回复消息头部
        const user_id = data?.user_id?.replace(/^ko_/, "") || "";
        if (user_id) {
            const userInfo = await getUserInfo(data.self_id, user_id);

            const replyModule = [
                {
                    type: "section",
                    text: { type: "kmarkdown", content: `(met)${user_id}(met)` },
                    mode: "left",
                    accessory: {
                        type: "image",
                        src: data?.vip_avatar || data?.avatar || userInfo?.avatar || "https://img.kookapp.cn/assets/item/resources/logo.png",
                        size: "sm",
                    }
                },
                { type: "divider" }
            ];
            modules.push(...replyModule);
        }

        for (let i of msg) {
            if (typeof i != "object") { i = { type: "text", text: i } }
            let src
            if (i.file) {
                console.log(i.file.file);
                if (typeof i.file == "object" && i.file.file) { src = await this.uploadFile(data, i.file.file); }
                else if (typeof i.file == "object" && i.file.url) { src = await this.uploadFile(i.file.url); }
                else { src = await this.uploadFile(data, i.file); }
            }

            switch (i.type) {
                case "text":
                    msg_log += `[文本: ${i.text}]`
                    modules.push({ type: "section", text: i.text })
                    try { await common.MsgTotal(this.id, 'Kook') } catch { }
                    break

                case "image":
                    msg_log += `[图片: ${src}]`
                    modules.push({ type: "container", elements: [{ type: "image", src }] })
                    try {
                        await common.MsgTotal(this.id, 'Kook', 'image');
                        Bot[this.id].stat.send_img_cnt++;
                        redis.set(`Yz:count:send:image:bot:${this.id}:total`, Bot[this.id].stat.send_img_cnt);
                    } catch { }
                    break

                case "record":
                    msg_log += `[音频: ${src}]`
                    modules.push({ type: "audio", src })
                    break

                case "video":
                    msg_log += `[视频: ${src}]`
                    modules.push({ type: "video", src })
                    break

                case "file":
                    const fileName = i.file.split("/").pop();
                    msg_log += `[文件: ${src}]`;
                    modules.push({ type: "file", src, title: fileName });
                    break

                // 喵崽没有这个消息类型, 暂时不管
                case "reply":
                    msg_log += `[回复: ${i.id}]`;
                    break

                // 回复消息时自动会添加一个回复的头部, 所以这里不需要再添加了...
                case "at":
                    msg_log += `[提及: ${i.id}]`;
                    break

                case "node":
                    for (const { message } of i.data) {
                        const msg = await this.makeCardMsg(data, message)
                        msg_log += msg.msg_log
                        modules.push(...msg.modules)
                        if (msg.quote) quote = msg.quote
                        if (msg.at) at = msg.at
                    }
                    break

                case "button":
                    msg_log += "[按钮]"
                    modules.push(...this.makeButtons(i.data))
                    break

                case "markdown":
                    msg_log += `[Markdown: ${i.data}]`
                    modules.push({ type: "section", text: { type: "kmarkdown", content: i.data } })
                    break

                case "raw":
                    msg_log += `[原始消息: ${JSON.stringify(i.data)}]`
                    msgs.push(i.data)
                    break

                default:
                    i = JSON.stringify(i)
                    msg_log += `[文本: ${i}]`
                    modules.push({ type: "section", text: i })
            }
        }

        return { msg_log, modules, quote, at }
    }

    // 制作消息
    async makeMsg(data, msg, quote = false) {
        if (!Array.isArray(msg)) { msg = [msg]; }
        const msgs = [];
        let msg_log = "";
        // let quote;
        let at;

        // 构造答复消息
        if (quote && data.message_id) {
            const userName = data?.member?.nickname || data?.member?.card || data?.sender?.username || data?.sender?.nickname || data?.sender?.card || `Message_id: ${quote}`;
            msg_log += `[回复: ${userName}]`;
            quote = data.message_id;
        }

        for (let i of msg) {
            if (typeof i != "object") { i = { type: "text", text: i } }
            let file;
            if (i.file) { file = await this.uploadFile(data, i.file); }

            let msg
            switch (i.type) {
                case "text":
                    if (i.text === "") { continue; }
                    msg_log += `[文本: ${i.text}]`
                    msg = [9, i.text]
                    try { await common.MsgTotal(this.id, 'Kook') } catch { }
                    break

                case "image":
                    msg_log += `[图片: ${file}]`
                    msg = [2, file]
                    try {
                        await common.MsgTotal(this.id, 'Kook', 'image');
                        Bot[this.id].stat.send_img_cnt++;
                        redis.set(`Yz:count:send:image:bot:${this.id}:total`, Bot[this.id].stat.send_img_cnt);
                    } catch { }
                    break

                case "record":
                    msg_log += `[音频: ${file}]`
                    msg = [8, file]
                    break

                case "video":
                    msg_log += `[视频: ${file}]`
                    msg = [3, file]
                    break

                // 好吧, 官方把文件消息合并到卡片消息里了...
                case "file":
                    const fileName = i.file.split("/").pop();;
                    msg_log += `[文件: ${file}]`;
                    const random = Math.floor(Math.random() * 7);
                    return {
                        msgs: [[10, JSON.stringify([{
                            type: "card",
                            theme: this.card_theme[random],
                            modules: [{ type: "file", src: file, title: fileName }],
                        }]), quote, at]],
                        msg_log: `[文件: ${file}]`
                    }

                // 喵崽没有这个消息类型, 暂时不管
                case "reply":
                    msg_log += `[回复: ${i.id}]`;
                    quote = i.id;
                    continue;

                case "at":
                    msg_log += `[提及: ${i.id}]`;
                    at = i.id.replace(/^ko_/, "");
                    msg = [9, `(met)${at}(met)`];
                    break;

                case "node":
                    for (const { message } of i.data) {
                        const msg = await this.makeMsg(data, message);
                        msgs.push(...msg.msgs);
                        msg_log += msg.msg_log;
                    }
                    continue;

                case "button":
                    msg_log += "[按钮]";
                    msg = [10, JSON.stringify([{ type: "card", modules: this.makeButtons(i.data) }])];
                    break;

                case "markdown":
                    msg_log += `[Markdown: ${i.data}]`;
                    msg = [9, i.data];
                    break;

                case "raw":
                    msg_log += `[原始消息: ${JSON.stringify(i.data)}]`;
                    msg = i.data;
                    break;

                default:
                    i = JSON.stringify(i);
                    msg_log += `[文本: ${i}]`;
                    msg = [1, i];
                    try { await common.MsgTotal(this.id, 'Kook') } catch { }
                    break;
            }

            if (msg) {
                if (quote) { msg[2] = quote; }
                if (at) { msg[3] = at; }
                msgs.push(msg);
            }
        }
        return { msgs, msg_log }
    }

    // 撤回消息
    async recallMsg(data, recall, message_id) {
        common.info(data.self_id, `<撤回消息: ${message_id}>`);

        if (!Array.isArray(message_id)) { message_id = [message_id]; }

        const msgs = []
        for (const i of message_id) { msgs.push(await recall(i)); }

        return msgs
    }

    // 加载全部资源
    async loadAllResources(id) {
        // 加载服务器信息
        const guildList = await this.loadGuildList(id);
        if (guildList.length === 0) { logger.warn(`获取服务器列表失败`); return false; }

        await this.loadGuildsInfo(id, guildList);

        // 加载频道信息
        const channelList = await this.loadChannelList(id, guildList);
        if (channelList.length === 0) { logger.warn(`获取频道列表失败`); return false; }

        await this.loadChannelsInfo(id, channelList);

        // 加载成员信息
        await this.loadUserList(id, guildList);

        // 加载角色信息
        await this.loadRoleList(id, guildList);

        // 加载好友(私聊)信息
        // await this.loadFriendList(id);
    }

    // 加载服务器id列表
    async loadGuildList(id) {
        let guildList = [];
        for await (const { data, err } of Bot[id].sdk.API.guild.list()) {
            if (err) {
                common.error(id, `获取服务器列表错误: ${err}`); continue;
            }
            if (data.items.length > 0) {
                for (const guild of data.items) {
                    const guild_id = guild.id;
                    guildList.push(`ko_${guild_id}`);
                }
            }
        }

        return guildList;
    }

    // 加载服务器详细信息
    async loadGuildsInfo(id, guildList) {
        if (guildList.length === 0) { logger.warn(`没有获取到服务器列表`); return false; }

        for (const guild_id of guildList) {

            const { data, err } = await Bot[id].sdk.API.guild.view(guild_id.replace(/^ko_/, ''));
            if (err) {
                common.error(this.id, `获取服务器信息错误: ${err}`); continue;
            }

            Bot[id].guilds.set(guild_id, data);
            common.sleep(500);
        }
    }

    // 加载频道id列表
    async loadChannelList(id, guildList) {
        let channelList = [];
        if (guildList.length === 0) { logger.warn(`没有获取到服务器列表`); return channelList; }

        for (const guild_id of guildList) {
            for await (const { data, err } of Bot[id].sdk.API.channel.list(guild_id.replace(/^ko_/, ''))) {
                if (err) {
                    common.error(this.id, `获取频道列表错误: ${err}`); continue;
                }
                if (data.items.length > 0) {
                    for (const channel of data.items) {
                        const channel_id = channel.id;
                        channelList.push(`ko_${channel_id}`);
                    }
                }
            }
            common.sleep(500);
        }

        return channelList;
    }

    // 加载频道详细信息
    async loadChannelsInfo(id, channelList) {
        if (channelList.length === 0) { logger.warn(`没有获取到频道列表`); return false; }

        for (const channel_id of channelList) {
            const { data, err } = await Bot[id].sdk.API.channel.view(channel_id.replace(/^ko_/, ''));
            if (err) {
                common.error(id, `获取频道信息错误: ${err}`); continue;
            }
            data.group_id = `ko_${data.id}`;
            data.group_name = data.name;

            Bot[id].gl.set(channel_id, data);
            common.sleep(500);
        }
    }

    // 加载用户列表
    async loadUserList(id, guildList) {
        if (guildList.length === 0) { logger.warn(`没有获取到服务器列表`); return false; }

        for (const guild_id of guildList) {
            for await (const { data, err } of Bot[id].sdk.API.guild.userList({ guildId: guild_id.replace(/^ko_/, '') })) {
                if (err) {
                    common.error(id, `获取用户列表错误: ${err}`); continue;
                }

                if (data.items.length > 0) {
                    const userMap = new Map();
                    for (const user of data.items) {
                        const user_id = `ko_${user.id}`;
                        user.qq = user_id;
                        user.sex = "unknown";
                        userMap.set(user_id, user);
                    }
                    Bot[id].gml.set(guild_id, userMap);
                }
                else {
                    const guildInfo = Bot[id].guilds.get(guild_id);
                    common.warn(id, `服务器 ${guildInfo?.name || guild_id} 没有用户???`);
                }
            }
            common.sleep(500);
        }
    }

    // 加载角色列表
    async loadRoleList(id, guildList) {
        if (guildList.length === 0) { logger.warn(`没有获取到服务器列表`); return false; }

        for (const guild_id of guildList) {
            for await (const { data, err } of Bot[id].sdk.API.guild.role.list(guild_id.replace(/^ko_/, ''))) {
                if (err) {
                    common.error(id, `获取角色列表错误: ${err}`); continue;
                }

                if (data.items.length > 0) {
                    Bot[id].roles.set(guild_id, data.items);
                }
                else {
                    const guildInfo = Bot[id].guilds.get(guild_id);
                    common.warn(id, `服务器 ${guildInfo?.name || guild_id} 没有角色???`);
                }
            }
            common.sleep(500);
        }
    }

    // TODO: 加载好友列表, 上游未实现私信列表接口
    async loadFriendList(id) {

    }

    // 获取机器人对用户的好感度(保留一个方法, 用户需要时可以自行调用)
    async getUserIntimacy(id, user_id) {
        const user = user_id?.replace(/^ko_/, '') || user_id;
        const { data, err } = await Bot[id].sdk.API.intimacy.get(user);
        if (err) {
            common.error(id, `获取用户亲密度错误: ${err}`);
            return false;
        }
        return data;
    }

    // 关🐔
    async stop(id) {
        // 下线
        const { res, error } = await Bot[id].API.user.offline();
        if (error) {
            common.error(id, `下线失败: ${error}`);
            return false;
        }

        // 注销适配器
        Bot.adapter = Bot.adapter.filter(item => item !== id);

        common.info(id, `${id}下线成功~`);
    }
}

/**
     * 比较两个数组是否有交集, 有则返回true, 否则返回false
     * 用于判定用户权限
     * @param {Array} list1
     * @param {Array} list2
     * @returns boolean
     */
function hasIntersection(list1, list2) {
    const set1 = new Set(list1);
    const set2 = new Set(list2);
    return [...set1].some(item => set2.has(item));
}

/**
 * 从gml中获取用户信息
 * @param {String} user_id
 * @returns Object
 */
function getUserInfo(id, user_id) {
    if (!user_id.startsWith('ko_')) { user_id = `ko_${user_id}`; }

    let userInfo;
    for (const key of Bot[id].gml.keys()) {
        if (Array.from(Bot[id].gml.get(key).keys()).includes(user_id)) {
            userInfo = Bot[id].gml.get(key).get(user_id);
            break;
        }
    }

    if (!userInfo) { common.error('Kook', `未找到用户信息: ${user_id}`); return {}; }
    return userInfo;
}

common.info(`Lain-plugin`, `Kook适配器加载完成`);
