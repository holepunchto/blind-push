const schema = require('../spec/hyperschema')

exports.BlindPeerRequest = schema.getEncoding('@blind-push/blind-peer-request')
exports.PushPayload = schema.getEncoding('@blind-push/push-payload')
exports.ForwardPushRequest = schema.getEncoding('@blind-push/forward-push-request')
