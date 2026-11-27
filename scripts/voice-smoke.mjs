import { createHmac } from "node:crypto"
import { io } from "socket.io-client"

// Смоук-тест голосового стола: состав голосующих, ретрансляция сигналов
// и отказ тем, кто не сидит за столом. Сервер должен быть поднят.
//
// usage: node scripts/voice-smoke.mjs <key> <userIdA> <userIdB>

const url = "http://localhost:3005"
const [key, userA, userB] = process.argv.slice(2)

if (!key || !userA || !userB) {
  console.error("usage: node scripts/voice-smoke.mjs <key> <userIdA> <userIdB>")
  process.exit(1)
}

const secret = process.env.SESSION_SECRET
if (!secret || secret.length < 32) {
  console.error("SESSION_SECRET не задан — запусти через dotenv (см. pnpm dev)")
  process.exit(1)
}

const sign = (userId) =>
  `${userId}.${createHmac("sha256", secret).update(userId).digest("hex")}`

const connect = (userId) =>
  io(url, {
    path: "/socket.io",
    transports: ["websocket"],
    extraHeaders: { cookie: `pf_player=${encodeURIComponent(sign(userId))}` },
  })

/** Очередь событий: подписываемся заранее, ждём по требованию. */
function queue(socket, event) {
  const pending = []
  const waiters = []
  socket.on(event, (payload) => {
    const waiter = waiters.shift()
    if (waiter) waiter.resolve(payload)
    else pending.push(payload)
  })
  return (timeout = 5000) =>
    new Promise((resolve, reject) => {
      if (pending.length > 0) return resolve(pending.shift())
      const waiter = { resolve }
      waiters.push(waiter)
      setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout)
    })
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const a = connect(userA)
const b = connect(userB)
const outsider = connect(userA) // тот же игрок, но без стола

const aPeers = queue(a, "voice:peers")
const bPeers = queue(b, "voice:peers")
const bSignal = queue(b, "voice:signal")
const aSignal = queue(a, "voice:signal")
const outsiderError = queue(outsider, "voice:error")
const aPeersAfterLeave = queue(a, "voice:peers")

let failed = false

try {
  a.emit("room:join", { key })
  b.emit("room:join", { key })
  await tick(300)

  // 1. Игрок без голоса получает состав голоса при входе другого.
  //    Эхо своей заявки потребляем у обоих: broadcast уходит и отправителю.
  a.emit("voice:join", {})
  const selfRoster = await aPeers()
  const firstRoster = await bPeers()
  console.log("A voice:join (эхо) ", JSON.stringify(selfRoster))
  console.log("A voice:join       ", JSON.stringify(firstRoster))
  if (firstRoster.peers.length !== 1) throw new Error("состав голоса пуст")

  // 2. Второй голосующий: состав у обоих растёт до двух.
  b.emit("voice:join", {})
  const fullRosterA = await aPeers()
  const fullRosterB = await bPeers()
  console.log("B voice:join (A)   ", JSON.stringify(fullRosterA))
  console.log("B voice:join (B)   ", JSON.stringify(fullRosterB))
  if (fullRosterA.peers.length !== 2 || fullRosterB.peers.length !== 2) {
    throw new Error("второй не доехал до состава")
  }

  const idA = fullRosterA.peers.find((peer) => peer.userId === userA).socketId
  const idB = fullRosterA.peers.find((peer) => peer.userId === userB).socketId

  // 3. Ретрансляция сигнала: ICE-кандидат доходит с пометкой «от кого».
  a.emit("voice:signal", {
    to: idB,
    data: { kind: "ice", candidate: { candidate: "candidate:smoke 1 udp 1 127.0.0.1 9 typ host" } },
  })
  const relayed = await bSignal()
  console.log("A → B voice:signal", JSON.stringify(relayed))
  if (relayed.from !== idA) throw new Error("пометка «от кого» потерялась")

  // 4. Обратное направление: SDP-подобная посылка доходит до A.
  b.emit("voice:signal", {
    to: idA,
    data: { kind: "desc", description: { type: "offer", sdp: "v=0\r\nsmoke\r\n" } },
  })
  const relayedBack = await aSignal()
  console.log("B → A voice:signal", JSON.stringify(relayedBack))
  if (relayedBack.data.kind !== "desc") throw new Error("SDP исказился при ретрансляции")

  // 5. Адресат вне состава: мусор до B не доходит и сервер не падает.
  a.emit("voice:signal", {
    to: "socket-does-not-exist",
    data: { kind: "ice", candidate: { candidate: "candidate:bogus" } },
  })
  await tick(400)
  console.log("A → мимо состава   сигнал проглочен, тишина (ок)")

  // 6. Голос без стола: чужаку отказ.
  outsider.emit("voice:join", {})
  const refusal = await outsiderError()
  console.log("без стола voice:error", JSON.stringify(refusal))

  // 7. Выход из голоса: состав снова один.
  b.emit("voice:leave", {})
  const afterLeave = await aPeersAfterLeave()
  console.log("B voice:leave     ", JSON.stringify(afterLeave))
  if (afterLeave.peers.length !== 1) throw new Error("ушедший остался в составе")
} catch (error) {
  failed = true
  console.error("FAILED:", error.message)
} finally {
  a.close()
  b.close()
  outsider.close()
  if (failed) process.exitCode = 1
}
