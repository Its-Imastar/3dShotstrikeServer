// server.js
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

// Game state
const players = {};
const PORT = process.env.PORT || 3000;

// Username generator (matching client)
const adjectives = ["Quick", "Silent", "Brave", "Fierce", "Clever", "Bold", "Swift", "Mighty", "Sharp", "Wild", "Cool", "Epic", "Lone", "Dark", "Bright", "Steel", "Iron", "Shadow", "Blaze", "Storm"];
const nouns = ["Wolf", "Eagle", "Tiger", "Shark", "Fox", "Hawk", "Bear", "Lion", "Panther", "Dragon", "Phoenix", "Viper", "Raven", "Ghost", "Knight", "Ninja", "Sniper", "Hunter", "Warrior", "Striker"];

function generateUsername() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 9999) + 1;
    return `${adj}${noun}${num}`;
}

// Shop items (matching client)
const shopItems = {
    skins: [
        { id: 'default', name: 'Default', color: 0x3b82f6, price: 0 },
        { id: 'red', name: 'Crimson', color: 0xff0000, price: 100 },
        { id: 'green', name: 'Forest', color: 0x22c55e, price: 100 },
        { id: 'purple', name: 'Violet', color: 0xa855f7, price: 150 },
        { id: 'gold', name: 'Golden', color: 0xfbbf24, price: 300 },
        { id: 'cyan', name: 'Cyber', color: 0x06b6d4, price: 200 },
        { id: 'pink', name: 'Sakura', color: 0xec4899, price: 250 }
    ],
    weapons: [
        { id: 'default', name: 'Rifle', damage: 25, fireRate: 350, ammo: 30, price: 0 },
        { id: 'pistol', name: 'Pistol', damage: 20, fireRate: 200, ammo: 15, price: 150 },
        { id: 'shotgun', name: 'Shotgun', damage: 40, fireRate: 800, ammo: 8, price: 250 },
        { id: 'sniper', name: 'Sniper', damage: 75, fireRate: 1500, ammo: 5, price: 400 },
        { id: 'smg', name: 'SMG', damage: 15, fireRate: 100, ammo: 40, price: 300 }
    ],
    trails: [
        { id: 'none', name: 'No Trail', color: 0xffff00, price: 0 },
        { id: 'fire', name: 'Fire Trail', color: 0xff4500, price: 200 },
        { id: 'ice', name: 'Ice Trail', color: 0x00ffff, price: 200 },
        { id: 'toxic', name: 'Toxic Trail', color: 0x00ff00, price: 250 },
        { id: 'lightning', name: 'Lightning', color: 0xffff99, price: 350 },
        { id: 'purple', name: 'Mystic', color: 0x9333ea, price: 300 }
    ]
};

// Serve a simple status page at root
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Shotstrike Server</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: #1a1a1a;
                    color: white;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                }
                .container {
                    text-align: center;
                    background: rgba(0, 0, 0, 0.7);
                    padding: 40px;
                    border-radius: 10px;
                    border: 2px solid #2563eb;
                }
                h1 {
                    color: #60a5fa;
                    margin-bottom: 20px;
                }
                .status {
                    color: #22c55e;
                    font-weight: bold;
                    font-size: 1.2em;
                }
                .players {
                    margin-top: 20px;
                    color: #fbbf24;
                }
                .info {
                    margin-top: 20px;
                    color: #9ca3af;
                    font-size: 0.9em;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎮 Shotstrike Server</h1>
                <div class="status">✅ Server is running</div>
                <div class="players">👥 Players online: ${Object.keys(players).length}</div>
                <div class="info">Connect using the Shotstrike game client</div>
                <div class="info">Port: ${PORT}</div>
            </div>
        </body>
        </html>
    `);
});

// API endpoint to get server status
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        players: Object.keys(players).length,
        uptime: process.uptime()
    });
});

io.on('connection', (socket) => {
    console.log('New player connected:', socket.id);
    
    // Generate initial username for the player
    let username = generateUsername();
    
    // Generate random spawn position
    const spawnPoints = [
        { x: -70, y: 1.67, z: 0 },
        { x: 70, y: 1.67, z: 0 },
        { x: 0, y: 1.67, z: -70 },
        { x: 0, y: 1.67, z: 70 }
    ];
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    
    // Create player object
    players[socket.id] = {
        id: socket.id,
        username: username,
        position: spawn,
        rotation: { x: 0, y: 0 },
        color: Math.floor(Math.random() * 0xffffff),
        health: 100,
        score: 0,
        kills: 0,
        deaths: 0,
        equipped: {
            skin: 'default',
            weapon: 'default',
            trail: 'none'
        },
        coins: 0, // Simulated coin balance
        ownedItems: {
            skins: ['default'],
            weapons: ['default'],
            trails: ['none']
        }
    };
    
    // Send initial game data to the player
    socket.emit('init', {
        playerId: socket.id,
        players: players,
        username: username
    });
    
    // Notify other players about the new player
    socket.broadcast.emit('playerJoined', players[socket.id]);
    
    // Notify all players (including the new one) with chat message
    io.emit('chatMessage', {
        username: 'System',
        message: `${username} joined the game`
    });
    
    // Handle username change
    socket.on('setUsername', (data) => {
        if (data.username && data.username.trim() !== '') {
            const oldUsername = players[socket.id].username;
            players[socket.id].username = data.username;
            
            // Notify all players about the username change
            io.emit('playerUsernameUpdated', {
                playerId: socket.id,
                username: data.username
            });
            
            // Send chat notification
            io.emit('chatMessage', {
                username: 'System',
                message: `${oldUsername} is now known as ${data.username}`
            });
        }
    });
    
    // Handle player movement
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            
            // Broadcast to all other players
            socket.broadcast.emit('playerMoved', {
                playerId: socket.id,
                position: data.position,
                rotation: data.rotation
            });
        }
    });
    
    // Handle shooting
    socket.on('shoot', (data) => {
        // Broadcast shot to all other players
        socket.broadcast.emit('playerShot', {
            playerId: socket.id,
            from: data.from,
            direction: data.direction,
            trail: players[socket.id]?.equipped?.trail || 'none'
        });
    });
    
    // Handle hits
    socket.on('hit', (data) => {
        const targetPlayer = players[data.targetId];
        const shooter = players[socket.id];
        
        if (targetPlayer && shooter && targetPlayer.id !== socket.id) {
            // Apply damage (adjust based on equipped weapon)
            const weapon = shopItems.weapons.find(w => w.id === shooter.equipped.weapon) || shopItems.weapons[0];
            targetPlayer.health -= weapon.damage;
            
            // Update the hit player
            io.to(data.targetId).emit('playerHit', {
                health: targetPlayer.health,
                shooterId: socket.id,
                damage: weapon.damage
            });
            
            // Award coins for hit
            shooter.coins += 1;
            socket.emit('coinsUpdate', { coins: shooter.coins });
            
            // Check if player died
            if (targetPlayer.health <= 0) {
                targetPlayer.health = 0;
                targetPlayer.deaths += 1;
                
                // Award points and coins to shooter
                shooter.score += 100;
                shooter.kills += 1;
                shooter.coins += 5;
                
                // Notify both players
                io.to(socket.id).emit('scoreUpdate', {
                    playerId: socket.id,
                    score: shooter.score,
                    kills: shooter.kills
                });
                
                io.to(socket.id).emit('coinsUpdate', { coins: shooter.coins });
                
                io.to(data.targetId).emit('playerDied', {
                    killerId: socket.id,
                    targetId: data.targetId
                });
                
                // Broadcast death to all players
                io.emit('chatMessage', {
                    username: 'System',
                    message: `${shooter.username} eliminated ${targetPlayer.username}!`
                });
                
                // Respawn the dead player after 3 seconds
                setTimeout(() => {
                    if (players[data.targetId]) {
                        players[data.targetId].health = 100;
                        const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
                        players[data.targetId].position = spawn;
                        
                        io.to(data.targetId).emit('respawn', {
                            position: spawn,
                            health: 100
                        });
                        
                        io.emit('chatMessage', {
                            username: 'System',
                            message: `${targetPlayer.username} respawned`
                        });
                    }
                }, 3000);
            } else {
                // Award some points for hit
                shooter.score += 10;
                io.to(socket.id).emit('scoreUpdate', {
                    playerId: socket.id,
                    score: shooter.score
                });
            }
        }
    });
    
    // Handle chat messages
    socket.on('chatMessage', (data) => {
        if (data.message && data.message.trim() !== '') {
            // Broadcast message to all players
            io.emit('chatMessage', {
                username: players[socket.id].username,
                message: data.message.trim(),
                playerId: socket.id
            });
        }
    });
    
    // Handle shop purchases
    socket.on('buyItem', (data) => {
        const player = players[socket.id];
        if (!player) return;
        
        const category = data.category;
        const itemId = data.itemId;
        
        // Find the item
        const itemList = shopItems[category];
        if (!itemList) {
            socket.emit('shopError', { message: 'Invalid category' });
            return;
        }
        
        const item = itemList.find(i => i.id === itemId);
        if (!item) {
            socket.emit('shopError', { message: 'Item not found' });
            return;
        }
        
        // Check if player already owns it
        if (player.ownedItems[category].includes(itemId)) {
            socket.emit('shopError', { message: 'Already owned' });
            return;
        }
        
        // Check if player has enough coins
        if (player.coins < item.price) {
            socket.emit('shopError', { 
                message: `Not enough coins! Need ${item.price} but only have ${player.coins}` 
            });
            return;
        }
        
        // Process purchase
        player.coins -= item.price;
        player.ownedItems[category].push(itemId);
        
        socket.emit('itemPurchased', {
            category: category,
            itemId: itemId,
            coins: player.coins,
            ownedItems: player.ownedItems
        });
        
        socket.emit('coinsUpdate', { coins: player.coins });
    });
    
    // Handle item equipping
    socket.on('equipItem', (data) => {
        const player = players[socket.id];
        if (!player) return;
        
        const category = data.category;
        const itemId = data.itemId;
        
        // Check if player owns the item
        if (!player.ownedItems[category].includes(itemId)) {
            socket.emit('shopError', { message: 'You don\'t own this item' });
            return;
        }
        
        // Update equipped item
        player.equipped[category] = itemId;
        
        // Update player color if it's a skin
        if (category === 'skin') {
            const skin = shopItems.skins.find(s => s.id === itemId);
            if (skin) {
                player.color = skin.color;
                
                // Notify all players about color change
                io.emit('playerColorChanged', {
                    playerId: socket.id,
                    color: skin.color
                });
            }
        }
        
        socket.emit('itemEquipped', {
            category: category,
            itemId: itemId,
            equipped: player.equipped
        });
        
        // If it's a weapon, notify about stats change
        if (category === 'weapon') {
            const weapon = shopItems.weapons.find(w => w.id === itemId);
            if (weapon) {
                socket.emit('weaponChanged', {
                    damage: weapon.damage,
                    fireRate: weapon.fireRate,
                    ammo: weapon.ammo
                });
            }
        }
    });
    
    // Handle coin awards (for singleplayer actions)
    socket.on('addCoins', (data) => {
        const player = players[socket.id];
        if (player && data.amount) {
            player.coins += data.amount;
            socket.emit('coinsUpdate', { coins: player.coins });
        }
    });
    
    // Handle player stats request
    socket.on('getStats', () => {
        const player = players[socket.id];
        if (player) {
            socket.emit('playerStats', {
                username: player.username,
                score: player.score,
                kills: player.kills,
                deaths: player.deaths,
                coins: player.coins,
                equipped: player.equipped,
                ownedItems: player.ownedItems
            });
        }
    });
    
    // Handle player disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        if (players[socket.id]) {
            const username = players[socket.id].username;
            
            // Notify all players
            io.emit('playerLeft', socket.id);
            io.emit('chatMessage', {
                username: 'System',
                message: `${username} left the game`
            });
            
            // Remove player from game state
            delete players[socket.id];
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Server error!');
});

// Handle 404
app.use((req, res) => {
    res.status(404).send(`
        <html>
        <head><title>404 - Not Found</title></head>
        <body style="background: #1a1a1a; color: white; font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh;">
            <div style="text-align: center;">
                <h1 style="color: #ef4444;">404 - Not Found</h1>
                <p>This is the Shotstrike game server API.</p>
                <p>Connect using the game client or visit the <a href="/" style="color: #60a5fa;">status page</a>.</p>
            </div>
        </body>
        </html>
    `);
});

// Start server
server.listen(PORT, () => {
    console.log(`🎮 Shotstrike server running on port ${PORT}`);
    console.log(`🌐 Status page: http://localhost:${PORT}`);
    console.log(`📊 API status: http://localhost:${PORT}/status`);
});
