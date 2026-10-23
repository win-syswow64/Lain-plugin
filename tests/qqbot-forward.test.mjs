import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { atTarget, isAtAll } from '../adapter/QQBot/Mentions.js'
import { getMessagePolicy, getMessageVariants, getSmallSetting, withMicroKeyboard } from '../adapter/QQBot/MessagePolicy.js'

// Load the actual methods without starting YunZai, the gateway, or external services.
const source = fs.readFileSync(new URL('../adapter/QQBot/index.js', import.meta.url), 'utf8')
const commonSource = fs.readFileSync(new URL('../lib/common/common.js', import.meta.url), 'utf8')
function extract (source, start, end) {
  const offset = source.indexOf(start)
  const limit = source.indexOf(end, offset)
  assert(offset >= 0 && limit > offset, `Missing source boundary: ${start}`)
  return source.slice(offset, limit) + end
}

const Bot = {
  getUrls: text => String(text).match(/https?:\/\/[^\s)]+/g) || [],
  Button: buttons => [{ type: 'button', data: buttons }]
}
const common = new Function('fs', 'Bot', 'log', `
  ${extract(commonSource, 'function array (data) {', '\n}')}
  ${extract(commonSource, 'async function makeForwardMsg (', '\n}')}
  return { array, makeForwardMsg, log () {} }
`)(fs, Bot, () => {})
const methods = [
  'async getQQBot(data, e) {',
  'async makeMarkdownContent(e, data, options = {}) {',
  'async makeMarkdownSegment(e, data, options = {}) {',
  'async makeMarkdownMessage(e, data, options = {}) {',
  'parseMqqapiInlineCommand (link) {',
  'extractMqqapiInlineCommands (content) {',
  'HandleURL(msg) {'
].map(start => extract(source, `  ${start}`, '\n  }')).join('\n')
const Harness = new Function('common', 'Bot', 'Cfg', 'getSmallSetting', 'getMessagePolicy', 'withMicroKeyboard', 'isAtAll', 'atTarget', `
  return class { ${methods} }
`)(common, Bot, { WhiteLink: [] }, getSmallSetting, getMessagePolicy, withMicroKeyboard, isAtAll, atTarget)

function harness () {
  const adapter = new Harness()
  Object.assign(adapter, {
    id: 'test', config: {}, stripQQBotId: value => value,
    normalizeButtons (_, input) {
      const buttons = Array.isArray(input) ? input.flat() : input?.data || []
      return buttons.length ? [{ buttons }] : []
    },
    async getImage (file) {
      return file === 'animation.gif'
        ? { type: 'image', file, animated: true }
        : { type: 'image', file: 'https://example.com/image.webp', width: 36, height: 24 }
    },
    markdownImageURL: value => value,
    async getAudio (file) { return { type: 'audio', file } },
    async getVideo (file) { return { type: 'video', file } }
  })
  return adapter
}

const forward = text => ({ type: 'forward', text })
const text = text => ({ type: 'text', text })
const inline = '[绑定](mqqapi://aio/inlinecmd?command=%23绑定&enter=false)'

test('Markdown separates forward nodes and preserves ordinary text concatenation', async () => {
  const adapter = harness()
  assert.equal(await adapter.makeMarkdownContent({}, [forward('甲'), forward('乙')]), '甲\n乙\n')
  assert.equal(await adapter.makeMarkdownContent({}, [text('甲'), text('乙')]), '甲乙')
  assert.equal(await adapter.makeMarkdownContent({}, [forward('甲\n'), forward('乙\n')]), '甲\n乙\n')
  assert.equal(await adapter.makeMarkdownContent({}, [forward('甲\n内部换行'), text('乙')]), '甲\n内部换行\n乙')
  assert.equal(await adapter.makeMarkdownContent({}, [forward(''), text('乙')]), '乙')
})

test('Markdown still escapes literal mentions and omits C2C mention segments', async () => {
  const adapter = harness()
  assert.equal(await adapter.makeMarkdownContent({}, [forward('@用户 <qqbot-test>')]), '@\u200B用户 <qqbot-\u200Btest>\n')
  assert.equal(await adapter.makeMarkdownContent({}, [{ type: 'at', qq: 'all' }, forward('甲')]), '甲\n')
  assert.equal(await adapter.makeMarkdownContent({ group_id: 'group' }, [{ type: 'at', qq: 'all' }, forward('甲')]), '<qqbot-at-everyone />甲\n')
})

for (const event of [{ group_id: 'group' }, { friend: true }]) {
  const scene = event.group_id ? 'group' : 'C2C'
  test(`${scene}: real forwarded message reaches both Markdown entry points with line breaks`, async () => {
    const adapter = harness()
    const message = await common.makeForwardMsg([{ message: '甲' }, { message: ['乙', '丙'] }])
    assert.equal((await adapter.makeMarkdownMessage(event, message))[0].content, '甲\n乙\n丙')
    const result = await adapter.getQQBot(message, event)
    assert.deepEqual(result.Pieces, [[{ type: 'markdown', content: '甲\n乙\n丙\n' }]])
  })
}

test('normal send path does not duplicate existing line breaks or alter ordinary text', async () => {
  const adapter = harness()
  const result = await adapter.getQQBot([forward('甲\n'), forward('乙\n'), text('丙'), text('丁')], {})
  assert.equal(result.Pieces[0][0].content, '甲\n乙\n丙丁')
  assert.equal((await adapter.getQQBot([forward('  '), forward('甲')], {})).Pieces[0][0].content, '甲\n')
})

test('inline command extraction preserves forward boundaries and button-only nodes add no blank line', async () => {
  const adapter = harness()
  const result = await adapter.getQQBot([forward(`甲${inline}`), forward(inline), forward('乙')], {})
  assert.equal(result.Pieces[0][0].content, '甲\n乙\n')
  const keyboard = result.Pieces[0][1]
  assert.equal(keyboard.type, 'keyboard')
  assert.equal(keyboard.content.rows.length, 2)
  assert.equal(keyboard.content.rows[0].buttons[0].input, '#绑定')
  assert.equal(keyboard.content.rows[0].buttons[0].send, false)
  const markdown = await adapter.makeMarkdownMessage({}, [forward(`甲${inline}`), forward('乙')])
  assert.equal(markdown[0].content, '甲\n乙')
  assert.equal(markdown[1].content.rows[0].buttons[0].input, '#绑定')
})

test('URL button extraction preserves the newline after a forwarded node', async () => {
  const result = await harness().getQQBot([forward('甲 https://example.com'), forward('乙')], {})
  assert.equal(result.Pieces[0][0].content, '甲 [链接(请点击按钮查看)]\n乙\n')
  assert.equal(result.Pieces[0][1].type, 'keyboard')
})

test('static image remains Markdown and follows the newline of a forwarded node', async () => {
  const adapter = harness()
  const input = [forward('甲'), { type: 'image', file: 'static.png' }]
  const expected = '甲\n![图片 #36px #24px](https://example.com/image.webp)'
  assert.equal(await adapter.makeMarkdownContent({}, input), expected)
  assert.equal((await adapter.getQQBot(input, {})).Pieces[0][0].content, expected)
})

test('animation and video stay separate media pieces between forwarded nodes', async () => {
  const result = await harness().getQQBot([
    forward('甲'), { type: 'image', file: 'animation.gif' },
    { type: 'video', file: 'video.mp4' }, forward('乙')
  ], {})
  assert.deepEqual(result.Pieces, [
    [{ type: 'markdown', content: '甲\n' }],
    [{ type: 'image', file: 'animation.gif', animated: true }],
    [{ type: 'video', file: 'video.mp4' }],
    [{ type: 'markdown', content: '乙\n' }]
  ])
})

test('raw, template and legacy formats preserve forwarded node boundaries', async () => {
  const message = await harness().makeMarkdownMessage({}, [forward('甲'), forward('乙')])
  const raw = getMessageVariants(message, getMessagePolicy({}), true)[0].message
  assert.equal(raw[0].content, '甲\n乙')
  const template = getMessageVariants(message, getMessagePolicy({ markdown: { mode: 'template', templateId: 'test', params: ['body'] } }), true)[0].message
  assert.deepEqual(template[0].params, [{ key: 'body', values: ['甲\n乙'] }])
  const legacy = getMessageVariants(message, getMessagePolicy({ markdown: 'legacy' }), true)[0].message
  assert.deepEqual(legacy, [{ type: 'text', text: '甲\n乙' }])
})
