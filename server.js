const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
        equipped: {
            skin: 'default',
            weapon: 'default',
            trail: 'none'
        }
    };
    
    // Send initial game data to the player
    socket.emit('init', {
        playerId: socket.id,
        players: players
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
            direction: data.direction
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
                shooterId: socket.id
            });
            
            // Check if player died
            if (targetPlayer.health <= 0) {
                targetPlayer.health = 0;
                
                // Award points to shooter
                shooter.score += 100;
                
                // Notify both players
                io.to(socket.id).emit('scoreUpdate', {
                    playerId: socket.id,
                    score: shooter.score
                });
                
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
                message: data.message.trim()
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
        if (!itemList) return;
        
        const item = itemList.find(i => i.id === itemId);
        if (!item) return;
        
        // Check if player already owns it (server-side storage would be needed)
        // For now, we'll just allow purchase and send success
        socket.emit('itemPurchased', {
            category: category,
            itemId: itemId,
            success: true
        });
    });
    
    // Handle item equipping
    socket.on('equipItem', (data) => {
        const player = players[socket.id];
        if (!player) return;
        
        const category = data.category;
        const itemId = data.itemId;
        
        // Update equipped item
        player.equipped[category] = itemId;
        
        // Update player color if it's a skin
        if (category === 'skin') {
            const skin = shopItems.skins.find(s => s.id === itemId);
            if (skin) {
                player.color = skin.color;
            }
        }
        
        socket.emit('itemEquipped', {
            category: category,
            itemId: itemId,
            success: true
        });
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

// Start server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
