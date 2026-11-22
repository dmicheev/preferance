import type { GamePlayerView, RoundView } from "@/lib/protocol"
import type { ScoreTable } from "@/lib/preference/score"
import type { Seat } from "@/lib/preference/round"

type ScoreBoardProps = {
  table: ScoreTable
  players: GamePlayerView[]
  round: RoundView | null
  mySeat: Seat | null
}

/** Табло на сукне: пуля, гора, висты — по игрокам, обновляется после каждой раздачи. */
export function ScoreBoard({ table, players, round, mySeat }: ScoreBoardProps) {
  const closed = table.entries.every((entry) => entry.pool >= table.bullet)

  return (
    <div className="score-board">
      <div className="score-board__head">
        <span className="score-board__title">пуля {table.bullet}</span>
        <span className="score-board__meta">
          {closed ? "пуля закрыта" : table.raspasStep > table.rules.raspasBase
            ? `распасы ×${table.raspasStep}`
            : null}
        </span>
      </div>

      <div className="score-board__grid" role="table" aria-label="Счёт партии">
        <span className="score-board__cell score-board__cell--head" />
        <span className="score-board__cell score-board__cell--head">пуля</span>
        <span className="score-board__cell score-board__cell--head">гора</span>
        <span className="score-board__cell score-board__cell--head">висты</span>

        {players.map((player) => {
          const entry = table.entries[player.seat]
          if (!entry) return null
          const isDealer = round?.dealer === player.seat
          const isDeclarer = round?.declarer === player.seat

          return (
            <FragmentRow
              key={player.seat}
              nickname={player.nickname}
              entry={entry}
              mine={mySeat === player.seat}
              mark={isDeclarer ? "играет" : isDealer ? "сдаёт" : null}
            />
          )
        })}
      </div>
    </div>
  )
}

function FragmentRow({
  nickname,
  entry,
  mine,
  mark,
}: {
  nickname: string
  entry: { pool: number; mountain: number; whists: number }
  mine: boolean
  mark: string | null
}) {
  return (
    <>
      <span
        className="score-board__cell score-board__cell--name"
        data-mine={mine}
        title={mark ?? undefined}
      >
        {nickname}
      </span>
      <span className="score-board__cell">{entry.pool}</span>
      <span className="score-board__cell">{entry.mountain}</span>
      <span className="score-board__cell">{entry.whists}</span>
    </>
  )
}
