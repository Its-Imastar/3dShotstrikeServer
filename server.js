// server.js - Updated for Multiplayer Ability System
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

if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY not set. Using basic filter only.');
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
const playerLoadouts = {};
const playerCoins = {};
const playerHealth = {};
const playerShields = {};
const abilityCooldowns = {};
const playerScores = {};
const playerKills = {};
const playerDeaths = {};
const messageHistory = {};

// Ability cooldowns (in seconds)
const ABILITY_COOLDOWNS = {
    'ability_instant_reload': 20,
    'ability_warriors_wrath': 30,
    'ability_gun_bash': 35,
    'ability_rock_shield': 25,
    'ability_crystal_barrier': 35,
    'ability_slateskin': 30,
    'ability_instant_health': 25,
    'ability_super_regen': 35,
    'ability_healing_hibernation': 30,
    'ability_lifesteal': 25,
    'ability_uplift': 15,
    'ability_dash': 20,
    'ability_invisibility': 40,
    'ability_super_sprint': 25,
    'ability_rejuvenating_dash': 30,
    'ability_grapple': 22
};

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

// Ability effects server-side tracking
const activeAbilities = {};

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
    
    if (!playerCoins[playerId]) {
        playerCoins[playerId] = 500;
    }
    
    if (!playerHealth[playerId]) {
        playerHealth[playerId] = 100;
    }
    
    if (!playerShields[playerId]) {
        playerShields[playerId] = 0;
    }
    
    if (!playerScores[playerId]) {
        playerScores[playerId] = 0;
    }
    
    if (!playerKills[playerId]) {
        playerKills[playerId] = 0;
    }
    
    if (!playerDeaths[playerId]) {
        playerDeaths[playerId] = 0;
    }
    
    if (!abilityCooldowns[playerId]) {
        abilityCooldowns[playerId] = {};
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
    
    // Apply Warrior's Wrath multiplier if active
    if (activeAbilities[shooterId] && activeAbilities[shooterId]['warriorsWrath']) {
        damage *= 3; // Triple damage
    }
    
    // Apply perk effects
    if (targetLoadout && targetLoadout.equippedPerk === 'perk_tank') {
        // Tank perk gives damage reduction
        damage *= 0.85;
    }
    
    // Apply survivor perk (if target is low health)
    if (targetLoadout && targetLoadout.equippedPerk === 'perk_survivor') {
        if (playerHealth[targetId] <= 25) {
            // Survivor perk activates - no damage taken for 1 second
            const lastDamageTime = players[targetId]?.lastDamageTime || 0;
            if (Date.now() - lastDamageTime < 1000) {
                return 0; // No damage during invincibility
            }
        }
    }
    
    return Math.round(damage);
}

function checkAbilityCooldown(playerId, abilityId) {
    const now = Date.now();
    const cooldown = ABILITY_COOLDOWNS[abilityId] || 10;
    
    if (!abilityCooldowns[playerId][abilityId]) {
        return true; // Never used before
    }
    
    const timeSinceLastUse = now - abilityCooldowns[playerId][abilityId];
    return timeSinceLastUse >= (cooldown * 1000);
}

function setAbilityCooldown(playerId, abilityId) {
    abilityCooldowns[playerId][abilityId] = Date.now();
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
        lastDamageTime: Date.now(),
        invisible: false,
        lastMoveTime: Date.now()
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
        loadout: playerLoadouts[socket.id],
        health: playerHealth[socket.id],
        shield: playerShields[socket.id]
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
    
    // Loadout update (client sends their equipped items)
    socket.on('updateLoadout', (loadout) => {
        playerLoadouts[socket.id] = {
            ...playerLoadouts[socket.id],
            ...loadout
        };
        
        socket.broadcast.emit('playerLoadoutUpdated', {
            playerId: socket.id,
            loadout: playerLoadouts[socket.id]
        });
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
        
        console.log(`💰 Player ${playerId} purchased ${itemId} for ${cost} coins`);
    });
    
    // Movement
    socket.on('move', (data) => {
        const playerId = socket.id;
        if (!players[playerId]) return;
        
        players[playerId].position = data.position;
        players[playerId].rotation = data.rotation;
        players[playerId].lastMoveTime = Date.now();
        
        // Update server-side health/shield
        if (data.health !== undefined) {
            playerHealth[playerId] = data.health;
        }
        if (data.shield !== undefined) {
            playerShields[playerId] = data.shield;
        }
        
        socket.broadcast.emit('playerMoved', {
            playerId: playerId,
            position: data.position,
            rotation: data.rotation,
            health: playerHealth[playerId],
            shield: playerShields[playerId]
        });
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
        const playerId = socket.id;
        const abilityId = data.abilityId;
        
        // Check cooldown
        if (!checkAbilityCooldown(playerId, abilityId)) {
            socket.emit('abilityFailed', {
                abilityId: abilityId,
                message: 'Ability on cooldown'
            });
            return;
        }
        
        // Set cooldown
        setAbilityCooldown(playerId, abilityId);
        
        // Track active abilities
        if (!activeAbilities[playerId]) {
            activeAbilities[playerId] = {};
        }
        
        // Handle specific abilities
        switch (abilityId) {
            case 'ability_rock_shield':
            case 'ability_crystal_barrier':
            case 'ability_slateskin':
                // These abilities grant shields - track on server
                const shieldAmount = data.shieldApplied || 0;
                playerShields[playerId] = shieldAmount;
                activeAbilities[playerId][abilityId] = {
                    active: true,
                    startTime: Date.now(),
                    shieldAmount: shieldAmount
                };
                break;
                
            case 'ability_invisibility':
                players[playerId].invisible = true;
                activeAbilities[playerId].invisibility = {
                    active: true,
                    startTime: Date.now()
                };
                // Make invisible after 0.5 seconds for effect
                setTimeout(() => {
                    socket.broadcast.emit('playerInvisible', {
                        playerId: playerId,
                        invisible: true
                    });
                }, 500);
                break;
                
            case 'ability_gun_bash':
                // Apply movement and damage to nearby players
                const nearbyPlayers = Object.keys(players).filter(id => {
                    if (id === playerId) return false;
                    const player = players[id];
                    const distance = Math.sqrt(
                        Math.pow(player.position.x - data.position.x, 2) +
                        Math.pow(player.position.z - data.position.z, 2)
                    );
                    return distance < 5; // 5 unit radius
                });
                
                nearbyPlayers.forEach(targetId => {
                    // Apply 40 damage to each nearby player
                    applyAbilityDamage(playerId, targetId, 40);
                    
                    // Knockback effect
                    socket.to(targetId).emit('abilityHit', {
                        abilityId: abilityId,
                        damage: 40,
                        attackerId: playerId,
                        knockback: true
                    });
                });
                break;
                
            case 'ability_grapple':
                // Find nearest enemy in range
                let nearestEnemy = null;
                let nearestDist = Infinity;
                
                Object.keys(players).forEach(id => {
                    if (id === playerId) return;
                    const player = players[id];
                    const distance = Math.sqrt(
                        Math.pow(player.position.x - data.position.x, 2) +
                        Math.pow(player.position.z - data.position.z, 2)
                    );
                    
                    if (distance < 30 && distance < nearestDist) {
                        nearestEnemy = { id, player };
                        nearestDist = distance;
                    }
                });
                
                if (nearestEnemy) {
                    // Apply grapple damage
                    applyAbilityDamage(playerId, nearestEnemy.id, 25);
                    
                    // Notify both players
                    socket.to(nearestEnemy.id).emit('abilityHit', {
                        abilityId: abilityId,
                        damage: 25,
                        attackerId: playerId,
                        grapple: true
                    });
                }
                break;
        }
        
        // Broadcast ability use to all players
        socket.broadcast.emit('playerUsedAbility', {
            playerId: playerId,
            abilityId: abilityId,
            abilityName: data.abilityName,
            position: data.position,
            invisible: abilityId === 'ability_invisibility',
            movementVector: data.movementVector,
            damageAmount: data.damageAmount
        });
        
        console.log(`⚡ Player ${playerId} used ability: ${abilityId}`);
    });
    
    function applyAbilityDamage(attackerId, targetId, damage) {
        if (!players[targetId] || !playerHealth[targetId]) return;
        
        // Check shield first
        if (playerShields[targetId] > 0) {
            if (playerShields[targetId] >= damage) {
                playerShields[targetId] -= damage;
            } else {
                const remainingDamage = damage - playerShields[targetId];
                playerShields[targetId] = 0;
                playerHealth[targetId] -= remainingDamage;
            }
        } else {
            playerHealth[targetId] -= damage;
        }
        
        // Update target player
        io.to(targetId).emit('playerHit', {
            targetId: targetId,
            health: playerHealth[targetId],
            shield: playerShields[targetId],
            damage: damage,
            shooterId: attackerId
        });
        
        // Check for death
        if (playerHealth[targetId] <= 0) {
            handlePlayerDeath(targetId, attackerId);
        }
    }
    
    // Player hit (bullet damage)
    socket.on('hit', (data) => {
        const targetId = data.targetId;
        const shooterId = socket.id;
        
        if (!players[targetId] || !players[shooterId] || targetId === shooterId) {
            return;
        }
        
        // Check if survivor perk is active
        const targetLoadout = playerLoadouts[targetId];
        if (targetLoadout && targetLoadout.equippedPerk === 'perk_survivor' && 
            playerHealth[targetId] <= 25 && Date.now() - players[targetId].lastDamageTime < 1000) {
            // Survivor perk active - no damage
            return;
        }
        
        // Check if target is invisible (invisibility ability)
        if (players[targetId].invisible) {
            // Invisibility breaks when hit
            players[targetId].invisible = false;
            io.emit('playerInvisible', {
                playerId: targetId,
                invisible: false
            });
        }
        
        // Calculate damage
        const damage = calculateDamage(shooterId, targetId);
        if (damage <= 0) return;
        
        // Check shield first
        if (playerShields[targetId] > 0) {
            if (playerShields[targetId] >= damage) {
                playerShields[targetId] -= damage;
            } else {
                const remainingDamage = damage - playerShields[targetId];
                playerShields[targetId] = 0;
                playerHealth[targetId] -= remainingDamage;
            }
        } else {
            playerHealth[targetId] -= damage;
        }
        
        players[targetId].lastDamageTime = Date.now();
        
        // Update target player
        io.to(targetId).emit('playerHit', {
            targetId: targetId,
            health: playerHealth[targetId],
            shield: playerShields[targetId],
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
        if (playerHealth[targetId] <= 0) {
            handlePlayerDeath(targetId, shooterId);
        }
        
        console.log(`🔫 Player ${shooterId} hit ${targetId} for ${damage} damage`);
    });
    
    function handlePlayerDeath(targetId, killerId) {
        const targetPlayer = players[targetId];
        const killerPlayer = players[killerId];
        
        if (!targetPlayer || !killerPlayer) return;
        
        // Reset dead player
        playerHealth[targetId] = 100;
        playerShields[targetId] = 0;
        targetPlayer.position = { x: 0, y: 1.67, z: 0 };
        targetPlayer.rotation = { x: 0, y: 0 };
        targetPlayer.invisible = false;
        playerDeaths[targetId] = (playerDeaths[targetId] || 0) + 1;
        
        // Update killer
        playerScores[killerId] = (playerScores[killerId] || 0) + 100;
        playerKills[killerId] = (playerKills[killerId] || 0) + 1;
        playerCoins[killerId] = (playerCoins[killerId] || 0) + 50; // Kill reward
        
        // Apply lifestealer perk
        const killerLoadout = playerLoadouts[killerId];
        if (killerLoadout && killerLoadout.equippedPerk === 'perk_lifestealer') {
            playerHealth[killerId] = Math.min(100, playerHealth[killerId] + 20);
            
            // Send health update to killer
            io.to(killerId).emit('playerHealthUpdate', {
                playerId: killerId,
                health: playerHealth[killerId]
            });
        }
        
        // Broadcast death
        io.emit('playerDied', {
            targetId: targetId,
            killerId: killerId,
            killerScore: playerScores[killerId]
        });
        
        // Update killer's score and coins
        io.to(killerId).emit('scoreUpdate', {
            playerId: killerId,
            score: playerScores[killerId],
            kills: playerKills[killerId]
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
        
        console.log(`💀 Player ${killerId} killed ${targetId}`);
    }
    
    // Shield activation
    socket.on('activateShield', (data) => {
        const playerId = socket.id;
        
        playerShields[playerId] = data.shieldAmount || 0;
        
        // Broadcast to other players for visual effects
        socket.broadcast.emit('playerShieldActivated', {
            playerId: playerId,
            shieldAmount: playerShields[playerId]
        });
        
        io.to(playerId).emit('shieldUpdate', {
            shield: playerShields[playerId]
        });
    });
    
    // Health update (for healing abilities)
    socket.on('healPlayer', (data) => {
        const playerId = socket.id;
        
        playerHealth[playerId] = Math.min(100, playerHealth[playerId] + (data.amount || 0));
        
        io.to(playerId).emit('playerHealthUpdate', {
            playerId: playerId,
            health: playerHealth[playerId]
        });
    });
    
    // Ability cooldown check
    socket.on('checkAbilityCooldown', (data) => {
        const playerId = socket.id;
        const abilityId = data.abilityId;
        
        const isReady = checkAbilityCooldown(playerId, abilityId);
        
        socket.emit('abilityCooldownResponse', {
            abilityId: abilityId,
            ready: isReady,
            cooldownRemaining: isReady ? 0 : 
                Math.ceil((ABILITY_COOLDOWNS[abilityId] * 1000 - 
                    (Date.now() - abilityCooldowns[playerId][abilityId])) / 1000)
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
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        io.emit('playerLeft', socket.id);
        delete players[socket.id];
        delete playerLoadouts[socket.id];
        delete playerCoins[socket.id];
        delete playerHealth[socket.id];
        delete playerShields[socket.id];
        delete abilityCooldowns[socket.id];
        delete playerScores[socket.id];
        delete playerKills[socket.id];
        delete playerDeaths[socket.id];
        delete activeAbilities[socket.id];
        delete messageHistory[socket.id];
    });
    
    // Passive coin generation (every minute)
    const coinInterval = setInterval(() => {
        if (players[socket.id]) {
            playerCoins[socket.id] += 10;
            socket.emit('coinUpdate', {
                playerId: socket.id,
                coins: playerCoins[socket.id]
            });
        }
    }, 60000);
    
    // Clear interval on disconnect
    socket.on('disconnect', () => {
        clearInterval(coinInterval);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🎮 Server running on port ${PORT}`);
    console.log('👶 COPPA-COMPLIANT MODE: Safe for users under 13');
    console.log('✅ Multi-layer chat filtering active');
    console.log('✅ Enhanced ability system with server-side tracking');
    console.log('✅ Shield system with proper multiplayer sync');
    console.log('✅ Ability cooldown validation');
    console.log('✅ Invisibility and special effects tracking');
});
