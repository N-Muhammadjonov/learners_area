# Live Partner signalling service

A long-running WebSocket relay for WebRTC offer/answer/ICE between the **two**
participants of a Live Partner session. Zero dependencies (Node ≥ 22). It
never receives audio, and it stores and logs nothing about calls (just in-memory
rooms and counters).

## Protocol (`wss://<host>/signal`)

1. The client connects and must send `{"type":"auth","token":"<jwt>"}` within 5 s.
   The token comes from the app (`POST /api/live-partner {action:"signal_token"}`). It is
   issued only to a participant of a live session, uses HS256 with `aud=learners-area-live-signal`
   and `iss=learners-area`, expires after 120 s, and carries `sub`, `peer`, `sid` and `role`.
2. The server replies `{"type":"ready","role","peerPresent"}`. The peer receives `peer-joined`.
3. `{"type":"signal","kind":"offer|answer|candidate|bye|restart","data":…}` is relayed to the other participant only.
   Candidates that are not `typ relay` are dropped, so no host or server-reflexive (srflx) IP addresses reach a stranger.
4. It rejects any third user, expired, tampered or wrong-audience tokens, bad messages,
   messages over 16 KB, unmasked frames and floods (token bucket: 60 messages burst, 6/s). Rejected connections close with code 4401.
5. A reconnecting participant with a fresh token replaces their old socket (close code 4000).

Suspended/inactive accounts cannot obtain a token: the app route requires an active user.

## Run

```sh
LIVE_PARTNER_SIGNAL_SECRET=<≥32 random chars> ALLOWED_ORIGINS=https://<app-origin> PORT=8787 node server.mjs
npm test          # 4 integration tests over real sockets
```

Put it behind TLS (`wss://`). Any always-on host works: a small VM, Fly.io, Railway or a container.
Use **one instance**, because rooms are in memory. To scale out, move rooms to Redis pub/sub.
Do **not** deploy it as a Vercel function.

## TURN (relay-only)

The calls use `iceTransportPolicy: "relay"`. Run coturn with the REST-API shared secret:

```
# /etc/turnserver.conf
use-auth-secret
static-auth-secret=<LIVE_PARTNER_TURN_SECRET>
realm=<your-domain>
listening-port=3478
tls-listening-port=5349
cert=/etc/letsencrypt/live/<turn-host>/fullchain.pem
pkey=/etc/letsencrypt/live/<turn-host>/privkey.pem
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

The app derives 10-minute credentials per user, so the secret never reaches the browser.
A managed TURN service with REST-style ephemeral credentials also works if it uses the same HMAC scheme.

## App environment (Vercel, Preview first)

```
LIVE_PARTNER_SIGNAL_URL=wss://<signal-host>/signal
LIVE_PARTNER_SIGNAL_SECRET=<same secret as the service>
LIVE_PARTNER_TURN_URLS=turns:<turn-host>:5349?transport=tcp,turn:<turn-host>:3478
LIVE_PARTNER_TURN_SECRET=<coturn static-auth-secret>
```

The app treats realtime as ready only when these are set **and** `https://<signal-host>/healthz`
answers. Otherwise Go Online, Invite and Accept are refused with 503 and the page says why.
Configuring these variables does not prove audio works. Two-way audio between two
real browsers is a separate acceptance gate.
