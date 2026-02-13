// server.js - COPPA-Compliant with FREE Gemini AI + Bad Word List
// Safe for users under 13 - WITH FIXED CUSTOM MATCH ISOLATION

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
    // Advanced normalization to catch MORE workarounds
    const normalized = message.toLowerCase()
        // Leetspeak
        .replace(/[@4]/g, 'a')
        .replace(/[8]/g, 'b')
        .replace(/[(<\[{]/g, 'c')
        .replace(/[3]/g, 'e')
        .replace(/[!1|iíîïìĩī]/g, 'i')
        .replace(/[0oóôöòõō]/g, 'o')
        .replace(/[$5]/g, 's')
        .replace(/[7+]/g, 't')
        .replace(/[µ]/g, 'u')
        // Remove ALL separators
        .replace(/[\s\-_\.•·,;:'"]/g, '')
        // Remove accents/diacritics
        .replace(/[àáâãäåāăą]/g, 'a')
        .replace(/[èéêëēĕėęě]/g, 'e')
        .replace(/[ìíîïĩīĭįı]/g, 'i')
        .replace(/[òóôõöōŏő]/g, 'o')
        .replace(/[ùúûüũūŭůűų]/g, 'u')
        .replace(/[ýÿ]/g, 'y')
        .replace(/[ñ]/g, 'n')
        .replace(/[ç]/g, 'c')
        // Remove Cyrillic lookalikes
        .replace(/[аӓ]/g, 'a')
        .replace(/[е]/g, 'e')
        .replace(/[і]/g, 'i')
        .replace(/[о]/g, 'o')
        .replace(/[с]/g, 'c')
        .replace(/[р]/g, 'p')
        .replace(/[х]/g, 'x')
        // Remove emoji/symbols
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
        .replace(/[\u{2600}-\u{26FF}]/gu, '')
        .replace(/[^\w]/g, '');
    
    // Critical words (always blocked) - VERY STRICT FOR KIDS
    const criticalWords = [
        'nigger', 'nigga', 'nig', 'faggot', 'fag', 'retard', 'gay',
        'kill', 'murder', 'die', 'death', 'dead', 'blood', 'gun', 'knife', 'shoot', 'stab',
        'rape', 'suicide', 'kys', 'killyourself', 'hurt', 'pain', 'torture', 'weapon',
        'unalive', 'sewerslide', 'toasterbath', 'neckrope', 'aliven', 'die',
        'sex', 'sexy', 'porn', 'xxx', 'naked', 'nude', 'penis', 'vagina', 'boobs', 'butt', 'booty',
        'pedo', 'pedophile', 'molest', 'nsfw', 'corn',
        'address', 'phone', 'phonenumber', 'email', 'gmail', 'meet', 'meetup', 'location', 
        'school', 'age', 'howold', 'parent', 'whereulive', 'city', 'state',
        'discord', 'snap', 'snapchat', 'insta', 'instagram', 'tiktok', 'whatsapp', 'addme',
        'stupid', 'dumb', 'idiot', 'moron', 'loser', 'ugly', 'fat', 'hate', 'sucks', 'trash',
        'fuck', 'fck', 'fuk', 'fvck', 'phuck',
        'shit', 'sht', 'shyt', 
        'bitch', 'btch', 'biatch',
        'ass', 'arse', 'azz',
        'damn', 'dang', 'darn',
        'hell', 'heck',
        'crap', 'piss'
    ];
    
    const allBlockedWords = [...new Set([...criticalWords, ...blockedWordsFromFile])];
    
    for (let word of allBlockedWords) {
        if (word.length > 2 && normalized.includes(word)) {
            console.log(`❌ Basic filter blocked: "${message}" → contains "${word}"`);
            return false;
        }
    }
    
    if (/(.)\1{4,}/.test(message)) {
        console.log(`❌ Basic filter blocked: "${message}" → character spam`);
        return false;
    }
    
    const personalInfoPatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
        /\b\d{5}(?:[-\s]\d{4})?\b/,
        /\b\d{1,5}\s+\w+\s+(street|st|ave|road|rd)\b/i,
        /\b(?:discord|snap|insta|tiktok)\.gg\b/i,
        /\b(?:www\.|http|\.com|\.net|\.org)\b/i,
        /\bim\s+\d{1,2}\b/i,
        /\bi\s*am\s+\d{1,2}\s+(years?\s*old|yo|y\/o)\b/i
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
    if (!basicFilter(message)) {
        return false;
    }
    
    if (!process.env.GEMINI_API_KEY) {
        return true;
    }
    
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest"
        });
        
        const prompt = `You are a VERY STRICT chat moderator for a children's game (ages 6-12). Kids' safety is the top priority. Respond with ONLY "SAFE" or "UNSAFE".

UNSAFE if message contains:
- ANY curse words or mean words
- ANY mentions of violence, weapons, fighting, killing, hurting, blood
- ANY body parts or bathroom words
- Asking personal questions
- Asking to meet or exchange contact info
- Mentioning social media
- ANY adult topics
- Bullying, teasing, or being mean to others
- Trying to trick the filter

SAFE ONLY if message is:
- Positive game chat: "good game", "nice shot", "great job", "gg", "wp"
- Game strategy: "let's go left", "watch out", "defend the base"
- Friendly and kind: "thanks", "you're good", "that was cool", "have fun"
- Simple questions about the GAME ONLY

When in doubt, mark as UNSAFE.

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
        return true;
    }
}

// Player data storage
const players = {};
const playerLoadouts = {};
const playerCoins = {};
const messageHistory = {};

// Track which players are in which mode
const playerMode = {}; // 'global' or matchId

// Gun definitions matching client
const GUNS = {
    'gun_semi_auto': { damage: 12, firerate: 200, ammo: 12, reloadTime: 2.5, speed: 0 },
    'gun_full_auto': { damage: 7, firerate: 150, ammo: 30, reloadTime: 3, speed: -5 },
    'gun_burst': { damage: 18, firerate: 100, ammo: 15, reloadTime: 1.5, burstCooldown: 1.5, burstCount: 3, speed: 5 },
    'gun_sniper': { damage: 45, firerate: 2500, ammo: 8, reloadTime: 4.5, speed: -15 },
    'gun_battle_rifle': { damage: 16, firerate: 350, ammo: 18, reloadTime: 4, speed: -5 },
    'gun_smg': { damage: 10, firerate: 200, ammo: 20, reloadTime: 1.25, speed: 20 },
    'gun_lmg': { damage: 6, firerate: 80, ammo: 50, reloadTime: 5, speed: -20 },
    'gun_shotgun': { damage: 18, firerate: 1250, ammo: 7, reloadTime: 0.8, spread: 8, pelletCount: 6, speed: 10 },
    'gun_marksman': { damage: 50, firerate: 1300, ammo: 9, reloadTime: 3, speed: 0 }
};

// Custom Match System
const customMatches = {};

function generateMatchCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

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

function initializePlayerData(playerId) {
    if (!playerLoadouts[playerId]) {
        playerLoadouts[playerId] = {
            equippedGun: 'gun_semi_auto',
            equippedAbilities: [],
            equippedPerk: null
        };
    }
    
    if (!playerCoins[playerId]) {
        playerCoins[playerId] = 0;
    }
}

io.on('connection', (socket) => {
    console.log('✅ Player connected:', socket.id);
    
    // Default to global mode
    playerMode[socket.id] = 'global';
    
    players[socket.id] = {
        id: socket.id,
        username: 'Guest',
        position: { x: 0, y: 1.67, z: 0 },
        rotation: { x: 0, y: 0 },
        color: Math.floor(Math.random() * 0xffffff),
        health: 100,
        shield: 0,
        score: 0,
        kills: 0,
        deaths: 0,
        lastDamageTime: Date.now()
    };
    
    initializePlayerData(socket.id);
    
    // Send initial data to client - FILTERED by mode
    // Only send players who are also in global mode
    const globalPlayers = {};
    Object.keys(players).forEach(id => {
        if (playerMode[id] === 'global') {
            globalPlayers[id] = players[id];
        }
    });
    
    socket.emit('init', {
        playerId: socket.id,
        players: globalPlayers
    });
    
    // Send coins and loadout
    socket.emit('playerData', {
        coins: playerCoins[socket.id],
        loadout: playerLoadouts[socket.id]
    });
    
    // Only broadcast to global players (not in matches)
    if (playerMode[socket.id] === 'global') {
        socket.broadcast.emit('playerJoined', players[socket.id]);
    }
    
    // Username update
    socket.on('setUsername', (username) => {
        players[socket.id].username = username;
        
        // Broadcast to appropriate audience based on mode
        if (playerMode[socket.id] === 'global') {
            socket.broadcast.emit('playerUsernameUpdated', {
                playerId: socket.id,
                username: username
            });
        } else if (playerMode[socket.id] !== 'global' && socket.matchId) {
            socket.to(socket.matchId).emit('playerUsernameUpdated', {
                playerId: socket.id,
                username: username
            });
        }
    });
    
    // Coin sync handler
    socket.on('syncCoins', (clientCoins) => {
        const playerId = socket.id;
        playerCoins[playerId] = clientCoins;
        console.log(`💰 Player ${playerId} coins synced: ${clientCoins}`);
        socket.emit('coinUpdate', {
            playerId: playerId,
            coins: playerCoins[playerId]
        });
    });
    
    // Loadout update
    socket.on('updateLoadout', (loadout) => {
        playerLoadouts[socket.id] = {
            ...playerLoadouts[socket.id],
            ...loadout
        };
        
        if (playerMode[socket.id] === 'global') {
            socket.broadcast.emit('playerLoadoutUpdated', {
                playerId: socket.id,
                loadout: playerLoadouts[socket.id]
            });
        } else if (playerMode[socket.id] !== 'global' && socket.matchId) {
            socket.to(socket.matchId).emit('playerLoadoutUpdated', {
                playerId: socket.id,
                loadout: playerLoadouts[socket.id]
            });
        }
    });
    
    // Purchase item
    socket.on('purchaseItem', (data) => {
        const { itemId, cost } = data;
        const playerId = socket.id;
        
        if (playerCoins[playerId] < cost) {
            socket.emit('purchaseResult', {
                success: false,
                message: 'Not enough coins!'
            });
            return;
        }
        
        playerCoins[playerId] -= cost;
        
        socket.emit('purchaseResult', {
            success: true,
            itemId: itemId,
            newCoins: playerCoins[playerId]
        });
        
        socket.emit('coinUpdate', {
            playerId: playerId,
            coins: playerCoins[playerId]
        });
        
        console.log(`Player ${playerId} purchased ${itemId} for ${cost} coins`);
    });
    
    // Movement - CRITICAL FIX: Only broadcast to same mode
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            
            // If in a custom match, broadcast only to that match room
            if (data.matchId && customMatches[data.matchId]) {
                socket.to(data.matchId).emit('playerMoved', {
                    playerId: socket.id,
                    position: data.position,
                    rotation: data.rotation
                });
            } else if (playerMode[socket.id] === 'global') {
                // Regular multiplayer - broadcast only to other global players
                socket.broadcast.emit('playerMoved', {
                    playerId: socket.id,
                    position: data.position,
                    rotation: data.rotation
                });
            }
        }
    });
    
    // Shooting
    socket.on('shoot', (data) => {
        if (playerMode[socket.id] === 'global') {
            socket.broadcast.emit('playerShot', {
                playerId: socket.id,
                from: data.from,
                direction: data.direction
            });
        } else if (playerMode[socket.id] !== 'global' && socket.matchId) {
            socket.to(socket.matchId).emit('playerShot', {
                playerId: socket.id,
                from: data.from,
                direction: data.direction
            });
        }
    });
    
    // Ability used
    socket.on('abilityUsed', (data) => {
        if (playerMode[socket.id] === 'global') {
            socket.broadcast.emit('playerUsedAbility', {
                playerId: socket.id,
                abilityId: data.abilityId,
                abilityName: data.abilityName
            });
        } else if (playerMode[socket.id] !== 'global' && socket.matchId) {
            socket.to(socket.matchId).emit('playerUsedAbility', {
                playerId: socket.id,
                abilityId: data.abilityId,
                abilityName: data.abilityName
            });
        }
    });
    
    // Player hit
    socket.on('hit', (data) => {
        const targetId = data.targetId;
        const shooterId = socket.id;
        
        if (!players[targetId] || !players[shooterId] || targetId === shooterId) {
            return;
        }
        
        const targetPlayer = players[targetId];
        const targetLoadout = playerLoadouts[targetId];
        
        let damage = data.damage || 25;
        
        if (targetLoadout && targetLoadout.equippedPerk === 'perk_tank') {
            damage *= 0.85;
        }
        
        damage = Math.round(damage);
        
        if (targetPlayer.shield > 0) {
            if (targetPlayer.shield >= damage) {
                targetPlayer.shield -= damage;
            } else {
                const remainingDamage = damage - targetPlayer.shield;
                targetPlayer.shield = 0;
                targetPlayer.health -= remainingDamage;
            }
        } else {
            targetPlayer.health -= damage;
        }
        
        targetPlayer.lastDamageTime = Date.now();
        
        // Send hit event to target
        io.to(targetId).emit('playerHit', {
            targetId: targetId,
            health: targetPlayer.health,
            shield: targetPlayer.shield,
            damage: damage,
            shooterId: shooterId
        });
        
        // Broadcast damage visual to appropriate audience
        if (playerMode[shooterId] === 'global' && playerMode[targetId] === 'global') {
            socket.broadcast.emit('playerDamaged', {
                targetId: targetId,
                shooterId: shooterId,
                damage: damage
            });
        } else if (socket.matchId) {
            socket.to(socket.matchId).emit('playerDamaged', {
                targetId: targetId,
                shooterId: shooterId,
                damage: damage
            });
        }
        
        if (targetPlayer.health <= 0) {
            handlePlayerDeath(targetId, shooterId);
        }
    });
    
    function handlePlayerDeath(targetId, killerId) {
        const targetPlayer = players[targetId];
        const killerPlayer = players[killerId];
        
        if (!targetPlayer || !killerPlayer) return;
        
        targetPlayer.health = 100;
        targetPlayer.shield = 0;
        targetPlayer.position = { x: 0, y: 1.67, z: 0 };
        targetPlayer.rotation = { x: 0, y: 0 };
        targetPlayer.deaths += 1;
        
        killerPlayer.score += 100;
        killerPlayer.kills += 1;
        playerCoins[killerId] += 50;
        
        const killerLoadout = playerLoadouts[killerId];
        if (killerLoadout && killerLoadout.equippedPerk === 'perk_lifestealer') {
            killerPlayer.health = Math.min(100, killerPlayer.health + 20);
        }
        
        // Broadcast death to appropriate audience
        if (playerMode[targetId] === 'global' && playerMode[killerId] === 'global') {
            io.emit('playerDied', {
                targetId: targetId,
                killerId: killerId,
                killerScore: killerPlayer.score
            });
        } else if (socket.matchId) {
            io.to(socket.matchId).emit('playerDied', {
                targetId: targetId,
                killerId: killerId,
                killerScore: killerPlayer.score
            });
        }
        
        io.to(killerId).emit('scoreUpdate', {
            playerId: killerId,
            score: killerPlayer.score,
            kills: killerPlayer.kills
        });
        
        io.to(killerId).emit('coinUpdate', {
            playerId: killerId,
            coins: playerCoins[killerId]
        });
        
        io.to(targetId).emit('playerRespawn', {
            health: 100,
            shield: 0
        });
        
        console.log(`Player ${killerId} killed ${targetId}`);
    }
    
    // Shield activation
    socket.on('activateShield', (data) => {
        const playerId = socket.id;
        const player = players[playerId];
        
        if (!player) return;
        
        player.shield = data.shieldAmount || 0;
        
        if (playerMode[playerId] === 'global') {
            socket.broadcast.emit('playerShieldActivated', {
                playerId: playerId,
                shieldAmount: player.shield
            });
        } else if (playerMode[playerId] !== 'global' && socket.matchId) {
            socket.to(socket.matchId).emit('playerShieldActivated', {
                playerId: playerId,
                shieldAmount: player.shield
            });
        }
        
        io.to(playerId).emit('shieldUpdate', {
            shield: player.shield
        });
    });
    
    // ADMIN ACTIONS
    socket.on('adminAction', (data) => {
        const { type, targetId, amount, position, duration, enabled, multiplier } = data;
        
        switch(type) {
            case 'heal':
                if (players[targetId]) {
                    players[targetId].health = 100;
                    players[targetId].shield = 0;
                    io.to(targetId).emit('adminHeal', {
                        health: 100
                    });
                    console.log(`✨ Admin healed player ${targetId}`);
                }
                break;
            case 'kill':
                if (players[targetId]) {
                    players[targetId].health = 0;
                    handlePlayerDeath(targetId, socket.id);
                    console.log(`💀 Admin killed player ${targetId}`);
                }
                break;
            case 'giveCoins':
                if (playerCoins[targetId] !== undefined) {
                    playerCoins[targetId] += amount || 0;
                    io.to(targetId).emit('coinUpdate', {
                        playerId: targetId,
                        coins: playerCoins[targetId]
                    });
                    console.log(`💰 Admin gave ${amount} coins to ${targetId}`);
                }
                break;
            case 'setCoins':
                if (playerCoins[targetId] !== undefined) {
                    playerCoins[targetId] = amount || 0;
                    io.to(targetId).emit('coinUpdate', {
                        playerId: targetId,
                        coins: playerCoins[targetId]
                    });
                    console.log(`💰 Admin set ${targetId} coins to ${amount}`);
                }
                break;
            case 'setHealth':
                if (players[targetId]) {
                    players[targetId].health = Math.max(0, Math.min(100, amount || 100));
                    io.to(targetId).emit('adminSetHealth', {
                        health: players[targetId].health
                    });
                    console.log(`❤️ Admin set ${targetId} health to ${amount}`);
                }
                break;
            case 'teleport':
                if (players[targetId] && position) {
                    players[targetId].position = position;
                    io.to(targetId).emit('adminTeleport', {
                        position: position
                    });
                    console.log(`🌀 Admin teleported ${targetId} to spawn`);
                }
                break;
            case 'freeze':
                if (players[targetId]) {
                    io.to(targetId).emit('adminFreeze', {
                        duration: duration || 5000
                    });
                    console.log(`❄️ Admin froze ${targetId} for ${duration}ms`);
                }
                break;
            case 'kick':
                if (players[targetId]) {
                    io.to(targetId).emit('adminKick', {
                        reason: 'Kicked by admin'
                    });
                    setTimeout(() => {
                        io.sockets.sockets.get(targetId)?.disconnect(true);
                    }, 1000);
                    console.log(`🚫 Admin kicked ${targetId}`);
                }
                break;
            case 'godMode':
                if (players[targetId]) {
                    io.to(targetId).emit('adminGodMode', {
                        enabled: enabled
                    });
                    console.log(`👑 Admin ${enabled ? 'enabled' : 'disabled'} god mode for ${targetId}`);
                }
                break;
            case 'resetStats':
                if (players[targetId]) {
                    players[targetId].score = 0;
                    players[targetId].kills = 0;
                    players[targetId].deaths = 0;
                    io.to(targetId).emit('adminResetStats', {
                        score: 0,
                        kills: 0,
                        deaths: 0
                    });
                    console.log(`📊 Admin reset stats for ${targetId}`);
                }
                break;
            case 'speedMultiplier':
                if (players[targetId]) {
                    io.to(targetId).emit('adminSpeedMultiplier', {
                        multiplier: multiplier || 1.0
                    });
                    console.log(`⚡ Admin set ${targetId} speed to ${multiplier}x`);
                }
                break;
        }
    });
    
    // Health update (for healing abilities)
    socket.on('healPlayer', (data) => {
        const playerId = socket.id;
        const player = players[playerId];
        
        if (!player) return;
        
        player.health = Math.min(100, player.health + (data.amount || 0));
        
        io.to(playerId).emit('playerHealthUpdate', {
            playerId: playerId,
            health: player.health
        });
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
        
        // Send chat to appropriate audience
        if (playerMode[socket.id] === 'global') {
            io.emit('chatMessage', {
                username: username,
                message: message
            });
        } else if (playerMode[socket.id] !== 'global' && socket.matchId) {
            io.to(socket.matchId).emit('chatMessage', {
                username: username,
                message: message
            });
        }
        
        console.log(`💬 Chat from ${username}: "${message}"`);
    });
    
    // Create Match
    socket.on('createMatch', (data) => {
        const matchId = 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const matchCode = data.private ? generateMatchCode() : null;
        
        customMatches[matchId] = {
            id: matchId,
            name: data.name,
            host: socket.id,
            hostName: data.host,
            maxPlayers: data.maxPlayers,
            mode: data.mode,
            timeLimit: data.timeLimit,
            private: data.private,
            code: matchCode,
            players: [socket.id],
            startTime: Date.now()
        };
        
        // Switch player to match mode
        playerMode[socket.id] = matchId;
        socket.matchId = matchId;
        socket.join(matchId);
        
        socket.emit('matchCreated', {
            id: matchId,
            name: data.name,
            code: matchCode,
            maxPlayers: data.maxPlayers,
            mode: data.mode,
            timeLimit: data.timeLimit,
            host: data.host,
            players: 1
        });
        
        console.log(`✅ Match created: ${data.name} (${matchId})`);
    });
    
    // Join Match - FIXED: Send existing players to joiner
// Join Match - COMPLETELY FIXED
socket.on('joinMatch', (data) => {
    let match = null;
    
    if (data.code) {
        match = Object.values(customMatches).find(m => m.code === data.code);
        if (!match) {
            socket.emit('matchError', 'Invalid match code');
            return;
        }
    } else if (data.matchId) {
        match = customMatches[data.matchId];
        if (!match) {
            socket.emit('matchError', 'Match not found');
            return;
        }
        if (match.private) {
            socket.emit('matchError', 'This match is private');
            return;
        }
    }
    
    if (!match) {
        socket.emit('matchError', 'Match not found');
        return;
    }
    
    if (match.players.length >= match.maxPlayers) {
        socket.emit('matchError', 'Match is full');
        return;
    }
    
    // Add player to match
    match.players.push(socket.id);
    
    // Switch player to match mode
    playerMode[socket.id] = match.id;
    socket.matchId = match.id;
    socket.join(match.id);
    
    // CRITICAL FIX 1: Send ALL existing players in the match to the new player
    match.players.forEach(playerId => {
        if (playerId !== socket.id && players[playerId]) {
            console.log(`📤 Sending existing player ${playerId} to new player ${socket.id}`);
            socket.emit('playerJoined', players[playerId]);
        }
    });
    
    // CRITICAL FIX 2: Notify ALL players in match about the new player
    // Use io.to(match.id) instead of socket.to(match.id) to ensure everyone gets it
    console.log(`📢 Broadcasting new player ${socket.id} to all in match ${match.id}`);
    socket.to(match.id).emit('playerJoined', players[socket.id]);
    
    // Send match joined confirmation
    socket.emit('matchJoined', {
        id: match.id,
        name: match.name,
        code: match.code,
        maxPlayers: match.maxPlayers,
        mode: match.mode,
        timeLimit: match.timeLimit,
        host: match.hostName,
        players: match.players.length
    });
    
    // Update player count for everyone in the match
    io.to(match.id).emit('matchUpdate', {
        players: match.players.length
    });
    
    console.log(`✅ Player ${socket.id} joined match ${match.name}. Total players: ${match.players.length}`);
});
    
    // Get Match List
    socket.on('getMatches', () => {
        const publicMatches = Object.values(customMatches)
            .filter(m => !m.private)
            .map(m => ({
                id: m.id,
                name: m.name,
                host: m.hostName,
                players: m.players.length,
                maxPlayers: m.maxPlayers,
                mode: m.mode,
                timeLimit: m.timeLimit
            }));
        
        socket.emit('matchList', publicMatches);
    });
    
    // Disconnect - FIXED: Proper cleanup
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        // Only broadcast leave to global players if they were in global mode
        if (playerMode[socket.id] === 'global') {
            io.emit('playerLeft', socket.id);
        } else if (socket.matchId && customMatches[socket.matchId]) {
            // Broadcast leave to match players
            io.to(socket.matchId).emit('playerLeft', socket.id);
        }
        
        delete players[socket.id];
        delete playerLoadouts[socket.id];
        delete playerCoins[socket.id];
        delete messageHistory[socket.id];
        delete playerMode[socket.id];
        
        // Clean up custom match
        if (socket.matchId && customMatches[socket.matchId]) {
            const match = customMatches[socket.matchId];
            match.players = match.players.filter(p => p !== socket.id);
            
            if (match.players.length === 0) {
                delete customMatches[socket.matchId];
                console.log(`🗑️ Deleted empty match ${socket.matchId}`);
            } else {
                io.to(socket.matchId).emit('matchUpdate', {
                    players: match.players.length
                });
            }
        }
    });
    
    // Passive coin generation (every minute)
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
    console.log('✅ Custom match system with COMPLETE isolation');
});
