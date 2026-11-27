"use client"

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react"

import { CHAT_MAX_LENGTH, type ChatMessageView } from "@/lib/protocol"
import type { VoiceChatState } from "@/lib/voice-chat"

type ChatDockProps = {
  messages: ChatMessageView[]
  myNickname: string | null
  onlineCount: number
  error: string | null
  disabled: boolean
  onSend: (text: string) => void
  voice: VoiceChatState
  onVoiceJoin: () => void
  onVoiceLeave: () => void
  onVoiceToggleMic: () => void
  onVoiceToggleDeafen: () => void
}

const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
})

export function ChatDock({
  messages,
  myNickname,
  onlineCount,
  error,
  disabled,
  onSend,
  voice,
  onVoiceJoin,
  onVoiceLeave,
  onVoiceToggleMic,
  onVoiceToggleDeafen,
}: ChatDockProps) {
  const [text, setText] = useState("")
  // Время сообщений показываем только после гидратации: часовой пояс клиента
  // может не совпадать с серверным.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText("")
  }

  return (
    <aside className="dock" aria-label="Разговор за столом">
      <div className="dock__head">
        <div className="dock__title">
          <b>Разговор</b>
          <span>
            {onlineCount > 0
              ? `${onlineCount} за столом`
              : "ждём подключения"}
          </span>
        </div>
      </div>

      <div className="dock__messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="dock__empty">
            Пока тихо. Скажи что-нибудь — только не подсказывай.
          </p>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className="message"
              data-mine={message.nickname === myNickname}
            >
              <div className="message__meta">
                <span className="message__author">{message.nickname}</span>
                {hydrated ? (
                  <time className="message__time">
                    {TIME_FORMAT.format(new Date(message.at))}
                  </time>
                ) : null}
              </div>
              <p className="message__text">{message.text}</p>
            </article>
          ))
        )}
      </div>

      {error ? <p className="form-error" style={{ margin: "0 14px 10px" }}>{error}</p> : null}

      <form className="dock__form" onSubmit={submit}>
        <input
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={disabled ? "Сначала сядь за стол" : "Сказать за столом…"}
          disabled={disabled}
          aria-label="Текст сообщения"
        />
        <button
          className="dock__send"
          type="submit"
          disabled={disabled || text.trim().length === 0}
          aria-label="Отправить сообщение"
        >
          →
        </button>
      </form>

      <div className="dock__voice">
        <div className="voice__head">
          <b>Голос</b>
          <span>{voiceHeadline(voice)}</span>
        </div>

        {disabled ? (
          <p className="voice__hint">Голос — только для тех, кто сидит за столом.</p>
        ) : voice.status === "live" ? (
          <div className="voice__controls">
            <button
              className="voice__button"
              type="button"
              onClick={onVoiceToggleMic}
              aria-pressed={voice.micMuted}
              title={voice.micMuted ? "Включить микрофон" : "Выключить микрофон"}
            >
              {voice.micMuted ? "🔇 микрофон" : "🎙 микрофон"}
            </button>
            <button
              className="voice__button"
              type="button"
              onClick={onVoiceToggleDeafen}
              aria-pressed={voice.deafened}
              title={voice.deafened ? "Включить звук" : "Заглушить стол"}
            >
              {voice.deafened ? "🔇 звук" : "🔊 звук"}
            </button>
            <button
              className="voice__button voice__button--leave"
              type="button"
              onClick={onVoiceLeave}
              title="Покинуть голосовой стол"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            className="voice__button voice__button--join"
            type="button"
            onClick={onVoiceJoin}
            disabled={voice.status === "connecting"}
          >
            {voice.status === "connecting" ? "подключаем микрофон…" : "🎙 включить голос"}
          </button>
        )}

        {voice.error ? <p className="voice__error" role="alert">{voice.error}</p> : null}

        {voice.peers.length > 0 ? (
          <ul className="voice__peers">
            {voice.peers.map((peer) => (
              <li
                key={peer.socketId}
                className={
                  peer.speaking
                    ? "voice__peer is-speaking"
                    : voice.status === "live" && !peer.self && !peer.connected
                      ? "voice__peer is-connecting"
                      : "voice__peer"
                }
              >
                <span className="voice__dot" aria-hidden="true" />
                <span className="voice__name">
                  {peer.nickname}
                  {peer.self ? " (ты)" : ""}
                </span>
                {voice.status === "live" && !peer.self && !peer.connected ? (
                  <span className="voice__status">соединяем…</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="voice__hint">
            {voice.status === "live"
              ? "ты в голосе — остальные ещё молчат"
              : "голос идёт напрямую между игроками, без записи"}
          </p>
        )}
      </div>
    </aside>
  )
}

function voiceHeadline(voice: VoiceChatState): string {
  const count = voice.peers.length
  if (count > 0) return `${count} в голосе`
  return voice.status === "live" ? "ты в голосе" : "никто не включил"
}