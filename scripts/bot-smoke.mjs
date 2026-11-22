// Смоук ботов: стол с двумя ботами разных уровней, человек только стартует партию,
// свои ходы подставляет драйвер (как в юнит-тесте) — боты играют сами.
// Мгновенные ответы ботов: сервер должен быть запущен с PF_BOT_DELAY_MS=0:
//   lsof -ti :3005 | xargs kill; PF_BOT_DELAY_MS=0 pnpm dev
// Без переменной боты играют с человеческими паузами (500–2500 мс на ход).
// Финал: GameResult записан, в логах нет game:error, места у всех троих.
// usage: node scripts/bot-smoke.mjs
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

const failures = []

// Короткая партия: дорогие шестерные (6→10 в пулю) + лимит 10 раздач.
const table = await createTable("Анна", {
  variant: "LENINGRADKA",
  bullet: 10,
  roundsLimit: 10,
  allowSpectators: false,
  rules: { gameValues: { 6: 10 } },
})
console.log("стол              ", table.key)

const anna = connect(table.cookie)
let snapshot = null
let lastSignature = ""
let lastRoundLogged = 0
const states = []

anna.on("game:state", (state) => {
  snapshot = state
  states.push(state)
  if (state.roundsPlayed !== lastRoundLogged) {
    lastRoundLogged = state.roundsPlayed
    console.log(`... сыграно раздач: ${state.roundsPlayed}`)
  }
})
anna.on("game:error", (error) => {
  console.error(`game:error >>> ${error.message}`)
  failures.push(`game:error ${error.message}`)
})
anna.on("room:error", (error) => failures.push(`room:error ${error.message}`))

anna.emit("room:join", { key: table.key })
await sleep(700)

// Сажаем двух ботов разных уровней на свободные места
anna.emit("game:bot-seat", { seat: 1, level: "MASTER" })
await sleep(400)
anna.emit("game:bot-seat", { seat: 2, level: "NOVICE" })
await sleep(600)

if (!snapshot || snapshot.players.length !== 3) {
  failures.push(`за столом ${snapshot?.players.length ?? 0} из 3 — боты не сели`)
} else {
  const bots = snapshot.players.filter((player) => player.isBot)
  console.log(
    "боты за столом    ",
    bots.map((bot) => `${bot.nickname} (${bot.botLevel})`).join(", "),
  )
  if (bots.length !== 2) failures.push(`ботов за столом ${bots.length} из 2`)
}

// Хозяин стартует партию; дальше ботами управляет планировщик сервера,
// а за Анну драйвер подставляет простейшие ходы.
anna.emit("game:start", {})
console.log("партия начата     ")

const driver = setInterval(() => {
  const round = snapshot?.round
  if (!round || snapshot.mySeat === null) return
  // Партия закрыта — драйвер больше не действует.
  if (snapshot.status !== "PLAYING") return

  // states.length строго растёт с каждым действием сервера: одна и та же
  // фаза/ход/взятка может повторяться от взятки к взятке, и без счётчика
  // драйвер пропустил бы второй такой же ход (мгновенные боты).
  const signature = `#${states.length}:${
    round.phase === "scored"
      ? `scored:${snapshot.readyUserIds.length}`
      : `${round.phase}:${round.turn}:${round.discardCount}:${round.trick.length}:${round.bids.map((bid) => (bid === null ? "-" : bid === "pass" ? "p" : "b")).join("")}`
  }`
  if (signature === lastSignature) return
  lastSignature = signature

  if (round.phase === "scored") {
    if (!snapshot.readyUserIds.includes(snapshot.players.find((p) => p.seat === snapshot.mySeat)?.userId)) {
      anna.emit("game:ready", {})
    }
    return
  }
  if (round.turn !== snapshot.mySeat) return

  if (round.phase === "bidding") {
    if (round.highest === null) anna.emit("game:bid", { level: 6, trump: "S" })
    else anna.emit("game:pass", {})
  } else if (round.phase === "declaring" && round.declarer === snapshot.mySeat) {
    anna.emit("game:declare", {
      contract: "game",
      discard: snapshot.myHand.slice(0, 2),
    })
  } else if (round.phase === "whist") {
    anna.emit("game:whist", { whist: false })
  } else if (round.phase === "play") {
    const card = snapshot.myLegalMoves[0]
    if (card) anna.emit("game:card", { card })
  }
}, 150)

// Ждём финал: статус FINISHED и три записанных места
const started = Date.now()
let finalSnapshot = null
while (Date.now() - started < 900000) {
  await sleep(1000)
  if (snapshot?.status === "FINISHED" && snapshot.standings) {
    finalSnapshot = snapshot
    break
  }
}

clearInterval(driver)

if (!finalSnapshot) {
  failures.push("партия не доигралась до финала за отведённое время")
} else {
  console.log("раздач сыграно    ", finalSnapshot.roundsPlayed)
  console.log("итоговые места    ")
  for (const entry of finalSnapshot.standings) {
    const player = finalSnapshot.players.find((item) => item.seat === entry.seat)
    console.log(
      `   ${player?.nickname ?? "?"}: место ${entry.place}, счёт ${entry.score}`,
    )
  }
  if (finalSnapshot.standings.length !== 3) {
    failures.push(`мест в итоге ${finalSnapshot.standings.length} из 3`)
  }
}

anna.close()

if (failures.length > 0) {
  for (const message of failures) console.error("FAILED:", message)
  process.exit(1)
}
console.log("BOT SMOKE OK")
