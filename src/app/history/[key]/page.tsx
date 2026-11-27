import Link from "next/link"
import { Suspense } from "react"

import { Ambience } from "@/components/ambience"
import { RoundRecord } from "@/components/history/round-record"
import { getGameHistory, type GameHistoryView } from "@/lib/game-service"
import { settingsSummary, statusLabel } from "@/lib/format"
import { scoreFormula } from "@/lib/preference/round-explain"
import { normalizeGameKey } from "@/lib/validation"

type GameHistoryPageProps = {
  params: Promise<{ key: string }>
}

export default function GameHistoryPage({ params }: GameHistoryPageProps) {
  return (
    <>
      <Ambience />
      <main className="hall">
        <Suspense fallback={<HistoryShell>раскрываем запись партии…</HistoryShell>}>
          {/* params читаем внутри Suspense: маршрут рендится на каждый заход */}
          <GameHistory params={params} />
        </Suspense>
      </main>
    </>
  )
}

function HistoryShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="panel panel--wide">
      <p className="panel__hint">{children}</p>
    </section>
  )
}

function HistoryMissing({ failed, keyLabel }: { failed: boolean; keyLabel: string }) {
  return (
    <section className="panel panel--wide">
      <h2 className="panel__title">
        {failed ? "История не загрузилась" : "Партия не нашлась"}
      </h2>
      <p className="panel__hint">
        {failed
          ? "База не ответила — попробуй обновить страницу"
          : `Стола с ключом ${keyLabel} нет в архиве`}
      </p>
      <Link className="button button--ghost" href="/history">
        ← Вся история
      </Link>
    </section>
  )
}

/** Запись одной партии: состав, итог с формулой и все раздачи с расчётом. */
async function GameHistory({ params }: GameHistoryPageProps) {
  const { key: rawKey } = await params
  const key = normalizeGameKey(rawKey)

  let history: GameHistoryView | null = null
  let failed = false
  try {
    history = await getGameHistory(key)
  } catch {
    failed = true
  }

  if (!history) return <HistoryMissing failed={failed} keyLabel={key} />

  const players = history.players.map((player) => ({
    seat: player.seat,
    nickname: player.nickname,
  }))
  const lastTable = history.rounds.at(-1)?.table ?? null

  return (
    <section className="panel panel--wide">
      <header className="hall__head">
        <p className="hall__eyebrow">архив клуба</p>
        <h1 className="hall__title">Партия {history.key}</h1>
        <p className="hall__lead">
          {settingsSummary(history.settings)} · {statusLabel(history.status)}
        </p>
      </header>

      <div className="hist__nav">
        <Link className="button button--ghost" href="/history">
          ← Вся история
        </Link>
        <Link className="button button--ghost" href={`/g/${history.key}`}>
          К столу
        </Link>
      </div>

      <p className="panel__hint">
        за столом:{" "}
        {players.map((player) => player.nickname).join(" · ") || "никто не сел"}
      </p>

      {history.results && lastTable ? (
        <div className="hist__final">
          <span className="hist__label">итог партии</span>
          <ol className="standings">
            {history.results.map((result) => {
              const entry = lastTable.entries[result.seat]
              return (
                <li key={result.seat} data-place={result.place}>
                  <span className="standings__place">{result.place}</span>
                  <span className="standings__name">
                    {result.nickname}
                    {entry ? (
                      <small className="hist__formula">
                        {scoreFormula(entry)} = {result.score}
                      </small>
                    ) : null}
                  </span>
                  <span className="standings__score">
                    {result.score > 0 ? `+${result.score}` : result.score}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}

      {history.rounds.length === 0 ? (
        <p className="panel__hint">
          записанных раздач пока нет — история ведётся с момента обновления клуба
        </p>
      ) : (
        <>
          <span className="hist__label">раздачи — {history.rounds.length}</span>
          {history.rounds.map((round) => (
            <RoundRecord key={round.roundNumber} result={round} players={players} />
          ))}
        </>
      )}
    </section>
  )
}
