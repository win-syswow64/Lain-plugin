import fs from "fs";
import _ from "lodash";
import path from "path";
import YAML from "yaml";
import forward from "../../model/tool.js";
import common from "../../lib/common/common.js";
import Runtime from "../../../../lib/plugins/runtime.js";
import {
    Client,
    Partials,
    EmbedBuilder,
    ButtonBuilder,
    MessagePayload,
    ActionRowBuilder,
    AttachmentBuilder,
    GatewayIntentBits,
} from "discord.js";

// Bot的权限列表, 默认屏蔽了一些权限, 如果需要可以自行添加

// 注: 如不开启GatewayIntentBits.GuildMembers权限,
// 那么在加载成员信息时, 只会加载机器人本身, 但这是一个很特殊的方法,
// 如果你机器人所在的Server达到100个, 那么你需要向官方申请权限, 否则无法获取成员信息.
// 另外, GuildBan是GuildModeration的废弃名称, 此处仅做保留, 不再使用.
const botIntents = [
    // 自动审核
    // GatewayIntentBits.AutoModerationExecution,
    // GatewayIntentBits.AutoModerationConfiguration,
    // 私聊
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.DirectMessageReactions,
    // 频道
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    // GatewayIntentBits.GuildWebhooks,
    // GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildMessageTyping,
    // GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildEmojisAndStickers,
    // 消息内容
    GatewayIntentBits.MessageContent,
];

/**
 * Discord适配器
 */
export default class Discord {
    constructor() {
        this.adapter = "Discord";
        this.botCfg = YAML.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'config', 'bot.yaml'), 'utf8'));
        this.cfgPath = path.join(process.cwd(), "plugins", "Lain-plugin", "config", "config", "Discord.yaml");

        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf8"));
        if (cfg.autoConnect) { this.autoConnect(); }
    }

    /**
     * 自动连接Discord
     * @returns boolean 连接成功返回true, 否则返回false.
     */
    async autoConnect() {
        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf8"));
        if (!cfg.bot || cfg.bot.length === 0) {
            common.warn(`Lain-plugin`, "Discord配置文件中未找到bot配置");
            common.info(`Lain-plugin`, `请使用 '#dc设置'+token 配置Discord`);
            return false;
        }
        else {
            for (const item of cfg.bot) {
                if (Bot?.adapter?.includes(`${item.uin}`)) { continue; }

                await this.connect(item.token);
            }
        }

        return true;
    }

    /**
     * 连接Discord
     * @param {String} token 机器人令牌.
     * @returns Boolean 连接成功返回true, 否则返回false.
     */
    async connect(token) {
        this.bot = new Client({ intents: botIntents, partials: [Partials.Channel] });
        await this.bot.login(token);
        let botInfo;
        await new Promise(resolve => {
            this.bot.once("ready", () => {
                botInfo = {
                    id: this.bot.user.id,
                    name: this.bot.user.username,
                    displayName: this.bot.user.displayName,
                    avatar: this.bot.user.avatarURL(),
                    banner: this.bot.user.bannerURL(),
                    mfa: this.bot.user.mfaEnabled,
                    createAt: this.bot.user.createdTimestamp,
                };
                resolve();
            })
        });

        if (!botInfo || _.isEmpty(botInfo)) { common.error(`Lain-plugin`, `Discord连接失败`); return false; }

        this.id = `dc_${botInfo.id}`;

        common.info(this.id, `Discord适配器连接成功, 正在加载资源...`);

        Bot[this.id] = {
            ...this.bot,
            adapter: this.adapter,
            sdk: this.bot,
            stop: () => this.stop(this.id),
            bkn: 0,
            uin: this.id,
            tiny_id: this.id,

            // 机器人信息
            nickname: botInfo?.name || "Discord",
            avatar: botInfo?.avatar || "https://www.svgrepo.com/show/331368/discord-v2.svg",
            stat: { start_time: Date.now() / 1000, recv_msg_cnt: 0, send_msg_cnt: 0, send_img_cnt: 0 },

            // 机器人版本信息
            apk: Bot.lain.adapter.Discord.apk,
            version: Bot.lain.adapter.Discord.version,

            fl: new Map(),
            gl: new Map(),
            gml: new Map(),
            guilds: new Map(),
            roles: new Map(),

            // 各种方法...
            pickFriend: async (user_id) => await this.pickFriend(this.id, user_id),
            get pickUser() { return this.pickFriend; },

            pickGroup: (group_id) => this.pickGroup(this.id, group_id),
            pickMember: (group_id, user_id) => this.pickMember(this.id, group_id, user_id),

            getGroupMap: () => this.getGroupMap(this.id),

            readMsg: async () => common.recvMsg(this.id, "Discord", true),
            MsgTotal: async (type) => common.MsgTotal(this.id, "Discord", type, true),
        }

        // 注册适配器
        if (!Bot?.adapter?.includes(String(this.id))) { Bot.adapter.push(String(this.id)); }

        // 消息监听
        this.bot.on("messageCreate", async data => {
            const message = await this.dcToIcqq(this.id, data);
            if (message) { Bot.emit("message", message); }
            return true;
        });

        // 消息更新监听
        this.bot.on("messageUpdate", async (oldData, newData) => {
            const message = await this.messageUpdate(this.id, oldData, newData);
            if (message) { Bot.emit("message", message); }
            return true;
        });

        // 按钮回调监听
        this.bot.on("interactionCreate", async data => {
            if (data.isButton()) {
                const message = await this.ButtonCallback(this.id, data);
                if (message) { Bot.emit("message", message); }
            }
            else { common.warn(this.id, `未知交互类型: ${data.type}`); }

            return true;
        });

        // 加入群监听
        this.bot.on("guildMemberAdd", async member => {
            const event = await this.guildMemberAdd(this.id, member);
            if (event) { Bot.emit("notice", event); }
            return true;
        });

        // 加载各种资源(如果需要的话...)
        const startTime = Date.now();
        await this.loadAllResources(this.id);
        const endTime = Date.now();

        // 更新配置文件中的bot信息
        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf8"));
        const item = cfg.bot.find(item => item.token === token);
        if (item) {
            item.uin = this.id;
            item.name = Bot[this.id].nickname;
            fs.writeFileSync(this.cfgPath, YAML.stringify(cfg), "utf8");
        }

        common.info(this.id, `Discord资源加载完毕, 用时: ${(endTime - startTime) / 1000}s`);
        return true;
    }

    /**
     * 构造ICQQ消息并传递给喵崽, 如果有未知消息会打印警告.
     * @param {String} id 机器人id
     * @param {Object} event 消息数据
     */
    async dcToIcqq(id, event) {
        // 过滤自己的消息...
        if (this.botCfg.ignore_self && !event.chatHistoryFnc && `dc_${event.author.id}` === id) { return false; }

        const data = {
            bot: Bot[id],
            adapter: this.adapter,
            post_type: "message",
            raw: event,
            self_id: id,
            user_id: `dc_${event.author.id}`,
            message: [],
            message_id: event.id,
            raw_message: "",
            sender: event.author,
            atme: false,
        }
        data.bot.fl.set(data.user_id, data.sender);

        // meme要的东西怎么这么见鬼.
        data.sender.user_id = data.user_id;

        // At all
        if (event?.mentions && event?.mentions.everyone && event.content.includes("@everyone")) {
            data.message.push({ type: "at", qq: "all", text: "@全体成员" });
            data.raw_message += "@全体成员 ";
            event.content = event.content.replace(/@everyone/g, "");
        }

        // At here
        if (event?.mentions && event?.mentions.everyone && event.content.includes("@here")) {
            data.message.push({ type: "at", qq: "here", text: "@在线成员" });
            data.raw_message += "@在线成员 ";
            event.content = event.content.replace(/@here/g, "");
        }

        // At role(s)
        if (event?.mentions && event?.mentions.roles.size > 0) {
            Array.from(event.mentions.roles.values()).forEach(role => {
                data.message.push({ type: "at", qq: `role_${role.name}`, text: `@${role.name} ` });
                data.raw_message += `@${role.name} `;
                event.content = event.content.replace(`<@&${role.id}>`, "");
            });
        }

        // At user(s)
        if (event?.mentions && event?.mentions.users.size > 0) {
            for (const user of Array.from(event.mentions.users.keys())) {
                const userInfo = await getUserInfo(id, `dc_${user}`);
                data.message.push({ type: "at", qq: `dc_${user}`, text: `@${userInfo?.globalName || userInfo.name || "未知用户"} ` });
                data.raw_message += `@${user} `;
                event.content = event.content.replace(`<@${user}>`, "");

                // 识别艾特自己
                if (`dc_${user}` === id) { data.atme = true; }
            }
        }

        // Attachments Message | Image Message | Video Message | Audio Message | File Message
        if (event?.attachments && event.attachments.size > 0) {
            Array.from(event.attachments.values()).forEach(attach => {
                switch (attach.contentType.split('/').shift().toLowerCase()) {
                    // 图片消息
                    case "image":
                        data.message.push({
                            type: "image",
                            url: attach.url,
                            file: attach.name,
                            size: attach.size || 0,
                            height: attach.height || 0,
                            width: attach.width || 0,
                        });
                        data.raw_message += `[图片](${attach.url})`;
                        break;

                    // 视频消息
                    case "video":
                        data.message.push({
                            type: "video",
                            url: attach.url,
                            file: attach.name,
                            size: attach.size || 0,
                            height: attach.height || 0,
                            width: attach.width || 0,
                        });
                        data.raw_message += `[视频](${attach.url})`;
                        break;

                    // 语音消息
                    case "audio":
                        data.message.push({
                            type: "record",
                            url: attach.url,
                            file: attach.name,
                            size: attach.size || 0,
                            duration: attach.duration || 0,
                            waveform: attach.waveform || "",
                        });
                        data.raw_message += `[语音](${attach.url})`;
                        break;

                    // 文件消息(默认)
                    default:
                        data.message.push({
                            type: "file",
                            url: attach.url,
                            file: attach.name,
                            size: attach.size || 0,
                        });
                        data.raw_message += `[文件](${attach.url})`;
                        break;
                }
            });
        }

        switch (event.type) {
            // Normal Message
            case 0:
                data.message.push({ type: "text", text: event.content })
                data.raw_message += event.content;
                break;

            // Quote Message
            case 19:
                data.message.push({ type: "text", text: event.content });
                const sourceId = event.reference.messageId;
                const channelInstance = event.guildId
                    ? Bot[id].sdk.channels.cache.get(event.channelId)
                    : Bot[id].sdk.users.cache.get(event.author.id).dmChannel;

                const sourceMsg = await channelInstance.messages.fetch(sourceId);

                data.source = {
                    user_id: `dc_${event.mentions.repliedUser.id}`,
                    time: sourceMsg?.createdTimestamp || 0,
                    message_id: sourceId,
                    seq: 0,
                    rand: 0,
                    message: sourceMsg?.content || "",
                }
                break;

            default:
                data.message.push({ type: "text", text: event.content });
                data.raw_message += event.content;
                common.warn(id, `未知消息类型: ${event.type}`);
                console.log(event);
                break;
        }

        const userName = event.author?.globalName || event.author?.username || "未知用户";
        data.sender.card = userName;

        // Message Type(有guildId则为群消息, 否则为私聊消息)
        if (!event.guildId) {
            data.message_type = "private";
            data.sub_type = "friend";
            common.info(id, `<好友: ${userName}(${data.user_id})> -> ${data.raw_message}`);

            data.friend = await this.pickFriend(id, data.user_id);

            data.channel = data.friend.channel;
            data.recallMsg = async () => data.channel.messages.fetch(data.message_id).then(msg => msg.delete()).catch(err => common.error(id, `撤回消息失败: ${err}`));

            // Event本身携带有reply方法, 此处保留为调试使用.
            data.reply = async (message, quote) => await this.sendMsg(data, message, quote);
        }
        else {
            let groupInfo = Bot[id].gl.get(`dc_${event.channelId}`);
            const roles = Bot[id].roles.get(`dc_${event.guildId}`);
            const adminList = roles.filter(
                role => role.name.includes("管理员")
                    || role.name.includes("admin")
                    || role.name === Bot[id].nickname)
                .map(item => item.id) || [];

            groupInfo.group_name = `${groupInfo.guild?.name || event.guildId}-${groupInfo.name || event.channelId}`;

            data.message_type = "group";
            data.sub_type = "normal";
            data.group_id = `dc_${event.channelId}`;
            data.group_name = groupInfo.group_name;

            // 获取用户的权限组(角色)
            const mem = await getUserInfo(id, data.user_id);
            const memRoles = Array.from(mem.roles.cache.keys());

            data.member = {
                info: {
                    group_id: data.group_id,
                    user_id: data.user_id,
                    nickname: userName,
                    last_sent_time: event.createdTimestamp
                },
                card: userName,
                nickname: userName,
                group_id: data.group_id,
                is_admin: hasIntersection(memRoles, adminList) || false,
                is_owner: groupInfo.owner === data.user_id || false,
                avatar: event.author.avatarURL(),
            };
            common.info(id, `<群: ${data.group_name}(${data.group_id})> <${userName}(${data.user_id})> -> ${data.raw_message}`);

            data.group = this.pickGroup(id, data.group_id);

            data.channel = data.group.channel;
            data.recallMsg = async () => data.group.channel.messages.fetch(data.message_id).then(msg => msg.delete()).catch(err => common.error(id, `撤回消息失败: ${err}`));

            // Event本身携带有reply方法, 此处保留为调试使用.
            data.reply = async (message, quote) => await this.sendMsg(data, message, quote);
        }

        // 消息统计
        try {
            data.bot.stat.recv_msg_cnt++;
            common.recvMsg(id, "Discord");
            redis.set(`Yz:count:receive:msg:bot:${id}:total`, data.bot.stat.recv_msg_cnt);
        } catch { }

        return data;
    }

    /**
     * 构造Discord消息回传给Discord
     * @param {Object} data | 指定回传的信息, 可能是群信息, 也可能是私聊信息, 也可以是传入的e
     * @param {Array|String|Object} message | 消息内容
     * @param {Boolean} quote | 是否引用回复
     * @returns {Object} | 返回构造好的消息对象
     */
    async icqqToDc(data, message, quote = false) {
        const cfg = YAML.parse(fs.readFileSync(this.cfgPath, "utf8"));
        if (!Array.isArray(message)) { message = [message]; }

        let content = "";
        let attach = [];
        const embed = [];
        let buttons = [];


        let logMsg = "";
        let quoteMsg;

        for (let item of message) {
            if (typeof item != "object") { item = { type: "text", text: item }; }
            if (!item.type && item?.data?.type === "test" && item?.data?.text === "forward") { item.type = "node"; item.data = item.msg }
            else if (Array.isArray(item)) {
                const itm = await this.icqqToDc(data, item, false);
                item.length > 1 ? content += itm.content.toString() + '\n' : content += itm.content;
                itm.attach.length > 0 ? attach = attach.concat(itm.attach) : '';
                itm.buttons.length > 0 ? buttons.concat(itm.buttons) : '';
                itm.logMsg ? logMsg += itm.logMsg : '';
                continue;
            }

            switch (item.type) {
                // 文本消息
                case "text":
                    if (_.isEmpty(item.text)) { continue; }
                    logMsg += `[文本消息: ${item.text}]`;
                    content += item.text;
                    try { await common.MsgTotal(data.self_id, "Discord"); } catch { }
                    break;

                // 图片消息
                case "image":
                    logMsg += `[图片消息]`;
                    attach.push(new AttachmentBuilder(
                        item.file.toString().startsWith("file:") ? item.file.toString().replace(/^file:(\\\\|\/\/)/, "") : item.file,
                        {
                            name: item?.name
                                || typeof item.file === "string"
                                ? item.file.split("/")?.pop()
                                : "image.webp"
                        }
                    ));

                    try {
                        await common.MsgTotal(data.self_id, "Discord", "image");
                        Bot[data.self_id].stat.send_img_cnt++;
                        redis.set(`Yz:count:send:image:bot:${data.self_id}:total`, Bot[data.self_id].stat.send_img_cnt);
                    } catch { }
                    break;

                // 语音消息
                case "record":
                    logMsg += `[语音消息]`;
                    attach.push(
                        new MessageAttachment(
                            item.file.toString().startsWith("file:") ? item.file.toString().replace(/^file:(\\\\|\/\/)/, "") : item.file,
                            { name: item?.name || typeof item.file === "string" ? item.file.split("/").pop() : "record.mp3" }
                        )
                    );

                    break;

                // 视频消息
                case "video":
                    logMsg += `[视频消息]`;
                    attach.push(
                        new MessageAttachment(
                            item.file.toString().startsWith("file:") ? item.file.toString().replace(/^file:(\\\\|\/\/)/, "") : item.file,
                            { name: item?.name || typeof item.file === "string" ? item.file.split("/")?.pop() : "video.mp4" }
                        )
                    );
                    break;

                // 文件消息
                case "file":
                    logMsg += `[文件消息]`;
                    attach.push(
                        new MessageAttachment(
                            item.file.toString().startsWith("file:") ? item.file.toString().replace(/^file:(\\\\|\/\/)/, "") : item.file,
                            { name: item?.name || typeof item.file === "string" ? item.file.split("/")?.pop() : "file" }
                        )
                    );
                    break;

                // 回复消息
                case "reply":
                    logMsg += `[回复消息: ${item.text}]`;
                    quote = ture;
                    content += item.text;
                    break;

                // at消息
                case "at":
                    if (item.id === "all") {
                        content += "@everyone ";
                        logMsg += "@everyone ";
                    } else if (item.id === "here") {
                        content += "@here ";
                        logMsg += "@here ";
                    } else {
                        content += `<@${item.id.replace(/^dc_/, "")}> `;
                        logMsg += `@${item.id} `;
                    }
                    break;

                // 转发消息
                case "node":
                    for (const itm of item.data) {
                        const msg = await this.icqqToDc(data, itm);
                        if (msg.logMsg) { logMsg += msg.logMsg; }
                        if (msg.content) { content += msg.content; }
                        if (msg.attach) { attach.push(...msg.attach); }
                    }
                    break;

                // 按钮消息
                case "button":
                    if (!cfg.sendButton) { break; }

                    if (Array.isArray(item.data)) {
                        for (let btl of item.data) {
                            const row = new ActionRowBuilder();
                            if (btl.length === 0) { continue; }
                            else if (btl.length > 5) {
                                btl = btl.slice(0, 5);
                                common.warn(data.self_id, `按钮数量超过5个, 超过部分将被忽略`);
                            }

                            if (Array.isArray(btl)) {
                                for (const btn of btl) {
                                    if (btn.callback) {
                                        row.addComponents(
                                            new ButtonBuilder()
                                                .setCustomId(btn.callback)
                                                .setLabel(btn.text)
                                                .setStyle("Primary")
                                        );
                                    }
                                    else if (btn.url) {
                                        row.addComponents(
                                            new ButtonBuilder()
                                                .setURL(btn.url)
                                                .setLabel(btn?.text || btn.url)
                                                .setStyle("Link")
                                        );
                                    }
                                    else if (btn.input) {
                                        // TODO: 可能需要添加输入框
                                    }
                                    else { common.warn(data.self_id, `未知按钮类型: ${btn}`); }
                                }
                            }
                            else { common.error(data.self_id, `按钮消息格式错误: ${btl}`); break; }

                            if (row.components.length === 0) { continue; }
                            buttons.push(row);
                        }
                    }

                    else if (typeof item.data === "object") {
                        const row = new ActionRowBuilder();
                        if (item.data.callback) {
                            row.addComponents(
                                new ButtonBuilder()
                                    .setCustomId(item.data.callback)
                                    .setLabel(item.data.text)
                                    .setStyle("Primary")
                            );
                        }
                        else if (item.data.url) {
                            row.addComponents(
                                new ButtonBuilder()
                                    .setURL(item.data.url)
                                    .setLabel(item.data?.text || item.data.url)
                                    .setStyle("Link")
                            );
                        }
                        else if (item.data.input) {
                            // TODO: 可能需要添加输入框
                        }
                        else { common.warn(data.self_id, `未知按钮类型: ${item.data}`); break; }
                        buttons.push(row);
                    }

                    else { common.error(data.self_id, `按钮消息格式错误: ${item.data}`); }

                    break;

                // Markdown消息, 没收到过Markdown的消息, 用到的时候再看.
                case "markdown":
                    content += item.text;
                    logMsg += `[Markdown消息: ${item.text}]`;
                    break;

                // 原始消息
                case "raw":
                    content += item.text;
                    logMsg += `[原始消息: ${item.text}]`;
                    break;

                default:
                    common.warn(data.self_id, `未知消息类型: ${item.type}`);
                    content += item.text;
                    logMsg += `[未知消息类型: ${item.type}]`;
                    try { await common.MsgTotal(data.self_id, "Discord"); } catch { }
                    break;
            }
        }

        // 引用回复
        if (quote && data.message_id) {
            let targetMsg;
            if (data.group_id) {
                targetMsg = await data.channel.messages.fetch(data.message_id);
            } else {
                targetMsg = await data.channel.dmChannel.messages.fetch(data.message_id);
            }

            quoteMsg = new EmbedBuilder()
                .setColor("#0099ff")
                .setDescription(`引用 ${targetMsg.author?.globalName || targetMsg.author.username} 的消息:`)
                .addFields({ name: "消息内容", value: targetMsg.content });

            embed.push(quoteMsg);
        }

        // 按钮消息
        if (buttons.length > 0) { logMsg += `[按钮消息]`; }
        if (buttons.length > 5) {
            common.warn(data.self_id, `按钮数量超过5行, 超过部分将被忽略`);
            buttons = buttons.slice(0, 5);
        }

        return {
            content,
            attach,
            buttons,
            embeds: embed,
            ephemeral: quote,
            logMsg
        };
    }

    /**
     * 按钮回调
     * @param {String} id | 机器人id
     * @param {Object} data | 按钮数据
     * @returns {Object} | 返回按钮回调结果
     */
    async ButtonCallback(id, data) {
        if (data.type === 3) {
            const event = Object.assign(data);
            event.type = 0;
            event.content = data.customId;
            event.author = data.user;

            return await this.dcToIcqq(id, event);
        }
        else { common.warn(id, `未知按钮类型: ${data.type}`); }
    }

    /**
     * 消息更新
     * @param {String} id | 机器人id
     * @param {Object} oldData | 旧消息
     * @param {Object} newData | 新消息
     * @returns {Object|Boolean} | 返回更新消息结果
     */
    async messageUpdate(id, oldData, newData) {
        if (oldData.content === newData.content) { return false; }

        common.info(id, `${oldData.author.username}(${oldData.author.id}) 更新了消息: ${oldData.content} -> ${newData.content}`);

        const event = Object.assign(newData);
        event.author = oldData.author;

        return await this.dcToIcqq(id, event);
    }

    /**
     * 发送消息
     * @param {Object} data 发送目标
     * @param {Array|String|Object} message 消息内容
     * @param {Boolean} quote 是否引用回复
     * @returns {Object|Boolean} | 返回发送结果
     */
    async sendMsg(data, message, quote = false) {
        const { content, attach, buttons, embeds, ephemeral, logMsg } = await this.icqqToDc(data, message, quote);

        const msg = new MessagePayload(data.channel, {
            content,
            embeds,
            components: buttons,
            files: attach,
            ephemeral,
        });

        if (data.group_id) {
            data.group_id = data.group_id.toString().replace(/^dc_/, "");
        }
        if (data.user_id) {
            data.user_id = data.user_id.replace(/^dc_/, "");
        }

        common.info(data.self_id, `发送消息: ${logMsg}`);

        let res;
        let channel;

        // 定义发送频道
        if (data.channel) {
            channel = data.channel;
        } else {
            channel = Bot[data.self_id].sdk[data.group_id ? "channels" : "users"].cache.get(data.group_id);
        }

        // 发送消息
        try {
            res = await channel.send(msg);
        } catch (err) {
            common.error(data.self_id, `发送消息失败: ${err}`);
            return false;
        }

        return { data: res, message_id: res.id };
    }

    /**
     * 成员加入狐雾器(进群事件)
     * @param {String} id | 机器人id
     * @param {Object} member | 成员信息
     * @returns {Promise<void>}
     */
    async guildMemberAdd(id, member) {
        common.info(id, `新成员加入: ${member.author?.globalName || member.author?.username}(${member.user.id})`);

        // 重新加载下群成员信息
        await this.loadMembers(id);

        return {
            group: this.pickGroup(id, `dc_${member.channelId}`),
            group_id: `dc_${member.channelId}`,
            nickname: `${member.author?.globalName || member.author?.username || "未知用户"}`,
            notice_type: "group",
            post_type: "notice",
            request_type: "increase",
            user_id: `dc_${member.author.id}`
        };
    }

    /**
     * 获取群对象
     * @param {String} id
     * @param {String|Number} group_id
     * @returns {Object} | 返回群对象
     */
    pickGroup(id, group_id) {
        if (!group_id) { common.error(id, `获取群失败: group_id不能为空`); return false; }

        if (!group_id.startsWith("dc_")) {
            group_id = `dc_${group_id}`;
        }
        const groupInfo = Bot[id].gl.get(group_id);

        const group = {
            ...groupInfo,
            channel: Bot[id].sdk.channels.cache.get(group_id.replace(/^dc_/, "")),
            group_id: groupInfo.id,
            group_name: groupInfo.name || group_id,
            self_id: id,
            bot: Bot[id],
        }

        return {
            ...group,
            sendMsg: (message, quote = false) => this.sendMsg(group, message, quote),
            sendFile: file => this.sendMsg(group, { type: "file", file }),
            // 频道没有图标, 用频道图标代替
            getAvatarUrl: () => { return groupInfo.guild.iconURL() },
            makeForwardMsg: message => this.makeForwardMsg(id, message),
            recallMsg: message_id => group.channel.messages.fetch(message_id).then(msg => msg.delete()).catch(err => common.error(id, `撤回消息失败: ${err}`)),
            pickMember: user_id => this.pickMember(id, group_id, user_id),
            getChatHistory: async message_id => this.getChatHistory(id, group, message_id),
            getMemberMap: async () => await Bot[id].gml.get(`dc_${groupInfo.guildId}`),
        };
    }

    /**
     * 获取群成员对象
     * @param {String} id 机器人id
     * @param {String|Number} group_id 群id
     * @param {String|Number} user_id 用户id
     * @returns {Object} | 返回群成员对象
     */
    pickMember(id, group_id, user_id) {
        if (!group_id || !user_id) { common.error(id, `获取群成员失败: group_id和user_id不能为空`); return false; }

        if (typeof user_id === "string" && !group_id.startsWith("dc_")) {
            group_id = `dc_${group_id}`;
        } else if (typeof group_id === "number") { group_id = `dc_${group_id}`; }

        if (typeof user_id === "string" && !user_id.startsWith("dc_")) {
            user_id = `dc_${user_id}`;
        } else if (typeof user_id === "number") { user_id = `dc_${user_id}`; }
        const groupInfo = Bot[id].gl.get(group_id);
        // 机器人本身无法直接被获取到, 需要特殊处理
        let userInfo;
        if (user_id !== id) {
            userInfo = getUserInfo(id, user_id);
        }
        else {
            userInfo = {};
            userInfo.id = id;
            userInfo.user = {
                id: id.replace(/^dc_/, ""),
                bot: true,
                system: false,
                username: Bot[id].nickname,
                globalName: Bot[id].nickname,
                discriminator: "0",
                avatar: Bot[id].avatar,
                banner: undefined,
                card: Bot[id].nickname,
            }
        }

        const member = {
            ...userInfo,
            channel: Bot[id].sdk.channels.cache.get(group_id),
            self_id: id,
            bot: Bot[id],
            group_id: groupInfo.id,
            user_id: userInfo.id,
        }

        return {
            ...member,
            ...this.pickFriend(id, user_id),
            getInfo: () => { return userInfo },
            getAvatarUrl: () => { return user_id === id ? Bot[id].avatar : userInfo.user.avatarURL() },
        }
    }

    /**
     * 获取好友对象
     * @param {String} id 机器人id
     * @param {String|number} user_id 用户id
     * @returns {Object} | 返回好友对象
     */
    async pickFriend(id, user_id) {
        if (!user_id) { common.error(id, `获取好友失败: user_id不能为空`); return false; }

        if (typeof user_id === "string" && !user_id.startsWith("dc_")) {
            user_id = `dc_${user_id}`;
        } else if (typeof user_id === "number") { user_id = `dc_${user_id}`; }

        let friend;
        if (user_id !== id) {
            const userInfo = getUserInfo(id, user_id);
            let channel = Bot[id].sdk.users.cache.get(user_id.replace(/^dc_/, "")).dmChannel;
            if (!channel) { channel = await Bot[id].sdk.users.cache.get(user_id.replace(/^dc_/, "")).createDM(); }

            friend = {
                ...userInfo,
                channel,
                user_id: userInfo.id,
                user_name: userInfo.username,
                self_id: id,
                bot: Bot[id],
            }
        }
        else {
            const userInfo = Bot[id].user;
            friend = {
                ...userInfo,
                nickname: userInfo.name,
                user_name: userInfo.name,
                user_id: id,
                qq: id,
                sex: "unknown",
                bot: Bot[id],
                avatar: Bot[id].avatar,
                joinedTimestamp: Date.now()
            }
        }

        return {
            ...friend,
            sendMsg: (message, quote = false) => this.sendMsg(friend, message, quote),
            sendFile: file => this.sendMsg(friend, { type: "file", file }),
            getAvatarUrl: () => { return user_id === id ? userInfo.avatar : userInfo?.user?.avatarURL() },
            makeForwardMsg: message => this.makeForwardMsg(id, message),
            recallMsg: message_id => friend.channel.messages.fetch(message_id).then(msg => msg.delete()).catch(err => common.error(id, `撤回消息失败: ${err}`)),
            getChatHistory: message_id => this.getChatHistory(id, friend, message_id),
        };
    }

    /**
     * 获取历史消息, message_id或者count必须有一个
     * @param {String} id 机器人id
     * @param {Object} chat 消息来源对象
     * @param {String|Number} message_id 消息id
     * @param {Number} count 获取数量
     * @returns {Array} | 返回历史消息
     */
    async getChatHistory(id, chat, message_id = "", count = 0) {
        if (!message_id && !count) {
            common.error(id, `获取历史消息失败: message_id和count不能同时为空`);
            return [];
        }

        // 获取消息来源对象
        if (!chat.channel && chat.group_id !== null) {
            if (chat.group_id) {
                chat.channel = Bot[id].sdk.channels.cache.get(chat.group_id);
            } else {
                chat.channel = Bot[id].sdk.users.cache.get(chat.user_id).dmChannel;
            }
        }

        // 获取消息
        let targetMessage = message_id
            ? await chat.channel.messages.fetch(message_id)
            : await chat.channel.messages.fetch({ limit: count });

        // 添加chatHistoryFnc属性, 防止消息格式化时被过滤
        if (Array.isArray(targetMessage)) {
            targetMessage = targetMessage.map(item => item.chatHistoryFnc = true);
        } else { targetMessage.chatHistoryFnc = true; }

        // 格式化消息
        const formatMsg = Array.isArray(targetMessage)
            ? await Promise.all(targetMessage.map(async item => await this.dcToIcqq(id, item)))
            : await this.dcToIcqq(id, targetMessage);

        // 返回消息
        return Array.isArray(formatMsg) ? formatMsg : [formatMsg];
    }

    /**
     * 制作转发消息(图片消息)
     * @param {String} id | 机器人id
     * @param {Object} message | 消息对象
     * @returns {Object} | 返回转发消息对象(图片消息)
     */
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

    /**
     * 加载所有资源
     * @param {String} id 机器人id
     * @returns {Promise} | 返回Promise
     */
    async loadAllResources(id) {
        // 加载服务器信息
        await this.loadGuilds(id);

        // 加载频道信息
        await this.loadChannels(id);

        // 加载成员信息
        await this.loadMembers(id);

        // 加载角色信息
        await this.loadRoles(id);

        // 加载好友信息
        // await this.loadFriends(id);
    }

    /**
     * 加载服务器信息
     * @param {String} id 机器人id
     */
    async loadGuilds(id) {
        try {
            const guilds = await Bot[id].sdk.guilds.cache;
            guilds.forEach(guild => {
                guild.welcomeChannelId = guild.systemChannelId;
                Bot[id].guilds.set(`dc_${guild.id}`, guild);
            });
        } catch (err) {
            common.error(id, `加载服务器信息失败: ${err}`);
        }
    }

    /**
     * 加载频道信息
     * @param {String} id 机器人id
     */
    async loadChannels(id) {
        try {
            const guildList = Array.from(Bot[id].guilds.keys());
            await Promise.all(guildList.map(async guildId => {
                const guild = Bot[id].guilds.get(guildId);
                const channels = await guild.channels.cache;
                channels.forEach(channel => {
                    channel.owner = `dc_${guild.ownerId}`;
                    Bot[id].gl.set(`dc_${channel.id}`, channel);
                });
            }));
        } catch (err) {
            common.error(id, `加载频道信息失败: ${err}`);
        }
    }

    /**
     * 加载成员信息
     * @param {String} id 机器人id
     */
    async loadMembers(id) {
        try {
            const guildList = Array.from(Bot[id].guilds.keys());
            await Promise.all(guildList.map(async guildId => {
                const guild = Bot[id].guilds.get(guildId);
                let members;

                if (botIntents.includes(GatewayIntentBits.GuildMembers)) {
                    members = await guild.members.fetch();
                } else { members = await guild.members.cache; }

                const memberMap = new Map();
                members.forEach(mem => {
                    mem.username = mem.user.username;
                    if (!mem.nickname) { mem.nickname = mem.user?.globalName || mem.user.username }
                    // memes要用到的奇怪属性.
                    mem.qq = `dc_${mem.id}`;
                    mem.sex = "unknown";
                    memberMap.set(`dc_${mem.id}`, mem);
                });

                Bot[id].gml.set(guildId, memberMap);
            }));
        } catch (err) {
            common.error(id, `加载频道信息失败: ${err}`);
        }
    }

    /**
     * 加载好友信息(暂不支持)
     * @param {String} id 机器人id
     */
    async loadFriends(id) {
        // 暂不支持
    }

    /**
     * 加载角色信息
     * @param {String} id 机器人id
     */
    async loadRoles(id) {
        try {
            const guildList = Array.from(Bot[id].guilds.keys());
            await Promise.all(guildList.map(async guildId => {
                const guild = Bot[id].guilds.get(guildId);
                const roles = await guild.roles.cache;
                const roleList = [];
                roles.forEach(role => {
                    roleList.push(role);
                });
                Bot[id].roles.set(guildId, roleList);
            }));
        } catch (err) {
            common.error(id, `加载角色信息失败: ${err}`);
        }
    }

    /**
     * 关🐔
     * @param {String} id 机器人id
     * @returns {Boolean} | 成功返回true, 否则返回false.
     */
    async stop(id) {
        // 关闭机器人
        try {
            await Bot[id].sdk.destroy();
            
            // 注销适配器
            Bot.adapter = Bot.adapter.filter(item => item !== id);

            common.info(id, `${id}下线成功`);
        } catch (error) {
            common.error(id, `下线失败: ${error}`);
            return false;
        }
    }
}

/**
 * 比较两个数组是否有交集, 有则返回true, 否则返回false
 * 用于判定用户权限
 * @param {Array} list1
 * @param {Array} list2
 * @returns {Boolean} | 有交集返回true, 否则返回false.
 */
function hasIntersection(list1, list2) {
    const set1 = new Set(list1);
    const set2 = new Set(list2);
    return [...set1].some(item => set2.has(item));
}

/**
 * 从gml中获取用户信息
 * @param {String} id | 机器人id
 * @param {String} user_id | 用户id, 如果不是以'dc_'开头, 那么会自动添加'dc_'
 * @returns {Object} | 返回用户信息
 */
function getUserInfo(id, user_id) {
    if (typeof user_id === "string" && !user_id.startsWith('dc_')) {
        user_id = `dc_${user_id}`;
    } else if (typeof user_id === "number") { user_id = `dc_${user_id}`; }

    let userInfo;
    for (const key of Bot[id].gml.keys()) {
        if (Array.from(Bot[id].gml.get(key).keys()).includes(user_id)) {
            userInfo = Bot[id].gml.get(key).get(user_id);
            break;
        }
    }

    if (!userInfo) {
        common.error(id, `未找到用户信息: ${user_id}`);
        return {};
    }
    return userInfo;
}

common.info("Lain-plugin", "Discord适配器加载成功");
