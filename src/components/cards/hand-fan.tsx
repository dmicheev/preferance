import type { CSSProperties } from "react"

import { toCardModel } from "./card-code"
import { PlayingCard } from "./playing-card"
import type { Card } from "@/lib/preference/cards"

type HandFanProps = {
  /** Карты в руке — уже в порядке показа. */
  cards: Card[]
  /** Карты, которые можно сыграть сейчас; null — любые. */
  playable?: ReadonlySet<Card> | null
  /** Выбранные карты (снос). */
  selected?: ReadonlySet<Card> | null
  onCardClick?: (card: Card) => void
  note?: string | null
}

/** Своя рука веером: подсветка легальных и выбранных карт. */
export function HandFan({
  cards,
  playable = null,
  selected = null,
  onCardClick,
  note,
}: HandFanProps) {
  if (cards.length === 0) {
    return (
      <div className="hand hand--empty">
        {note ? <span className="hand__note">{note}</span> : null}
      </div>
    )
  }

  const middle = (cards.length - 1) / 2

  return (
    <div className="hand">
      {cards.map((card, index) => {
        const offset = index - middle
        const rotate = offset * Math.min(3.1, 31 / cards.length)
        const arc = Math.abs(offset) * 2.3
        const isPlayable = playable ? playable.has(card) : true
        const isSelected = selected?.has(card) ?? false
        // карта начинает новую масть — веер разрывается, группы читаются раздельно
        const startsSuit = index > 0 && card[0] !== cards[index - 1][0]

        const slotClass = [
          "hand__slot",
          startsSuit ? "hand__slot--new-suit" : null,
          isPlayable ? null : "hand__slot--dimmed",
          isSelected ? "hand__slot--selected" : null,
        ]
          .filter(Boolean)
          .join(" ")

        return (
          <div
            key={card}
            className={slotClass}
            style={{ animationDelay: `${index * 55}ms` } as CSSProperties}
            onClick={onCardClick ? () => onCardClick(card) : undefined}
            role={onCardClick ? "button" : undefined}
            aria-label={onCardClick ? `карта ${card}` : undefined}
          >
            <PlayingCard card={toCardModel(card)} style={rotateStyle(rotate, arc)} />
          </div>
        )
      })}
      {note ? <span className="hand__note">{note}</span> : null}
    </div>
  )
}

function rotateStyle(rotate: number, arc: number): CSSProperties {
  return { "--rotate": `${rotate}deg`, "--arc": `${arc}px` } as CSSProperties
}
