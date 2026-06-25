import fs from "fs";
import path from "path";
import YAML from "yaml";
import Discord from "../adapter/Discord/index.js";
import common from "../lib/common/common.js";

const discordCfgPath = path.join(process.cwd(), "plugins", "Lain-plugin", "config", "config", "Discord.yaml");
const discordDefPath = path.join(process.cwd(), "plugins", "Lain-plugin", "config", "defSet", "Discord.yaml");

// 初始化Discord配置文件
if (!fs.existsSync(discordCfgPath)) {
    fs.copyFileSync(discordDefPath, discordCfgPath);
}

export class discordCfg extends plugin {
    constructor() {
        const ruler = [
            {
                reg: /^#dc设置.*$/i,
                fnc: "dcCfg"
            },
            {
                reg: /^#dc(开启|启用|关闭|禁用)自动连接$/i,
                fnc: "dcAutoConnect"
            },
            {
                reg: /^#dc(开启|关闭|禁用)按钮发送$/i,
                fnc: "dcSendButton"
            },
            {
                reg: /^#dc(\d+)?上线$/i,
                fnc: "dcOnline"
            },
            {
                reg: /^#dc(\d+)?下线$/i,
                fnc: "dcOffline"
            },
            {
                reg: /^#dc(状态)?列表$/i,
                fnc: "botList"
            }
        ];

        super({
            name: "Discord设置",
            dsc: "Discord设置",
            event: "message",
            priority: 1,
            rule: ruler
        });
    }

    // 设置Discord
    async dcCfg(e) {
        if (!e.isMaster) { return false; }

        const reg = /^#dc设置(.*)$/;
        if (reg.exec(e.raw_message) === null) { return false; }
        const token = reg.exec(e.raw_message)[1].trim();

        const cfg = YAML.parse(fs.readFileSync(discordCfgPath, "utf8"));

        cfg.bot.push({
            id: cfg.bot.length + 1,
            uin: "",
            name: "",
            token: token
        });

        await fs.writeFileSync(discordCfgPath, YAML.stringify(cfg), "utf8");
        e.reply(`Discord设置成功, 正在尝试重新连接Discord`);

        const discord = new Discord();
        if (!cfg.autoConnect) { await discord.connect(token); }
    }

    // 开启/关闭Discord自动连接
    async dcAutoConnect(e) {
        if (!e.isMaster) { return false; }

        const cfg = YAML.parse(fs.readFileSync(discordCfgPath, "utf8"));
        cfg.autoConnect = /开启|启用/.test(e.raw_message);

        await fs.writeFileSync(discordCfgPath, YAML.stringify(cfg), "utf8");
        e.reply(`Discord自动连接${cfg.autoConnect ? "已开启" : "已关闭"}`);
    }

    // 开启/关闭Discord按钮发送
    async dcSendButton(e) {
        if (!e.isMaster) { return false; }

        const cfg = YAML.parse(fs.readFileSync(discordCfgPath, "utf8"));
        cfg.sendButton = /开启/.test(e.raw_message);

        await fs.writeFileSync(discordCfgPath, YAML.stringify(cfg), "utf8");
        e.reply([
            `Discord按钮发送${cfg.sendButton ? "已开启" : "已关闭"}`,
            `请手动将lib/plugins/loader.js中 'segment.button () => ""' 修改为 'segment.button = (...data) => { return { type: 'button', data: data } }'\n`,
            `请注意: 该修改会影响喵崽icqq的发送, 请谨慎修改\n`,
            `\n重启后生效~`
        ])
    }

    // Discord上线
    async dcOnline(e) {
        if (!e.isMaster) { return false; }

        const data = YAML.parse(fs.readFileSync(discordCfgPath, "utf8"));
        const num = parseInt(/^#dc(\d+)?上线$/.exec(e.raw_message)[1]);

        if (!data.bot || data.bot.length === 0) { e.reply("Discord账号未初始化, 请先使用 '#dc设置'+token 初始化账号"); return false; }
        else if (num === undefined || num === NaN) {
            for (const item of data.bot) {
                const dcInstance = new Discord();
                if (!data.autoConnect) { await dcInstance.connect(item.token); }
                common.sleep( 5 * 1000 );
            }
            e.reply("所有Discord账号已全部上线");
        }
        else if (num <= 0 || num > data.bot.length) { e.reply("序号错误"); return false; }
        else {
            const dcInstance = new Discord();
            if (!data.autoConnect) { await dcInstance.connect(data.bot[num - 1].token); }
            e.reply(`第${num}个Discord账号 ${data.bot[num - 1].name} 已上线`);
        }
    }

    // Discord下线
    async dcOffline(e) {
        if (!e.isMaster) { return false; }

        const num = parseInt(/^#dc(\d+)?下线$/.exec(e.raw_message)[1]);
        const dcList = Array.from(Bot?.adapter).filter(item => { return item.toString().startsWith('dc_') }) || [];

        if (num === undefined || num === NaN) {
            if (dcList.length === 0) { e.reply("目前没有Discord账号在线"); return false; }
            else { dcList.forEach(item => Bot[item].stop()); e.reply("Discord已全部下线"); }
        }
        else {
            if (num <= 0 || num > dcList.length) { e.reply("序号错误"); return false; }

            if (dcList.length === 0) { e.reply("目前没有Discord账号在线"); return false; }
            else {
                const discord = dcList[num - 1];
                
                const bot_id = Bot[discord].uin;
                const bot_name = Bot[discord].nickname;
                Bot[discord].stop();
                e.reply(`Discord ${bot_name}(${bot_id}) 已下线`);
            }
        }
    }

    // 显示Discord列表
    async botList(e) {
        if (!e.isMaster) { return false; }

        const cfg = YAML.parse(fs.readFileSync(discordCfgPath, "utf8"));
        const dcList = Array.from(Bot?.adapter).filter(item => { return item.toString().startsWith('dc_') }) || [];

        if (cfg.bot.length === 0) { e.reply("目前没有Discord账号"); return false; }

        let statusList = [];
        for (const item of cfg.bot) {
            statusList.push({ id: item.id, name: item.name, uin: item.uin, status: dcList.includes(item.uin) ? "在线" : "离线" });
        }

        e.reply(
            statusList.map(
                item => `ID: ${item.id}, 名称: ${item.name}, UIN: ${item.uin}, 状态: ${item.status}`
            ).join("\n")
        );
    }
}