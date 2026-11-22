import { toCardModel } from "@/components/cards/card-code"
import { PlayingCard } from "@/components/cards/playing-card"
import type { RoundView } from "@/lib/protocol"
import type { Seat } from "@/lib/preference/round"

export type TrickPosition = "self" | "left" | "right"

type GameBoardProps = {
  round: RoundView
  /** Место за столом → позиция карты на экране относительно зрителя. */
  seatPositions: Record<Seat, TrickPosition>
}

/** Что лежит на сукне: прикуп до разбора и карты текущей взятки. */
export function GameBoard({ round, seatPositions }: GameBoardProps) {
  const prikupVisible = round.phase === "bidding" || round.phase === "declaring"

  return (
    <div className="game-board">
      {prikupVisible ? (
        <div className="prikup" aria-hidden="true">
          <PlayingCard faceDown size="xs" style={{ transform: "rotate(-6deg)" }} />
          <PlayingCard faceDown size="xs" style={{ transform: "rotate(6deg)" }} />
        </div>
      ) : null}

      <div className="trick">
        {round.trick.map((item) => (
          <div
            key={item.card}
            className={`trick__slot trick__slot--${seatPositions[item.seat]}`}
          >
            <PlayingCard card={toCardModel(item.card)} size="sm" />
          </div>
        ))}
      </div>
    </div>
  )
}
