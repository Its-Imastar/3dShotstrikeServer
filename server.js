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

  // Create new player
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

  // Send all existing players to the new client
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

  // Send the new player's data + cosmetics to ALL clients (including the new one)
  const newPlayerData = getBroadcastData(socket.id);
  io.emit('playerJoined', newPlayerData);

  // Send cosmetics of ALL existing players to the new client
  Object.keys(players).forEach((id) => {
    if (id !== socket.id) {
      socket.emit('playerCosmeticsUpdated', {
        playerId: id,
        username: players[id].username,
        skinColor: players[id].skinColor,
        hatColor: players[id].hatColor,
        trailColor: players[id].trailColor,
      });
    }
  });

  // System message
  io.emit('chatMessage', { username: 'System', message: 'A player joined the game.' });

  socket.on('setCosmetics', (data) => {
    console.log('🎨 [SERVER] Received setCosmetics from player:', socket.id);
    console.log('  📦 Raw data received:', JSON.stringify(data));
    console.log('  🎯 Skin color received:', data.skinColor, 'Type:', typeof data.skinColor, 'Hex:', data.skinColor ? '0x' + data.skinColor.toString(16).toUpperCase() : 'undefined/0');
    console.log('  🎩 Hat color received:', data.hatColor, 'Type:', typeof data.hatColor, 'Hex:', data.hatColor ? '0x' + data.hatColor.toString(16).toUpperCase() : 'undefined/0');
    console.log('  ✨ Trail color received:', data.trailColor, 'Type:', typeof data.trailColor, 'Hex:', data.trailColor ? '0x' + data.trailColor.toString(16).toUpperCase() : 'undefined/0');
    console.log('  👤 Username received:', data.username);
    
    if (players[socket.id]) {
        console.log('  📊 Previous player cosmetics:');
        console.log('    🎯 Skin:', players[socket.id].skinColor, 'Hex: 0x' + players[socket.id].skinColor.toString(16).toUpperCase());
        console.log('    🎩 Hat:', players[socket.id].hatColor, 'Hex: 0x' + players[socket.id].hatColor.toString(16).toUpperCase());
        console.log('    ✨ Trail:', players[socket.id].trailColor, 'Hex: 0x' + players[socket.id].trailColor.toString(16).toUpperCase());
        console.log('    👤 Username:', players[socket.id].username);
        
        // FIX: Check for undefined/null specifically, not falsy (0 is a valid color!)
        players[socket.id].username = data.username !== undefined ? data.username : 'Player';
        players[socket.id].skinColor = data.skinColor !== undefined ? data.skinColor : 0x3b82f6;
        players[socket.id].hatColor = data.hatColor !== undefined ? data.hatColor : 0xffffff;
        players[socket.id].trailColor = data.trailColor !== undefined ? data.trailColor : 0xffff00;
        
        console.log('  📈 New player cosmetics:');
        console.log('    🎯 Skin:', players[socket.id].skinColor, 'Hex: 0x' + players[socket.id].skinColor.toString(16).toUpperCase());
        console.log('    🎩 Hat:', players[socket.id].hatColor, 'Hex: 0x' + players[socket.id].hatColor.toString(16).toUpperCase());
        console.log('    ✨ Trail:', players[socket.id].trailColor, 'Hex: 0x' + players[socket.id].trailColor.toString(16).toUpperCase());
        console.log('    👤 Username:', players[socket.id].username);

        // Broadcast updated cosmetics to everyone
        const broadcastData = {
            playerId: socket.id,
            username: players[socket.id].username,
            skinColor: players[socket.id].skinColor,
            hatColor: players[socket.id].hatColor,
            trailColor: players[socket.id].trailColor,
        };
        
        console.log('  📤 Broadcasting cosmetics to all players:', JSON.stringify(broadcastData));
        io.emit('playerCosmeticsUpdated', broadcastData);
        
        console.log('  ✅ Successfully updated and broadcasted cosmetics for player:', socket.id);
    } else {
        console.log('  ❌ Player not found for socket ID:', socket.id);
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
    console.log('🔫 Player shot:', socket.id, 'Trail color:', players[socket.id].trailColor ? '0x' + players[socket.id].trailColor.toString(16).toUpperCase() : 'default');
    socket.broadcast.emit('playerShot', {
      playerId: socket.id,
      from: data.from,
      direction: data.direction,
      trailColor: players[socket.id].trailColor,
    });
  });

  socket.on('hit', (data) => {
    console.log('💥 Hit event from:', socket.id, 'target:', data.targetId);
    const target = players[data.targetId];
    const shooter = players[socket.id];

    if (target && shooter && data.targetId !== socket.id) {
      console.log('  Valid hit, reducing health from', target.health, 'to', target.health - 25);
      target.health -= 25;

      shooter.score += 10;
      io.to(socket.id).emit('scoreUpdate', { playerId: socket.id, score: shooter.score });

      // FIXED: Include targetId and killerId in the playerHit event
      io.to(data.targetId).emit('playerHit', { 
        targetId: data.targetId,      // Added
        killerId: socket.id,          // Added
        health: target.health 
      });

      if (target.health <= 0) {
        console.log('  💀 Player died:', data.targetId, 'killed by:', socket.id);
        // Reset health and position
        target.health = 100;
        target.position = { ...DEFAULT_SPAWN };
        target.rotationY = DEFAULT_ROTATION_Y;

        shooter.score += 40;
        io.to(socket.id).emit('scoreUpdate', { playerId: socket.id, score: shooter.score });

        // Broadcast death
        io.emit('playerDied', { 
          targetId: data.targetId, 
          killerId: socket.id 
        });
        
        // Broadcast respawn position to everyone
        socket.broadcast.emit('playerMoved', {
          playerId: data.targetId,
          position: target.position,
          rotation: { y: target.rotationY },
        });
      }
    } else {
      console.log('  ❌ Invalid hit - target or shooter not found, or self-hit');
    }
  });

  socket.on('chatMessage', (data) => {
    console.log('💬 Chat message from:', socket.id, 'message:', data.message);
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
