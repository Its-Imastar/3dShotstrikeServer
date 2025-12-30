const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>FPS Game Server</title>
      <style>
        body { font-family: Arial; text-align: center; padding: 50px; background: #1a1a1a; color: white; }
        h1 { color: #2563eb; }
        .status { background: #10b981; color: white; padding: 20px; border-radius: 10px; display: inline-block; }
      </style>
    </head>
    <body>
      <h1>🎮 Shotstrike Server</h1>
      <div class="status">
        <h2>✅ Server is Running!</h2>
        <p>Connect your game to: <strong>${req.headers.host}</strong></p>
        <p>Players online: <span id="playerCount">0</span></p>
      </div>
      <script>
        const socket = io();
        socket.on('playerCount', (count) => {
          document.getElementById('playerCount').textContent = count;
        });
      </script>
      <script src="/socket.io/socket.io.js"></script>
    </body>
    </html>
  `);
});

const players = {};
let playerCount = 0;

io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  playerCount++;
  io.emit('playerCount', playerCount);

  const playerId = socket.id;

  // Default username if client doesn't send one
  players[playerId] = {
    id: playerId,
    socketId: socket.id,
    position: { x: 0, y: 1.6, z: 15 },
    rotation: { x: 0, y: 0 },
    color: Math.floor(Math.random() * 0xffffff),
    score: 0,
    health: 100,
    username: `Guest${Math.floor(Math.random() * 9999)}`  // fallback
  };

  socket.emit('init', {
    playerId: playerId,
    players: players
  });

  socket.broadcast.emit('playerJoined', players[playerId]);

  // === NEW: Handle username setting from client ===
  socket.on('setUsername', (newUsername) => {
    if (typeof newUsername === 'string') {
      let cleanUsername = newUsername.trim();
      if (cleanUsername.length > 20) cleanUsername = cleanUsername.substring(0, 20);
      if (cleanUsername.length === 0) cleanUsername = `Guest${Math.floor(Math.random() * 9999)}`;

      // Optional: simple filter for bad words / characters
      cleanUsername = cleanUsername.replace(/[^a-zA-Z0-9_]/g, '');

      if (cleanUsername.length > 0) {
        console.log(`✏️ ${playerId.substring(0, 6)} set username to: ${cleanUsername}`);
        players[playerId].username = cleanUsername;
      }
    }
  });

  socket.on('move', (data) => {
    if (players[playerId]) {
      players[playerId].position = data.position;
      players[playerId].rotation = data.rotation;
      socket.broadcast.emit('playerMoved', {
        playerId: playerId,
        position: data.position,
        rotation: data.rotation
      });
    }
  });

  socket.on('shoot', (data) => {
    socket.broadcast.emit('playerShot', {
      playerId: playerId,
      from: data.from,
      direction: data.direction
    });
  });

  socket.on('hit', (data) => {
    if (players[data.targetId]) {
      players[data.targetId].health -= 25;
      players[playerId].score += 10;

      if (players[data.targetId].health <= 0) {
        players[data.targetId].health = 100;
        players[playerId].score += 50;
        io.emit('playerDied', {
          targetId: data.targetId,
          killerId: playerId
        });
      }

      io.emit('playerHit', {
        targetId: data.targetId,
        health: players[data.targetId].health
      });

      io.emit('scoreUpdate', {
        playerId: playerId,
        score: players[playerId].score
      });
    }
  });

  // === FIXED: Use real username in chat ===
  socket.on('chatMessage', (data) => {
    if (players[playerId] && data.message) {
      const message = data.message.substring(0, 100); // slightly longer limit
      io.emit('chatMessage', {
        username: players[playerId].username,
        message: message
      });
      console.log(`💬 Chat from ${players[playerId].username}: ${message}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', players[playerId]?.username || playerId);
    playerCount--;
    io.emit('playerCount', playerCount);
    delete players[playerId];
    io.emit('playerLeft', playerId);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Visit: http://localhost:${PORT}`);
});
