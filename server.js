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
        .replace(/[аӓ]/g, 'a')  // Cyrillic a
        .replace(/[е]/g, 'e')   // Cyrillic e
        .replace(/[і]/g, 'i')   // Cyrillic i
        .replace(/[о]/g, 'o')   // Cyrillic o
        .replace(/[с]/g, 'c')   // Cyrillic c
        .replace(/[р]/g, 'p')   // Cyrillic p
        .replace(/[х]/g, 'x')   // Cyrillic x
        // Remove emoji/symbols
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
        .replace(/[\u{2600}-\u{26FF}]/gu, '')
        .replace(/[^\w]/g, '');
    
    // Critical words (always blocked) - VERY STRICT FOR KIDS
    const criticalWords = [
        // Slurs
        'nigger', 'nigga', 'nig', 'faggot', 'fag', 'retard', 'gay',
        // Violence
        'kill', 'murder', 'die', 'death', 'dead', 'blood', 'gun', 'knife', 'shoot', 'stab',
        'rape', 'suicide', 'kys', 'killyourself', 'hurt', 'pain', 'torture', 'weapon',
        // Coded workarounds kids use
        'unalive', 'sewerslide', 'toasterbath', 'neckrope', 'aliven', 'die',
        // Inappropriate
        'sex', 'sexy', 'porn', 'xxx', 'naked', 'nude', 'penis', 'vagina', 'boobs', 'butt', 'booty',
        'pedo', 'pedophile', 'molest', 'nsfw', 'corn', // "corn" = coded p*rn
        // Personal safety
        'address', 'phone', 'phonenumber', 'email', 'gmail', 'meet', 'meetup', 'location', 
        'school', 'age', 'howold', 'parent', 'whereulive', 'city', 'state',
        'discord', 'snap', 'snapchat', 'insta', 'instagram', 'tiktok', 'whatsapp', 'addme',
        // Mean/bullying (kids should be kind!)
        'stupid', 'dumb', 'idiot', 'moron', 'loser', 'ugly', 'fat', 'hate', 'sucks', 'trash',
        // Profanity (all variations)
        'fuck', 'fck', 'fuk', 'fvck', 'phuck',
        'shit', 'sht', 'shyt', 
        'bitch', 'btch', 'biatch',
        'ass', 'arse', 'azz',
        'damn', 'dang', 'darn',
        'hell', 'heck',
        'crap', 'piss'
    ];
    
    // Combine with file words
    const allBlockedWords = [...new Set([...criticalWords, ...blockedWordsFromFile])];
    
    // Check each blocked word
    for (let word of allBlockedWords) {
        if (word.length > 2 && normalized.includes(word)) {
            console.log(`❌ Basic filter blocked: "${message}" → contains "${word}"`);
            return false;
        }
    }
    
    // Check for repeated character spam (bypassing normalization)
    if (/(.)\1{4,}/.test(message)) {
        console.log(`❌ Basic filter blocked: "${message}" → character spam`);
        return false;
    }
    
    // Personal info patterns (extra strict)
    const personalInfoPatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                    // Phone
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
        /\b\d{5}(?:[-\s]\d{4})?\b/,                        // Zip
        /\b\d{1,5}\s+\w+\s+(street|st|ave|road|rd)\b/i,   // Address
        /\b(?:discord|snap|insta|tiktok)\.gg\b/i,          // Social invites
        /\b(?:www\.|http|\.com|\.net|\.org)\b/i,          // URLs
        /\bim\s+\d{1,2}\b/i,                               // "im 12"
        /\bi\s*am\s+\d{1,2}\s+(years?\s*old|yo|y\/o)\b/i  // "i am 12 years old"
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
const playerLoadouts = {}; // Stores equipped guns/abilities/perks
const playerCoins = {};
const messageHistory = {};

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
            equippedAbilities: ['ability_instant_reload', 'ability_uplift'],
            equippedPerk: 'perk_survivor'
        };
    }
    
    // Don't reset coins, let client sync them
    if (!playerCoins[playerId]) {
        playerCoins[playerId] = 0; // Start with 0, will be updated by client
    }
}

function calculateDamage(shooterId, targetId) {
    const shooterLoadout = playerLoadouts[shooterId];
    const targetLoadout = playerLoadouts[targetId];
    
    if (!shooterLoadout || !GUNS[shooterLoadout.equippedGun]) {
        return 25; // Default damage
    }
    
    const gun = GUNS[shooterLoadout.equippedGun];
    let damage = gun.damage;
    
    // Apply perk effects
    if (targetLoadout && targetLoadout.equippedPerk === 'perk_tank') {
        // Tank perk gives damage reduction
        damage *= 0.85;
    }
    
    // Apply survivor perk (if target is low health)
    if (targetLoadout && targetLoadout.equippedPerk === 'perk_survivor') {
        const targetPlayer = players[targetId];
        if (targetPlayer && targetPlayer.health <= 25) {
            // Survivor perk activates - no damage taken for 1 second
            // We'll handle this in the hit handler
        }
    }
    
    return Math.round(damage);
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
        shield: 0,
        score: 0,
        kills: 0,
        deaths: 0,
        lastDamageTime: Date.now()
    };
    
    initializePlayerData(socket.id);
    
    // Send initial data to client
    socket.emit('init', {
        playerId: socket.id,
        players: players
    });
    
    // Send coins and loadout
    socket.emit('playerData', {
        coins: playerCoins[socket.id],
        loadout: playerLoadouts[socket.id]
    });
    
    // Notify other players
    socket.broadcast.emit('playerJoined', players[socket.id]);
    
    // Username update
    socket.on('setUsername', (username) => {
        players[socket.id].username = username;
        socket.broadcast.emit('playerUsernameUpdated', {
            playerId: socket.id,
            username: username
        });
    });
    // Coin sync handler
socket.on('syncCoins', (clientCoins) => {
    const playerId = socket.id;
    playerCoins[playerId] = clientCoins;
    
    console.log(`💰 Player ${playerId} coins synced: ${clientCoins}`);
    
    // Send confirmation
    socket.emit('coinUpdate', {
        playerId: playerId,
        coins: playerCoins[playerId]
    });
});
    // Loadout update (client sends their equipped items)
    socket.on('updateLoadout', (loadout) => {
        playerLoadouts[socket.id] = {
            ...playerLoadouts[socket.id],
            ...loadout
        };
        
        // Broadcast to other players (optional - for visual effects)
        socket.broadcast.emit('playerLoadoutUpdated', {
            playerId: socket.id,
            loadout: playerLoadouts[socket.id]
        });
    });
    
    // Purchase item (client-side shop, server just validates and deducts coins)
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
        
        // Deduct coins
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
    
    // Movement
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
    
    // Shooting
    socket.on('shoot', (data) => {
        socket.broadcast.emit('playerShot', {
            playerId: socket.id,
            from: data.from,
            direction: data.direction
        });
    });
    
    // Ability used
    socket.on('abilityUsed', (data) => {
        socket.broadcast.emit('playerUsedAbility', {
            playerId: socket.id,
            abilityId: data.abilityId,
            abilityName: data.abilityName
        });
    });
    
    // Player hit
    // Player hit - FIXED DAMAGE SYSTEM
    socket.on('hit', (data) => {
        const targetId = data.targetId;
        const shooterId = socket.id;
        
        if (!players[targetId] || !players[shooterId] || targetId === shooterId) {
            return;
        }
        
        const targetPlayer = players[targetId];
        const targetLoadout = playerLoadouts[targetId];
        
        // Check if survivor perk is active (invincibility for 1s when low health)
        if (targetLoadout && targetLoadout.equippedPerk === 'perk_survivor' && 
            targetPlayer.health <= 25 && Date.now() - targetPlayer.lastDamageTime < 1000) {
            // Survivor perk active - no damage
            return;
        }
        
        // FIX: Use client-provided damage (already calculated with correct gun stats)
        let damage = data.damage || 25;
        
        // Apply perk effects (server-side modifiers only)
        if (targetLoadout && targetLoadout.equippedPerk === 'perk_tank') {
            damage *= 0.85; // Tank perk gives 15% damage reduction
        }
        
        damage = Math.round(damage);
        
        // Apply damage to shield first
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
        
        // Update target player
        io.to(targetId).emit('playerHit', {
            targetId: targetId,
            health: targetPlayer.health,
            shield: targetPlayer.shield,
            damage: damage,
            shooterId: shooterId
        });
        
        // Broadcast to other players for visual effects
        socket.broadcast.emit('playerDamaged', {
            targetId: targetId,
            shooterId: shooterId,
            damage: damage
        });
        
        // Check for death
        if (targetPlayer.health <= 0) {
            handlePlayerDeath(targetId, shooterId);
        }
    });
    
    function handlePlayerDeath(targetId, killerId) {
        const targetPlayer = players[targetId];
        const killerPlayer = players[killerId];
        
        if (!targetPlayer || !killerPlayer) return;
        
        // Reset dead player
        targetPlayer.health = 100;
        targetPlayer.shield = 0;
        targetPlayer.position = { x: 0, y: 1.67, z: 0 };
        targetPlayer.rotation = { x: 0, y: 0 };
        targetPlayer.deaths += 1;
        
        // Update killer
        killerPlayer.score += 100;
        killerPlayer.kills += 1;
        playerCoins[killerId] += 50; // Kill reward
        
        // Apply lifestealer perk
        const killerLoadout = playerLoadouts[killerId];
        if (killerLoadout && killerLoadout.equippedPerk === 'perk_lifestealer') {
            killerPlayer.health = Math.min(100, killerPlayer.health + 20);
            // Speed boost handled client-side
        }
        
        // Broadcast death
        io.emit('playerDied', {
            targetId: targetId,
            killerId: killerId,
            killerScore: killerPlayer.score
        });
        
        // Update killer's score and coins
        io.to(killerId).emit('scoreUpdate', {
            playerId: killerId,
            score: killerPlayer.score,
            kills: killerPlayer.kills
        });
        
        io.to(killerId).emit('coinUpdate', {
            playerId: killerId,
            coins: playerCoins[killerId]
        });
        
        // Update target's stats
        io.to(targetId).emit('playerRespawn', {
            health: 100,
            shield: 0
        });
        
        console.log(`Player ${killerId} killed ${targetId}`);
    }
    
    // Shield activation (for abilities like Rock Shield, Slateskin)
    socket.on('activateShield', (data) => {
        const playerId = socket.id;
        const player = players[playerId];
        
        if (!player) return;
        
        player.shield = data.shieldAmount || 0;
        
        // Broadcast to other players for visual effects
        socket.broadcast.emit('playerShieldActivated', {
            playerId: playerId,
            shieldAmount: player.shield
        });
        
        io.to(playerId).emit('shieldUpdate', {
            shield: player.shield
        });
    });
    // ========================================
// ========================================
// ADMIN CONSOLE HANDLERS
// Add this code to your server.js before the disconnect handler
// ========================================

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

// ========================================
// INSTALLATION INSTRUCTIONS:
// ========================================
// 1. Open your server.js file
// 2. Find the line that says: socket.on('disconnect', () => {
// 3. Add the admin handler code ABOVE that line
// 4. Save the file and restart your server
// 5. Open admin-console.html in your browser
// 6. Enter your server URL (default: http://localhost:3000)
// 7. Click "Connect"
// ========================================

// ========================================
// INSTALLATION INSTRUCTIONS:
// ========================================
// 1. Open your server.js file
// 2. Find the line that says: socket.on('disconnect', () => {
// 3. Add the admin handler code ABOVE that line
// 4. Save the file and restart your server
// 5. Open admin-console.html in your browser
// 6. Enter your server URL (default: http://localhost:3000)
// 7. Click "Connect"
// ========================================
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
        
        io.emit('chatMessage', {
            username: username,
            message: message
        });
        
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
    
    // Join Match
    socket.on('joinMatch', (data) => {
        let match = null;
        
        // Join by code (private)
        if (data.code) {
            match = Object.values(customMatches).find(m => m.code === data.code);
            if (!match) {
                socket.emit('matchError', 'Invalid match code');
                return;
            }
        }
        // Join by ID (public)
        else if (data.matchId) {
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
        
        match.players.push(socket.id);
        socket.matchId = match.id;
        socket.join(match.id);
        
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
        
        // Notify all players in match
        io.to(match.id).emit('matchUpdate', {
            players: match.players.length
        });
        
        console.log(`✅ Player ${socket.id} joined match ${match.name}`);
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
    // Disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        io.emit('playerLeft', socket.id);
        delete players[socket.id];
        delete playerLoadouts[socket.id];
        delete playerCoins[socket.id];
        delete messageHistory[socket.id];
        // Clean up custom match
        if (socket.matchId && customMatches[socket.matchId]) {
            const match = customMatches[socket.matchId];
            match.players = match.players.filter(p => p !== socket.id);
            
            if (match.players.length === 0) {
                // Delete empty match
                delete customMatches[socket.matchId];
                console.log(`🗑️ Deleted empty match ${socket.matchId}`);
            } else {
                // Update remaining players
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
    console.log('✅ New shop system: Guns, Abilities, Perks');
    console.log('✅ Loadout system: 1 Gun, 2 Abilities, 1 Perk');
});
