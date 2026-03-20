const Hypercore = require('hypercore')

async function createReplicatedCorePair(t) {
  const source = await createCore(t)
  const dest = await createCore(t, source.key)

  const sourceStream = source.replicate(true, { keepAlive: false })
  const destStream = dest.replicate(false, { keepAlive: false })

  const sourceClosed = new Promise((resolve) => sourceStream.once('close', resolve))
  const destClosed = new Promise((resolve) => destStream.once('close', resolve))

  sourceStream.on('error', (err) => {
    t.comment(`replication stream error (source): ${err}`)
  })
  destStream.on('error', (err) => {
    t.comment(`replication stream error (dest): ${err}`)
  })

  t.teardown(async function () {
    sourceStream.destroy()
    destStream.destroy()
    await sourceClosed
    await destClosed
  })

  sourceStream.pipe(destStream).pipe(sourceStream)

  return { source, dest }
}

async function createCore(t, key) {
  const dir = await t.tmp()
  const core = key ? new Hypercore(dir, key) : new Hypercore(dir)

  t.teardown(
    async function () {
      await core.close()
    },
    { order: 1 }
  )

  await core.ready()
  await core.setUserData('referrer', core.key)

  return core
}

module.exports = {
  createCore,
  createReplicatedCorePair
}
