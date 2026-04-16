module.exports = class BlindPushError extends Error {
  constructor(msg, code, fn = BlindPushError, { cause } = {}) {
    super(`${code}: ${msg}`, { cause })
    this.code = code

    if (Error.captureStackTrace) Error.captureStackTrace(this, fn)
  }

  get name() {
    return 'BlindPushError'
  }

  static PAYLOAD_TOO_LARGE(msg = 'notification payload exceeds the push size budget') {
    return new BlindPushError(msg, 'PAYLOAD_TOO_LARGE', BlindPushError.PAYLOAD_TOO_LARGE)
  }
}
