const test = require('brittle')
const b4a = require('b4a')

const { send, receive } = require('..')
const { createCore } = require('./helper')

test('send/receive happy path', async function (t) {
  const core = await createCore(t)

  const block = b4a.from('hello world')
  await core.append(block)

  const push = await send(core)
  t.alike(push.discoveryKey, core.discoveryKey, 'send returns the room discovery key')

  const result = await receive(core, push.payload)
  t.ok(result, 'receive verifies the push proof')
  t.ok(b4a.equals(result.key, core.key), 'receive returns the sender key')
  t.ok(
    b4a.equals(result.discoveryKey, core.discoveryKey),
    'receive returns the sender discovery key'
  )
  t.is(result.length, 1, 'receive returns the current core length')
  t.is(result.newer, false, 'receive does not report newer data for the same core state')
  t.is(result.block.index, 0, 'receive returns the appended block index')
  t.ok(b4a.equals(result.block.value, block), 'receive returns the appended block value')
})
