import Link from "next/link"

import { Candle } from "@/components/candle"

export function MissingTable({ keyLabel }: { keyLabel: string }) {
  return (
    <main className="hall">
      <header className="hall__head">
        <p className="hall__eyebrow">ключ не подошёл</p>
        <h1 className="hall__title">Стола нет</h1>
        <p className="hall__lead">
          Ключа <b>{keyLabel || "…"}</b> нет в клубе: возможно, хозяин закрыл
          стол или в ссылке опечатка.
        </p>
        <div className="hall__candles" aria-hidden="true">
          <Candle size="sm" delay={0.4} />
          <Candle delay={1.2} />
          <Candle size="sm" delay={1.9} />
        </div>
      </header>

      <section className="panel" style={{ maxWidth: 460, margin: "0 auto" }}>
        <h2 className="panel__title">Что можно сделать</h2>
        <ul className="hint-list">
          <li>перепроверь шесть символов в ссылке</li>
          <li>попроси у друга свежую ссылку</li>
          <li>или накрой свой стол — ключ появится сразу</li>
        </ul>
        <Link className="button" href="/">
          В главный зал
        </Link>
      </section>
    </main>
  )
}