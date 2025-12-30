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
  res.send(/* your status page HTML */);
});

const players = {};
let playerCount = 0;

io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  playerCount++;
  io.emit('playerCount', playerCount);

  const playerId = socket.id;

  players[playerId] = {
    id: playerId,
    socketId: socket.id,
    position: { x: 0, y: 1.6, z: 15 },
    rotation: { x: 0, y: 0 },
    color: Math.floor(Math.random() * 0xffffff),
    score: 0,
    health: 100,
    username: `Guest${Math.floor(Math.random() * 9999)}`,
    isDead: false  // NEW: track death state
  };

  socket.emit('init', {
    playerId: playerId,
    players: players
  });

  socket.broadcast.emit('playerJoined', players[playerId]);

  socket.on('setUsername', (newUsername) => {
    if (typeof newUsername === 'string') {
      let cleanUsername = newUsername.trim().substring(0, 20);
      cleanUsername = cleanUsername.replace(/[^a-zA-Z0-9_]/g, '');
      if (cleanUsername.length === 0) cleanUsername = `Guest${Math.floor(Math.random() * 9999)}`;
      if (cleanUsername.length > 0 && players[playerId]) {
        players[playerId].username = cleanUsername;
        io.emit('playerUsernameUpdated', {
          playerId: playerId,
          username: cleanUsername
        });
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

  // === FIXED HIT LOGIC ===
  socket.on('hit', (data) => {
    const target = players[data.targetId];
    const attacker = players[playerId];

    if (!target || !attacker) return;

    // NEW: Ignore hits on players who are currently dead/respawning
    if (target.isDead) return;

    target.health -= 25;
    attacker.score += 10;

    if (target.health <= 0) {
      target.health = 100;
      target.isDead = true;  // Mark as dead

      attacker.score += 50;

      io.emit('playerDied', {
        targetId: data.targetId,
        killerId: playerId
      });

      // Respawn after delay (matches client deathCamDuration = 3 seconds)
      setTimeout(() => {
        if (players[data.targetId]) {
          players[data.targetId].isDead = false;
          players[data.targetId].health = 100;

          // Optional: move to spawn point
          players[data.targetId].position = { x: 0, y: 1.6, z: 15 };

          // Notify clients of position update (so body disappears from death spot)
          io.emit('playerMoved', {
            playerId: data.targetId,
            position: players[data.targetId].position,
            rotation: players[data.targetId].rotation
          });

          // Send health update so UI refreshes correctly
          io.emit('playerHit', {
            targetId: data.targetId,
            health: 100
          });
        }
      }, 3000); // 3 seconds = matches client death cam duration
    }

    // Always send these updates
    io.emit('playerHit', {
      targetId: data.targetId,
      health: target.health
    });

    io.emit('scoreUpdate', {
      playerId: playerId,
      score: attacker.score
    });
  });

  socket.on('chatMessage', (data) => {
    if (players[playerId] && data.message) {
      const message = data.message.substring(0, 100);
      io.emit('chatMessage', {
        username: players[playerId].username,
        message: message
      });
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
});
