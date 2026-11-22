"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Candle } from "@/components/candle"
import { HandFan } from "@/components/cards/hand-fan"
import { settingsSummary, statusLabel } from "@/lib/format"
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
}

export function TableScreen({ view, inviteUrl }: TableScreenProps) {
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

  const startGame = useCallback(
    () => emitGame((socket) => socket.emit("game:start", {})),
    [emitGame],
  )
  const sendBid = useCallback(
    (level: number, trump: Trump) =>
      emitGame((socket) => socket.emit("game:bid", { level, trump })),
    [emitGame],
  )
  const sendPass = useCallback(
    () => emitGame((socket) => socket.emit("game:pass", {})),
    [emitGame],
  )
  const sendDeclare = useCallback(
    (contract: "game" | "misere", discard: string[]) =>
      emitGame((socket) => socket.emit("game:declare", { contract, discard: discard as Card[] })),
    [emitGame],
  )
  const sendWhist = useCallback(
    (whist: boolean) => emitGame((socket) => socket.emit("game:whist", { whist })),
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
      if (!game?.mySeat || !round) return

      if (round.phase === "play" && round.turn === game.mySeat) {
        if (game.myLegalMoves.includes(card)) sendCard(card)
        return
      }
      if (round.phase === "declaring" && round.declarer === game.mySeat) {
        setDiscardPick((previous) =>
          previous.includes(card)
            ? previous.filter((entry) => entry !== card)
            : previous.length >= 2
              ? previous
              : [...previous, card],
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
    if (!game?.mySeat || !round) return null
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

  const handNote = !game
    ? null
    : game.status === "LOBBY"
      ? "ждём сдачу — партию начнёт хозяин стола"
      : game.mySeat === null
        ? "ты зритель — чужие карты не показываем"
        : null

  const seatRole = (seat: number, isHost: boolean): string => {
    if (!round) return isHost ? "хозяин стола" : "игрок"
    if (round.declarer === seat) return "играющий"
    if (round.whist[seat] === true) return "вистующий"
    return isHost ? "хозяин стола" : "игрок"
  }

  const backsFor = (seat: number, seated: boolean): number => {
    if (!round) return seated ? 4 : 0
    return round.handSizes[seat] ?? 0
  }

  const onlineCount = room?.onlineCount ?? 0
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
          <span className="chip chip--status">{statusLabel(view.status)}</span>
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
            role={
              layout.left
                ? seatRole(layout.left.seat, layout.left.isHost)
                : "пустует"
            }
            online={layout.left?.online ?? null}
            isBot={layout.left?.isBot ?? false}
            botLevel={layout.left?.botLevel ?? null}
            isHost={layout.meIsHost}
            seat={leftSeatNum}
            onBotSeat={sendBotSeat}
            onBotRemove={sendBotRemove}
            backs={backsFor(layout.left?.seat ?? -1, layout.left !== null)}
          />

          <SeatPlate
            position="right"
            nickname={layout.right?.nickname ?? null}
            role={
              layout.right
                ? seatRole(layout.right.seat, layout.right.isHost)
                : "пустует"
            }
            online={layout.right?.online ?? null}
            isBot={layout.right?.isBot ?? false}
            botLevel={layout.right?.botLevel ?? null}
            isHost={layout.meIsHost}
            seat={rightSeatNum}
            onBotSeat={sendBotSeat}
            onBotRemove={sendBotRemove}
            backs={backsFor(layout.right?.seat ?? -1, layout.right !== null)}
          />

          <SeatPlate
            position="self"
            nickname={layout.bottom?.nickname ?? null}
            role={
              layout.bottom
                ? seatRole(layout.bottom.seat, layout.bottom.isHost)
                : "пустует"
            }
            online={layout.bottom?.online ?? null}
            isBot={layout.bottom?.isBot ?? false}
            botLevel={layout.bottom?.botLevel ?? null}
            isMe={layout.bottomIsMe}
            isHost={layout.meIsHost}
            backs={0}
          />
        </div>

        {game && game.status !== "FINISHED" ? (
          <GameActions
            snapshot={game}
            discardPick={discardPick}
            lastResult={lastResult}
            onBid={sendBid}
            onPass={sendPass}
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
        error={chatError ?? gameError ?? roomError}
        disabled={!myUserId}
        onSend={sendChat}
      />

      {game?.status === "FINISHED" ? (
        <ResultVeil standings={game.standings} players={game.players} />
      ) : null}

      {!myUserId ? (
        <JoinVeil
          gameKey={view.key}
          settings={view.settings}
          seatsTaken={view.seats.length}
        />
      ) : null}
    </div>
  )
}
