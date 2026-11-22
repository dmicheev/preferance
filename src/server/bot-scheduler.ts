// Планировщик ходов ботов: после каждой рассылки game:state, если ход за ботом
// и партия PLAYING — таймер на случайную паузу из BOT_DELAY, потом действие через applyUserProposal.
// Один активный таймер на сеанс, снятие при финале партии.

import { BOT_DELAY, chooseAction, normalizeBotLevel, type BotLevel } from "../lib/preference/bot"
import { type UserProposal } from "./session-core"
import { type SessionState } from "./session-core"
import { getSession } from "./sessions"

/** Команда бота: ход в раздаче или подтверждение готовности. */
export type BotCommand = UserProposal | { type: "ready" }

type BotTimerHandle = {
  timer: ReturnType<typeof setTimeout> | null
}

const timers = new Map<string, BotTimerHandle>()

/** Колбэк: применить действие бота и разослать события комнаты. */
export type BotRunner = (
  key: string,
  userId: string,
  command: BotCommand,
) => Promise<boolean>

/** Остановить таймер бота для стола (вызывать при финале и при смене состояния). */
export function stopBotTimer(key: string): void {
  const handle = timers.get(key)
  if (handle?.timer) {
    clearTimeout(handle.timer)
  }
  timers.delete(key)
}

function randomDelay(): number {
  // PF_BOT_DELAY_MS — фиксированная пауза для смоуков: 0 = боты отвечают мгновенно.
  const override = Number(process.env.PF_BOT_DELAY_MS)
  if (Number.isFinite(override) && override >= 0) return override
  return (
    Math.floor(Math.random() * (BOT_DELAY.maxMs - BOT_DELAY.minMs)) +
    BOT_DELAY.minMs
  )
}

/** Перезапустить таймер бота: ход бота или готовность после раздачи — с паузой. */
export function scheduleBotTurn(
  key: string,
  session: SessionState,
  runBot: BotRunner,
): void {
  stopBotTimer(key)

  if (session.status !== "PLAYING") return
  const round = session.round
  if (!round) return

  if (round.phase === "scored") {
    // Раздача записана: по очереди подтверждаем готовность за ботов.
    const pending = session.players.find(
      (player) =>
        player.isBot &&
        !session.readyUserIds.includes(player.userId),
    )
    if (!pending) return
    const timer = setTimeout(async () => {
      await executeReady(key, pending.userId, runBot)
    }, randomDelay())
    timers.set(key, { timer })
    return
  }

  const turn = round.turn
  if (turn === null) return

  const player = session.players.find((entry) => entry.seat === turn)
  if (!player || !player.isBot) return

  const timer = setTimeout(async () => {
    await executeBotTurn(key, player.userId, turn, runBot)
  }, randomDelay())

  timers.set(key, { timer })
}

/** Подтвердить готовность бота: перепроверяем, что раздача всё ещё не подтверждена. */
async function executeReady(
  key: string,
  userId: string,
  runBot: BotRunner,
): Promise<void> {
  const current = getSession(key)
  if (!current || current.status !== "PLAYING") return
  if (current.round?.phase !== "scored") return
  if (current.readyUserIds.includes(userId)) return

  const ok = await runBot(key, userId, { type: "ready" })
  if (!ok) {
    console.error(`[bot] стол ${key}: готовность бота не применилась`)
  }
}

/** Выполнить ход бота: перепроверяем состояние, выбираем действие, применяем. */
async function executeBotTurn(
  key: string,
  userId: string,
  seat: 0 | 1 | 2,
  runBot: BotRunner,
): Promise<void> {
  const current = getSession(key)
  if (!current || current.status !== "PLAYING") return

  const round = current.round
  if (!round || round.turn !== seat) return

  const player = current.players.find((entry) => entry.userId === userId)
  if (!player || !player.isBot) return

  // Уровень из БД может быть любым: неизвестное значение — обычный игрок,
  // а не «случайно выпавший» мастер.
  const level: BotLevel = normalizeBotLevel(player.botLevel)
  const action = chooseAction(round, seat, level)

  // RoundAction → UserProposal (место подставляет applyUserProposal)
  let proposal: UserProposal
  switch (action.type) {
    case "bid":
      proposal = { type: "bid", level: action.level, trump: action.trump }
      break
    case "pass":
      proposal = { type: "pass" }
      break
    case "declare":
      proposal = {
        type: "declare",
        contract: action.contract,
        discard: action.discard,
      }
      break
    case "whist":
      proposal = { type: "whist", whist: action.whist }
      break
    case "play":
      proposal = { type: "play", card: action.card }
      break
  }

  const ok = await runBot(key, userId, proposal)
  if (!ok) {
    console.error(`[bot] стол ${key}: действие бота не применилось`)
  }
}

