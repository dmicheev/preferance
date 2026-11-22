"use client"

import { useState } from "react"

import { PlayingCard } from "@/components/cards/playing-card"
import { deckStyle } from "@/lib/format"

export type SeatPosition = "self" | "left" | "right" | "dummy"

const BOT_LEVEL_LABEL: Record<string, string> = {
  NOVICE: "новичок",
  PLAYER: "игрок",
  MASTER: "мастер",
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
  /** Место принадлежит боту. */
  isBot?: boolean
  /** Уровень бота. */
  botLevel?: string | null
  /** Хозяин ли текущий пользователь (для кнопки посадки бота). */
  isHost?: boolean
  /** Посадить бота на это место. */
  onBotSeat?: (seat: number, level: string) => void
  /** Убрать бота с этого места. */
  onBotRemove?: (seat: number) => void
  /** Номер места (0–2). */
  seat?: number
}

export function SeatPlate({
  position,
  nickname,
  role,
  online,
  isMe = false,
  backs = 0,
  isBot = false,
  botLevel = null,
  isHost = false,
  onBotSeat,
  onBotRemove,
  seat = -1,
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

  const isEmptyBotSeat = empty && isHost && position !== "dummy" && onBotSeat

  return (
    <div
      className={`seat seat--${position}${isBot ? " seat--bot" : ""}`}
      data-me={isMe}
      data-empty={empty}
    >
      {backs > 0 ? (
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
        <span className="seat__avatar">{initial}</span>
        <span className="seat__name">
          {isBot ? "💻 " : ""}{nickname ?? "свободное место"}
        </span>
        <span className="seat__role">{role}</span>
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

        {!empty && isBot && isHost && onBotRemove && position !== "dummy" ? (
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
