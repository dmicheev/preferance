// Мозг компьютерного игрока: чистый выбор хода из legalMoves.
// Нет случайности и таймеров — только пауза планировщика случайна.

import {
  cardStrength,
  compareHandCards,
  RANKS,
  rankStrength,
  SUITS,
  type Card,
  type Suit,
  type Trump,
  suitOf,
} from "./cards"
import {
  legalMoves,
  type Bid,
  type RoundAction,
  type RoundState,
  type Seat,
  type TrickCard,
} from "./round"
import { MAX_LEVEL, MIN_LEVEL, PLAYER_COUNT } from "./constants"

export type BotLevel = "NOVICE" | "PLAYER" | "MASTER"

export const BOT_LEVELS: BotLevel[] = ["NOVICE", "PLAYER", "MASTER"]

/** Случайная пауза планировщика перед ходом бота (мс). */
export const BOT_DELAY = { minMs: 700, maxMs: 2600 }

/** Преобразует любой вход в допустимый уровень бота (по образцу normalizeRuleset). */
export function normalizeBotLevel(input: unknown): BotLevel {
  if (typeof input === "string" && BOT_LEVELS.includes(input as BotLevel)) {
    return input as BotLevel
  }
  return "PLAYER"
}

/** Слабая оценка руки для торговли: тузы + длина мастей. */
export function handStrength(hand: Card[]): number {
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
export function trumpInfo(hand: Card[], trump: Trump): { count: number; top: number | null } {
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
export function bestTrumpFor(hand: Card[]): Trump {
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
  // Заходящая карта прикупа (распасы) взятку взять не может: ориентир —
  // старшая из карт игроков, а если их ещё нет — сама карта захода.
  const contenders = trick.filter((item) => !item.fromPrikup)
  const currentBest =
    contenders.length > 0
      ? contenders.reduce((best, item) =>
          cardStrength(item.card, ledSuit, trump) >
          cardStrength(best.card, ledSuit, trump)
            ? item
            : best,
        )
      : trick[0]
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
export function lowestCard(hand: Card[], trump: Trump): Card {
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
export function cardsToDiscard(
  hand: Card[],
  trump: Trump,
  cleanSuit: Suit | null = null,
): Card[] {
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
export function hasCleanSuit(hand: Card[], suit: Suit): boolean {
  const suited = hand.filter((card) => suitOf(card) === suit)
  if (suited.length === 0) return false
  const ranks = suited.map((card) => card.slice(1))
  // Чистая масть: есть туз и нет дыр среди старших (упрощённо: туз + король/дама)
  return ranks.includes("A") && (ranks.includes("K") || ranks.includes("Q"))
}

/**
 * Рука «чиста» для мизера: в каждой масти либо ренонс, либо мои карты младше
 * накрывающих карт соперников. Играющий сбрасывает старшую из не-берущих,
 * поэтому его k-я карта под ход сопоставляется с накрытием по темпу, каким
 * соперники выжигают старшие карты: по одной за взятку (третий без масти)
 * или по две (оба в масти). Карта discard не считается накрывающей: она ушла
 * в снос, её нет ни у соперников, ни в игре. Прикуп до вскрытия — «снаружи».
 * strict — оба темпа (гарантия и против выжигания парами, рука мастера).
 * Не strict — медленный темп плюс старшая карта не старше второго накрытия:
 * голый король под единственным тузом не проходит, недозавод ловится.
 */
export function isMisereClean(
  hand: Card[],
  discard: Card[] = [],
  strict = true,
): boolean {
  for (const suit of SUITS) {
    const mine = hand
      .filter((card) => suitOf(card) === suit)
      .sort((left, right) => rankStrength(left) - rankStrength(right))
    if (mine.length === 0) continue // ренонс — масть безопасна
    const outside = [...RANKS]
      .reverse()
      .map((rank) => `${suit}${rank}` as Card)
      .filter((card) => !mine.includes(card) && !discard.includes(card))
    for (const pace of strict ? [1, 2] : [1]) {
      const depth = Math.min(mine.length, Math.ceil(outside.length / pace))
      for (let k = 1; k <= depth; k += 1) {
        const myCard = mine[mine.length - k] // k-я старшая из моих
        const cover = outside[pace * (k - 1)] // накрытие на k-й ход масти
        if (rankStrength(myCard) >= rankStrength(cover)) {
          return false
        }
      }
    }
    if (!strict && outside.length >= 2) {
      // Старшая карта масти обязана быть младше второго накрытия снаружи.
      if (rankStrength(mine[mine.length - 1]) >= rankStrength(outside[1])) {
        return false
      }
    }
  }
  return true
}

/** Снос для мизера: первая по порядку рука пара карт, после которой рука чиста. */
export function misereDiscard(hand: Card[], strict: boolean): Card[] | null {
  const ordered = [...hand].sort(compareHandCards)
  for (let first = 0; first < ordered.length - 1; first += 1) {
    for (let second = first + 1; second < ordered.length; second += 1) {
      const pair = [ordered[first], ordered[second]]
      const rest = ordered.filter((_, index) => index !== first && index !== second)
      if (isMisereClean(rest, pair, strict)) return pair
    }
  }
  return null
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
      // Взятка сошлась: сначала все смотрят карты, потом победитель ходит.
      if (
        round.trick.length === 0 &&
        round.history.length > 0 &&
        round.trickAck.length < PLAYER_COUNT
      ) {
        return { type: "trick-ack", seat }
      }
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

  // Чистая мизерная рука: заявляем мизер сразу — его перебьют только десятой.
  // Поверх чужого мизера или заказа выше шестёрки мизер мёртв — пасуем. Мастер проверяет руку строго (гарантия),
  // игрок — по медленному темпу.
  if (isMisereClean(hand, [], level === "MASTER")) {
    if (
      highest === null ||
      (!("kind" in highest.bid) && highest.bid.level === MIN_LEVEL)
    ) {
      return { type: "misere", seat }
    }
    return { type: "pass", seat }
  }

  // Игрок и мастер: перебивают по расчёту — сила под уровень плюс своя
  // длинная масть. Без неё онёры не тянут уровень: слабые шестёрки доживают
  // до прикупа, а лестница заказов растёт постепенно, а не прыжком до десятной.
  const openThreshold = level === "PLAYER" ? 10 : 8
  if (highest === null) {
    if (strength >= openThreshold) {
      return { type: "bid", seat, level: MIN_LEVEL, trump: bestTrumpFor(hand) }
    }
    return { type: "pass", seat }
  }
  const best = bestTrumpFor(hand)
  const ownCount = trumpInfo(hand, best).count
  // Чужой мизер перебивается только десятой: расчёт от десяти взяток.
  const raiseLevel = "kind" in highest.bid ? MAX_LEVEL : highest.bid.level
  const bidSuitCount =
    "kind" in highest.bid ? 0 : trumpInfo(hand, highest.bid.trump).count
  const needStrength =
    raiseLevel * 2 + (ownCount >= 4 ? (bidSuitCount < 2 ? 3 : 0) : 99)
  // Десятой перебиваем и мизер, и чужую десятую старшей мастью.
  if (strength >= needStrength && raiseLevel <= MAX_LEVEL) {
    return {
      type: "bid",
      seat,
      level: Math.min(raiseLevel + 1, MAX_LEVEL),
      trump: best,
    }
  }
  return { type: "pass", seat }
}

/* ---------- прикуп/снос ---------- */

/**
 * Подъём после прикупа: заказанную игру оставляют или поднимают.
 * Сильная рука (4+ козыря лучшей масти, хватка под уровень+1) — поднимаем
 * лучшей мастью, иначе играем заказанное. Новичок всегда играет заказанное.
 */
export function declareRaise(
  hand: Card[],
  level: BotLevel,
  highestBid: Bid | undefined,
): { level: number; trump: Trump } | null {
  if (level === "NOVICE") return null
  if (!highestBid || "kind" in highestBid) return null
  if (highestBid.level >= MAX_LEVEL) return null
  const best = bestTrumpFor(hand)
  if (trumpInfo(hand, best).count < 4) return null
  if (handStrength(hand) < (highestBid.level + 1) * 2 + 3) return null
  return { level: highestBid.level + 1, trump: best }
}

function chooseDeclare(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  level: BotLevel,
): RoundAction {
  // Порядок за столом: прикуп показан всем, снос — после последнего Ок.
  if (round.prikupAck.length < PLAYER_COUNT) {
    return { type: "prikup-ack", seat }
  }

  // Заявленный в торговле мизер играется всегда: прикуп уже открыт, отказ
  // невозможен. Игровые заявки дают право на мизер только с шестёрки.
  const highestBid = round.highest?.bid
  const auctionMisere = highestBid !== undefined && "kind" in highestBid
  const trump = highestBid && !("kind" in highestBid) ? highestBid.trump : "S"

  const misereAllowed =
    auctionMisere ||
    (highestBid !== undefined &&
      !("kind" in highestBid) &&
      highestBid.level === MIN_LEVEL)
  if (level !== "NOVICE" && misereAllowed) {
    const plan = misereDiscard(hand, level === "MASTER")
    if (plan) {
      return { type: "declare", seat, contract: "misere", discard: plan }
    }
  }
  if (auctionMisere) {
    // Чистой руки не вышло, но мизер заявлен: сбрасываем две младшие карты.
    return {
      type: "declare",
      seat,
      contract: "misere",
      discard: cardsToDiscard(hand, "NT"),
    }
  }

  // Оставить заказ или поднять: снос держим под итоговый козырь.
  const raise = declareRaise(hand, level, highestBid)
  const gameTrump = raise ? raise.trump : trump

  // Для игры: мастер не сносит из «чистой» масти — это его гарантированные взятки.
  const cleanSuit =
    level === "MASTER"
      ? (SUITS.find((suit) => hasCleanSuit(hand, suit)) ?? null)
      : null
  const discard = cardsToDiscard(hand, gameTrump, cleanSuit)

  return {
    type: "declare",
    seat,
    contract: "game",
    discard,
    ...(raise ? { level: raise.level, trump: raise.trump } : {}),
  }
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

/**
 * Легаси-эвристика хода картой: используется умным ботом как fallback
 * при исчерпании бюджета и как тай-брейк среди ходов с равным EV.
 */
export function choosePlay(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  legal: Card[],
  level: BotLevel,
): RoundAction {
  if (legal.length === 0) return { type: "play", seat, card: hand[0] }

  const led = round.trick[0]
  const trump = trumpOf(round)
  // От мизерных взяток уклоняется только играющий; защитники играют как обычно.
  const isMisere = round.contract?.kind === "misere" && round.declarer === seat

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

