import Link from "next/link"
import { Suspense } from "react"

import { Ambience } from "@/components/ambience"
import { listGameHistories } from "@/lib/game-service"
import { settingsSummary } from "@/lib/format"

function dateLabel(at: number): string {
  return new Intl.DateTimeFormat("ru", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at))
}

export default function HistoryPage() {
  return (
    <>
      <Ambience />
      <main className="hall">
        <header className="hall__head">
          <p className="hall__eyebrow">архив клуба</p>
          <h1 className="hall__title">История партий</h1>
          <p className="hall__lead">
            Каждая закрытая партия с полным ходом: торговля, снос, все взятки и
            расчёт любой раздачи.
          </p>
        </header>

        <Suspense fallback={<HistoryShell>листаем архив…</HistoryShell>}>
          <HistoryList />
        </Suspense>
      </main>
    </>
  )
}

function HistoryShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="panel panel--wide">
      <Link className="button button--ghost" href="/">
        ← В зал
      </Link>
      <p className="panel__hint">{children}</p>
    </section>
  )
}

/** Список закрытых партий — читается из БД на каждый заход. */
async function HistoryList() {
  let games: Awaited<ReturnType<typeof listGameHistories>> = []
  let failed = false
  try {
    games = await listGameHistories()
  } catch {
    failed = true
  }

  return (
    <section className="panel panel--wide">
      <Link className="button button--ghost" href="/">
        ← В зал
      </Link>

      {failed ? (
        <p className="form-error">
          Историю не получилось загрузить — проверь базу и обнови страницу
        </p>
      ) : games.length === 0 ? (
        <p className="panel__hint">
          пока пусто — сыграй партию, и она появится здесь
        </p>
      ) : (
        <ul className="hist__list">
          {games.map((game) => (
            <li key={game.key}>
              <Link className="hist__entry" href={`/history/${game.key}`}>
                <span className="hist__entry-main">
                  <b>
                    Партия {game.key}
                    {game.settings.title ? ` · ${game.settings.title}` : ""}
                  </b>
                  <span>{settingsSummary(game.settings)}</span>
                </span>
                <span className="hist__entry-players">
                  {game.players
                    .slice()
                    .sort((left, right) => left.seat - right.seat)
                    .map((player) => player.nickname)
                    .join(" · ")}
                </span>
                {game.results ? (
                  <span className="hist__entry-scores">
                    {game.results.map((result) => (
                      <span key={`${result.place}-${result.seat}`} data-place={result.place}>
                        {result.place}. {result.nickname}{" "}
                        {result.score > 0 ? `+${result.score}` : result.score}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="hist__entry-meta">
                  {game.roundsCount > 0 ? `${game.roundsCount} раздач · ` : ""}
                  {dateLabel(game.finishedAt ?? game.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
