const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.get('/', (req, res) => {
  res.send('Shotstrike multiplayer server is running!');
});

const players = {};

const DEFAULT_SPAWN = { x: 0, y: 1.0, z: 15 };
const DEFAULT_ROTATION_Y = Math.PI;

function getBroadcastData(playerId) {
  const p = players[playerId];
  if (!p) return null;
  return {
    id: playerId,
    position: p.position,
    rotation: { y: p.rotationY },
    username: p.username,
    skinColor: p.skinColor,
    hatColor: p.hatColor,
    trailColor: p.trailColor,
  };
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  players[socket.id] = {
    position: { ...DEFAULT_SPAWN },
    rotationY: DEFAULT_ROTATION_Y,
    health: 100,
    score: 0,
    username: 'Player',
    skinColor: 0x3b82f6,
    hatColor: 0xffffff,
    trailColor: 0xffff00,
  };

  const others = {};
  Object.keys(players).forEach((id) => {
    if (id !== socket.id) {
      others[id] = getBroadcastData(id);
    }
  });

  socket.emit('init', {
    playerId: socket.id,
    players: others,
  });

  io.emit('playerJoined', getBroadcastData(socket.id));

  io.emit('chatMessage', { username: 'System', message: 'A player joined the game.' });

  socket.on('setCosmetics', (data) => {
    if (players[socket.id]) {
      players[socket.id].username = data.username || 'Player';
      players[socket.id].skinColor = data.skinColor || 0x3b82f6;
      players[socket.id].hatColor = data.hatColor || 0xffffff;
      players[socket.id].trailColor = data.trailColor || 0xffff00;

      io.emit('playerCosmeticsUpdated', {
        playerId: socket.id,
        username: players[socket.id].username,
        skinColor: players[socket.id].skinColor,
        hatColor: players[socket.id].hatColor,
        trailColor: players[socket.id].trailColor,
      });
    }
  });

  socket.on('move', (data) => {
    if (players[socket.id]) {
      players[socket.id].position = data.position;
      players[socket.id].rotationY = data.rotation.y;

      socket.broadcast.emit('playerMoved', {
        playerId: socket.id,
        position: data.position,
        rotation: { y: data.rotation.y },
      });
    }
  });

  socket.on('shoot', (data) => {
    socket.broadcast.emit('playerShot', {
      playerId: socket.id,
      from: data.from,
      direction: data.direction,
      trailColor: players[socket.id].trailColor,
    });
  });

  socket.on('hit', (data) => {
    const target = players[data.targetId];
    const shooter = players[socket.id];

    if (target && shooter && data.targetId !== socket.id) {
      target.health -= 25;

      shooter.score += 10;
      io.to(socket.id).emit('scoreUpdate', { playerId: socket.id, score: shooter.score });

      io.to(data.targetId).emit('playerHit', { health: target.health });

      if (target.health <= 0) {
        target.health = 100;

        shooter.score += 40;
        io.to(socket.id).emit('scoreUpdate', { playerId: socket.id, score: shooter.score });

        io.emit('playerDied', { targetId: data.targetId, killerId: socket.id });
      }
    }
  });

  socket.on('chatMessage', (data) => {
    if (players[socket.id] && data.message) {
      io.emit('chatMessage', {
        username: players[socket.id].username,
        message: data.message.trim(),
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
    io.emit('chatMessage', { username: 'System', message: 'A player left the game.' });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
