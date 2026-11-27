// Игровой сеанс стола: партия целиком поверх раздач движка.
// Файл чистый: состояние — простые данные, переходы — функции без side-эффектов.

import {
  TRUMPS,
  compareHandCards,
  isCard,
  type Card,
  type Trump,
} from "../lib/preference/cards"
import { MAX_LEVEL, MIN_LEVEL, PLAYER_COUNT } from "../lib/preference/constants"
import {
  applyAction,
  createRound,
  legalMoves,
  otherSeats,
  roundOutcome,
  soloWhistController,
  soloWhistPartner,
  type RoundAction,
  type RoundState,
  type Seat,
} from "../lib/preference/round"
import { normalizeRuleset, type Ruleset } from "../lib/preference/rules"
import {
  applyRoundScore,
  createScoreTable,
  finalStandings,
  isBulletClosed,
  type ScoreTable,
} from "../lib/preference/score"
import type {
  GameActionView,
  GamePlayerView,
  GameSnapshot,
  GameStatusId,
  RoundResultView,
  RoundView,
  StandingView,
} from "../lib/protocol"

export type SessionPlayer = {
  userId: string
  nickname: string
  seat: Seat
  isHost: boolean
  isBot: boolean
  botLevel: string | null
}

export type SessionState = {
  key: string
  gameId: string
  status: GameStatusId
  /** До скольких очков закрывается пуля. */
  bulletTarget: number
  roundsLimit: number | null
  rules: Ruleset
  players: SessionPlayer[]
  table: ScoreTable
  /** Идущая раздача; null — до старта партии. */
  round: RoundState | null
  /** Записанных раздач; идущая не посчитана. */
  roundsPlayed: number
  /** Кто подтвердил готовность к следующей раздаче. */
  readyUserIds: string[]
  /** Итог последней записанной раздачи — для тех, кто подключился во время паузы. */
  lastResult: RoundResultView | null
}

/** Что игрок предлагает сделать: место сервер подставит сам, доверять клиенту нельзя. */
export type UserProposal =
  | { type: "bid"; level: number; trump: Trump }
  | { type: "misere" }
  | { type: "pass" }
  | { type: "prikup-ack" }
  | { type: "trick-ack" }
  | {
      type: "declare"
      contract: "game" | "misere"
      discard: Card[]
      /** Подъём после прикуса — приходит от клиента, проверяем отдельно. */
      level?: unknown
      trump?: unknown
    }
  | { type: "whist"; whist: boolean }
  | { type: "play"; card: Card }

export type SessionOutcome = {
  session: SessionState
  /** События хода для комнаты: ставка, карта, взятка, раздача. */
  actions: GameActionView[]
  /** Итог раздачи, если она только что доиграна. */
  result: RoundResultView | null
}

export type SessionResult =
  | { ok: true; outcome: SessionOutcome }
  | { ok: false; error: string }

export function createSession(params: {
  key: string
  gameId: string
  bullet: number
  roundsLimit: number | null
  rules: unknown
  players: SessionPlayer[]
}): SessionState {
  return {
    key: params.key,
    gameId: params.gameId,
    status: "LOBBY",
    bulletTarget: params.bullet,
    roundsLimit: params.roundsLimit,
    rules: normalizeRuleset(params.rules),
    players: params.players,
    table: createScoreTable(params.bullet, normalizeRuleset(params.rules)),
    round: null,
    roundsPlayed: 0,
    readyUserIds: [],
    lastResult: null,
  }
}

/** Сдающий ротируется по кругу: первая раздача — место 0, дальше по порядку. */
export function dealerFor(roundsPlayed: number): Seat {
  return (roundsPlayed % PLAYER_COUNT) as Seat
}

export function startGame(session: SessionState, seed: number): SessionResult {
  if (session.status !== "LOBBY") return fail("Партия уже началась")
  if (session.players.length !== PLAYER_COUNT) {
    return fail("За столом должны сидеть все трое")
  }

  const started: SessionState = { ...session, status: "PLAYING" }
  return { ok: true, outcome: dealRound(started, seed) }
}

/** Действие сидящего игрока: торг, снос, вист, карта. */
export function applyUserProposal(
  session: SessionState,
  userId: string,
  proposal: UserProposal,
): SessionResult {
  if (session.status !== "PLAYING") return fail("Партия не началась или закончилась")
  const player = session.players.find((entry) => entry.userId === userId)
  if (!player) return fail("Ты не за этим столом")
  const round = session.round
  if (!round) return fail("Раздача ещё не сдана")

  const action = toRoundAction(player.seat, proposal)
  if (!action.ok) return fail(action.error)

  const applied = applyAction(round, action.action)
  if (!applied.ok) return fail(applied.error)

  return { ok: true, outcome: absorb(session, applied.state, action.action) }
}

/** Готов к следующей раздаче: все трое готовы — сдаём или закрываем партию. */
export function setReady(
  session: SessionState,
  userId: string,
  seed: number,
): SessionResult {
  if (session.status !== "PLAYING") return fail("Партия не идёт")
  const player = session.players.find((entry) => entry.userId === userId)
  if (!player) return fail("Ты не за этим столом")
  if (!session.round || session.round.phase !== "scored") {
    return fail("Раздача ещё не доиграна")
  }
  if (session.readyUserIds.includes(userId)) {
    return fail("Готовность уже записана")
  }

  const ready = [...session.readyUserIds, userId]
  const allSet = session.players.every((entry) => ready.includes(entry.userId))
  if (!allSet) {
    return {
      ok: true,
      outcome: { session: { ...session, readyUserIds: ready }, actions: [], result: null },
    }
  }

  if (isPartyOver(session)) {
    return {
      ok: true,
      outcome: {
        session: { ...session, readyUserIds: [], status: "FINISHED" },
        actions: [],
        result: null,
      },
    }
  }

  // dealRound сам сбрасывает готовность; готовность нужна была только для проверки.
  return { ok: true, outcome: dealRound(session, seed) }
}

/** Снимок для конкретного зрителя: свои карты — картами, чужие — количеством. */
export function buildSnapshot(
  session: SessionState,
  viewerUserId: string | null,
): GameSnapshot {
  const mine = viewerUserId
    ? session.players.find((entry) => entry.userId === viewerUserId)
    : undefined
  const mySeat = mine?.seat ?? null
  const round = session.round

  const myHand =
    mine && round ? [...round.hands[mine.seat]].sort(compareHandCards) : []
  const myLegalMoves = mine && round ? legalMoves(round, mine.seat) : []

  // Одиночный вист: вистующий играет в открытую и ходит за себя и за пасующего.
  // Карты пасующего видит только вистующий; сам пасующий свою руку уже не видит.
  const controller = round ? soloWhistController(round) : null
  const iAmController =
    mine !== undefined && controller !== null && controller === mine.seat
  const iAmPasser =
    mine !== undefined &&
    controller !== null &&
    round !== null &&
    round.declarer !== mine.seat &&
    mine.seat !== controller
  const partnerSeat = iAmController && round ? soloWhistPartner(round, controller) : null
  const partnerHand =
    partnerSeat !== null && round
      ? [...round.hands[partnerSeat]].sort(compareHandCards)
      : []
  const partnerLegalMoves =
    partnerSeat !== null && round ? legalMoves(round, partnerSeat) : []

  const players: GamePlayerView[] = session.players.map((entry) => ({
    seat: entry.seat,
    userId: entry.userId,
    nickname: entry.nickname,
    isHost: entry.isHost,
    isBot: entry.isBot,
    botLevel: entry.botLevel,
  }))

  return {
    key: session.key,
    status: session.status,
    players,
    rules: session.rules,
    bulletTarget: session.bulletTarget,
    roundsLimit: session.roundsLimit,
    roundsPlayed: session.roundsPlayed,
    table: session.table,
    round: round ? roundView(round) : null,
    mySeat,
    // Пасующий при одиночном висте не играет: свою руку он больше не видит.
    myHand: iAmPasser ? [] : myHand,
    myLegalMoves: iAmPasser ? [] : myLegalMoves,
    partnerSeat,
    partnerHand,
    partnerLegalMoves,
    readyUserIds: [...session.readyUserIds],
    lastRoundResult: session.lastResult,
    standings: session.status === "FINISHED" ? finalStandings(session.table) : null,
  }
}

// ---------- внутренние переходы ----------

/**
 * Снимок для закрытого стола, когда сеанс не дожил до перезапуска сервера:
 * состав, правила и итоги берём из БД, играть уже нельзя.
 */
export function finishedSnapshot(params: {
  key: string
  players: GamePlayerView[]
  rules: Ruleset
  bulletTarget: number
  roundsLimit: number | null
  mySeat: Seat | null
  standings: StandingView[] | null
}): GameSnapshot {
  return {
    key: params.key,
    status: "FINISHED",
    players: params.players,
    rules: normalizeRuleset(params.rules),
    bulletTarget: params.bulletTarget,
    roundsLimit: params.roundsLimit,
    roundsPlayed: 0,
    table: createScoreTable(params.bulletTarget, normalizeRuleset(params.rules)),
    round: null,
    mySeat: params.mySeat,
    myHand: [],
    myLegalMoves: [],
    partnerSeat: null,
    partnerHand: [],
    partnerLegalMoves: [],
    readyUserIds: [],
    lastRoundResult: null,
    standings: params.standings,
  }
}

function dealRound(session: SessionState, seed: number): SessionOutcome {
  const dealer = dealerFor(session.roundsPlayed)
  const round = createRound({ seed, dealer })
  const next: SessionState = {
    ...session,
    round,
    readyUserIds: [],
    lastResult: null,
  }
  return {
    session: next,
    actions: [{ type: "deal", roundNumber: session.roundsPlayed + 1, dealer }],
    result: null,
  }
}

/** Переносит доигранную раздачу в сеанс: таблица очков, лимиты, финал. */
function absorb(
  session: SessionState,
  round: RoundState,
  action: RoundAction,
): SessionOutcome {
  const actions = playActions(action, round)

  if (round.phase !== "scored") {
    return { session: { ...session, round }, actions, result: null }
  }

  const outcome = roundOutcome(round)
  if (!outcome) throw new Error("Раздача в фазе scored без результата — так не бывает")

  const scored = applyRoundScore(session.table, outcome)
  const roundsPlayed = session.roundsPlayed + 1
  const next: SessionState = {
    ...session,
    round,
    table: scored.table,
    roundsPlayed,
    readyUserIds: [],
  }
  if (isPartyOver(next)) next.status = "FINISHED"

  const result: RoundResultView = {
    roundNumber: roundsPlayed,
    dealer: round.dealer,
    outcome,
    // Полная запись раздачи для истории: торговля, прикуп, снос, вист, взятки.
    bids: [...round.bids],
    prikup: [...round.prikup],
    discard: [...round.discard],
    whist: [...round.whist],
    trickList: round.history.map((entry) => ({
      cards: entry.cards.map((card) => ({ ...card })),
      winner: entry.winner,
    })),
    deltas: scored.deltas,
    table: scored.table,
    finished: next.status === "FINISHED",
  }

  return {
    // Итог остаётся в сеансе: подключившийся в паузу готовности увидит его в снапшоте.
    session: { ...next, lastResult: result },
    actions,
    result,
  }
}

/** События хода: сама карта и, если взятка сошлась, её победитель. */
function playActions(action: RoundAction, round: RoundState): GameActionView[] {
  if (action.type !== "play") {
    const events: GameActionView[] = [actionView(action)]
    // Ставка или пас закрыли торговлю — стол услышал, что прикуп открыт.
    if (
      (action.type === "bid" || action.type === "pass") &&
      round.phase === "declaring" &&
      round.declarer !== null
    ) {
      events.push({ type: "prikup", seat: round.declarer })
    }
    return events
  }
  const events: GameActionView[] = [{ type: "card", seat: action.seat, card: action.card }]
  const last = round.history.at(-1)
  if (last && round.trick.length === 0) {
    events.push({ type: "trick", winner: last.winner })
  }
  return events
}

function actionView(action: RoundAction): GameActionView {
  switch (action.type) {
    case "bid":
      return { type: "bid", seat: action.seat, bid: { level: action.level, trump: action.trump } }
    case "misere":
      return { type: "misere", seat: action.seat }
    case "pass":
      return { type: "pass", seat: action.seat }
    case "prikup-ack":
      return { type: "prikup-ack", seat: action.seat }
    case "trick-ack":
      return { type: "trick-ack", seat: action.seat }
    case "declare":
      return {
        type: "declare",
        seat: action.seat,
        contract: action.contract,
        level: action.level,
        trump: action.trump,
      }
    case "whist":
      return { type: "whist", seat: action.seat, whist: action.whist }
    case "play":
      return { type: "card", seat: action.seat, card: action.card }
  }
}

/** Пуля закрыта или лимит раздач выбран — пора записывать итоги. */
function isPartyOver(session: SessionState): boolean {
  if (session.roundsLimit !== null && session.roundsPlayed >= session.roundsLimit) {
    return true
  }
  return isBulletClosed(session.table)
}

/** Клиентский пакет → действие движка: место подставляем своё, данные проверяем. */
function toRoundAction(
  seat: Seat,
  proposal: UserProposal,
): { ok: true; action: RoundAction } | { ok: false; error: string } {
  switch (proposal.type) {
    case "bid": {
      if (!Number.isInteger(proposal.level)) return fail("Уровень заказа — число")
      if (proposal.level < MIN_LEVEL || proposal.level > MAX_LEVEL) {
        return fail(`Заказ — от ${MIN_LEVEL} до ${MAX_LEVEL} взяток`)
      }
      if (!isTrump(proposal.trump)) return fail("Неизвестная масть заказа")
      return {
        ok: true,
        action: { type: "bid", seat, level: proposal.level, trump: proposal.trump },
      }
    }
    case "misere":
      return { ok: true, action: { type: "misere", seat } }
    case "pass":
      return { ok: true, action: { type: "pass", seat } }
    case "prikup-ack":
      return { ok: true, action: { type: "prikup-ack", seat } }
    case "trick-ack":
      return { ok: true, action: { type: "trick-ack", seat } }
    case "declare": {
      if (proposal.contract !== "game" && proposal.contract !== "misere") {
        return fail("Неизвестный тип контракта")
      }
      const discard = proposal.discard
      if (
        !Array.isArray(discard) ||
        discard.length !== 2 ||
        !discard.every((card) => isCard(card))
      ) {
        return fail("Снос — две настоящие карты")
      }
      // Подъём после прикупа: оба поля опциональны, но каждое проверяем.
      let level: number | undefined
      if (proposal.level !== undefined && proposal.level !== null) {
        if (typeof proposal.level !== "number" || !Number.isInteger(proposal.level)) {
          return fail("Уровень заказа — число")
        }
        if (proposal.level < MIN_LEVEL || proposal.level > MAX_LEVEL) {
          return fail(`Заказ — от ${MIN_LEVEL} до ${MAX_LEVEL} взяток`)
        }
        level = proposal.level
      }
      let trump: Trump | undefined
      if (proposal.trump !== undefined && proposal.trump !== null) {
        if (!isTrump(proposal.trump)) return fail("Неизвестная масть заказа")
        trump = proposal.trump
      }
      return {
        ok: true,
        action: {
          type: "declare",
          seat,
          contract: proposal.contract,
          discard: [discard[0], discard[1]],
          level,
          trump,
        },
      }
    }
    case "whist":
      if (typeof proposal.whist !== "boolean") return fail("Решение по висту — да или нет")
      return { ok: true, action: { type: "whist", seat, whist: proposal.whist } }
    case "play":
      if (!isCard(proposal.card)) return fail("Такой карты не бывает")
      return { ok: true, action: { type: "play", seat, card: proposal.card } }
  }
}

/** Публичная часть раздачи: без рук, сноса и закрытого прикупа. */
function roundView(round: RoundState): RoundView {
  const lastTrick = round.history.at(-1) ?? null
  // Открытые руки:
  // — мизер: оба защитника играют в открытую, рука играющего закрыта;
  // — одиночный вист: вистующий играет в открытую, ходя за себя и за пасующего.
  const endplay = round.phase === "play" || round.phase === "scored"
  const misereOpen = round.contract?.kind === "misere" && endplay
  const solo = soloWhistController(round)
  const openSeats = misereOpen
    ? otherSeats(round.declarer)
    : solo !== null
      ? [solo]
      : []
  const openHands = openSeats.map((seat) => ({
    seat,
    cards: [...round.hands[seat]].sort(compareHandCards),
  }))
  return {
    phase: round.phase,
    dealer: round.dealer,
    turn: round.turn,
    bids: [...round.bids],
    highest: round.highest
      ? { seat: round.highest.seat, bid: { ...round.highest.bid } }
      : null,
    declarer: round.declarer,
    contract: round.contract ? { ...round.contract } : null,
    discardCount: round.discard.length,
    // Прикуп открыт всем на время «все жмут Ок»; до и после — скрыт.
    prikupOpen: round.phase === "declaring" ? [...round.prikup] : null,
    prikupAck: [...round.prikupAck],
    trickAck: [...round.trickAck],
    whist: [...round.whist],
    trick: [...round.trick],
    lastTrick,
    tricks: [...round.tricks],
    handSizes: round.hands.map((hand) => hand.length),
    openHands,
  }
}

function isTrump(value: unknown): value is Trump {
  return typeof value === "string" && (TRUMPS as readonly string[]).includes(value)
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}
