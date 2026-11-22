import { NextResponse } from "next/server"

import { joinGame } from "@/lib/game-service"
import { clientRateKey, isRateLimited } from "@/lib/rate-limit"
import { rememberSession } from "@/lib/session"
import { gameKeySchema, joinGameSchema } from "@/lib/validation"

/** Открытый стол в интернет: не даём перебирать ключи столов со скоростью автомата. */
const JOIN_LIMIT = { requests: 30, windowMs: 60_000 }

type JoinRouteContext = {
  params: Promise<{ key: string }>
}

export async function POST(request: Request, context: JoinRouteContext) {
  if (isRateLimited(clientRateKey(request, "games-join"), JOIN_LIMIT.requests, JOIN_LIMIT.windowMs)) {
    return NextResponse.json(
      { error: "Слишком много запросов — подожди минуту" },
      { status: 429 },
    )
  }

  const { key: rawKey } = await context.params
  const parsedKey = gameKeySchema.safeParse(rawKey)
  if (!parsedKey.success) {
    return NextResponse.json(
      { error: parsedKey.error.issues[0]?.message ?? "Ключ стола — 6 символов" },
      { status: 400 },
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }

  const parsed = joinGameSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Проверь ник" },
      { status: 400 },
    )
  }

  try {
    const joined = await joinGame(parsedKey.data, parsed.data.nickname)
    if (!joined.ok) {
      return NextResponse.json({ error: joined.error }, { status: 409 })
    }

    await rememberSession(joined.data.userId)

    return NextResponse.json({
      key: parsedKey.data,
      seat: joined.data.seat,
    })
  } catch (error) {
    console.error("[api/games/join] не удалось посадить игрока", error)
    return NextResponse.json(
      { error: "Не получилось сесть за стол" },
      { status: 500 },
    )
  }
}