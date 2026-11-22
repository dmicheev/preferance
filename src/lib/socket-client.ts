"use client"

import { io, type Socket } from "socket.io-client"

import type { ClientToServerEvents, ServerToClientEvents } from "./protocol"

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let sharedSocket: GameSocket | null = null

/** Один сокет на вкладку: переживает переходы между экранами. */
export function getGameSocket(): GameSocket {
  if (!sharedSocket) {
    sharedSocket = io({
      path: "/socket.io",
      autoConnect: false,
      transports: ["websocket", "polling"],
    })
  }

  return sharedSocket
}