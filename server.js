// server.js - Multiplayer Game Server with Health Regeneration & Advanced Features

if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"] 
    } 
});

// ------------------------
// 1️⃣ Configuration & Constants
// ------------------------
const CONFIG = {
    MAX_USERNAME_LENGTH: 20,
    MIN_MESSAGE_LENGTH: 2,
    MAX_MESSAGE_LENGTH: 100,
    MUTE_DURATION: 300000, // 5 minutes
    MAX_WARNINGS: 3,
    COINS_PER_MINUTE: 10,
    COIN_INTERVAL: 60000,
    SPAM_WINDOW_MS: 15000,
    MAX_MESSAGES_PER_WINDOW: 4,
    MAX_DUPLICATE_MESSAGES: 2,
    TOXICITY_THRESHOLD: 0.7,
    HEALTH_REGEN_DELAY: 3000, // 3 seconds before regen starts
    HEALTH_REGEN_AMOUNT: 5,   // HP per regen tick
    HEALTH_REGEN_INTERVAL: 1000, // 1 second between regen ticks
    RESPAWN_TIME: 5000, // 5 seconds to respawn
    RESPAWN_HEALTH: 100,
    BASE_MAX_HEALTH: 100,
    INACTIVE_THRESHOLD: 5000, // 5 seconds of inactivity
    INACTIVE_CHECK_INTERVAL: 1000, // Check every 1 second
    HIT_COOLDOWN: 1000, // 1 second between hits on same player
    COINS_PER_HIT: 5, // Coins awarded for hitting active players
    COINS_PER_KILL: 25 // Coins awarded for killing active players
};

// ------------------------
// 2️⃣ Data Storage
// ------------------------
const players = new Map();           // socket.id -> player data
const messageHistory = new Map();    // socket.id -> message history for spam detection
const playerStats = new Map();       // socket.id -> moderation stats
const regenIntervals = new Map();    // socket.id -> regeneration interval
const respawnTimers = new Map();     // socket.id -> respawn timer
const hitCooldowns = new Map();      // socket.id -> last hit timestamps {targetId: timestamp}

// ------------------------
// 3️⃣ Enhanced Chat Filtering System
// ------------------------

// Load blocked words from file
let blockedWords = [];
try {
    const filePath = path.join(__dirname, 'badwords.txt');
    if (fs.existsSync(filePath)) {
        blockedWords = fs.readFileSync(filePath, 'utf-8')
            .split('\n')
            .map(w => w.trim().toLowerCase())
            .filter(Boolean);
        console.log(`✅ Loaded ${blockedWords.length} blocked words`);
    } else {
        console.log('⚠️ No badwords.txt found, using default list');
        blockedWords = [
            'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'hell',
            'piss', 'dick', 'cock', 'pussy', 'fag', 'retard', 'nigger',
            'whore', 'slut', 'bastard', 'douche', 'wanker', 'twat'
        ];
    }
} catch(err) {
    console.warn("⚠️ Could not load badwords.txt", err.message);
}

const blockedSet = new Set(blockedWords);

// Common bypass patterns to catch
const BYPASS_PATTERNS = [
    /f[\.\s\_\-]*[a4@áàâäãåαΔΛ][\.\s\_\-]*[ckqĸķκϰ][\.\s\_\-]*[ckq7ĸķκϰ+†]/gi,
    /f[\.\s\_\-]*[uμυüúùûū][\.\s\_\-]*[ckqĸķκϰ][\.\s\_\-]*[ckq7ĸķκϰ+†]/gi,
    /s[\.\s\_\-]*[h4#ħĥη][\.\s\_\-]*[i1l!|íìîïīΙł][\.\s\_\-]*[t7+†τ]/gi,
    /[a4@áàâäãåαΔΛ][\.\s\_\-]*[sz5$§ßšşzžζ][\.\s\_\-]*[sz5$§ßšşzžζ]/gi,
    /b[\.\s\_\-]*[i1l!|íìîïīΙł][\.\s\_\-]*[t7+†τ][\.\s\_\-]*[ch4#ċĉčçς]/gi,
    /d[\.\s\_\-]*[a4@áàâäãåαΔΛ][\.\s\_\-]*[mnмηñ][\.\s\_\-]*[mnмηñ]/gi,
    /[ckq][\.\s\_\-]*[o0°óòôöõōΩθ][\.\s\_\-]*[ckqĸķκϰ]/gi,
    /[mn][\.\s\_\-]*[i1l!|íìîïīΙł][\.\s\_\-]*[g6ğģǥ][\.\s\_\-]*[g6ğģǥ][\.\s\_\-]*[e3€£ëèéêēΣ][\.\s\_\-]*[rЯ]/gi,
    /[kg6][\.\s\_\-]*[i1l!|íìîïīΙł][\.\s\_\-]*[l1|ł][\.\s\_\-]*[l1|ł]/gi,
    /[sz5$§ßšşzžζ][\.\s\_\-]*[uμυüúùûū][\.\s\_\-]*[i1l!|íìîïīΙł][\.\s\_\-]*[ckqĸķκϰ][\.\s\_\-]*[i1l!|íìîïīΙł][\.\s\_\-]*[dδ]/gi,
    /\b([a-z])\1{2,}\b/gi,
    /([a-z])\1{4,}/gi,
    /(\w)\1\.\1/gi,
    /(\w)-\1-\1/gi,
    /(\w)\s+\1\s+\1/gi,
    /([a-z])\1{2,}([a-z])\2{2,}/gi,
    /[a-z]{15,}/gi,
    /[a-z][0-9][a-z][0-9]/gi,
    /[0-9][a-z][0-9][a-z]/gi,
    /[a-z]+[0-9]+[a-z]+/gi,
    /[0-9]+[a-z]+[0-9]+/gi,
];

// Personal information patterns
const PII_PATTERNS = [
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
    /\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,
    /\b\d{5}(?:[-\s]\d{4})?\b/,
    /\b\d{1,5}\s+\w+\s+(street|st|ave|avenue|road|rd|drive|dr|lane|ln)\b/i,
    /\b(?:discord|snap|insta|tiktok|whatsapp|telegram|signal)[\s\:\.]*[\w@\.\-]+\b/i
];

// Toxic keywords with weights
const TOXIC_KEYWORDS = {
    'fack': 0.85, 'fak': 0.85, 'fukk': 0.85, 'phuck': 0.9, 'fuk': 0.85,
    'sheet': 0.8, 'shyt': 0.8, 'shiit': 0.8, 'sh1t': 0.85, 'shet': 0.8,
    'azz': 0.7, 'a55': 0.7, 'as': 0.65,
    'bich': 0.8, 'bi7ch': 0.85, 'b1tch': 0.85,
    'dam': 0.6, 'd4mn': 0.7, 'demn': 0.65,
    'kill': 0.9, 'suicide': 1.0, 'die': 0.9, 'dead': 0.8,
    'hate': 0.7, 'stupid': 0.6, 'idiot': 0.7, 'loser': 0.6,
    'dumb': 0.6, 'moron': 0.7, 'retard': 0.9,
    'ugly': 0.5, 'fat': 0.6, 'homo': 0.8, 'gay': 0.7,
    'noob': 0.4, 'n00b': 0.4
};

// ------------------------
// 4️⃣ Chat Filtering Functions
// ------------------------

function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    
    let normalized = text.toLowerCase();
    normalized = normalized.replace(/\s+/g, ' ');
    normalized = normalized
        .replace(/[4@áàâäãåαΔΛ]/g, 'a')
        .replace(/[8ßΒβ]/g, 'b')
        .replace(/[3€£ëèéêēΣ]/g, 'e')
        .replace(/[1!|íìîïīΙ]/g, 'i')
        .replace(/[0°óòôöõōΩθ]/g, 'o')
        .replace(/[5$zšş§]/g, 's')
        .replace(/[7+†τ]/g, 't')
        .replace(/[μυüúùûū]/g, 'u');
    normalized = normalized.replace(/[\.\_\-\s]+/g, '');
    normalized = normalized.replace(/([a-z])\1{2,}/g, '$1$1');
    normalized = normalized.replace(/[^a-z0-9]/g, '');
    
    return normalized;
}

function checkBypassPatterns(message) {
    const lowerMessage = message.toLowerCase();
    
    for (const pattern of BYPASS_PATTERNS) {
        if (pattern.test(lowerMessage)) {
            return true;
        }
    }
    
    const words = lowerMessage.split(/\s+/);
    const joined = words.join('');
    for (const word of blockedSet) {
        if (joined.includes(word)) {
            return true;
        }
    }
    
    return false;
}

function containsPII(message) {
    for (const pattern of PII_PATTERNS) {
        if (pattern.test(message)) {
            return true;
        }
    }
    return false;
}

function basicFilter(message) {
    if (!message || typeof message !== 'string') return false;
    
    if (message.length < CONFIG.MIN_MESSAGE_LENGTH || 
        message.length > CONFIG.MAX_MESSAGE_LENGTH) {
        return false;
    }
    
    if (containsPII(message)) {
        return false;
    }
    
    if (checkBypassPatterns(message)) {
        return false;
    }
    
    const normalized = normalizeText(message);
    
    for (const word of blockedSet) {
        if (normalized.includes(word)) {
            return false;
        }
    }
    
    return true;
}

function scoreToxicity(message) {
    const normalized = normalizeText(message);
    let score = 0;
    
    for (const [word, weight] of Object.entries(TOXIC_KEYWORDS)) {
        if (normalized.includes(word)) {
            score = Math.max(score, weight);
        }
    }
    
    if (message === message.toUpperCase() && message.length > 5) {
        score = Math.max(score, 0.3);
    }
    
    const punctuationCount = (message.match(/[!?]{3,}/g) || []).length;
    if (punctuationCount > 2) {
        score = Math.max(score, 0.2);
    }
    
    return score;
}

function moderateMessage(message) {
    if (!basicFilter(message)) {
        return { allowed: false, reason: 'basic_filter' };
    }
    
    const toxicityScore = scoreToxicity(message);
    if (toxicityScore >= CONFIG.TOXICITY_THRESHOLD) {
        return { allowed: false, reason: 'toxicity', score: toxicityScore };
    }
    
    return { allowed: true, score: toxicityScore };
}

function isSpam(playerId, message) {
    const now = Date.now();
    
    if (!messageHistory.has(playerId)) {
        messageHistory.set(playerId, []);
    }
    
    const history = messageHistory.get(playerId);
    
    while (history.length > 0 && now - history[0].timestamp > CONFIG.SPAM_WINDOW_MS) {
        history.shift();
    }
    
    if (history.length >= CONFIG.MAX_MESSAGES_PER_WINDOW) {
        return true;
    }
    
    const duplicateCount = history.filter(m => m.message === message).length;
    if (duplicateCount >= CONFIG.MAX_DUPLICATE_MESSAGES) {
        return true;
    }
    
    history.push({ message, timestamp: now });
    
    return false;
}

// ------------------------
// 5️⃣ Player Management
// ------------------------

/**
 * Initialize player data
 */
function initPlayer(socketId) {
    // Generate random color
    const colors = [
        '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
        '#EF476F', '#FFD166', '#06D6A0', '#073B4C', '#7209B7',
        '#F72585', '#3A0CA3', '#4361EE', '#4CC9F0', '#FF9E00',
        '#FF5400', '#FF0054', '#9B5DE5', '#00BBF9', '#00F5D4'
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    const playerData = {
        id: socketId,
        username: `Guest${Math.floor(Math.random() * 1000)}`,
        coins: 100,
        upgrades: {},
        health: 100,
        maxHealth: 100,
        score: 0,
        position: { x: 0, y: 1.67, z: 0 },
        rotation: { x: 0, y: 0 },
        color: randomColor,
        warnings: 0,
        muted: false,
        muteExpiry: null,
        joinTime: Date.now(),
        lastDamageTime: 0,
        lastActivityTime: Date.now(),
        lastMovementTime: Date.now(),
        isDead: false,
        isRespawning: false,
        isVisible: true,
        isActive: true,
        hitHistory: []
    };
    
    players.set(socketId, playerData);
    playerStats.set(socketId, {
        messagesSent: 0,
        messagesBlocked: 0,
        hitsGiven: 0,
        hitsReceived: 0,
        kills: 0,
        deaths: 0,
        coinsEarned: 0,
        lastActive: Date.now()
    });
    
    return playerData;
}

/**
 * Check if player is active (not inactive for >5 seconds)
 */
function isPlayerActive(playerId) {
    const player = players.get(playerId);
    if (!player) return false;
    
    if (player.isDead || player.isRespawning || !player.isVisible) return false;
    
    const timeSinceLastActivity = Date.now() - player.lastActivityTime;
    return timeSinceLastActivity < CONFIG.INACTIVE_THRESHOLD;
}

/**
 * Update player activity
 */
function updatePlayerActivity(playerId) {
    const player = players.get(playerId);
    if (!player) return;
    
    player.lastActivityTime = Date.now();
    
    // If player was marked inactive, mark them active again
    if (!player.isActive) {
        player.isActive = true;
        
        // Broadcast to all players that this player is active again
        io.emit('playerActivityUpdate', {
            playerId: playerId,
            isActive: true,
            username: player.username
        });
    }
}

/**
 * Check inactivity for all players
 */
function checkAllPlayersInactivity() {
    const now = Date.now();
    
    players.forEach((player, playerId) => {
        if (player.isDead || player.isRespawning) return;
        
        const timeSinceLastActivity = now - player.lastActivityTime;
        
        // If inactive for >5 seconds and currently marked active
        if (timeSinceLastActivity >= CONFIG.INACTIVE_THRESHOLD && player.isActive) {
            player.isActive = false;
            
            // Broadcast inactivity to all players
            io.emit('playerActivityUpdate', {
                playerId: playerId,
                isActive: false,
                username: player.username,
                inactiveFor: Math.floor(timeSinceLastActivity / 1000)
            });
        }
    });
}

/**
 * Start inactivity checking
 */
function startInactivityChecker() {
    setInterval(checkAllPlayersInactivity, CONFIG.INACTIVE_CHECK_INTERVAL);
}

/**
 * Check hit cooldown between players
 */
function canHitPlayer(attackerId, targetId) {
    if (!hitCooldowns.has(attackerId)) {
        hitCooldowns.set(attackerId, new Map());
    }
    
    const attackerCooldowns = hitCooldowns.get(attackerId);
    const lastHitTime = attackerCooldowns.get(targetId) || 0;
    const timeSinceLastHit = Date.now() - lastHitTime;
    
    return timeSinceLastHit >= CONFIG.HIT_COOLDOWN;
}

/**
 * Update hit cooldown
 */
function updateHitCooldown(attackerId, targetId) {
    if (!hitCooldowns.has(attackerId)) {
        hitCooldowns.set(attackerId, new Map());
    }
    
    hitCooldowns.get(attackerId).set(targetId, Date.now());
}

// ------------------------
// 6️⃣ Health Regeneration System
// ------------------------

function startHealthRegen(playerId) {
    if (regenIntervals.has(playerId)) {
        clearInterval(regenIntervals.get(playerId));
    }
    
    const regenInterval = setInterval(() => {
        const player = players.get(playerId);
        if (!player || player.isDead || player.isRespawning) {
            clearInterval(regenInterval);
            regenIntervals.delete(playerId);
            return;
        }
        
        const now = Date.now();
        
        if (player.health < player.maxHealth && 
            now - player.lastDamageTime >= CONFIG.HEALTH_REGEN_DELAY &&
            !player.isDead && player.isVisible) {
            
            let regenAmount = CONFIG.HEALTH_REGEN_AMOUNT;
            const hpRegenUpgrade = player.upgrades['hp_regen'] || 0;
            if (hpRegenUpgrade > 0) {
                regenAmount += (hpRegenUpgrade * 2);
            }
            
            const newHealth = Math.min(player.maxHealth, player.health + regenAmount);
            
            if (newHealth !== player.health) {
                player.health = newHealth;
                
                // Send update to player
                const socket = io.sockets.sockets.get(playerId);
                if (socket) {
                    socket.emit('healthUpdate', {
                        health: player.health,
                        maxHealth: player.maxHealth,
                        regen: true
                    });
                }
                
                // Broadcast to other players
                socket.broadcast.emit('playerHealthUpdate', {
                    playerId: playerId,
                    health: player.health,
                    maxHealth: player.maxHealth,
                    regen: true
                });
            }
        }
    }, CONFIG.HEALTH_REGEN_INTERVAL);
    
    regenIntervals.set(playerId, regenInterval);
}

function stopHealthRegen(playerId) {
    if (regenIntervals.has(playerId)) {
        clearInterval(regenIntervals.get(playerId));
        regenIntervals.delete(playerId);
    }
}

// ------------------------
// 7️⃣ Death & Respawn System
// ------------------------

function handlePlayerDeath(playerId, killerId = null) {
    const player = players.get(playerId);
    if (!player || player.isDead) return;
    
    // Set death state
    player.isDead = true;
    player.isVisible = false;
    player.health = 0;
    
    // Update stats
    const stats = playerStats.get(playerId);
    if (stats) {
        stats.deaths++;
    }
    
    // Handle killer rewards (only if killer is active)
    if (killerId && killerId !== playerId && isPlayerActive(killerId)) {
        const killer = players.get(killerId);
        const killerStats = playerStats.get(killerId);
        
        if (killer && killerStats) {
            const killReward = CONFIG.COINS_PER_KILL;
            killer.coins += killReward;
            killerStats.coinsEarned += killReward;
            killerStats.kills++;
            
            // Notify killer
            const killerSocket = io.sockets.sockets.get(killerId);
            if (killerSocket) {
                killerSocket.emit('coinUpdate', {
                    playerId: killerId,
                    coins: killer.coins,
                    reason: 'kill',
                    amount: killReward
                });
                
                killerSocket.emit('systemMessage', {
                    message: `💰 +${killReward} coins for killing ${player.username}`
                });
            }
        }
    }
    
    // Broadcast death to all players (player disappears)
    io.emit('playerDied', {
        playerId: playerId,
        username: player.username,
        killerId: killerId,
        position: player.position
    });
    
    // Notify the dead player
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) {
        playerSocket.emit('youDied', {
            respawnTime: CONFIG.RESPAWN_TIME,
            killerId: killerId
        });
    }
    
    // Start respawn timer
    respawnTimers.set(playerId, setTimeout(() => {
        respawnPlayer(playerId);
    }, CONFIG.RESPAWN_TIME));
}

function respawnPlayer(playerId) {
    const player = players.get(playerId);
    if (!player) return;
    
    // Clear respawn timer
    const timer = respawnTimers.get(playerId);
    if (timer) clearTimeout(timer);
    respawnTimers.delete(playerId);
    
    // Reset player state
    player.isDead = false;
    player.isRespawning = false;
    player.isVisible = true;
    player.health = CONFIG.RESPAWN_HEALTH;
    
    // Reset position to spawn point (or random location)
    player.position = { x: Math.random() * 20 - 10, y: 1.67, z: Math.random() * 20 - 10 };
    
    // Update activity on respawn
    updatePlayerActivity(playerId);
    
    // Broadcast respawn to all players (player reappears)
    io.emit('playerRespawned', {
        playerId: playerId,
        username: player.username,
        position: player.position,
        health: player.health,
        color: player.color,
        isVisible: true
    });
    
    // Notify the player
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) {
        playerSocket.emit('respawnComplete', {
            position: player.position,
            health: player.health
        });
        
        playerSocket.emit('healthUpdate', {
            health: player.health,
            maxHealth: player.maxHealth
        });
    }
    
    // Start health regeneration system
    startHealthRegen(playerId);
}

// ------------------------
// 8️⃣ Shop System
// ------------------------

const SHOP_ITEMS = {
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
            stats: { reloadSpeed: { base: 3, decrease: 0.2 } } 
        }
    ],
    hp: [
        { 
            id: 'hp_max', 
            name: 'Max HP', 
            maxLevel: 10, 
            basePrice: 80, 
            priceMultiplier: 1.8, 
            stats: { maxHP: { base: 100, increase: 20 } } 
        },
        { 
            id: 'hp_regen', 
            name: 'HP Regen', 
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
    ]
};

/**
 * Get upgrade level for a player
 */
function getUpgradeLevel(player, itemId) {
    return player.upgrades[itemId] || 0;
}

/**
 * Apply upgrade effects to player
 */
function applyUpgrade(player, item) {
    const level = getUpgradeLevel(player, item.id);
    
    Object.entries(item.stats).forEach(([stat, data]) => {
        if (data.increase !== undefined) {
            player[stat] = (data.base || 0) + (level * data.increase);
        }
        if (data.decrease !== undefined) {
            player[stat] = Math.max(0, (data.base || 0) - (level * data.decrease));
        }
    });
    
    // Special handling for max HP
    if (item.id === 'hp_max') {
        player.maxHealth = 100 + (level * 20);
        if (player.health > player.maxHealth) {
            player.health = player.maxHealth;
        }
    }
}

/**
 * Calculate upgrade price
 */
function calculateUpgradePrice(item, currentLevel) {
    return Math.floor(item.basePrice * Math.pow(item.priceMultiplier, currentLevel));
}

// ------------------------
// 9️⃣ Socket.IO Event Handlers
// ------------------------

io.on('connection', (socket) => {
    console.log(`✅ Player connected: ${socket.id}`);
    
    // Initialize player
    const player = initPlayer(socket.id);
    
    // Start health regeneration system
    startHealthRegen(socket.id);
    
    // Start inactivity checker
    startInactivityChecker();
    
    // Send initial data to player
    socket.emit('init', { 
        playerId: socket.id, 
        player: {
            id: player.id,
            username: player.username,
            coins: player.coins,
            health: player.health,
            maxHealth: player.maxHealth,
            position: player.position,
            color: player.color,
            isDead: player.isDead,
            isVisible: player.isVisible,
            isActive: player.isActive
        },
        shopItems: SHOP_ITEMS,
        config: {
            maxUsernameLength: CONFIG.MAX_USERNAME_LENGTH,
            maxMessageLength: CONFIG.MAX_MESSAGE_LENGTH,
            healthRegenDelay: CONFIG.HEALTH_REGEN_DELAY,
            respawnTime: CONFIG.RESPAWN_TIME,
            inactiveThreshold: CONFIG.INACTIVE_THRESHOLD
        }
    });
    
    // Notify other players
    socket.broadcast.emit('playerJoined', {
        id: socket.id,
        username: player.username,
        position: player.position,
        color: player.color,
        health: player.health,
        isVisible: player.isVisible,
        isActive: player.isActive
    });
    
    // ------------------------
    // Event: Set Username
    // ------------------------
    socket.on('setUsername', (username) => {
        if (!username || typeof username !== 'string') {
            socket.emit('error', { message: 'Invalid username' });
            return;
        }
        
        const cleanUsername = username.trim().slice(0, CONFIG.MAX_USERNAME_LENGTH);
        if (cleanUsername.length < 2) {
            socket.emit('error', { message: 'Username too short' });
            return;
        }
        
        // Check for inappropriate usernames
        const moderationResult = moderateMessage(cleanUsername);
        if (!moderationResult.allowed) {
            socket.emit('error', { message: 'Username contains inappropriate content' });
            return;
        }
        
        const oldUsername = player.username;
        player.username = cleanUsername;
        
        io.emit('playerUsernameUpdated', { 
            playerId: socket.id, 
            oldUsername, 
            newUsername: cleanUsername 
        });
        
        socket.emit('usernameSet', { success: true, username: cleanUsername });
        updatePlayerActivity(socket.id);
    });
    
    // ------------------------
    // Event: Player Movement
    // ------------------------
    socket.on('playerMove', (data) => {
        if (player.isDead || !player.isVisible) return;
        
        player.lastMovementTime = Date.now();
        updatePlayerActivity(socket.id);
        
        if (data.position) player.position = data.position;
        if (data.rotation) player.rotation = data.rotation;
        
        // Broadcast to other players (only if visible)
        if (player.isVisible) {
            socket.broadcast.emit('playerMoved', {
                playerId: socket.id,
                username: player.username,
                position: player.position,
                rotation: player.rotation,
                color: player.color,
                isVisible: player.isVisible,
                isActive: player.isActive
            });
        }
    });
    
    // ------------------------
    // Event: Player Attack
    // ------------------------
    socket.on('playerAttack', (data) => {
        if (player.isDead || !player.isVisible) return;
        
        updatePlayerActivity(socket.id);
        
        const { targetId, damage = 10 } = data;
        if (!targetId || targetId === socket.id) return;
        
        const target = players.get(targetId);
        if (!target || !target.isVisible) return;
        
        if (!canHitPlayer(socket.id, targetId)) return;
        
        // Check if target is active (not inactive for >5 seconds)
        if (!isPlayerActive(targetId)) {
            socket.emit('systemMessage', {
                message: '⚠️ Cannot attack inactive players'
            });
            return;
        }
        
        updateHitCooldown(socket.id, targetId);
        
        // Broadcast attack to other players
        socket.broadcast.emit('playerAttacked', {
            attackerId: socket.id,
            attackerName: player.username,
            targetId: targetId,
            targetName: target.username,
            damage: damage
        });
        
        // Apply damage with coin rewards
        applyDamage(targetId, socket.id, damage);
    });
    
    /**
     * Apply damage to a player with coin rewards
     */
    function applyDamage(targetId, attackerId, damage) {
        const target = players.get(targetId);
        if (!target || target.isDead || !target.isVisible) return;
        
        target.lastDamageTime = Date.now();
        updatePlayerActivity(targetId);
        stopHealthRegen(targetId);
        
        const newHealth = Math.max(0, target.health - damage);
        target.health = newHealth;
        
        // Award coins to attacker for hitting an ACTIVE player
        const attacker = players.get(attackerId);
        const attackerStats = playerStats.get(attackerId);
        if (attacker && attackerStats && isPlayerActive(targetId)) {
            const hitReward = CONFIG.COINS_PER_HIT;
            attacker.coins += hitReward;
            attackerStats.coinsEarned += hitReward;
            attackerStats.hitsGiven++;
            
            const attackerSocket = io.sockets.sockets.get(attackerId);
            if (attackerSocket) {
                attackerSocket.emit('coinUpdate', {
                    playerId: attackerId,
                    coins: attacker.coins,
                    reason: 'hit',
                    amount: hitReward
                });
            }
        }
        
        // Update target stats
        const targetStats = playerStats.get(targetId);
        if (targetStats) {
            targetStats.hitsReceived++;
        }
        
        // Notify target
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.emit('youWereHit', {
                attackerId: attackerId,
                attackerName: attacker?.username,
                damage: damage,
                health: target.health
            });
            
            targetSocket.emit('healthUpdate', {
                health: target.health,
                maxHealth: target.maxHealth,
                damageTaken: damage
            });
        }
        
        // Broadcast damage event
        io.emit('playerDamaged', {
            playerId: targetId,
            username: target.username,
            health: target.health,
            maxHealth: target.maxHealth,
            damage: damage,
            attackerId: attackerId,
            attackerName: attacker?.username
        });
        
        // Check if target died
        if (target.health <= 0 && !target.isDead) {
            handlePlayerDeath(targetId, attackerId);
        } else {
            // Schedule regeneration for target after delay
            setTimeout(() => {
                if (players.has(targetId)) {
                    const updatedTarget = players.get(targetId);
                    if (!updatedTarget.isDead && updatedTarget.isVisible) {
                        startHealthRegen(targetId);
                    }
                }
            }, CONFIG.HEALTH_REGEN_DELAY);
        }
    }
    
    // ------------------------
    // Event: Player Hit
    // ------------------------
    socket.on('playerHit', (data) => {
        if (player.isDead || !player.isVisible) return;
        
        const { attackerId, damage = 10 } = data;
        
        player.hitHistory.push({
            attackerId: attackerId,
            timestamp: Date.now(),
            damage: damage
        });
        
        player.hitHistory = player.hitHistory.filter(
            hit => Date.now() - hit.timestamp < 30000
        );
        
        updatePlayerActivity(socket.id);
        player.lastDamageTime = Date.now();
        stopHealthRegen(socket.id);
        
        const newHealth = Math.max(0, player.health - damage);
        player.health = newHealth;
        
        socket.emit('healthUpdate', {
            health: player.health,
            maxHealth: player.maxHealth,
            damageTaken: damage,
            attackerId: attackerId
        });
        
        socket.broadcast.emit('playerDamaged', {
            playerId: socket.id,
            username: player.username,
            health: player.health,
            maxHealth: player.maxHealth,
            damage: damage,
            attackerId: attackerId,
            attackerName: attackerId ? players.get(attackerId)?.username : null
        });
        
        if (player.health <= 0 && !player.isDead) {
            handlePlayerDeath(socket.id, attackerId);
        } else {
            setTimeout(() => {
                if (!player.isDead && player.isVisible) {
                    startHealthRegen(socket.id);
                }
            }, CONFIG.HEALTH_REGEN_DELAY);
        }
    });
    
    // ------------------------
    // Event: Chat Message
    // ------------------------
    socket.on('chatMessage', (data) => {
        updatePlayerActivity(socket.id);
        
        // Check if muted
        if (player.muted) {
            const remaining = Math.ceil((player.muteExpiry - Date.now()) / 1000 / 60);
            socket.emit('systemMessage', { 
                message: `🔇 You are muted for ${remaining} more minute(s).` 
            });
            return;
        }
        
        const message = data?.message?.trim();
        
        if (!message || message.length < CONFIG.MIN_MESSAGE_LENGTH) {
            return;
        }
        
        if (message.length > CONFIG.MAX_MESSAGE_LENGTH) {
            socket.emit('systemMessage', { 
                message: `Message too long (max ${CONFIG.MAX_MESSAGE_LENGTH} characters)` 
            });
            return;
        }
        
        // Check for spam
        if (isSpam(socket.id, message)) {
            socket.emit('systemMessage', { 
                message: '⚠️ Please wait before sending another message.' 
            });
            return;
        }
        
        // Moderate message
        const moderationResult = moderateMessage(message);
        
        if (!moderationResult.allowed) {
            const stats = playerStats.get(socket.id);
            stats.messagesBlocked++;
            
            player.warnings++;
            
            const warningsLeft = CONFIG.MAX_WARNINGS - player.warnings;
            let warningMsg = `⚠️ Your message was blocked. `;
            
            if (warningsLeft > 0) {
                warningMsg += `Warnings: ${player.warnings}/${CONFIG.MAX_WARNINGS}`;
            } else {
                warningMsg += `You have been muted for ${CONFIG.MUTE_DURATION / 60000} minutes.`;
            }
            
            socket.emit('systemMessage', { message: warningMsg });
            
            if (player.warnings >= CONFIG.MAX_WARNINGS) {
                player.muted = true;
                player.muteExpiry = Date.now() + CONFIG.MUTE_DURATION;
                
                socket.emit('systemMessage', { 
                    message: `🔇 You have been muted for ${CONFIG.MUTE_DURATION / 60000} minutes.` 
                });
            }
            
            console.log(`Blocked message from ${player.username}: "${message}"`);
            return;
        }
        
        // Update stats
        const stats = playerStats.get(socket.id);
        stats.messagesSent++;
        stats.lastActive = Date.now();
        
        // Broadcast message
        io.emit('chatMessage', { 
            playerId: socket.id,
            username: player.username,
            message: message,
            timestamp: Date.now(),
            color: player.color,
            toxicityScore: moderationResult.score
        });
    });
    
    // ------------------------
    // Event: Purchase Upgrade
    // ------------------------
    socket.on('purchaseUpgrade', (data) => {
        updatePlayerActivity(socket.id);
        
        const { upgradeId } = data;
        
        // Find the item
        let item = null;
        for (const category of Object.values(SHOP_ITEMS)) {
            item = category.find(i => i.id === upgradeId);
            if (item) break;
        }
        
        if (!item) {
            socket.emit('upgradeResult', { 
                success: false, 
                message: 'Item not found!' 
            });
            return;
        }
        
        // Check current level
        const currentLevel = getUpgradeLevel(player, upgradeId);
        if (currentLevel >= item.maxLevel) {
            socket.emit('upgradeResult', { 
                success: false, 
                message: 'Maximum level reached!' 
            });
            return;
        }
        
        // Calculate price
        const price = calculateUpgradePrice(item, currentLevel);
        
        // Check coins
        if (player.coins < price) {
            socket.emit('upgradeResult', { 
                success: false, 
                message: `Not enough coins! Need ${price}, have ${player.coins}` 
            });
            return;
        }
        
        // Purchase upgrade
        player.coins -= price;
        player.upgrades[upgradeId] = currentLevel + 1;
        applyUpgrade(player, item);
        
        // Send response
        socket.emit('upgradeResult', { 
            success: true, 
            upgradeId, 
            upgradeName: item.name,
            newLevel: player.upgrades[upgradeId],
            newCoins: player.coins
        });
        
        // Update coins
        socket.emit('coinUpdate', { 
            playerId: socket.id, 
            coins: player.coins 
        });
    });
    
    // ------------------------
    // Event: Player Heal
    // ------------------------
    socket.on('playerHeal', (amount = 10) => {
        if (player.isDead || !player.isVisible) return;
        
        updatePlayerActivity(socket.id);
        
        player.health = Math.min(player.maxHealth, player.health + amount);
        
        socket.emit('healthUpdate', {
            health: player.health,
            maxHealth: player.maxHealth,
            healed: amount
        });
        
        socket.broadcast.emit('playerHealthUpdate', {
            playerId: socket.id,
            health: player.health,
            maxHealth: player.maxHealth,
            healed: amount
        });
    });
    
    // ------------------------
    // Event: Request Respawn
    // ------------------------
    socket.on('requestRespawn', () => {
        if (!player.isDead) return;
        
        // Clear existing respawn timer
        const timer = respawnTimers.get(socket.id);
        if (timer) clearTimeout(timer);
        
        // Respawn immediately
        respawnPlayer(socket.id);
    });
    
    // ------------------------
    // Event: Player Activity Ping
    // ------------------------
    socket.on('activityPing', () => {
        updatePlayerActivity(socket.id);
    });
    
    // ------------------------
    // Coin Timer
    // ------------------------
    const coinInterval = setInterval(() => {
        if (!players.has(socket.id)) {
            clearInterval(coinInterval);
            return;
        }
        
        // Only award coins if player is active, not dead, and visible
        if (!player.isDead && player.isVisible && isPlayerActive(socket.id)) {
            player.coins += CONFIG.COINS_PER_MINUTE;
            socket.emit('coinUpdate', {
                playerId: socket.id,
                coins: player.coins,
                reason: 'time'
            });
        }
    }, CONFIG.COIN_INTERVAL);
    
    // ------------------------
    // Event: Disconnect
    // ------------------------
    socket.on('disconnect', () => {
        console.log(`❌ Player disconnected: ${socket.id}`);
        
        // Clean up intervals
        clearInterval(coinInterval);
        
        // Clean up regen interval
        stopHealthRegen(socket.id);
        
        // Clean up respawn timer
        const respawnTimer = respawnTimers.get(socket.id);
        if (respawnTimer) clearTimeout(respawnTimer);
        respawnTimers.delete(socket.id);
        
        // Clear hit cooldowns
        hitCooldowns.delete(socket.id);
        
        // Notify other players
        io.emit('playerLeft', {
            playerId: socket.id,
            username: player.username
        });
        
        // Remove player data
        players.delete(socket.id);
        messageHistory.delete(socket.id);
        playerStats.delete(socket.id);
    });
});

// ------------------------
// 🔟 HTTP Routes
// ------------------------
app.use(express.static('public'));

app.get('/api/players', (req, res) => {
    const playerList = Array.from(players.values()).map(p => ({
        id: p.id,
        username: p.username,
        score: p.score,
        coins: p.coins,
        health: p.health,
        isDead: p.isDead,
        isActive: p.isActive,
        isVisible: p.isVisible,
        lastActive: p.lastActivityTime
    }));
    res.json({ players: playerList, total: playerList.length });
});

app.get('/api/stats', (req, res) => {
    const stats = {
        totalPlayers: players.size,
        activePlayers: Array.from(players.values()).filter(p => p.isActive).length,
        deadPlayers: Array.from(players.values()).filter(p => p.isDead).length,
        invisiblePlayers: Array.from(players.values()).filter(p => !p.isVisible).length,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        connections: io.engine.clientsCount
    };
    res.json(stats);
});

// ------------------------
// Server Startup
// ------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🎮 Server running on port ${PORT}`);
    console.log('✅ Health regeneration system active');
    console.log('✅ Player disappearance on death active');
    console.log('✅ Anti-farming protection active');
    console.log('✅ Chat filtering system active');
    console.log('✅ Features:');
    console.log('   - 3-second health regeneration delay');
    console.log('   - Player disappears when dead until respawn');
    console.log('   - No coin rewards for hitting inactive players');
    console.log('   - 5-second inactivity threshold');
    console.log('   - Multi-layer chat filtering');
    console.log('   - Hit cooldown protection');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});
