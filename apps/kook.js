import YAML from "yaml";
import fs from "fs";
import path from "path";
import Kook from "../adapter/Kook/index.js";
import common from '../lib/common/common.js'

const kookCfgPath = path.join(process.cwd(), "plugins", "Lain-plugin", "config", "config", "Kook.yaml");
const kookDefPath = path.join(process.cwd(), "plugins", "Lain-plugin", "config", "defSet", "Kook.yaml");

// 初始化KOOK配置文件
if (!fs.existsSync(kookCfgPath)) {
    fs.copyFileSync(kookDefPath, kookCfgPath);
}

export class kookCfg extends plugin {
    constructor() {
        super({
            name: "KOOK设置",
            dsc: "KOOK设置",
            event: "message",
            priority: 1,
            rule: [
                {
                    reg: /^#kook设置.*$/i,
                    fnc: "kookCfg"
                },
                {
                    reg: /^#kook(开启|关闭|禁用)卡片发送$/i,
                    fnc: "kookSendCard"
                },
                {
                    reg: /^#kook(开启|关闭|禁用)按钮发送$/i,
                    fnc: "kookSendButton"
                },
                {
                    reg: /^#kook(开启|启用|关闭|禁用)自动连接$/i,
                    fnc: "kookAutoConnect"
                },
                {
                    reg: /^#kook(\d+)?上线$/i,
                    fnc: "kookOnline"
                },
                {
                    reg: /^#kook(\d+)?下线$/i,
                    fnc: "kookOffline"
                },
                {
                    reg: /^#kook(状态)?列表$/i,
                    fnc: "botList"
                }
            ]
        });
    }

    // 设置KOOK
    async kookCfg(e) {
        if (!e.isMaster) { return false; }

        const reg = /^#kook设置(.*)$/;
        if (reg.exec(e.raw_message) === null) { return false; }
        const token = reg.exec(e.raw_message)[1].trim();

        const cfg = YAML.parse(fs.readFileSync(kookCfgPath, "utf-8"));
        cfg.bot.push({ id: cfg.bot.length + 1, name: "", uin: "", token: token });
        await fs.writeFileSync(kookCfgPath, YAML.stringify(cfg));

        e.reply("KOOK设置成功, 正在尝试重新连接KOOK");
        const kookInstance = new Kook();
        if (!cfg.autoConnect) { kookInstance.connect(token); }
    }

    // 开启/关闭卡片发送
    async kookSendCard(e) {
        if (!e.isMaster) { return false; }

        const cfg = YAML.parse(fs.readFileSync(kookCfgPath, "utf-8"));
        cfg.sendCard = /开启/.test(e.raw_message) ? true : false;

        await fs.writeFileSync(kookCfgPath, YAML.stringify(cfg));
        e.reply(`KOOK卡片发送已${cfg.sendCard ? "开启" : "关闭"}, 重启后生效~`);
    }

    // 开启/关闭按钮发送
    async kookSendButton(e) {
        if (!e.isMaster) { return false; }

        const cfg = YAML.parse(fs.readFileSync(kookCfgPath, "utf-8"));
        cfg.sendButton = /开启/.test(e.raw_message);

        await fs.writeFileSync(kookCfgPath, YAML.stringify(cfg));
        e.reply([`KOOK按钮发送已${cfg.sendButton ? "开启" : "关闭"}\n`,
            `请手动将lib/plugins/loader.js中 'segment.button () => ""' 修改为 'segment.button = (...data) => { return { type: 'button', data: data } }'\n`,
            `请注意: 该修改会影响喵崽icqq的发送, 请谨慎修改\n`,
            `\n重启后生效~`
        ]);
    }

    // 开启/关闭Kook自动连接
    async kookAutoConnect(e) {
        if (!e.isMaster) { return false; }

        const cfg = YAML.parse(fs.readFileSync(kookCfgPath, "utf-8"));
        cfg.autoConnect = /开启|启用/.test(e.raw_message) ? true : false;

        await fs.writeFileSync(kookCfgPath, YAML.stringify(cfg));
        e.reply(`KOOK自动连接已${cfg.autoConnect ? "开启" : "关闭"}, 重启后生效~`);
    }

    // KOOK上线
    async kookOnline(e) {
        if (!e.isMaster) { return false; }

        const data = YAML.parse(fs.readFileSync(kookCfgPath, "utf-8"));
        const num = parseInt(/^#kook(\d+)?上线$/.exec(e.raw_message)[1]);

        if (!data.bot || data.bot.length === 0) { e.reply("KOOK账号未初始化, 请先使用 '#kook设置'+token 初始化账号"); return false; }
        else if (num === undefined || num === NaN) {
            for (const item of data.bot) {
                const kookInstance = new Kook();
                if (!data.autoConnect) { await kookInstance.connect(item.token); }
                common.sleep( 5 * 1000 );
            }
            e.reply(`所有Kook账号已全部上线`);
        }
        else if (num <= 0 || num > data.bot.length) {
            e.reply(`序号错误`);
        }
        else {
            const kookInstance = new Kook();
            if (!data.autoConnect) { await kookInstance.connect(data.bot[num - 1].token); }
            e.reply(`第${num}个Kook账号 ${data.bot[num -1].name} 已上线`);
        }
    }

    // KOOK下线
    async kookOffline(e) {
        if (!e.isMaster) { return false; }

        const num = parseInt(/^#kook(\d+)?下线$/.exec(e.raw_message)[1]);
        const kookList = Array.from(Bot?.adapter).filter(item => { return item.toString().startsWith('ko_') }) || [];

        if (num === undefined || num === NaN) {
            if (kookList.length === 0) {
                e.reply("目前没有KOOK账号在线");
                return false;
            } else { kookList.forEach(item => Bot[item].stop()); e.reply(`Kook已全部下线`); }
        }
        else {
            if (num <= 0 || num > kookList.length + 1) { e.reply(`序号错误`); return false; }

            if (kookList.length === 0) {
                e.reply("目前没有KOOK账号在线");
            } else {
                const kook = kookList[num - 1];

                const bot_id = Bot[kook].uin;
                const bot_name = Bot[kook].nickname;
                Bot[kook].stop();
                e.reply(`Kook - ${bot_name}(${bot_id})已下线`);
            }
        }
    }

    // 显示KOOK列表
    async botList(e) {
        if (!e.isMaster) { return false; }

        const kookList = Array.from(Bot.adapter).filter(item => { return item.toString().startsWith('ko_') }) || [];

        const cfg = YAML.parse(fs.readFileSync(kookCfgPath, "utf-8"));

        if (cfg.bot.length === 0) {
            e.reply("目前没有KOOK账号"); return false;
        }

        let statusList = [];
        for (const item of cfg.bot) {
            statusList.push({
                id: item.id,
                name: item.name,
                uin: item.uin,
                status: kookList.includes(item.uin) ? "在线" : "离线"
            })
        }

        e.reply(
            statusList.map(
                item => `ID: ${item.id}, 名称: ${item.name}, UIN: ${item.uin}, 状态: ${item.status}`
            ).join("\n")
        );
    }
}
