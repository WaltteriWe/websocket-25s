const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { join } = require("path");

async function main() {
  // Initialize database
  const db = await open({
    filename: "./chat.db",
    driver: sqlite3.Database,
  });

  // Create messages table with room field
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT,
      nickname TEXT,
      room TEXT,
      timestamp INTEGER
    );
  `);

  // Setup routes
  app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "index.html"));
  });

  // Socket.IO connection handler
  io.on("connection", (socket) => {
    console.log("a user connected");

    let currentRoom = "general";

    // Handle room joining with message history
    socket.on("join room", async (room) => {
      socket.join(room);
      currentRoom = room;
      console.log(`User ${socket.id} joined room ${room}`);

      // Send welcome message
      socket.emit("chat message", {
        text: `Welcome to the ${room} room!`,
        nickname: "System",
        room: room,
      });

      try {
        // Fetch room history from database
        const messages = await db.all(
          "SELECT * FROM messages WHERE room = ? ORDER BY id DESC LIMIT 50",
          [room]
        );

        // Send history to the client
        if (messages.length > 0) {
          socket.emit("message history", messages.reverse());
        }
      } catch (err) {
        console.error("Error fetching message history:", err);
      }
    });

    // Handle room leaving
    socket.on("leave room", (room) => {
      socket.leave(room);
      console.log(`User ${socket.id} left room ${room}`);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log("user disconnected", socket.id);
    });

    // Handle chat messages with database storage
    socket.on("chat message", async (msg, clientOffset) => {
      console.log("message: " + JSON.stringify(msg));

      // Convert string messages to object format
      if (typeof msg === "string") {
        msg = {
          content: msg,
          nickname: "Anonymous",
          room: currentRoom,
        };
      } else if (!msg.room) {
        msg.room = currentRoom;
      }

      let result;
      try {
        // Store the message in the database with room information
        result = await db.run(
          "INSERT INTO messages (content, nickname, room, timestamp, client_offset) VALUES (?, ?, ?, ?, ?)",
          [
            msg.text || msg.content,
            msg.nickname,
            msg.room,
            Date.now(),
            clientOffset,
          ]
        );

        // Send to the specific room with the database ID
        io.to(msg.room).emit("chat message", msg, result.lastID);
      } catch (e) {
        console.error("Failed to store message:", e);
        // Still try to send the message even if storage fails
        io.to(msg.room).emit("chat message", msg);
      }
    });
  });

  // Start the server
  server.listen(3000, () => {
    console.log("server running at http://localhost:3000");
  });
}

// Execute the main function
main().catch((err) => {
  console.error("Failed to start server:", err);
});
