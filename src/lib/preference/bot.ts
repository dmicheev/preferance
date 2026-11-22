// Мозг компьютерного игрока: чистый выбор хода из legalMoves.
// Нет случайности и таймеров — только пауза планировщика случайна.

import {
  cardStrength,
  compareHandCards,
  rankStrength,
  type Card,
  type Suit,
  type Trump,
  suitOf,
} from "./cards"
import {
  legalMoves,
  type RoundAction,
  type RoundState,
  type Seat,
  type TrickCard,
} from "./round"
import { MAX_LEVEL, MIN_LEVEL } from "./constants"

export type BotLevel = "NOVICE" | "PLAYER" | "MASTER"

export const BOT_LEVELS: BotLevel[] = ["NOVICE", "PLAYER", "MASTER"]

/** Случайная пауза планировщика перед ходом бота (мс). */
export const BOT_DELAY = { minMs: 500, maxMs: 2500 }

/** Преобразует любой вход в допустимый уровень бота (по образцу normalizeRuleset). */
export function normalizeBotLevel(input: unknown): BotLevel {
  if (typeof input === "string" && BOT_LEVELS.includes(input as BotLevel)) {
    return input as BotLevel
  }
  return "PLAYER"
}

/** Слабая оценка руки для торговли: тузы + длина мастей. */
function handStrength(hand: Card[]): number {
  let score = 0
  const suitCounts: Record<string, number> = { S: 0, H: 0, D: 0, C: 0 }
  for (const card of hand) {
    const rank = card.slice(1)
    const suit = card[0]
    suitCounts[suit] = (suitCounts[suit] ?? 0) + 1
    if (rank === "A") score += 4
    else if (rank === "K") score += 3
    else if (rank === "Q") score += 2
    else if (rank === "J") score += 1
  }
  // Длинная масть — плюс: каждая карта свыше 3 в масти добавляет силу.
  for (const suit of Object.keys(suitCounts)) {
    const count = suitCounts[suit]
    if (count > 3) score += count - 3
  }
  return score
}

/** Козыри в руке: количество и старший козырь. */
function trumpInfo(hand: Card[], trump: Trump): { count: number; top: number | null } {
  if (trump === "NT") return { count: 0, top: null }
  let count = 0
  let top: number | null = null
  for (const card of hand) {
    if (card[0] === trump) {
      count += 1
      const strength = cardStrength(card, trump, trump)
      if (top === null || strength > top) top = strength
    }
  }
  return { count, top }
}

/** Оценивает suitability масти как козыря для руки. */
function suitSuitability(hand: Card[], suit: Trump): number {
  if (suit === "NT") return 0
  const { count, top } = trumpInfo(hand, suit)
  let score = count * 3
  if (top !== null) score += top / 10
  return score
}

/** Найти лучшую козырную масть для руки. */
function bestTrumpFor(hand: Card[]): Trump {
  let best: Trump = "S"
  let bestScore = -1
  for (const trump of ["S", "C", "D", "H"] as Trump[]) {
    const score = suitSuitability(hand, trump)
    if (score > bestScore) {
      bestScore = score
      best = trump
    }
  }
  return best
}

/** Выбрать минимально достаточную карту, чтобы взять взятку (или старшую, если не взять). */
function cardToWin(trick: TrickCard[], hand: Card[], ledSuit: Suit, trump: Trump): Card | null {
  const currentBest = trick.reduce((best, item) =>
    cardStrength(item.card, ledSuit, trump) > cardStrength(best.card, ledSuit, trump)
      ? item
      : best,
  )
  const currentStrength = cardStrength(currentBest.card, ledSuit, trump)

  // Ищем козырь старше текущего лучшего
  const candidates: Card[] = []
  for (const card of hand) {
    if (cardStrength(card, ledSuit, trump) > currentStrength) {
      candidates.push(card)
    }
  }
  if (candidates.length > 0) {
    // Минимально достаточная: слабейшая из старших
    candidates.sort((a, b) => cardStrength(a, ledSuit, trump) - cardStrength(b, ledSuit, trump))
    return candidates[0]
  }
  return null
}

/** Выбрать самую старшую карту масти хода. */
function highestOfSuit(hand: Card[], suit: Suit): Card | null {
  const suited = hand.filter((card) => suitOf(card) === suit)
  if (suited.length === 0) return null
  suited.sort((a, b) => cardStrength(b, suit, suit) - cardStrength(a, suit, suit))
  return suited[0]
}

/** Выбрать самую младшую карту в руке (не козырь, если можно). */
function lowestCard(hand: Card[], trump: Trump): Card {
  if (trump === "NT") {
    const pool = [...hand].sort((a, b) => cardStrength(a, "S", trump) - cardStrength(b, "S", trump))
    return pool[0]
  }
  const nonTrump = hand.filter((card) => suitOf(card) !== trump)
  const pool = nonTrump.length > 0 ? nonTrump : hand
  pool.sort((a, b) => cardStrength(a, "S", trump) - cardStrength(b, "S", trump))
  return pool[0]
}

/** Выбрать самую старшую козырную карту. */
function highestTrump(hand: Card[], trump: Trump): Card | null {
  if (trump === "NT") return null
  const trumps = hand.filter((card) => suitOf(card) === trump)
  if (trumps.length === 0) return null
  trumps.sort((a, b) => cardStrength(b, trump, trump) - cardStrength(a, trump, trump))
  return trumps[0]
}

/**
 * Бросить две наименее ценные карты (сначала не-козыри, младшие).
 * cleanSuit — «чистая» масть мизера: если её можно не трогать, не трогаем.
 */
function cardsToDiscard(hand: Card[], trump: Trump, cleanSuit: Suit | null = null): Card[] {
  const filtered = cleanSuit ? hand.filter((card) => suitOf(card) !== cleanSuit) : hand
  const source = filtered.length >= 2 ? filtered : hand

  if (trump === "NT") {
    const ordered = [...source].sort((a, b) => cardStrength(a, "S", trump) - cardStrength(b, "S", trump))
    return [ordered[0], ordered[1]]
  }
  const ordered = [...source].sort((a, b) => {
    const aTrump = suitOf(a) === trump ? 1 : 0
    const bTrump = suitOf(b) === trump ? 1 : 0
    if (aTrump !== bTrump) return bTrump - aTrump // козыри в конец
    return cardStrength(a, "S", trump) - cardStrength(b, "S", trump)
  })
  return [ordered[0], ordered[1]]
}

/** Есть ли в руке "чистая" масть (все старшие карты масти). */
function hasCleanSuit(hand: Card[], suit: Suit): boolean {
  const suited = hand.filter((card) => suitOf(card) === suit)
  if (suited.length === 0) return false
  const ranks = suited.map((card) => card.slice(1))
  // Чистая масть: есть туз и нет дыр среди старших (упрощённо: туз + король/дама)
  return ranks.includes("A") && (ranks.includes("K") || ranks.includes("Q"))
}

/** Выбрать действие бота: всегда легальное, всегда детерминированное. */
export function chooseAction(
  round: RoundState,
  seat: Seat,
  level: BotLevel,
): RoundAction {
  const hand = round.hands[seat]
  const legal = legalMoves(round, seat)

  switch (round.phase) {
    case "bidding": {
      return chooseBid(round, seat, hand, level)
    }
    case "declaring": {
      return chooseDeclare(round, seat, hand, level)
    }
    case "whist": {
      return chooseWhist(round, seat, hand, level)
    }
    case "play": {
      return choosePlay(round, seat, hand, legal, level)
    }
    default:
      // scored — не должно ходить бота; пас как заглушка
      return { type: "pass", seat }
  }
}

/* ---------- торговля ---------- */

function chooseBid(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  level: BotLevel,
): RoundAction {
  const strength = handStrength(hand)
  const highest = round.highest
  const canBid = highest === null || round.turn === seat

  if (!canBid) return { type: "pass", seat }

  // Новичок: заказывает только 6 при «на что-то», иначе пасует
  if (level === "NOVICE") {
    if (highest === null && strength >= 8) {
      return { type: "bid", seat, level: MIN_LEVEL, trump: bestTrumpFor(hand) }
    }
    return { type: "pass", seat }
  }

  // Игрок: заказывает если сила руки достаточна
  if (level === "PLAYER") {
    if (highest === null) {
      if (strength >= 10) {
        return { type: "bid", seat, level: MIN_LEVEL, trump: bestTrumpFor(hand) }
      }
      return { type: "pass", seat }
    }
    // Есть высший заказ — passareм, если рука не очень сильная
    if (strength >= 12 && highest.bid.level < MAX_LEVEL) {
      const nextLevel = Math.min(highest.bid.level + 1, MAX_LEVEL)
      return { type: "bid", seat, level: nextLevel, trump: bestTrumpFor(hand) }
    }
    return { type: "pass", seat }
  }

  // Мастер: расчётный заказ, учитывает козырную длину и онёры
  if (highest === null) {
    if (strength >= 8) {
      return { type: "bid", seat, level: MIN_LEVEL, trump: bestTrumpFor(hand) }
    }
    return { type: "pass", seat }
  }
  // Перебиваем, если рука достаточно сильна для текущего заказа
  const { count: trumpCount } = trumpInfo(hand, highest.bid.trump)
  const needStrength = highest.bid.level * 2 + (trumpCount < 2 ? 3 : 0)
  if (strength >= needStrength && highest.bid.level < MAX_LEVEL) {
    const nextLevel = Math.min(highest.bid.level + 1, MAX_LEVEL)
    return { type: "bid", seat, level: nextLevel, trump: bestTrumpFor(hand) }
  }
  return { type: "pass", seat }
}

/* ---------- прикуп/снос ---------- */

function chooseDeclare(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  level: BotLevel,
): RoundAction {
  const trump = round.highest?.bid.trump ?? "S"

  // Мастер ищет «чистую» масть мизера и не сносит из неё.
  const cleanSuit =
    level === "MASTER"
      ? ((["S", "H", "D", "C"] as Suit[]).find((s) => hasCleanSuit(hand, s)) ?? null)
      : null
  const discard = cardsToDiscard(hand, trump, cleanSuit)

  if (level === "NOVICE") {
    return { type: "declare", seat, contract: "game", discard }
  }

  // Мастер: мизер только на чистой руке и только с шестёрки — иначе движок не примет.
  const misereAllowed = (round.highest?.bid.level ?? 0) === MIN_LEVEL
  if (level === "MASTER" && misereAllowed && cleanSuit && handStrength(hand) >= 14) {
    return { type: "declare", seat, contract: "misere", discard }
  }

  return { type: "declare", seat, contract: "game", discard }
}

/* ---------- вист ---------- */

function chooseWhist(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  level: BotLevel,
): RoundAction {
  const contract = round.contract
  if (!contract || contract.kind !== "game") return { type: "whist", seat, whist: false }

  const trump = contract.trump
  const { count: trumpCount } = trumpInfo(hand, trump)
  const strength = handStrength(hand)

  if (level === "NOVICE") {
    // Почти никогда не вистует
    return { type: "whist", seat, whist: strength >= 16 && trumpCount >= 3 }
  }

  if (level === "PLAYER") {
    return { type: "whist", seat, whist: strength >= 12 && trumpCount >= 2 }
  }

  // Мастер: вистует по расчёту
  const whistLikely = trumpCount >= 3 && strength >= 10
  return { type: "whist", seat, whist: whistLikely }
}

/* ---------- ход картой ---------- */

function choosePlay(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  legal: Card[],
  level: BotLevel,
): RoundAction {
  if (legal.length === 0) return { type: "play", seat, card: hand[0] }

  const led = round.trick[0]
  const trump = trumpOf(round)
  const isMisere = round.contract?.kind === "misere"

  if (level === "NOVICE") {
    // Простая игра: первая легальная карта по сортировке руки
    const legalSorted = [...legal].sort(compareHandCards)
    return { type: "play", seat, card: legalSorted[0] }
  }

  // Мизер, чужой ход: сбрасываем старшую из карт, которые точно не берут взятку —
  // опасные карты должны уходить первыми, пока не заставили взять.
  if (isMisere && led) {
    const ledSuit = suitOf(led.card)
    const bestSoFar = Math.max(
      ...round.trick.map((item) => cardStrength(item.card, ledSuit, "NT")),
    )
    const safe = legal.filter((card) => cardStrength(card, ledSuit, "NT") < bestSoFar)
    if (safe.length > 0) {
      safe.sort((left, right) => rankStrength(right) - rankStrength(left))
      return { type: "play", seat, card: safe[0] }
    }
  }

  // Мизер, наш ход: младшая карта руки — высокие держим, чтобы сбросить на чужую взятку.
  if (isMisere) {
    const weakest = [...legal].sort((a, b) => rankStrength(a) - rankStrength(b))[0]
    return { type: "play", seat, card: weakest }
  }

  if (led) {
    const ledSuit: Suit = suitOf(led.card)
    // Есть масть хода — пытаемся пойти под старшего или сбросить мелкое
    const winCard = cardToWin(round.trick, hand, ledSuit, trump)
    if (winCard && legal.includes(winCard)) {
      // Игрок и мастер берут минимально достаточной
      return { type: "play", seat, card: winCard }
    }
    // Не можем взять — скидываем самую младшую не-козырную карту
    const discard = lowestCard(hand, trump)
    if (legal.includes(discard)) {
      return { type: "play", seat, card: discard }
    }
    return { type: "play", seat, card: legal[0] }
  }

  // Первым ходим во взятке: козырь или старшую масть
  if (level === "MASTER") {
    const topTrump = highestTrump(hand, trump)
    if (topTrump && legal.includes(topTrump)) {
      return { type: "play", seat, card: topTrump }
    }
    const bestSuit = highestOfSuit(hand, suitOf(hand[0]))
    if (bestSuit && legal.includes(bestSuit)) {
      return { type: "play", seat, card: bestSuit }
    }
  }

  return { type: "play", seat, card: legal[0] }
}

/** Козырь текущего контракта (или NT до определения). */
function trumpOf(round: RoundState): Trump {
  return round.contract?.kind === "game" ? round.contract.trump : "NT"
}

