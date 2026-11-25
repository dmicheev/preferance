"use client"

import { useEffect, useRef, useState } from "react"

import { bidText, contractLabel } from "@/lib/format"
import {
  MAX_LEVEL,
  MIN_LEVEL,
  PLAYER_COUNT,
} from "@/lib/preference/constants"
import { TRUMPS, type Trump } from "@/lib/preference/cards"

/** В торговле заказывают масти и без козыря — полный ряд заказа. */
const BID_TRUMPS = TRUMPS
import { bidStrength, otherSeats, soloWhistController, type Seat } from "@/lib/preference/round"
import type { GameSnapshot, RoundResultView } from "@/lib/protocol"

type GameActionsProps = {
  snapshot: GameSnapshot
  /** Выбранные для сноса карты — общее состояние экрана стола. */
  discardPick: string[]
  /** Итог последней записанной раздачи. */
  lastResult: RoundResultView | null
  onBid: (level: number, trump: Trump) => void
  onMisere: () => void
  onPass: () => void
  onPrikupAck: () => void
  onTrickAck: () => void
  onDeclare: (
    contract: "game" | "misere",
    discard: string[],
    raise?: { level: number; trump: Trump },
  ) => void
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
  onMisere,
  onPass,
  onPrikupAck,
  onTrickAck,
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
  const round = snapshot.round
  const floor =
    round?.phase === "bidding" && round.highest
      ? bidStrength(round.highest.bid)
      : 0

  // Чужая ставка перекрыла выбранный заказ — показываем минимально допустимую
  // комбинацию: рамка не указывает на масть, которую сейчас не заказать,
  // а «Заказать» не висит неактивным. Сырое состояние меняют только клики.
  const rawBid = { level: bidLevel, trump: bidTrump }
  const selectedBid =
    bidStrength(rawBid) > floor ? rawBid : smallestBidAbove(floor)

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
    const highestOffer = round.highest
    const highestBid = highestOffer?.bid ?? null
    // Мизер заявляют, когда заказов ещё не было или самый старший — шестёрка.
    const misereAllowed =
      highestBid === null ||
      (!("kind" in highestBid) && highestBid.level === MIN_LEVEL)
    const misereHint = !misereAllowed
      ? highestBid && "kind" in highestBid
        ? "мизер уже заявлен"
        : "мизер нельзя поверх заказа выше шестёрки"
      : "играешь без прикупа и сноса — ни одной взятки"

    return (
      <div className="actions">
        <p className="actions__status">
          {myTurn
            ? "слово за тобой — закажи игру, мизер или пас"
            : `торговля: слово за ${nicknameOf(round.turn)}`}
        </p>
        {highestOffer && highestBid ? (
          <p className="actions__hint">
            {nicknameOf(highestOffer.seat)} заказал {bidText(highestBid)}
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
                  data-active={selectedBid?.level === level}
                  disabled={level * 10 + 4 <= floor}
                  onClick={() => setBidLevel(level)}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="actions__row" role="group" aria-label="Масть заказа">
              {BID_TRUMPS.map((trump) => (
                <button
                  key={trump}
                  type="button"
                  className="action-chip"
                  data-active={selectedBid?.trump === trump}
                  disabled={
                    (selectedBid?.level ?? MIN_LEVEL) * 10 +
                      TRUMP_OFFSET[trump] <=
                    floor
                  }
                  onClick={() => setBidTrump(trump)}
                >
                  {SUIT_SHORT[trump]}
                </button>
              ))}
            </div>
            <div className="actions__row">
              <button
                className="button"
                type="button"
                disabled={selectedBid === null}
                onClick={() => {
                  if (selectedBid) onBid(selectedBid.level, selectedBid.trump)
                }}
              >
                Заказать {selectedBid?.level ?? "—"}{" "}
                {selectedBid ? SUIT_SHORT[selectedBid.trump] : ""}
              </button>
              <button
                className="button"
                type="button"
                disabled={!misereAllowed}
                title={misereAllowed ? misereHint : undefined}
                onClick={onMisere}
              >
                Мизер
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

  // ---------- прикуп: все смотрят, потом снос ----------

  if (round.phase === "declaring") {
    const isMine = snapshot.mySeat === round.declarer
    // В прикуп попадает только игровой заказ: мизер из торговли играется без прикупа.
    const gameBid =
      round.highest && !("kind" in round.highest.bid) ? round.highest.bid : null
    const acked = round.prikupAck.length
    const allSaw = acked >= PLAYER_COUNT
    const iSaw = snapshot.mySeat !== null && round.prikupAck.includes(snapshot.mySeat)

    // Прикуп открыт и ждёт Ок от всех троих — снос пока закрыт.
    if (!allSaw) {
      return (
        <div className="actions">
          <p className="actions__status">прикуп открыт — все смотрят</p>
          {round.highest ? (
            <p className="actions__hint">
              заказ: {bidText(round.highest.bid)}
            </p>
          ) : null}
          <p className="actions__hint">
            «Ок» нажали {acked} из {PLAYER_COUNT}
          </p>
          {snapshot.mySeat !== null && !iSaw ? (
            <div className="actions__row">
              <AutoButton
                className="button"
                label="Ок, посмотрел"
                onFire={onPrikupAck}
              />
            </div>
          ) : (
            <p className="actions__hint">ждём остальных…</p>
          )}
        </div>
      )
    }

    return (
      <div className="actions">
        <p className="actions__status">
          {isMine
            ? gameBid
              ? "прикуп твой — оставь заказ или подними игру"
              : "мизер заявлен — выбери две карты на снос"
            : `${nicknameOf(round.declarer)} разбирает прикуп`}
        </p>
        {round.highest ? (
          <p className="actions__hint">
            заказ: {bidText(round.highest.bid)}
            {gameBid
              ? " — играть не ниже заказанного, можно поднять"
              : " — мизер менять нельзя"}
          </p>
        ) : null}
        {isMine ? (
          <>
            <p className="actions__hint">
              выбрано {discardPick.length} из 2
            </p>
            {gameBid ? (() => {
              // Пол подъёма — заказанная игра: выбор ниже неё недоступен,
              // сырой выбор ниже пола показывается как «играть заказанное».
              const floor = bidStrength(gameBid)
              const rawBid = { level: bidLevel, trump: bidTrump }
              const selectedBid =
                bidStrength(rawBid) > floor ? rawBid : gameBid
              const raise =
                bidStrength(selectedBid) > floor ? selectedBid : undefined
              return (
                <>
                  <div
                    className="actions__row"
                    role="group"
                    aria-label="Уровень игры"
                  >
                    {levels(MIN_LEVEL, MAX_LEVEL).map((level) => (
                      <button
                        key={level}
                        type="button"
                        className="action-chip"
                        data-active={selectedBid.level === level}
                        disabled={level * 10 + 4 < floor}
                        onClick={() => setBidLevel(level)}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                  <div
                    className="actions__row"
                    role="group"
                    aria-label="Масть игры"
                  >
                    {BID_TRUMPS.map((trump) => (
                      <button
                        key={trump}
                        type="button"
                        className="action-chip"
                        data-active={selectedBid.trump === trump}
                        disabled={
                          selectedBid.level * 10 + TRUMP_OFFSET[trump] < floor
                        }
                        onClick={() => setBidTrump(trump)}
                      >
                        {SUIT_SHORT[trump]}
                      </button>
                    ))}
                  </div>
                  <div className="actions__row">
                    <button
                      className="button"
                      type="button"
                      disabled={discardPick.length !== 2}
                      onClick={() => onDeclare("game", discardPick, raise)}
                    >
                      Играть {selectedBid.level}{" "}
                      {SUIT_SHORT[selectedBid.trump]}
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={gameBid.level !== MIN_LEVEL}
                      title={
                        gameBid.level === MIN_LEVEL
                          ? "вместо шестёрки можно сыграть мизер"
                          : "мизером заменяют только заказанную шестёрку"
                      }
                      onClick={() => onDeclare("misere", discardPick)}
                    >
                      Мизер
                    </button>
                  </div>
                </>
              )
            })() : (
              <div className="actions__row">
                <button
                  className="button"
                  type="button"
                  disabled={discardPick.length !== 2}
                  onClick={() => onDeclare("misere", discardPick)}
                >
                  Мизер
                </button>
              </div>
            )}
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

  // Одиночный вист: вистующий ходит за себя и за пасующего.
  const partnerSeat = snapshot.partnerSeat
  const partnerTurn =
    round.phase === "play" && partnerSeat !== null && round.turn === partnerSeat
  const controller = soloWhistController(round)
  const iAmPasser =
    snapshot.mySeat !== null &&
    controller !== null &&
    round.declarer !== snapshot.mySeat &&
    controller !== snapshot.mySeat

  // Взятка сошлась: карты на сукне, каждый жмёт Ок — без панели, только кнопка.
  // Пока жду остальных, док не рисую вовсе: стол остаётся чистым.
  if (
    round.phase === "play" &&
    round.trick.length === 0 &&
    round.lastTrick &&
    round.trickAck.length < PLAYER_COUNT
  ) {
    const iSaw = snapshot.mySeat !== null && round.trickAck.includes(snapshot.mySeat)
    if (snapshot.mySeat === null || iSaw) return null
    return (
      <div className="actions actions--thin">
        <AutoButton className="button" label="Ок" onFire={onTrickAck} />
      </div>
    )
  }

  return (
    <div className="actions actions--play">
      <p className="actions__status">
        {partnerTurn
          ? "твой ход за пасующего — выбери карту"
          : iAmPasser && controller !== null
            ? `ходит ${nicknameOf(controller)} — за себя и за тебя`
            : myTurn
              ? "твой ход — выбери карту"
              : `ходит ${nicknameOf(round.turn)}`}
        {contract ? (
          <>
            {" · "}
            {contractLabel(contract)}
            {contract.kind === "game"
              ? ` · взято ${round.tricks[round.declarer ?? 0]}/${contract.level}`
              : contract.kind === "misere"
                ? ` · взято ${round.tricks[round.declarer ?? 0]}`
                : ""}
          </>
        ) : null}
      </p>
      {partnerSeat !== null || iAmPasser ? (
        <p className="actions__hint">
          {partnerSeat !== null
            ? "одиночный вист: играешь в открытую — ходишь за себя и за пасующего"
            : "одиночный вист: твой рукой ходит вистующий"}
        </p>
      ) : null}
    </div>
  )
}

/** Вистуешь ли... нет — сколько вистов: «1 вист, 2 виста, 5 вистов». */
function whistsLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} вист`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} виста`
  }
  return `${count} вистов`
}

/**
 * Кнопка «посмотрел» с авто-нажатием: висит 5 секунд с отсчётом и жмётся сама.
 * Чистое подтверждение просмотра (прикуп, взятка) — ждать дольше незачем.
 */
function AutoButton({
  label,
  className,
  seconds = 5,
  onFire,
}: {
  label: string
  className?: string
  seconds?: number
  onFire: () => void
}) {
  const [left, setLeft] = useState(seconds)
  const firedRef = useRef(false)
  // Колбэк обновляется каждый рендер (снапшоты приходят часто),
  // поэтому таймер зовёт кнопку через ref, а не через замыкание.
  const fireRef = useRef(onFire)
  useEffect(() => {
    fireRef.current = onFire
  })

  useEffect(() => {
    const timer = setInterval(() => {
      setLeft((value) => Math.max(0, value - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (left === 0 && !firedRef.current) {
      firedRef.current = true
      fireRef.current()
    }
  }, [left])

  return (
    <button
      className={className}
      type="button"
      title={`нажмётся само через ${left} с`}
      onClick={() => {
        firedRef.current = true
        onFire()
      }}
    >
      {label} · {left}
    </button>
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
      {/* Запись играющего: в пулю при сыгранной игре, на гору при подсаде. */}
      {result.outcome.declarer !== null ? (
        (() => {
          const entry = result.deltas[result.outcome.declarer]
          if (!entry) return null
          if (entry.pool > 0) {
            return (
              <p className="actions__hint">
                играющему +{entry.pool} в пулю
              </p>
            )
          }
          if (entry.mountain > 0) {
            return (
              <p className="actions__hint">
                играющий +{entry.mountain} на гору
              </p>
            )
          }
          return null
        })()
      ) : null}
      {result.outcome.contract.kind === "game" && result.outcome.whisters.length > 0 ? (
        <p className="actions__hint">
          вистовали:{" "}
          {result.outcome.whisters
            .map((seat) => {
              const whists = result.deltas[seat]?.whists ?? 0
              // Одиночный вист: вистовый играл за двоих — показываем взятки с обеих рук.
              let won = result.outcome.tricks[seat]
              if (result.outcome.whisters.length === 1 && result.outcome.declarer !== null) {
                const passer = otherSeats(result.outcome.declarer).find(
                  (item) => item !== seat,
                )
                if (passer !== undefined) won += result.outcome.tricks[passer]
              }
              return `${nicknameOf(seat)} — ${won} (${whists > 0 ? `+${whistsLabel(whists)}` : "без вистов"})`
            })
            .join(" · ")}
        </p>
      ) : null}
      <ul className="actions__deltas">
        {snapshot.players.map((player) => {
          const delta = result.deltas[player.seat]
          if (!delta) return null
          const parts = [
            delta.pool > 0 ? `+${delta.pool} в пулю` : null,
            delta.mountain > 0 ? `+${delta.mountain} на гору` : null,
            delta.whists > 0 ? `+${whistsLabel(delta.whists)}` : null,
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

/** Минимально допустимый заказ выше пола — по той же лестнице 6♠…10БК. */
function smallestBidAbove(
  floor: number,
): { level: number; trump: Trump } | null {
  for (const level of levels(MIN_LEVEL, MAX_LEVEL)) {
    for (const trump of BID_TRUMPS) {
      if (level * 10 + TRUMP_OFFSET[trump] > floor) {
        return { level, trump }
      }
    }
  }
  return null
}

const TRUMP_OFFSET: Record<Trump, number> = {
  S: 0,
  C: 1,
  D: 2,
  H: 3,
  NT: 4,
}

const SUIT_SHORT: Record<Trump, string> = {
  S: "♠",
  C: "♣",
  D: "♦",
  H: "♥",
  NT: "бк",
}
