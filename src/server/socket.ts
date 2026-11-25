import type { Server as HttpServer } from "node:http"
import { Server } from "socket.io"

import { prisma } from "../lib/db"
import {
  addBotPlayer,
  buildRoomState,
  findViewerContext,
  getGameStandings,
  markGamePlaying,
  saveChatMessage,
  saveGameOutcome,
  type ViewerContext,
} from "../lib/game-service"
import { finalStandings } from "../lib/preference/score"
import {
  SESSION_COOKIE,
  type ClientToServerEvents,
  type GameSnapshot,
  type GameStatusId,
  type ServerToClientEvents,
} from "../lib/protocol"
import { normalizeBotLevel } from "../lib/preference/bot"
import { verifySessionToken } from "../lib/session-token"
import { chatTextSchema, normalizeGameKey } from "../lib/validation"
import {
  applyUserProposal,
  buildSnapshot,
  finishedSnapshot,
  setReady,
  startGame,
  type SessionResult,
  type SessionState,
} from "./session-core"
import { dropSession, ensureSession, getSession, nextSeed, saveSession } from "./sessions"
import {
  scheduleBotTurn,
  stopBotTimer,
  type BotCommand,
} from "./bot-scheduler"

type InterServerEvents = Record<string, never>

type SocketData = {
  userId: string
  key: string | null
  nickname: string | null
  recentMessages: number[]
}

const ROOM_PREFIX = "game:"
const CHAT_RATE_LIMIT = { messages: 6, windowMs: 6000 }
/** Стол без подключённых игроков столько живёт в памяти, потом уходит (итоги остаются в БД). */
const ROOM_TTL_MS = 30 * 60 * 1000

/** Статусы монотонны: LOBBY → PLAYING → FINISHED. Меньший ранг — более старое состояние. */
function statusRank(status: GameStatusId): number {
  return status === "LOBBY" ? 0 : status === "PLAYING" ? 1 : 2
}

function roomName(key: string) {
  return `${ROOM_PREFIX}${key}`
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const chunk of header.split(";")) {
    const separator = chunk.indexOf("=")
    if (separator === -1) continue
    if (chunk.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(chunk.slice(separator + 1).trim())
    } catch {
      // Кривой cookie не должен ронять установку соединения.
      return null
    }
  }
  return null
}

function isRateLimited(socket: { recentMessages: number[] }): boolean {
  const now = Date.now()
  const windowStart = now - CHAT_RATE_LIMIT.windowMs
  socket.recentMessages = socket.recentMessages.filter((at) => at > windowStart)

  if (socket.recentMessages.length >= CHAT_RATE_LIMIT.messages) return true

  socket.recentMessages.push(now)
  return false
}

export function attachSocketServer(httpServer: HttpServer) {
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    path: "/socket.io",
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 25_000,
  })

  // key → актуальный снимок стола (кто за столом, настройки, статус)
  const roomContexts = new Map<string, ViewerContext>()
  // key → userId → количество открытых сокетов
  const presence = new Map<string, Map<string, number>>()
  // key → очередь переходов: два события одного стола не могут наложиться друг на друга
  const roomLocks = new Map<string, Promise<unknown>>()
  // key → таймер уборки опустевшего стола
  const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Строгая сериализация переходов стола. Мутация «прочитал → применил → сохранил»
   * синхронна и без лока, но хвост перехода (рассылка, запись в БД, таймер бота)
   * асинхронен: без лока устаревший переход мог перезаписать таймер бота,
   * поставленный более свежим состоянием, и раздача зависала. Теперь все
   * переходы одного стола выстраиваются в очередь.
   */
  async function withRoomLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = roomLocks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(fn)
    roomLocks.set(key, next)
    try {
      return await next
    } finally {
      if (roomLocks.get(key) === next) roomLocks.delete(key)
    }
  }

  function cancelRoomCleanup(key: string) {
    const timer = cleanupTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      cleanupTimers.delete(key)
    }
  }

  /** Уборка стола из памяти: сессия, контекст, таймеры ботов. Итоги остаются в БД. */
  function scheduleRoomCleanup(key: string) {
    cancelRoomCleanup(key)
    const timer = setTimeout(() => {
      cleanupTimers.delete(key)
      stopBotTimer(key)
      dropSession(key)
      roomContexts.delete(key)
      presence.delete(key)
    }, ROOM_TTL_MS)
    // Не держим процесс живым ради уборки.
    ;(timer as { unref?: () => void }).unref?.()
    cleanupTimers.set(key, timer)
  }

  /**
   * Обновляет снимок стола, не позволяя откатиться назад: чтение из БД может
   * вернуть LOBBY, пока память уже перешла в PLAYING (запись ещё в полёте).
   */
  function updateContext(key: string, context: ViewerContext) {
    const current = roomContexts.get(key)
    if (current && statusRank(current.status) > statusRank(context.status)) {
      roomContexts.set(key, { ...context, status: current.status })
      return
    }
    roomContexts.set(key, context)
  }

  function onlineUserIds(key: string): string[] {
    return Array.from(presence.get(key)?.keys() ?? [])
  }

  function broadcastState(key: string) {
    const context = roomContexts.get(key)
    if (!context) return
    io.to(roomName(key)).emit(
      "room:state",
      buildRoomState(context, onlineUserIds(key)),
    )
  }

  function addPresence(key: string, userId: string) {
    const users = presence.get(key) ?? new Map<string, number>()
    users.set(userId, (users.get(userId) ?? 0) + 1)
    presence.set(key, users)
  }

  function removePresence(key: string, userId: string) {
    const users = presence.get(key)
    if (!users) return
    const next = (users.get(userId) ?? 0) - 1
    if (next > 0) {
      users.set(userId, next)
    } else {
      users.delete(userId)
    }
    if (users.size === 0) presence.delete(key)
  }

  function snapshotFor(key: string, userId: string): GameSnapshot | null {
    const session = getSession(key)
    if (session) return buildSnapshot(session, userId)
    return null
  }

  /** Личный снимок каждому сокету комнаты: чужие руки наружу не уходят. */
  async function broadcastGameState(key: string) {
    try {
      const sockets = await io.in(roomName(key)).fetchSockets()
      for (const entry of sockets) {
        const snapshot = snapshotFor(key, entry.data.userId)
        if (snapshot) entry.emit("game:state", snapshot)
      }
    } catch (error) {
      console.error("[game] не удалось разослать состояние", error)
    }
  }

  /**
   * Применяет действие бота через тот же applyUserProposal, что и для человека.
   * Готовность к следующей раздаче идёт через setReady.
   * Возвращает true, если переход прошёл.
   */
  async function runBot(
    key: string,
    userId: string,
    command: BotCommand,
  ): Promise<boolean> {
    if (command.type === "ready") {
      return runTransition(key, (session) =>
        setReady(session, userId, nextSeed()),
      )
    }
    return runTransition(key, (session) =>
      applyUserProposal(session, userId, command),
    )
  }

  /**
   * Применяет переход сеанса и раздаёт события: ходы, раздачи, итоги, состояния.
   * Все переходы стола идут через per-key очередь (см. withRoomLock), а неожиданный
   * бросок внутри не уходит в необработанный rejection — это ошибка только этого
   * хода, а не всего сервера.
   * Возвращает true, если переход прошёл; ошибки валидации слышит только автор.
   */
  async function runTransition(
    key: string | null,
    transition: (session: SessionState) => SessionResult,
    report?: (message: string) => void,
  ): Promise<boolean> {
    if (!key) {
      report?.("Сначала сядь за стол")
      return false
    }
    try {
      return await withRoomLock(key, () => applyTransition(key, transition, report))
    } catch (error) {
      console.error("[game] переход упал", error)
      report?.("Что-то сломалось — попробуй ещё раз")
      return false
    }
  }

  async function applyTransition(
    key: string,
    transition: (session: SessionState) => SessionResult,
    report?: (message: string) => void,
  ): Promise<boolean> {
    const before = getSession(key)
    if (!before) {
      report?.("Партия не собралась — обнови страницу")
      return false
    }

    const applied = transition(before)
    if (!applied.ok) {
      report?.(applied.error)
      return false
    }

    saveSession(applied.outcome.session)

    for (const action of applied.outcome.actions) {
      if (action.type === "deal") {
        io.to(roomName(key)).emit("game:dealt", {
          roundNumber: action.roundNumber,
          dealer: action.dealer,
        })
      } else {
        io.to(roomName(key)).emit("game:action", action)
      }
    }
    if (applied.outcome.result) {
      io.to(roomName(key)).emit("game:round-result", applied.outcome.result)
    }

    await persistOutcome(key, before.status, applied.outcome.session)
    await broadcastGameState(key)

    // Ход за ботом — таймер на ответ. Под локом состояние совпадает с сохранённым,
    // но читаем заново: дешевле гонки с «устаревшим снапшотом до рассылки».
    scheduleBotTurn(key, getSession(key) ?? applied.outcome.session, runBot)
    return true
  }

  /** Партия доигралась: итоги в БД (места и счёт), статус стола — FINISHED. */
  async function persistOutcome(
    key: string,
    before: GameStatusId,
    session: SessionState,
  ) {
    if (session.status === "FINISHED") {
      stopBotTimer(key)
    }
    if (session.status !== "FINISHED" || before === "FINISHED") return

    const userIdBySeat = new Map(
      session.players.map((player) => [player.seat, player.userId]),
    )
    const standings = finalStandings(session.table).map((entry) => ({
      userId: userIdBySeat.get(entry.seat)!,
      place: entry.place,
      score: entry.score,
    }))

    try {
      await saveGameOutcome(key, standings)
    } catch (error) {
      console.error("[game] не удалось записать итоги партии", error)
      return
    }

    const context = roomContexts.get(key)
    if (context) {
      roomContexts.set(key, { ...context, status: "FINISHED" })
      broadcastState(key)
    }
    // Закрытый стол держим в памяти недолго: игроки посмотрят итоги и уйдут.
    scheduleRoomCleanup(key)
  }

  /**
   * Съезжающийся игрок поднимает сеанс партии, если его ещё нет.
   * В лобби состав обновляем при каждом приходе: люди садятся по одному.
   * Перезапуск сервера посреди партии: сеанс собирается заново и сдаёт свежую раздачу.
   */
  async function liftSession(context: ViewerContext) {
    if (context.status === "FINISHED") return
    if (!context.me && !context.settings.allowSpectators) return

    const freshPlayers = context.players.map((player) => ({
      userId: player.userId,
      nickname: player.nickname,
      seat: player.seat as 0 | 1 | 2,
      isHost: player.isHost,
      isBot: player.isBot,
      botLevel: player.botLevel,
    }))

    const session = ensureSession({
      key: context.key,
      gameId: context.gameId,
      bullet: context.settings.bullet,
      roundsLimit: context.settings.roundsLimit,
      rules: context.settings.rules,
      players: freshPlayers,
    })
    if (session.status === "LOBBY") {
      saveSession({ ...session, players: freshPlayers })
    }
    if (context.status !== "PLAYING" || session.round) return

    console.warn(`[game] стол ${context.key}: сеанс восстановлен после перезапуска`)
    const started = await runTransition(context.key, (current) =>
      startGame(current, nextSeed()),
    )
    if (started) {
      roomContexts.set(context.key, { ...context, status: "PLAYING" })
    }
  }

  io.use((socket, next) => {
    // Cookie с подписью: сырой (или подделанный) userId сюда не пройдёт.
    const rawToken = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE)
    const userId = verifySessionToken(rawToken)
    if (!userId) {
      next(new Error("Нет сессии игрока — открой стол по ссылке"))
      return
    }
    socket.data.userId = userId
    socket.data.key = null
    socket.data.nickname = null
    socket.data.recentMessages = []
    next()
  })

  io.on("connection", (socket) => {
    const reportGameError = (message: string) =>
      socket.emit("game:error", { message })

    socket.on("room:join", async (payload) => {
      try {
        const key = normalizeGameKey(String(payload?.key ?? ""))

        const context = key
          ? await findViewerContext(key, socket.data.userId)
          : null

        if (!context) {
          socket.emit("room:error", {
            message: "Стол не найден или ты за ним не сидишь",
          })
          return
        }

        if (!context.me && !context.settings.allowSpectators) {
          socket.emit("room:error", {
            message: "Все места заняты, смотреть за этим столом нельзя",
          })
          return
        }

        if (socket.data.key && socket.data.key !== key) {
          await socket.leave(roomName(socket.data.key))
          removePresence(socket.data.key, socket.data.userId)
          broadcastState(socket.data.key)
        }

        socket.data.key = key
        socket.data.nickname = context.me?.nickname ?? null
        updateContext(key, context)
        addPresence(key, socket.data.userId)
        cancelRoomCleanup(key)

        await socket.join(roomName(key))
        await liftSession(context)
        broadcastState(key)

        const snapshot = snapshotFor(key, socket.data.userId)
        if (snapshot) {
          socket.emit("game:state", snapshot)
        } else if (context.status === "FINISHED") {
          // Сеанс не пережил перезапуск: собираем снимок закрытой партии из БД.
          const standings = await getGameStandings(key)
          socket.emit(
            "game:state",
            finishedSnapshot({
              key,
              players: context.players.map((player) => ({
                seat: player.seat as 0 | 1 | 2,
                userId: player.userId,
                nickname: player.nickname,
                isHost: player.isHost,
                isBot: player.isBot,
                botLevel: player.botLevel,
              })),
              rules: context.settings.rules,
              bulletTarget: context.settings.bullet,
              roundsLimit: context.settings.roundsLimit,
              mySeat: (context.me?.seat ?? null) as 0 | 1 | 2 | null,
              standings,
            }),
          )
        }
      } catch (error) {
        // Ошибка БД при входе не должна становиться unhandled rejection.
        console.error("[room] не удалось войти за стол", error)
        socket.emit("room:error", { message: "Не получилось войти за стол" })
      }
    })

    // Сокет один на вкладку и переживает переходы между экранами: уходя со стола,
    // клиент явно сообщает об этом, чтобы не висеть в presence до закрытия вкладки.
    socket.on("room:leave", async (payload) => {
      try {
        const key = normalizeGameKey(String(payload?.key ?? ""))
        if (!key || socket.data.key !== key) return
        socket.data.key = null
        socket.data.nickname = null
        await socket.leave(roomName(key))
        removePresence(key, socket.data.userId)
        broadcastState(key)
        if (!onlineUserIds(key).length) scheduleRoomCleanup(key)
      } catch (error) {
        console.error("[room] не удалось покинуть стол", error)
      }
    })

    socket.on("chat:send", async (payload) => {
      const key = socket.data.key
      const nickname = socket.data.nickname
      if (!key || !nickname) {
        socket.emit("chat:error", { message: "Сначала сядь за стол" })
        return
      }

      const parsed = chatTextSchema.safeParse(payload?.text ?? "")
      if (!parsed.success) {
        socket.emit("chat:error", {
          message: parsed.error.issues[0]?.message ?? "Не получилось отправить",
        })
        return
      }

      const context =
        roomContexts.get(key) ?? (await findViewerContext(key, socket.data.userId))
      if (!context || !context.me) {
        socket.emit("chat:error", { message: "Стол больше не доступен" })
        return
      }
      updateContext(key, context)

      // Лимит списываем только у тех, кто дошёл до отправки:
      // ошибки валидации и недоступного стола не должны съедать слот.
      if (isRateLimited(socket.data)) {
        socket.emit("chat:error", { message: "Слишком часто, переведи дух" })
        return
      }

      try {
        const message = await saveChatMessage({
          gameId: context.gameId,
          userId: socket.data.userId,
          nickname,
          text: parsed.data,
        })
        io.to(roomName(key)).emit("chat:new", message)
      } catch (error) {
        console.error("[chat] не удалось сохранить сообщение", error)
        socket.emit("chat:error", { message: "Сообщение не отправилось" })
      }
    })

    socket.on("game:start", async () => {
      const key = socket.data.key
      const session = key ? getSession(key) : null
      if (!key || !session) {
        reportGameError("Стол ещё не собрался")
        return
      }

      const me = session.players.find(
        (player) => player.userId === socket.data.userId,
      )
      if (!me) {
        reportGameError("Играть могут только сидящие за столом")
        return
      }
      if (!me.isHost) {
        reportGameError("Начать партию может хозяин стола")
        return
      }

      const started = await runTransition(
        key,
        // Применяем от фактического состояния стола, а не от снапшота,
        // снятого до проверок: transition получит current из-под лока.
        (current) => startGame(current, nextSeed()),
        reportGameError,
      )
      if (!started) return

      const context = roomContexts.get(key)
      if (context) {
        roomContexts.set(key, { ...context, status: "PLAYING" })
        broadcastState(key)
      }
      try {
        await markGamePlaying(key)
      } catch (error) {
        console.error("[game] не удалось обновить статус стола", error)
      }
    })

    socket.on("game:bid", (payload) => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, {
            type: "bid",
            level: Number(payload?.level),
            trump: payload?.trump,
          }),
        reportGameError,
      )
    })

    socket.on("game:misere", () => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, { type: "misere" }),
        reportGameError,
      )
    })

    socket.on("game:pass", () => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, { type: "pass" }),
        reportGameError,
      )
    })

    socket.on("game:declare", (payload) => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, {
            type: "declare",
            contract: payload?.contract,
            discard: payload?.discard,
            level: payload?.level,
            trump: payload?.trump,
          }),
        reportGameError,
      )
    })

    socket.on("game:prikup-ack", () => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, { type: "prikup-ack" }),
        reportGameError,
      )
    })

    socket.on("game:trick-ack", () => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, { type: "trick-ack" }),
        reportGameError,
      )
    })

    socket.on("game:whist", (payload) => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, {
            type: "whist",
            whist: payload?.whist,
          }),
        reportGameError,
      )
    })

    socket.on("game:card", (payload) => {
      void runTransition(
        socket.data.key,
        (session) =>
          applyUserProposal(session, socket.data.userId, {
            type: "play",
            card: payload?.card,
          }),
        reportGameError,
      )
    })

    socket.on("game:ready", () => {
      void runTransition(
        socket.data.key,
        (session) => setReady(session, socket.data.userId, nextSeed()),
        reportGameError,
      )
    })

    socket.on("game:bot-seat", async (payload) => {
      const key = socket.data.key
      const session = key ? getSession(key) : null
      if (!key || !session) {
        reportGameError("Стол ещё не собрался")
        return
      }

      const me = session.players.find(
        (player) => player.userId === socket.data.userId,
      )
      if (!me) {
        reportGameError("Играть могут только сидящие за столом")
        return
      }
      if (!me.isHost) {
        reportGameError("Сажать ботов может только хозяин стола")
        return
      }
      if (session.status !== "LOBBY") {
        reportGameError("Ботов можно сажать только в лобби")
        return
      }

      const seat = Number(payload?.seat)
      const level = normalizeBotLevel(payload?.level)
      if (seat < 0 || seat >= 3 || !Number.isInteger(seat)) {
        reportGameError("Некорректное место")
        return
      }
      const taken = session.players.some((player) => player.seat === seat)
      if (taken) {
        reportGameError("Место уже занято")
        return
      }

      try {
        // Вся посадка — под локом стола: пока сажаем бота, партия не может стартовать
        // (game:start идёт через ту же очередь), и бот не «долетит» в идущую игру.
        await withRoomLock(key, async () => {
          // Перепроверяем под локом: пока читали БД, состояние могло измениться.
          const current = getSession(key)
          if (!current || current.status !== "LOBBY") {
            reportGameError("Ботов можно сажать только в лобби")
            return
          }

          const game = await prisma.game.findUnique({
            where: { key },
            select: { id: true },
          })
          if (!game) {
            reportGameError("Стол не найден")
            return
          }

          await addBotPlayer(game.id, seat, level)

          const context = await findViewerContext(key, socket.data.userId)
          if (!context) {
            reportGameError("Стол больше не доступен")
            return
          }

          const freshPlayers = context.players.map((player) => ({
            userId: player.userId,
            nickname: player.nickname,
            seat: player.seat as 0 | 1 | 2,
            isHost: player.isHost,
            isBot: player.isBot,
            botLevel: player.botLevel,
          }))

          const updated = ensureSession({
            key: context.key,
            gameId: context.gameId,
            bullet: context.settings.bullet,
            roundsLimit: context.settings.roundsLimit,
            rules: context.settings.rules,
            players: freshPlayers,
          })
          if (updated.status === "LOBBY") {
            // Существующий сеанс не трогаем по правилам: обновляем только состав.
            saveSession({ ...updated, players: freshPlayers })
          }

          updateContext(key, context)
          broadcastState(key)
          await broadcastGameState(key)
        })
      } catch (error) {
        console.error("[bot] не удалось посадить бота", error)
        reportGameError("Не удалось посадить бота")
      }
    })

    socket.on("game:bot-remove", async (payload) => {
      const key = socket.data.key
      const session = key ? getSession(key) : null
      if (!key || !session) {
        reportGameError("Стол ещё не собрался")
        return
      }

      const me = session.players.find(
        (player) => player.userId === socket.data.userId,
      )
      if (!me || !me.isHost) {
        reportGameError("Убирать ботов может только хозяин стола")
        return
      }
      if (session.status !== "LOBBY") {
        reportGameError("Ботов можно убирать только в лобби")
        return
      }

      const seat = Number(payload?.seat)
      if (seat < 0 || seat >= 3 || !Number.isInteger(seat)) {
        reportGameError("Некорректное место")
        return
      }

      const bot = session.players.find(
        (player) => player.seat === seat && player.isBot,
      )
      if (!bot) {
        reportGameError("На этом месте нет бота")
        return
      }

      try {
        // Уборка бота — тоже под локом: состав стола не должен меняться
        // параллельно со стартом партии или посадкой другого бота.
        await withRoomLock(key, async () => {
          const current = getSession(key)
          if (!current || current.status !== "LOBBY") {
            reportGameError("Ботов можно убирать только в лобби")
            return
          }

          const game = await prisma.game.findUnique({
            where: { key },
            select: { id: true },
          })
          if (!game) {
            reportGameError("Стол не найден")
            return
          }

          const playerRecord = await prisma.gamePlayer.findFirst({
            where: { gameId: game.id, userId: bot.userId },
            select: { id: true },
          })
          if (playerRecord) {
            await prisma.gamePlayer.delete({ where: { id: playerRecord.id } })
          }

          const context = await findViewerContext(key, socket.data.userId)
          if (!context) {
            reportGameError("Стол больше не доступен")
            return
          }

          const freshPlayers = context.players.map((player) => ({
            userId: player.userId,
            nickname: player.nickname,
            seat: player.seat as 0 | 1 | 2,
            isHost: player.isHost,
            isBot: player.isBot,
            botLevel: player.botLevel,
          }))

          const updated = ensureSession({
            key: context.key,
            gameId: context.gameId,
            bullet: context.settings.bullet,
            roundsLimit: context.settings.roundsLimit,
            rules: context.settings.rules,
            players: freshPlayers,
          })
          if (updated.status === "LOBBY") {
            saveSession({ ...updated, players: freshPlayers })
          }

          updateContext(key, context)
          broadcastState(key)
          await broadcastGameState(key)
        })
      } catch (error) {
        console.error("[bot] не удалось убрать бота", error)
        reportGameError("Не удалось убрать бота")
      }
    })

    socket.on("disconnect", () => {
      const key = socket.data.key
      if (!key) return
      removePresence(key, socket.data.userId)
      broadcastState(key)
      // Стол опустел — держим его в памяти ограниченное время (TTL),
      // а не вечно: игрок мог потерять связь и вернуться, но партия
      // без людей всё равно не двигается.
      if (!onlineUserIds(key).length) scheduleRoomCleanup(key)
    })
  })

  return io
}
