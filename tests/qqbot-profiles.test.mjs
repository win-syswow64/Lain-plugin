import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import QQBotIdMap from '../model/qqbot-id-map.js'
import QQBotProfiles from '../adapter/QQBot/Profiles.js'
import GroupMembers from '../adapter/QQBot/GroupMembers.js'
import { normalizeMentions } from '../adapter/QQBot/Mentions.js'
import { installQQBotAPIPolicy } from '../adapter/QQBot/APIPolicy.js'

// 使用真实对象方法，隔离云崽启动与 QQ 网络请求。
const source = fs.readFileSync(new URL('../adapter/QQBot/index.js', import.meta.url), 'utf8')
const methods = ['pickGroup(groupID, source = {}) {', 'pickFriend(userId, source = {}) {',
  'pickMember(groupID, userID) {', 'member(groupId, userId) {', 'getAvatarUrl(size = 0, id, groupId) {',
  'async handleNotice (event, data = {}) {']
  .map(start => {
    const offset = source.indexOf(`  ${start}`)
    const end = source.indexOf('\n  }', offset)
    assert(offset >= 0 && end > offset)
    return source.slice(offset, end) + '\n  }'
  }).join('\n')
const Harness = new Function('QQBotIdMap', `return class { ${methods} }`)(QQBotIdMap)
const app = '123456789'
const prefixed = id => `${app}-${id}`

function fixture (get = async () => { throw new Error('Unexpected network request') }) {
  QQBotIdMap.loaded = true
  QQBotIdMap.saveSoon = () => {}
  QQBotIdMap.data = { users: { [app]: {
    [prefixed('PRIVATE')]: { user_openid: prefixed('PRIVATE'), qq: 10001, c2c: true, nickname: '旧昵称', groups: {} },
    [prefixed('MEMBER')]: { user_openid: prefixed('MEMBER'), qq: 10001, nickname: '旧昵称', groups: {
      [prefixed('GROUP')]: { card: '旧名片', group_qq: 20001 },
      [prefixed('OTHER')]: { card: '另一个群', group_qq: 20002 }
    } }
  } }, groups: { [app]: {
    [prefixed('GROUP')]: { group_openid: prefixed('GROUP'), group_qq: 20001 },
    [prefixed('OTHER')]: { group_openid: prefixed('OTHER'), group_qq: 20002 }
  } }, enabled_groups: { [app]: { [prefixed('GROUP')]: { enabled: true }, [prefixed('OTHER')]: { enabled: true } } },
  bots: { [app]: { qq_self_id: 30001 } }, features: {} }
  globalThis.logger = { debug () {}, warn () {}, error () {} }
  globalThis.lain = { info () {}, warn () {} }
  globalThis.Bot = { [app]: { fl: new Map(), gl: new Map(), gml: new Map(), config: { appid: app }, adapter: 'QQBot' },
    30001: { uin: 30001, adapter: 'icqq', fl: new Map(), gl: new Map(), gml: new Map() },
    fl: new Map(), gl: new Map(), adapter: [], emit: async () => {} }
  const adapter = new Harness()
  adapter.id = app
  adapter.stripQQBotId = id => String(id ?? '').replace(new RegExp(`^${app}-`), '')
  adapter.formatQQBotId = id => prefixed(adapter.stripQQBotId(id))
  adapter.resolveOpenid = async (id, type) => {
    const raw = adapter.stripQQBotId(id)
    if (!QQBotIdMap.normalizeQQ(raw)) return raw
    const bound = type === 'group' ? QQBotIdMap.findGroupByQQ(app, raw) : QQBotIdMap.findUserByQQ(app, raw, { preferPrivate: true })
    if (!bound) throw new Error('Missing C2C binding')
    return adapter.stripQQBotId(type === 'group' ? bound.group_openid : bound.user_openid)
  }
  adapter.sdk = { request: { get } }
  adapter.groupBotStateCache = new Map()
  adapter.profilesAPI = new QQBotProfiles(adapter)
  adapter.membersAPI = new GroupMembers(adapter)
  Bot[app].pickGroup = (...args) => adapter.pickGroup(...args)
  Bot[app].pickFriend = (...args) => adapter.pickFriend(...args)
  return adapter
}

test('new user endpoint resolves only the C2C mapping, deduplicates and preserves false', async () => {
  const requests = []
  const adapter = fixture(async path => {
    requests.push(path)
    await new Promise(resolve => setTimeout(resolve, 5))
    return { data: { username: '新昵称', avatar: 'https://example.com/avatar', union_openid: 'UNION', allow_proactive_msg: false } }
  })
  const friend = adapter.pickFriend(10001)
  const [a, b] = await Promise.all([friend.getInfo(), friend.getSimpleInfo()])
  assert.deepEqual(a, b)
  assert.equal(a.user_id, 10001)
  assert.equal(a.user_openid, 'PRIVATE')
  assert.equal(a.allow_proactive_msg, false)
  assert.equal(friend.nickname, '新昵称')
  assert.equal(friend.getAvatarUrl(), 'https://example.com/avatar')
  assert.equal(friend.info.union_openid, 'UNION')
  assert.equal(Bot[30001].fl.get(10001).allow_proactive_msg, false)
  await friend.getInfo()
  assert.deepEqual(requests, ['/v2/users/PRIVATE/info'])
  await friend.renew()
  assert.equal(requests.length, 2)
  assert.equal(QQBotIdMap.data.users[app][prefixed('MEMBER')].nickname, '旧昵称')
})

test('group query updates live ICQQ properties without replacing identity with a union ID', async () => {
  const adapter = fixture(async path => {
    assert.equal(path, '/v2/groups/GROUP/info')
    return { data: { group_name: '读书会', group_member_num: 0, group_finger_memo: '介绍', group_class_text: '文化', group_tags: ['阅读'], union_group_openid: 'UNION_GROUP' } }
  })
  const group = adapter.pickGroup(20001)
  await group.renew()
  assert.equal(group.name, '读书会')
  assert.equal(group.info.group_id, 20001)
  assert.equal(group.info.group_openid, 'GROUP')
  assert.equal(group.info.member_count, 0)
  assert.equal(group.info.group_memo, '介绍')
  assert.deepEqual(group.info.group_tags, ['阅读'])
  assert.equal(group.union_group_openid, 'UNION_GROUP')
  assert.equal(Bot[app].gl.get(prefixed('GROUP')).group_name, '读书会')
  assert.equal(Bot[30001].gl.get(20001).union_group_openid, 'UNION_GROUP')
})

test('member nickname, avatar and role are scoped by group and survive older API responses', async () => {
  const adapter = fixture(async () => ({ data: { member_openid: 'MEMBER', username: '新昵称', member_role: 'admin' } }))
  adapter.membersAPI.observe('GROUP', { member_openid: 'MEMBER', username: '新昵称', member_nickname: '群名片', avatar: 'https://example.com/member', member_role: 'owner', union_openid: 'USER_UNION' }, 123)
  const member = adapter.pickMember(20001, 10001)
  assert.equal(member.info.card, '群名片')
  assert.equal(member.getAvatarUrl(), 'https://example.com/member')
  assert.equal(member.info.last_sent_time, 123)
  assert.equal(adapter.membersAPI.peek('OTHER', 10001).card, '另一个群')
  await member.renew()
  assert.equal(member.avatar, 'https://example.com/member')
  assert.equal(member.card, '群名片')
  assert.equal(member.is_admin, true)
  assert.equal(member.is_owner, false)
  adapter.membersAPI.observe('GROUP', { member_openid: 'MEMBER', member_nickname: '', avatar: '' })
  assert.equal(adapter.membersAPI.peek('GROUP', 10001).card, '')
  assert.equal(adapter.membersAPI.peek('GROUP', 10001).avatar, 'https://example.com/member')
  adapter.membersAPI.observed.clear()
  assert.equal(adapter.membersAPI.peek('GROUP', 'MEMBER').avatar, 'https://example.com/member')
})

test('ICQQ source events cannot overwrite official sender fields or hide profile APIs', async () => {
  const adapter = fixture()
  const official = { nickname: '官方昵称', card: '官方名片', member_nickname: '官方名片', avatar: 'https://example.com/official', union_openid: 'UNION', role: 'admin' }
  adapter.membersAPI.observe('GROUP', { member_openid: 'MEMBER', username: official.nickname, ...official })
  adapter.profilesAPI.observeGroup('GROUP', { union_group_openid: 'UNION_GROUP', group_name: '官方群名' })
  const e = { self_id: app, bot: Bot[app], user_id: prefixed('MEMBER'), user_openid: 'MEMBER', group_id: prefixed('GROUP'), group_openid: 'GROUP',
    message_type: 'group', post_type: 'message', message_id: 'MESSAGE', raw_message: '你好', message: [{ type: 'text', text: '你好' }],
    sender: { ...official }, qqbot_sender: { ...official }, member: adapter.member('GROUP', 'MEMBER'), group: adapter.pickGroup('GROUP') }
  QQBotIdMap.applyQQMapping(e, { qq: 10001, group_qq: 20001, qq_self_id: 30001,
    source_event: { sender: { nickname: '旧昵称', card: '旧名片' }, member: { nickname: '旧昵称' }, group: {} } })
  assert.equal(e.sender.nickname, '官方昵称')
  assert.equal(e.member.info.card, '官方名片')
  assert.equal(e.member.info.avatar, official.avatar)
  assert.equal(e.member.info.user_id, 10001)
  assert.equal(e.group.info.group_id, 20001)
  assert.equal(e.group.union_group_openid, 'UNION_GROUP')
  assert.equal(e.getAvatarUrl(), official.avatar)
  assert.equal(typeof e.group.renew, 'function')
  assert.equal(Bot[30001].gml.get(20001).get(10001).avatar, official.avatar)
})

test('user lookup failures propagate instead of returning cached success or guessing identity', async () => {
  let failure = Object.assign(new Error('no friendship'), { code: 40184001 })
  const adapter = fixture(async () => { throw failure })
  adapter.profilesAPI.observeUser('PRIVATE', { username: '缓存昵称', avatar: 'https://example.com/old' })
  await assert.rejects(adapter.pickFriend(10001).getInfo(), error => error.code === 40184001 && /无好友关系/.test(error.message))
  failure = new Error('timeout')
  await assert.rejects(adapter.pickFriend(10001).getInfo(), /timeout/)
  delete QQBotIdMap.data.users[app][prefixed('PRIVATE')]
  await assert.rejects(adapter.pickFriend(10001).getInfo(), /Missing C2C binding/)
})

test('missing official fields preserve the paired ICQQ nickname, card and role', () => {
  const adapter = fixture()
  const e = { self_id: app, bot: Bot[app], user_id: prefixed('MEMBER'), user_openid: 'MEMBER',
    group_id: prefixed('GROUP'), group_openid: 'GROUP', message_type: 'group', post_type: 'message',
    message_id: 'MESSAGE', raw_message: '你好', message: [{ type: 'text', text: '你好' }],
    sender: {}, qqbot_sender: {}, member: {}, group: adapter.pickGroup('GROUP') }
  QQBotIdMap.applyQQMapping(e, { qq: 10001, group_qq: 20001, qq_self_id: 30001,
    source_event: { sender: { nickname: '原生昵称', card: '原生名片', role: 'admin' },
      member: { role: 'admin' }, group: {} } })
  assert.equal(e.sender.nickname, '原生昵称')
  assert.equal(e.sender.card, '原生名片')
  assert.equal(e.sender.role, 'admin')
  assert.equal(e.member.is_admin, true)
})

test('11253 from user info uses a readable API name', async () => {
  const sdk = { config: { appid: app }, request: { get: async () => ({ data: { err_code: 11253, message: '应用无接口访问权限' } }) } }
  installQQBotAPIPolicy(sdk)
  await assert.rejects(sdk.request.get('/v2/users/PRIVATE/info'), /当前机器人暂无获取用户基本信息接口权限/)
})

test('mentions use group nicknames in both text and existing at segments', () => {
  const mentions = [{ member_openid: 'MEMBER', username: '账号昵称', member_nickname: '群名片' }]
  for (const input of [[{ type: 'text', text: '<@MEMBER>' }], [{ type: 'at', qq: 'MEMBER' }]]) {
    assert.equal(normalizeMentions(input, mentions)[0].text, '@群名片')
  }
})

test('member notices preserve group union IDs through ICQQ mapping and invalidate departed members', async () => {
  const adapter = fixture()
  const emitted = []
  Bot.emit = async (type, event) => { emitted.push({ type, event }) }
  adapter.membersAPI.observe('GROUP', { member_openid: 'MEMBER', username: '昵称' })
  await adapter.handleNotice('notice.group.decrease', {
    qqbot_event_type: 'GROUP_MEMBER_REMOVE', group_openid: 'GROUP', member_openid: 'MEMBER',
    union_group_openid: 'UNION_GROUP', timestamp: 123
  })
  const notice = emitted.find(item => item.type === 'notice.group.decrease').event
  assert.equal(notice.group_id, 20001)
  assert.equal(notice.user_id, 10001)
  assert.equal(notice.union_group_openid, 'UNION_GROUP')
  assert.equal(notice.group.union_group_openid, 'UNION_GROUP')
  assert.equal(adapter.membersAPI.observed.size, 0)
  assert.equal(Bot[30001].gml.get(20001).size, 0)
})

test('C2C ICQQ wrapper retains query APIs, proactive false, and reply context', async () => {
  const adapter = fixture(async () => ({ data: { username: '私聊新昵称', avatar: 'https://example.com/private', allow_proactive_msg: false } }))
  adapter.profilesAPI.observeUser('PRIVATE', { username: '消息昵称', avatar: 'https://example.com/incoming' })
  const friend = adapter.pickFriend('PRIVATE', { messageId: 'INCOMING' })
  const e = { self_id: app, bot: Bot[app], user_id: prefixed('PRIVATE'), user_openid: 'PRIVATE',
    message_type: 'private', post_type: 'message', message_id: 'INCOMING', raw_message: '你好',
    message: [{ type: 'text', text: '你好' }], sender: { nickname: '消息昵称' },
    qqbot_sender: { nickname: '消息昵称', card: '', avatar: 'https://example.com/incoming' }, friend }
  QQBotIdMap.applyQQMapping(e, { qq: 10001, qq_self_id: 30001 })
  const info = await e.friend.getInfo()
  assert.equal(info.user_id, 10001)
  assert.equal(info.allow_proactive_msg, false)
  assert.equal(e.friend.nickname, '私聊新昵称')
  assert.equal(e.friend.getAvatarUrl(), 'https://example.com/private')
  let sent
  adapter.sendFriendMsg = async (...args) => { sent = args }
  await e.friend.sendMsg('回复')
  assert.equal(sent[2].messageId, 'INCOMING')
})
