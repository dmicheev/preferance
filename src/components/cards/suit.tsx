import type { CSSProperties } from "react"

export type SuitId = "spades" | "hearts" | "diamonds" | "clubs"

export const SUITS: SuitId[] = ["spades", "hearts", "diamonds", "clubs"]

export const SUIT_IS_RED: Record<SuitId, boolean> = {
  spades: false,
  hearts: true,
  diamonds: true,
  clubs: false,
}

export const SUIT_NAMES: Record<SuitId, string> = {
  spades: "пики",
  hearts: "черви",
  diamonds: "бубны",
  clubs: "трефы",
}

type SuitGlyphProps = {
  suit: SuitId
  className?: string
  style?: CSSProperties
  /** Очко в нижней половине карты традиционно перевёрнуто. */
  flip?: boolean
}

export function SuitGlyph({ suit, className, style, flip }: SuitGlyphProps) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "currentColor",
    className,
    style,
    "data-flip": flip ? "true" : undefined,
    "aria-hidden": true as const,
  }

  switch (suit) {
    case "hearts":
      return (
        <svg {...shared}>
          <path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z" />
        </svg>
      )
    case "diamonds":
      return (
        <svg {...shared}>
          <path d="M12 1.6 22.4 12 12 22.4 1.6 12 12 1.6Z" />
        </svg>
      )
    case "spades":
      return (
        <svg {...shared}>
          <path d="M12 1.7c2.9 3.9 8.8 7.2 8.8 11.5a4.35 4.35 0 0 1-7.2 3.35c.2 2.1.95 3.95 2.25 5.55H8.15c1.3-1.6 2.05-3.45 2.25-5.55A4.35 4.35 0 0 1 3.2 13.2C3.2 8.9 9.1 5.6 12 1.7Z" />
        </svg>
      )
    case "clubs":
      return (
        <svg {...shared}>
          <circle cx="12" cy="6.7" r="4.1" />
          <circle cx="5.85" cy="14.6" r="4.1" />
          <circle cx="18.15" cy="14.6" r="4.1" />
          <path d="M10.75 14.2h2.5l1.45 7.9H9.3l1.45-7.9Z" />
        </svg>
      )
  }
}