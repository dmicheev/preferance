// Солвер: докрутка раздачи при полной информации (double dummy) альфа-бетой,
// плюс терминальная и листовая оценка в очках Ленинградки.
// Оценка хода — не «взял взятку», а пуля − гора + висты относительно соперников.

import {
  SUITS,
  cardStrength,
  rankStrength,
  suitOf,
  type Card,
  type Suit,
  type Trump,
} from "./cards"
import { PLAYER_COUNT, TRICKS_PER_ROUND } from "./constants"
import {
  nextSeat,
  otherSeats,
  trickWinner,
  type RoundOutcome,
  type RoundState,
  type Seat,
  type TrickCard,
} from "./round"
import type { Ruleset } from "./rules"
import { applyRoundScore, createScoreTable } from "./score"

/** Сожмём поиск: последние взятки докручиваем точно до конца раздачи. */
export const EXACT_ENDGAME = 3

export type ContractCtx = {
  kind: "game" | "misere" | "raspas"
  /** Уровень заказа для game, иначе 0. */
  level: number
  /** Козырь; у мизера и распасов — NT. */
  trump: Trump
  declarer: Seat | null
  /** Решения по висту, зафиксированные до начала розыгрыша. */
  whisters: Seat[]
}

/** Контракт текущей раздачи для солвера. */
export function contractCtxOf(round: RoundState): ContractCtx {
  const contract = round.contract
  if (!contract) {
    return { kind: "raspas", level: 0, trump: "NT", declarer: null, whisters: [] }
  }
  if (contract.kind === "game") {
    const whisters =
      round.declarer === null
        ? []
        : otherSeats(round.declarer).filter((seat) => round.whist[seat] === true)
    return {
      kind: "game",
      level: contract.level,
      trump: contract.trump,
      declarer: round.declarer,
      whisters,
    }
  }
  if (contract.kind === "misere") {
    return { kind: "misere", level: 0, trump: "NT", declarer: round.declarer, whisters: [] }
  }
  return { kind: "raspas", level: 0, trump: "NT", declarer: null, whisters: [] }
}

export type SolveMode = "points" | "declarerTricks"

export type SolveCtx = {
  contract: ContractCtx
  rules: Ruleset
  /** Текущая цена распасов за взятку. */
  raspasStep: number
  /** Чьё ожидание максимизируется. */
  perspective: Seat
  /** points — очки, declarerTricks — число взяток играющего. */
  mode: SolveMode
}

/**
 * Оценка итога раздачи для места perspective: пуля − гора + висты минус среднее
 * по соперникам (относительная шкала: и вистовать, и сажать становится выгодно).
 * mode declarerTricks возвращает просто число взяток играющего.
 */
export function utilityOfTricks(tricks: number[], ctx: SolveCtx): number {
  if (ctx.mode === "declarerTricks") {
    const seat = ctx.contract.declarer ?? ctx.perspective
    return tricks[seat]
  }

  const contract = ctx.contract
  const outcomeContract =
    contract.kind === "game"
      ? { kind: "game" as const, level: contract.level, trump: contract.trump }
      : contract.kind === "misere"
        ? { kind: "misere" as const }
        : { kind: "raspas" as const }
  const outcome: RoundOutcome = {
    contract: outcomeContract,
    declarer: contract.declarer,
    tricks: [...tricks],
    whisters: contract.kind === "game" ? [...contract.whisters] : [],
  }
  // Пуля заведомо глубоко: перебор не должен искажать оценку хода.
  const base = createScoreTable(1000, ctx.rules)
  const table = { ...base, raspasStep: ctx.raspasStep }
  const { deltas } = applyRoundScore(table, outcome)
  const seatScore = (seat: Seat): number => {
    const delta = deltas[seat]
    return delta.pool - delta.mountain + delta.whists
  }
  const mine = seatScore(ctx.perspective)
  const rivals = otherSeats(ctx.perspective)
  const average = (seatScore(rivals[0]) + seatScore(rivals[1])) / 2
  return mine - average
}

export type SimState = {
  hands: Card[][]
  trick: TrickCard[]
  turn: Seat
  trump: Trump
  tricks: number[]
  /** Сколько взяток ещё разыгрывается, включая незавершённую. */
  tricksLeft: number
  /** Карта прикупа, которая зайдёт в следующую взятку (распасы: вторая взятка). */
  kittyLead?: Card | null
}

/** Карты игроков на сукне без заходящей карты прикупа. */
function playerCardsInTrick(trick: TrickCard[]): number {
  return trick.filter((item) => !item.fromPrikup).length
}

/** Полная раздача из реального состояния: чужие руки берутся из сэмпла. */
export function simFromRound(
  round: RoundState,
  others: [Seat, Seat],
  dealt: [Card[], Card[]],
  turn?: Seat,
): SimState {
  const hands = round.hands.map((hand) => [...hand])
  hands[others[0]] = [...dealt[0]]
  hands[others[1]] = [...dealt[1]]
  const contract = round.contract
  return {
    hands,
    trick: [...round.trick],
    turn: turn ?? round.turn ?? round.declarer ?? 0,
    trump: contract?.kind === "game" ? contract.trump : "NT",
    tricks: [...round.tricks],
    tricksLeft: hands[0].length,
    // Распасы: вторая взятка тоже зайдёт картой прикупа, если та ещё скрыта.
    kittyLead:
      contract?.kind === "raspas" &&
      round.history.length <= 1 &&
      !round.trick.some(
        (item) => item.fromPrikup && item.card === round.prikup[1],
      )
        ? round.prikup[1]
        : null,
  }
}

export class BudgetAbort extends Error {
  constructor() {
    super("бюджет поиска исчерпан")
  }
}

export type SearchStats = { nodes: number; deadline: number }

/** Ход корня поиска: копия состояния с сыгранной картой. */
export function simAfterMove(state: SimState, seat: Seat, card: Card): SimState {
  const hands = state.hands.map((hand, index) =>
    index === seat ? hand.filter((item) => item !== card) : [...hand],
  )
  const trick = [...state.trick, { seat, card }]
  const tricks = [...state.tricks]
  let turn: Seat = nextSeat(seat)
  let tricksLeft = state.tricksLeft
  let kittyLead = state.kittyLead ?? null
  if (playerCardsInTrick(trick) === PLAYER_COUNT) {
    const winner = trickWinner(trick, state.trump)
    tricks[winner] += 1
    tricksLeft -= 1
    trick.length = 0
    turn = winner
    if (kittyLead) {
      // Вторая взятка распасов заходит картой прикупа.
      trick.push({ seat: winner, card: kittyLead, fromPrikup: true })
      kittyLead = null
    }
  }
  return { hands, trick, turn, trump: state.trump, tricks, tricksLeft, kittyLead }
}

function ledSuitOf(state: SimState): Suit {
  return state.trick.length > 0 ? suitOf(state.trick[0].card) : suitOf(state.hands[state.turn][0])
}

function legalSimMoves(state: SimState): Card[] {
  const hand = state.hands[state.turn]
  const led = state.trick[0]
  if (!led) return [...hand]
  const ledSuit = suitOf(led.card)
  const follow = hand.filter((card) => suitOf(card) === ledSuit)
  return follow.length > 0 ? follow : [...hand]
}

/** Старшие ходы первыми: альфа-бета отсекает быстрее. */
function orderMoves(moves: Card[], state: SimState): Card[] {
  const ledSuit = ledSuitOf(state)
  return moves.sort(
    (left, right) =>
      cardStrength(right, ledSuit, state.trump) - cardStrength(left, ledSuit, state.trump),
  )
}

/**
 * Альфа-бета с мутацией состояния и откатом: без аллокаций на узел.
 * Узлы maxSeats максимизируют полезность, остальные минимизируют.
 * depth — бюджет взяток; последние EXACT_ENDGAME доигрываются точно.
 */
export function searchSim(
  state: SimState,
  ctx: SolveCtx,
  maxSeats: Set<Seat>,
  depth: number,
  stats: SearchStats,
  alpha = Number.NEGATIVE_INFINITY,
  beta = Number.POSITIVE_INFINITY,
): number {
  if (state.tricksLeft === 0) return utilityOfTricks(state.tricks, ctx)
  const exact = state.tricksLeft <= EXACT_ENDGAME
  if (!exact && depth <= 0) return leafUtility(state, ctx)

  const isMax = maxSeats.has(state.turn)
  const moves = orderMoves(legalSimMoves(state), state)
  let best = isMax ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  let low = alpha
  let high = beta

  for (const card of moves) {
    stats.nodes += 1
    if ((stats.nodes & 511) === 0 && Date.now() > stats.deadline) throw new BudgetAbort()

    // Мутация: убираем карту из руки, добавляем во взятку.
    const actor = state.turn
    const hand = state.hands[actor]
    const at = hand.indexOf(card)
    hand.splice(at, 1)
    const previousTrickLength = state.trick.length
    const previousKittyLead = state.kittyLead
    state.trick.push({ seat: actor, card })

    let completedWinner: Seat | null = null
    let completedTrick: TrickCard[] | null = null
    if (playerCardsInTrick(state.trick) === PLAYER_COUNT) {
      completedWinner = trickWinner(state.trick, state.trump)
      completedTrick = state.trick
      // Поддерево должно видеть пустое сукно: победитель открывает новую взятку.
      state.trick = []
      state.tricks[completedWinner] += 1
      state.tricksLeft -= 1
      state.turn = completedWinner
      if (previousKittyLead) {
        // Вторая взятка распасов заходит картой прикупа.
        state.trick = [
          { seat: completedWinner, card: previousKittyLead, fromPrikup: true },
        ]
        state.kittyLead = null
      }
    } else {
      state.turn = nextSeat(actor)
    }
    const trickDepth = completedWinner === null ? depth : depth - 1

    const value = searchSim(state, ctx, maxSeats, trickDepth, stats, low, high)

    // Откат: сукно возвращается к состоянию до хода (без сыгранной карты).
    state.turn = actor
    state.kittyLead = previousKittyLead
    if (completedTrick !== null) {
      state.trick = completedTrick
      state.tricks[completedWinner!] -= 1
      state.tricksLeft += 1
    }
    state.trick.length = previousTrickLength
    hand.splice(at, 0, card)

    if (isMax) {
      if (value > best) best = value
      if (best > low) low = best
    } else {
      if (value < best) best = value
      if (best < high) high = best
    }
    if (low >= high) break
  }
  return best
}

/** Сколько карт масти у соперников. */
function externalCount(state: SimState, seat: Seat, suit: Suit): number {
  let count = 0
  for (const other of otherSeats(seat)) {
    for (const card of state.hands[other]) {
      if (suitOf(card) === suit) count += 1
    }
  }
  return count
}

/**
 * Грубый потенциал руки: старшие карты масти, подтверждённые старше внешних,
 * плюс добор козырем. Листовая эвристика поиска.
 */
export function seatPotential(state: SimState, seat: Seat): number {
  const mine = state.hands[seat]
  const trump = state.trump
  const othersTrumps = trump === "NT" ? 0 : externalCount(state, seat, trump)
  let potential = 0
  for (const suit of SUITS) {
    const mineSuit = mine
      .filter((card) => suitOf(card) === suit)
      .sort((left, right) => rankStrength(right) - rankStrength(left))
    if (mineSuit.length === 0) continue
    const external = ([0, 1, 2] as Seat[])
      .filter((other) => other !== seat)
      .flatMap((other) => state.hands[other])
      .filter((card) => suitOf(card) === suit)
      .sort((left, right) => rankStrength(right) - rankStrength(left))
    let masters = 0
    while (
      masters < mineSuit.length &&
      (masters >= external.length ||
        rankStrength(mineSuit[masters]) > rankStrength(external[masters]))
    ) {
      masters += 1
    }
    if (suit === trump) {
      const extra = Math.max(0, Math.min(mineSuit.length - masters, othersTrumps))
      potential += masters + extra * 0.6
    } else if (othersTrumps > 0) {
      // Масть могут затромпить — мастер даёт только часть шанса.
      potential += masters * 0.4
    } else {
      potential += masters
    }
  }
  return Math.min(potential, Math.max(state.tricksLeft, 0))
}

/** Раскладываем грубые потенциалы в целые взятки по местам. */
function balancedTricks(raw: number[], contract: ContractCtx): number[] {
  const tricks = raw.map((value) => Math.max(0, Math.round(value)))
  if (contract.declarer !== null && contract.kind !== "raspas") {
    const declarer = contract.declarer
    const defenders = otherSeats(declarer)
    const declared = Math.min(Math.max(tricks[declarer], 0), TRICKS_PER_ROUND)
    const rest = TRICKS_PER_ROUND - declared
    const rawSum = tricks[defenders[0]] + tricks[defenders[1]]
    if (rawSum <= 0) {
      tricks[defenders[0]] = rest
      tricks[defenders[1]] = 0
    } else {
      const first = Math.round((rest * tricks[defenders[0]]) / rawSum)
      tricks[defenders[0]] = first
      tricks[defenders[1]] = rest - first
    }
    tricks[declarer] = declared
  } else {
    // Распасы: каждый тянет своё, сумма может не быть ровно десятью.
    for (const seat of [0, 1, 2] as Seat[]) {
      tricks[seat] = Math.min(Math.max(tricks[seat], 0), TRICKS_PER_ROUND)
    }
  }
  return tricks
}

function leafUtility(state: SimState, ctx: SolveCtx): number {
  const raw = ([0, 1, 2] as Seat[]).map((seat) => seatPotential(state, seat))
  const tricks = balancedTricks(raw as number[], ctx.contract)
  if (ctx.mode === "declarerTricks") {
    const seat = ctx.contract.declarer ?? ctx.perspective
    return tricks[seat]
  }
  return utilityOfTricks(tricks, ctx)
}
