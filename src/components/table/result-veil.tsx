"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import {
  RoundCalculation,
  roundSummary,
  type HistoryPlayer,
} from "@/components/history/round-record"
import { scoreFormula } from "@/lib/preference/round-explain"
import type {
  GamePlayerView,
  RoundResultView,
  StandingView,
} from "@/lib/protocol"

type ResultVeilProps = {
  /** Ключ стола: по нему подтягиваем раздачи с расчётом. */
  gameKey: string
  standings: StandingView[] | null
  players: GamePlayerView[]
}

/** Партия закрыта: места, формула счёта и подробный расчёт поверх стола. */
export function ResultVeil({ gameKey, standings, players }: ResultVeilProps) {
  const [rounds, setRounds] = useState<RoundResultView[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/games/${gameKey}/rounds`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { rounds?: RoundResultView[] } | null) => {
        if (alive && data?.rounds) setRounds(data.rounds)
      })
      .catch(() => {
        // без сети останется список мест — расчёт догрузится позже
      })
    return () => {
      alive = false
    }
  }, [gameKey])

  const nicknameOf = (seat: number) =>
    players.find((player) => player.seat === seat)?.nickname ?? "—"
  const historyPlayers: HistoryPlayer[] = players.map((player) => ({
    seat: player.seat,
    nickname: player.nickname,
  }))
  // Формула счёта строится из таблицы последней раздачи: она же в истории.
  const lastTable = rounds?.at(-1)?.table ?? null

  return (
    <div className="veil">
      <div className="veil__card veil__card--result panel">
        <h2 className="panel__title">Партия закрыта</h2>
        <p className="panel__hint">пуля сыграна — места по итогу счёта</p>

        {standings ? (
          <ol className="standings">
            {standings.map((entry) => (
              <li key={entry.seat} data-place={entry.place}>
                <span className="standings__place">{entry.place}</span>
                <span className="standings__name">
                  {nicknameOf(entry.seat)}
                  {lastTable?.entries[entry.seat] ? (
                    <small className="hist__formula">
                      {scoreFormula(lastTable.entries[entry.seat])} = {entry.score}
                    </small>
                  ) : null}
                </span>
                <span className="standings__score">
                  {entry.score > 0 ? `+${entry.score}` : entry.score}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="panel__hint">считаем итог…</p>
        )}

        {rounds && rounds.length > 0 ? (
          <details className="hist__details">
            <summary>как получился расчёт — {rounds.length} раздач</summary>
            <div className="hist__rounds-compact">
              {rounds.map((round) => (
                <div key={round.roundNumber} className="hist__round">
                  <h4 className="hist__round-title">
                    {roundSummary(round, (seat) =>
                      seat === null ? "—" : nicknameOf(seat),
                    )}
                  </h4>
                  <RoundCalculation result={round} players={historyPlayers} />
                </div>
              ))}
            </div>
          </details>
        ) : rounds === null ? (
          <p className="panel__hint">подтягиваем расчёт раздач…</p>
        ) : null}

        <div className="veil__actions">
          <Link className="button button--ghost" href={`/history/${gameKey}`}>
            Все ходы партии
          </Link>
          <Link className="button" href="/">
            Вернуться в зал
          </Link>
        </div>
      </div>
    </div>
  )
}
