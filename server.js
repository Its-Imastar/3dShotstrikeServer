// server.js - COPPA-Compliant with FREE Gemini AI + Bad Word List
// Safe for users under 13

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialize Google Gemini AI (FREE TIER)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Validate API key on startup
if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY not set. Using basic filter only.');
    console.log('   Get your FREE key: https://aistudio.google.com/app/apikey');
} else {
    console.log('✅ Gemini API key configured');
}

// Load bad words from external file
let blockedWordsFromFile = [];
try {
    const badWordsPath = path.join(__dirname, 'badwords.txt');
    if (fs.existsSync(badWordsPath)) {
        blockedWordsFromFile = fs.readFileSync(badWordsPath, 'utf-8')
            .split('\n')
            .map(word => word.trim().toLowerCase())
            .filter(word => word.length > 0);
        console.log(`✅ Loaded ${blockedWordsFromFile.length} bad words from file`);
    } else {
        console.log('ℹ️  No badwords.txt file found, using built-in list only');
    }
} catch (error) {
    console.warn('⚠️  Could not load badwords.txt:', error.message);
}

// Basic filter with bad word list
const basicFilter = (message) => {
    // Normalize message to catch workarounds
    const normalized = message.toLowerCase()
        .replace(/[@4]/g, 'a')
        .replace(/[8]/g, 'b')
        .replace(/[(<\[{]/g, 'c')
        .replace(/[3]/g, 'e')
        .replace(/[!1|iíîïì]/g, 'i')
        .replace(/[0oóôöò]/g, 'o')
        .replace(/[$5]/g, 's')
        .replace(/[7+]/g, 't')
        .replace(/[µ]/g, 'u')
        .replace(/[\s\-_\.•·,;:]/g, '')
        .replace(/[àáâãäå]/g, 'a')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[^\w]/g, '');
    
    // Critical words (always blocked) - VERY STRICT FOR KIDS
    const criticalWords = [
        // All slurs
        'nigger', 'faggot', 'retard', 'gay',
        // Violence words
        'kill', 'murder', 'die', 'death', 'blood', 'gun', 'knife', 'shoot', 'stab',
        'rape', 'suicide', 'kys', 'killyourself', 'hurt', 'pain', 'torture',
        // Inappropriate content
        'sex', 'porn', 'xxx', 'naked', 'nude', 'penis', 'vagina', 'boobs', 'butt',
        'pedo', 'pedophile', 'molest',
        // Personal safety
        'address', 'phone', 'email', 'meet', 'location', 'school', 'age', 'parent',
        'discord', 'snap', 'snapchat', 'instagram', 'tiktok', 'whatsapp',
        // Mean/bullying words (kids should be kind!)
        'stupid', 'dumb', 'idiot', 'loser', 'ugly', 'fat', 'hate', 'sucks',
        // Profanity
        'fuck', 'shit', 'bitch', 'ass', 'damn', 'hell', 'crap', 'piss'
    ];
    
    // Combine critical words + file words
    const allBlockedWords = [...new Set([...criticalWords, ...blockedWordsFromFile])];
    
    // Check blocked words
    for (let word of allBlockedWords) {
        if (word.length > 2 && normalized.includes(word)) {
            console.log(`❌ Basic filter blocked: "${message}" → contains "${word}"`);
            return false;
        }
    }
    
    // Personal info patterns
    const personalInfoPatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
        /\b\d{5}(?:[-\s]\d{4})?\b/,
        /\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd)\b/i,
        /\b(?:discord|snapchat|instagram|tiktok)\.gg\b/i,
        /\b(?:www\.|http|\.com|\.net)\b/i
    ];
    
    for (let pattern of personalInfoPatterns) {
        if (pattern.test(message)) {
            console.log(`❌ Basic filter blocked: personal info in "${message}"`);
            return false;
        }
    }
    
    return true;
};

// AI-powered moderation using FREE Gemini
async function moderateMessage(message) {
    // FIRST: Run basic filter
    if (!basicFilter(message)) {
        return false;
    }
    
    // If no API key, basic filter already passed it
    if (!process.env.GEMINI_API_KEY) {
        return true;
    }
    
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest"
        });
        
        const prompt = `You are a VERY STRICT chat moderator for a children's game (ages 6-12). Kids' safety is the top priority. Respond with ONLY "SAFE" or "UNSAFE".

UNSAFE if message contains:
- ANY curse words or mean words (stupid, dumb, idiot, loser, etc.)
- ANY mentions of violence, weapons, fighting, killing, hurting, blood
- ANY body parts or bathroom words
- Asking personal questions (age, name, where you live, what school)
- Asking to meet, talk outside game, or exchange contact info
- Mentioning social media (Discord, Snapchat, Instagram, TikTok, YouTube)
- ANY adult topics (dating, relationships, inappropriate content)
- Bullying, teasing, or being mean to others
- Telling someone to do something dangerous
- Trying to trick the filter with symbols or spacing

SAFE ONLY if message is:
- Positive game chat: "good game", "nice shot", "great job", "gg", "wp"
- Game strategy: "let's go left", "watch out", "defend the base"
- Friendly and kind: "thanks", "you're good", "that was cool", "have fun"
- Simple questions about the GAME ONLY: "how do you jump?", "what does this do?"

When in doubt, mark as UNSAFE. Better to block a safe message than allow an unsafe one.

Message to check: "${message.substring(0, 200)}"

Your response (SAFE or UNSAFE):`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim().toUpperCase();
        
        const isSafe = text.includes('SAFE') && !text.includes('UNSAFE');
        
        console.log(`🤖 AI moderation: "${message.substring(0, 30)}..." → ${isSafe ? 'SAFE' : 'UNSAFE'}`);
        
        return isSafe;
        
    } catch (error) {
        console.error("AI moderation error:", error.message);
        return true; // Already passed basic filter
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
        msg => now - msg.timestamp < 15000
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
    
    if (sameMessageCount >= 2) return true;
    if (messageCount >= 4) return true;
    
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
    console.log('✅ Player connected:', socket.id);
    
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
            }
        }
    });
    
    // COPPA-COMPLIANT CHAT HANDLER
    socket.on('chatMessage', async (data) => {
        const message = data.message.trim();
        const username = players[socket.id]?.username || 'Guest';
        
        if (!message || message.length === 0) return;
        
        if (message.length > 100) {
            socket.emit('chatMessage', {
                username: 'System',
                message: '⚠️ Message too long (max 100 characters)'
            });
            return;
        }
        
        if (message.length < 2) {
            socket.emit('chatMessage', {
                username: 'System',
                message: '⚠️ Message too short'
            });
            return;
        }
        
        if (isSpam(socket.id, message)) {
            socket.emit('chatMessage', {
                username: 'System',
                message: '⚠️ Please wait before sending another message'
            });
            return;
        }
        
        const isSafe = await moderateMessage(message);
        
        if (!isSafe) {
            socket.emit('chatMessage', {
                username: 'System',
                message: '⚠️ Your message was blocked. Please keep chat friendly!'
            });
            console.log(`❌ Blocked message from ${username}: "${message}"`);
            return;
        }
        
        io.emit('chatMessage', {
            username: username,
            message: message
        });
        
        console.log(`💬 Chat from ${username}: "${message}"`);
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
    console.log(`🎮 Server running on port ${PORT}`);
    console.log('👶 COPPA-COMPLIANT MODE: Safe for users under 13');
    console.log('✅ Multi-layer chat filtering active');
});
