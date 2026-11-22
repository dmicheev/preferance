import { io } from "socket.io-client"

const url = "http://localhost:3005"
const [key, userA, userB] = process.argv.slice(2)

if (!key || !userA || !userB) {
  console.error("usage: node scripts/socket-smoke.mjs <key> <userIdA> <userIdB>")
  process.exit(1)
}

const connect = (userId) =>
  io(url, {
    path: "/socket.io",
    transports: ["websocket"],
    extraHeaders: { cookie: `pf_player=${userId}` },
  })

/** Очередь событий: подписываемся заранее, ждём по требованию. */
function queue(socket, event) {
  const pending = []
  const waiters = []
  socket.on(event, (payload) => {
    const waiter = waiters.shift()
    if (waiter) waiter.resolve(payload)
    else pending.push(payload)
  })
  return (timeout = 5000) =>
    new Promise((resolve, reject) => {
      if (pending.length > 0) return resolve(pending.shift())
      const waiter = { resolve }
      waiters.push(waiter)
      setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout)
    })
}

const a = connect(userA)
const b = connect(userB)

const aState = queue(a, "room:state")
const bState = queue(b, "room:state")
const aChat = queue(a, "chat:new")
const bChat = queue(b, "chat:new")
const aChatError = queue(a, "chat:error")

let failed = false

try {
  a.emit("room:join", { key })
  console.log("A room:state      ", JSON.stringify(await aState()))

  b.emit("room:join", { key })
  console.log("B room:state      ", JSON.stringify(await bState()))
  console.log("A sees B online   ", JSON.stringify(await aState()))

  a.emit("chat:send", { text: "Проверка связи — раз, два, три" })
  console.log("B chat:new        ", JSON.stringify(await bChat()))
  console.log("A chat:new (echo) ", JSON.stringify(await aChat()))

  a.emit("chat:send", { text: "" })
  console.log("A chat:error      ", JSON.stringify(await aChatError()))
} catch (error) {
  failed = true
  console.error("FAILED:", error.message)
} finally {
  a.close()
  b.close()
  if (failed) process.exitCode = 1
}