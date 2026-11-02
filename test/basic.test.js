const test = require('brittle')
const b4a = require('b4a')
const cenc = require('compact-encoding')

const { createNotification, readNotification, LAST_LENGTH_KEY } = require('..')
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

  await core.append(b4a.alloc(1_300, 'a'))

  const extra = b4a.alloc(1_000, 'b')
  const fits = await createNotification(core, { extra })
  const fitsResult = await readNotification(core.state.storage.store, core.key, fits.payload)
  t.alike(fitsResult.extra, extra, 'createNotification keeps extra that fits without the block')
  t.is(
    fitsResult.result.block,
    null,
    'readNotification omits block data when compacting the payload'
  )

  const push = await createNotification(core, { extra: b4a.alloc(1_300, 'b') })
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

test('progressively created proofs produce the correct upgrade lengths', async function (t) {
  const core = await createCore(t)

  const block = b4a.from('hello world')
  const extra = b4a.from('metadata')

  for (let i = 0; i < 10; i++) {
    await core.append(block)
    const push = await createNotification(core, { extra })

    const result = await readNotification(core.state.storage.store, core.key, push.payload)
    const proof = result.result.proof

    if (i === 0) {
      t.is(proof.block.index, i, 'block is correct on first push')
      t.is(proof.upgrade.length, i + 1, 'upgrade length is correct on first push')
      continue
    }

    t.is(proof.block.index, i, 'block is correct')
    t.is(proof.upgrade.length, i, 'upgrade length is correct')
  }
})

test('stale stored upgrade length falls back to core length', async function (t) {
  const core = await createCore(t)

  const block = b4a.from('hello world')
  const extra = b4a.from('metadata')

  await core.append(block)
  await createNotification(core, { extra })

  const upgradeLength = cenc.decode(cenc.uint, await core.getUserData(LAST_LENGTH_KEY))
  t.is(upgradeLength, 1, 'initial upgrade length stored correctly')

  await core.setUserData(LAST_LENGTH_KEY, cenc.encode(cenc.uint, 20))

  await core.append(block)
  const push = await createNotification(core, { extra })

  const result = await readNotification(core.state.storage.store, core.key, push.payload)
  const proof = result.result.proof

  t.is(proof.upgrade.length, core.length, 'upgrade length is the same as the core length')
})
