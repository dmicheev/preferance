import { NextResponse } from "next/server"

import { createGame, upsertUserByNickname } from "@/lib/game-service"
import { normalizeRuleset } from "@/lib/preference/rules"
import { rememberSession } from "@/lib/session"
import { createGameSchema } from "@/lib/validation"

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }

  const parsed = createGameSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Проверь настройки стола" },
      { status: 400 },
    )
  }

  const { nickname, ...settings } = parsed.data

  try {
    const user = await upsertUserByNickname(nickname)
    const game = await createGame(
      {
        variant: settings.variant,
        bullet: settings.bullet,
        roundsLimit: settings.roundsLimit,
        allowSpectators: settings.allowSpectators,
        rules: settings.rules ? normalizeRuleset(settings.rules) : null,
        title: settings.title ?? null,
      },
      user.id,
    )
    await rememberSession(user.id)

    return NextResponse.json({ key: game.key }, { status: 201 })
  } catch (error) {
    console.error("[api/games] не удалось создать стол", error)
    return NextResponse.json(
      { error: "Стол не открылся, попробуй ещё раз" },
      { status: 500 },
    )
  }
}