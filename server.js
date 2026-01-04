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

// Spawn points
const spawnPoints = [
    { x: -70, y: 1.67, z: 0 },
    { x: 70, y: 1.67, z: 0 },
    { x: 0, y: 1.67, z: -70 },
    { x: 0, y: 1.67, z: 70 }
];

// Weapon damage
const WEAPON_DAMAGE = {
    default: 25,
    pistol: 20,
    shotgun: 40,
    sniper: 75,
    smg: 15
};

// Simple status page
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Shotstrike Server</title>
            <style>
                body {
                    background: #1a1a1a;
                    color: white;
                    font-family: Arial;
                    text-align: center;
                    padding-top: 50px;
                }
                h1 { color: #3b82f6; }
                .stats {
                    background: rgba(59, 130, 246, 0.1);
                    padding: 20px;
                    border-radius: 10px;
                    display: inline-block;
                    margin: 20px;
                    border: 2px solid #3b82f6;
                }
            </style>
        </head>
        <body>
            <h1>🎮 Shotstrike Multiplayer Server</h1>
            <p>✅ Server is running on port ${PORT}</p>
            
            <div class="stats">
                <h3>📊 Server Statistics</h3>
                <p>👥 Players Online: ${Object.keys(players).length}</p>
                <p>🌐 WebSocket: Active</p>
                <p>🕒 Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
            </div>
            
            <p>🔗 Connect using the game client</p>
            <p>📡 Server ready for connections</p>
        </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        players: Object.keys(players).length,
        uptime: process.uptime()
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`🔗 Player connected: ${socket.id}`);
    
    // Create player with initial data
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    players[socket.id] = {
        id: socket.id,
        username: `Player_${socket.id.substring(0, 4)}`,
        position: spawn,
        rotation: { x: 0, y: 0 },
        health: 100,
        maxHealth: 100,
        color: Math.floor(Math.random() * 0xFFFFFF),
        weapon: 'default',
        isDead: false,
        equipped: {
            skin: 'default',
            weapon: 'default',
            trail: 'none'
        }
    };
    
    // Send existing players to new player
    const existingPlayers = {};
    Object.keys(players).forEach(id => {
        if (id !== socket.id) {
            existingPlayers[id] = players[id];
        }
    });
    
    // Send INITIAL data to the new player
    socket.emit('init', {
        playerId: socket.id,
        position: spawn,
        rotation: { x: 0, y: 0 },
        health: 100,
        color: players[socket.id].color,
        players: existingPlayers
    });
    
    console.log(`📤 Sent init to ${socket.id} with ${Object.keys(existingPlayers).length} other players`);
    
    // Tell other players about the new player
    socket.broadcast.emit('playerJoined', players[socket.id]);
    
    // ==================== EVENT HANDLERS ====================
    
    // Handle player data (username, color, equipped items)
    socket.on('playerData', (data) => {
        if (players[socket.id]) {
            // Update player data
            players[socket.id].username = data.username || players[socket.id].username;
            players[socket.id].color = data.color || players[socket.id].color;
            players[socket.id].equipped = data.equipped || players[socket.id].equipped;
            
            // Broadcast update to all other players
            socket.broadcast.emit('playerDataUpdate', {
                playerId: socket.id,
                username: players[socket.id].username,
                color: players[socket.id].color,
                equipped: players[socket.id].equipped
            });
        }
    });
    
    // Handle player movement
    socket.on('move', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            // Update position and rotation
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            
            // Broadcast to other players
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
            // Broadcast shot to other players
            socket.broadcast.emit('playerShot', {
                playerId: socket.id,
                from: data.from,
                direction: data.direction
            });
        }
    });
    
    // Handle hit detection
    socket.on('hit', (data) => {
        const shooter = players[socket.id];
        const target = players[data.targetId];
        
        if (!shooter || !target || shooter.isDead || target.isDead) return;
        
        // Calculate damage based on weapon
        const weaponDamage = WEAPON_DAMAGE[shooter.weapon] || 25;
        target.health -= weaponDamage;
        
        if (target.health < 0) target.health = 0;
        
        console.log(`💥 ${shooter.username} hit ${target.username} for ${weaponDamage} damage`);
        
        // Broadcast hit to everyone
        io.emit('playerHit', {
            shooterId: socket.id,
            targetId: data.targetId,
            damage: weaponDamage,
            newHealth: target.health
        });
        
        // Send specific health update to the target
        socket.to(data.targetId).emit('healthUpdate', {
            health: target.health,
            maxHealth: target.maxHealth
        });
        
        // Check for death
        if (target.health <= 0) {
            target.isDead = true;
            target.health = 0;
            
            // Broadcast death event
            io.emit('playerDied', {
                killerId: socket.id,
                killerName: shooter.username,
                victimId: data.targetId,
                victimName: target.username
            });
            
            // Respawn after 3 seconds
            setTimeout(() => {
                if (players[data.targetId]) {
                    const newSpawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
                    players[data.targetId].position = newSpawn;
                    players[data.targetId].health = 100;
                    players[data.targetId].isDead = false;
                    
                    io.emit('playerRespawned', {
                        id: data.targetId,
                        position: newSpawn,
                        health: 100
                    });
                }
            }, 3000);
        }
    });
    
    // Handle chat messages
    socket.on('chatMessage', (data) => {
        const player = players[socket.id];
        if (player) {
            io.emit('chatMessage', {
                username: player.username,
                message: data.message
            });
        }
    });
    
    // Handle weapon changes
    socket.on('weaponChanged', (data) => {
        if (players[socket.id]) {
            players[socket.id].weapon = data.weapon;
            socket.broadcast.emit('weaponChanged', {
                playerId: socket.id,
                weapon: data.weapon
            });
        }
    });
    
    // Handle shop purchases
    socket.on('buyItem', (data) => {
        // Here you would validate purchase and update database
        // For now, just broadcast to other players
        socket.broadcast.emit('itemPurchased', {
            playerId: socket.id,
            category: data.category,
            itemId: data.itemId
        });
    });
    
    // Handle item equipping
    socket.on('equipItem', (data) => {
        if (players[socket.id]) {
            // Update equipped item
            if (data.category === 'skin') {
                players[socket.id].equipped.skin = data.itemId;
                // Get color from skin
                // This would come from your shopItems data
            } else if (data.category === 'weapon') {
                players[socket.id].equipped.weapon = data.itemId;
                players[socket.id].weapon = data.itemId;
            } else if (data.category === 'trail') {
                players[socket.id].equipped.trail = data.itemId;
            }
            
            socket.broadcast.emit('itemEquipped', {
                playerId: socket.id,
                category: data.category,
                itemId: data.itemId
            });
        }
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`👋 Player disconnected: ${socket.id}`);
        
        if (players[socket.id]) {
            // Tell everyone this player left
            io.emit('playerLeft', socket.id);
            
            // Remove from players list
            delete players[socket.id];
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🎮 Shotstrike Server Started!`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌐 WebSocket ready`);
    console.log(`=========================================`);
});
