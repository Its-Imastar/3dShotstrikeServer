// server.js - Complete with Shop System & FREE AI Chat Filter (Google Gemini)

// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialize Google Gemini AI (FREE TIER)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Test API key on startup
async function testGeminiAPI() {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const result = await model.generateContent("Say hello");
        const response = await result.response;
        console.log("✅ Gemini API working! Response:", response.text());
    } catch (error) {
        console.error("❌ Gemini API test failed:", error.message);
        console.log("Chat filter will use basic pattern matching instead.");
    }
}
testGeminiAPI();

// Validate API key on startup
if (!process.env.GEMINI_API_KEY) {
    console.warn('WARNING: GEMINI_API_KEY not set. Chat filter will use basic pattern matching only.');
}

// Basic filter as fallback
const basicFilter = (message) => {
    const blockedPatterns = [
        /n[i1!]gg[ae3r]+/gi,
        /f[a@4]g+[o0]t/gi,
        /c[o0]ck/gi,
        /[ck]unt/gi,
        /wh[o0]re/gi,
        /b[i1]tch/gi,
        /d[i1]ck/gi,
        /p[e3]n[i1]s/gi,
        /v[a@4]g[i1]n[a@]/gi,
        /[a@]ss+[h4][o0]l[e3]/gi,
        /r[a@]p[e3]/gi,
        /h[i1]tler/gi,
        /n[a@]z[i1]/gi,
        /k[i1]ll.*y[o0]u[r]?s[e3]lf/gi,
        /su[i1]c[i1]d[e3]/gi,
        /d[i1][e3] .*f[a@4]g/gi,
        /ret[a@4]rd/gi,
        /tr[a@4]nny/gi
    ];
    
    // Check for excessive profanity
    const profanityCount = (message.match(/fuck|shit|damn|crap|hell/gi) || []).length;
    if (profanityCount > 3) return false;
    
    // Check for personal info/doxxing attempts
    const personalInfoPatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone numbers
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
        /\b\d{5}(?:[-\s]\d{4})?\b/, // Zip codes
    ];
    
    if (personalInfoPatterns.some(pattern => pattern.test(message))) return false;
    
    return !blockedPatterns.some(pattern => pattern.test(message));
};

// AI-powered moderation function using FREE Gemini
async function moderateMessage(message) {
    // If no API key, use basic filter
    if (!process.env.GEMINI_API_KEY) {
        return basicFilter(message);
    }
    
    try {
        // Use the FREE gemini-pro model
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        
        const prompt = `Analyze this gaming chat message. Return ONLY "SAFE" or "UNSAFE" (no other text).
        
Consider these violations:
1. Hate speech, racism, discrimination
2. Harassment or bullying  
3. Explicit sexual content
4. Violent threats or glorification of violence
5. Personal information/doxxing
6. Excessive profanity (>3 instances)
7. Spam (repeating same message)

Gaming context allowed:
- Mild competitive banter is OK
- "GG", "WP", "Nice shot" are fine
- Trash talk like "you're bad" is OK
- "I'll kill you" in game context is OK

Message: "${message.substring(0, 200)}"

Response:`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim().toUpperCase();
        
        console.log("AI Moderation:", message.substring(0, 30) + "...", "->", text);
        
        return text === "SAFE";
        
    } catch (error) {
        console.error("AI Moderation error, using basic filter:", error.message);
        // Fallback to basic filter
        return basicFilter(message);
    }
}

// Player data storage
const players = {};
const playerUpgrades = {};
const playerCoins = {};
const messageHistory = {};

// Spam detection
function isSpam(playerId, message) {
    if (!messageHistory[playerId]) {
        messageHistory[playerId] = [];
    }
    
    const now = Date.now();
    const recentMessages = messageHistory[playerId].filter(
        msg => now - msg.timestamp < 10000
    );
    
    const sameMessageCount = recentMessages.filter(
        msg => msg.message.toLowerCase() === message.toLowerCase()
    ).length;
    
    const messageCount = recentMessages.length;
    
    messageHistory[playerId].push({
        message: message,
        timestamp: now
    });
    
    if (messageHistory[playerId].length > 10) {
        messageHistory[playerId] = messageHistory[playerId].slice(-10);
    }
    
    if (sameMessageCount >= 3) return true;
    if (messageCount >= 5) return true;
    
    return false;
}

// Shop items configuration
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

function calculateItemPrice(item, currentLevel) {
    if (currentLevel >= item.maxLevel) return Infinity;
    if (item.priceMultiplier) {
        return Math.floor(item.basePrice * Math.pow(item.priceMultiplier, currentLevel));
    }
    return item.basePrice;
}

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
        playerCoins[playerId] = 100;
    }
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    players[socket.id] = {
        id: socket.id,
        username: 'Guest',
        position: { x: 0, y: 1.67, z: 0 },
        rotation: { x: 0, y: 0 },
        color: Math.floor(Math.random() * 0xffffff),
        health: 100,
        score: 0
    };
    
    initializePlayerData(socket.id);
    
    socket.emit('init', {
        playerId: socket.id,
        players: players
    });
    
    socket.emit('coinUpdate', {
        playerId: socket.id,
        coins: playerCoins[socket.id]
    });
    
    socket.broadcast.emit('playerJoined', players[socket.id]);
    
    socket.on('setUsername', (username) => {
        players[socket.id].username = username;
        socket.broadcast.emit('playerUsernameUpdated', {
            playerId: socket.id,
            username: username
        });
    });
    
    socket.on('playerUpgrades', (upgrades) => {
        playerUpgrades[socket.id] = {
            ...playerUpgrades[socket.id],
            ...upgrades
        };
    });
    
    socket.on('purchaseUpgrade', async (data) => {
        const { upgradeId, price } = data;
        const playerId = socket.id;
        
        let item = null;
        let itemName = '';
        for (const [category, items] of Object.entries(shopItems)) {
            const found = items.find(i => i.id === upgradeId);
            if (found) {
                item = found;
                itemName = found.name;
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
        
        if (playerCoins[playerId] < price) {
            socket.emit('upgradePurchased', {
                success: false,
                message: 'Not enough coins!'
            });
            return;
        }
        
        const currentLevel = getUpgradeLevel(playerId, upgradeId);
        if (currentLevel >= item.maxLevel) {
            socket.emit('upgradePurchased', {
                success: false,
                message: 'Maximum level reached!'
            });
            return;
        }
        
        playerCoins[playerId] -= price;
        
        if (!playerUpgrades[playerId][upgradeId]) {
            playerUpgrades[playerId][upgradeId] = 1;
        } else {
            playerUpgrades[playerId][upgradeId]++;
        }
        
        applyUpgradeStats(playerId, item);
        
        if (upgradeId.startsWith('blaster_')) {
            playerUpgrades[playerId].blasterLevel = Math.max(
                playerUpgrades[playerId].blasterLevel || 1,
                currentLevel + 1
            );
        }
        
        socket.emit('upgradePurchased', {
            success: true,
            upgradeId: upgradeId,
            upgradeName: itemName,
            newCoins: playerCoins[playerId]
        });
        
        socket.emit('coinUpdate', {
            playerId: playerId,
            coins: playerCoins[playerId]
        });
        
        console.log(`Player ${playerId} purchased ${itemName} (Level ${currentLevel + 1})`);
    });
    
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
    
    socket.on('shoot', (data) => {
        socket.broadcast.emit('playerShot', {
            playerId: socket.id,
            from: data.from,
            direction: data.direction
        });
    });
    
    socket.on('hit', (data) => {
        const targetId = data.targetId;
        if (players[targetId] && players[socket.id]) {
            const shooterDamage = playerUpgrades[socket.id]?.damage || 25;
            const targetDamageReduction = playerUpgrades[targetId]?.damageReduction || 0;
            const actualDamage = shooterDamage * (1 - targetDamageReduction / 100);
            
            players[targetId].health -= actualDamage;
            
            io.to(targetId).emit('playerHealthUpdate', {
                playerId: targetId,
                health: players[targetId].health
            });
            
            io.to(targetId).emit('playerHit', {
                targetId: targetId,
                health: players[targetId].health,
                damage: actualDamage
            });
            
            if (players[targetId].health <= 0) {
                players[targetId].health = playerUpgrades[targetId]?.maxHP || 100;
                players[targetId].position = { x: 0, y: 1.67, z: 0 };
                players[targetId].rotation = { x: 0, y: 0 };
                
                players[socket.id].score += 100;
                playerCoins[socket.id] += 30;
                
                io.emit('playerDied', {
                    targetId: targetId,
                    killerId: socket.id,
                    killerScore: players[socket.id].score
                });
                
                io.to(socket.id).emit('scoreUpdate', {
                    playerId: socket.id,
                    score: players[socket.id].score
                });
                
                io.to(socket.id).emit('coinUpdate', {
                    playerId: socket.id,
                    coins: playerCoins[socket.id]
                });
                
                console.log(`Player ${targetId} was killed by ${socket.id}`);
            }
        }
    });
    
    socket.on('chatMessage', async (data) => {
        const message = data.message.trim();
        const username = players[socket.id]?.username || 'Guest';
        
        if (!message || message.length === 0) return;
        if (message.length > 200) {
            socket.emit('chatMessage', {
                username: 'System',
                message: 'Message too long (max 200 characters)'
            });
            return;
        }
        
        if (isSpam(socket.id, message)) {
            socket.emit('chatMessage', {
                username: 'System',
                message: 'Message blocked: Sending too many messages'
            });
            return;
        }
        
        try {
            const isSafe = await moderateMessage(message);
            
            if (!isSafe) {
                socket.emit('chatMessage', {
                    username: 'System',
                    message: 'Message blocked: Inappropriate content detected'
                });
                console.log(`Blocked message from ${socket.id}: ${message.substring(0, 50)}...`);
                return;
            }
            
            io.emit('chatMessage', {
                username: username,
                message: message
            });
            
            console.log(`Chat from ${username}: ${message}`);
            
        } catch (error) {
            console.error("Error processing chat:", error);
            socket.emit('chatMessage', {
                username: 'System',
                message: 'Error processing message'
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        io.emit('playerLeft', socket.id);
        delete players[socket.id];
        delete playerUpgrades[socket.id];
        delete playerCoins[socket.id];
        delete messageHistory[socket.id];
    });
    
    setInterval(() => {
        if (players[socket.id]) {
            playerCoins[socket.id] += 10;
            socket.emit('coinUpdate', {
                playerId: socket.id,
                coins: playerCoins[socket.id]
            });
        }
    }, 60000);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Chat filtering:', process.env.GEMINI_API_KEY ? 'AI ACTIVE (Gemini FREE)' : 'Basic filter only');
});
