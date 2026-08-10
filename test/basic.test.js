const test = require('brittle')
const b4a = require('b4a')

const { createNotification, readNotification } = require('..')
const { createCore } = require('./helper')

test('createNotification/readNotification happy path', async function (t) {
  const core = await createCore(t)

  const block = b4a.from('hello world')
  await core.append(block)

  const extra = b4a.from('metadata')
  const push = await createNotification(core, { extra })
  t.is(push.version, 3, 'createNotification returns the outer payload version')
  t.alike(push.discoveryKey, core.discoveryKey, 'createNotification returns the room discovery key')

  const result = await readNotification(core.state.storage.store, core.key, push.payload)
  t.ok(result, 'readNotification verifies the push proof')
  t.alike(result.extra, extra, 'readNotification returns the embedded proof extra payload')
  t.alike(result.result.key, core.key, 'readNotification returns the sender key')
  t.alike(
    result.result.discoveryKey,
    core.discoveryKey,
    'readNotification returns the sender discovery key'
  )
  t.is(result.result.length, 1, 'readNotification returns the current core length')
  t.is(
    result.result.newer,
    false,
    'readNotification does not report newer data for the same core state'
  )
  t.is(result.result.block.index, 0, 'readNotification returns the appended block index')
  t.ok(result.result.block.value, 'readNotification returns the appended block value')
  t.alike(result.result.block.value, block, 'readNotification returns the appended block value')
})

test('createNotification omits block data for oversized payloads', async function (t) {
  const core = await createCore(t)

  await core.append(b4a.alloc(1_300, 'a'))

  const push = await createNotification(core)
  t.is(push.version, 3, 'createNotification returns the outer payload version')
  t.alike(push.discoveryKey, core.discoveryKey, 'createNotification returns the room discovery key')

  const result = await readNotification(core.state.storage.store, core.key, push.payload)
  t.ok(result, 'readNotification verifies the compact push proof')
  t.is(result.extra, null, 'readNotification defaults embedded extra to null')
  t.alike(result.result.key, core.key, 'readNotification returns the sender key')
  t.alike(
    result.result.discoveryKey,
    core.discoveryKey,
    'readNotification returns the sender discovery key'
  )
  t.is(result.result.length, 1, 'readNotification returns the current core length')
  t.is(
    result.result.newer,
    false,
    'readNotification does not report newer data for the same core state'
  )
  t.is(result.result.block, null, 'readNotification omits block data when the payload is too large')
})

test('createNotification drops oversized extra from the compact payload', async function (t) {
  const core = await createCore(t)

  await core.append(b4a.from('hello world'))

  const push = await createNotification(core, { extra: b4a.alloc(1_300, 'a') })
  t.is(push.version, 3, 'createNotification returns the outer payload version')
  t.alike(push.discoveryKey, core.discoveryKey, 'createNotification returns the room discovery key')

  const result = await readNotification(core.state.storage.store, core.key, push.payload)
  t.ok(result, 'readNotification verifies the compact push proof')
  t.is(result.extra, null, 'createNotification drops oversized extra instead of failing')
  t.alike(result.result.key, core.key, 'readNotification returns the sender key')
  t.alike(
    result.result.discoveryKey,
    core.discoveryKey,
    'readNotification returns the sender discovery key'
  )
  t.is(result.result.length, 1, 'readNotification returns the current core length')
  t.is(result.result.block, null, 'readNotification omits block data when compacting the payload')
})

test('createNotification throws when the compact proof itself exceeds the size budget', async function (t) {
  const core = await createCore(t)
  await core.append(b4a.from('hello world'))

  const remote = require('hypercore/lib/fully-remote-proof')
  const originalProof = remote.proof
  // Force every compact/full proof path over MAX_PAYLOAD_BYTE_SIZE (~1466).
  remote.proof = async () => b4a.alloc(2_000)
  t.teardown(() => {
    remote.proof = originalProof
  })

  await t.exception(
    createNotification(core),
    /PAYLOAD_TOO_LARGE/,
    'createNotification rejects when even the no-extra compact proof is too large'
  )
})

test('createNotification throws on an empty core', async function (t) {
  const core = await createCore(t)

  await t.exception(
    createNotification(core),
    /ERR_ASSERTION/,
    'createNotification rejects when the core is empty'
  )
})

test('readNotification returns null for a proof from another core', async function (t) {
  const core = await createCore(t)
  const otherCore = await createCore(t)

  await otherCore.append(b4a.from('hello world'))

  const push = await createNotification(otherCore, { roomKey: core.key })
  const result = await readNotification(core.state.storage.store, core.key, push.payload)

  t.is(result, null, 'readNotification ignores proofs for cores outside the receiver storage')
})

test('readNotification return null on an invalid room key', async function (t) {
  const core = await createCore(t)
  const otherRoom = await createCore(t)

  await core.append(b4a.from('hello world'))

  const push = await createNotification(core)

  await t.is(
    await readNotification(core.state.storage.store, otherRoom.key, push.payload),
    null,
    'readNotification rejects payloads that cannot be decrypted with the provided room key'
  )
})
