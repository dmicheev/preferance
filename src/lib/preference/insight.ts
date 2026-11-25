// Легальные знания бота о раздаче: что видно из его места, и что из этого следует.
// Никакого подглядывания в чужие руки: только своя карта, публичный снос,
// открытый прикуп, вышедшие карты и ренонсы из истории взяток.

import { FULL_DECK, suitOf, type Card, type Suit } from "./cards"
import { otherSeats, type RoundState, type Seat } from "./round"

/** Все карты, так или иначе показанные на столе: истории взяток и текущая взятка. */
export function playedCards(round: RoundState): Card[] {
  const history = round.history.flatMap((trick) =>
    trick.cards.map((item) => item.card),
  )
  return [...history, ...round.trick.map((item) => item.card)]
}

/** Прикуп открыт всем после окончания торговли — кроме распасов. */
export function prikupIsPublic(round: RoundState): boolean {
  return round.phase !== "bidding" && round.contract?.kind !== "raspas"
}

/**
 * Карты прикупа, уже показанные на распасах: каждая открывается
 * в момент своей взятки — первая сразу, вторая после доигранной первой.
 */
export function raspasPrikupOpen(round: RoundState): Card[] {
  if (round.contract?.kind !== "raspas") return []
  const secondShown =
    round.history.length >= 2 ||
    (round.history.length >= 1 && round.trick.some((item) => item.fromPrikup))
  return secondShown ? [...round.prikup] : [round.prikup[0]]
}

/** Карты, которые место seat не видит: пул для сэмплирования чужих рук. */
export function unseenCards(round: RoundState, seat: Seat): Card[] {
  const seen = new Set<Card>(round.hands[seat])
  for (const card of playedCards(round)) seen.add(card)
  for (const card of round.discard) seen.add(card)
  if (prikupIsPublic(round)) {
    for (const card of round.prikup) seen.add(card)
  } else {
    for (const card of raspasPrikupOpen(round)) seen.add(card)
  }
  return FULL_DECK.filter((card) => !seen.has(card))
}

/**
 * Ренонсы: масти, которых у места точно нет. Не пошёл в масть хода —
 * карт этой масти у него не было и не появится.
 */
export function voidSuits(round: RoundState): Map<Seat, Set<Suit>> {
  const voids = new Map<Seat, Set<Suit>>()
  for (const seat of [0, 1, 2] as Seat[]) voids.set(seat, new Set())
  const tricks = round.history.map((trick) => trick.cards)
  if (round.trick.length > 0) tricks.push(round.trick)
  for (const trick of tricks) {
    if (trick.length === 0) continue
    const ledSuit = suitOf(trick[0].card)
    for (const item of trick.slice(1)) {
      if (suitOf(item.card) !== ledSuit) voids.get(item.seat)?.add(ledSuit)
    }
  }
  return voids
}

export type DealGeometry = {
  /** Два места, чьи руки нужно набрать из неизвестных карт. */
  others: [Seat, Seat]
  /** Сколько карт должно оказаться в каждой из этих рук. */
  counts: [number, number]
  /** Пул неизвестных карт: ровно наполняет чужие руки и скрытый прикуп. */
  unknown: Card[]
  /** Карты, точно лежащие в руке места: недискарднутый прикуп играющего. */
  fixed: Partial<Record<Seat, Card[]>>
  /** Скрытый прикуп в торговле: столько карт пула уйдёт в прикуп. */
  prikupCount: number
  /** Карты вне игры (ещё не показанный прикуп распасов) — в сэмпле не участвуют. */
  limbo: Card[]
}

/**
 * Геометрия раздачи с точки зрения места seat: кого и чем наполнять
 * при сэмплировании. В торговле прикуп ещё скрыт, после торговли он публичен,
 * на распасах его карты по одной заходят во взятки: показанные известны всем,
 * ещё скрытые никому не принадлежат и в сэмпле не участвуют.
 */
export function dealGeometry(round: RoundState, seat: Seat): DealGeometry {
  const others = otherSeats(seat) as [Seat, Seat]
  const counts = [
    round.hands[others[0]].length,
    round.hands[others[1]].length,
  ] as [number, number]
  const fixed: Partial<Record<Seat, Card[]>> = {}
  let prikupCount = 0
  let limbo: Card[] = []

  if (round.phase === "bidding") {
    prikupCount = round.prikup.length
  } else if (round.contract?.kind === "raspas") {
    // Показанные карты прикупа уже в seen (через unseenCards), ещё скрытые
    // не у кого не лежат.
    const open = new Set(raspasPrikupOpen(round))
    limbo = round.prikup.filter((card) => !open.has(card))
  } else if (round.declarer !== null && round.declarer !== seat) {
    // Недискарднутый и ещё не сыгранный прикуп точно в руке играющего.
    const played = new Set(playedCards(round))
    const sure = round.prikup.filter(
      (card) => !round.discard.includes(card) && !played.has(card),
    )
    if (sure.length > 0) fixed[round.declarer] = sure
  }

  const unseen = unseenCards(round, seat)
  const unknown = unseen.filter((card) => !limbo.includes(card))
  return { others, counts, unknown, fixed, prikupCount, limbo }
}

/** Сходится ли бухгалтерия: пул неизвестных ровно покрывает чужие руки и прикуп. */
export function geometryConsistent(geometry: DealGeometry): boolean {
  const fixedCount = ([0, 1, 2] as Seat[]).reduce<number>(
    (sum, seat) => sum + (geometry.fixed[seat]?.length ?? 0),
    0,
  )
  const needed =
    geometry.counts[0] + geometry.counts[1] + geometry.prikupCount - fixedCount
  return needed === geometry.unknown.length
}

export type SampledDeal = {
  /** Руки двух чужих мест, в порядке geometry.others. */
  hands: [Card[], Card[]]
  /** Скрытый прикуп (пуст в фазах после торговли). */
  prikup: Card[]
}

/**
 * Сэмплировать count равновероятных раскладов неизвестных карт между чужими
 * руками с учётом ренонсов. Отклоняющие сэмплы отбрасываются; если ренонсы
 * не сходятся ни разу — последний сэмпл без их учёта.
 */
export function sampleDeals(
  geometry: DealGeometry,
  voids: Map<Seat, Set<Suit>>,
  rng: () => number,
  count: number,
  maxAttempts = 500,
): SampledDeal[] {
  const [seatA, seatB] = geometry.others
  const fixedA = geometry.fixed[seatA] ?? []
  const fixedB = geometry.fixed[seatB] ?? []
  const needA = geometry.counts[0] - fixedA.length
  const needB = geometry.counts[1] - fixedB.length
  const needPrikup = geometry.prikupCount
  if (needA < 0 || needB < 0 || needPrikup < 0) return []

  const voidA = voids.get(seatA) ?? new Set<Suit>()
  const voidB = voids.get(seatB) ?? new Set<Suit>()

  const dealOnce = (checkVoids: boolean): SampledDeal | null => {
    const shuffled = [...geometry.unknown]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    let cursor = 0
    const take = (n: number): Card[] => {
      if (cursor + n > shuffled.length) return []
      const slice = shuffled.slice(cursor, cursor + n)
      cursor += n
      return slice
    }
    const handA = [...take(needA), ...fixedA]
    const handB = [...take(needB), ...fixedB]
    const prikup = take(needPrikup)
    if (cursor !== shuffled.length) return null
    if (checkVoids) {
      if (handA.some((card) => voidA.has(suitOf(card)))) return null
      if (handB.some((card) => voidB.has(suitOf(card)))) return null
    }
    return { hands: [handA, handB], prikup }
  }

  const results: SampledDeal[] = []
  for (let attempt = 0; attempt < maxAttempts && results.length < count; attempt += 1) {
    const deal = dealOnce(true)
    if (deal) results.push(deal)
  }
  if (results.length === 0) {
    const deal = dealOnce(false)
    if (deal) results.push(deal)
  }
  return results
}
