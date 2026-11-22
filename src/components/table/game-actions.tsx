"use client"

import { useState } from "react"

import { contractLabel } from "@/lib/format"
import {
  MAX_LEVEL,
  MIN_LEVEL,
  PLAYER_COUNT,
} from "@/lib/preference/constants"
import { TRUMP_LABEL, TRUMPS, type Trump } from "@/lib/preference/cards"
import { bidStrength, type Seat } from "@/lib/preference/round"
import type { GameSnapshot, RoundResultView } from "@/lib/protocol"

type GameActionsProps = {
  snapshot: GameSnapshot
  /** Выбранные для сноса карты — общее состояние экрана стола. */
  discardPick: string[]
  /** Итог последней записанной раздачи. */
  lastResult: RoundResultView | null
  onBid: (level: number, trump: Trump) => void
  onPass: () => void
  onDeclare: (contract: "game" | "misere", discard: string[]) => void
  onWhist: (whist: boolean) => void
  onReady: () => void
  onStart: () => void
}

/** Док над рукой: статус раздачи и кнопки текущей фазы. */
export function GameActions({
  snapshot,
  discardPick,
  lastResult,
  onBid,
  onPass,
  onDeclare,
  onWhist,
  onReady,
  onStart,
}: GameActionsProps) {
  const [bidLevel, setBidLevel] = useState<number>(MIN_LEVEL)
  const [bidTrump, setBidTrump] = useState<Trump>("S")

  const me = snapshot.players.find((player) => player.seat === snapshot.mySeat)
  const nicknameOf = (seat: Seat | null) =>
    snapshot.players.find((player) => player.seat === seat)?.nickname ?? "—"
  const myTurn = snapshot.round?.turn === snapshot.mySeat

  // ---------- лобби: партию начинает хозяин ----------

  if (snapshot.status === "LOBBY") {
    const seated = snapshot.players.length
    const host = snapshot.players.find((player) => player.isHost)
    const isHost = me?.isHost ?? false

    return (
      <div className="actions">
        <p className="actions__status">
          {host ? `хозяин стола — ${host.nickname}` : "ждём игроков"}
          {" · "}
          за столом {seated} из {PLAYER_COUNT}
        </p>
        {isHost ? (
          <button
            className="button"
            type="button"
            disabled={seated < PLAYER_COUNT}
            onClick={onStart}
          >
            {seated < PLAYER_COUNT
              ? `ждём ещё ${PLAYER_COUNT - seated}`
              : "Начать партию"}
          </button>
        ) : (
          <p className="actions__hint">
            {isHost ? "" : "партию начнёт хозяин стола, когда соберутся все трое"}
          </p>
        )}
      </div>
    )
  }

  const round = snapshot.round
  if (!round) return null

  // ---------- раздача записана: итоги и готовность ----------

  if (round.phase === "scored") {
    return (
      <div className="actions actions--result">
        <p className="actions__status">
          {snapshot.roundsLimit !== null &&
          snapshot.roundsPlayed >= snapshot.roundsLimit
            ? `лимит раздач выбран: ${snapshot.roundsPlayed} из ${snapshot.roundsLimit}`
            : "раздача записана"}
        </p>
        <ResultSummary snapshot={snapshot} result={lastResult} />
        {snapshot.mySeat !== null ? (
          <button className="button" type="button" onClick={onReady}>
            {snapshot.readyUserIds.length >= PLAYER_COUNT
              ? "сдаём…"
              : `Готов · ${snapshot.readyUserIds.length}/${PLAYER_COUNT}`}
          </button>
        ) : (
          <p className="actions__hint">
            ждём готовности игроков ({snapshot.readyUserIds.length}/
            {PLAYER_COUNT})
          </p>
        )}
      </div>
    )
  }

  // ---------- торговля ----------

  if (round.phase === "bidding") {
    const floor = round.highest ? bidStrength(round.highest.bid) : 0
    const chosen = bidStrength({ level: bidLevel, trump: bidTrump })

    return (
      <div className="actions">
        <p className="actions__status">
          {myTurn
            ? "слово за тобой — закажи игру или пас"
            : `торговля: слово за ${nicknameOf(round.turn)}`}
        </p>
        {round.highest ? (
          <p className="actions__hint">
            {nicknameOf(round.highest.seat)} заказал {round.highest.bid.level}{" "}
            {TRUMP_LABEL[round.highest.bid.trump]}
          </p>
        ) : (
          <p className="actions__hint">заказов ещё не было</p>
        )}

        {myTurn ? (
          <>
            <div className="actions__row" role="group" aria-label="Уровень заказа">
              {levels(MIN_LEVEL, MAX_LEVEL).map((level) => (
                <button
                  key={level}
                  type="button"
                  className="action-chip"
                  data-active={bidLevel === level}
                  disabled={level * 10 + 4 <= floor}
                  onClick={() => setBidLevel(level)}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="actions__row" role="group" aria-label="Масть заказа">
              {TRUMPS.map((trump) => (
                <button
                  key={trump}
                  type="button"
                  className="action-chip"
                  data-active={bidTrump === trump}
                  disabled={bidLevel * 10 + TRUMP_OFFSET[trump] <= floor}
                  onClick={() => setBidTrump(trump)}
                >
                  {trump === "NT" ? "БК" : SUIT_SHORT[trump]}
                </button>
              ))}
            </div>
            <div className="actions__row">
              <button
                className="button"
                type="button"
                disabled={chosen <= floor}
                onClick={() => onBid(bidLevel, bidTrump)}
              >
                Заказать {bidLevel}
                {bidTrump === "NT" ? " БК" : ` ${SUIT_SHORT[bidTrump]}`}
              </button>
              <button className="button button--ghost" type="button" onClick={onPass}>
                Пас
              </button>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  // ---------- прикуп и снос ----------

  if (round.phase === "declaring") {
    const isMine = snapshot.mySeat === round.declarer
    return (
      <div className="actions">
        <p className="actions__status">
          {isMine
            ? "прикуп твой — выбери две карты на снос"
            : `${nicknameOf(round.declarer)} разбирает прикуп`}
        </p>
        {round.highest ? (
          <p className="actions__hint">
            заказ: {round.highest.bid.level} {TRUMP_LABEL[round.highest.bid.trump]}
          </p>
        ) : null}
        {isMine ? (
          <>
            <p className="actions__hint">
              выбрано {discardPick.length} из 2
            </p>
            <div className="actions__row">
              <button
                className="button"
                type="button"
                disabled={discardPick.length !== 2}
                onClick={() => onDeclare("game", discardPick)}
              >
                Играть {round.highest?.bid.level}
              </button>
              <button
                className="button button--ghost"
                type="button"
                disabled={discardPick.length !== 2}
                onClick={() => onDeclare("misere", discardPick)}
              >
                Мизер
              </button>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  // ---------- вист ----------

  if (round.phase === "whist") {
    return (
      <div className="actions">
        <p className="actions__status">
          {myTurn
            ? "вистовать?"
            : `решение за ${nicknameOf(round.turn)}`}
        </p>
        <p className="actions__hint">
          {nicknameOf(round.declarer)} играет{" "}
          {round.contract ? contractLabel(round.contract) : ""}
        </p>
        {myTurn ? (
          <div className="actions__row">
            <button
              className="button"
              type="button"
              onClick={() => onWhist(true)}
            >
              Вистую
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onWhist(false)}
            >
              Пас
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  // ---------- взятки ----------

  const contract = round.contract
  return (
    <div className="actions">
      <p className="actions__status">
        {myTurn
          ? "твой ход — выбери карту"
          : `ходит ${nicknameOf(round.turn)}`}
      </p>
      {contract ? (
        <p className="actions__hint">
          {contractLabel(contract)} · играющий {nicknameOf(round.declarer)}
          {contract.kind === "game"
            ? ` · взято ${round.tricks[round.declarer ?? 0]}/${contract.level}`
            : ""}
        </p>
      ) : null}
    </div>
  )
}

/** Краткий итог раздачи: контракт, взятки и что ушло в таблицу. */
function ResultSummary({
  snapshot,
  result,
}: {
  snapshot: GameSnapshot
  result: RoundResultView | null
}) {
  const nicknameOf = (seat: number | null) =>
    snapshot.players.find((player) => player.seat === seat)?.nickname ?? "—"

  if (!result) {
    return <p className="actions__hint">считаем взятки…</p>
  }

  return (
    <div className="actions__summary">
      <p className="actions__hint">
        раздача №{result.roundNumber} ·{" "}
        {contractLabel(result.outcome.contract)}
        {result.outcome.declarer !== null
          ? ` · играющий ${nicknameOf(result.outcome.declarer)} взял ${result.outcome.tricks[result.outcome.declarer]}`
          : ""}
      </p>
      <ul className="actions__deltas">
        {snapshot.players.map((player) => {
          const delta = result.deltas[player.seat]
          if (!delta) return null
          const parts = [
            delta.pool > 0 ? `+${delta.pool} в пулю` : null,
            delta.mountain > 0 ? `+${delta.mountain} на гору` : null,
            delta.whists > 0 ? `+${delta.whists} висты` : null,
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

function levels(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}

const TRUMP_OFFSET: Record<Trump, number> = {
  S: 0,
  C: 1,
  D: 2,
  H: 3,
  NT: 4,
}

const SUIT_SHORT: Record<Exclude<Trump, "NT">, string> = {
  S: "♠",
  C: "♣",
  D: "♦",
  H: "♥",
}
