// Одна раздача Ленинградки: торговля → открытый прикуп (все жмут Ок) →
// снос → висты → взятки (каждая взятка на сукне до Ок от всех).
// На распасах прикуп заходит в первых двух взятках: каждая его карта
// открывается в момент своей взятки и задаёт масть, но не может взять взятку.
// Состояние — простые данные: его можно сериализовать, сравнить и пересчитать.

import {
  TRUMP_ORDER,
  TRUMPS,
  cardStrength,
  type Card,
  type Trump,
  suitOf,
} from "./cards"
import { MAX_LEVEL, MIN_LEVEL, PLAYER_COUNT, TRICKS_PER_ROUND } from "./constants"
import { dealCards } from "./deal"

export type Seat = 0 | 1 | 2

export type Bid = { level: number; trump: Trump } | { kind: "misere" }

/**
 * Сила заявки «мизер»: старше любой девятки, младше десятой игры.
 * Мизер перебивают только реальной десятой.
 */
export const MISERE_BID_STRENGTH = 9 * 10 + 5

export type Contract =
  | { kind: "game"; level: number; trump: Trump }
  | { kind: "misere" }
  | { kind: "raspas" }

export type RoundPhase = "bidding" | "declaring" | "whist" | "play" | "scored"

/**
 * Карта на сукне. `fromPrikup` — заходящая карта прикупа на распасах:
 * масть хода она задаёт, но сама взятку взять не может.
 */
export type TrickCard = { seat: Seat; card: Card; fromPrikup?: boolean }
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
  /** Кто уже посмотрел открытый прикуп: снос ждёт Ок от всех троих. */
  prikupAck: Seat[]
  /** Кто уже посмотрел собранную взятку: победитель ходит после всех Ок. */
  trickAck: Seat[]
  /** null — решение ещё не принято, false — пас на вист. */
  whist: (boolean | null)[]
  trick: TrickCard[]
  tricks: number[]
  history: CompletedTrick[]
}

export type RoundAction =
  | { type: "bid"; seat: Seat; level: number; trump: Trump }
  | { type: "misere"; seat: Seat }
  | { type: "pass"; seat: Seat }
  | { type: "prikup-ack"; seat: Seat }
  | { type: "trick-ack"; seat: Seat }
  | {
      type: "declare"
      seat: Seat
      contract: "game" | "misere"
      /**
       * Подъём после прикупа: заказанную игру оставляют как есть или поднимают
       * выше (уровнем или мастью). Без level/trump играют заказанное;
       * понижать нельзя, заявленный в торговле мизер не меняется вовсе.
       */
      level?: number
      trump?: Trump
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

/** Сила заявки: мизер между девяткой без козыря и десятой. */
export function bidStrength(bid: Bid): number {
  return "kind" in bid
    ? MISERE_BID_STRENGTH
    : bid.level * 10 + TRUMP_ORDER[bid.trump]
}

export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % PLAYER_COUNT) as Seat
}

export function otherSeats(seat: Seat | null): Seat[] {
  return ([0, 1, 2] as Seat[]).filter((item) => item !== seat)
}

/**
 * Минимальный срез раздачи для правил одиночного виста: годится и для
 * полного RoundState, и для публичного RoundView (нужен и на клиенте).
 */
export type SoloWhistView = Pick<
  RoundState,
  "contract" | "phase" | "declarer" | "whist"
>

/**
 * Одиночный вист: один защитник вистует, другой пасует.
 * Вистующий играет в открытую и ходит за себя и за пасующего — возвращаем его место.
 */
export function soloWhistController(round: SoloWhistView): Seat | null {
  if (round.contract?.kind !== "game") return null
  if (round.phase !== "play" && round.phase !== "scored") return null
  const defenders = otherSeats(round.declarer)
  const controller = defenders.find((seat) => round.whist[seat] === true)
  const passer = defenders.find((seat) => round.whist[seat] === false)
  return controller !== undefined && passer !== undefined ? controller : null
}

/** Пасующий при одиночном висте: его картами ходит вистующий. */
export function soloWhistPartner(
  round: SoloWhistView,
  controller: Seat,
): Seat {
  return (
    otherSeats(round.declarer).find((seat) => seat !== controller) ?? controller
  )
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
    prikupAck: [],
    trickAck: [],
    whist: [null, null, null],
    trick: [],
    tricks: [0, 0, 0],
    history: [],
  }
}

export function trumpOf(state: RoundState): Trump {
  return state.contract?.kind === "game" ? state.contract.trump : "NT"
}

/** Кто берёт взятку: старший козырь, иначе старшая карта масти хода.
 *  Заходящая карта прикупа (распасы) в сравнении не участвует. */
export function trickWinner(trick: TrickCard[], trump: Trump): Seat {
  const ledSuit = suitOf(trick[0].card)
  const contenders = trick.filter((item) => !item.fromPrikup)
  let best = contenders[0]
  for (const item of contenders.slice(1)) {
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
    case "misere":
      return applyMisere(state, action)
    case "pass":
      return applyPass(state, action)
    case "prikup-ack":
      return applyPrikupAck(state, action)
    case "trick-ack":
      return applyTrickAck(state, action)
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

/**
 * Заявка «мизер» в торговле: старше всех девяток, младше десятой игры.
 * Если мизер пережил торговлю — играющий садится за свои десять карт сразу:
 * ни прикупа, ни сноса, ни вистов.
 */
function applyMisere(
  state: RoundState,
  action: Extract<RoundAction, { type: "misere" }>,
): ActionResult {
  if (state.phase !== "bidding") return fail("Торговля уже закончилась")
  if (state.turn !== action.seat) return fail("Сейчас не ваш ход")
  if (state.bids[action.seat] === "pass") return fail("Вы уже спасовали")

  const highest = state.highest
  if (highest) {
    if ("kind" in highest.bid) {
      return fail("Мизер уже заявлен")
    }
    if (highest.bid.level !== MIN_LEVEL) {
      return fail("Мизер нельзя заявить поверх заказа выше шестёрки")
    }
  }

  const next = structuredClone(state)
  next.bids[action.seat] = { kind: "misere" }
  next.highest = { seat: action.seat, bid: { kind: "misere" } }

  // Все, кроме заявившего, спасовали — прикуп открывается, играющий
  // сносит две карты и играет мизер.
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
      // Торговля выиграна: прикуп открывается, дальше играющий сносит
      // и объявляет контракт (заявленный мизер — только мизер).
      return { ok: true, state: startDeclaring(next) }
    }
    next.turn = nextBiddingSeat(next.bids, action.seat)
    return { ok: true, state: next }
  }

  // Заказов не было: если спасовали все трое — распасы. Карты прикупа
  // заходят в первых двух взятках: первая открыта на сукне сразу,
  // докладывают по кругу начиная с первой руки.
  if (next.bids.every((entry) => entry === "pass")) {
    next.phase = "play"
    next.contract = { kind: "raspas" }
    next.trick = [{ seat: next.dealer, card: next.prikup[0], fromPrikup: true }]
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
  // Прикуп открыт на столе: снос откроется, когда посмотрят все трое.
  next.prikupAck = []
  return next
}

/** Ок на открытый прикуп: порядок свободный, снос ждёт последнего подтверждения. */
function applyPrikupAck(
  state: RoundState,
  action: Extract<RoundAction, { type: "prikup-ack" }>,
): ActionResult {
  if (state.phase !== "declaring") return fail("Прикуп ещё не открыт")
  if (state.prikupAck.includes(action.seat)) {
    return fail("Прикуп ты уже посмотрел")
  }

  const next = structuredClone(state)
  next.prikupAck = [...next.prikupAck, action.seat]
  return { ok: true, state: next }
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
  const ordered = "kind" in highest.bid ? null : highest.bid
  if ("kind" in highest.bid) {
    // Мизер заявлен в торговле: прикуп уже открыт, отказаться нельзя.
    if (action.contract !== "misere") {
      return fail("Мизер заявлен в торговле — играется только мизер")
    }
  } else if (action.contract === "misere" && highest.bid.level !== MIN_LEVEL) {
    return fail("Мизер объявляют только при заказе шестой игры")
  }
  if (state.prikupAck.length < PLAYER_COUNT) {
    return fail("Снос будет, когда прикуп посмотрят все трое")
  }

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

  // Игра попадает в эту ветку только с игровой заявкой: мизер из торговли
  // выше играется только мизером.
  if (!ordered) {
    return fail("Мизер из торговли играется без прикупа")
  }
  // После прикупа заказ оставляют или поднимают выше — понижать нельзя.
  const final = raisedGameContract(ordered, action)
  if (typeof final === "string") return fail(final)
  next.contract = { kind: "game", level: final.level, trump: final.trump }
  next.phase = "whist"
  next.turn = otherSeats(action.seat)[0]
  return { ok: true, state: next }
}

/**
 * Контракт игры после прикупа: заявленную игру оставляют как есть либо
 * поднимают — уровнем вверх или той же мастью старше. Понижение и смена
 * на более слабую масть запрещены: такой заказ отклоняется.
 */
function raisedGameContract(
  ordered: { level: number; trump: Trump },
  action: Extract<RoundAction, { type: "declare" }>,
): { level: number; trump: Trump } | string {
  const level = action.level ?? ordered.level
  const trump = action.trump ?? ordered.trump
  if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
    return `Заказ — от ${MIN_LEVEL} до ${MAX_LEVEL} взяток`
  }
  if (!(TRUMPS as readonly string[]).includes(trump)) {
    return "Неизвестная масть заказа"
  }
  const raised = { level, trump }
  if (bidStrength(raised) < bidStrength(ordered)) {
    return "Игру оставляют заказанной или поднимают выше"
  }
  return raised
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
  if (
    state.trick.length === 0 &&
    state.history.length > 0 &&
    state.trickAck.length < PLAYER_COUNT
  ) {
    return fail("Сначала все смотрят собранную взятку")
  }

  // Одиночный вист: вистующий ходит за себя и за пасующего.
  // Сам пасующий карты не играет — его рукой управляет вистующий.
  let playsFor: Seat
  const controller = soloWhistController(state)
  if (controller !== null) {
    const partner = soloWhistPartner(state, controller)
    if (state.turn === partner) {
      if (action.seat !== controller) {
        return fail("Ходы за пасующего делает вистующий")
      }
      playsFor = partner
    } else if (state.turn === action.seat) {
      playsFor = action.seat
    } else {
      return fail("Сейчас не ваш ход")
    }
  } else {
    if (state.turn !== action.seat) return fail("Сейчас не ваш ход")
    playsFor = action.seat
  }

  const hand = state.hands[playsFor]
  if (!hand.includes(action.card)) return fail("Этой карты нет в руке")

  const legal = legalMoves(state, playsFor)
  if (!legal.includes(action.card)) {
    const led = state.trick[0]
    return fail(`Надо ходить в масть: ${led ? suitOf(led.card) : ""}`)
  }

  const next = structuredClone(state)
  next.hands[playsFor] = hand.filter((card) => card !== action.card)
  next.trick = [...state.trick, { seat: playsFor, card: action.card }]

  // В первых двух взятках распасов на сукне лежит и заходящая карта
  // прикупа — взятку собирают карты трёх игроков.
  const played = next.trick.filter((item) => !item.fromPrikup).length
  if (played < PLAYER_COUNT) {
    next.turn = nextSeat(playsFor)
    return { ok: true, state: next }
  }

  const winner = trickWinner(next.trick, trumpOf(next))
  next.tricks[winner] += 1
  next.history = [...state.history, { cards: next.trick, winner }]
  next.trick = []

  // Любая взятка, включая десятую, остаётся на сукне до Ок от всех:
  // ход победителя (или запись раздачи) открывается последним Ок.
  next.trickAck = []
  next.turn = null
  return { ok: true, state: next }
}

/** Ок на собранную взятку: последний Ок передаёт ход победителю. */
function applyTrickAck(
  state: RoundState,
  action: Extract<RoundAction, { type: "trick-ack" }>,
): ActionResult {
  if (state.phase !== "play") return fail("Сейчас не время смотреть взятку")
  if (!state.history.length) return fail("Взятку ещё не собрали")
  if (state.trick.length > 0) return fail("Взятка ещё собирается")
  if (state.trickAck.length >= PLAYER_COUNT) {
    return fail("Взятку уже все посмотрели")
  }
  if (state.trickAck.includes(action.seat)) {
    return fail("Взятку ты уже посмотрел")
  }

  const next = structuredClone(state)
  next.trickAck = [...next.trickAck, action.seat]
  if (next.trickAck.length >= PLAYER_COUNT) {
    // Десятую взятку посмотрели — пора записывать раздачу.
    if (next.history.length === TRICKS_PER_ROUND) {
      next.phase = "scored"
      next.turn = null
      return { ok: true, state: next }
    }
    const last = next.history.at(-1)
    if (last) {
      if (next.contract?.kind === "raspas" && next.history.length === 1) {
        // Вторая взятка распасов тоже заходит картой прикупа,
        // доклады — снова начиная с первой руки.
        next.trick = [
          { seat: next.dealer, card: next.prikup[1], fromPrikup: true },
        ]
        next.turn = nextSeat(next.dealer)
      } else {
        next.turn = last.winner
      }
    }
  }
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