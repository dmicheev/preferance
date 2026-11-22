// Карты преферанса: 32 листа (7…туз), старшинство мастей
// пики → трефы → бубны → черви → без козыря.
// Файл чистый: ни Node-, ни React-зависимостей.

export const SUITS = ["S", "H", "D", "C"] as const
export type Suit = (typeof SUITS)[number]

export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"] as const
export type Rank = (typeof RANKS)[number]

/** Карта — строка из масти и ранга: "SA" (туз пик), "D10" (десятка бубён). */
export type Card = `${Suit}${Rank}`

/** Козырь для контракта: масть или "NT" (без козыря). */
export const TRUMPS = ["S", "C", "D", "H", "NT"] as const
export type Trump = (typeof TRUMPS)[number]

export const SUIT_LABEL: Record<Suit, string> = {
  S: "пики",
  H: "черви",
  D: "бубны",
  C: "трефы",
}

/** Родительный падеж — для «дама червей», «валет пик». */
export const SUIT_GENITIVE: Record<Suit, string> = {
  S: "пик",
  H: "червей",
  D: "бубён",
  C: "треф",
}

export const RANK_LABEL: Record<Rank, string> = {
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "валет",
  Q: "дама",
  K: "король",
  A: "туз",
}

export const TRUMP_LABEL: Record<Trump, string> = {
  S: "пики",
  H: "черви",
  D: "бубны",
  C: "трефы",
  NT: "без козыря",
}

export const RANK_STRENGTH: Record<Rank, number> = {
  "7": 0,
  "8": 1,
  "9": 2,
  "10": 3,
  J: 4,
  Q: 5,
  K: 6,
  A: 7,
}

/** Младшая масть — пики, старшая — без козыря. */
export const TRUMP_ORDER: Record<Trump, number> = {
  S: 0,
  C: 1,
  D: 2,
  H: 3,
  NT: 4,
}

export const FULL_DECK: readonly Card[] = SUITS.flatMap((suit) =>
  RANKS.map((rank) => `${suit}${rank}` as Card),
)

const CARD_PATTERN = /^[SHDC](10|[789JQKA])$/

export function isCard(value: unknown): value is Card {
  return typeof value === "string" && CARD_PATTERN.test(value)
}

export function suitOf(card: Card): Suit {
  return card[0] as Suit
}

export function rankOf(card: Card): Rank {
  return card.slice(1) as Rank
}

export function rankStrength(card: Card): number {
  return RANK_STRENGTH[rankOf(card)]
}

/**
 * Вес карты внутри взятки: козырь старше любой масти, карта в масти хода
 * старше сброса. Сброс без козыря вес не получает (0).
 */
export function cardStrength(card: Card, ledSuit: Suit, trump: Trump): number {
  if (trump !== "NT" && suitOf(card) === trump) {
    return 100 + RANK_STRENGTH[rankOf(card)]
  }
  if (suitOf(card) === ledSuit) {
    return 50 + RANK_STRENGTH[rankOf(card)]
  }
  return 0
}

export function beats(
  candidate: Card,
  current: Card,
  ledSuit: Suit,
  trump: Trump,
): boolean {
  return (
    cardStrength(candidate, ledSuit, trump) >
    cardStrength(current, ledSuit, trump)
  )
}

/** Для сортировки руки: по масти, внутри масти от старшей к младшей. */
export function compareHandCards(left: Card, right: Card): number {
  const suitDelta = TRUMP_ORDER[left[0] as Trump] - TRUMP_ORDER[right[0] as Trump]
  if (suitDelta !== 0) return suitDelta
  return rankStrength(right) - rankStrength(left)
}

export function formatCard(card: Card): string {
  return `${RANK_LABEL[rankOf(card)]} ${SUIT_GENITIVE[suitOf(card)]}`
}