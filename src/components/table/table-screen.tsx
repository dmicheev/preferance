"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Candle } from "@/components/candle"
import { HandFan } from "@/components/cards/hand-fan"
import { bidText, settingsSummary, statusLabel } from "@/lib/format"
import { PLAYER_COUNT } from "@/lib/preference/constants"
import { soloWhistController } from "@/lib/preference/round"
import type { Card, Trump } from "@/lib/preference/cards"
import type { Seat } from "@/lib/preference/round"
import { rulesetSummary } from "@/lib/preference/score"
import type {
  ChatMessageView,
  GameSnapshot,
  GameView,
  RoomState,
  RoundResultView,
} from "@/lib/protocol"
import { useVoiceChat } from "@/lib/use-voice-chat"
import { getGameSocket, type GameSocket } from "@/lib/socket-client"

import { ChatDock } from "./chat-dock"
import { GameActions } from "./game-actions"
import { GameBoard, type TrickPosition } from "./game-board"
import { JoinVeil } from "./join-veil"
import { ResultVeil } from "./result-veil"
import { ScoreBoard } from "./score-board"
import { SeatPlate } from "./seat-plate"
import { TableEmblem } from "./table-emblem"

type TableScreenProps = {
  view: GameView
  /** Адрес приглашения, собранный на сервере. */
  inviteUrl: string
  /** Запомненное имя из печенья — для подстановки в форму входа. */
  storedNickname?: string
}

export function TableScreen({ view, inviteUrl, storedNickname = "" }: TableScreenProps) {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [messages, setMessages] = useState<ChatMessageView[]>(view.chat)
  const [chatBase, setChatBase] = useState<ChatMessageView[]>(view.chat)
  const [chatError, setChatError] = useState<string | null>(null)
  const [roomError, setRoomError] = useState<string | null>(null)
  const [game, setGame] = useState<GameSnapshot | null>(null)
  const [gameError, setGameError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<RoundResultView | null>(null)
  const [discardPick, setDiscardPick] = useState<Card[]>([])
  const [connected, setConnected] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const myUserId = view.me?.userId ?? null
  const myNickname = view.me?.nickname ?? null

  useEffect(() => {
    if (!myUserId) return

    const socket = getGameSocket()

    const handleConnect = () => {
      setConnected(true)
      socket.emit("room:join", { key: view.key })
    }
    const handleDisconnect = () => setConnected(false)
    const handleState = (state: RoomState) => {
      setRoom(state)
      setRoomError(null)
    }
    const handleGameState = (snapshot: GameSnapshot) => {
      setGame(snapshot)
      setGameError(null)
      // Итог раздачи подтягиваем и из снапшота: кто-то заходит в паузу готовности,
      // когда game:round-result давно прошёл — «считаем взятки…» не должно висеть.
      setLastResult(snapshot.lastRoundResult ?? null)
      // Снос живёт только в фазе прикупа.
      if (snapshot.round?.phase !== "declaring") setDiscardPick([])
    }
    const handleGameAction = () => {}
    const handleDealt = () => {
      setDiscardPick([])
      setLastResult(null)
    }
    const handleRoundResult = (result: RoundResultView) => setLastResult(result)
    const handleMessage = (message: ChatMessageView) => {
      setMessages((previous) =>
        previous.some((item) => item.id === message.id)
          ? previous
          : [...previous, message],
      )
    }
    const handleChatError = (payload: { message: string }) => {
      setChatError(payload.message)
    }
    const handleRoomError = (payload: { message: string }) => {
      setRoomError(payload.message)
    }
    const handleGameError = (payload: { message: string }) => {
      setGameError(payload.message)
    }

    socket.on("connect", handleConnect)
    socket.on("disconnect", handleDisconnect)
    socket.on("room:state", handleState)
    socket.on("game:state", handleGameState)
    socket.on("game:action", handleGameAction)
    socket.on("game:dealt", handleDealt)
    socket.on("game:round-result", handleRoundResult)
    socket.on("game:error", handleGameError)
    socket.on("chat:new", handleMessage)
    socket.on("chat:error", handleChatError)
    socket.on("room:error", handleRoomError)

    if (socket.connected) handleConnect()
    else socket.connect()

    return () => {
      socket.off("connect", handleConnect)
      socket.off("disconnect", handleDisconnect)
      socket.off("room:state", handleState)
      socket.off("game:state", handleGameState)
      socket.off("game:action", handleGameAction)
      socket.off("game:dealt", handleDealt)
      socket.off("game:round-result", handleRoundResult)
      socket.off("game:error", handleGameError)
      socket.off("chat:new", handleMessage)
      socket.off("chat:error", handleChatError)
      socket.off("room:error", handleRoomError)
      // Сокет живёт дольше экрана, но покидать комнату надо сразу:
      // иначе уходим в зал и до закрытия вкладки числимся «за столом».
      socket.emit("room:leave", { key: view.key })
    }
  }, [myUserId, view.key])

  // После router.refresh() сервер присылает свежую историю — подменяем локальную.
  if (view.chat !== chatBase) {
    setChatBase(view.chat)
    setMessages(view.chat)
  }

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const emitGame = useCallback(
    (send: (socket: GameSocket) => void) => {
      const socket = getGameSocket()
      if (!socket.connected) {
        setGameError("Нет связи со столом — проверь интернет")
        return
      }
      setGameError(null)
      send(socket)
    },
    [],
  )

  const sendChat = useCallback(
    (text: string) => emitGame((socket) => socket.emit("chat:send", { text })),
    [emitGame],
  )

  const { voice, joinVoice, leaveVoice, toggleMic, toggleDeafen } = useVoiceChat()

  const startGame = useCallback(
    () => emitGame((socket) => socket.emit("game:start", {})),
    [emitGame],
  )
  const sendBid = useCallback(
    (level: number, trump: Trump) =>
      emitGame((socket) => socket.emit("game:bid", { level, trump })),
    [emitGame],
  )
  const sendMisere = useCallback(
    () => emitGame((socket) => socket.emit("game:misere", {})),
    [emitGame],
  )
  const sendPass = useCallback(
    () => emitGame((socket) => socket.emit("game:pass", {})),
    [emitGame],
  )
  const sendDeclare = useCallback(
    (
      contract: "game" | "misere",
      discard: string[],
      raise?: { level: number; trump: Trump },
    ) =>
      emitGame((socket) =>
        socket.emit("game:declare", {
          contract,
          discard: discard as Card[],
          level: raise?.level,
          trump: raise?.trump,
        }),
      ),
    [emitGame],
  )
  const sendWhist = useCallback(
    (whist: boolean) => emitGame((socket) => socket.emit("game:whist", { whist })),
    [emitGame],
  )
  const sendPrikupAck = useCallback(
    () => emitGame((socket) => socket.emit("game:prikup-ack", {})),
    [emitGame],
  )
  const sendTrickAck = useCallback(
    () => emitGame((socket) => socket.emit("game:trick-ack", {})),
    [emitGame],
  )
  const sendCard = useCallback(
    (card: Card) => emitGame((socket) => socket.emit("game:card", { card })),
    [emitGame],
  )
  const sendReady = useCallback(
    () => emitGame((socket) => socket.emit("game:ready", {})),
    [emitGame],
  )

  const sendBotSeat = useCallback(
    (seat: number, level: string) =>
      emitGame((socket) => socket.emit("game:bot-seat", { seat, level })),
    [emitGame],
  )

  const sendBotRemove = useCallback(
    (seat: number) =>
      emitGame((socket) => socket.emit("game:bot-remove", { seat })),
    [emitGame],
  )

  const copyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setChatError("Ссылку не скопировать — выдели ключ вручную")
    }
  }, [inviteUrl])

  const handleCardClick = useCallback(
    (card: Card) => {
      const round = game?.round
      // Место игрока бывает нулевым (хозяин стола): сравниваем с null, а не с falsy.
      if (game?.mySeat === null || game?.mySeat === undefined || !round) return

      if (round.phase === "play" && round.turn === game.mySeat) {
        if (game.myLegalMoves.includes(card)) {
          sendCard(card)
        } else {
          // Молчаливый игнор выглядит как «сломанные клики»: объясняем, почему нельзя.
          setGameError("Эту карту сейчас не сыграть — ходи в масть или козыря")
        }
        return
      }
      if (round.phase === "declaring") {
        // Снос открывается только после того, как все посмотрели прикуп.
        if (round.declarer !== game.mySeat) {
          setGameError("прикуп разбирает другой игрок")
          return
        }
        if (round.prikupAck.length < PLAYER_COUNT) {
          setGameError("сначала все нажимают «Ок» на открытый прикуп")
          return
        }
        setDiscardPick((previous) =>
          previous.includes(card)
            ? previous.filter((entry) => entry !== card)
            : previous.length >= 2
              ? previous
              : [...previous, card],
        )
        return
      }
      // Клик вне своей очереди: подсказываем, что происходит, вместо тишины.
      if (round.phase === "play") {
        setGameError(
          round.turn === null && round.trickAck.length < PLAYER_COUNT
            ? "сначала все смотрят собранную взятку"
            : "сейчас не твой ход",
        )
      }
    },
    [game, sendCard],
  )

  const seats = useMemo(() => {
    // Живой состав берём из снапшота партии: он обновляется по сокету сразу
    // после посадки бота; view.seatsDetail — только серверный рендер.
    const source = game?.players.length ? game.players : view.seatsDetail
    return source.map((seat) => ({
      userId: seat.userId,
      nickname: seat.nickname,
      seat: seat.seat,
      isHost: seat.isHost,
      isBot: seat.isBot,
      botLevel: seat.botLevel,
      online: room ? room.onlineUserIds.includes(seat.userId) : null,
    }))
  }, [game, view.seatsDetail, room])

  const layout = useMemo(() => {
    const me = seats.find((seat) => seat.userId === myUserId) ?? null
    const others = seats
      .filter((seat) => seat.userId !== myUserId)
      .sort((left, right) => left.seat - right.seat)

    const bottom = me ?? others[2] ?? null
    const positions = {} as Record<Seat, TrickPosition>
    if (bottom) positions[bottom.seat as Seat] = "self"
    if (others[0]) positions[others[0].seat as Seat] = "left"
    if (others[1]) positions[others[1].seat as Seat] = "right"

    return {
      bottom,
      bottomIsMe: me !== null,
      meIsHost: me?.isHost ?? false,
      left: others[0] ?? null,
      right: others[1] ?? null,
      positions,
    }
  }, [seats, myUserId])

  const round = game?.round ?? null
  const dealer = useMemo(
    () =>
      round
        ? game?.players.find((player) => player.seat === round.dealer) ?? null
        : null,
    [game, round],
  )

  const playableSet = useMemo(() => {
    // Место бывает нулевым (хозяин стола): сравниваем с null, иначе его рука не подсвечивается.
    if (game?.mySeat === null || game?.mySeat === undefined || !round) return null
    if (round.phase === "play" && round.turn === game.mySeat) {
      return new Set<Card>(game.myLegalMoves)
    }
    if (round.phase === "declaring" && round.declarer === game.mySeat) return null
    return new Set<Card>()
  }, [game, round])

  const selectedSet = useMemo(
    () => (round?.phase === "declaring" ? new Set<Card>(discardPick) : null),
    [round, discardPick],
  )

  /** Реплики над местами: заказ игры или пас — как разговор за столом. */
  const balloons = useMemo(() => {
    const result: Partial<Record<TrickPosition, { text: string; tone: "bid" | "pass" }>> = {}
    if (!game || !round) return result

    const forSeat = (seat: number | null | undefined) => {
      if (seat === null || seat === undefined) return null
      if (round.phase === "bidding") {
        const bid = round.bids[seat as Seat]
        if (bid === "pass") return { text: "пас", tone: "pass" as const }
        if (bid) return { text: bidText(bid), tone: "bid" as const }
        return null
      }
      // После торговли заказ играющего висит над его местом до конца раздачи.
      if (round.declarer !== seat) return null
      if (round.contract) {
        if (round.contract.kind === "misere") return { text: "мизер", tone: "bid" as const }
        if (round.contract.kind === "game") {
          return {
            text: bidText({ level: round.contract.level, trump: round.contract.trump }),
            tone: "bid" as const,
          }
        }
        return null
      }
      // Фаза сноса: контракт ещё не подтверждён — показываем выигрышный заказ.
      return round.highest && round.highest.seat === seat
        ? { text: bidText(round.highest.bid), tone: "bid" as const }
        : null
    }

    const left = forSeat(layout.left?.seat)
    const right = forSeat(layout.right?.seat)
    const self = forSeat(layout.bottom?.seat)
    if (left) result.left = left
    if (right) result.right = right
    if (self) result.self = self
    return result
  }, [game, round, layout])

  // Пасующий при одиночном висте выбыл: его рукой ходит вистующий.
  const whistController = round ? soloWhistController(round) : null
  const iAmPasser =
    game?.mySeat !== null &&
    game?.mySeat !== undefined &&
    whistController !== null &&
    round !== null &&
    round.declarer !== game.mySeat &&
    whistController !== game.mySeat

  const handNote = !game
    ? null
    : game.status === "LOBBY"
      ? "ждём сдачу — партию начнёт хозяин стола"
      : iAmPasser
        ? `ходами за тебя ведёт ${game.players.find((player) => player.seat === whistController)?.nickname ?? "вистующий"} — твоя рука закрыта`
        : game.mySeat === null
          ? "ты зритель — чужие карты не показываем"
          : null

  const seatRole = (isHost: boolean): string => (isHost ? "хозяин стола" : "игрок")

  /**
   * Статус места в раздаче: заказал игру, вистует или спасовал.
   * Держится от торговли до записи раздачи — решение на вист не теряется.
   */
  const playStateFor = (
    seat: number | null | undefined,
  ): { text: string; tone: "game" | "whist" | "pass" } | null => {
    if (!round || seat === null || seat === undefined) return null
    if (round.phase === "bidding") {
      const bid = round.bids[seat as Seat]
      if (bid === "pass") return { text: "пас", tone: "pass" }
      if (bid) return { text: "игра", tone: "game" }
      return null
    }
    if (round.declarer === seat) {
      return {
        text: round.contract?.kind === "misere" ? "мизер" : "игра",
        tone: "game",
      }
    }
    // В фазе виста чужой пас из торговли не показываем: место ещё не отвечало
    // на вопрос «вистовать?» — бейдж появится с решением.
    if (round.phase === "whist") {
      if (round.whist[seat as Seat] === true) return { text: "вист", tone: "whist" }
      if (round.whist[seat as Seat] === false) return { text: "пас", tone: "pass" }
      return null
    }
    if (round.whist[seat as Seat] === true) return { text: "вист", tone: "whist" }
    if (round.whist[seat as Seat] === false || round.bids[seat as Seat] === "pass") {
      return { text: "пас", tone: "pass" }
    }
    return null
  }

  // Взятки на руках показываем с начала розыгрыша и до записи раздачи.
  const showTricks =
    round !== null && (round.phase === "play" || round.phase === "scored")
  const tricksFor = (seat: number): number | undefined =>
    showTricks ? (round?.tricks[seat] ?? 0) : undefined

  const backsFor = (seat: number, seated: boolean): number => {
    if (!round) return seated ? 4 : 0
    return round.handSizes[seat] ?? 0
  }

  // Мизер играется в открытую: руки защитников видны всем, рука играющего закрыта.
  // Одиночный вист: рука вистующего открыта всем, а карты пасующего видит
  // только сам вистующий — он ходит за двоих.
  // Свои карты не дублируем — они и так лежат в веере внизу.
  const openCardsFor = (seat: number | null | undefined): Card[] | null => {
    if (!round || seat === null || seat === undefined) return null
    if (seat === game?.mySeat) return null
    const entry = round.openHands.find((item) => item.seat === seat)
    if (entry) return entry.cards
    if (game?.partnerSeat === seat && game.partnerHand.length > 0) {
      return game.partnerHand
    }
    return null
  }

  // Ход картой пасующего: клики по открытым картам на его месте.
  const handlePartnerCard = useCallback(
    (card: Card) => {
      if (!game || !round) return
      if (round.phase === "play" && round.turn === game.partnerSeat) {
        if (game.partnerLegalMoves.includes(card)) {
          sendCard(card)
        } else {
          setGameError("Эту карту за пасующего не сыграть — ходи в масть")
        }
        return
      }
      setGameError("Сейчас ход не за пасующего")
    },
    [game, round, sendCard],
  )

  const partnerClickFor = (seat: number | null | undefined):
    | ((card: Card) => void)
    | undefined => {
    if (game?.partnerSeat === null || game?.partnerSeat === undefined) return undefined
    return seat === game.partnerSeat ? handlePartnerCard : undefined
  }

  const onlineCount = room?.onlineCount ?? 0
  // Статус берём из room:state, если он уже приходил: серверный view.status
  // застыл на момент рендера и после старта партии показывает «Лобби».
  const tableStatus = room?.status ?? view.status
  const lobbyEditable = layout.meIsHost && tableStatus === "LOBBY"
  const dealNumber = game ? game.roundsPlayed + (round ? 1 : 0) : 0

  // Номер места для посадки бота: на пустом месте игрока нет, считаем по кругу от своего.
  const seatNumberFor = (position: "left" | "right", occupantSeat: number | null): number => {
    if (occupantSeat !== null && occupantSeat >= 0) return occupantSeat
    const mySeat = view.me?.seat ?? -1
    if (mySeat < 0) return -1
    return position === "left" ? (mySeat + 1) % 3 : (mySeat + 2) % 3
  }
  const leftSeatNum = seatNumberFor("left", layout.left?.seat ?? null)
  const rightSeatNum = seatNumberFor("right", layout.right?.seat ?? null)

  return (
    <div className="table-screen">
      <header className="topbar">
        <div className="topbar__brand">
          <strong>Преферанс клуб</strong>
          <span>преферанс</span>
        </div>

        <div className="topbar__tools">
          <span className="chip chip--key" title="Ключ стола">
            {view.key}
            <button
              className="icon-button"
              type="button"
              onClick={copyInvite}
              aria-label="Скопировать ссылку-приглашение"
            >
              {copied ? "✓" : "⧉"}
            </button>
          </span>
          <span className="chip chip--status">{statusLabel(tableStatus)}</span>
          <span className="chip">{settingsSummary(view.settings)}</span>
          <span className="chip chip--rules" title="Очки за игры, мизер и висты">
            {rulesetSummary(view.settings.rules)}
          </span>
          {dealNumber > 0 ? (
            <span className="chip" title="Номер текущей раздачи">
              раздача {dealNumber}
            </span>
          ) : null}
          {view.settings.allowSpectators ? <span className="chip">зрители</span> : null}
          {myUserId && !connected ? (
            <span className="chip chip--ghost">нет связи</span>
          ) : null}
          <Link className="chip" href="/">
            выйти
          </Link>
        </div>
      </header>

      <div className="board">
        <div className="table-zone">
          <div className="table__rail">
            <div className="table__felt">
              <span className="table__edge" />
              <span className="table__light table__light--left" />
              <span className="table__light table__light--right" />
              <span className="table__light table__light--top" />
              <TableEmblem className="table__emblem" />
            </div>
          </div>

          {round ? (
            <GameBoard round={round} seatPositions={layout.positions} />
          ) : null}

          {game && game.status !== "LOBBY" ? (
            <ScoreBoard
              table={game.table}
              players={game.players}
              round={round}
              mySeat={game.mySeat}
            />
          ) : null}

          <div className="table__candle table__candle--far-left">
            <Candle size="sm" delay={1.4} />
          </div>
          <div className="table__candle table__candle--far-right">
            <Candle size="sm" delay={2.6} />
          </div>
          <div className="table__candle table__candle--top-left">
            <Candle size="sm" delay={0.7} />
          </div>
          <div className="table__candle table__candle--top-right">
            <Candle size="sm" delay={3.1} />
          </div>

          <SeatPlate
            position="dummy"
            nickname={dealer ? dealer.nickname : null}
            role={dealer ? "сдаёт" : "по кругу"}
            backs={round && (round.phase === "bidding" || round.phase === "declaring") ? 2 : 0}
          />

          <SeatPlate
            position="left"
            nickname={layout.left?.nickname ?? null}
            role={layout.left ? seatRole(layout.left.isHost) : "пустует"}
            online={layout.left?.online ?? null}
            isBot={layout.left?.isBot ?? false}
            botLevel={layout.left?.botLevel ?? null}
            isHost={layout.meIsHost}
            canEdit={lobbyEditable}
            seat={leftSeatNum}
            onBotSeat={sendBotSeat}
            onBotRemove={sendBotRemove}
            backs={backsFor(layout.left?.seat ?? -1, layout.left !== null)}
            openCards={openCardsFor(layout.left?.seat)}
            onOpenCardClick={partnerClickFor(layout.left?.seat)}
            tricks={tricksFor(layout.left?.seat ?? -1)}
            balloon={balloons.left ?? null}
            playState={playStateFor(layout.left?.seat)}
          />

          <SeatPlate
            position="right"
            nickname={layout.right?.nickname ?? null}
            role={layout.right ? seatRole(layout.right.isHost) : "пустует"}
            online={layout.right?.online ?? null}
            isBot={layout.right?.isBot ?? false}
            botLevel={layout.right?.botLevel ?? null}
            isHost={layout.meIsHost}
            canEdit={lobbyEditable}
            seat={rightSeatNum}
            onBotSeat={sendBotSeat}
            onBotRemove={sendBotRemove}
            backs={backsFor(layout.right?.seat ?? -1, layout.right !== null)}
            openCards={openCardsFor(layout.right?.seat)}
            onOpenCardClick={partnerClickFor(layout.right?.seat)}
            tricks={tricksFor(layout.right?.seat ?? -1)}
            balloon={balloons.right ?? null}
            playState={playStateFor(layout.right?.seat)}
          />

          <SeatPlate
            position="self"
            nickname={layout.bottom?.nickname ?? null}
            role={layout.bottom ? seatRole(layout.bottom.isHost) : "пустует"}
            online={layout.bottom?.online ?? null}
            isBot={layout.bottom?.isBot ?? false}
            botLevel={layout.bottom?.botLevel ?? null}
            isMe={layout.bottomIsMe}
            isHost={layout.meIsHost}
            backs={0}
            openCards={openCardsFor(layout.bottom?.seat)}
            tricks={tricksFor(layout.bottom?.seat ?? -1)}
            balloon={balloons.self ?? null}
            playState={playStateFor(layout.bottom?.seat)}
          />
        </div>

        {/* Ошибки хода — над доком действий: это игровой фидбек, а не чат. */}
        {gameError ? (
          <p className="form-error" role="alert">
            {gameError}
          </p>
        ) : null}

        {game && game.status !== "FINISHED" ? (
          <GameActions
            snapshot={game}
            discardPick={discardPick}
            lastResult={lastResult}
            onBid={sendBid}
            onMisere={sendMisere}
            onPass={sendPass}
            onPrikupAck={sendPrikupAck}
            onTrickAck={sendTrickAck}
            onDeclare={sendDeclare}
            onWhist={sendWhist}
            onReady={sendReady}
            onStart={startGame}
          />
        ) : null}

        <HandFan
          cards={game?.myHand ?? []}
          playable={playableSet}
          selected={selectedSet}
          onCardClick={handleCardClick}
          note={handNote}
        />
      </div>

      <ChatDock
        messages={messages}
        myNickname={myNickname}
        onlineCount={onlineCount}
        error={chatError ?? roomError}
        disabled={!myUserId}
        onSend={sendChat}
        voice={voice}
        onVoiceJoin={joinVoice}
        onVoiceLeave={leaveVoice}
        onVoiceToggleMic={toggleMic}
        onVoiceToggleDeafen={toggleDeafen}
      />

      {game?.status === "FINISHED" ? (
        <ResultVeil
          gameKey={game.key}
          standings={game.standings}
          players={game.players}
        />
      ) : null}

      {!myUserId ? (
        <JoinVeil
          gameKey={view.key}
          settings={view.settings}
          seatsTaken={view.seats.length}
          storedNickname={storedNickname}
        />
      ) : null}
    </div>
  )
}
