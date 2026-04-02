const b4a = require('b4a')
const sodium = require('sodium-native')
const crypto = require('hypercore-crypto')
const cenc = require('compact-encoding')
const remote = require('hypercore/lib/fully-remote-proof')

const { PushPayload } = require('./lib/encodings')

const [NS_BLINDING] = crypto.namespace('blind-push', 1)

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
async function createNotification(
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

  // If payload exceeds MAX_PAYLOAD_SIZE, don't send it via Firebase
  // exclude the block and let the client fetch it via hypercore replication
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
 * @param {any} store
 * @param {Uint8Array} roomKey
 * @param {Uint8Array} payload
 * @returns {Promise<any | null>}
 */
async function readNotification(store, roomKey, payload) {
  const proof = decryptProof(roomKey, payload)
  if (!proof) return null
  return remote.verify(store, proof, { referrer: roomKey })
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
 * @param {Uint8Array} proof
 * @returns {Uint8Array}
 */
function encryptProof(roomKey, proof) {
  const secretKey = generateBlindingKey(roomKey)
  const encrypted = b4a.allocUnsafe(
    proof.byteLength + sodium.crypto_secretbox_MACBYTES + sodium.crypto_secretbox_NONCEBYTES
  )
  const nonce = encrypted.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const box = encrypted.subarray(nonce.byteLength)

  sodium.randombytes_buf(nonce)
  sodium.crypto_secretbox_easy(box, proof, nonce, secretKey)

  return encrypted
}

/**
 * @param {Uint8Array} roomKey
 * @param {Uint8Array} encrypted
 * @returns {Uint8Array | null}
 */
function decryptProof(roomKey, encrypted) {
  const secretKey = generateBlindingKey(roomKey)
  const nonce = encrypted.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const box = encrypted.subarray(nonce.byteLength)
  const proof = b4a.allocUnsafe(box.byteLength - sodium.crypto_secretbox_MACBYTES)

  if (!sodium.crypto_secretbox_open_easy(proof, box, nonce, secretKey)) {
    return null
  }

  return proof
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
  return encryptProof(roomKey, proof)
}

module.exports = {
  encode,
  decode,
  createNotification,
  readNotification
}
