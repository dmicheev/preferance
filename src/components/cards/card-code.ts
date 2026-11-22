import type { Card, Suit } from "@/lib/preference/cards"

import type { CardModel } from "./playing-card"
import type { SuitId } from "./suit"

const SUIT_IDS: Record<Suit, SuitId> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
}

/** Карта движка («SA» — туз пик) → модель для рисования. */
export function toCardModel(card: Card): CardModel {
  return {
    rank: card.slice(1) as CardModel["rank"],
    suit: SUIT_IDS[card[0] as Suit],
  }
}
