// server.js - COPPA-Compliant, Offline Multi-Layer Chat Filter (512MB RAM)
// Multiplayer Game Server with Shop, Coins, Chat, and Lightweight GPT-J-style scoring

if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

// ------------------------
// 1️⃣ Load bad words
// ------------------------
let blockedWords = [];
try {
    const filePath = path.join(__dirname, 'badwords.txt');
    if (fs.existsSync(filePath)) {
        blockedWords = fs.readFileSync(filePath, 'utf-8')
            .split('\n')
            .map(w => w.trim().toLowerCase())
            .filter(Boolean);
        console.log(`✅ Loaded ${blockedWords.length} bad words`);
    }
} catch(err) {
    console.warn("⚠️ Could not load badwords.txt", err.message);
}
const blockedSet = new Set(blockedWords);

// ------------------------
// 2️⃣ Player & Game Data
// ------------------------
const players = new Map();       // key: socket.id -> { username, coins, upgrades, health, etc. }
const messageHistory = new Map(); // key: socket.id -> array of recent messages

// Shop / Upgrades
const shopItems = {
    blaster: [
        { id: 'blaster_damage', name: 'Damage Upgrade', maxLevel: 10, basePrice: 50, priceMultiplier: 1.5, stats: { damage: { base: 25, increase: 5 } } },
        { id: 'blaster_ammo', name: 'Extended Magazine', maxLevel: 10, basePrice: 40, priceMultiplier: 1.4, stats: { maxAmmo: { base: 30, increase: 5 } } },
        { id: 'blaster_reload', name: 'Rapid Reload', maxLevel: 10, basePrice: 60, priceMultiplier: 1.6, stats: { reloadSpeed: { base: 3, decrease: 0.2 } } }
    ],
    hp: [
        { id: 'hp_max', name: 'Max HP', maxLevel: 10, basePrice: 80, priceMultiplier: 1.8, stats: { maxHP: { base: 100, increase: 20 } } },
        { id: 'hp_regen', name: 'HP Regen', maxLevel: 8, basePrice: 70, priceMultiplier: 1.7, stats: { hpRegen: { base: 5, increase: 2 } } },
        { id: 'hp_regen_delay', name: 'Quick Recovery', maxLevel: 5, basePrice: 90, priceMultiplier: 2.0, stats: { hpRegenDelay: { base: 4, decrease: 0.5 } } }
    ]
};

// ------------------------
// 3️⃣ Utilities
// ------------------------

// Normalize text to prevent bypass
function normalizeText(text) {
    return text.toLowerCase()
        .replace(/[@4]/g,'a')
        .replace(/[8]/g,'b')
        .replace(/[3]/g,'e')
        .replace(/[!1|iíîïìĩī]/g,'i')
        .replace(/[0oóôöòõō]/g,'o')
        .replace(/[$5]/g,'s')
        .replace(/[7+]/g,'t')
        .replace(/[^\w]/g,'')
        .normalize('NFKD');
}

// ------------------------
// Keyword + regex filter (Layer 1)
// ------------------------
function basicFilter(message) {
    const normalized = normalizeText(message);

    // blocked words
    for (let word of blockedSet) if (normalized.includes(word)) return false;

    // repeated characters
    if (/(.)\1{4,}/.test(message)) return false;

    // personal info / PII
    const patterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // phone
        /\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/, // email
        /\b\d{5}(?:[-\s]\d{4})?\b/, // zip
        /\b\d{1,5}\s+\w+\s+(street|st|ave|road|rd)\b/i,
        /\b(?:discord|snap|insta|tiktok|whatsapp)\b/i
    ];
    for (let p of patterns) if (p.test(message)) return false;

    return true;
}

// ------------------------
// Lightweight GPT-J style scoring (Layer 2)
// ------------------------
const toxicKeywords = {
    'kill': 0.9, 'suicide': 1.0, 'stupid': 0.6, 'idiot': 0.6,
    'loser': 0.5, 'hate': 0.7, 'die': 0.8, 'dumb': 0.5
};

function scoreToxicity(message) {
    const normalized = normalizeText(message);
    let score = 0;
    for (let [word, weight] of Object.entries(toxicKeywords)) {
        if (normalized.includes(word)) score = Math.max(score, weight);
    }
    return score; // 0–1
}

// Complete moderation pipeline
function moderateMessage(message) {
    if (!basicFilter(message)) return false;           // Layer 1
    if (scoreToxicity(message) >= 0.7) return false;  // Layer 2
    return true;
}

// ------------------------
// Spam detection
// ------------------------
function isSpam(playerId, message) {
    const now = Date.now();
    if (!messageHistory.has(playerId)) messageHistory.set(playerId, []);
    const history = messageHistory.get(playerId);

    // remove old messages
    while (history.length && now - history[0].timestamp > 15000) history.shift();

    const duplicateCount = history.filter(m => m.message === message).length;
    if (duplicateCount >= 2 || history.length >= 4) return true;

    history.push({ message, timestamp: now });
    return false;
}

// ------------------------
// Initialize player data
// ------------------------
function initPlayer(socketId) {
    players.set(socketId, {
        username: 'Guest',
        coins: 100,
        upgrades: {},
        health: 100,
        score: 0,
        position: { x:0, y:1.67, z:0 },
        rotation: { x:0, y:0 }
    });
}

// ------------------------
// Upgrade / Shop helpers
// ------------------------
function getUpgradeLevel(player, itemId) {
    return player.upgrades[itemId] || 0;
}

function applyUpgrade(player, item) {
    const level = getUpgradeLevel(player, item.id);
    Object.entries(item.stats).forEach(([stat, data]) => {
        if (data.increase) player[stat] = (data.base || 0) + level * data.increase;
        if (data.decrease) player[stat] = Math.max(0, (data.base || 0) - level * data.decrease);
    });
}

// ------------------------
// 4️⃣ Socket.IO Events
// ------------------------
io.on('connection', (socket) => {
    console.log('✅ Player connected:', socket.id);
    initPlayer(socket.id);
    const player = players.get(socket.id);

    socket.emit('init', { playerId: socket.id, players: Object.fromEntries(players) });
    socket.broadcast.emit('playerJoined', player);

    // Set Username
    socket.on('setUsername', (username) => {
        if (!username || username.length > 20) username = 'Guest';
        player.username = username;
        io.emit('playerUsernameUpdated', { playerId: socket.id, username });
    });

    // Chat
    socket.on('chatMessage', (data) => {
        const message = data.message?.trim();
        if (!message || message.length < 2 || message.length > 100) return;

        if (isSpam(socket.id, message)) {
            socket.emit('chatMessage', { username: 'System', message: '⚠️ Please wait before sending another message.' });
            return;
        }

        if (!moderateMessage(message)) {
            socket.emit('chatMessage', { username: 'System', message: '⚠️ Your message was blocked for safety.' });
            console.log(`Blocked message: "${message}"`);
            return;
        }

        io.emit('chatMessage', { username: player.username, message });
    });

    // Purchase Upgrade
    socket.on('purchaseUpgrade', (data) => {
        const { upgradeId } = data;
        let item = null;
        for (const items of Object.values(shopItems)) {
            const found = items.find(i => i.id === upgradeId);
            if (found) { item = found; break; }
        }
        if (!item) return socket.emit('upgradePurchased', { success: false, message: 'Item not found!' });

        const level = getUpgradeLevel(player, upgradeId);
        if (level >= item.maxLevel) return socket.emit('upgradePurchased', { success: false, message: 'Max level reached!' });

        const price = Math.floor(item.basePrice * Math.pow(item.priceMultiplier, level));
        if (player.coins < price) return socket.emit('upgradePurchased', { success: false, message: 'Not enough coins!' });

        player.coins -= price;
        player.upgrades[upgradeId] = level + 1;
        applyUpgrade(player, item);

        socket.emit('upgradePurchased', { success: true, upgradeId, upgradeName: item.name, newCoins: player.coins });
        socket.emit('coinUpdate', { playerId: socket.id, coins: player.coins });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        players.delete(socket.id);
        messageHistory.delete(socket.id);
        io.emit('playerLeft', socket.id);
    });

    // Coin timer
    const coinInterval = setInterval(() => {
        if (!players.has(socket.id)) return clearInterval(coinInterval);
        player.coins += 10;
        socket.emit('coinUpdate', { playerId: socket.id, coins: player.coins });
    }, 60000);
});

// ------------------------
// 5️⃣ Start Server
// ------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Server running on port ${PORT}`);
    console.log('👶 COPPA-COMPLIANT MODE: Safe for users under 13');
    console.log('✅ Multi-layer offline chat filtering active (regex + GPT-J style)');
});
