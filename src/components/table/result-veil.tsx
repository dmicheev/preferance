import Link from "next/link"

import type { GamePlayerView, StandingView } from "@/lib/protocol"

type ResultVeilProps = {
  standings: StandingView[] | null
  players: GamePlayerView[]
}

/** Партия закрыта: места и счёт поверх стола. */
export function ResultVeil({ standings, players }: ResultVeilProps) {
  const nicknameOf = (seat: number) =>
    players.find((player) => player.seat === seat)?.nickname ?? "—"

  return (
    <div className="veil">
      <div className="veil__card panel">
        <h2 className="panel__title">Партия закрыта</h2>
        <p className="panel__hint">пуля сыграна — места по итогу счёта</p>

        {standings ? (
          <ol className="standings">
            {standings.map((entry) => (
              <li key={entry.seat} data-place={entry.place}>
                <span className="standings__place">{entry.place}</span>
                <span className="standings__name">{nicknameOf(entry.seat)}</span>
                <span className="standings__score">
                  {entry.score > 0 ? `+${entry.score}` : entry.score}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="panel__hint">считаем итог…</p>
        )}

        <Link className="button" href="/">
          Вернуться в зал
        </Link>
      </div>
    </div>
  )
}
