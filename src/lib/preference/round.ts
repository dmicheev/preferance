// Одна раздача Ленинградки: торговля → прикуп со сносом → висты → взятки.
// Состояние — простые данные: его можно сериализовать, сравнить и пересчитать.

import {
  TRUMP_ORDER,
  cardStrength,
  type Card,
  type Trump,
  suitOf,
} from "./cards"
import { MAX_LEVEL, MIN_LEVEL, PLAYER_COUNT, TRICKS_PER_ROUND } from "./constants"
import { dealCards } from "./deal"

export type Seat = 0 | 1 | 2

export type Bid = { level: number; trump: Trump }

export type Contract =
  | { kind: "game"; level: number; trump: Trump }
  | { kind: "misere" }
  | { kind: "raspas" }

export type RoundPhase = "bidding" | "declaring" | "whist" | "play" | "scored"

export type TrickCard = { seat: Seat; card: Card }
export type CompletedTrick = { cards: TrickCard[]; winner: Seat }

export type RoundState = {
  seed: number
  dealer: Seat
  hands: Card[][]
  prikup: Card[]
  phase: RoundPhase
  /** null — игрок ещё не говорил, "pass" — спасовал, объект — заказ. */
  bids: (Bid | "pass" | null)[]
  turn: Seat | null
  highest: { seat: Seat; bid: Bid } | null
  declarer: Seat | null
  contract: Contract | null
  /** Две карты, которые играющий снёс после прикупа. */
  discard: Card[]
  /** null — решение ещё не принято, false — пас на вист. */
  whist: (boolean | null)[]
  trick: TrickCard[]
  tricks: number[]
  history: CompletedTrick[]
}

export type RoundAction =
  | { type: "bid"; seat: Seat; level: number; trump: Trump }
  | { type: "pass"; seat: Seat }
  | {
      type: "declare"
      seat: Seat
      contract: "game" | "misere"
      discard: Card[]
    }
  | { type: "whist"; seat: Seat; whist: boolean }
  | { type: "play"; seat: Seat; card: Card }

export type ActionResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: string }

export type RoundOutcome = {
  contract: Contract
  declarer: Seat | null
  tricks: number[]
  whisters: Seat[]
}

/** Сила заказа: уровень важнее масти, внутри уровня масти от пик к без козыря. */
export function bidStrength(bid: Bid): number {
  return bid.level * 10 + TRUMP_ORDER[bid.trump]
}

export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % PLAYER_COUNT) as Seat
}

export function otherSeats(seat: Seat | null): Seat[] {
  return ([0, 1, 2] as Seat[]).filter((item) => item !== seat)
}

export function createRound(params: { seed: number; dealer: Seat }): RoundState {
  const deal = dealCards(params.seed)
  return {
    seed: params.seed,
    dealer: params.dealer,
    hands: deal.hands,
    prikup: [deal.prikup[0], deal.prikup[1]],
    phase: "bidding",
    bids: [null, null, null],
    turn: nextSeat(params.dealer),
    highest: null,
    declarer: null,
    contract: null,
    discard: [],
    whist: [null, null, null],
    trick: [],
    tricks: [0, 0, 0],
    history: [],
  }
}

export function trumpOf(state: RoundState): Trump {
  return state.contract?.kind === "game" ? state.contract.trump : "NT"
}

/** Кто берёт взятку: старший козырь, иначе старшая карта масти хода. */
export function trickWinner(trick: TrickCard[], trump: Trump): Seat {
  const ledSuit = suitOf(trick[0].card)
  let best = trick[0]
  for (const item of trick.slice(1)) {
    if (
      cardStrength(item.card, ledSuit, trump) >
      cardStrength(best.card, ledSuit, trump)
    ) {
      best = item
    }
  }
  return best.seat
}

/**
 * Легальные ходы. Пустой массив — сейчас не ход этого игрока.
 * В масть обязаны ходить, если она есть; иначе любая карта.
 */
export function legalMoves(state: RoundState, seat: Seat): Card[] {
  if (state.phase !== "play" || state.turn !== seat) return []
  const hand = state.hands[seat]
  const led = state.trick[0]
  if (!led) return [...hand]
  const ledSuit = suitOf(led.card)
  const follow = hand.filter((card) => suitOf(card) === ledSuit)
  return follow.length > 0 ? follow : [...hand]
}

export function roundOutcome(state: RoundState): RoundOutcome | null {
  if (state.phase !== "scored" || !state.contract) return null
  const whisters =
    state.contract.kind === "game"
      ? otherSeats(state.declarer).filter((seat) => state.whist[seat] === true)
      : []
  return {
    contract: state.contract,
    declarer: state.declarer,
    tricks: [...state.tricks],
    whisters,
  }
}

export function applyAction(state: RoundState, action: RoundAction): ActionResult {
  switch (action.type) {
    case "bid":
      return applyBid(state, action)
    case "pass":
      return applyPass(state, action)
    case "declare":
      return applyDeclare(state, action)
    case "whist":
      return applyWhist(state, action)
    case "play":
      return applyPlay(state, action)
    default:
      return fail("Неизвестное действие")
  }
}

function applyBid(
  state: RoundState,
  action: Extract<RoundAction, { type: "bid" }>,
): ActionResult {
  if (state.phase !== "bidding") return fail("Торговля уже закончилась")
  if (state.turn !== action.seat) return fail("Сейчас не ваш ход")
  if (action.level < MIN_LEVEL || action.level > MAX_LEVEL) {
    return fail(`Заказ — от ${MIN_LEVEL} до ${MAX_LEVEL} взяток`)
  }

  const bid: Bid = { level: action.level, trump: action.trump }
  if (state.highest && bidStrength(bid) <= bidStrength(state.highest.bid)) {
    return fail("Заказ должен быть выше предыдущего")
  }

  const next = structuredClone(state)
  next.bids[action.seat] = bid
  next.highest = { seat: action.seat, bid }

  // Все, кроме заказавшего, спасовали — он играет.
  if (otherSeats(action.seat).every((seat) => next.bids[seat] === "pass")) {
    return { ok: true, state: startDeclaring(next) }
  }

  next.turn = nextBiddingSeat(next.bids, action.seat)
  return { ok: true, state: next }
}

function applyPass(
  state: RoundState,
  action: Extract<RoundAction, { type: "pass" }>,
): ActionResult {
  if (state.phase !== "bidding") return fail("Торговля уже закончилась")
  if (state.turn !== action.seat) return fail("Сейчас не ваш ход")
  if (state.bids[action.seat] === "pass") return fail("Вы уже спасовали")

  const next = structuredClone(state)
  next.bids[action.seat] = "pass"

  const highest = next.highest
  if (highest) {
    const others = otherSeats(highest.seat)
    if (others.every((seat) => next.bids[seat] === "pass")) {
      return { ok: true, state: startDeclaring(next) }
    }
    next.turn = nextBiddingSeat(next.bids, action.seat)
    return { ok: true, state: next }
  }

  // Заказов не было: если спасовали все трое — распасы.
  if (next.bids.every((entry) => entry === "pass")) {
    next.phase = "play"
    next.contract = { kind: "raspas" }
    next.turn = nextSeat(next.dealer)
    return { ok: true, state: next }
  }

  next.turn = nextBiddingSeat(next.bids, action.seat)
  return { ok: true, state: next }
}

function startDeclaring(state: RoundState): RoundState {
  const next = structuredClone(state)
  const declarer = next.highest!.seat
  next.declarer = declarer
  next.hands[declarer] = [...next.hands[declarer], ...next.prikup]
  next.phase = "declaring"
  next.turn = declarer
  next.discard = []
  return next
}

function applyDeclare(
  state: RoundState,
  action: Extract<RoundAction, { type: "declare" }>,
): ActionResult {
  if (state.phase !== "declaring") return fail("Прикуп ещё не ваш")
  if (state.declarer !== action.seat) return fail("Прикуп разбирает играющий")
  if (action.discard.length !== 2) return fail("Сносим ровно две карты")
  if (new Set(action.discard).size !== 2) return fail("Карты сноса повторяются")

  const hand = state.hands[action.seat]
  for (const card of action.discard) {
    if (!hand.includes(card)) return fail("Этой карты нет в руке")
  }

  const highest = state.highest
  if (!highest) return fail("Не было заказа")

  const next = structuredClone(state)
  next.discard = [...action.discard]
  next.hands[action.seat] = hand.filter((card) => !action.discard.includes(card))

  if (action.contract === "misere") {
    next.contract = { kind: "misere" }
    next.phase = "play"
    next.turn = action.seat
    next.whist = [null, null, null]
    return { ok: true, state: next }
  }

  next.contract = {
    kind: "game",
    level: highest.bid.level,
    trump: highest.bid.trump,
  }
  next.phase = "whist"
  next.turn = otherSeats(action.seat)[0]
  return { ok: true, state: next }
}

function applyWhist(
  state: RoundState,
  action: Extract<RoundAction, { type: "whist" }>,
): ActionResult {
  if (state.phase !== "whist") return fail("Сейчас не время вистовать")
  if (state.declarer === action.seat) return fail("Играющий не вистует")
  if (state.whist[action.seat] !== null) return fail("Решение уже принято")

  const next = structuredClone(state)
  next.whist[action.seat] = action.whist

  const pending = otherSeats(next.declarer).filter(
    (seat) => next.whist[seat] === null,
  )
  if (pending.length > 0) {
    next.turn = pending[0]
    return { ok: true, state: next }
  }

  next.phase = "play"
  next.turn = next.declarer
  return { ok: true, state: next }
}

function applyPlay(
  state: RoundState,
  action: Extract<RoundAction, { type: "play" }>,
): ActionResult {
  if (state.phase !== "play") return fail("Сейчас не время ходить картой")
  if (state.turn !== action.seat) return fail("Сейчас не ваш ход")

  const hand = state.hands[action.seat]
  if (!hand.includes(action.card)) return fail("Этой карты нет в руке")

  const legal = legalMoves(state, action.seat)
  if (!legal.includes(action.card)) {
    const led = state.trick[0]
    return fail(`Надо ходить в масть: ${led ? suitOf(led.card) : ""}`)
  }

  const next = structuredClone(state)
  next.hands[action.seat] = hand.filter((card) => card !== action.card)
  next.trick = [...state.trick, { seat: action.seat, card: action.card }]

  if (next.trick.length < PLAYER_COUNT) {
    next.turn = nextSeat(action.seat)
    return { ok: true, state: next }
  }

  const winner = trickWinner(next.trick, trumpOf(next))
  next.tricks[winner] += 1
  next.history = [...state.history, { cards: next.trick, winner }]
  next.trick = []

  if (next.history.length === TRICKS_PER_ROUND) {
    next.phase = "scored"
    next.turn = null
    return { ok: true, state: next }
  }

  next.turn = winner
  return { ok: true, state: next }
}

/** Следующий игрок, который ещё не спасовал: спасовавшие из торговли выбывают. */
function nextBiddingSeat(
  bids: (Bid | "pass" | null)[],
  from: Seat,
): Seat {
  let seat = nextSeat(from)
  for (let step = 0; step < PLAYER_COUNT; step += 1) {
    if (bids[seat] !== "pass") return seat
    seat = nextSeat(seat)
  }
  return nextSeat(from)
}

function fail(error: string): ActionResult {
  return { ok: false, error }
}