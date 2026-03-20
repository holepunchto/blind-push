const test = require('brittle')
const b4a = require('b4a')

const { send, receive } = require('..')
const { createReplicatedCorePair } = require('./helper')

test('send/receive replication happy path', async function (t) {
  const { source, dest } = await createReplicatedCorePair(t)

  const block = b4a.from('hello world')
  await source.append(block)

  const push = await send(source)
  t.alike(push.discoveryKey, source.discoveryKey, 'send returns the room discovery key')

  await dest.update({ wait: true })
  const result = await receive(dest, push.payload)
  t.ok(result, 'receive verifies the push proof on the replica')
  t.ok(b4a.equals(result.key, source.key), 'receive returns the sender key')
  t.ok(
    b4a.equals(result.discoveryKey, source.discoveryKey),
    'receive returns the sender discovery key'
  )
  t.is(result.length, 1, 'receive returns the current core length')
  t.is(result.newer, false, 'receive does not report newer data for the replicated core')
  t.is(result.block.index, 0, 'receive returns the appended block index')
  t.ok(b4a.equals(result.block.value, block), 'receive returns the appended block value')
})
