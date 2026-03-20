class BlindPushError extends Error {
  constructor(msg, code, fn = BlindPushError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'BlindPushError'
  }

  static INVALID_DECRYPTION_KEY(msg = 'Invalid decryption key') {
    return new BlindPushError(msg, 'INVALID_DECRYPTION_KEY', BlindPushError.INVALID_DECRYPTION_KEY)
  }
}

module.exports = BlindPushError
