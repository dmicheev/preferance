// Типы и имена событий, общие для клиента и сервера.
// Здесь нет ни Node-, ни React-зависимостей — файл безопасно импортировать откуда угодно.

export const CHAT_MAX_LENGTH = 300
export const NICKNAME_MAX_LENGTH = 16
export const NICKNAME_MIN_LENGTH = 2
export const SESSION_COOKIE = "pf_player"

import type { Card, Trump } from "./preference/cards"
import type {
  Bid,
  CompletedTrick,
  Contract,
  RoundPhase,
  Seat,
  TrickCard,
} from "./preference/round"
import type { Ruleset } from "./preference/rules"
import type { ScoreEntry, ScoreTable, Standing } from "./preference/score"

export type GameVariantId = "LENINGRADKA" | "SOCHINKA"
export type GameStatusId = "LOBBY" | "PLAYING" | "FINISHED"

export type GameSettingsView = {
  title: string | null
  variant: GameVariantId
  bullet: number
  roundsLimit: number | null
  maxPlayers: number
  allowSpectators: boolean
  /** Цифры очков: пресет или выбор хозяина стола. */
  rules: Ruleset
}

export type SeatView = {
  seat: number
  nickname: string
  isHost: boolean
}

export type ChatMessageView = {
  id: string
  nickname: string
  text: string
  at: number
}

export type HallSeatView = {
  userId: string
  nickname: string
  seat: number
  isHost: boolean
  isBot: boolean
  botLevel: string | null
}

export type GameView = {
  key: string
  status: GameStatusId
  settings: GameSettingsView
  seats: SeatView[]
  seatsDetail: HallSeatView[]
  chat: ChatMessageView[]
  me: { userId: string; nickname: string; seat: number } | null
}

export type RoomState = {
  key: string
  status: GameStatusId
  seats: SeatView[]
  onlineUserIds: string[]
  onlineCount: number
}

export type JoinRoomPayload = { key: string }
export type SendChatPayload = { text: string }
export type ChatErrorPayload = { message: string }
export type RoomErrorPayload = { message: string }

/** Участник голосового стола: один сокет = одна «гарнитура». */
export type VoicePeerView = {
  socketId: string
  userId: string
  nickname: string
}

/**
 * Ретранслируемые данные сигналинга: SDP-описание или ICE-кандидат.
 * Сервер содержимое не разбирает — только доставляет адресату.
 */
export type VoiceSignalData =
  | { kind: "desc"; description: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit }

export type VoiceJoinPayload = Record<string, never>
export type VoiceLeavePayload = Record<string, never>
export type VoiceSignalPayload = { to: string; data: VoiceSignalData }
export type VoiceSignalFromPayload = { from: string; data: VoiceSignalData }
export type VoicePeersPayload = { peers: VoicePeerView[] }
export type VoiceErrorPayload = { message: string }

/** Игрок сеанса: место и роль в текущей партии. */
export type GamePlayerView = {
  seat: Seat
  userId: string
  nickname: string
  isHost: boolean
  isBot: boolean
  botLevel: string | null
}

export type StandingView = Standing

/** Публичная часть раздачи: без рук и прикупа, только то, что видно за столом. */
export type RoundView = {
  phase: RoundPhase
  dealer: Seat
  turn: Seat | null
  bids: (Bid | "pass" | null)[]
  highest: { seat: Seat; bid: Bid } | null
  declarer: Seat | null
  contract: Contract | null
  /** Сколько карт снесено: 0 до сноса, 2 после. */
  discardCount: number
  /** Открытый прикуп: две карты лежат в открытую, пока все не нажмут Ок. */
  prikupOpen: Card[] | null
  /** Кто уже подтвердил, что посмотрел прикуп. */
  prikupAck: Seat[]
  /** Кто уже посмотрел собранную взятку: карты на сукне до Ок от всех. */
  trickAck: Seat[]
  whist: (boolean | null)[]
  trick: TrickCard[]
  lastTrick: CompletedTrick | null
  tricks: number[]
  handSizes: number[]
  /**
   * Открытые руки при мизере: двое играют в открытую, их карты видны всем.
   * Рука играющего остаётся закрытой — сюда она не попадает никогда.
   */
  openHands: { seat: Seat; cards: Card[] }[]
}

/**
 * Снимок партии для конкретного зрителя: свои карты — картами,
 * чужие — только количеством. Других карт в протоколе нет.
 */
export type GameSnapshot = {
  key: string
  status: GameStatusId
  players: GamePlayerView[]
  rules: Ruleset
  bulletTarget: number
  roundsLimit: number | null
  /** Сыгранных раздач; идущая не посчитана. */
  roundsPlayed: number
  table: ScoreTable
  round: RoundView | null
  mySeat: Seat | null
  /** Свои карты, отсортированные для показа. */
  myHand: Card[]
  /** Какие свои карты можно сыграть сейчас (пусто — не ход игрока). */
  myLegalMoves: Card[]
  /**
   * Одиночный вист: место пасующего, за которое я тоже хожу.
   * Заполнено только у вистующего, играющего за двоих; у остальных null.
   */
  partnerSeat: Seat | null
  /** Карты пасующего: видит только вистующий, играющий за двоих. */
  partnerHand: Card[]
  /** Легальные карты чужой руки — когда ход за пасующим. */
  partnerLegalMoves: Card[]
  /** Кто подтвердил готовность к следующей раздаче. */
  readyUserIds: string[]
  /** Итог последней записанной раздачи: чтобы опоздавшие увидели паузу с итогами. */
  lastRoundResult: RoundResultView | null
  standings: StandingView[] | null
}

/** Событие хода: то, что слышно за столом (ставка, снос, карта...). */
export type GameActionView =
  | { type: "deal"; roundNumber: number; dealer: Seat }
  | { type: "bid"; seat: Seat; bid: Bid }
  | { type: "misere"; seat: Seat }
  | { type: "pass"; seat: Seat }
  | { type: "prikup"; seat: Seat }
  | { type: "prikup-ack"; seat: Seat }
  | { type: "trick-ack"; seat: Seat }
  | { type: "declare"; seat: Seat; contract: "game" | "misere"; level?: number; trump?: Trump }
  | { type: "whist"; seat: Seat; whist: boolean }
  | { type: "card"; seat: Seat; card: Card }
  | { type: "trick"; winner: Seat }

/** Итог раздачи: контракт, взятки и что записано в таблицу. */
export type RoundResultView = {
  roundNumber: number
  dealer: Seat
  outcome: {
    contract: Contract
    declarer: Seat | null
    tricks: number[]
    whisters: Seat[]
  }
  /** Торговля: заявка, пас или null — по местам. */
  bids: (Bid | "pass" | null)[]
  /** Прикуп: две карты, доставшиеся играющему (на распасах — заход в взятки). */
  prikup: Card[]
  /** Снос играющего после прикупа (на мизере из торговли — пусто). */
  discard: Card[]
  /** Решения по висту: true — вистует, false — пас, null — не спрашивали. */
  whist: (boolean | null)[]
  /** Все взятки по порядку: карты на сукне и кто взял. */
  trickList: CompletedTrick[]
  deltas: ScoreEntry[]
  table: ScoreTable
  finished: boolean
}

export type GameStartPayload = Record<string, never>
export type GameBidPayload = { level: number; trump: Trump }
export type GameMiserePayload = Record<string, never>
export type GameDeclarePayload = {
  contract: "game" | "misere"
  discard: Card[]
  /** Подъём после прикупа: играют не ниже заказанного, поэтому только вверх. */
  level?: number
  trump?: Trump
}
export type GameWhistPayload = { whist: boolean }
export type GamePrikupAckPayload = Record<string, never>
export type GameTrickAckPayload = Record<string, never>
export type GameCardPayload = { card: Card }
export type GameReadyPayload = Record<string, never>
export type GamePassPayload = Record<string, never>
export type GameBotSeatPayload = { seat: number; level?: string }
export type GameBotRemovePayload = { seat: number }

export type ClientToServerEvents = {
  "room:join": (payload: JoinRoomPayload) => void
  "room:leave": (payload: JoinRoomPayload) => void
  "chat:send": (payload: SendChatPayload) => void
  "game:start": (payload: GameStartPayload) => void
  "game:bid": (payload: GameBidPayload) => void
  "game:misere": (payload: GameMiserePayload) => void
  "game:pass": (payload: GamePassPayload) => void
  "game:declare": (payload: GameDeclarePayload) => void
  "game:prikup-ack": (payload: GamePrikupAckPayload) => void
  "game:trick-ack": (payload: GameTrickAckPayload) => void
  "game:whist": (payload: GameWhistPayload) => void
  "game:card": (payload: GameCardPayload) => void
  "game:ready": (payload: GameReadyPayload) => void
  "game:bot-seat": (payload: GameBotSeatPayload) => void
  "game:bot-remove": (payload: GameBotRemovePayload) => void
  "voice:join": (payload: VoiceJoinPayload) => void
  "voice:leave": (payload: VoiceLeavePayload) => void
  "voice:signal": (payload: VoiceSignalPayload) => void
}

export type ServerToClientEvents = {
  "room:state": (state: RoomState) => void
  "chat:new": (message: ChatMessageView) => void
  "chat:error": (payload: ChatErrorPayload) => void
  "room:error": (payload: RoomErrorPayload) => void
  "game:state": (snapshot: GameSnapshot) => void
  "game:action": (action: GameActionView) => void
  "game:dealt": (payload: { roundNumber: number; dealer: Seat }) => void
  "game:round-result": (payload: RoundResultView) => void
  "game:error": (payload: RoomErrorPayload) => void
  "voice:peers": (payload: VoicePeersPayload) => void
  "voice:signal": (payload: VoiceSignalFromPayload) => void
  "voice:error": (payload: VoiceErrorPayload) => void
}

/** Сколько человеческих мест за столом: 3 играющих, четвёртый — сдающий по кругу. */
export const PLAYING_SEATS = 3