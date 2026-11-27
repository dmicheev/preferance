import { NextResponse } from "next/server"

import { getGameHistory } from "@/lib/game-service"
import { gameKeySchema } from "@/lib/validation"

type RoundsRouteContext = {
  params: Promise<{ key: string }>
}

/** Раздачи партии с расчётом: финальный экран стола и история. */
export async function GET(_request: Request, context: RoundsRouteContext) {
  const { key: rawKey } = await context.params
  const parsedKey = gameKeySchema.safeParse(rawKey)
  if (!parsedKey.success) {
    return NextResponse.json(
      { error: parsedKey.error.issues[0]?.message ?? "Ключ стола — 6 символов" },
      { status: 400 },
    )
  }

  try {
    const history = await getGameHistory(parsedKey.data)
    if (!history) {
      return NextResponse.json({ error: "Стол не найден" }, { status: 404 })
    }

    return NextResponse.json({
      status: history.status,
      rounds: history.rounds,
      results: history.results,
    })
  } catch (error) {
    console.error("[api/games/rounds] не удалось прочитать историю", error)
    return NextResponse.json(
      { error: "Историю партии не получилось загрузить" },
      { status: 500 },
    )
  }
}
