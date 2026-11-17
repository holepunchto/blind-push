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

test('upgrade lengths larger than the core are clamped', async function (t) {
  const core = await createCore(t)

  const block = b4a.from('hello world')
  const extra = b4a.from('metadata')

  for (let i = 0; i < 10; i++) {
    await core.append(block)
    const push = await createNotification(core, { extra, upgrade: { start: 0, length: 5 } })

    const result = await readNotification(core.state.storage.store, core.key, push.payload)
    const proof = result.result.proof

    t.is(proof.block.index, i, 'block index is correct')

    if (i < 5) {
      t.is(proof.upgrade.length, i + 1, 'upgrade length is upper clamped to the length of the core')
      continue
    }

    t.is(
      proof.upgrade.length,
      5,
      'upgrade length remains as chosen when core length is above provided value'
    )
  }
})

test('upgrades not starting at 0 fall back to a full upgrade', async function (t) {
  const core = await createCore(t)

  for (let i = 0; i < 10; i++) await core.append(b4a.from('hello world'))

  const upgrade = { start: 3, length: 5 }
  const push = await createNotification(core, { upgrade })

  const result = await readNotification(core.state.storage.store, core.key, push.payload)
  t.comment(`core length: ${core.length}, requested upgrade: ${JSON.stringify(upgrade)}`)
  t.ok(result, 'readNotification verifies the push proof')

  const proof = result.result.proof
  t.comment(`proof upgrade: start ${proof.upgrade.start}, length ${proof.upgrade.length}`)
  t.is(proof.upgrade.start, 0, 'upgrade starts at 0')
  t.is(proof.upgrade.length, core.length, 'fell back to a full upgrade')
})

test('deprecated upgradeLength is used when no upgrade is given', async function (t) {
  const core = await createCore(t)

  for (let i = 0; i < 10; i++) await core.append(b4a.from('hello world'))

  const upgradeLength = 5
  const push = await createNotification(core, { upgradeLength })

  const result = await readNotification(core.state.storage.store, core.key, push.payload)
  t.comment(`core length: ${core.length}, requested upgradeLength: ${upgradeLength}`)
  t.ok(result, 'readNotification verifies the push proof')

  const proof = result.result.proof
  t.comment(`proof upgrade: start ${proof.upgrade.start}, length ${proof.upgrade.length}`)
  t.is(proof.upgrade.start, 0, 'upgrade starts at 0')
  t.is(proof.upgrade.length, upgradeLength, 'upgrade is split at the deprecated upgradeLength')
  t.is(result.result.length, core.length, 'proof still upgrades to the full length')
})

test('deprecated upgradeLength out of range falls back to a full upgrade', async function (t) {
  const core = await createCore(t)

  for (let i = 0; i < 10; i++) await core.append(b4a.from('hello world'))

  const upgradeLength = 20
  const push = await createNotification(core, { upgradeLength })

  const result = await readNotification(core.state.storage.store, core.key, push.payload)
  t.comment(`core length: ${core.length}, requested upgradeLength: ${upgradeLength}`)
  t.ok(result, 'readNotification verifies the push proof')

  const proof = result.result.proof
  t.comment(`proof upgrade: start ${proof.upgrade.start}, length ${proof.upgrade.length}`)
  t.is(proof.upgrade.start, 0, 'upgrade starts at 0')
  t.is(proof.upgrade.length, core.length, 'fell back to a full upgrade')
})

test('no upgrade and no deprecated upgradeLength gives a full upgrade', async function (t) {
  const core = await createCore(t)

  for (let i = 0; i < 10; i++) await core.append(b4a.from('hello world'))

  // omitted entirely, and what blind-peer passes for a client that sent neither field
  const cases = [
    { name: 'options omitted', opts: {} },
    { name: 'decoded defaults', opts: { upgrade: null, upgradeLength: 0 } }
  ]

  for (const { name, opts } of cases) {
    const push = await createNotification(core, opts)

    const result = await readNotification(core.state.storage.store, core.key, push.payload)
    t.comment(`${name}: core length: ${core.length}, opts: ${JSON.stringify(opts)}`)
    t.ok(result, `${name}: readNotification verifies the push proof`)

    const proof = result.result.proof
    t.comment(
      `${name}: proof upgrade: start ${proof.upgrade.start}, length ${proof.upgrade.length}, ` +
        `additionalNodes ${proof.upgrade.additionalNodes.length}`
    )
    t.is(proof.upgrade.start, 0, `${name}: upgrade starts at 0`)
    t.is(proof.upgrade.length, core.length, `${name}: full upgrade to the core length`)
    t.is(proof.upgrade.additionalNodes.length, 0, `${name}: nothing left over for additionalNodes`)
  }
})

test('upgrade always wins over the deprecated upgradeLength', async function (t) {
  const core = await createCore(t)

  for (let i = 0; i < 10; i++) await core.append(b4a.from('hello world'))

  const cases = [
    {
      name: 'both usable',
      opts: { upgrade: { start: 0, length: 3 }, upgradeLength: 6 },
      expected: 3
    },
    {
      // an unusable upgrade does not fall through to upgradeLength, it falls back to full
      name: 'upgrade unusable',
      opts: { upgrade: { start: 3, length: 5 }, upgradeLength: 6 },
      expected: 10
    }
  ]

  for (const { name, opts, expected } of cases) {
    const push = await createNotification(core, opts)

    const result = await readNotification(core.state.storage.store, core.key, push.payload)
    t.comment(`${name}: core length: ${core.length}, opts: ${JSON.stringify(opts)}`)
    t.ok(result, `${name}: readNotification verifies the push proof`)

    const proof = result.result.proof
    t.comment(
      `${name}: proof upgrade: start ${proof.upgrade.start}, length ${proof.upgrade.length}`
    )
    t.is(proof.upgrade.start, 0, `${name}: upgrade starts at 0`)
    t.is(proof.upgrade.length, expected, `${name}: upgradeLength was ignored`)
  }
})
