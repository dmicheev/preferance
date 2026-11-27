import { headers } from "next/headers"
import { Suspense } from "react"

import { Ambience } from "@/components/ambience"
import { Candle } from "@/components/candle"
import { MissingTable } from "@/components/table/missing-table"
import { TableScreen } from "@/components/table/table-screen"
import { getGameView } from "@/lib/game-service"
import { getSessionUserId, readNicknameCookie } from "@/lib/session"
import { normalizeGameKey } from "@/lib/validation"

type TablePageProps = {
  params: Promise<{ key: string }>
}

export default async function TablePage({ params }: TablePageProps) {
  return (
    <>
      <Ambience />
      <Suspense fallback={<TableLoading />}>
        {/* params читаем внутри Suspense: иначе маршрут не может стримиться */}
        <TableRoute params={params} />
      </Suspense>
    </>
  )
}

async function TableRoute({ params }: TablePageProps) {
  const { key } = await params
  const keyParam = normalizeGameKey(key)

  const [sessionUserId, headerList, storedNickname] = await Promise.all([
    getSessionUserId(),
    headers(),
    readNicknameCookie(),
  ])

  const view = await getGameView(keyParam, sessionUserId)
  if (!view) return <MissingTable keyLabel={keyParam} />

  // Адрес ссылки берём из самого запроса: друзья приходят по внешнему адресу,
// поэтому host из заголовков точнее, чем APP_URL.
  const forwardedHost = headerList.get("x-forwarded-host")
  const host =
    forwardedHost?.split(",")[0]?.trim() ??
    headerList.get("host") ??
    "localhost:3005"
  const forwardedProto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const proto =
    forwardedProto ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https")

  return (
    <TableScreen
      view={view}
      inviteUrl={`${proto}://${host}/g/${view.key}`}
      storedNickname={storedNickname}
    />
  )
}

function TableLoading() {
  return (
    <div className="table-screen">
      <header className="topbar">
        <div className="topbar__brand">
          <strong>Преферанс клуб</strong>
          <span>преферанс</span>
        </div>
      </header>
      <div className="board">
        <div style={{ display: "grid", justifyItems: "center", gap: 18 }}>
          <p className="hall__eyebrow">зажигаем свечи</p>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-end" }}>
            <Candle size="sm" delay={0.3} />
            <Candle delay={0.9} />
            <Candle size="sm" delay={1.5} />
          </div>
        </div>
      </div>
    </div>
  )
}