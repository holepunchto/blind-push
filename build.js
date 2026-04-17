const path = require('path')

const Hyperschema = require('hyperschema')

const SCHEMA_DIR = path.join(__dirname, 'spec', 'hyperschema')

const schema = Hyperschema.from(SCHEMA_DIR, { versioned: true })
const blindPush = schema.namespace('blind-push')

blindPush.register({
  name: 'blind-peer-request-block',
  fields: [
    {
      name: 'key',
      type: 'fixed32',
      required: true
    },
    {
      name: 'index',
      type: 'uint',
      required: true
    }
  ]
})

blindPush.register({
  name: 'blind-peer-request-destination',
  fields: [
    {
      name: 'key',
      type: 'fixed32',
      required: true
    },
    {
      name: 'discoveryKey',
      type: 'buffer',
      required: true
    }
  ]
})

blindPush.register({
  name: 'blind-peer-request',
  fields: [
    {
      name: 'block',
      type: '@blind-push/blind-peer-request-block',
      required: true
    },
    {
      name: 'destination',
      type: '@blind-push/blind-peer-request-destination',
      required: true
    }
  ]
})

blindPush.register({
  name: 'proof-payload',
  fields: [
    {
      name: 'version',
      type: 'uint',
      required: true
    },
    {
      name: 'proof',
      type: 'buffer',
      required: true
    },
    {
      name: 'extra',
      type: 'buffer',
      required: false
    }
  ]
})

blindPush.register({
  name: 'push-payload',
  fields: [
    {
      name: 'payload',
      type: 'buffer',
      required: true
    },
    {
      name: 'discoveryKey',
      type: 'buffer',
      required: true
    }
  ]
})

blindPush.register({
  name: 'gateway-forward-request',
  fields: [
    {
      name: 'payload',
      type: '@blind-push/push-payload',
      required: true
    },
    {
      name: 'appId',
      type: 'string',
      required: false
    }
  ]
})

Hyperschema.toDisk(schema)
