"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

import { VoiceChatEngine, type VoiceChatState } from "./voice-chat"

const SERVER_STATE: VoiceChatState = {
  status: "idle",
  error: null,
  micMuted: false,
  deafened: false,
  peers: [],
}

/**
 * Голосовой чат стола: один движок на экран, состояние — через
 * useSyncExternalStore, действия — методы движка.
 */
export function useVoiceChat() {
  // Конструктор движка чистый: слушателей не вешает, до браузерных API
  // не дотягивается, поэтому создавать в рендере безопасно.
  const [engine] = useState(() => new VoiceChatEngine())

  const voice = useSyncExternalStore(
    engine.subscribe,
    engine.getState,
    () => SERVER_STATE,
  )

  useEffect(() => engine.attach(), [engine])

  const joinVoice = useCallback(() => void engine.join(), [engine])
  const leaveVoice = useCallback(() => engine.leave(), [engine])
  const toggleMic = useCallback(() => engine.toggleMic(), [engine])
  const toggleDeafen = useCallback(() => engine.toggleDeafen(), [engine])

  return { voice, joinVoice, leaveVoice, toggleMic, toggleDeafen }
}
