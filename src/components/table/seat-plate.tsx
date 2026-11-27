"use client"

import { useState } from "react"

import { toCardModel } from "@/components/cards/card-code"
import { PlayingCard } from "@/components/cards/playing-card"
import type { Card } from "@/lib/preference/cards"
import { deckStyle } from "@/lib/format"

export type SeatPosition = "self" | "left" | "right" | "dummy"

const BOT_LEVEL_LABEL: Record<string, string> = {
  NOVICE: "новичок",
  PLAYER: "игрок",
  MASTER: "мастер",
}

/** «1 взятка / 2 взятки / 5 взяток» — по правилам русского множественного. */
function tricksLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} взятка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} взятки`
  }
  return `${count} взяток`
}

export type SeatPlateProps = {
  position: SeatPosition
  nickname: string | null
  role: string
  /** Онлайн-статус места: undefined — не показывать, null — «подключаем…». */
  online?: boolean | null
  isMe?: boolean
  /** Сколько рубашек карт нарисовать у места. */
  backs?: number
  /** Открытые карты места (мизер, одиночный вист): вместо рубашек — лицом вверх. */
  openCards?: Card[] | null
  /** Клик по открытой карте: только для чужой руки, которой я веду (одиночный вист). */
  onOpenCardClick?: (card: Card) => void
  /** Взяток на руках в этой раздаче: undefined — не показывать. */
  tricks?: number
  /** Место принадлежит боту. */
  isBot?: boolean
  /** Уровень бота. */
  botLevel?: string | null
  /** Хозяин ли текущий пользователь (для кнопки посадки бота). */
  isHost?: boolean
  /** Стол ещё в лобби: можно сажать и убирать ботов. */
  canEdit?: boolean
  /** Посадить бота на это место. */
  onBotSeat?: (seat: number, level: string) => void
  /** Убрать бота с этого места. */
  onBotRemove?: (seat: number) => void
  /** Номер места (0–2). */
  seat?: number
  /** Реплика над табличкой: заказ игры или пас. */
  balloon?: { text: string; tone: "bid" | "pass" } | null
  /** Статус в раздаче: игра / вист / пас — висит до записи раздачи. */
  playState?: { text: string; tone: "game" | "whist" | "pass" } | null
}

/** Открытую руку соперника раскладываем рядами по столько карт — в размер с сукном. */
const OPEN_CARDS_PER_ROW = 5

export function SeatPlate({
  position,
  nickname,
  role,
  online,
  isMe = false,
  backs = 0,
  openCards = null,
  onOpenCardClick,
  tricks,
  isBot = false,
  botLevel = null,
  isHost = false,
  canEdit = false,
  onBotSeat,
  onBotRemove,
  seat = -1,
  balloon = null,
  playState = null,
}: SeatPlateProps) {
  const empty = nickname === null
  const initial = nickname ? Array.from(nickname)[0]?.toUpperCase() : "·"
  const [botLevelSelect, setBotLevelSelect] = useState<"NOVICE" | "PLAYER" | "MASTER">(
    "PLAYER",
  )

  let presence: string | null = "ждём игрока"
  if (!empty) {
    if (isBot) {
      // Бот всегда «за столом»: онлайн-статус сокета к нему не относится.
      presence = "компьютер · играет"
    } else if (online === undefined) presence = null
    else if (online === null) presence = "подключаем…"
    else if (online) presence = "за столом"
    else presence = "не в сети"
  }

  const isEmptyBotSeat = empty && isHost && canEdit && position !== "dummy" && onBotSeat

  return (
    <div
      className={`seat seat--${position}${isBot ? " seat--bot" : ""}`}
      data-me={isMe}
      data-empty={empty}
    >
      {openCards && openCards.length > 0 ? (
        <div className="seat__hand" aria-hidden={!onOpenCardClick}>
          {Array.from(
            { length: Math.ceil(openCards.length / OPEN_CARDS_PER_ROW) },
            (_, row) => (
              <div className="seat__hand-row" key={row}>
                {openCards
                  .slice(row * OPEN_CARDS_PER_ROW, (row + 1) * OPEN_CARDS_PER_ROW)
                  .map((card, index) => {
                    const rowCards = Math.min(
                      OPEN_CARDS_PER_ROW,
                      openCards.length - row * OPEN_CARDS_PER_ROW,
                    )
                    const offset = index - (rowCards - 1) / 2
                    const face = (
                      <PlayingCard
                        card={toCardModel(card)}
                        size="sm"
                        style={deckStyle(offset * 8, Math.abs(offset) * 1.2)}
                      />
                    )
                    return onOpenCardClick ? (
                      <button
                        key={card}
                        type="button"
                        className="seat__open-card"
                        title="ход картой пасующего"
                        onClick={() => onOpenCardClick(card)}
                      >
                        {face}
                      </button>
                    ) : (
                      <div key={card} className="seat__open-card">
                        {face}
                      </div>
                    )
                  })}
              </div>
            ),
          )}
        </div>
      ) : backs > 0 ? (
        <div className="seat__backs" aria-hidden="true">
          {Array.from({ length: backs }, (_, index) => {
            const offset = index - (backs - 1) / 2
            return (
              <PlayingCard
                key={index}
                faceDown
                size="xs"
                style={deckStyle(offset * 7, Math.abs(offset) * 1.4)}
              />
            )
          })}
        </div>
      ) : null}

      <div className="seat__plate">
        {balloon ? (
          <div className="seat__balloon" data-tone={balloon.tone} role="status" key={balloon.text}>
            {balloon.text}
          </div>
        ) : null}
        <span className="seat__avatar">{initial}</span>
        <span className="seat__name">
          {isBot ? "💻 " : ""}{nickname ?? "свободное место"}
        </span>
        <span className="seat__role">{role}</span>
        {playState ? (
          <span
            className="seat__badge seat__badge--state"
            data-tone={playState.tone}
            title="статус в раздаче"
          >
            {playState.text}
          </span>
        ) : null}
        {tricks !== undefined ? (
          <span
            className="seat__badge seat__badge--tricks"
            title="взятки в этой раздаче"
          >
            {tricksLabel(tricks)}
          </span>
        ) : null}
        {isBot && botLevel ? (
          <span className="seat__badge seat__badge--bot">
            компьютер · {BOT_LEVEL_LABEL[botLevel] ?? botLevel}
          </span>
        ) : null}
        {presence === null ? null : (
          <span className="seat__status">
            <span className="seat__dot" data-online={isBot || online === true} />
            {presence}
          </span>
        )}

        {isEmptyBotSeat && (
          <div className="seat__bot-controls">
            <select
              value={botLevelSelect}
              onChange={(e) =>
                setBotLevelSelect(e.target.value as "NOVICE" | "PLAYER" | "MASTER")
              }
            >
              <option value="NOVICE">новичок</option>
              <option value="PLAYER">игрок</option>
              <option value="MASTER">мастер</option>
            </select>
            <button
              className="button button--small"
              type="button"
              onClick={() => {
                onBotSeat?.(seat as number, botLevelSelect)
              }}
            >
              компьютер
            </button>
          </div>
        )}

        {!empty && isBot && isHost && canEdit && onBotRemove && position !== "dummy" ? (
          <button
            className="button button--small button--ghost"
            type="button"
            onClick={() => onBotRemove(seat as number)}
          >
            убрать
          </button>
        ) : null}
      </div>
    </div>
  )
}
