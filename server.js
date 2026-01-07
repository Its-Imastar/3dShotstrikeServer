// server.js - Updated with HARD 8 CPS LIMIT
// Shotstrike multiplayer server with authoritative health + regeneration + anti-autoclick

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ====================== GAME CONSTANTS ======================
const MAX_HEALTH = 100;
const START_SCORE = 0;
const DAMAGE_PER_HIT = 25;
const KILL_SCORE = 50;
const HEALTH_REGEN_DELAY = 4;
const HEALTH_REGEN_RATE = 5;
const REGEN_TICK_MS = 50;

// HARD RATE LIMIT - 8 CPS MAX
const MAX_SHOTS_PER_SECOND = 8;
const RATE_LIMIT_WINDOW_MS = 1000;

// ====================== PLAYER STATE ======================
const players = {};

function randomColor() {
  const colors = [0x3498db, 0xe74c3c, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x1abc9c];
  return colors[Math.floor(Math.random() * colors.length)];
}

function nowMs() {
  return Date.now();
}

function nowSeconds() {
  return Date.now() / 1000;
}

// ====================== CONNECTION HANDLER ======================
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  players[socket.id] = {
    id: socket.id,
    username: 'Guest',
    color: randomColor(),
    position: { x: 0, y: 1.67, z: 0 },
    rotation: { x: 0, y: 0 },
    health: MAX_HEALTH,
    score: START_SCORE,
    lastDamageTime: nowSeconds(),
    isDead: false,
    // ANTI-AUTOCICK FIELDS
    shotsFired: 0,
    shotWindowStart: nowMs(),
    lastShotTime: 0,
    lastHitTime: 0,
    lastHitTarget: null
  };

  socket.emit('init', {
    playerId: socket.id,
    players: players
  });

  socket.broadcast.emit('playerJoined', players[socket.id]);

  // Username
  socket.on('setUsername', (username) => {
    if (!players[socket.id]) return;
    players[socket.id].username = String(username || 'Player').slice(0, 24);
    io.emit('playerUsernameUpdated', {
      playerId: socket.id,
      username: players[socket.id].username
    });
  });

  // Movement
  socket.on('move', (data) => {
    const player = players[socket.id];
    if (!player || !data?.position || !data?.rotation) return;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    player.position = {
      x: clamp(data.position.x, -95, 95),
      y: data.position.y,
      z: clamp(data.position.z, -95, 95)
    };
    player.rotation = { x: data.rotation.x, y: data.rotation.y };

    socket.broadcast.emit('playerMoved', {
      playerId: socket.id,
      position: player.position,
      rotation: player.rotation
    });
  });

  // SHOOT HANDLER WITH HARD 8 CPS LIMIT
  socket.on('shoot', (data) => {
    const player = players[socket.id];
    if (!player || !data?.from || !data?.direction) return;

    const now = nowMs();

    // Reset shot window every second
    if (now - player.shotWindowStart >= RATE_LIMIT_WINDOW_MS) {
      player.shotsFired = 0;
      player.shotWindowStart = now;
    }

    // HARD LIMIT: 8 shots per second MAX
    if (player.shotsFired >= MAX_SHOTS_PER_SECOND) {
      console.log(`🚫 AUTOCICKER BLOCKED: ${player.username} (${socket.id.slice(0,8)}): ${player.shotsFired}/${MAX_SHOTS_PER_SECOND} shots/sec`);
      return; // SILENTLY DROP - no tracer, no processing
    }

    // Also enforce minimum time between shots (125ms = 8/sec)
    if (now - player.lastShotTime < 125) {
      return;
    }

    player.shotsFired++;
    player.lastShotTime = now;

    // Legit shot - broadcast tracer
    socket.broadcast.emit('playerShot', {
      playerId: socket.id,
      from: data.from,
      direction: data.direction
    });
  });

  // HIT HANDLER WITH SPAM PROTECTION
  socket.on('hit', (data) => {
    const shooter = players[socket.id];
    const targetId = data?.targetId;
    const target = players[targetId];
    
    if (!shooter || !target || target.isDead) return;

    const now = nowMs();

    // Prevent hit spam on same target (150ms cooldown)
    if (shooter.lastHitTarget === targetId && now - shooter.lastHitTime < 150) {
      return;
    }

    shooter.lastHitTime = now;
    shooter.lastHitTarget = targetId;

    // Apply damage
    target.health = Math.max(0, target.health - DAMAGE_PER_HIT);
    target.lastDamageTime = nowSeconds();

    io.to(targetId).emit('playerHit', {
      targetId: targetId,
      health: target.health,
      fromId: socket.id
    });

    if (target.health <= 0) {
      shooter.score += KILL_SCORE;
      target.isDead = true;
      
      io.emit('playerDied', {
        killerId: socket.id,
        targetId: targetId
      });

      io.to(socket.id).emit('scoreUpdate', {
        playerId: socket.id,
        score: shooter.score
      });

      // Respawn after 2s
      setTimeout(() => {
        if (players[targetId]) {
          players[targetId].health = MAX_HEALTH;
          players[targetId].isDead = false;
          players[targetId].lastDamageTime = nowSeconds();
          players[targetId].position = { x: 0, y: 1.67, z: 0 };
          players[targetId].shotsFired = 0; // reset autoclick counter

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

  // Chat
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

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (players[socket.id]) {
      io.emit('playerLeft', socket.id);
      delete players[socket.id];
    }
  });
});

// ====================== HEALTH REGENERATION ======================
setInterval(() => {
  const now = nowSeconds();
  const deltaTime = REGEN_TICK_MS / 1000;

  for (const playerId in players) {
    const player = players[playerId];
    if (!player || player.isDead || player.health >= MAX_HEALTH) continue;

    const timeSinceDamage = now - player.lastDamageTime;
    if (timeSinceDamage > HEALTH_REGEN_DELAY) {
      const oldHealth = player.health;
      player.health = Math.min(MAX_HEALTH, player.health + HEALTH_REGEN_RATE * deltaTime);
      
      if (Math.floor(player.health) !== Math.floor(oldHealth)) {
        io.to(playerId).emit('playerHealthUpdate', {
          playerId: playerId,
          health: player.health
        });
      }
    }
  }
}, REGEN_TICK_MS);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    players: Object.keys(players).length,
    activePlayers: Object.values(players).filter(p => !p.isDead).length
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Shotstrike server (8 CPS LIMIT) on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
});
