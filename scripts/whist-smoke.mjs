// Смоук вистов: трое живых клиентов за столом. Торговля: первый говорит 6♠,
// остальные пасуют; ОБА защитника всегда вистуют. Проверяем, что после записи
// раздачи висты у каждого вистующего равны его собственным взяткам × ставка,
// а у играющего вистов нет. Сервер с мгновенными ботами не нужен: людей играем сами.
// usage: node --import tsx scripts/whist-smoke.mjs
import { io } from "socket.io-client"

import { valueLevel, whistRate } from "../src/lib/preference/rules.ts"

const url = process.env.SMOKE_URL ?? "http://localhost:3005"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function api(path, body, cookie) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${data.error}`)
  const cookies = response.headers.getSetCookie?.() ?? []
  const session = cookies.find((entry) => entry.startsWith("pf_player="))
  return { data, cookie: session ? session.split(";")[0] : cookie }
}

const host = await api("/api/games", {
  nickname: "Вист-Смоук", variant: "LENINGRADKA", bullet: 50, roundsLimit: null, allowSpectators: false,
})
const key = host.data.key
const p2 = await api(`/api/games/${key}/join`, { nickname: "Виктор" })
const p3 = await api(`/api/games/${key}/join`, { nickname: "Ольга" })
console.log("стол              ", key)

const clients = [host, p2, p3].map((entry, index) => {
  const socket = io(url, {
    path: "/socket.io",
    transports: ["websocket"],
    extraHeaders: { cookie: entry.cookie },
  })
  const state = { socket, snapshot: null, last: "", name: ["Вист-Смоук", "Виктор", "Ольга"][index] }
  socket.on("game:state", (snapshot) => { state.snapshot = snapshot })
  socket.on("game:error", (error) => console.error(`game:error(${state.name}) >>> ${error.message}`))
  socket.emit("room:join", { key })
  return state
})
await sleep(700)

// Партию начинает хозяин стола.
clients[0].socket.emit("game:start", {})
await sleep(300)

const driver = setInterval(() => {
  for (const state of clients) {
    const snapshot = state.snapshot
    const round = snapshot?.round
    if (!round || snapshot.mySeat === null || snapshot.status !== "PLAYING") continue

    const signature = `${snapshot.roundsPlayed}:${round.phase}:${round.turn}:${round.trick.length}:${round.trickAck.length}:${round.prikupAck.length}:${round.discardCount}:${snapshot.readyUserIds.length}`
    if (signature === state.last) continue
    state.last = signature

    if (round.phase === "bidding") {
      if (round.turn !== snapshot.mySeat) continue
      // Первый говорящий заказывает 6♠, остальные пасуют — контрактом будет игра.
      if (round.highest === null) state.socket.emit("game:bid", { level: 6, trump: "S" })
      else state.socket.emit("game:pass", {})
      continue
    }
    if (round.phase === "declaring") {
      if (round.prikupAck.length < 3) {
        if (!round.prikupAck.includes(snapshot.mySeat)) state.socket.emit("game:prikup-ack", {})
        continue
      }
      if (round.declarer === snapshot.mySeat && round.discardCount === 0) {
        const hand = snapshot.myHand
        state.socket.emit("game:declare", { contract: "game", discard: [hand[0], hand[1]] })
      }
      continue
    }
    if (round.phase === "whist") {
      if (round.turn !== snapshot.mySeat) continue
      state.socket.emit("game:whist", { whist: true }) // оба защитника всегда вистуют
      continue
    }
    if (round.phase === "play") {
      if (round.turn === null) {
        if (!round.trickAck.includes(snapshot.mySeat)) state.socket.emit("game:trick-ack", {})
        continue
      }
      if (round.turn === snapshot.mySeat && snapshot.myLegalMoves.length > 0) {
        state.socket.emit("game:card", { card: snapshot.myLegalMoves[0] })
      }
      continue
    }
    if (round.phase === "scored") {
      const mine = snapshot.players.find((player) => player.seat === snapshot.mySeat)
      if (mine && !snapshot.readyUserIds.includes(mine.userId)) state.socket.emit("game:ready", {})
    }
  }
}, 30)

const firstResult = await new Promise((resolve) => {
  const listener = (result) => {
    if (result.outcome.contract.kind === "game" && result.outcome.whisters.length === 2) {
      clients[0].socket.off("game:round-result", listener)
      resolve(result)
    }
  }
  clients[0].socket.on("game:round-result", listener)
  setTimeout(() => resolve(null), 60_000)
})
clearInterval(driver)

const failures = []
const nicknameOf = (clients, seat) =>
  clients[0].snapshot?.players.find((player) => player.seat === seat)?.nickname ?? `место ${seat}`

if (!firstResult) {
  failures.push("за 60 секунд не доиграли раздачу с двумя вистующими")
} else {
  const { outcome, deltas } = firstResult
  const level = valueLevel(outcome.contract.level, outcome.contract.trump)
  const rate = whistRate(level, outcome.whisters.length, {
    singleWhistRate: 1, whistRateSix: 2, whistRateHigh: 1,
  })
  console.log(`раздача №${firstResult.roundNumber}: ${nicknameOf(clients, outcome.declarer)} играет ${outcome.contract.level}${outcome.contract.trump}, взял ${outcome.tricks[outcome.declarer]}; ставка ${rate} за взятку`)
  for (const seat of outcome.whisters) {
    const expected = outcome.tricks[seat] * rate
    const got = deltas[seat].whists
    const mark = got === expected ? "✔" : "✘"
    console.log(`  ${mark} ${nicknameOf(clients, seat)}: ${outcome.tricks[seat]} взяток → ${got} вистов (ожидалось ${expected})`)
    if (got !== expected) failures.push(`висты ${nicknameOf(clients, seat)}: ${got} вместо ${expected}`)
  }
  if (deltas[outcome.declarer].whists !== 0) failures.push("играющий получил висты")
  if (outcome.tricks.reduce((sum, value) => sum + value, 0) !== 10) failures.push("сумма взяток не 10")
}

console.log(failures.length ? `\nПРОВАЛ: ${failures.join("; ")}` : "\nОК: оба вистующих получили висты по своим взяткам")
for (const state of clients) state.socket.disconnect()
process.exit(failures.length ? 1 : 0)
