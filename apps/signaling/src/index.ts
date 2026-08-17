import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

type Client = { id: string; socket: WebSocket; roomId?: string };
type SignalMessage = { type: string; [key: string]: unknown };

const port = Number(process.env.PORT ?? 8787);
const rooms = new Map<string, Set<Client>>();
const clients = new Map<string, Client>();

function createRoomId() {
  let roomId = "";
  do roomId = randomBytes(3).toString("hex").toUpperCase(); while (rooms.has(roomId));
  return roomId;
}

function send(client: Client, message: SignalMessage) {
  if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(message));
}

function broadcast(roomId: string, message: SignalMessage, except?: string) {
  rooms.get(roomId)?.forEach((client) => {
    if (client.id !== except) send(client, message);
  });
}

function leave(client: Client) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  room?.delete(client);
  broadcast(client.roomId, { type: "peer-left", peerId: client.id });
  if (room?.size === 0) rooms.delete(client.roomId);
  client.roomId = undefined;
}

const server = new WebSocketServer({ port });
server.on("connection", (socket) => {
  const client: Client = { id: randomBytes(8).toString("hex"), socket };
  clients.set(client.id, client);
  send(client, { type: "ready", clientId: client.id });

  socket.on("message", (raw) => {
    let message: SignalMessage;
    try { message = JSON.parse(raw.toString()) as SignalMessage; } catch { return; }

    if (message.type === "create-room") {
      leave(client);
      const roomId = createRoomId();
      client.roomId = roomId;
      rooms.set(roomId, new Set([client]));
      send(client, { type: "room-created", roomId });
      return;
    }

    if (message.type === "join-room") {
      const roomId = String(message.roomId ?? "").toUpperCase();
      const room = rooms.get(roomId);
      if (!room) { send(client, { type: "error", message: "Sala não encontrada." }); return; }
      leave(client);
      client.roomId = roomId;
      const existingPeers = [...room].map((peer) => peer.id);
      room.add(client);
      send(client, { type: "room-joined", roomId, peers: existingPeers });
      broadcast(roomId, { type: "peer-joined", peerId: client.id }, client.id);
      return;
    }

    if (["offer", "answer", "ice-candidate"].includes(message.type)) {
      const target = clients.get(String(message.target));
      if (target) send(target, { ...message, from: client.id });
    }
  });

  socket.on("close", () => { leave(client); clients.delete(client.id); });
});

console.log(`Farol signaling running on ws://localhost:${port}`);
