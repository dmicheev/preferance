import type { Prisma } from "@/generated/prisma/client"

import { prisma } from "./db"
import { generateGameKey } from "./game-key"
import { normalizeBotLevel } from "./preference/bot"
import {
  PLAYING_SEATS,
  type ChatMessageView,
  type GameSettingsView,
  type GameStatusId,
  type GameVariantId,
  type GameView,
  type HallSeatView,
  type RoomState,
  type SeatView,
} from "./protocol"
import { DEFAULT_RULESET, normalizeRuleset, type Ruleset } from "./preference/rules"
import { GAME_KEY_LENGTH } from "./validation"

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export async function upsertUserByNickname(nickname: string) {
  const nicknameKey = nickname.toLowerCase()

  return prisma.user.upsert({
    where: { nicknameKey },
    update: { nickname, lastSeenAt: new Date() },
    create: { nickname, nicknameKey },
  })
}

/** Подобрать уникальный никнейм бота «Компьютер N» и создать/найти пользователя. */
export async function createBotUser(index: number) {
  const nickname = `Компьютер ${index}`
  return upsertUserByNickname(nickname)
}

/** Посадить бота за свободное место стола: создать пользователя и GamePlayer. */
export async function addBotPlayer(
  gameId: string,
  seat: number,
  level: string,
): Promise<{ userId: string; nickname: string }> {
  // Уровень бота — только известные значения: в БД не должно попасть ничего странного.
  const botLevel = normalizeBotLevel(level)
  // Подбираем свободный индекс для ника бота
  let index = 1
  let user = await createBotUser(index)
  while (true) {
    const existing = await prisma.gamePlayer.findFirst({
      where: {
        gameId,
        userId: user.id,
      },
      select: { id: true },
    })
    if (!existing) break
    index += 1
    user = await createBotUser(index)
  }

  const gamePlayer = await prisma.gamePlayer.create({
    data: {
      gameId,
      userId: user.id,
      seat,
      isHost: false,
      isBot: true,
      botLevel,
    },
    include: { user: { select: { id: true, nickname: true } } },
  })

  return {
    userId: gamePlayer.userId,
    nickname: gamePlayer.user.nickname,
  }
}

export async function createGame(
  input: {
    variant: GameVariantId
    bullet: number
    roundsLimit: number | null
    allowSpectators: boolean
    rules?: Ruleset | null
    title?: string | null
  },
  hostId: string,
): Promise<{ key: string }> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const key = generateGameKey(GAME_KEY_LENGTH)
    const taken = await prisma.game.findUnique({
      where: { key },
      select: { id: true },
    })
    if (taken) continue

    try {
      const game = await prisma.game.create({
        data: {
          key,
          title: input.title?.trim() ? input.title.trim() : null,
          variant: input.variant,
          bullet: input.bullet,
          roundsLimit: input.roundsLimit,
          maxPlayers: PLAYING_SEATS,
          allowSpectators: input.allowSpectators,
          rules: toRulesJson(input.rules),
          hostId,
          players: { create: { userId: hostId, seat: 0, isHost: true } },
        },
        select: { key: true },
      })
      return { key: game.key }
    } catch (error) {
      if (isUniqueViolation(error)) continue
      throw error
    }
  }

  throw new Error("Не удалось подобрать свободный ключ стола, попробуй ещё раз")
}

export async function joinGame(
  key: string,
  nickname: string,
): Promise<ServiceResult<{ userId: string; gameId: string; seat: number }>> {
  const game = await prisma.game.findUnique({
    where: { key },
    select: {
      id: true,
      status: true,
      maxPlayers: true,
      allowSpectators: true,
      players: { select: { userId: true, seat: true } },
    },
  })

  if (!game) return { ok: false, error: "Стол с таким ключом не нашёлся" }
  if (game.status === "FINISHED") {
    return { ok: false, error: "Эта игра уже закончена" }
  }

  // Игрока ищем до создания записи: за занятым столом новые профили не нужны.
  const existingUser = await prisma.user.findUnique({
    where: { nicknameKey: nickname.toLowerCase() },
    select: { id: true },
  })

  const existingSeat = existingUser
    ? game.players.find((player) => player.userId === existingUser.id)
    : undefined

  if (existingUser && existingSeat) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { nickname, lastSeenAt: new Date() },
    })
    return {
      ok: true,
      data: { userId: existingUser.id, gameId: game.id, seat: existingSeat.seat },
    }
  }

  const takenSeats = new Set(game.players.map((player) => player.seat))
  const freeSeat = Array.from({ length: game.maxPlayers }, (_, seat) => seat).find(
    (seat) => !takenSeats.has(seat),
  )

  if (freeSeat === undefined) {
    return {
      ok: false,
      error: game.allowSpectators
        ? "Все места за столом заняты. Зрительский режим появится позже"
        : "Все места за столом заняты",
    }
  }

  const user = await upsertUserByNickname(nickname)

  try {
    await prisma.gamePlayer.create({
      data: { gameId: game.id, userId: user.id, seat: freeSeat, isHost: false },
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Место только что заняли, обнови страницу" }
    }
    throw error
  }

  return {
    ok: true,
    data: { userId: user.id, gameId: game.id, seat: freeSeat },
  }
}

export async function getGameView(
  key: string,
  sessionUserId: string | null,
): Promise<GameView | null> {
  const game = await prisma.game.findUnique({
    where: { key },
    include: {
      players: {
        include: { user: { select: { id: true, nickname: true } } },
        orderBy: { seat: "asc" },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 60 },
    },
  })

  if (!game) return null

  const seatsDetail = game.players.map((player) => ({
    userId: player.user.id,
    nickname: player.user.nickname,
    seat: player.seat,
    isHost: player.isHost,
    isBot: player.isBot,
    botLevel: player.botLevel,
  }))

  const mine = sessionUserId
    ? seatsDetail.find((player) => player.userId === sessionUserId)
    : undefined

  return {
    key: game.key,
    status: game.status as GameStatusId,
    settings: toSettingsView(game),
    seats: seatsDetail.map(({ seat, nickname, isHost }) => ({
      seat,
      nickname,
      isHost,
    })),
    seatsDetail,
    chat: game.messages
      .slice()
      .reverse()
      .map((message) => ({
        id: message.id,
        nickname: message.nickname,
        text: message.text,
        at: message.createdAt.getTime(),
      })),
    me: mine
      ? { userId: mine.userId, nickname: mine.nickname, seat: mine.seat }
      : null,
  }
}

export function toSettingsView(game: {
  title: string | null
  variant: string
  bullet: number
  roundsLimit: number | null
  maxPlayers: number
  allowSpectators: boolean
  rules?: unknown
}): GameSettingsView {
  return {
    title: game.title,
    variant: game.variant as GameVariantId,
    bullet: game.bullet,
    roundsLimit: game.roundsLimit,
    maxPlayers: game.maxPlayers,
    allowSpectators: game.allowSpectators,
    rules: normalizeRuleset(game.rules ?? DEFAULT_RULESET),
  }
}

/** Правила в JSON для БД; пресет по умолчанию не дублируем — пишем null. */
function toRulesJson(rules: Ruleset | null | undefined): Prisma.InputJsonValue | undefined {
  if (!rules) return undefined
  const normalized = normalizeRuleset(rules)
  if (JSON.stringify(normalized) === JSON.stringify(normalizeRuleset(DEFAULT_RULESET))) {
    return undefined
  }
  return normalized as unknown as Prisma.InputJsonValue
}

export async function saveChatMessage(params: {
  gameId: string
  userId: string
  nickname: string
  text: string
}): Promise<ChatMessageView> {
  const message = await prisma.chatMessage.create({
    data: {
      gameId: params.gameId,
      userId: params.userId,
      nickname: params.nickname,
      text: params.text,
    },
    select: { id: true, nickname: true, text: true, createdAt: true },
  })

  return {
    id: message.id,
    nickname: message.nickname,
    text: message.text,
    at: message.createdAt.getTime(),
  }
}

export type ViewerContext = NonNullable<
  Awaited<ReturnType<typeof findViewerContext>>
>

export async function findViewerContext(
  key: string,
  userId: string,
): Promise<
  | {
      gameId: string
      key: string
      status: GameStatusId
      seats: SeatView[]
      players: HallSeatView[]
      settings: GameSettingsView
      me: { userId: string; nickname: string; seat: number } | null
    }
  | null
> {
  const game = await prisma.game.findUnique({
    where: { key },
    include: {
      players: {
        include: { user: { select: { id: true, nickname: true } } },
        orderBy: { seat: "asc" },
      },
    },
  })

  if (!game) return null
  const players = game.players.map((player) => ({
    userId: player.user.id,
    nickname: player.user.nickname,
    seat: player.seat,
    isHost: player.isHost,
    isBot: player.isBot,
    botLevel: player.botLevel,
  }))
  const mine = players.find((player) => player.userId === userId) ?? null

  return {
    gameId: game.id,
    key: game.key,
    status: game.status as GameStatusId,
    seats: players.map(({ seat, nickname, isHost }) => ({
      seat,
      nickname,
      isHost,
    })),
    players,
    settings: toSettingsView(game),
    me: mine ? { userId, nickname: mine.nickname, seat: mine.seat } : null,
  }
}

/** Статус стола в БД: лобби → идёт игра. Гвардия от затирания более нового статуса. */
export async function markGamePlaying(key: string): Promise<void> {
  await prisma.game.updateMany({
    where: { key, status: "LOBBY" },
    data: { status: "PLAYING" },
  })
}

/** Итоги партии в БД: места со счётом и закрытие стола. Повторный вызов не страшен. */
export async function saveGameOutcome(
  key: string,
  standings: Array<{ userId: string; place: number; score: number }>,
): Promise<void> {
  const game = await prisma.game.findUnique({
    where: { key },
    select: { id: true },
  })
  if (!game) return

  await prisma.$transaction([
    prisma.gameResult.deleteMany({ where: { gameId: game.id } }),
    prisma.gameResult.createMany({
      data: standings.map((entry) => ({
        gameId: game.id,
        userId: entry.userId,
        place: entry.place,
        score: entry.score,
      })),
    }),
    prisma.game.update({
      where: { key },
      data: { status: "FINISHED", finishedAt: new Date() },
    }),
  ])
}

/** Итоги закрытой партии из БД: для столов, переживших перезапуск сервера. */
export async function getGameStandings(
  key: string,
): Promise<Array<{ seat: 0 | 1 | 2; place: number; score: number }> | null> {
  const game = await prisma.game.findUnique({
    where: { key },
    select: {
      status: true,
      players: { select: { userId: true, seat: true } },
      results: { select: { userId: true, place: true, score: true } },
    },
  })

  if (!game || game.status !== "FINISHED") return null
  const seatOfUserId = new Map(
    game.players.map((player) => [player.userId, player.seat]),
  )

  return game.results
    .map((result) => ({
      seat: (seatOfUserId.get(result.userId) ?? 0) as 0 | 1 | 2,
      place: result.place,
      score: result.score,
    }))
    .sort((left, right) => left.place - right.place)
}

export function buildRoomState(
  context: {
    key: string
    status: GameStatusId
    players: HallSeatView[]
  },
  onlineUserIds: string[],
): RoomState {
  return {
    key: context.key,
    status: context.status,
    seats: context.players.map(({ seat, nickname, isHost }) => ({
      seat,
      nickname,
      isHost,
    })),
    onlineUserIds,
    onlineCount: onlineUserIds.length,
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  )
}