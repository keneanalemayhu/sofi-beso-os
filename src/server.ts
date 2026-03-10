// src/server.ts

import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { pool } from "./db";

const app = createApp();
const httpServer = createServer(app);

const allowedOrigin = process.env.FRONTEND_URL || "*";

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    credentials: true,
  },
});

app.locals.io = io;

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
});

const PORT = Number(process.env.PORT || 4000);

async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("Database connected");

    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down gracefully...`);

  try {
    io.close();
    httpServer.close(async () => {
      await pool.end();
      console.log("Server closed cleanly");
      process.exit(0);
    });
  } catch (err) {
    console.error("Shutdown error:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start();