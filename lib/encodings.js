const schema = require('../spec/hyperschema')

exports.BlindPeerRequest = schema.getEncoding('@blind-push/blind-peer-request')
exports.ForwardPushRequest = schema.getEncoding('@blind-push/gateway-forward-request')

const BlindPeerResponseStruct = schema.getEncoding('@blind-push/blind-peer-response')

// preserves compatibility with blind peers that return null
exports.BlindPeerResponse = {
  preencode(state, m) {
    if (m) BlindPeerResponseStruct.preencode(state, m)
  },
  encode(state, m) {
    if (m) BlindPeerResponseStruct.encode(state, m)
  },
  decode(state) {
    return state.start === state.end ? { length: 0 } : BlindPeerResponseStruct.decode(state)
  }
}
