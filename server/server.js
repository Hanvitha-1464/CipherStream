import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors());

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    service: "cipherstream-signaling",
    timestamp: new Date().toISOString(),
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

function send(socket, type, payload) {
  socket.send(JSON.stringify({ type, payload }));
}

function broadcast(roomCode, type, payload, except) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const client of room.clients) {
    if (client !== except && client.readyState === 1) {
      send(client, type, payload);
    }
  }
}

wss.on("connection", (socket) => {
  socket.roomCode = "";

  socket.on("message", (raw) => {
    const { type, payload } = JSON.parse(String(raw));

    if (type === "join-room") {
      const roomCode = String(payload.roomCode || "").trim().toLowerCase();
      if (!roomCode) {
        send(socket, "error", { message: "Room code is required." });
        return;
      }

      const room = rooms.get(roomCode) || { clients: new Set() };
      room.clients.add(socket);
      rooms.set(roomCode, room);
      socket.roomCode = roomCode;

      send(socket, "room-joined", { roomCode });

      if (room.clients.size > 1) {
        let index = 0;
        for (const client of room.clients) {
          send(client, "peer-ready", { polite: index > 0 });
          index += 1;
        }
      }
    }

    if (type === "signal" && socket.roomCode) {
      broadcast(socket.roomCode, "signal", payload, socket);
    }
  });

  socket.on("close", () => {
    if (!socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.clients.delete(socket);
    if (room.clients.size === 0) {
      rooms.delete(socket.roomCode);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log("CipherStream signaling server listening on " + PORT);
});
