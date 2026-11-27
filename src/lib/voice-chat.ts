"use client"

// Голос за столом: WebRTC mesh поверх уже существующего Socket.IO-канала.
// Сервер только ретранслирует SDP и ICE-кандидаты — само аудио идёт напрямую
// между игроками, поэтому трафик сервера от голоса не растёт.
//
// Соединения согласуются по схеме «идеальных переговоров» (perfect negotiation):
// коллизии offer/answer разрешаются сравнением id сокетов, поэтому состав можно
// синхронизировать целиком при каждом обновлении списка голосующих.

import type { VoicePeerView, VoiceSignalData } from "./protocol"
import { getGameSocket, type GameSocket } from "./socket-client"

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
  ],
}

/** RMS громче этого порога считаем речью. */
const SPEAKING_THRESHOLD = 0.04
const VAD_INTERVAL_MS = 180

export type VoiceStatus = "idle" | "connecting" | "live"

export type VoicePeerState = {
  socketId: string
  userId: string
  nickname: string
  /** Это мой собственный сокет. */
  self: boolean
  /** Прямое соединение установлено; у себя — просто «в голосе». */
  connected: boolean
  /** Сейчас говорит. */
  speaking: boolean
}

export type VoiceChatState = {
  status: VoiceStatus
  error: string | null
  /** Микрофон выключен: своё аудио к другим не уходит. */
  micMuted: boolean
  /** Заглушены: чужое аудио приглушено только у себя. */
  deafened: boolean
  peers: VoicePeerState[]
}

const IDLE_STATE: VoiceChatState = {
  status: "idle",
  error: null,
  micMuted: false,
  deafened: false,
  peers: [],
}

/** Одно прямое соединение с одним из голосующих. */
type PeerLink = {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  /** У «вежливой» стороны id сокета больше: она откатывает свои офферы. */
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  settingRemoteAnswerPending: boolean
  connected: boolean
  speaking: boolean
  analyser: AnalyserNode | null
  buffer: Float32Array<ArrayBuffer> | null
  source: MediaStreamAudioSourceNode | null
}

function friendlyMicError(error: unknown): string {
  const name = error instanceof Error ? error.name : ""
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Доступ к микрофону не выдан — разреши его в настройках браузера"
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Микрофон не найден"
  }
  if (name === "NotReadableError") {
    return "Микрофон занят другим приложением"
  }
  return "Не получилось включить микрофон"
}

/** RMS окна сэмплов: грубая, но достаточная оценка «звучит / молчит». */
function rmsLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (const sample of buffer) sum += sample * sample
  return Math.sqrt(sum / buffer.length)
}

export class VoiceChatEngine {
  private listeners = new Set<() => void>()
  private state: VoiceChatState = IDLE_STATE
  private socket: GameSocket | null = null
  /** Состав голоса стола — приходит всем, даже тем, кто сам не включил голос. */
  private roster: VoicePeerView[] = []
  private links = new Map<string, PeerLink>()
  private micStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private selfAnalyser: AnalyserNode | null = null
  private selfBuffer: Float32Array<ArrayBuffer> | null = null
  private selfSource: MediaStreamAudioSourceNode | null = null
  private selfSpeaking = false
  private vadTimer: ReturnType<typeof setInterval> | null = null
  private joined = false

  // --- подписка для React ---

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): VoiceChatState => this.state

  private publish(next: Partial<VoiceChatState>) {
    this.state = { ...this.state, ...next, peers: this.buildPeers() }
    for (const listener of this.listeners) listener()
  }

  private buildPeers(): VoicePeerState[] {
    const mySocketId = this.socket?.id ?? null
    return this.roster.map((peer) => {
      const link = this.links.get(peer.socketId)
      return {
        socketId: peer.socketId,
        userId: peer.userId,
        nickname: peer.nickname,
        self: peer.socketId === mySocketId,
        connected: link ? link.connected : peer.socketId === mySocketId,
        speaking: link ? link.speaking : this.selfSpeaking,
      }
    })
  }

  // --- жизненный цикл ---

  /** Навешивает слушателей сокета; возвращает уборщику полный разбор. */
  attach = (): (() => void) => {
    const socket = getGameSocket()
    this.socket = socket
    socket.on("voice:peers", this.handlePeers)
    socket.on("voice:signal", this.handleSignal)
    socket.on("voice:error", this.handleVoiceError)
    socket.on("disconnect", this.handleSocketDown)

    return () => {
      socket.off("voice:peers", this.handlePeers)
      socket.off("voice:signal", this.handleSignal)
      socket.off("voice:error", this.handleVoiceError)
      socket.off("disconnect", this.handleSocketDown)
      this.leave(true)
      this.socket = null
      this.roster = []
      this.state = IDLE_STATE
      this.listeners.clear()
    }
  }

  // --- действия игрока ---

  async join() {
    if (this.state.status !== "idle") return
    if (!this.socket) {
      this.publish({ status: "idle", error: "Нет связи со столом" })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.publish({
        status: "idle",
        error: "Голос работает только по HTTPS или на localhost",
      })
      return
    }

    this.publish({ status: "connecting", error: null })
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
    } catch (error) {
      this.publish({ status: "idle", error: friendlyMicError(error) })
      return
    }

    this.setupAudioContext()
    this.joined = true
    this.publish({ status: "live" })
    this.socket.emit("voice:join", {})
    this.syncConnections()
    this.startVad()
  }

  leave(silent = false) {
    if (this.joined && !silent) this.socket?.emit("voice:leave", {})
    this.joined = false
    this.stopVad()

    for (const socketId of [...this.links.keys()]) this.closeLink(socketId)

    this.teardownAudioContext()
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.micStream = null
    this.selfSpeaking = false

    this.publish({
      status: "idle",
      micMuted: false,
      deafened: false,
    })
  }

  toggleMic() {
    if (this.state.status !== "live" || !this.micStream) return
    const next = !this.state.micMuted
    this.micStream.getAudioTracks().forEach((track) => {
      track.enabled = !next
    })
    this.publish({ micMuted: next })
  }

  toggleDeafen() {
    if (this.state.status !== "live") return
    const next = !this.state.deafened
    for (const link of this.links.values()) link.audio.muted = next
    this.publish({ deafened: next })
  }

  // --- серверные события ---

  private handlePeers = (payload: { peers: VoicePeerView[] }) => {
    this.roster = payload.peers
    if (this.joined) this.syncConnections()
    this.publish({})
  }

  private handleSignal = async (payload: {
    from: string
    data: VoiceSignalData
  }) => {
    const link = this.links.get(payload.from)
    if (!link) return // сигнал не по составу стола — игнорируем

    const { pc } = link
    try {
      if (payload.data.kind === "desc") {
        const description = payload.data.description
        const readyForOffer =
          !link.makingOffer &&
          (pc.signalingState === "stable" || link.settingRemoteAnswerPending)
        const offerCollision = description.type === "offer" && !readyForOffer
        link.ignoreOffer = !link.polite && offerCollision
        if (link.ignoreOffer) return

        link.settingRemoteAnswerPending = description.type === "answer"
        await pc.setRemoteDescription(description)
        link.settingRemoteAnswerPending = false

        if (description.type === "offer") {
          await pc.setLocalDescription()
          this.sendDescription(payload.from, pc.localDescription)
        }
        return
      }

      try {
        await pc.addIceCandidate(payload.data.candidate)
      } catch (error) {
        // Кандидат, пришедший посреди отката, ронять соединение не должен.
        if (!link.ignoreOffer) throw error
      }
    } catch (error) {
      console.warn("[voice] сигнал не принят", error)
    }
  }

  private handleVoiceError = (payload: { message: string }) => {
    if (!this.joined) return
    this.leave(true)
    this.publish({ status: "idle", error: payload.message })
  }

  /** Обрыв связи: соединения мертвы, микрофон выключаем, голос нужно включить заново. */
  private handleSocketDown = () => {
    if (!this.joined) return
    this.leave(true)
    this.publish({ status: "idle", error: "Связь потерялась — включи голос заново" })
  }

  private sendDescription(to: string, description: RTCSessionDescription | null) {
    if (!description) return
    this.emitSignal(to, {
      kind: "desc",
      description: description.toJSON(),
    })
  }

  private emitSignal(to: string, data: VoiceSignalData) {
    this.socket?.emit("voice:signal", { to, data })
  }

  // --- mesh-соединения ---

  /** Приводит прямые соединения к составу голоса: кого-то создаём, кого-то закрываем. */
  private syncConnections() {
    const mySocketId = this.socket?.id
    if (!mySocketId) return

    const seen = new Set<string>()
    for (const peer of this.roster) {
      seen.add(peer.socketId)
      if (peer.socketId === mySocketId) continue
      if (!this.links.has(peer.socketId)) this.createLink(peer, mySocketId)
    }
    for (const socketId of [...this.links.keys()]) {
      if (!seen.has(socketId)) this.closeLink(socketId)
    }
  }

  private createLink(peer: VoicePeerView, mySocketId: string) {
    const micStream = this.micStream
    if (!micStream) return

    const pc = new RTCPeerConnection(RTC_CONFIG)
    const link: PeerLink = {
      pc,
      audio: document.createElement("audio"),
      polite: mySocketId > peer.socketId,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswerPending: false,
      connected: false,
      speaking: false,
      analyser: null,
      buffer: null,
      source: null,
    }
    this.links.set(peer.socketId, link)

    link.audio.autoplay = true
    link.audio.muted = this.state.deafened

    for (const track of micStream.getAudioTracks()) {
      pc.addTrack(track, micStream)
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.emitSignal(peer.socketId, {
          kind: "ice",
          candidate: candidate.toJSON(),
        })
      }
    }

    pc.ontrack = ({ streams }) => {
      const [stream] = streams
      if (!stream) return
      link.audio.srcObject = stream
      // Автовоспроизведение разрешено: клик по «включить голос» уже был.
      void link.audio.play().catch(() => {})
      this.attachAnalyser(link, stream)
    }

    pc.onconnectionstatechange = () => {
      link.connected = pc.connectionState === "connected"
      this.publish({})
    }

    pc.onnegotiationneeded = async () => {
      try {
        link.makingOffer = true
        await pc.setLocalDescription()
        this.sendDescription(peer.socketId, pc.localDescription)
      } catch (error) {
        console.warn("[voice] оффер не собрался", error)
      } finally {
        link.makingOffer = false
      }
    }
  }

  private closeLink(socketId: string) {
    const link = this.links.get(socketId)
    if (!link) return
    this.links.delete(socketId)
    link.pc.onicecandidate = null
    link.pc.ontrack = null
    link.pc.onconnectionstatechange = null
    link.pc.onnegotiationneeded = null
    link.pc.close()
    detachAnalyser(link)
    link.audio.srcObject = null
  }

  // --- звук: контекст, индикация речи, глухота ---

  private setupAudioContext() {
    try {
      const context = new AudioContext()
      void context.resume()
      this.audioContext = context
    } catch (error) {
      // Без аудиоконтекста голос работает, просто без индикации речи.
      console.warn("[voice] аудиоконтекст не открылся", error)
      return
    }

    const micStream = this.micStream
    const context = this.audioContext
    if (!micStream || !context) return
    try {
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      const source = context.createMediaStreamSource(micStream)
      // К destination не подключаем — иначе услышим сами себя.
      source.connect(analyser)
      this.selfSource = source
      this.selfAnalyser = analyser
      this.selfBuffer = new Float32Array(analyser.fftSize)
    } catch (error) {
      console.warn("[voice] анализ микрофона не поднялся", error)
    }
  }

  private teardownAudioContext() {
    if (this.selfSource) {
      this.selfSource.disconnect()
      this.selfSource = null
    }
    this.selfAnalyser = null
    this.selfBuffer = null
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
  }

  private attachAnalyser(link: PeerLink, stream: MediaStream) {
    const context = this.audioContext
    if (!context) return
    try {
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      const source = context.createMediaStreamSource(stream)
      source.connect(analyser)
      link.source = source
      link.analyser = analyser
      link.buffer = new Float32Array(analyser.fftSize)
    } catch (error) {
      console.warn("[voice] анализ голоса собеседника не поднялся", error)
    }
  }

  private startVad() {
    this.stopVad()
    this.vadTimer = setInterval(() => this.sampleSpeaking(), VAD_INTERVAL_MS)
  }

  private stopVad() {
    if (this.vadTimer) {
      clearInterval(this.vadTimer)
      this.vadTimer = null
    }
  }

  private sampleSpeaking() {
    let changed = false

    const selfLevel =
      this.selfAnalyser && this.selfBuffer
        ? rmsLevel(this.selfAnalyser, this.selfBuffer)
        : 0
    const selfSpeaking =
      !this.state.micMuted && selfLevel > SPEAKING_THRESHOLD
    if (selfSpeaking !== this.selfSpeaking) {
      this.selfSpeaking = selfSpeaking
      changed = true
    }

    for (const link of this.links.values()) {
      const level =
        link.analyser && link.buffer ? rmsLevel(link.analyser, link.buffer) : 0
      const speaking = level > SPEAKING_THRESHOLD
      if (speaking !== link.speaking) {
        link.speaking = speaking
        changed = true
      }
    }

    if (changed) this.publish({})
  }
}

function detachAnalyser(link: PeerLink) {
  if (link.source) {
    link.source.disconnect()
    link.source = null
  }
  link.analyser = null
  link.buffer = null
}
