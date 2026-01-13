// server.js - COPPA-Compliant, Offline Multi-Layer Chat Filter (512MB RAM)
// Multiplayer Game Server with Enhanced Chat Filtering

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
    TOXICITY_THRESHOLD: 0.7
};

// ------------------------
// 2️⃣ Data Storage
// ------------------------
const players = new Map();           // socket.id -> player data
const messageHistory = new Map();    // socket.id -> message history for spam detection
const playerStats = new Map();       // socket.id -> moderation stats

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
    /f[\.\s\_\-]*[a4@][\.\s\_\-]*[ckq][\.\s\_\-]*[ckq7]/gi,
    /s[\.\s\_\-]*[h4#][\.\s\_\-]*[i1l!][\.\s\_\-]*[t7+]/gi,
    /[a4@][\.\s\_\-]*[sz5\$][\.\s\_\-]*[sz5\$]/gi,
    /b[\.\s\_\-]*[i1l!][\.\s\_\-]*[t7+][\.\s\_\-]*[ch4#]/gi,
    /d[\.\s\_\-]*[a4@][\.\s\_\-]*[mn][\.\s\_\-]*[mn]/gi,
    /ph[ckq]/gi,
    /\b([a-z])\1{3,}\b/gi, // 4+ repeated letters
    /(.)\1{4,}/g // 5+ repeated characters
];

// Personal information patterns
const PII_PATTERNS = [
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // phone numbers
    /\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/, // email
    /\b\d{5}(?:[-\s]\d{4})?\b/, // zip code
    /\b\d{1,5}\s+\w+\s+(street|st|ave|avenue|road|rd|drive|dr|lane|ln)\b/i, // address
    /\b(?:discord|snap|insta|tiktok|whatsapp|telegram|signal)[\s\:\.]*[\w@\.\-]+\b/i // social media
];

// Toxic keywords with weights
const TOXIC_KEYWORDS = {
    // Profanity bypass attempts
    'fack': 0.85, 'fak': 0.85, 'fukk': 0.85, 'phuck': 0.9, 'fuk': 0.85,
    'sheet': 0.8, 'shyt': 0.8, 'shiit': 0.8, 'sh1t': 0.85, 'shet': 0.8,
    'azz': 0.7, 'a55': 0.7, 'as': 0.65,
    'bich': 0.8, 'bi7ch': 0.85, 'b1tch': 0.85, 'b1tch': 0.85,
    'dam': 0.6, 'd4mn': 0.7, 'demn': 0.65,
    
    // Harmful content
    'kill': 0.9, 'suicide': 1.0, 'die': 0.9, 'dead': 0.8,
    'hate': 0.7, 'stupid': 0.6, 'idiot': 0.7, 'loser': 0.6,
    'dumb': 0.6, 'moron': 0.7, 'retard': 0.9,
    
    // Bullying/harassment
    'ugly': 0.5, 'fat': 0.6, 'homo': 0.8, 'gay': 0.7,
    'noob': 0.4, 'n00b': 0.4
};

// Character substitution map
const CHAR_SUBSTITUTIONS = {
    'a': ['4', '@', 'á', 'à', 'â', 'ä', 'ã', 'å', 'α', 'Δ', 'Λ'],
    'b': ['8', 'ß', 'Β', 'β'],
    'c': ['(', '[', '{', '<', '©', '¢'],
    'e': ['3', '€', '£', 'ë', 'è', 'é', 'ê', 'ē', 'Σ'],
    'i': ['1', '!', '|', 'í', 'ì', 'î', 'ï', 'ī', 'Ι'],
    'o': ['0', '°', 'ó', 'ò', 'ô', 'ö', 'õ', 'ō', 'Ω', 'θ'],
    's': ['5', '$', 'z', 'š', 'ş', '§'],
    't': ['7', '+', '†', 'τ'],
    'u': ['μ', 'υ', 'ü', 'ú', 'ù', 'û', 'ū'],
    'v': ['υ', 'ν'],
    'x': ['×', 'Χ', 'χ'],
    'z': ['2', 'ž', 'ζ']
};

// ------------------------
// 4️⃣ Filtering Functions
// ------------------------

/**
 * Normalize text to prevent bypass attempts
 */
function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    
    let normalized = text.toLowerCase();
    
    // Remove excessive whitespace
    normalized = normalized.replace(/\s+/g, ' ');
    
    // Convert common substitutions to base letters
    normalized = normalized
        .replace(/[4@áàâäãåαΔΛ]/g, 'a')
        .replace(/[8ßΒβ]/g, 'b')
        .replace(/[3€£ëèéêēΣ]/g, 'e')
        .replace(/[1!|íìîïīΙ]/g, 'i')
        .replace(/[0°óòôöõōΩθ]/g, 'o')
        .replace(/[5$zšş§]/g, 's')
        .replace(/[7+†τ]/g, 't')
        .replace(/[μυüúùûū]/g, 'u');
    
    // Remove dots and special characters between letters (f.a.c.k -> fack)
    normalized = normalized.replace(/[\.\_\-\s]+/g, '');
    
    // Reduce repeated characters (faaaack -> fack)
    normalized = normalized.replace(/([a-z])\1{2,}/g, '$1$1');
    
    // Remove all remaining non-alphanumeric characters
    normalized = normalized.replace(/[^a-z0-9]/g, '');
    
    return normalized;
}

/**
 * Check for bypass patterns like split words or special characters
 */
function checkBypassPatterns(message) {
    const lowerMessage = message.toLowerCase();
    
    // Check predefined bypass patterns
    for (const pattern of BYPASS_PATTERNS) {
        if (pattern.test(lowerMessage)) {
            return true;
        }
    }
    
    // Check for words split by spaces or dots
    const words = lowerMessage.split(/\s+/);
    const joined = words.join('');
    for (const word of blockedSet) {
        if (joined.includes(word)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Check for personal information
 */
function containsPII(message) {
    for (const pattern of PII_PATTERNS) {
        if (pattern.test(message)) {
            return true;
        }
    }
    return false;
}

/**
 * Layer 1: Basic keyword and pattern filtering
 */
function basicFilter(message) {
    if (!message || typeof message !== 'string') return false;
    
    // Check message length
    if (message.length < CONFIG.MIN_MESSAGE_LENGTH || 
        message.length > CONFIG.MAX_MESSAGE_LENGTH) {
        return false;
    }
    
    // Check for PII
    if (containsPII(message)) {
        return false;
    }
    
    // Check bypass patterns
    if (checkBypassPatterns(message)) {
        return false;
    }
    
    // Normalize and check blocked words
    const normalized = normalizeText(message);
    
    for (const word of blockedSet) {
        if (normalized.includes(word)) {
            return false;
        }
    }
    
    return true;
}

/**
 * Layer 2: Lightweight toxicity scoring
 */
function scoreToxicity(message) {
    const normalized = normalizeText(message);
    let score = 0;
    
    // Check toxic keywords
    for (const [word, weight] of Object.entries(TOXIC_KEYWORDS)) {
        if (normalized.includes(word)) {
            score = Math.max(score, weight);
        }
    }
    
    // Check for all caps (shouting)
    if (message === message.toUpperCase() && message.length > 5) {
        score = Math.max(score, 0.3);
    }
    
    // Check for excessive punctuation
    const punctuationCount = (message.match(/[!?]{3,}/g) || []).length;
    if (punctuationCount > 2) {
        score = Math.max(score, 0.2);
    }
    
    return score;
}

/**
 * Complete moderation pipeline
 */
function moderateMessage(message) {
    // Layer 1: Basic filtering
    if (!basicFilter(message)) {
        return { allowed: false, reason: 'basic_filter' };
    }
    
    // Layer 2: Toxicity scoring
    const toxicityScore = scoreToxicity(message);
    if (toxicityScore >= CONFIG.TOXICITY_THRESHOLD) {
        return { allowed: false, reason: 'toxicity', score: toxicityScore };
    }
    
    return { allowed: true, score: toxicityScore };
}

// ------------------------
// 5️⃣ Spam Detection
// ------------------------

/**
 * Check if message is spam
 */
function isSpam(playerId, message) {
    const now = Date.now();
    
    // Initialize history if needed
    if (!messageHistory.has(playerId)) {
        messageHistory.set(playerId, []);
    }
    
    const history = messageHistory.get(playerId);
    
    // Remove old messages (outside spam window)
    while (history.length > 0 && now - history[0].timestamp > CONFIG.SPAM_WINDOW_MS) {
        history.shift();
    }
    
    // Check message frequency
    if (history.length >= CONFIG.MAX_MESSAGES_PER_WINDOW) {
        return true;
    }
    
    // Check for duplicate messages
    const duplicateCount = history.filter(m => m.message === message).length;
    if (duplicateCount >= CONFIG.MAX_DUPLICATE_MESSAGES) {
        return true;
    }
    
    // Add message to history
    history.push({ message, timestamp: now });
    
    return false;
}

// ------------------------
// 6️⃣ Player Management
// ------------------------

/**
 * Initialize player data
 */
function initPlayer(socketId) {
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
        warnings: 0,
        muted: false,
        muteExpiry: null,
        joinTime: Date.now()
    };
    
    players.set(socketId, playerData);
    playerStats.set(socketId, {
        messagesSent: 0,
        messagesBlocked: 0,
        lastActive: Date.now()
    });
    
    return playerData;
}

/**
 * Check and clear expired mutes
 */
function checkMuteStatus(player) {
    if (player.muted && player.muteExpiry && Date.now() > player.muteExpiry) {
        player.muted = false;
        player.muteExpiry = null;
        player.warnings = 0;
        return false;
    }
    return player.muted;
}

/**
 * Apply mute to player
 */
function applyMute(player, duration = CONFIG.MUTE_DURATION) {
    player.muted = true;
    player.muteExpiry = Date.now() + duration;
    player.warnings = CONFIG.MAX_WARNINGS; // Max out warnings
}

// ------------------------
// 7️⃣ Game Shop System
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
// 8️⃣ Socket.IO Event Handlers
// ------------------------

io.on('connection', (socket) => {
    console.log(`✅ Player connected: ${socket.id}`);
    
    // Initialize player
    const player = initPlayer(socket.id);
    
    // Send initial data to player
    socket.emit('init', { 
        playerId: socket.id, 
        player: player,
        shopItems: SHOP_ITEMS,
        config: {
            maxUsernameLength: CONFIG.MAX_USERNAME_LENGTH,
            maxMessageLength: CONFIG.MAX_MESSAGE_LENGTH
        }
    });
    
    // Notify other players
    socket.broadcast.emit('playerJoined', {
        id: socket.id,
        username: player.username,
        position: player.position
    });
    
    // ------------------------
    // Event: Set Username
    // ------------------------
    socket.on('setUsername', (username) => {
        if (!username || typeof username !== 'string') {
            socket.emit('error', { message: 'Invalid username' });
            return;
        }
        
        // Validate username
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
        
        // Update username
        const oldUsername = player.username;
        player.username = cleanUsername;
        
        // Notify all players
        io.emit('playerUsernameUpdated', { 
            playerId: socket.id, 
            oldUsername, 
            newUsername: cleanUsername 
        });
        
        socket.emit('usernameSet', { success: true, username: cleanUsername });
    });
    
    // ------------------------
    // Event: Chat Message
    // ------------------------
    socket.on('chatMessage', (data) => {
        // Check if muted
        if (checkMuteStatus(player)) {
            const remaining = Math.ceil((player.muteExpiry - Date.now()) / 1000 / 60);
            socket.emit('systemMessage', { 
                message: `🔇 You are muted for ${remaining} more minute(s).` 
            });
            return;
        }
        
        const message = data?.message?.trim();
        
        // Validate message
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
            // Update stats
            const stats = playerStats.get(socket.id);
            stats.messagesBlocked++;
            
            // Increment warnings
            player.warnings++;
            
            // Send warning
            const warningsLeft = CONFIG.MAX_WARNINGS - player.warnings;
            let warningMsg = `⚠️ Your message was blocked. `;
            
            if (warningsLeft > 0) {
                warningMsg += `Warnings: ${player.warnings}/${CONFIG.MAX_WARNINGS}`;
            } else {
                warningMsg += `You have been muted for ${CONFIG.MUTE_DURATION / 60000} minutes.`;
            }
            
            socket.emit('systemMessage', { message: warningMsg });
            
            // Apply mute if max warnings reached
            if (player.warnings >= CONFIG.MAX_WARNINGS) {
                applyMute(player);
                
                // Notify player
                socket.emit('systemMessage', { 
                    message: `🔇 You have been muted for ${CONFIG.MUTE_DURATION / 60000} minutes.` 
                });
            }
            
            // Log blocked message (server-side only)
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
            toxicityScore: moderationResult.score
        });
    });
    
    // ------------------------
    // Event: Purchase Upgrade
    // ------------------------
    socket.on('purchaseUpgrade', (data) => {
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
    // Event: Player Movement
    // ------------------------
    socket.on('playerMove', (data) => {
        if (data.position) player.position = data.position;
        if (data.rotation) player.rotation = data.rotation;
        
        // Broadcast to other players
        socket.broadcast.emit('playerMoved', {
            playerId: socket.id,
            position: player.position,
            rotation: player.rotation
        });
    });
    
    // ------------------------
    // Event: Player Attack
    // ------------------------
    socket.on('playerAttack', (data) => {
        // Broadcast attack to other players
        socket.broadcast.emit('playerAttacked', {
            playerId: socket.id,
            targetId: data.targetId,
            damage: data.damage || 10
        });
    });
    
    // ------------------------
    // Event: Player Hit
    // ------------------------
    socket.on('playerHit', (data) => {
        const damage = data.damage || 10;
        player.health = Math.max(0, player.health - damage);
        
        // Update player
        socket.emit('healthUpdate', { 
            health: player.health, 
            maxHealth: player.maxHealth 
        });
        
        // Broadcast to other players
        socket.broadcast.emit('playerDamaged', {
            playerId: socket.id,
            health: player.health,
            damage: damage
        });
        
        // Check if player died
        if (player.health <= 0) {
            player.health = player.maxHealth;
            player.score = Math.max(0, player.score - 10);
            
            socket.emit('playerDied', { 
                respawnPosition: player.position 
            });
            
            socket.broadcast.emit('playerDiedBroadcast', {
                playerId: socket.id,
                username: player.username
            });
        }
    });
    
    // ------------------------
    // Event: Player Heal
    // ------------------------
    socket.on('playerHeal', (amount = 10) => {
        player.health = Math.min(player.maxHealth, player.health + amount);
        socket.emit('healthUpdate', { 
            health: player.health, 
            maxHealth: player.maxHealth 
        });
    });
    
    // ------------------------
    // Event: Disconnect
    // ------------------------
    socket.on('disconnect', () => {
        console.log(`❌ Player disconnected: ${socket.id}`);
        
        // Remove player data
        players.delete(socket.id);
        messageHistory.delete(socket.id);
        playerStats.delete(socket.id);
        
        // Notify other players
        io.emit('playerLeft', socket.id);
    });
    
    // ------------------------
    // Coin Timer
    // ------------------------
    const coinInterval = setInterval(() => {
        if (!players.has(socket.id)) {
            clearInterval(coinInterval);
            return;
        }
        
        player.coins += CONFIG.COINS_PER_MINUTE;
        socket.emit('coinUpdate', { 
            playerId: socket.id, 
            coins: player.coins 
        });
        
        // Auto-heal over time
        if (player.health < player.maxHealth) {
            player.health = Math.min(player.maxHealth, player.health + 1);
            socket.emit('healthUpdate', { 
                health: player.health, 
                maxHealth: player.maxHealth 
            });
        }
    }, CONFIG.COIN_INTERVAL);
    
    // Clean up interval on disconnect
    socket.on('disconnect', () => {
        clearInterval(coinInterval);
    });
});

// ------------------------
// 9️⃣ HTTP Routes
// ------------------------
app.use(express.static('public'));

app.get('/api/players', (req, res) => {
    const playerList = Array.from(players.values()).map(p => ({
        id: p.id,
        username: p.username,
        score: p.score,
        coins: p.coins,
        health: p.health
    }));
    res.json({ players: playerList, total: playerList.length });
});

app.get('/api/stats', (req, res) => {
    const stats = {
        totalPlayers: players.size,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        blockedWordsCount: blockedWords.length,
        connections: io.engine.clientsCount
    };
    res.json(stats);
});

// ------------------------
// 🔟 Server Startup
// ------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🎮 Server running on port ${PORT}`);
    console.log('👶 COPPA-COMPLIANT MODE: Safe for users under 13');
    console.log('✅ Enhanced chat filtering active');
    console.log('✅ Multi-layer protection:');
    console.log('   - Basic keyword filtering');
    console.log('   - Bypass pattern detection');
    console.log('   - Toxicity scoring');
    console.log('   - Spam detection');
    console.log('   - PII protection');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});
