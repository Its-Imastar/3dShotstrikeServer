// server.js
// Basic Shotstrike multiplayer server

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Allow your web page to connect (adjust origin if you host elsewhere)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// In‑memory game state
const players = {}; // key: socket.id -> { id, username, color, position, rotation, health, score }
const START_HEALTH = 100;
const START_SCORE = 0;

// Simple helper: random player color
function randomColor() {
  const colors = [0x3498db, 0xe74c3c, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x1abc9c];
  return colors[Math.floor(Math.random() * colors.length)];
}

// When a client connects
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Create a default player entry
  players[socket.id] = {
    id: socket.id,
    username: 'Guest',
    color: randomColor(),
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0 },
    health: START_HEALTH,
    score: START_SCORE,
  };

  // Send initial state to this client
  socket.emit('init', {
    playerId: socket.id,
    players,
  });

  // Tell others someone joined
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // Client sets their username
  socket.on('setUsername', (username) => {
    if (!players[socket.id]) return;
    players[socket.id].username = String(username).slice(0, 24);

    io.emit('playerUsernameUpdated', {
      playerId: socket.id,
      username: players[socket.id].username,
    });
  });

  // Movement updates
  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p || !data || !data.position || !data.rotation) return;

    // Basic validation (avoid insane positions)
    const pos = data.position;
    const rot = data.rotation;

    // Clamp position to arena bounds like your client
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    p.position = {
      x: clamp(pos.x, -95, 95),
      y: pos.y, // could clamp if needed
      z: clamp(pos.z, -95, 95),
    };
    p.rotation = {
      x: rot.x,
      y: rot.y,
    };

    // Broadcast to others
    socket.broadcast.emit('playerMoved', {
      playerId: socket.id,
      position: p.position,
      rotation: p.rotation,
    });
  });

  // Shooting – just broadcast tracer to others
  socket.on('shoot', (data) => {
    if (!players[socket.id]) return;
    if (!data || !data.from || !data.direction) return;

    socket.broadcast.emit('playerShot', {
      playerId: socket.id,
      from: data.from,
      direction: data.direction,
    });
  });

  // Hit detection – client tells server who was hit
  socket.on('hit', (data) => {
    const shooter = players[socket.id];
    const targetId = data && data.targetId;
    const target = players[targetId];
    if (!shooter || !target) return;

    // Example: each hit does 25 damage (matches your bots)
    const DAMAGE = 25;
    target.health = Math.max(0, target.health - DAMAGE);

    // Notify the target of new health
    io.to(targetId).emit('playerHit', {
      targetId,
      health: target.health,
      fromId: socket.id,
    });

    // If dead, award score to shooter and broadcast death
    if (target.health <= 0) {
      const KILL_SCORE = 50;
      shooter.score += KILL_SCORE;
      target.health = START_HEALTH;

      io.emit('playerDied', {
        killerId: socket.id,
        targetId,
      });

      io.to(socket.id).emit('scoreUpdate', {
        playerId: socket.id,
        score: shooter.score,
      });

      // Optionally respawn target at origin
      target.position = { x: 0, y: 1, z: 0 };
      io.emit('playerMoved', {
        playerId: targetId,
        position: target.position,
        rotation: target.rotation,
      });
    }
  });

  // Quick chat messages
  socket.on('chatMessage', (data) => {
    const p = players[socket.id];
    if (!p || !data || typeof data.message !== 'string') return;

    const msg = data.message.slice(0, 120); // basic length limit
    io.emit('chatMessage', {
      username: p.username || 'Player',
      message: msg,
    });
  });

  // Disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

// Optional health check route
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Shotstrike server listening on port ${PORT}`);
});
