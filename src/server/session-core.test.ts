import assert from "node:assert/strict"
import { test } from "node:test"

import { legalMoves } from "../lib/preference/round"
import type { Seat } from "../lib/preference/round"
import {
  applyUserProposal,
  buildSnapshot,
  createSession,
  dealerFor,
  setReady,
  startGame,
  type SessionState,
  type SessionPlayer,
  type UserProposal,
} from "./session-core"

const PLAYERS: SessionPlayer[] = [
  { userId: "u-anna", nickname: "Анна", seat: 0, isHost: true, isBot: false, botLevel: null },
  { userId: "u-boris", nickname: "Борис", seat: 1, isHost: false, isBot: false, botLevel: null },
  { userId: "u-vera", nickname: "Вера", seat: 2, isHost: false, isBot: false, botLevel: null },
]

function session(params?: Partial<Parameters<typeof createSession>[0]>): SessionState {
  return createSession({
    key: "AB12CD",
    gameId: "game-1",
    bullet: 20,
    roundsLimit: null,
    rules: null,
    players: PLAYERS,
    ...params,
  })
}

/** Доигрывает раздачу простыми ходами: первый говорящий заказывает 6♠, остальные пасуют. */
function driveRound(state: SessionState): SessionState {
  let current = state
  let guard = 0
  while (current.round && current.round.phase !== "scored" && guard < 200) {
    guard += 1
    const round = current.round!
    const seat = round.turn as Seat
    const actorId = current.players.find((entry) => entry.seat === seat)!.userId

    let proposal: UserProposal
    if (round.phase === "bidding") {
      proposal = round.highest === null
        ? { type: "bid", level: 6, trump: "S" }
        : { type: "pass" }
    } else if (round.phase === "declaring") {
      const hand = round.hands[seat]
      proposal = { type: "declare", contract: "game", discard: [hand[0], hand[1]] }
    } else if (round.phase === "whist") {
      proposal = { type: "whist", whist: false }
    } else {
      proposal = { type: "play", card: legalMoves(round, seat)[0] }
    }

    const applied = applyUserProposal(current, actorId, proposal)
    if (!applied.ok) throw new Error(`ход не прошёл: ${applied.error}`)
    current = applied.outcome.session
  }
  if (current.round?.phase !== "scored") throw new Error("раздача не доигралась")
  return current
}

test("сдающий ротируется по кругу среди трёх мест", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(dealerFor), [0, 1, 2, 0, 1])
})

test("сеанс создаётся с нормализованными правилами и пустой таблицей", () => {
  const state = session({ rules: { gameValues: { 6: 5 } } })
  assert.equal(state.status, "LOBBY")
  assert.equal(state.rules.gameValues[6], 5)
  assert.equal(state.rules.misereValue, 10, "недостающее добирается из пресета")
  assert.deepEqual(state.table.entries, [
    { pool: 0, mountain: 0, whists: 0 },
    { pool: 0, mountain: 0, whists: 0 },
    { pool: 0, mountain: 0, whists: 0 },
  ])
  assert.equal(state.round, null)
})

test("старт партии: трое за столом, раздача у первого сдающего", () => {
  const started = startGame(session(), 101)
  if (!started.ok) throw new Error(started.error)

  assert.equal(started.outcome.session.status, "PLAYING")
  assert.equal(started.outcome.session.round?.dealer, 0)
  assert.equal(started.outcome.session.round?.phase, "bidding")
  assert.deepEqual(started.outcome.actions, [
    { type: "deal", roundNumber: 1, dealer: 0 },
  ])

  const short = startGame(session({ players: PLAYERS.slice(0, 2) }), 102)
  assert.equal(short.ok, false)
  if (!short.ok) assert.match(short.error, /должны сидеть все трое/)
})

test("действие принимается только от сидящего и в его ход", () => {
  const started = startGame(session(), 201)
  if (!started.ok) throw new Error(started.error)
  const state = started.outcome.session

  const stranger = applyUserProposal(state, "u-неизвестный", { type: "pass" })
  assert.equal(stranger.ok, false)
  if (!stranger.ok) assert.match(stranger.error, /не за этим столом/)

  // Первое слово за местом 1 (сдаёт место 0).
  const notYours = applyUserProposal(state, "u-anna", { type: "pass" })
  assert.equal(notYours.ok, false)
  if (!notYours.ok) assert.match(notYours.error, /не ваш ход/)

  const mine = applyUserProposal(state, "u-boris", { type: "bid", level: 6, trump: "S" })
  assert.equal(mine.ok, true)
})

test("полная раздача доходит до записи очков и считает по кастомным цифрам", () => {
  const custom = session({
    bullet: 20,
    rules: { gameValues: { 6: 5 }, shortfallFactor: 3 },
  })
  const started = startGame(custom, 301)
  if (!started.ok) throw new Error(started.error)

  const played = driveRound(started.outcome.session)
  assert.equal(played.roundsPlayed, 1)
  assert.equal(played.status, "PLAYING", "партия продолжается после одной раздачи")

  const declarer = played.round!.declarer as Seat
  const taken = played.round!.tricks[declarer]
  const entry = played.table.entries[declarer]
  if (taken >= 6) {
    assert.equal(entry.pool, 5, "кастомная цена шестерной")
    assert.equal(entry.mountain, 0)
  } else {
    assert.equal(entry.mountain, (6 - taken) * 3 * 5, "кастомный множитель подсада")
  }
})

test("готовности собирают всех, потом сдаётся следующая раздача со сдвигом", () => {
  const started = startGame(session(), 401)
  if (!started.ok) throw new Error(started.error)

  const midPlay = setReady(started.outcome.session, "u-anna", 402)
  assert.equal(midPlay.ok, false, "готовность посреди раздачи не принимается")

  const scored = driveRound(started.outcome.session)

  const first = setReady(scored, "u-anna", 402)
  if (!first.ok) throw new Error(first.error)
  assert.deepEqual(first.outcome.session.readyUserIds, ["u-anna"])

  const dup = setReady(first.outcome.session, "u-anna", 402)
  assert.equal(dup.ok, false)
  if (!dup.ok) assert.match(dup.error, /уже записана/)

  const second = setReady(first.outcome.session, "u-boris", 402)
  if (!second.ok) throw new Error(second.error)

  const third = setReady(second.outcome.session, "u-vera", 402)
  if (!third.ok) throw new Error(third.error)

  assert.deepEqual(third.outcome.session.readyUserIds, [])
  assert.equal(third.outcome.session.roundsPlayed, 1)
  assert.equal(third.outcome.session.round?.dealer, 1, "сдающий сдвинулся")
  assert.equal(third.outcome.session.round?.phase, "bidding")
  assert.deepEqual(third.outcome.actions, [
    { type: "deal", roundNumber: 2, dealer: 1 },
  ])
})

test("лимит раздач закрывает партию: статус, итоги, места", () => {
  const limited = session({ bullet: 50, roundsLimit: 2 })
  const started = startGame(limited, 501)
  if (!started.ok) throw new Error(started.error)

  let state = started.outcome.session
  for (let round = 0; round < 2; round += 1) {
    state = driveRound(state)
    // Лимит мог закрыться на этой раздаче — готовности тогда уже не нужны.
    if (state.status !== "PLAYING") break
    for (const player of PLAYERS) {
      const step = setReady(state, player.userId, 600 + round)
      if (!step.ok) throw new Error(step.error)
      state = step.outcome.session
    }
  }

  assert.equal(state.status, "FINISHED")
  assert.equal(state.roundsPlayed, 2)

  const snapshot = buildSnapshot(state, "u-anna")
  assert.ok(snapshot.standings)
  assert.deepEqual(
    snapshot.standings.map((entry) => entry.place),
    [1, 2, 3],
  )
  assert.equal(snapshot.status, "FINISHED")
})

test("снапшот не раскрывает чужих карт и различает руки игроков", () => {
  const started = startGame(session(), 601)
  if (!started.ok) throw new Error(started.error)
  const state = started.outcome.session

  const anna = buildSnapshot(state, "u-anna")
  const boris = buildSnapshot(state, "u-boris")
  const spectator = buildSnapshot(state, null)

  assert.equal(anna.mySeat, 0)
  assert.equal(anna.myHand.length, 10)
  assert.equal(boris.myHand.length, 10)
  assert.notDeepEqual(anna.myHand, boris.myHand, "руки у игроков разные")

  assert.deepEqual(spectator.myHand, [])
  assert.equal(spectator.mySeat, null)
  assert.deepEqual(spectator.myLegalMoves, [])

  // В публичной части раздачи рук и прикупа нет вовсе.
  const roundJson = JSON.stringify(anna.round)
  assert.equal(roundJson.includes("hands"), false)
  assert.equal(roundJson.includes("prikup"), false)
  assert.equal(roundJson.includes('"discard"'), false)
  assert.deepEqual(anna.round?.handSizes, [10, 10, 10])

  // Сортировка руки: стабильна между запросами.
  assert.deepEqual(anna.myHand, buildSnapshot(state, "u-anna").myHand)
})

test("легальные ходы в снапшоте совпадают с движком", () => {
  const started = startGame(session(), 701)
  if (!started.ok) throw new Error(started.error)

  // В торговле легальных карт нет: ходы — это ставки.
  const bidding = buildSnapshot(started.outcome.session, "u-boris")
  assert.deepEqual(bidding.myLegalMoves, [])
  assert.equal(bidding.round?.turn, 1)
})

test("человек стартовал — боты доиграли партию до записи мест", async () => {
  const { chooseAction } = await import("../lib/preference/bot")

  const mixed: SessionPlayer[] = [
    { userId: "u-anna", nickname: "Анна", seat: 0, isHost: true, isBot: false, botLevel: null },
    { userId: "bot-1", nickname: "Компьютер 1", seat: 1, isHost: false, isBot: true, botLevel: "MASTER" },
    { userId: "bot-2", nickname: "Компьютер 2", seat: 2, isHost: false, isBot: true, botLevel: "NOVICE" },
  ]

  const limited = session({ bullet: 10, roundsLimit: 3, players: mixed })
  const started = startGame(limited, 801)
  if (!started.ok) throw new Error(started.error)

  let current = started.outcome.session
  let guard = 0

  // Водитель: ход человека подставляем сами (пас в торговле, первая легальная карта),
  // ходы ботов берём из chooseAction — как это делает планировщик.
  while (current.status === "PLAYING" && guard < 4000) {
    guard += 1
    const round = current.round
    if (!round) throw new Error("партия PLAYING без раздачи")

    if (round.phase === "scored") {
      // Готовность: человек подтвердил, боты подтверждают сразу.
      for (const player of current.players) {
        const step = setReady(current, player.userId, 900 + guard)
        if (!step.ok) continue
        current = step.outcome.session
      }
      continue
    }

    const seat = round.turn as Seat
    const player = current.players.find((entry) => entry.seat === seat)!
    let proposal: UserProposal
    if (player.isBot) {
      const action = chooseAction(round, seat, "MASTER")
      switch (action.type) {
        case "bid":
          proposal = { type: "bid", level: action.level, trump: action.trump }
          break
        case "pass":
          proposal = { type: "pass" }
          break
        case "declare":
          proposal = { type: "declare", contract: action.contract, discard: action.discard }
          break
        case "whist":
          proposal = { type: "whist", whist: action.whist }
          break
        case "play":
          proposal = { type: "play", card: action.card }
          break
      }
    } else if (round.phase === "bidding") {
      proposal = round.highest === null
        ? { type: "bid", level: 6, trump: "S" }
        : { type: "pass" }
    } else if (round.phase === "declaring") {
      const hand = round.hands[seat]
      proposal = { type: "declare", contract: "game", discard: [hand[0], hand[1]] }
    } else if (round.phase === "whist") {
      proposal = { type: "whist", whist: false }
    } else {
      proposal = { type: "play", card: legalMoves(round, seat)[0] }
    }

    const applied = applyUserProposal(current, player.userId, proposal)
    if (!applied.ok) throw new Error(`ход не прошёл: ${applied.error}`)
    current = applied.outcome.session
  }

  assert.equal(current.status, "FINISHED", "боты должны доиграть партию до конца")
  assert.ok(current.roundsPlayed >= 1, "должна быть сыграна хотя бы одна раздача")

  const snapshot = buildSnapshot(current, "u-anna")
  assert.ok(snapshot.standings)
  assert.equal(snapshot.standings?.length, 3)
  // Итоги записаны и ботам: места покрывают все три места, включая ботные.
  const botSeats = mixed.filter((entry) => entry.isBot).map((entry) => entry.seat)
  const standingSeats = snapshot.standings?.map((entry) => entry.seat) ?? []
  for (const botSeat of botSeats) {
    assert.ok(standingSeats.includes(botSeat), `бот на месте ${botSeat} без итога`)
  }
  assert.ok(guard < 4000, "цикл не должен зависнуть")
})
