// Реплики «за столом»: если расклад под фольклорную фразу выпал, компьютер
// изредка отпускает её в чат. Решение случайное, пока с перевесом в сторону
// «сказать» (TABLE_TALK_SAY_CHANCE). Антиспам: не чаще одной реплики в паузу
// и ни одна фраза не повторяется, пока в памяти стола три последние реплики.
// Говорит бот за столом; если ботов нет — системный пользователь «Компьютер».

import {
  matchTableTalk,
  TABLE_TALK_SAY_CHANCE,
  type RoundKind,
  type TableTalkContext,
  type TableTalkReplica,
} from "../lib/preference/table-talk"
import type { ChatMessageView, GameActionView, RoundResultView } from "../lib/protocol"
import { saveChatMessage, upsertUserByNickname } from "../lib/game-service"
import type { SessionState } from "./session-core"

/** Минимальная пауза между репликами одного стола. */
const TABLE_TALK_GAP_MS = 30_000
/** Сколько последних реплик стола помним: в этом окне повторов нет. */
const TABLE_TALK_HISTORY = 3
/** Реплика уходит в чат с человеческой паузой после события. */
const TABLE_TALK_DELAY_MS = { min: 1200, max: 2800 }

const TABLE_TALK_OFF = /^off$/i.test(process.env.PF_TABLE_TALK ?? "")

type TableTalkMemory = {
  lastAt: number
  /** Последние сказанные реплики, от свежей к старой. */
  recent: string[]
  previousKind: RoundKind | null
}

const memories = new Map<string, TableTalkMemory>()

/** Системный «Компьютер» для столов без ботов — ищем один раз за процесс. */
let systemSpeaker: { userId: string; nickname: string } | null = null

/** Стол ушёл из памяти — забываем и его разговорные привычки. */
export function forgetTableTalk(key: string): void {
  memories.delete(key)
}

export type TableTalkParams = {
  key: string
  session: SessionState
  actions: GameActionView[]
  result: RoundResultView | null
  /** Разослать сообщение чата столу. */
  say: (message: ChatMessageView) => void
}

/**
 * Оценить расклад после перехода и, может быть, запланировать реплику.
 * Вызывается под локом стола сразу после рассылки состояния: вся проверка
 * синхронная, таймер — unref, чтобы не держать процесс ради болтовни.
 */
export function scheduleTableTalk(params: TableTalkParams): void {
  if (TABLE_TALK_OFF) return
  const { key, session } = params
  // В лобби молчим; финальную раздачу комментировать можно —
  // итоговые реплики («пуля догнала гору», «интересные друзья») как раз там.
  if (session.status !== "PLAYING" && !params.result) return
  if (!session.round) return

  const memory = memories.get(key) ?? {
    lastAt: 0,
    recent: [],
    previousKind: null,
  }
  memories.set(key, memory)

  const ctx: TableTalkContext = {
    // Номер раздачи с единицы: roundsPlayed считает записанные, идущая не посчитана.
    roundNumber: session.roundsPlayed + 1,
    round: session.round,
    actions: params.actions,
    result: params.result,
    table: session.table,
    awaitingOneReady:
      session.round.phase === "scored" &&
      session.readyUserIds.length === session.players.length - 1,
    previousKind: memory.previousKind,
  }
  // Память о прошлом контракте нужна «Мизера ходят парами»: обновляем сразу
  // после чтения, до кулдауна — иначе во время паузы она протухнет.
  memory.previousKind = params.result?.outcome.contract.kind ?? memory.previousKind

  const now = Date.now()
  if (now - memory.lastAt < TABLE_TALK_GAP_MS) return

  const matches = matchTableTalk(ctx).filter(
    (replica) => !memory.recent.includes(replica.id),
  )
  if (matches.length === 0) return

  // Пока коэффициент смещён в сторону «сказать»: молчание — меньшая часть исходов.
  if (Math.random() >= TABLE_TALK_SAY_CHANCE) return

  const replica = matches[Math.floor(Math.random() * matches.length)]
  memory.lastAt = now
  memory.recent = [replica.id, ...memory.recent].slice(0, TABLE_TALK_HISTORY)

  const timer = setTimeout(() => {
    void speak(params, replica)
  }, talkDelay())
  ;(timer as { unref?: () => void }).unref?.()
}

function talkDelay(): number {
  // PF_TABLE_TALK_MS — фиксированная пауза для смоуков: 0 = реплики сразу.
  const override = Number(process.env.PF_TABLE_TALK_MS)
  if (Number.isFinite(override) && override >= 0) return override
  return (
    Math.floor(
      Math.random() * (TABLE_TALK_DELAY_MS.max - TABLE_TALK_DELAY_MS.min),
    ) + TABLE_TALK_DELAY_MS.min
  )
}

async function speak(params: TableTalkParams, replica: TableTalkReplica): Promise<void> {
  try {
    const speaker = await pickSpeaker(params.session)
    const message = await saveChatMessage({
      gameId: params.session.gameId,
      userId: speaker.userId,
      nickname: speaker.nickname,
      text: replica.text,
    })
    params.say(message)
  } catch (error) {
    console.error("[table-talk] реплика не ушла в чат", error)
  }
}

/** Говорит случайный бот за столом; без ботов — системный «Компьютер». */
async function pickSpeaker(session: SessionState): Promise<{
  userId: string
  nickname: string
}> {
  const bots = session.players.filter((player) => player.isBot)
  if (bots.length > 0) {
    const bot = bots[Math.floor(Math.random() * bots.length)]
    return { userId: bot.userId, nickname: bot.nickname }
  }
  if (!systemSpeaker) {
    const user = await upsertUserByNickname("Компьютер")
    systemSpeaker = { userId: user.id, nickname: user.nickname }
  }
  return systemSpeaker
}
