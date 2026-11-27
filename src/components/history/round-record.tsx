// Запись одной раздачи для истории и финального экрана: торговля, прикуп,
// снос, вист, ходы и расчёт. Компоненты чистые — работают и на сервере, и в клиенте.

import { toCardModel } from "@/components/cards/card-code"
import { PlayingCard } from "@/components/cards/playing-card"
import { bidText, contractLabel } from "@/lib/format"
import type { Card } from "@/lib/preference/cards"
import { roundCalculation, tricksLabel } from "@/lib/preference/round-explain"
import type { Seat } from "@/lib/preference/round"
import type { RoundResultView } from "@/lib/protocol"

export type HistoryPlayer = { seat: number; nickname: string }

const seatOrderAfter = (dealer: number): Seat[] => {
  const first = ((dealer + 1) % 3) as Seat
  return [first, ((first + 1) % 3) as Seat, ((first + 2) % 3) as Seat]
}

/** Краткая строка раздачи: «Раздача 3 · шестерная в пиках · Дима взял 8 из 6». */
export function roundSummary(
  result: RoundResultView,
  nicknameOf: (seat: number | null) => string,
): string {
  const parts = [`Раздача ${result.roundNumber}`, contractLabel(result.outcome.contract)]
  if (result.outcome.declarer !== null) {
    const taken = result.outcome.tricks[result.outcome.declarer]
    const need =
      result.outcome.contract.kind === "game" ? result.outcome.contract.level : null
    parts.push(
      `${nicknameOf(result.outcome.declarer)} взял ${taken}${need !== null ? ` из ${need}` : ""}`,
    )
  }
  return parts.join(" · ")
}

function CardsRow({ cards, title }: { cards: Card[]; title: string }) {
  if (cards.length === 0) return null
  return (
    <div className="hist__cell">
      <span className="hist__label">{title}</span>
      <span className="hist__cards">
        {cards.map((card) => (
          <PlayingCard key={card} card={toCardModel(card)} size="sm" />
        ))}
      </span>
    </div>
  )
}

/** Торговля: заявки и пасы по кругу от первой руки. */
function Bidding({ result, players }: { result: RoundResultView; players: HistoryPlayer[] }) {
  const nicknameOf = (seat: number) =>
    players.find((player) => player.seat === seat)?.nickname ?? "—"
  const order = seatOrderAfter(result.dealer)

  return (
    <div className="hist__cell">
      <span className="hist__label">торговля</span>
      <span className="hist__lines">
        {order.map((seat) => {
          const bid = result.bids[seat]
          return (
            <span key={seat} className="hist__line">
              <b>{nicknameOf(seat)}</b>
              {bid === null
                ? " — не говорил"
                : bid === "pass"
                  ? " — пас"
                  : ` — ${bidText(bid)}`}
            </span>
          )
        })}
        <span className="hist__line">
          сдаёт: <b>{nicknameOf(result.dealer)}</b>
        </span>
      </span>
    </div>
  )
}

/** Решения по висту. */
function WhistCalls({ result, players }: { result: RoundResultView; players: HistoryPlayer[] }) {
  if (result.outcome.contract.kind !== "game") return null
  const nicknameOf = (seat: number) =>
    players.find((player) => player.seat === seat)?.nickname ?? "—"
  const defenders = ([0, 1, 2] as Seat[]).filter((seat) => seat !== result.outcome.declarer)
  const asked = defenders.some((seat) => result.whist[seat] !== null)
  if (!asked) return null

  return (
    <div className="hist__cell">
      <span className="hist__label">вист</span>
      <span className="hist__lines">
        {defenders.map((seat) => {
          const call = result.whist[seat]
          return (
            <span key={seat} className="hist__line">
              <b>{nicknameOf(seat)}</b>
              {call === null ? " — не спрашивали" : call ? " — вистую" : " — пас"}
            </span>
          )
        })}
      </span>
    </div>
  )
}

/** Все взятки раздачи: карты по игрокам, победитель подсвечен. */
function Tricks({ result, players }: { result: RoundResultView; players: HistoryPlayer[] }) {
  const nicknameOf = (seat: number) =>
    players.find((player) => player.seat === seat)?.nickname ?? "—"

  return (
    <details className="hist__details">
      <summary>ходы — {tricksLabel(result.trickList.length)}</summary>
      <ol className="hist__tricks">
        {result.trickList.map((trick, index) => (
          <li key={index} className="hist__trick">
            <span className="hist__trick-num">{index + 1}</span>
            {trick.cards.map((item) => (
              <span
                key={`${item.seat}-${item.card}`}
                className="hist__trick-card"
                data-winner={item.seat === trick.winner}
                title={
                  item.fromPrikup
                    ? `заход картой прикупа (${nicknameOf(item.seat)} — сдающий)`
                    : nicknameOf(item.seat)
                }
              >
                <span className="hist__trick-name">
                  {item.fromPrikup ? "прикуп" : nicknameOf(item.seat)}
                </span>
                <PlayingCard card={toCardModel(item.card)} size="sm" />
              </span>
            ))}
            <span className="hist__trick-winner">взял: {nicknameOf(trick.winner)}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}

/** Расчёт раздачи: объяснение цифр и запись по игрокам. */
export function RoundCalculation({
  result,
  players,
}: {
  result: RoundResultView
  players: HistoryPlayer[]
}) {
  const nicknameOf = (seat: number | null) =>
    seat === null ? "—" : (players.find((player) => player.seat === seat)?.nickname ?? "—")
  const lines = roundCalculation(result, (seat) => nicknameOf(seat))

  return (
    <div className="hist__calc">
      <span className="hist__label">расчёт</span>
      <ul className="hist__lines">
        {lines.map((line, index) => (
          <li key={index} className="hist__line">
            {line}
          </li>
        ))}
      </ul>
      <ul className="hist__deltas">
        {players.map((player) => {
          const delta = result.deltas[player.seat]
          if (!delta) return null
          const parts = [
            delta.pool > 0 ? `+${delta.pool} в пулю` : null,
            delta.mountain > 0 ? `+${delta.mountain} на гору` : null,
            delta.whists > 0 ? `+${delta.whists} вистов` : null,
          ].filter(Boolean)
          return (
            <li key={player.seat}>
              <b>{player.nickname}</b>
              <span>{parts.length > 0 ? parts.join(" · ") : "без изменений"}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Полная карточка раздачи для страницы истории. */
export function RoundRecord({
  result,
  players,
}: {
  result: RoundResultView
  players: HistoryPlayer[]
}) {
  const nicknameOf = (seat: number | null) =>
    seat === null ? "—" : (players.find((player) => player.seat === seat)?.nickname ?? "—")

  return (
    <section className="hist__round">
      <h4 className="hist__round-title">{roundSummary(result, nicknameOf)}</h4>
      <div className="hist__facts">
        <Bidding result={result} players={players} />
        <CardsRow cards={result.prikup} title="прикуп" />
        <CardsRow cards={result.discard} title="снос" />
        <WhistCalls result={result} players={players} />
      </div>
      <Tricks result={result} players={players} />
      <RoundCalculation result={result} players={players} />
    </section>
  )
}
