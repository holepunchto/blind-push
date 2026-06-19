const b4a = require('b4a')
const sodium = require('sodium-native')
const crypto = require('hypercore-crypto')
const cenc = require('compact-encoding')
const remote = require('hypercore/lib/fully-remote-proof')

const schema = require('./spec/hyperschema')
const BlindPushError = require('./lib/errors')

const PushPayload = schema.getEncoding('@blind-push/push-payload')
const ProofPayload = schema.getEncoding('@blind-push/proof-payload')

const [NS_BLINDING] = crypto.namespace('blind-push', 1)

// references: https://firebase.google.com/docs/cloud-messaging/error-codes
// "Message too big: Check that the total size of the payload data included in a message does not exceed FCM limits: 4096 bytes for most messages, or 2048 bytes in the case of messages to topics. This includes both the keys and the values."
const MAX_FCM_TOPIC_MESSAGE_SIZE = 2048
const GATEWAY_ENVELOPE_SIZE = 85
const MAX_PAYLOAD_BASE64_SIZE = MAX_FCM_TOPIC_MESSAGE_SIZE - GATEWAY_ENVELOPE_SIZE - 8 // Leave 8 bytes as a safety margin
const MAX_PAYLOAD_BYTE_SIZE = Math.floor((MAX_PAYLOAD_BASE64_SIZE * 3) / 4) // roughly estimate the original binary size from a Base64 length

const VERSION = 3

/**
 * @typedef {object} PushPayload
 * @property {number} version
 * @property {Uint8Array} discoveryKey
 * @property {Uint8Array} payload
 */

/**
 * @typedef {object} ProofPayload
 * @property {Uint8Array} proof
 * @property {Uint8Array | null} [extra=null]
 */

/**
 * @param {import('hypercore')} core
 * @param {object} [opts]
 * @param {Uint8Array} [opts.roomKey=core.key]
 * @param {Uint8Array} [opts.roomDiscoveryKey=crypto.discoveryKey(roomKey)]
 * @param {number} [opts.index=core.length - 1]
 * @param {number} [opts.timeout=10000]
 * @param {Uint8Array | null} [opts.extra=null]
 * @returns {Promise<PushPayload>}
 */
async function createNotification(
  core,
  {
    roomKey = core.key,
    roomDiscoveryKey = crypto.discoveryKey(roomKey),
    index = core.length - 1,
    timeout = 10_000,
    extra = null
  } = {}
) {
  const block = await core.get(index, {
    wait: true,
    timeout,
    decrypt: false,
    raw: true
  })

  let payload = await encryptNotificationProof(core, roomKey, block, index, { extra })

  // If payload exceeds MAX_PAYLOAD_SIZE, don't send it via Firebase
  // exclude the block and let the client fetch it via hypercore replication
  if (payload.byteLength > MAX_PAYLOAD_BYTE_SIZE) {
    payload = await encryptNotificationProof(core, roomKey, null, 0, { extra })

    // this may occur if the ‘extra’ field is too large
    if (payload.byteLength > MAX_PAYLOAD_BYTE_SIZE) {
      throw BlindPushError.PAYLOAD_TOO_LARGE()
    }
  }

  return { discoveryKey: roomDiscoveryKey, payload, version: VERSION }
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
  const rawProofPayload = decrypt(roomKey, payload)
  if (!rawProofPayload) return null
  const proofPayload = cenc.decode(ProofPayload, rawProofPayload)
  const result = await remote.verify(store, proofPayload.proof, { referrer: roomKey })
  if (!result) return null
  return { result, extra: proofPayload.extra }
}

/**
 * @param {Uint8Array} roomKey
 * @returns {Uint8Array}
 */
function generateBlindingKey(roomKey) {
  const blindingKey = b4a.allocUnsafe(sodium.crypto_secretbox_KEYBYTES)
  sodium.crypto_generichash(blindingKey, b4a.concat([NS_BLINDING, roomKey]))
  return blindingKey
}

/**
 * @param {Uint8Array} roomKey
 * @param {Uint8Array} msg
 * @returns {Uint8Array}
 */
function encrypt(roomKey, msg) {
  const secretKey = generateBlindingKey(roomKey)
  const encrypted = b4a.allocUnsafe(
    msg.byteLength + sodium.crypto_secretbox_MACBYTES + sodium.crypto_secretbox_NONCEBYTES
  )
  const nonce = encrypted.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const box = encrypted.subarray(nonce.byteLength)

  sodium.randombytes_buf(nonce)
  sodium.crypto_secretbox_easy(box, msg, nonce, secretKey)

  return encrypted
}

/**
 * @param {Uint8Array} roomKey
 * @param {Uint8Array} encrypted
 * @returns {Buffer | null}
 */
function decrypt(roomKey, encrypted) {
  const secretKey = generateBlindingKey(roomKey)
  const nonce = encrypted.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const box = encrypted.subarray(nonce.byteLength)
  const msg = b4a.allocUnsafe(box.byteLength - sodium.crypto_secretbox_MACBYTES)

  if (!sodium.crypto_secretbox_open_easy(msg, box, nonce, secretKey)) {
    return null
  }

  return msg
}

/**
 * @param {import('hypercore')} core
 * @param {Uint8Array} roomKey
 * @param {Uint8Array | null} block
 * @param {number} index
 * @param {object} [opts]
 * @param {Uint8Array | null} [opts.extra=null]
 * @returns {Promise<Uint8Array>}
 */
async function encryptNotificationProof(core, roomKey, block, index, { extra } = {}) {
  const proof = await remote.proof(core, { block, index })
  const rawProofPayload = cenc.encode(ProofPayload, { version: VERSION, extra, proof })
  return encrypt(roomKey, rawProofPayload)
}

module.exports = {
  encode,
  decode,
  createNotification,
  readNotification
}
