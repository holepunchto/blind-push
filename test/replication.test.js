// README deployed flow: sender -> blind-peer -> push-gateway -> FCM -> receiver core.
// These tests cover the Hypercore replication/proof logic only and intentionally skip transport and RPC layers.
const test = require('brittle')
const b4a = require('b4a')

const { createNotification, readNotification } = require('..')
const { setupE2ENodes } = require('./helper')

test('createNotification/readNotification replication happy path', async function (t) {
  const { sender, blindPeer, receiver } = await setupE2ENodes(t)

  const block = b4a.from('hello world')
  await sender.append(block)

  await blindPeer.get(0, { wait: true, timeout: 500 })
  const push = await createNotification(blindPeer)
  t.alike(
    push.discoveryKey,
    sender.discoveryKey,
    'createNotification returns the room discovery key'
  )
  t.is(push.version, 3, 'createNotification returns the outer payload version')

  const result = await readNotification(receiver.state.storage.store, receiver.key, push.payload)
  t.ok(result, 'readNotification verifies the push proof on the replica')
  t.is(result.extra, null, 'readNotification defaults embedded extra to null')
  t.alike(result.result.key, sender.key, 'readNotification returns the sender key')
  t.alike(
    result.result.discoveryKey,
    sender.discoveryKey,
    'readNotification returns the sender discovery key'
  )
  t.is(result.result.length, 1, 'readNotification returns the current core length')
  t.is(
    result.result.newer,
    false,
    'readNotification does not report newer data for the replicated core'
  )
  t.is(result.result.block.index, 0, 'readNotification returns the appended block index')
  t.alike(result.result.block.value, block, 'readNotification returns the appended block value')
})

test('createNotification times out when the replication link is suspended', async function (t) {
  const { sender, blindPeer, senderLink } = await setupE2ENodes(t)

  await sender.append(b4a.from('init'))
  await blindPeer.get(0, { wait: true, timeout: 500 })

  await senderLink.suspend()
  await sender.append(b4a.from('next'))

  await t.exception(
    createNotification(blindPeer, { index: sender.length - 1, timeout: 500 }),
    /REQUEST_TIMEOUT/,
    'createNotification rejects when the requested block cannot replicate before timeout'
  )
})

test('createNotification resolves after sender replication resumes before timeout', async function (t) {
  const { sender, blindPeer, senderLink } = await setupE2ENodes(t)

  await sender.append(b4a.from('init'))
  await blindPeer.get(0, { wait: true, timeout: 500 })

  await senderLink.suspend()
  await sender.append(b4a.from('next'))

  let status = 'pending'
  const sentPromise = createNotification(blindPeer, {
    index: sender.length - 1,
    timeout: 1000
  }).then(
    (push) => {
      status = 'resolved'
      return push
    },
    (err) => {
      status = 'rejected'
      throw err
    }
  )

  await new Promise((resolve) => setTimeout(resolve, 500))
  t.is(status, 'pending', 'createNotification stays pending while sender replication is suspended')

  await senderLink.resume()
  await new Promise((resolve) => setTimeout(resolve, 100))

  const push = await sentPromise
  t.is(status, 'resolved', 'createNotification resolves once replication resumes before timeout')
  t.alike(
    push.discoveryKey,
    sender.discoveryKey,
    'createNotification returns the sender discovery key after resuming'
  )
})

test('readNotification reports newer data while receiver replication is suspended', async function (t) {
  const { sender, blindPeer, receiver, receiverLink } = await setupE2ENodes(t)

  const init = b4a.from('init')
  const next = b4a.from('next')

  await sender.append(init)

  await Promise.all([
    blindPeer.get(0, { wait: true, timeout: 500 }),
    receiver.get(0, { wait: true, timeout: 500 })
  ])

  const initialPush = await createNotification(blindPeer)
  const initialResult = await readNotification(
    receiver.state.storage.store,
    receiver.key,
    initialPush.payload
  )

  t.ok(initialResult, 'readNotification accepts the initial push before suspension')
  t.is(receiver.length, 1, 'receiver stores the initial synced block')

  await receiverLink.suspend()
  await sender.append(next)

  // wait a while for the block to replicate
  await new Promise((resolve) => setTimeout(resolve, 500))

  t.is(blindPeer.length, 2, 'blind peers receive new block')
  t.is(receiver.length, 1, 'receiver stays on the old length while the blindPeer link is suspended')

  const push = await createNotification(blindPeer)
  const result = await readNotification(receiver.state.storage.store, receiver.key, push.payload)

  t.ok(result, 'readNotification still verifies the push proof while the receiver is behind')
  t.alike(result.result.key, sender.key, 'readNotification returns the sender key')
  t.alike(
    result.result.discoveryKey,
    sender.discoveryKey,
    'readNotification returns the sender discovery key'
  )
  t.is(
    result.result.newer,
    true,
    'readNotification reports newer data when the receiver core is behind'
  )
  t.is(result.result.length, 2, 'readNotification returns the incoming core length')
  t.is(result.result.block.index, 1, 'readNotification returns the pushed block index')
  t.alike(result.result.block.value, next, 'readNotification returns the pushed block value')
  t.is(
    receiver.length,
    1,
    'readNotification does not advance the local receiver core while suspended'
  )

  const blockPromise = receiver.get(result.result.block.index, { wait: true })
  await receiverLink.resume()

  t.alike(await blockPromise, next, 'receiver eventually replicates the suspended block')
  t.is(receiver.length, 2, 'receiver catches up after the replication link resumes')
})

test('push notification from sender to receiver happy path', async function (t) {
  const { sender, blindPeer, receiver, receiverLink } = await setupE2ENodes(t)

  const block = b4a.from('hello world')
  const addedBlocks = 5
  for (let i = 0; i < addedBlocks; i++) await sender.append(block)

  await blindPeer.get(addedBlocks - 1, { wait: true, timeout: 500 })
  await receiver.get(addedBlocks - 1, { wait: true, timeout: 500 })

  t.is(receiver.length, addedBlocks, 'receiver has replicated all sender blocks')

  {
    const push = await createNotification(blindPeer)

    const result = await readNotification(receiver.state.storage.store, receiver.key, push.payload)
    const proof = result.result.proof
    t.is(proof.upgrade.length, addedBlocks, 'upgrade length is expected')
  }

  // receiver app is asleep
  receiverLink.suspend()

  const oldLen = blindPeer.length
  const newBlocks = 3
  for (let i = 0; i < newBlocks; i++) await sender.append(b4a.from('receiver is asleep'))

  await blindPeer.get(oldLen + newBlocks - 1, { wait: true, timeout: 500 })
  t.is(blindPeer.length, oldLen + newBlocks, 'new blocks added to blind peer')
  t.is(receiver.length, oldLen, 'receiver does not have the new blocks')

  {
    const blockIdx = receiver.length - 2
    const push = await createNotification(blindPeer, { index: blockIdx, upgradeLength: oldLen })

    const result = await readNotification(receiver.state.storage.store, receiver.key, push.payload)
    const proof = result.result.proof
    t.is(
      proof.upgrade.length,
      addedBlocks,
      'upgrade length is the length set during notification creation'
    )

    t.is(await receiver.has(blockIdx), false, 'block not there yet')
    await receiver.core.verify(proof, null)
    t.is(await receiver.has(blockIdx), true, 'block arrived via the proof')
  }
})

test('push notification from sender to receiver sad path', async function (t) {
  const { sender, blindPeer, receiver, receiverLink } = await setupE2ENodes(t)

  const block = b4a.from('hello world')
  const addedBlocks = 5
  for (let i = 0; i < addedBlocks; i++) await sender.append(block)

  await blindPeer.get(addedBlocks - 1, { wait: true, timeout: 500 })
  await receiver.get(addedBlocks - 1, { wait: true, timeout: 500 })

  t.is(receiver.length, addedBlocks, 'receiver has replicated all sender blocks')

  // receiver app is asleep
  receiverLink.suspend()

  for (let i = 0; i < addedBlocks; i++) await sender.append(block)
  await blindPeer.get(addedBlocks * 2 - 1, { wait: true, timeout: 500 })

  // sender uses an incorrect update length
  const incorrectLength = addedBlocks - 2
  const push = await createNotification(blindPeer, { upgradeLength: incorrectLength })

  // the proof is produced correctly
  const result = await readNotification(receiver.state.storage.store, receiver.key, push.payload)
  const proof = result.result.proof
  t.is(proof.upgrade.length, incorrectLength, 'upgrade length is as expected')

  // but the push notification fails
  t.is(await receiver.has(proof.block.index), false, 'block not there yet')
  t.is(
    await receiver.core.verify(proof, null),
    false,
    'push notification fails when prior notification was dropped'
  )
  t.is(await receiver.has(proof.block.index), false, 'block could not be added by the proof')
})

test('createNotification falls back to a full upgrade when the requested length cannot be proven', async function (t) {
  const { sender, blindPeer, receiver } = await setupE2ENodes(t)

  await sender.append(new Array(8).fill(b4a.from('block')))
  await blindPeer.get(7, { wait: true, timeout: 500 })

  // one append, so the blind peer upgrades from 8 to 16 in one go
  await sender.append(new Array(8).fill(b4a.from('block')))
  await blindPeer.get(15, { wait: true, timeout: 500 })
  t.absent(await blindPeer.has(8), 'blind peer skipped the blocks in between')

  const push = await createNotification(blindPeer, { index: 15, upgradeLength: 9 })
  const result = await readNotification(receiver.state.storage.store, receiver.key, push.payload)
  t.is(result.result.block.index, 15)
  t.is(result.result.proof.upgrade.length, blindPeer.length, 'fell back to a full upgrade')
})
