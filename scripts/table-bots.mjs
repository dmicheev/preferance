// Боты-соседи по столу: играют за Анну и Бориса, ходы третьего игрока не трогают.
// usage: node scripts/table-bots.mjs <key> <cookieAnna> <cookieBoris>
import { io } from "socket.io-client"

const url = "http://localhost:3005"
const [key, cookieA, cookieB] = process.argv.slice(2)
if (!key || !cookieA || !cookieB) {
  console.error("usage: node scripts/table-bots.mjs <key> <cookieAnna> <cookieBoris>")
  process.exit(1)
}

const connect = (cookie) =>
  io(url, { path: "/socket.io", transports: ["websocket"], extraHeaders: { cookie } })

const anna = connect(cookieA)
const boris = connect(cookieB)

let annaSnapshot = null
let borisSnapshot = null

anna.on("game:state", (snapshot) => {
  annaSnapshot = snapshot
})
boris.on("game:state", (snapshot) => {
  borisSnapshot = snapshot
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
await sleep(300)

anna.emit("room:join", { key })
boris.emit("room:join", { key })
await sleep(600)

// Хозяин начинает партию
anna.emit("game:start", {})
console.log("боты: партия начата, ходы Анны и Бориса на автопилоте")

setInterval(() => {
  for (const [snapshot, socket] of [
    [annaSnapshot, anna],
    [borisSnapshot, boris],
  ]) {
    const round = snapshot?.round
    if (!round || snapshot.mySeat === null) continue

    const signature =
      round.phase === "scored"
        ? `scored:${snapshot.readyUserIds.length}`
        : `${round.phase}:${round.turn ?? "wait"}:${round.discardCount}:${round.prikupAck.length}:${round.trickAck.length}:${round.trick.length}:${round.bids.map((bid) => (bid === null ? "-" : bid === "pass" ? "p" : "b")).join("")}`

    if (socket.lastSignature === signature) continue
    socket.lastSignature = signature

    if (round.phase === "bidding" && round.turn === snapshot.mySeat) {
      if (round.highest === null) {
        socket.emit("game:bid", { level: 6, trump: "S" })
      } else {
        socket.emit("game:pass", {})
      }
    } else if (round.phase === "declaring" && round.prikupAck.length < 3) {
      // Прикуп открыт: Ок жмут оба бота, снос после последнего.
      if (!round.prikupAck.includes(snapshot.mySeat)) {
        socket.emit("game:prikup-ack", {})
      }
    } else if (
      round.phase === "declaring" &&
      round.declarer === snapshot.mySeat &&
      round.discardCount === 0
    ) {
      socket.emit("game:declare", {
        contract: "game",
        discard: snapshot.myHand.slice(0, 2),
      })
    } else if (round.phase === "whist" && round.turn === snapshot.mySeat) {
      socket.emit("game:whist", { whist: false })
    } else if (round.phase === "play" && round.turn === null) {
      // Взятка сошлась: Ок жмут оба бота, потом победитель ходит.
      if (!round.trickAck.includes(snapshot.mySeat)) {
        socket.emit("game:trick-ack", {})
      }
    } else if (round.phase === "play" && round.turn === snapshot.mySeat) {
      const card = snapshot.myLegalMoves[0]
      if (card) socket.emit("game:card", { card })
    } else if (round.phase === "scored") {
      const me = snapshot.players.find((entry) => entry.seat === snapshot.mySeat)
      if (me && !snapshot.readyUserIds.includes(me.userId)) {
        socket.emit("game:ready", {})
      }
    }
  }
}, 150)

// Держим процесс живым, пока человек играет за третий стул
console.log("боты: живу, жду завершения (pid " + process.pid + ")")
process.on("SIGINT", () => process.exit(0))
setInterval(() => {}, 1 << 30)
