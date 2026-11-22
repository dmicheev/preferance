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
  roundOutcome,
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
}

/** Что игрок предлагает сделать: место сервер подставит сам, доверять клиенту нельзя. */
export type UserProposal =
  | { type: "bid"; level: number; trump: Trump }
  | { type: "pass" }
  | { type: "declare"; contract: "game" | "misere"; discard: Card[] }
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

  const next: SessionState = { ...session, roundsPlayed: session.roundsPlayed }
  return { ok: true, outcome: dealRound({ ...next, readyUserIds: ready }, seed) }
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
    myHand,
    myLegalMoves,
    readyUserIds: [...session.readyUserIds],
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
    readyUserIds: [],
    standings: params.standings,
  }
}

function dealRound(session: SessionState, seed: number): SessionOutcome {
  const dealer = dealerFor(session.roundsPlayed)
  const round = createRound({ seed, dealer })
  const next: SessionState = { ...session, round, readyUserIds: [] }
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

  return {
    session: next,
    actions,
    result: {
      roundNumber: roundsPlayed,
      outcome,
      deltas: scored.deltas,
      table: scored.table,
      finished: next.status === "FINISHED",
    },
  }
}

/** События хода: сама карта и, если взятка сошлась, её победитель. */
function playActions(action: RoundAction, round: RoundState): GameActionView[] {
  if (action.type !== "play") return [actionView(action)]
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
    case "pass":
      return { type: "pass", seat: action.seat }
    case "declare":
      return { type: "declare", seat: action.seat, contract: action.contract }
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
    case "pass":
      return { ok: true, action: { type: "pass", seat } }
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
      return {
        ok: true,
        action: {
          type: "declare",
          seat,
          contract: proposal.contract,
          discard: [discard[0], discard[1]],
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

/** Публичная часть раздачи: без рук, прикупа и сноса. */
function roundView(round: RoundState): RoundView {
  const lastTrick = round.history.at(-1) ?? null
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
    whist: [...round.whist],
    trick: [...round.trick],
    lastTrick,
    tricks: [...round.tricks],
    handSizes: round.hands.map((hand) => hand.length),
  }
}

function isTrump(value: unknown): value is Trump {
  return typeof value === "string" && (TRUMPS as readonly string[]).includes(value)
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}
