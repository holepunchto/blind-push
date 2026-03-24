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

  const result = await receive(core.state.storage.store, push.payload, { roomKey: core.key })
  t.ok(result, 'receive verifies the push proof')
  t.alike(result.key, core.key, 'receive returns the sender key')
  t.alike(result.discoveryKey, core.discoveryKey, 'receive returns the sender discovery key')
  t.is(result.length, 1, 'receive returns the current core length')
  t.is(result.newer, false, 'receive does not report newer data for the same core state')
  t.is(result.block.index, 0, 'receive returns the appended block index')
  t.ok(result.block.value, 'receive returns the appended block value')
  t.alike(result.block.value, block, 'receive returns the appended block value')
})

test('send omits block data for oversized payloads', async function (t) {
  const core = await createCore(t)

  await core.append(b4a.alloc(4_000, 'a'))

  const push = await send(core)
  t.alike(push.discoveryKey, core.discoveryKey, 'send returns the room discovery key')

  const result = await receive(core.state.storage.store, push.payload, { roomKey: core.key })
  t.ok(result, 'receive verifies the compact push proof')
  t.alike(result.key, core.key, 'receive returns the sender key')
  t.alike(result.discoveryKey, core.discoveryKey, 'receive returns the sender discovery key')
  t.is(result.length, 1, 'receive returns the current core length')
  t.is(result.newer, false, 'receive does not report newer data for the same core state')
  t.is(result.block, null, 'receive omits block data when the payload is too large')
})

test('send throws on an empty core', async function (t) {
  const core = await createCore(t)

  await t.exception(send(core), /ERR_ASSERTION/, 'send rejects when the core is empty')
})

test('receive returns null for a proof from another core', async function (t) {
  const core = await createCore(t)
  const otherCore = await createCore(t)

  await otherCore.append(b4a.from('hello world'))

  const push = await send(otherCore, { roomKey: core.key })
  const result = await receive(core.state.storage.store, push.payload, { roomKey: core.key })

  t.is(result, null, 'receive ignores proofs for cores outside the receiver storage')
})

test('receive throws on an invalid room key', async function (t) {
  const core = await createCore(t)
  const otherRoom = await createCore(t)

  await core.append(b4a.from('hello world'))

  const push = await send(core)

  await t.exception(
    receive(core.state.storage.store, push.payload, { roomKey: otherRoom.key }),
    /INVALID_DECRYPTION_KEY/,
    'receive rejects payloads that cannot be decrypted with the provided room key'
  )
})
