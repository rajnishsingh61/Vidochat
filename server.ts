import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Track users and their rooms
  const users = new Map();
  let waitingUser = null;

  const broadcastOnlineCount = () => {
    io.emit("online-count", io.engine.clientsCount);
  };

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    broadcastOnlineCount();

    socket.on("join", (profile) => {
      socket.data.profile = profile;
      if (waitingUser && waitingUser !== socket.id) {
        // Match found
        const roomName = `room-${waitingUser}-${socket.id}`;
        const peerSocket = io.sockets.sockets.get(waitingUser);
        
        socket.join(roomName);
        io.to(waitingUser).emit("matched", { 
          room: roomName, 
          peerId: socket.id,
          peerProfile: profile 
        });
        socket.emit("matched", { 
          room: roomName, 
          peerId: waitingUser,
          peerProfile: peerSocket?.data.profile 
        });
        waitingUser = null;
      } else {
        waitingUser = socket.id;
        socket.emit("waiting");
      }
    });

    socket.on("signal", ({ room, signal }) => {
      socket.to(room).emit("signal", signal);
    });

    socket.on("message", ({ room, message }) => {
      io.to(room).emit("message", {
        userId: socket.id,
        text: message,
        timestamp: new Date().toISOString()
      });
    });

    socket.on("chat-request", ({ room }) => {
      socket.to(room).emit("chat-request");
    });

    socket.on("chat-accepted", ({ room }) => {
      socket.to(room).emit("chat-accepted");
    });

    socket.on("next", ({ room }) => {
      if (room) {
        socket.leave(room);
        socket.to(room).emit("peer-left");
      }
      // Re-enter matching pool
      if (waitingUser && waitingUser !== socket.id) {
        const roomName = `room-${waitingUser}-${socket.id}`;
        socket.join(roomName);
        io.to(waitingUser).emit("matched", { room: roomName, peerId: socket.id });
        socket.emit("matched", { room: roomName, peerId: waitingUser });
        waitingUser = null;
      } else {
        waitingUser = socket.id;
        socket.emit("waiting");
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      broadcastOnlineCount();
      if (waitingUser === socket.id) {
        waitingUser = null;
      }
      // Notify rooms
      socket.rooms.forEach(room => {
        socket.to(room).emit("peer-left");
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get(["/Rajnish", "*"], (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
