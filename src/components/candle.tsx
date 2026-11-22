import type { CSSProperties } from "react"

type CandleProps = {
  size?: "sm" | "md" | "lg"
  /** Сдвиг анимации в секундах: свечи не должны мерцать синхронно. */
  delay?: number
  className?: string
}

export function Candle({ size = "md", delay = 0, className }: CandleProps) {
  const classes = [
    "candle",
    size === "sm" ? "candle--sm" : null,
    size === "lg" ? "candle--lg" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div
      className={classes}
      style={{ "--delay": `${delay}s` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="candle__halo" />
      <span className="candle__flame">
        <span className="candle__flame-outer" />
        <span className="candle__flame-inner" />
        <span className="candle__wick" />
      </span>
      <span className="candle__body">
        <span className="candle__wax" />
      </span>
      <span className="candle__holder" />
    </div>
  )
}