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
      <title>Shotstrike Server</title>
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

  players[playerId] = {
    id: playerId,
    socketId: socket.id,
    position: { x: 0, y: 1.6, z: 15 },
    rotation: { x: 0, y: 0 },
    color: Math.floor(Math.random() * 0xffffff),
    score: 0,
    health: 100,
    username: `Guest${Math.floor(Math.random() * 9999)}`,
    isImmune: true,      // Immune on first spawn
    visible: true,       // For hiding dead players
    isDead: false        // Prevents damage during death cam
  };

  // Remove initial spawn immunity after 3 seconds
  setTimeout(() => {
    if (players[playerId]) {
      players[playerId].isImmune = false;
      console.log(`Initial spawn immunity ended for ${players[playerId].username}`);
    }
  }, 3000);

  socket.emit('init', {
    playerId: playerId,
    players: players
  });

  socket.broadcast.emit('playerJoined', players[playerId]);

  // Handle username setting from client
  socket.on('setUsername', (newUsername) => {
    if (typeof newUsername === 'string') {
      let cleanUsername = newUsername.trim().substring(0, 20);
      cleanUsername = cleanUsername.replace(/[^a-zA-Z0-9_]/g, '');
      if (cleanUsername.length === 0) cleanUsername = `Guest${Math.floor(Math.random() * 9999)}`;
      if (cleanUsername.length > 0 && players[playerId]) {
        const oldUsername = players[playerId].username;
        players[playerId].username = cleanUsername;
        console.log(`✏️ Username changed: ${oldUsername} → ${cleanUsername}`);
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

  // Hit & Death logic with full protection during death cam
  socket.on('hit', (data) => {
    const target = players[data.targetId];
    const attacker = players[playerId];

    if (!target || !attacker) return;

    // Ignore hits if target is dead (in death cam) or immune
    if (target.isDead || target.isImmune) return;

    target.health -= 25;
    attacker.score += 10;

    if (target.health <= 0) {
      target.health = 100;
      attacker.score += 50;

      // Mark as dead and hide immediately
      target.isDead = true;
      target.visible = false;

      io.emit('playerVisibilityUpdate', {
        playerId: data.targetId,
        visible: false
      });

      io.emit('playerDied', {
        targetId: data.targetId,
        killerId: playerId
      });

      // Respawn after 3 seconds
      setTimeout(() => {
        if (players[data.targetId]) {
          const respawnedPlayer = players[data.targetId];

          // Teleport to spawn point
          respawnedPlayer.position = { x: 0, y: 1.6, z: 15 };

          // Clear dead state
          respawnedPlayer.isDead = false;

          // Make visible again
          respawnedPlayer.visible = true;

          // Grant 3-second immunity on respawn
          respawnedPlayer.isImmune = true;

          // Broadcast updates
          io.emit('playerMoved', {
            playerId: data.targetId,
            position: respawnedPlayer.position,
            rotation: respawnedPlayer.rotation
          });

          io.emit('playerVisibilityUpdate', {
            playerId: data.targetId,
            visible: true
          });

          io.emit('playerHit', {
            targetId: data.targetId,
            health: 100
          });

          console.log(`Player ${respawnedPlayer.username} respawned with 3s immunity`);

          // End immunity after 3 seconds
          setTimeout(() => {
            if (players[data.targetId]) {
              players[data.targetId].isImmune = false;
            }
          }, 3000);
        }
      }, 3000); // Death cam duration
    }

    // Send normal hit/score updates
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
