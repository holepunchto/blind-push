const b4a = require('b4a')
const sodium = require('sodium-native')
const crypto = require('hypercore-crypto')
const cenc = require('compact-encoding')
const remote = require('hypercore/lib/fully-remote-proof')

const { PushPayload } = require('./lib/encodings')
const BlindPushError = require('./lib/errors')

const [NS_BLINDING] = crypto.namespace('keet/notications', 1)

// Firebase limit is 4000, Apple is 4096.
// Leave room for the outer payload framing plus some safety margin.
const MAX_PAYLOAD_SIZE = 4000 - 32 - 1 - 16

/**
 * @typedef {object} PushPayload
 * @property {Uint8Array} discoveryKey
 * @property {Uint8Array} payload

/**
 * @param {import('hypercore')} core
 * @param {object} [opts]
 * @param {Uint8Array} [opts.roomKey=core.key]
 * @param {Uint8Array} [opts.roomDiscoveryKey=crypto.discoveryKey(roomKey)]
 * @param {number} [opts.index=core.length - 1]
 * @param {number} [opts.timeout=10000]
 * @returns {Promise<PushPayload>}
 */
async function send(
  core,
  {
    roomKey = core.key,
    roomDiscoveryKey = crypto.discoveryKey(roomKey),
    index = core.length - 1,
    timeout = 10_000
  } = {}
) {
  const block = await core.get(index, {
    wait: true,
    timeout,
    decrypt: false,
    raw: true
  })

  let payload = await encryptNotificationProof(core, roomKey, block, index)
  if (payload.byteLength > MAX_PAYLOAD_SIZE) {
    payload = await encryptNotificationProof(core, roomKey, null, 0)
  }

  return { discoveryKey: roomDiscoveryKey, payload }
}

/**
 * @param {PushPayload} payload
 * @returns {Buffer}
 */
function encode(payload) {
  return cenc.encode(PushPayload, payload)
}

/**
 * @param {Buffer} raw
 * @returns {PushPayload}
 */
function decode(raw) {
  return cenc.decode(PushPayload, raw)
}

/**
 * @param {import('hypercore')} core
 * @param {Uint8Array} payload
 * @param {object} [opts]
 * @param {Uint8Array} [opts.roomKey=core.key]
 * @returns {Promise<object | null>}
 */
async function receive(core, payload, { roomKey = core.key } = {}) {
  const proof = decrypt(roomKey, payload)

  return remote.verify(core.state.storage.store, proof, { referrer: roomKey })
}

/**
 * @param {Uint8Array} roomKey
 * @returns {Uint8Array}
 */
function generateBlindingKey(roomKey) {
  const blindingKey = b4a.allocUnsafe(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES)
  sodium.crypto_generichash(blindingKey, b4a.concat([NS_BLINDING, roomKey]))
  return blindingKey
}

/**
 * @param {Uint8Array} roomKey
 * @param {Uint8Array} message
 * @returns {Uint8Array}
 */
function encrypt(roomKey, message) {
  const secretKey = generateBlindingKey(roomKey)
  const buffer = b4a.allocUnsafe(
    message.byteLength + sodium.crypto_secretbox_MACBYTES + sodium.crypto_secretbox_NONCEBYTES
  )
  const nonce = buffer.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const box = buffer.subarray(nonce.byteLength)

  sodium.randombytes_buf(nonce)
  sodium.crypto_secretbox_easy(box, message, nonce, secretKey)

  return buffer
}

/**
 * @param {Uint8Array} roomKey
 * @param {Uint8Array} buffer
 * @returns {Uint8Array}
 */
function decrypt(roomKey, buffer) {
  if (buffer.byteLength < sodium.crypto_secretbox_NONCEBYTES + sodium.crypto_secretbox_MACBYTES) {
    throw BlindPushError.INVALID_DECRYPTION_KEY()
  }

  const secretKey = generateBlindingKey(roomKey)
  const nonce = buffer.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const box = buffer.subarray(nonce.byteLength)
  const message = b4a.allocUnsafe(box.byteLength - sodium.crypto_secretbox_MACBYTES)

  if (!sodium.crypto_secretbox_open_easy(message, box, nonce, secretKey)) {
    throw BlindPushError.INVALID_DECRYPTION_KEY()
  }

  return message
}

/**
 * @param {import('hypercore')} core
 * @param {Uint8Array} roomKey
 * @param {Uint8Array | null} block
 * @param {number} index
 * @returns {Promise<Uint8Array>}
 */
async function encryptNotificationProof(core, roomKey, block, index) {
  const proof = await remote.proof(core, { block, index })
  return encrypt(roomKey, proof)
}

module.exports = {
  encode,
  decode,
  send,
  receive
}
