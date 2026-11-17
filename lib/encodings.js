const schema = require('../spec/hyperschema')

exports.BlindPeerRequest = schema.getEncoding('@blind-push/blind-peer-request')
exports.ForwardPushRequest = schema.getEncoding('@blind-push/gateway-forward-request')

const BlindPeerResponseStruct = schema.getEncoding('@blind-push/blind-peer-response')

// old blind-peers reply with no bytes, so empty decodes to null and null encodes to empty
// guards the possibility of blind-peer rollback on new client versions
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
