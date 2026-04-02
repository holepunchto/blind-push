const Hypercore = require('hypercore')
const SuspendResource = require('suspend-resource')

// StreamLink forwards one stream into another, with suspend/resume queueing.
class StreamLink extends SuspendResource {
  constructor(src, dst) {
    super()

    this.src = src
    this.dst = dst
    this.queue = []
    this._ondataBound = this._ondata.bind(this)
  }

  async _open() {
    this.src.on('data', this._ondataBound)
  }

  async _close() {
    this.src.removeListener('data', this._ondataBound)
    this.queue.length = 0
  }

  async _suspend() {}

  async _resume() {
    while (this.queue.length > 0) {
      this.dst.write(this.queue.shift())
    }
  }

  _ondata(data) {
    if (this.suspended) {
      this.queue.push(data)
      return
    }

    this.dst.write(data)
  }
}

async function setupE2ENodes(t) {
  const sender = await createCore(t)
  const blindPeer = await createCore(t, sender.key)
  const receiver = await createCore(t, sender.key)

  const senderLink = await replicate(sender, blindPeer, t)
  const receiverLink = await replicate(blindPeer, receiver, t)

  return { sender, receiver, blindPeer, senderLink, receiverLink }
}

async function replicate(src, dst, t) {
  const srcStream = src.replicate(true, { keepAlive: false })
  const dstStream = dst.replicate(false, { keepAlive: false })
  const link = new StreamLink(srcStream, dstStream)

  srcStream.on('error', (err) => {
    t.comment(`replication stream error (src): ${err}`)
  })
  dstStream.on('error', (err) => {
    t.comment(`replication stream error (dst): ${err}`)
  })

  dstStream.pipe(srcStream)

  const srcClosed = new Promise((resolve) => srcStream.once('close', resolve))
  const dstClosed = new Promise((resolve) => dstStream.once('close', resolve))

  t.teardown(async function () {
    await link.close()
    srcStream.destroy()
    dstStream.destroy()
    await srcClosed
    await dstClosed
  })

  await link.ready()

  return link
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
  setupE2ENodes,
  replicate,
  StreamLink
}
