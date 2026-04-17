const schema = require('../spec/hyperschema')

exports.BlindPeerRequest = schema.getEncoding('@blind-push/blind-peer-request')
exports.ForwardPushRequest = schema.getEncoding('@blind-push/gateway-forward-request')
