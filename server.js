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
  // Your status page HTML
  res.send(`...`);
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
    isImmune: true,  // NEW: immune on spawn
    immuneUntil: Date.now() + 3000  // 3 seconds immunity
  };

  // Grant immunity on spawn
  setTimeout(() => {
    if (players[playerId]) {
      players[playerId].isImmune = false;
      console.log(`Immunity ended for ${players[playerId].username}`);
    }
  }, 3000);

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

  socket.on('hit', (data) => {
    const target = players[data.targetId];
    const attacker = players[playerId];

    if (!target || !attacker) return;

    // === IMMUNITY CHECK ===
    if (target.isImmune || Date.now() < target.immuneUntil) {
      return; // Ignore all damage during immunity
    }

    target.health -= 25;
    attacker.score += 10;

    if (target.health <= 0) {
      target.health = 100;
      attacker.score += 50;

      // Grant immunity on respawn
      target.isImmune = true;
      target.immuneUntil = Date.now() + 3000;

      io.emit('playerDied', {
        targetId: data.targetId,
        killerId: playerId
      });

      // End immunity after 3 seconds
      setTimeout(() => {
        if (players[data.targetId]) {
          players[data.targetId].isImmune = false;
        }
      }, 3000);

      // Respawn: teleport to spawn point
      target.position = { x: 0, y: 1.6, z: 15 };
      io.emit('playerMoved', {
        playerId: data.targetId,
        position: target.position,
        rotation: target.rotation
      });
    }

    // Send updates
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
