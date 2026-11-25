// Планировщик ходов ботов: после каждой рассылки game:state, если ход за ботом
// и партия PLAYING — таймер на случайную паузу из BOT_DELAY, потом действие через applyUserProposal.
// Один активный таймер на сеанс, снятие при финале партии.

import {
  BOT_DELAY,
  chooseAction,
  normalizeBotLevel,
  type BotLevel,
} from "../lib/preference/bot"
import { chooseActionSmart, type SmartContext } from "../lib/preference/bot-smart"
import { PLAYER_COUNT } from "../lib/preference/constants"
import {
  soloWhistController,
  soloWhistPartner,
  type RoundAction,
} from "../lib/preference/round"
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

  // Взятка сошлась: боты жмут Ок мгновенно — стол ждёт только людей.
  // Блок стоит до проверки хода: во время просмотра взятки ход как раз null.
  if (round.phase === "play" && round.turn === null) {
    const pending = session.players.find(
      (player) => player.isBot && !round.trickAck.includes(player.seat),
    )
    if (!pending) return
    const trickTimer = setTimeout(async () => {
      await executeTrickAck(key, pending.userId, runBot)
    }, 0)
    timers.set(key, { timer: trickTimer })
    return
  }

  const turn = round.turn
  if (turn === null) return

  // Прикуп открыт: боты тоже жмут Ок мгновенно, снос ждёт только людей.
  if (round.phase === "declaring" && round.prikupAck.length < PLAYER_COUNT) {
    const pending = session.players.find(
      (player) => player.isBot && !round.prikupAck.includes(player.seat),
    )
    if (!pending) return
    const ackTimer = setTimeout(async () => {
      await executePrikupAck(key, pending.userId, runBot)
    }, 0)
    timers.set(key, { timer: ackTimer })
    return
  }

  // Одиночный вист: на ходе пасующий, но картами управляет вистующий —
  // таймер ставится на него, а не на пасующего.
  const controller = soloWhistController(round)
  const actingSeat =
    controller !== null && turn === soloWhistPartner(round, controller)
      ? controller
      : turn

  const player = session.players.find((entry) => entry.seat === actingSeat)
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

/** Ок на открытый прикуп: перепроверяем, что смотрел не все. */
async function executePrikupAck(
  key: string,
  userId: string,
  runBot: BotRunner,
): Promise<void> {
  const current = getSession(key)
  if (!current || current.status !== "PLAYING") return

  const round = current.round
  if (!round || round.phase !== "declaring") return
  if (round.prikupAck.length >= PLAYER_COUNT) return

  const player = current.players.find((entry) => entry.userId === userId)
  if (!player || !player.isBot) return
  if (round.prikupAck.includes(player.seat)) return

  const ok = await runBot(key, userId, { type: "prikup-ack" })
  if (!ok) {
    console.error(`[bot] стол ${key}: Ок на прикуп не применилось`)
  }
}

/** Ок на собранную взятку: перепроверяем, что смотрели не все. */
async function executeTrickAck(
  key: string,
  userId: string,
  runBot: BotRunner,
): Promise<void> {
  const current = getSession(key)
  if (!current || current.status !== "PLAYING") return

  const round = current.round
  if (!round || round.phase !== "play" || round.turn !== null) return
  if (round.trickAck.length >= PLAYER_COUNT) return

  const player = current.players.find((entry) => entry.userId === userId)
  if (!player || !player.isBot) return
  if (round.trickAck.includes(player.seat)) return

  const ok = await runBot(key, userId, { type: "trick-ack" })
  if (!ok) {
    console.error(`[bot] стол ${key}: Ок на взятку не применилось`)
  }
}

/** Переводит решение бота в предложение игрока. */
function toProposal(action: RoundAction): UserProposal {
  switch (action.type) {
    case "bid":
      return { type: "bid", level: action.level, trump: action.trump }
    case "misere":
      return { type: "misere" }
    case "pass":
      return { type: "pass" }
    case "prikup-ack":
      return { type: "prikup-ack" }
    case "trick-ack":
      return { type: "trick-ack" }
    case "declare":
      return {
        type: "declare",
        contract: action.contract,
        discard: action.discard,
        level: action.level,
        trump: action.trump,
      }
    case "whist":
      return { type: "whist", whist: action.whist }
    case "play":
      return { type: "play", card: action.card }
  }
}

/** Выполнить ход бота: перепроверяем состояние, выбираем действие, применяем. */
async function executeBotTurn(
  key: string,
  userId: string,
  playsFor: 0 | 1 | 2,
  runBot: BotRunner,
): Promise<void> {
  const current = getSession(key)
  if (!current || current.status !== "PLAYING") return

  const round = current.round
  if (!round || round.turn !== playsFor) return

  const player = current.players.find((entry) => entry.userId === userId)
  if (!player || !player.isBot) return

  // Уровень из БД может быть любым: неизвестное значение — обычный игрок,
  // а не «случайно выпавший» мастер.
  const level: BotLevel = normalizeBotLevel(player.botLevel)
  // Умный бот: Монте-Карло + альфа-бета с бюджетом уровня. Правила стола нужны
  // ему для оценки в очках; при сбое — легаси-эвристики.
  // При одиночном висте боту, играющему за двоих, карту выбираем из той руки,
  // чей сейчас ход (playsFor), а действие подаётся от имени вистующего.
  const smart = await chooseActionSmart(round, playsFor, level, {
    rules: current.rules,
    raspasStep: current.table.raspasStep,
  } satisfies SmartContext).catch(() => null)
  const action = smart ?? chooseAction(round, playsFor, level)

  const proposal = toProposal(action)

  const ok = await runBot(key, userId, proposal)
  if (!ok) {
    console.error(`[bot] стол ${key}: действие бота не применилось`)
  }
}

