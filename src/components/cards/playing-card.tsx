import type { CSSProperties } from "react"

import { SUIT_IS_RED, SUIT_NAMES, SuitGlyph, type SuitId } from "./suit"

export type Rank = "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A"
export type CardModel = { rank: Rank; suit: SuitId }

type Pip = { x: number; y: number }

// Классические раскладки «мастей» на карте: проценты внутри области очков.
const PIP_LAYOUTS: Partial<Record<string, Pip[]>> = {
  "2": [
    { x: 50, y: 8 },
    { x: 50, y: 92 },
  ],
  "3": [
    { x: 50, y: 8 },
    { x: 50, y: 50 },
    { x: 50, y: 92 },
  ],
  "4": [
    { x: 30, y: 8 },
    { x: 70, y: 8 },
    { x: 30, y: 92 },
    { x: 70, y: 92 },
  ],
  "5": [
    { x: 30, y: 8 },
    { x: 70, y: 8 },
    { x: 50, y: 50 },
    { x: 30, y: 92 },
    { x: 70, y: 92 },
  ],
  "6": [
    { x: 30, y: 8 },
    { x: 70, y: 8 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 30, y: 92 },
    { x: 70, y: 92 },
  ],
  "7": [
    { x: 30, y: 8 },
    { x: 70, y: 8 },
    { x: 50, y: 30 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 30, y: 92 },
    { x: 70, y: 92 },
  ],
  "8": [
    { x: 30, y: 8 },
    { x: 70, y: 8 },
    { x: 50, y: 30 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 50, y: 70 },
    { x: 30, y: 92 },
    { x: 70, y: 92 },
  ],
  "9": [
    { x: 30, y: 8 },
    { x: 70, y: 8 },
    { x: 30, y: 36 },
    { x: 70, y: 36 },
    { x: 50, y: 50 },
    { x: 30, y: 64 },
    { x: 70, y: 64 },
    { x: 30, y: 92 },
    { x: 70, y: 92 },
  ],
  "10": [
    { x: 30, y: 8 },
    { x: 70, y: 8 },
    { x: 30, y: 29 },
    { x: 70, y: 29 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 30, y: 71 },
    { x: 70, y: 71 },
    { x: 30, y: 92 },
    { x: 70, y: 92 },
  ],
}

const COURT_RANKS: Rank[] = ["J", "Q", "K"]

type PlayingCardProps = {
  /** Не нужна для рубашки. */
  card?: CardModel
  size?: "xs" | "sm" | "md"
  faceDown?: boolean
  className?: string
  style?: CSSProperties
}

export function PlayingCard({
  card,
  size = "md",
  faceDown = false,
  className,
  style,
}: PlayingCardProps) {
  const classes = [
    "card",
    size === "sm" ? "card--sm" : null,
    size === "xs" ? "card--xs" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ")

  if (faceDown || !card) {
    return (
      <div className={classes} style={style} aria-hidden="true">
        <div className="card__back" />
      </div>
    )
  }

  const isRed = SUIT_IS_RED[card.suit]
  const isCourt = COURT_RANKS.includes(card.rank)
  const pips = PIP_LAYOUTS[card.rank]

  return (
    <div
      className={classes}
      data-red={isRed}
      style={style}
      role="img"
      aria-label={`${card.rank} ${SUIT_NAMES[card.suit]}`}
    >
      <div className="card__face">
        <span className="card__corner card__corner--tl">
          <span className="card__rank">{card.rank}</span>
          <SuitGlyph suit={card.suit} className="card__suit" />
        </span>

        {isCourt ? (
          <div className="card__court">
            <span className="card__court-glyph">
              <span className="card__court-rank">{card.rank}</span>
              <SuitGlyph suit={card.suit} className="card__court-suit" />
            </span>
          </div>
        ) : (
          <div className="card__pips">
            {card.rank === "A" ? (
              <SuitGlyph
                suit={card.suit}
                className="card__pip card__pip--ace"
                style={{ left: "50%", top: "50%" }}
              />
            ) : (
              (pips ?? []).map((pip, index) => (
                <SuitGlyph
                  key={`${pip.x}-${pip.y}-${index}`}
                  suit={card.suit}
                  className="card__pip"
                  style={{ left: `${pip.x}%`, top: `${pip.y}%` }}
                  flip={pip.y > 50}
                />
              ))
            )}
          </div>
        )}

        <span className="card__corner card__corner--br">
          <span className="card__rank">{card.rank}</span>
          <SuitGlyph suit={card.suit} className="card__suit" />
        </span>
      </div>
    </div>
  )
}