import { toCardModel } from "@/components/cards/card-code"
import { PlayingCard } from "@/components/cards/playing-card"
import { PLAYER_COUNT } from "@/lib/preference/constants"
import type { RoundView } from "@/lib/protocol"
import type { Seat } from "@/lib/preference/round"

export type TrickPosition = "self" | "left" | "right"

type GameBoardProps = {
  round: RoundView
  /** Место за столом → позиция карты на экране относительно зрителя. */
  seatPositions: Record<Seat, TrickPosition>
}

/** Что лежит на сукне: прикуп, карты текущей взятки и собранная взятка до Ок. */
export function GameBoard({ round, seatPositions }: GameBoardProps) {
  const prikupVisible = round.phase === "bidding" || round.phase === "declaring"
  const prikupOpen = round.prikupOpen ?? []
  // Собранная взятка видна только пока её смотрят (не все нажали Ок);
  // после последнего Ок сукно чистое, и победитель ходит на пустой стол.
  const shownTrick =
    round.trick.length > 0
      ? round.trick
      : round.phase === "play" &&
          round.lastTrick &&
          round.trickAck.length < PLAYER_COUNT
        ? round.lastTrick.cards
        : []
  // На распасах взятку заходит карта прикупа: она видна в зоне прикупа,
  // в слотах игроков лежат только их карты.
  const prikupLead = prikupVisible
    ? null
    : (shownTrick.find((item) => item.fromPrikup) ?? null)
  const playedTrick = prikupLead
    ? shownTrick.filter((item) => !item.fromPrikup)
    : shownTrick

  return (
    <div className="game-board">
      {prikupLead ? (
        <div className="prikup" title="Заход картой прикупа">
          <PlayingCard
            card={toCardModel(prikupLead.card)}
            size="sm"
            style={{ transform: "rotate(-6deg)" }}
          />
        </div>
      ) : null}
      {prikupVisible ? (
        <div className="prikup" aria-hidden="true">
          {prikupOpen.length > 0
            ? prikupOpen.map((card, index) => (
                <PlayingCard
                  key={card}
                  card={toCardModel(card)}
                  size="sm"
                  style={{
                    transform: index % 2 === 0 ? "rotate(-6deg)" : "rotate(6deg)",
                  }}
                />
              ))
            : (
                <>
                  <PlayingCard faceDown size="sm" style={{ transform: "rotate(-6deg)" }} />
                  <PlayingCard faceDown size="sm" style={{ transform: "rotate(6deg)" }} />
                </>
              )}
        </div>
      ) : null}

      <div className="trick">
        {playedTrick.map((item) => (
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
