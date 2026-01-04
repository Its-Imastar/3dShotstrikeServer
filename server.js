// server.js (simplified - no storage)
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

const players = {}; // Temporary in-memory only
const PORT = process.env.PORT || 3000;

// Simple status page
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Shotstrike Server</title></head>
        <body style="background: #1a1a1a; color: white; font-family: Arial; text-align: center; padding-top: 50px;">
            <h1>🎮 Shotstrike Server</h1>
            <p>✅ Relay server is running</p>
            <p>👥 Players online: ${Object.keys(players).length}</p>
            <p>🔗 Connect using the game client</p>
        </body>
        </html>
    `);
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', players: Object.keys(players).length });
});

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Generate spawn position
    const spawnPoints = [
        { x: -70, y: 1.67, z: 0 },
        { x: 70, y: 1.67, z: 0 },
        { x: 0, y: 1.67, z: -70 },
        { x: 0, y: 1.67, z: 70 }
    ];
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    
    // Store basic player info (temporary)
    players[socket.id] = {
        id: socket.id,
        position: spawn,
        rotation: { x: 0, y: 0 },
        color: Math.floor(Math.random() * 0xffffff)
    };
    
    // Send initial data
    socket.emit('init', {
        playerId: socket.id,
        players: players
    });
    
    // Broadcast to others
    socket.broadcast.emit('playerJoined', players[socket.id]);
    
    // Handle player data (username, equipped items, etc.)
    socket.on('playerData', (data) => {
        // Update player data
        if (players[socket.id]) {
            players[socket.id].username = data.username;
            players[socket.id].color = data.color;
            players[socket.id].equipped = data.equipped;
            
            // Broadcast to all other players
            socket.broadcast.emit('playerDataUpdate', {
                playerId: socket.id,
                username: data.username,
                equipped: data.equipped,
                color: data.color
            });
        }
    });
    
    // Handle movement
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            
            socket.broadcast.emit('playerMoved', {
                playerId: socket.id,
                position: data.position,
                rotation: data.rotation
            });
        }
    });
    
    // Handle shooting
    socket.on('shoot', (data) => {
        socket.broadcast.emit('playerShot', {
            playerId: socket.id,
            from: data.from,
            direction: data.direction
        });
    });
    
    // Handle hits (for score/coins - client-side only)
    socket.on('hit', (data) => {
        // Just relay to target player
        io.to(data.targetId).emit('playerHit', {
            shooterId: socket.id
        });
    });
    
    // Handle chat
    socket.on('chatMessage', (data) => {
        io.emit('chatMessage', {
            username: players[socket.id]?.username || 'Player',
            message: data.message
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        io.emit('playerLeft', socket.id);
        delete players[socket.id];
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`🎮 Shotstrike relay server running on port ${PORT}`);
});
