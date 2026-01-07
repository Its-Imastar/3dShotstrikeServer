// server.js
// Shotstrike multiplayer server with authoritative health + regeneration

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',  // Change to your domain in production
    methods: ['GET', 'POST']
  }
});

// ====================== GAME CONSTANTS ======================
const MAX_HEALTH = 100;
const START_SCORE = 0;
const DAMAGE_PER_HIT = 25;
const KILL_SCORE = 50;
const HEALTH_REGEN_DELAY = 4;    // seconds after damage before regen starts
const HEALTH_REGEN_RATE = 5;     // HP per second
const REGEN_TICK_MS = 50;        // how often to check regen (20 FPS)

// ====================== PLAYER STATE ======================
const players = {};  // socket.id -> player data

function randomColor() {
  const colors = [0x3498db, 0xe74c3c, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x1abc9c];
  return colors[Math.floor(Math.random() * colors.length)];
}

function nowSeconds() {
  return Date.now() / 1000;
}

// ====================== CONNECTION HANDLER ======================
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Create new player
  players[socket.id] = {
    id: socket.id,
    username: 'Guest',
    color: randomColor(),
    position: { x: 0, y: 1.67, z: 0 },
    rotation: { x: 0, y: 0 },
    health: MAX_HEALTH,
    score: START_SCORE,
    lastDamageTime: nowSeconds(),
    isDead: false
  };

  // Send initial game state to this player
  socket.emit('init', {
    playerId: socket.id,
    players: players
  });

  // Notify others about new player
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // Username change
  socket.on('setUsername', (username) => {
    if (!players[socket.id]) return;
    players[socket.id].username = String(username || 'Player').slice(0, 24);
    
    io.emit('playerUsernameUpdated', {
      playerId: socket.id,
      username: players[socket.id].username
    });
  });

  // Player movement (with bounds checking)
  socket.on('move', (data) => {
    const player = players[socket.id];
    if (!player || !data?.position || !data?.rotation) return;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    
    player.position = {
      x: clamp(data.position.x, -95, 95),
      y: data.position.y,
      z: clamp(data.position.z, -95, 95)
    };
    player.rotation = {
      x: data.rotation.x,
      y: data.rotation.y
    };

    // Broadcast to other players
    socket.broadcast.emit('playerMoved', {
      playerId: socket.id,
      position: player.position,
      rotation: player.rotation
    });
  });

  // Bullet tracers (visual only)
  socket.on('shoot', (data) => {
    if (!players[socket.id] || !data?.from || !data?.direction) return;
    socket.broadcast.emit('playerShot', {
      playerId: socket.id,
      from: data.from,
      direction: data.direction
    });
  });

  // Hit detection (authoritative damage)
  socket.on('hit', (data) => {
    const shooter = players[socket.id];
    const targetId = data?.targetId;
    const target = players[targetId];
    
    if (!shooter || !target || target.isDead) return;

    // Apply damage
    target.health = Math.max(0, target.health - DAMAGE_PER_HIT);
    target.lastDamageTime = nowSeconds();

    // Notify target they were hit
    io.to(targetId).emit('playerHit', {
      targetId: targetId,
      health: target.health,
      fromId: socket.id
    });

    // Check for death
    if (target.health <= 0) {
      shooter.score += KILL_SCORE;
      
      // Mark dead and notify everyone
      target.isDead = true;
      io.emit('playerDied', {
        killerId: socket.id,
        targetId: targetId
      });

      // Update shooter's score
      io.to(socket.id).emit('scoreUpdate', {
        playerId: socket.id,
        score: shooter.score
      });

      // Respawn target after short delay
      setTimeout(() => {
        if (players[targetId]) {
          players[targetId].health = MAX_HEALTH;
          players[targetId].isDead = false;
          players[targetId].lastDamageTime = nowSeconds();
          players[targetId].position = { x: 0, y: 1.67, z: 0 };

          // Notify respawn
          io.emit('playerMoved', {
            playerId: targetId,
            position: players[targetId].position,
            rotation: players[targetId].rotation
          });
          
          io.to(targetId).emit('playerHealthUpdate', {
            playerId: targetId,
            health: MAX_HEALTH
          });
        }
      }, 2000);
    }
  });

  // Chat messages
  socket.on('chatMessage', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const message = data?.message || data;
    if (typeof message !== 'string') return;

    const cleanMsg = String(message).slice(0, 120);
    io.emit('chatMessage', {
      username: player.username || 'Player',
      message: cleanMsg
    });
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (players[socket.id]) {
      io.emit('playerLeft', socket.id);
      delete players[socket.id];
    }
  });
});

// ====================== HEALTH REGENERATION LOOP ======================
setInterval(() => {
  const now = nowSeconds();
  const deltaTime = REGEN_TICK_MS / 1000;  // 50ms = 0.05s

  for (const playerId in players) {
    const player = players[playerId];
    if (!player || player.isDead || player.health >= MAX_HEALTH) continue;

    const timeSinceDamage = now - player.lastDamageTime;
    
    // Only regen after delay
    if (timeSinceDamage > HEALTH_REGEN_DELAY) {
      const oldHealth = player.health;
      player.health = Math.min(MAX_HEALTH, player.health + HEALTH_REGEN_RATE * deltaTime);
      
      // Send update if health changed meaningfully
      if (Math.floor(player.health) !== Math.floor(oldHealth)) {
        io.to(playerId).emit('playerHealthUpdate', {
          playerId: playerId,
          health: player.health
        });
      }
    }
  }
}, REGEN_TICK_MS);

// ====================== HEALTH CHECK ======================
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', players: Object.keys(players).length });
});

// ====================== START SERVER ======================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Shotstrike server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
