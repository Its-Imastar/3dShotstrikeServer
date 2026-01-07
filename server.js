// server.js - Updated with Shop System
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Player data storage
const players = {};
const playerUpgrades = {}; // Store player upgrades
const playerCoins = {}; // Store player coins

// Shop items configuration (matches client)
const shopItems = {
    blaster: [
        {
            id: 'blaster_damage',
            name: 'Damage Upgrade',
            maxLevel: 10,
            basePrice: 50,
            priceMultiplier: 1.5,
            stats: { damage: { base: 25, increase: 5 } }
        },
        {
            id: 'blaster_ammo',
            name: 'Extended Magazine',
            maxLevel: 10,
            basePrice: 40,
            priceMultiplier: 1.4,
            stats: { maxAmmo: { base: 30, increase: 5 } }
        },
        {
            id: 'blaster_reload',
            name: 'Rapid Reload',
            maxLevel: 10,
            basePrice: 60,
            priceMultiplier: 1.6,
            stats: { reloadSpeed: { base: 3.0, decrease: 0.2 } }
        }
    ],
    hp: [
        {
            id: 'hp_max',
            name: 'Max HP Increase',
            maxLevel: 10,
            basePrice: 80,
            priceMultiplier: 1.8,
            stats: { maxHP: { base: 100, increase: 20 } }
        },
        {
            id: 'hp_regen',
            name: 'HP Regeneration',
            maxLevel: 8,
            basePrice: 70,
            priceMultiplier: 1.7,
            stats: { hpRegen: { base: 5, increase: 2 } }
        },
        {
            id: 'hp_regen_delay',
            name: 'Quick Recovery',
            maxLevel: 5,
            basePrice: 90,
            priceMultiplier: 2.0,
            stats: { hpRegenDelay: { base: 4, decrease: 0.5 } }
        }
    ],
    abilities: [
        {
            id: 'ability_doublejump',
            name: 'Double Jump',
            maxLevel: 1,
            basePrice: 500,
            stats: {}
        },
        {
            id: 'ability_sprint',
            name: 'Sprint',
            maxLevel: 1,
            basePrice: 300,
            stats: {}
        }
    ],
    cosmetics: [
        {
            id: 'cosmetic_trail',
            name: 'Bullet Trail',
            maxLevel: 1,
            basePrice: 100,
            stats: {}
        }
    ]
};

// Calculate item price
function calculateItemPrice(item, currentLevel) {
    if (currentLevel >= item.maxLevel) return Infinity;
    
    if (item.priceMultiplier) {
        return Math.floor(item.basePrice * Math.pow(item.priceMultiplier, currentLevel));
    }
    return item.basePrice;
}

// Apply upgrade stats
function applyUpgradeStats(playerId, item) {
    const currentLevel = getUpgradeLevel(playerId, item.id);
    
    Object.entries(item.stats).forEach(([stat, data]) => {
        if (data.increase) {
            if (stat === 'damage') {
                playerUpgrades[playerId].damage = data.base + (currentLevel * data.increase);
            }
            else if (stat === 'maxHP') {
                playerUpgrades[playerId].maxHP = data.base + (currentLevel * data.increase);
            }
            else if (stat === 'hpRegen') {
                playerUpgrades[playerId].hpRegen = data.base + (currentLevel * data.increase);
            }
            else if (stat === 'maxAmmo') {
                playerUpgrades[playerId].maxAmmo = data.base + (currentLevel * data.increase);
            }
        } else if (data.decrease) {
            if (stat === 'reloadSpeed') {
                playerUpgrades[playerId].reloadSpeed = Math.max(0.5, data.base - (currentLevel * data.decrease));
            }
            else if (stat === 'hpRegenDelay') {
                playerUpgrades[playerId].hpRegenDelay = Math.max(1, data.base - (currentLevel * data.decrease));
            }
        }
    });
}

function getUpgradeLevel(playerId, itemId) {
    if (!playerUpgrades[playerId]) return 0;
    if (!playerUpgrades[playerId][itemId]) return 0;
    return playerUpgrades[playerId][itemId];
}

// Initialize player data
function initializePlayerData(playerId) {
    if (!playerUpgrades[playerId]) {
        playerUpgrades[playerId] = {
            blasterLevel: 1,
            maxAmmo: 30,
            reloadSpeed: 3.0,
            damage: 25,
            maxHP: 100,
            hpRegen: 5,
            hpRegenDelay: 4,
            damageReduction: 0
        };
    }
    
    if (!playerCoins[playerId]) {
        playerCoins[playerId] = 100; // Starting coins
    }
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Initialize player
    players[socket.id] = {
        id: socket.id,
        username: 'Guest',
        position: { x: 0, y: 1.67, z: 0 },
        rotation: { x: 0, y: 0 },
        color: Math.floor(Math.random() * 0xffffff),
        health: 100,
        score: 0
    };
    
    // Initialize player upgrades and coins
    initializePlayerData(socket.id);
    
    // Send existing players to new player
    socket.emit('init', {
        playerId: socket.id,
        players: players
    });
    
    // Send initial coins and upgrades
    socket.emit('coinUpdate', {
        playerId: socket.id,
        coins: playerCoins[socket.id]
    });
    
    // Notify other players
    socket.broadcast.emit('playerJoined', players[socket.id]);
    
    // Handle username setting
    socket.on('setUsername', (username) => {
        players[socket.id].username = username;
        socket.broadcast.emit('playerUsernameUpdated', {
            playerId: socket.id,
            username: username
        });
    });
    
    // Handle player upgrades
    socket.on('playerUpgrades', (upgrades) => {
        playerUpgrades[socket.id] = {
            ...playerUpgrades[socket.id],
            ...upgrades
        };
    });
    
    // Handle shop purchases
    socket.on('purchaseUpgrade', (data) => {
        const { upgradeId, upgradeName, price } = data;
        const playerId = socket.id;
        
        // Find the item
        let item = null;
        for (const [category, items] of Object.entries(shopItems)) {
            const found = items.find(i => i.id === upgradeId);
            if (found) {
                item = found;
                break;
            }
        }
        
        if (!item) {
            socket.emit('upgradePurchased', {
                success: false,
                message: 'Item not found!'
            });
            return;
        }
        
        // Check if player has enough coins
        if (playerCoins[playerId] < price) {
            socket.emit('upgradePurchased', {
                success: false,
                message: 'Not enough coins!'
            });
            return;
        }
        
        // Check max level
        const currentLevel = getUpgradeLevel(playerId, upgradeId);
        if (currentLevel >= item.maxLevel) {
            socket.emit('upgradePurchased', {
                success: false,
                message: 'Maximum level reached!'
            });
            return;
        }
        
        // Deduct coins
        playerCoins[playerId] -= price;
        
        // Update upgrade level
        if (!playerUpgrades[playerId][upgradeId]) {
            playerUpgrades[playerId][upgradeId] = 1;
        } else {
            playerUpgrades[playerId][upgradeId]++;
        }
        
        // Apply stats
        applyUpgradeStats(playerId, item);
        
        // Update blaster level if it's a blaster upgrade
        if (upgradeId.startsWith('blaster_')) {
            playerUpgrades[playerId].blasterLevel = Math.max(
                playerUpgrades[playerId].blasterLevel || 1,
                currentLevel + 1
            );
        }
        
        // Send success response
        socket.emit('upgradePurchased', {
            success: true,
            upgradeId: upgradeId,
            upgradeName: upgradeName,
            newCoins: playerCoins[playerId]
        });
        
        // Send coin update
        socket.emit('coinUpdate', {
            playerId: playerId,
            coins: playerCoins[playerId]
        });
        
        console.log(`Player ${playerId} purchased ${upgradeName} (Level ${currentLevel + 1})`);
    });
    
    // Handle player movement
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
    
    // Handle hits
    socket.on('hit', (data) => {
        const targetId = data.targetId;
        if (players[targetId] && players[socket.id]) {
            // Get shooter's damage from upgrades
            const shooterDamage = playerUpgrades[socket.id]?.damage || 25;
            
            // Apply damage reduction if target has it
            const targetDamageReduction = playerUpgrades[targetId]?.damageReduction || 0;
            const actualDamage = shooterDamage * (1 - targetDamageReduction / 100);
            
            players[targetId].health -= actualDamage;
            
            // Emit health update
            io.to(targetId).emit('playerHealthUpdate', {
                playerId: targetId,
                health: players[targetId].health
            });
            
            // Emit hit event for visual feedback
            io.to(targetId).emit('playerHit', {
                targetId: targetId,
                health: players[targetId].health,
                damage: actualDamage
            });
            
            // Check if player died
            if (players[targetId].health <= 0) {
                // Respawn player
                players[targetId].health = playerUpgrades[targetId]?.maxHP || 100;
                players[targetId].position = { x: 0, y: 1.67, z: 0 };
                players[targetId].rotation = { x: 0, y: 0 };
                
                // Update shooter's score and give coins
                players[socket.id].score += 100;
                playerCoins[socket.id] += 30; // Kill reward
                
                // Emit death event
                io.emit('playerDied', {
                    targetId: targetId,
                    killerId: socket.id,
                    killerScore: players[socket.id].score
                });
                
                // Update shooter's score
                io.to(socket.id).emit('scoreUpdate', {
                    playerId: socket.id,
                    score: players[socket.id].score
                });
                
                // Update shooter's coins
                io.to(socket.id).emit('coinUpdate', {
                    playerId: socket.id,
                    coins: playerCoins[socket.id]
                });
                
                console.log(`Player ${targetId} was killed by ${socket.id}`);
            }
        }
    });
    
    // Handle chat messages
    socket.on('chatMessage', (data) => {
        const message = data.message;
        const username = players[socket.id]?.username || 'Guest';
        io.emit('chatMessage', {
            username: username,
            message: message
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        // Notify other players
        io.emit('playerLeft', socket.id);
        
        // Clean up data
        delete players[socket.id];
        delete playerUpgrades[socket.id];
        delete playerCoins[socket.id];
    });
    
    // Periodic coin rewards for playing
    setInterval(() => {
        if (players[socket.id]) {
            // Give 10 coins every minute for playing
            playerCoins[socket.id] += 10;
            socket.emit('coinUpdate', {
                playerId: socket.id,
                coins: playerCoins[socket.id]
            });
        }
    }, 60000); // Every minute
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
