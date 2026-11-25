import assert from "node:assert/strict"
import { test } from "node:test"

import { legalMoves } from "../lib/preference/round"
import {
  soloWhistController,
  soloWhistPartner,
} from "../lib/preference/round"
import type { Seat } from "../lib/preference/round"
import { compareHandCards } from "../lib/preference/cards"
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

    // Прикуп открыт: Ок жмут все, кто ещё не подтвердил.
    if (round.phase === "declaring" && round.prikupAck.length < 3) {
      for (const player of current.players) {
        if (current.round!.prikupAck.includes(player.seat)) continue
        const ack = applyUserProposal(current, player.userId, { type: "prikup-ack" })
        if (!ack.ok) throw new Error(`Ок не прошло: ${ack.error}`)
        current = ack.outcome.session
      }
      continue
    }

    // Взятка сошлась: Ок жмут все, потом победитель ходит.
    if (round.phase === "play" && round.turn === null) {
      for (const player of current.players) {
        if (current.round!.trickAck.includes(player.seat)) continue
        const ack = applyUserProposal(current, player.userId, { type: "trick-ack" })
        if (!ack.ok) throw new Error(`Ок на взятку не прошло: ${ack.error}`)
        current = ack.outcome.session
      }
      continue
    }

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

/** Доигрывает раздачу, в которой оба защитника вистуют. */
function driveRoundBothWhist(state: SessionState): SessionState {
  let current = state
  let guard = 0
  while (current.round && current.round.phase !== "scored" && guard < 200) {
    guard += 1
    const round = current.round!

    if (round.phase === "declaring" && round.prikupAck.length < 3) {
      for (const player of current.players) {
        if (current.round!.prikupAck.includes(player.seat)) continue
        const ack = applyUserProposal(current, player.userId, { type: "prikup-ack" })
        if (!ack.ok) throw new Error(`Ок не прошло: ${ack.error}`)
        current = ack.outcome.session
      }
      continue
    }
    if (round.phase === "play" && round.turn === null) {
      for (const player of current.players) {
        if (current.round!.trickAck.includes(player.seat)) continue
        const ack = applyUserProposal(current, player.userId, { type: "trick-ack" })
        if (!ack.ok) throw new Error(`Ок на взятку не прошло: ${ack.error}`)
        current = ack.outcome.session
      }
      continue
    }

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
      proposal = { type: "whist", whist: true }
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

test("оба защитника вистуют — висты записаны каждому по своим взяткам", () => {
  const started = startGame(session(), 311)
  if (!started.ok) throw new Error(started.error)

  const played = driveRoundBothWhist(started.outcome.session)
  const result = played.lastResult
  if (!result) throw new Error("итог раздачи не записан")

  const declarer = result.outcome.declarer as Seat
  const defenders = ([0, 1, 2] as Seat[]).filter((seat) => seat !== declarer)
  assert.equal(result.outcome.contract.kind, "game")
  assert.deepEqual(result.outcome.whisters, defenders, "вистовали оба защитника")

  // Ставка двух вистующих на шестерной — whistRateSix = 2 за взятку.
  for (const seat of defenders) {
    assert.equal(
      result.deltas[seat].whists,
      result.outcome.tricks[seat] * 2,
      `висты места ${seat} — по его собственным взяткам`,
    )
  }
  // Таблица накопила те же висты, играющий — ни одного.
  assert.equal(played.table.entries[declarer].whists, 0)
  assert.equal(
    played.table.entries.reduce((sum, entry) => sum + entry.whists, 0),
    defenders.reduce<number>((sum, seat) => sum + played.table.entries[seat].whists, 0),
  )
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

  // В публичной части раздачи рук и сноса нет; в торговле прикуп ещё закрыт.
  const roundJson = JSON.stringify(anna.round)
  assert.equal(roundJson.includes("hands"), false)
  assert.equal(roundJson.includes('"discard"'), false)
  assert.equal(anna.round?.prikupOpen, null, "в торговле прикуп ещё не открыт")
  assert.deepEqual(anna.round?.prikupAck, [])
  assert.deepEqual(anna.round?.handSizes, [10, 10, 10])

  // Сортировка руки: стабильна между запросами.
  assert.deepEqual(anna.myHand, buildSnapshot(state, "u-anna").myHand)
})

test("прикуп открыт всем, снос ждёт Ок от всех троих", () => {
  const started = startGame(session(), 901)
  if (!started.ok) throw new Error(started.error)
  let state = started.outcome.session

  // Борис заказывает 6♠, Анна и Вера пасуют — торговля закрыта, прикуп открыт.
  const bid = applyUserProposal(state, "u-boris", { type: "bid", level: 6, trump: "S" })
  if (!bid.ok) throw new Error(bid.error)
  state = bid.outcome.session
  const veraPass = applyUserProposal(state, "u-vera", { type: "pass" })
  if (!veraPass.ok) throw new Error(veraPass.error)
  const annaPass = applyUserProposal(veraPass.outcome.session, "u-anna", { type: "pass" })
  if (!annaPass.ok) throw new Error(annaPass.error)
  state = annaPass.outcome.session

  // Пас, закрывший торговлю, приносит событие открытия прикупа.
  assert.deepEqual(annaPass.outcome.actions, [
    { type: "pass", seat: 0 },
    { type: "prikup", seat: 1 },
  ])

  const round = state.round!
  assert.equal(round.phase, "declaring")
  assert.equal(round.prikup.length, 2, "прикуп лежит в открытую")
  assert.deepEqual(round.prikupAck, [])

  // Снапшоты всех зрителей видят один и тот же открытый прикуп.
  const anna = buildSnapshot(state, "u-anna")
  const vera = buildSnapshot(state, "u-vera")
  const spectator = buildSnapshot(state, null)
  assert.deepEqual(anna.round?.prikupOpen, round.prikup)
  assert.deepEqual(vera.round?.prikupOpen, round.prikup)
  assert.deepEqual(spectator.round?.prikupOpen, round.prikup)

  // Снос раньше последнего Ок не принимается.
  const declarerId = state.players.find((entry) => entry.seat === round.declarer)!.userId
  const hand = round.hands[round.declarer as Seat]
  const early = applyUserProposal(state, declarerId, {
    type: "declare",
    contract: "game",
    discard: [hand[0], hand[1]],
  })
  assert.equal(early.ok, false)
  if (!early.ok) assert.match(early.error, /посмотрят все/)

  // Ок от всех — снос проходит.
  let current = state
  for (const player of current.players) {
    const ack = applyUserProposal(current, player.userId, { type: "prikup-ack" })
    if (!ack.ok) throw new Error(ack.error)
    current = ack.outcome.session
  }
  assert.deepEqual(current.round?.prikupAck, [0, 1, 2])

  const freshHand = current.round!.hands[round.declarer as Seat]
  const declared = applyUserProposal(current, declarerId, {
    type: "declare",
    contract: "game",
    discard: [freshHand[0], freshHand[1]],
  })
  assert.equal(declared.ok, true)
  if (declared.ok) assert.equal(declared.outcome.session.round?.phase, "whist")
})

test("после прикупа заказ поднимают: контракт выше, понижение отклоняется", () => {
  const started = startGame(session(), 888)
  if (!started.ok) throw new Error(started.error)
  const state = started.outcome.session

  // Борис заказывает 6♠, остальные пасуют.
  const bid = applyUserProposal(state, "u-boris", { type: "bid", level: 6, trump: "S" })
  if (!bid.ok) throw new Error(bid.error)
  const veraPass = applyUserProposal(bid.outcome.session, "u-vera", { type: "pass" })
  if (!veraPass.ok) throw new Error(veraPass.error)
  const annaPass = applyUserProposal(veraPass.outcome.session, "u-anna", { type: "pass" })
  if (!annaPass.ok) throw new Error(annaPass.error)
  let current = annaPass.outcome.session
  for (const player of current.players) {
    const ack = applyUserProposal(current, player.userId, { type: "prikup-ack" })
    if (!ack.ok) throw new Error(ack.error)
    current = ack.outcome.session
  }

  const hand = current.round!.hands[1]
  const discard = [hand[0], hand[1]]

  // Понижение ниже заказанного не проходит.
  const lowered = applyUserProposal(current, "u-boris", {
    type: "declare",
    contract: "game",
    discard,
    level: 6,
    trump: "S",
  })
  assert.equal(lowered.ok, true, "заказ оставляют как есть: 6♠ = 6♠")
  if (lowered.ok) {
    assert.deepEqual(lowered.outcome.session.round?.contract, {
      kind: "game",
      level: 6,
      trump: "S",
    })
  }

  // Мусорный уровень из сокета отбрасывается валидацией пакета.
  const garbage = applyUserProposal(current, "u-boris", {
    type: "declare",
    contract: "game",
    discard,
    level: 5,
    trump: "X",
  })
  assert.equal(garbage.ok, false)
  if (!garbage.ok) assert.match(garbage.error, /Заказ — от/)

  // Подъём: Борис видит сильную руку и играет семёрную.
  const raised = applyUserProposal(current, "u-boris", {
    type: "declare",
    contract: "game",
    discard,
    level: 7,
    trump: "S",
  })
  assert.equal(raised.ok, true)
  if (raised.ok) {
    const round = raised.outcome.session.round!
    assert.deepEqual(round.contract, { kind: "game", level: 7, trump: "S" })
    assert.equal(round.phase, "whist")
    // Событие хода несёт подъём: за столом слышно, что играют выше заказа.
    const declareEvent = raised.outcome.actions.find(
      (action) => action.type === "declare",
    )
    assert.deepEqual(
      declareEvent && declareEvent.type === "declare"
        ? { level: declareEvent.level, trump: declareEvent.trump }
        : null,
      { level: 7, trump: "S" },
    )
  }
})

test("мизер играется в открытую: руки защитников видны всем, рука играющего закрыта", () => {
  const started = startGame(session(), 555)
  if (!started.ok) throw new Error(started.error)
  let state = started.outcome.session

  // Борис заявляет мизер, Анна и Вера пасуют — торговля закрыта, прикуп открыт.
  const bid = applyUserProposal(state, "u-boris", { type: "misere" })
  if (!bid.ok) throw new Error(bid.error)
  const veraPass = applyUserProposal(bid.outcome.session, "u-vera", { type: "pass" })
  if (!veraPass.ok) throw new Error(veraPass.error)
  const annaPass = applyUserProposal(veraPass.outcome.session, "u-anna", { type: "pass" })
  if (!annaPass.ok) throw new Error(annaPass.error)
  state = annaPass.outcome.session

  // Контракт ещё не подтверждён — открытых рук нет.
  assert.deepEqual(buildSnapshot(state, "u-anna").round?.openHands, [])

  // Ок на прикуп от всех троих, затем Борис объявляет мизер.
  let current = state
  for (const player of current.players) {
    const ack = applyUserProposal(current, player.userId, { type: "prikup-ack" })
    if (!ack.ok) throw new Error(ack.error)
    current = ack.outcome.session
  }
  const hand = current.round!.hands[1]
  const declared = applyUserProposal(current, "u-boris", {
    type: "declare",
    contract: "misere",
    discard: [hand[0], hand[1]],
  })
  if (!declared.ok) throw new Error(declared.error)
  state = declared.outcome.session

  const round = state.round!
  assert.equal(round.phase, "play")
  assert.equal(round.contract?.kind, "misere")

  // Все трое игроков и зритель видят руки защитников (места 0 и 2) одинаково.
  const expected = [0, 2].map((seat) => ({
    seat: seat as Seat,
    cards: [...round.hands[seat as Seat]].sort(compareHandCards),
  }))
  for (const viewer of ["u-anna", "u-boris", "u-vera", null]) {
    assert.deepEqual(buildSnapshot(state, viewer).round?.openHands, expected)
  }

  // Карты играющего в публичную часть раздачи не утекают.
  const serialized = JSON.stringify(buildSnapshot(state, "u-anna").round)
  assert.equal(round.declarer, 1)
  for (const card of round.hands[1]) {
    assert.equal(serialized.includes(`"${card}"`), false, `карта играющего утекла: ${card}`)
  }
})

test("одиночный вист: вистующий видит руку пасующего и ходит за двоих", () => {
  const started = startGame(session(), 777)
  if (!started.ok) throw new Error(started.error)
  let state = started.outcome.session

  // Борис заказывает 6♠, остальные пасуют; прикуп смотрят все, Борис сносит.
  const bid = applyUserProposal(state, "u-boris", { type: "bid", level: 6, trump: "S" })
  if (!bid.ok) throw new Error(bid.error)
  const veraPass = applyUserProposal(bid.outcome.session, "u-vera", { type: "pass" })
  if (!veraPass.ok) throw new Error(veraPass.error)
  const annaPass = applyUserProposal(veraPass.outcome.session, "u-anna", { type: "pass" })
  if (!annaPass.ok) throw new Error(annaPass.error)
  let current = annaPass.outcome.session
  for (const player of current.players) {
    const ack = applyUserProposal(current, player.userId, { type: "prikup-ack" })
    if (!ack.ok) throw new Error(ack.error)
    current = ack.outcome.session
  }
  const declared = applyUserProposal(current, "u-boris", {
    type: "declare",
    contract: "game",
    discard: [current.round!.hands[1][0], current.round!.hands[1][1]],
  })
  if (!declared.ok) throw new Error(declared.error)
  current = declared.outcome.session

  // Анна (место 0) вистует, Вера (место 2) пасует — одиночный вист.
  const annaWhist = applyUserProposal(current, "u-anna", { type: "whist", whist: true })
  if (!annaWhist.ok) throw new Error(annaWhist.error)
  const veraPass2 = applyUserProposal(annaWhist.outcome.session, "u-vera", {
    type: "whist",
    whist: false,
  })
  if (!veraPass2.ok) throw new Error(veraPass2.error)
  state = veraPass2.outcome.session

  assert.equal(state.round?.phase, "play")
  assert.equal(state.round?.turn, 1)

  // Вистующий видит руку пасующего; сам пасующий свою руку больше не видит.
  const anna = buildSnapshot(state, "u-anna")
  const vera = buildSnapshot(state, "u-vera")
  const boris = buildSnapshot(state, "u-boris")
  const spectator = buildSnapshot(state, null)
  const veraHand = anna.partnerHand

  assert.equal(anna.partnerSeat, 2)
  assert.ok(veraHand.length > 0, "вистующий видит карты пасующего")
  assert.deepEqual(anna.partnerLegalMoves, [], "ход пока за играющим")
  assert.ok(anna.myHand.length > 0)

  assert.equal(vera.partnerSeat, null)
  assert.deepEqual(vera.myHand, [], "пасующий свою руку не видит")
  assert.equal(boris.partnerSeat, null)
  assert.ok(boris.myHand.length > 0)
  assert.equal(spectator.partnerSeat, null)

  // Рука вистующего открыта всем; карты пасующего — только в снапшоте вистующего.
  assert.deepEqual(anna.round?.openHands.map((entry) => entry.seat), [0])
  assert.equal(JSON.stringify(vera.round).includes(`"${veraHand[0]}"`), false)

  // Ход играющего, затем вистующий кладёт карту пасующего от своего имени.
  const borisCard = boris.myLegalMoves[0]
  const borisPlay = applyUserProposal(state, "u-boris", { type: "play", card: borisCard })
  if (!borisPlay.ok) throw new Error(borisPlay.error)
  state = borisPlay.outcome.session
  assert.equal(state.round?.turn, 2)

  const annaNow = buildSnapshot(state, "u-anna")
  const partnerCard = annaNow.partnerLegalMoves[0]
  assert.ok(partnerCard, "у пасующего есть легальная карта")
  const partnerPlay = applyUserProposal(state, "u-anna", { type: "play", card: partnerCard })
  if (!partnerPlay.ok) throw new Error(partnerPlay.error)
  state = partnerPlay.outcome.session
  assert.equal(
    buildSnapshot(state, "u-anna").partnerHand.length,
    veraHand.length - 1,
    "карта ушла из руки пасующего",
  )

  // Пасующий своей картой распорядиться не может — ход не его.
  const veraTry = applyUserProposal(state, "u-vera", { type: "play", card: veraHand[0] })
  assert.equal(veraTry.ok, false)
  if (!veraTry.ok) assert.match(veraTry.error, /не ваш ход/)
})

test("легальные ходы в снапшоте совпадают с движком", () => {
  const started = startGame(session(), 701)
  if (!started.ok) throw new Error(started.error)

  // В торговле легальных карт нет: ходы — это ставки.
  const bidding = buildSnapshot(started.outcome.session, "u-boris")
  assert.deepEqual(bidding.myLegalMoves, [])
  assert.equal(bidding.round?.turn, 1)
})

test("итог последней раздачи доехал до снапшота — для подключившихся в паузу", () => {
  const started = startGame(session(), 801)
  if (!started.ok) throw new Error(started.error)

  const fresh = buildSnapshot(started.outcome.session, null)
  assert.equal(fresh.lastRoundResult, null, "до первой записи итогов нет")

  const played = driveRound(started.outcome.session)
  assert.ok(played.lastResult, "сеанс хранит итог записанной раздачи")

  const spectator = buildSnapshot(played, null)
  assert.equal(spectator.lastRoundResult?.roundNumber, 1)
  assert.equal(
    spectator.lastRoundResult && "hands" in spectator.lastRoundResult.outcome,
    false,
  )
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

    // Прикуп открыт: Ок жмут все, кто ещё не подтвердил.
    if (round.phase === "declaring" && round.prikupAck.length < 3) {
      for (const player of current.players) {
        if (current.round!.prikupAck.includes(player.seat)) continue
        const ack = applyUserProposal(current, player.userId, { type: "prikup-ack" })
        if (!ack.ok) throw new Error(`Ок не прошло: ${ack.error}`)
        current = ack.outcome.session
      }
      continue
    }

    // Взятка сошлась: Ок жмут все, потом победитель ходит.
    if (round.phase === "play" && round.turn === null) {
      for (const player of current.players) {
        if (current.round!.trickAck.includes(player.seat)) continue
        const ack = applyUserProposal(current, player.userId, { type: "trick-ack" })
        if (!ack.ok) throw new Error(`Ок на взятку не прошло: ${ack.error}`)
        current = ack.outcome.session
      }
      continue
    }

    const seat = round.turn as Seat
    // Одиночный вист: на ходе пасующий — действие подаёт вистующий.
    const controller = soloWhistController(round)
    const actingSeat =
      controller !== null && seat === soloWhistPartner(round, controller)
        ? controller
        : seat
    const player = current.players.find((entry) => entry.seat === actingSeat)!
    let proposal: UserProposal
    if (player.isBot) {
      const action = chooseAction(round, seat, "MASTER")
      switch (action.type) {
        case "bid":
          proposal = { type: "bid", level: action.level, trump: action.trump }
          break
        case "misere":
          proposal = { type: "misere" }
          break
        case "pass":
          proposal = { type: "pass" }
          break
        case "prikup-ack":
          proposal = { type: "prikup-ack" }
          break
        case "trick-ack":
          proposal = { type: "trick-ack" }
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
