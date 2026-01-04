// server.js (with proper health initialization)
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

const players = {};
const PORT = process.env.PORT || 3000;

// Weapon damage configuration
const WEAPONS = {
    pistol: { damage: 25, range: 100 },
    rifle: { damage: 35, range: 150 },
    shotgun: { damage: 50, range: 30 }
};

// Create complete player object with all properties
const createPlayer = (id, spawn) => ({
    id: id,
    position: spawn,
    rotation: { x: 0, y: 0 },
    color: Math.floor(Math.random() * 0xffffff),
    health: 100,
    maxHealth: 100,
    equipped: { weapon: 'pistol' },
    username: `Player_${id.substr(0, 4)}`,
    isDead: false
});

// Send player data to clients (without exposing everything)
const getPlayerForClient = (player) => ({
    id: player.id,
    position: player.position,
    rotation: player.rotation,
    color: player.color,
    health: player.health,
    maxHealth: player.maxHealth,
    equipped: player.equipped,
    username: player.username
});

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
    
    // Create player with full health
    players[socket.id] = createPlayer(socket.id, spawn);
    
    // Format existing players for client
    const existingPlayers = {};
    Object.keys(players).forEach(id => {
        if (id !== socket.id) { // Don't send self data (will be handled by init)
            existingPlayers[id] = getPlayerForClient(players[id]);
        }
    });
    
    // Send initial data to the connecting player
    socket.emit('init', {
        playerId: socket.id,
        spawn: spawn,
        health: 100,
        maxHealth: 100,
        players: existingPlayers
    });
    
    // Broadcast new player to others with full health info
    socket.broadcast.emit('playerJoined', getPlayerForClient(players[socket.id]));
    
    // Handle player data
    socket.on('playerData', (data) => {
        if (players[socket.id]) {
            players[socket.id].username = data.username;
            players[socket.id].color = data.color;
            players[socket.id].equipped = data.equipped;
            
            socket.broadcast.emit('playerDataUpdate', {
                playerId: socket.id,
                username: data.username,
                equipped: data.equipped,
                color: data.color,
                health: players[socket.id].health,
                maxHealth: players[socket.id].maxHealth
            });
        }
    });
    
    // Handle movement
    socket.on('move', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
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
        if (players[socket.id] && !players[socket.id].isDead) {
            socket.broadcast.emit('playerShot', {
                playerId: socket.id,
                from: data.from,
                direction: data.direction,
                weapon: data.weapon || 'pistol'
            });
        }
    });
    
    // Handle hits with server-side validation
    socket.on('hit', (data) => {
        const shooter = players[socket.id];
        const target = players[data.targetId];
        
        if (!shooter || !target || shooter.isDead || target.isDead) return;
        
        // Calculate distance between shooter and target
        const dx = shooter.position.x - target.position.x;
        const dy = shooter.position.y - target.position.y;
        const dz = shooter.position.z - target.position.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Get weapon info
        const weapon = shooter.equipped?.weapon || 'pistol';
        const weaponData = WEAPONS[weapon] || WEAPONS.pistol;
        
        // Validate hit (basic range check)
        if (distance > weaponData.range) {
            console.log(`Hit out of range: ${distance} > ${weaponData.range}`);
            return;
        }
        
        // Apply damage
        const oldHealth = target.health;
        target.health -= weaponData.damage;
        target.health = Math.max(0, target.health); // Don't go below 0
        
        console.log(`${shooter.username} hit ${target.username} for ${weaponData.damage} damage. Health: ${oldHealth} -> ${target.health}`);
        
        // Broadcast hit to all players (for hit markers and health updates)
        io.emit('playerHit', {
            shooterId: socket.id,
            targetId: data.targetId,
            damage: weaponData.damage,
            newHealth: target.health,
            maxHealth: target.maxHealth
        });
        
        // Also send specific health update to target
        io.to(data.targetId).emit('healthUpdate', {
            health: target.health,
            maxHealth: target.maxHealth
        });
        
        // Check if player died
        if (target.health <= 0) {
            target.isDead = true;
            target.health = 0;
            
            // Notify everyone about the kill
            io.emit('playerKilled', {
                killerId: socket.id,
                victimId: data.targetId,
                weapon: weapon
            });
            
            // Respawn player after delay
            setTimeout(() => {
                if (players[data.targetId]) {
                    const newSpawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
                    players[data.targetId].health = 100;
                    players[data.targetId].maxHealth = 100;
                    players[data.targetId].position = newSpawn;
                    players[data.targetId].isDead = false;
                    
                    io.emit('playerRespawned', {
                        playerId: data.targetId,
                        position: newSpawn,
                        health: 100,
                        maxHealth: 100
                    });
                    
                    // Also send to the respawned player
                    io.to(data.targetId).emit('healthUpdate', {
                        health: 100,
                        maxHealth: 100
                    });
                }
            }, 3000);
        }
    });
    
    // Handle healing/health updates
    socket.on('heal', (amount) => {
        if (players[socket.id]) {
            const player = players[socket.id];
            player.health = Math.min(player.maxHealth, player.health + (amount || 25));
            
            socket.emit('healthUpdate', {
                health: player.health,
                maxHealth: player.maxHealth
            });
            
            // Broadcast to others
            socket.broadcast.emit('playerHealthUpdate', {
                playerId: socket.id,
                health: player.health,
                maxHealth: player.maxHealth
            });
        }
    });
    
    // Handle chat
    socket.on('chatMessage', (data) => {
        io.emit('chatMessage', {
            playerId: socket.id,
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
