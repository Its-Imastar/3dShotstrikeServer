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
        body { font-family: Arial; text-align: center; padding: 50px; }
        h1 { color: #2563eb; }
        .status { background: #10b981; color: white; padding: 20px; border-radius: 10px; display: inline-block; }
      </style>
    </head>
    <body>
      <h1>🎮 FPS Game Server</h1>
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
const bots = {};
let playerCount = 0;
let botIdCounter = 0;

// Spawn points for bots
// Update the spawnPoints array in your server code to:
const spawnPoints = [
  { x: -70, y: 1.67, z: 0 },
  { x: 70, y: 1.67, z: 0 },
  { x: 0, y: 1.67, z: -70 },
  { x: 0, y: 1.67, z: 70 },
  { x: -40, y: 3, z: -40 },
  { x: 40, y: 3, z: -40 },
  { x: -40, y: 3, z: 40 },
  { x: 40, y: 3, z: 40 }
];

function createBot() {
  const botId = 'bot_' + botIdCounter++;
  const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
  
  bots[botId] = {
    id: botId,
    position: { ...spawn },
    rotation: Math.random() * Math.PI * 2,
    health: 100,
    target: null,
    moveTimer: 0,
    shootTimer: 0
  };
  
  console.log(`🤖 Bot ${botId} spawned at`, spawn);
  io.emit('botSpawned', bots[botId]);
  return botId;
}

// Create 3 bots at start
console.log('Creating initial bots...');
for (let i = 0; i < 3; i++) {
  createBot();
}

// Bot AI update loop - runs every 50ms (20 times per second)
setInterval(() => {
  Object.keys(bots).forEach(botId => {
    const bot = bots[botId];
    bot.moveTimer++;
    bot.shootTimer++;
    
    // Find closest player
    let closestPlayer = null;
    let closestDist = Infinity;
    
    Object.keys(players).forEach(playerId => {
      const player = players[playerId];
      const dx = player.position.x - bot.position.x;
      const dz = player.position.z - bot.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist < closestDist) {
        closestDist = dist;
        closestPlayer = player;
      }
    });
    
    if (closestPlayer && closestDist < 40) {
      // Chase player
      const dx = closestPlayer.position.x - bot.position.x;
      const dz = closestPlayer.position.z - bot.position.z;
      const dirLength = Math.sqrt(dx * dx + dz * dz);
      
      if (dirLength > 0) {
        bot.rotation = Math.atan2(dx, dz);
        
        // Move towards player
        if (bot.moveTimer > 10 && closestDist > 10) {
          const moveAmount = 0.15;
          bot.position.x += (dx / dirLength) * moveAmount;
          bot.position.z += (dz / dirLength) * moveAmount;
          bot.moveTimer = 0;
        }
        
        // Shoot at player
        if (bot.shootTimer > 60 && closestDist < 35) {
          bot.shootTimer = 0;
          
          const direction = {
            x: dx / dirLength,
            y: 0,
            z: dz / dirLength
          };
          
          // 30% chance to hit
          if (Math.random() > 0.7) {
            closestPlayer.health -= 25;
            
            if (closestPlayer.health <= 0) {
              closestPlayer.health = 100;
              io.emit('playerDied', {
                targetId: closestPlayer.id,
                killerId: botId
              });
            }
          }
          
          // Send shot event to all clients
          io.emit('botShot', {
            botId: botId,
            targetId: closestPlayer.id,
            from: bot.position,
            direction: direction,
            health: closestPlayer.health
          });
        }
      }
    } else {
      // Wander randomly
      if (bot.moveTimer > 40) {
        bot.moveTimer = 0;
        const randomAngle = Math.random() * Math.PI * 2;
        bot.position.x += Math.sin(randomAngle) * 0.2;
        bot.position.z += Math.cos(randomAngle) * 0.2;
        
        // Keep bots within bounds
        bot.position.x = Math.max(-65, Math.min(65, bot.position.x));
        bot.position.z = Math.max(-65, Math.min(65, bot.position.z));
        
        bot.rotation = randomAngle;
      }
    }
    
    // Send bot update to all clients
    io.emit('botUpdate', {
      id: botId,
      position: bot.position,
      rotation: bot.rotation
    });
  });
}, 50);

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
    health: 100
  };
  
  // Send all existing bots to new player
  Object.keys(bots).forEach(botId => {
    socket.emit('botSpawned', bots[botId]);
  });
  
  socket.emit('init', {
    playerId: playerId,
    players: players
  });
  
  socket.broadcast.emit('playerJoined', players[playerId]);
  
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
  
  // Handle bot hits
  socket.on('hitBot', (data) => {
    if (bots[data.botId]) {
      bots[data.botId].health -= 25;
      players[playerId].score += 10;
      
      io.to(socket.id).emit('scoreUpdate', {
        playerId: playerId,
        score: players[playerId].score
      });
      
      if (bots[data.botId].health <= 0) {
        players[playerId].score += 50;
        io.to(socket.id).emit('scoreUpdate', {
          playerId: playerId,
          score: players[playerId].score
        });
        
        console.log(`💀 Bot ${data.botId} killed by ${playerId.substring(0, 6)}`);
        io.emit('botKilled', { botId: data.botId });
        delete bots[data.botId];
        
        // Respawn bot after 3 seconds
        setTimeout(() => {
          createBot();
        }, 3000);
      }
    }
  });
  
  socket.on('chatMessage', (data) => {
    if (players[playerId] && data.message) {
      const message = data.message.substring(0, 50);
      io.emit('chatMessage', {
        username: `Player ${playerId.substring(0, 6)}`,
        message: message
      });
      console.log(`💬 Chat from ${playerId.substring(0, 6)}: ${message}`);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', playerId);
    playerCount--;
    io.emit('playerCount', playerCount);
    delete players[playerId];
    io.emit('playerLeft', playerId);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket URL: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP URL: http://localhost:${PORT}`);
});
