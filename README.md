# blind-push

Create encrypted Hypercore push notifications for the sender core -> blind-peer -> push forwarder -> FCM -> receiver core flow.

## Overview

This package turns Hypercore proofs into compact notification payloads for the blind-peer delivery path. In the deployed flow, the sender core does not hand craft the push payload itself. Instead, it sends an RPC request to a blind-peer, the blind-peer generates the encrypted payload from its replicated Hypercore state, then sends an RPC request to a push forwarder, which delivers the payload over FCM to the receiver core.

High level:

```txt
sender core
  -> BlindPeerRequest RPC
blind-peer
  -> createNotification(...)
  -> { discoveryKey, payload }
  -> ForwardPushRequest RPC
push forwarder
  -> FCM
receiver core
  -> decode(...)            // optional transport decoding
  -> readNotification(store, roomKey, payload)
  -> verified proof / newer-state signal
```

If the latest block would make the notification too large for common push payload limits, `blind-push` falls back to a compact proof without inline block data. The receiver can still verify that newer data exists and fetch the missing block over Hypercore replication.

## API

#### `const notification = await blindPush.createNotification(core, [options])`

Create an encrypted notification payload from a Hypercore block proof.

In the deployed flow, `core` is typically the blind-peer's replicated view of the sender core, not the sender's local process.

`options` include:

- `roomKey`: optional room key used to encrypt the notification. Defaults to `core.key`.
- `roomDiscoveryKey`: optional discovery key to expose in the returned payload. Defaults to `crypto.discoveryKey(roomKey)`.
- `index`: optional block index to prove. Defaults to `core.length - 1`.
- `timeout`: optional timeout passed to `core.get(...)`. Defaults to `10000`.

Resolves to:

- `notification.discoveryKey`: discovery key for the room.
- `notification.payload`: encrypted proof bytes suitable for forwarding in a push payload.

If the encrypted payload exceeds the internal size budget, the returned notification omits inline block data and carries a compact proof instead.

#### `const result = await blindPush.readNotification(store, roomKey, payload)`

Decrypt and verify a notification payload against a local Hypercore store.

- `store`: a Hypercore store instance, for example `core.state.storage.store`.
- `roomKey`: the room key used to decrypt the notification payload.
- `payload`: encrypted proof bytes returned by `createNotification`.

Resolves to the verified result from `hypercore/lib/fully-remote-proof`, or `null` if the proof targets a core that does not exist in the provided store.

Common fields on the resolved result include:

- `key`: the sender core key.
- `discoveryKey`: the sender core discovery key.
- `length`: the proved core length.
- `newer`: `true` when the receiver is behind the proved length.
- `block`: the proved block when it was embedded in the notification, otherwise `null`.

#### `const raw = blindPush.encode(notification)`

Encode a `{ discoveryKey, payload }` notification object using the package's `PushPayload` compact encoding.

#### `const notification = blindPush.decode(raw)`

Decode a `PushPayload` buffer back into `{ discoveryKey, payload }`.

### Errors

#### `const BlindPushError = require('blind-push/errors')`

Exports the package error type.

#### `BlindPushError.INVALID_DECRYPTION_KEY()`

Returned by `readNotification(...)` when the payload cannot be decrypted with the provided `roomKey`, or when the payload is malformed.

### Encodings

#### `const encodings = require('blind-push/encodings')`

Exports the generated compact encodings used by the package:

- `encodings.PushPayload`: `{ discoveryKey, payload }`, the encrypted push payload delivered to the receiver.
- `encodings.BlindPeerRequest`: sender -> blind-peer RPC envelope with `{ block: { key, index }, destination: { key, discoveryKey } }`.
- `encodings.ForwardPushRequest`: blind-peer -> push forwarder RPC envelope with `{ payload, appId? }`.
