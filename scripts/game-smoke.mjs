// Смоук партии: три игрока играют полную раздачу от торговли до записи очков.
// usage: node scripts/game-smoke.mjs
import { io } from "socket.io-client"

const url = "http://localhost:3005"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function createTable(nickname, options) {
  const response = await fetch(`${url}/api/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, ...options }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`create: ${data.error}`)
  return { key: data.key, cookie: extractCookie(response) }
}

async function joinTable(key, nickname) {
  const response = await fetch(`${url}/api/games/${key}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`join ${nickname}: ${data.error}`)
  return extractCookie(response)
}

function extractCookie(response) {
  const cookies = response.headers.getSetCookie?.() ?? []
  const session = cookies.find((entry) => entry.startsWith("pf_player="))
  if (!session) throw new Error("сервер не выдал сессию")
  return session.split(";")[0]
}

const connect = (cookie) =>
  io(url, {
    path: "/socket.io",
    transports: ["websocket"],
    extraHeaders: { cookie },
  })

function queue(socket, event) {
  const pending = []
  const waiters = []
  socket.on(event, (payload) => {
    const waiter = waiters.shift()
    if (waiter) waiter.resolve(payload)
    else pending.push(payload)
  })
  return (timeout = 8000) =>
    new Promise((resolve, reject) => {
      if (pending.length > 0) return resolve(pending.shift())
      const waiter = { resolve }
      waiters.push(waiter)
      setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout)
    })
}

const CARD_PATTERN = /(?:[SHDC])(?:10|[789JQKA])/g

/** Периодическая проверка условия с таймаутом. */
function waitFor(condition, label, timeout = 8000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (condition()) return resolve(true)
      if (Date.now() - started > timeout) {
        console.error(`timeout: ${label}`)
        return resolve(false)
      }
      setTimeout(tick, 100)
    }
    tick()
  })
}

/** Карта в снапшоте легальна, только если это своя рука, прикуп или карты на столе. */
function assertNoLeak(snapshot, label) {
  const allowed = new Set([
    ...snapshot.myHand,
    ...(snapshot.round?.prikupOpen ?? []),
    ...(snapshot.round?.trick ?? []).map((item) => item.card),
    ...(snapshot.round?.lastTrick?.cards ?? []).map((item) => item.card),
  ])
  const raw = JSON.stringify(snapshot).replaceAll(snapshot.key, "")
  for (const match of raw.match(CARD_PATTERN) ?? []) {
    if (!allowed.has(match)) {
      const at = raw.indexOf(match)
      throw new Error(
        `${label}: в снапшоте утекла чужая карта ${match} · контекст: …${raw.slice(Math.max(0, at - 60), at + 20)}…`,
      )
    }
  }
}

// ---------- сценарий ----------

const failures = []

/** Режим «finish»: короткая партия (лимит 2 раздачи) до записи итогов в БД. */
const FINISH_MODE = process.argv[2] === "finish"

const table = await createTable("Анна", {
  variant: "LENINGRADKA",
  bullet: FINISH_MODE ? 10 : 20,
  roundsLimit: FINISH_MODE ? 10 : null,
  allowSpectators: false,
  rules: FINISH_MODE ? { gameValues: { 6: 10 } } : undefined,
})
console.log("стол создан       ", table.key)

const cookieB = await joinTable(table.key, "Борис")
const cookieV = await joinTable(table.key, "Вера")

const anna = connect(table.cookie)
const boris = connect(cookieB)
const vera = connect(cookieV)

const players = [
  { socket: anna, nickname: "Анна" },
  { socket: boris, nickname: "Борис" },
  { socket: vera, nickname: "Вера" },
]

for (const player of players) {
  player.snapshot = null
  player.lastSignature = ""
  player.sawScored = false
  player.stateCount = 0
  player.latestState = queue(player.socket, "game:state")
  player.socket.on("game:state", (snapshot) => {
    player.stateCount += 1
    player.snapshot = snapshot
    player.phaseLog = player.phaseLog ?? []
    player.phaseLog.push(`${snapshot.round?.phase ?? "нет"}/${snapshot.roundsPlayed}`)
    if (snapshot.round?.phase === "scored") player.sawScored = true
    try {
      assertNoLeak(snapshot, player.nickname)
    } catch (error) {
      failures.push(error.message)
    }
  })
  player.socket.on("game:error", (error) => {
    failures.push(`${player.nickname}: game:error ${error.message}`)
  })
  player.socket.on("room:error", (error) => {
    failures.push(`${player.nickname}: room:error ${error.message}`)
  })
}

const dealStates = queue(anna, "game:dealt")
const roundResult = queue(anna, "game:round-result")

// Рассаживаемся за столом
for (const player of players) {
  player.socket.emit("room:join", { key: table.key })
  await player.latestState()
}
console.log("трое за столом    ")

// Хозяин начинает партию
anna.emit("game:start", {})
const firstDeal = await dealStates()
console.log("раздача №1        ", JSON.stringify(firstDeal))

await sleep(400)

// Водитель: игрок действует один раз на каждое новое состояние раздачи
const driver = setInterval(() => {
  for (const player of players) {
    const snapshot = player.snapshot
    const round = snapshot?.round
    if (!round || snapshot.mySeat === null) continue

    const signature =
      round.phase === "scored"
        ? `scored:${snapshot.readyUserIds.length}`
        : `${round.phase}:${round.turn ?? "wait"}:${round.discardCount}:${round.prikupAck.length}:${round.trickAck.length}:${round.trick.length}:${round.bids.map((bid) => (bid === null ? "-" : bid === "pass" ? "p" : "b")).join("")}`

    if (player.lastSignature === signature) continue
    player.lastSignature = signature

    if (round.phase === "bidding" && round.turn === snapshot.mySeat) {
      if (round.highest === null) {
        player.socket.emit("game:bid", { level: 6, trump: "S" })
      } else {
        player.socket.emit("game:pass", {})
      }
    } else if (round.phase === "declaring" && round.prikupAck.length < 3) {
      // Прикуп открыт: каждый жмёт Ок, снос после последнего.
      if (!round.prikupAck.includes(snapshot.mySeat)) {
        player.socket.emit("game:prikup-ack", {})
      }
    } else if (
      round.phase === "declaring" &&
      round.declarer === snapshot.mySeat &&
      round.discardCount === 0
    ) {
      player.socket.emit("game:declare", {
        contract: "game",
        // Правило после прикупа: заказ можно поднять — смок поднимает 6♠ до 7♠.
        discard: snapshot.myHand.slice(0, 2),
        level: 7,
        trump: "S",
      })
    } else if (round.phase === "whist" && round.turn === snapshot.mySeat) {
      player.socket.emit("game:whist", { whist: false })
    } else if (round.phase === "play" && round.turn === null) {
      // Взятка сошлась: каждый жмёт Ок, потом победитель ходит.
      if (!round.trickAck.includes(snapshot.mySeat)) {
        player.socket.emit("game:trick-ack", {})
      }
    } else if (round.phase === "play" && round.turn === snapshot.mySeat) {
      const card = snapshot.myLegalMoves[0]
      if (card) player.socket.emit("game:card", { card })
    } else if (round.phase === "scored") {
      const myUserId = snapshot.players.find(
        (entry) => entry.nickname === player.nickname,
      )?.userId
      if (myUserId && !snapshot.readyUserIds.includes(myUserId)) {
        player.socket.emit("game:ready", {})
      }
    }
  }
}, 150)

// Ждём итог раздачи
const result = await roundResult(60000)
console.log("раздача сыграна   ", `контракт=${JSON.stringify(result.outcome.contract)}`)
if (
  result.outcome.contract.kind !== "game" ||
  result.outcome.contract.level !== 7 ||
  result.outcome.contract.trump !== "S"
) {
  throw new Error(`подъём заказа не доехал: ${JSON.stringify(result.outcome.contract)}`)
}
console.log(
  "таблица после     ",
  result.table.entries
    .map((entry) => `${entry.pool}/${entry.mountain}/${entry.whists}`)
    .join(" "),
)

const scored = await waitFor(
  () => players.every((player) => player.sawScored),
  "фаза scored не была показана всем игрокам",
)
if (!scored) {
  for (const player of players) {
    console.error(
      `diag ${player.nickname}: sawScored=${player.sawScored} states=${player.stateCount} last=${(player.phaseLog ?? []).slice(-4).join(" → ")}`,
    )
  }
  for (const message of failures) console.error("failure:", message)
  process.exit(1)
}
// Все готовы — сдаётся следующая раздача, сдающий сдвигается
const secondDeal = await dealStates(15000)
if (secondDeal.dealer === firstDeal.dealer) throw new Error("сдающий не сдвинулся")
console.log("раздача №2        ", JSON.stringify(secondDeal))

if (FINISH_MODE) {
  // Лимит раздач исчерпан: ждём финал партии и итоги
  const finished = await waitFor(
    () => players.every((player) => player.snapshot?.status === "FINISHED"),
    "партия не закрылась по лимиту раздач",
    150000,
  )
  if (!finished) process.exit(1)
  const standings = players[0].snapshot?.standings
  console.log("партия закрыта    ", JSON.stringify(standings))
  if (!standings || standings.length !== 3) {
    throw new Error("итоговых мест нет")
  }
  console.log("ключ для БД       ", table.key)
  for (const socket of [anna, vera]) socket.close()
  if (failures.length > 0) {
    for (const message of failures) console.error("FAILED:", message)
    process.exitCode = 1
  } else {
    console.log("FINISH OK")
  }
  process.exit(process.exitCode ?? 0)
}

clearInterval(driver)

// Перезагрузка страницы: Борису возвращается его партия
boris.disconnect()
await sleep(300)
const borisAgain = connect(cookieB)
const borisState = queue(borisAgain, "game:state")
borisAgain.emit("room:join", { key: table.key })
const snapshot = await borisState()
if (snapshot.mySeat === null) throw new Error("после переподключения место потерялось")
if (!snapshot.round) throw new Error("после переподключения раздача потерялась")
console.log(
  "переподключение   ",
  `место=${snapshot.mySeat}, фаза=${snapshot.round.phase}, карт=${snapshot.myHand.length}`,
)

// Зрители за этим столом не разрешены: подделка cookie отсекается на рукопожатии
const stranger = connect("pf_player=stranger-user-id")
const strangerError = queue(stranger, "connect_error")
stranger.emit("room:join", { key: table.key })
const error = await strangerError()
console.log("зритель отсажен   ", JSON.stringify(error.message))

for (const socket of [anna, vera, borisAgain, stranger]) socket.close()

if (failures.length > 0) {
  for (const message of failures) console.error("FAILED:", message)
  process.exitCode = 1
} else {
  console.log("SMOKE OK")
}
