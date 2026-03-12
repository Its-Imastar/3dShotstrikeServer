if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// ── CONFIG ───────────────────────────────────────────────────────────────────
const API_URL      = process.env.API_URL      || 'https://shotstrike-api.strike1.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

// Cloudflare AI for chat moderation
const CLOUDFLARE_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CLOUDFLARE_API_KEY    = process.env.CF_API_KEY;
const CLOUDFLARE_EMAIL      = process.env.CF_EMAIL;
const CF_MODEL = '@cf/meta/llama-3-8b-instruct';
const CF_URL   = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CF_MODEL}`;

// ── BAD WORDS ────────────────────────────────────────────────────────────────
let blockedWordsFromFile = [];
try {
    const badWordsPath = path.join(__dirname, 'badwords.txt');
    if (fs.existsSync(badWordsPath)) {
        blockedWordsFromFile = fs.readFileSync(badWordsPath, 'utf-8')
            .split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
        console.log(`✅ Loaded ${blockedWordsFromFile.length} bad words`);
    }
} catch (e) { console.warn('Could not load badwords.txt'); }

// ── CHAT FILTER ──────────────────────────────────────────────────────────────
const basicFilter = (message) => {
    const normalized = message.toLowerCase()
        .replace(/[@4]/g, 'a').replace(/[8]/g, 'b').replace(/[3]/g, 'e')
        .replace(/[!1|]/g, 'i').replace(/[0]/g, 'o').replace(/[$5]/g, 's')
        .replace(/[7]/g, 't').replace(/[\s\-_\.]/g, '').replace(/[^\w]/g, '');

    const criticalWords = [
        'nigger','nigga','faggot','fag','retard','rape','suicide','kys',
        'killyourself','sex','porn','xxx','naked','nude','penis','vagina',
        'pedo','pedophile','fuck','fck','shit','bitch','ass','damn','hell'
    ];
    const allBlocked = [...new Set([...criticalWords, ...blockedWordsFromFile])];
    for (let word of allBlocked) {
        if (word.length > 2 && normalized.includes(word)) return false;
    }
    if (/(.)\1{4,}/.test(message)) return false;
    const piPatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
        /\b(?:www\.|http|\.com|\.net|\.org)\b/i,
    ];
    for (let p of piPatterns) { if (p.test(message)) return false; }
    return true;
};

async function moderateMessage(message) {
    if (!CLOUDFLARE_API_KEY) return true;
    try {
        const res = await fetch(CF_URL, {
            method: 'POST',
            headers: {
                'X-Auth-Email': CLOUDFLARE_EMAIL,
                'X-Auth-Key': CLOUDFLARE_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: 'You are a chat moderator for a kids video game. Respond with only SAFE or UNSAFE.' },
                    { role: 'user', content: message.substring(0, 200) }
                ]
            })
        });
        const data = await res.json();
        const text = (data?.result?.response || '').trim().toUpperCase();
        return text.includes('SAFE') && !text.includes('UNSAFE');
    } catch (e) {
        return true;
    }
}

// ── STATE ────────────────────────────────────────────────────────────────────
const players        = {};
const playerLoadouts = {};
const playerCoins    = {};
const messageHistory = {};
const playerMode     = {};
const customMatches  = {};
const activeGrenades = {};

// Ban state
const bannedAccounts = new Set(); // account ID cache
const bannedIPs      = new Set(); // IP cache
const godModePlayers = new Set();

// Admin state — maps socket.id → { accountId, username, isAdmin }
const adminSessions  = {};

// ── HELPERS ──────────────────────────────────────────────────────────────────
function getClientIP(socket) {
    return (
        socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        socket.handshake.address
    );
}

async function isAccountBanned(token) {
    try {
        const res  = await fetch(`${API_URL}/ban-check`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return await res.json();
    } catch (e) {
        return { banned: false };
    }
}

async function banInDatabase(username, reason, duration_hours) {
    try {
        await fetch(`${API_URL}/ban`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Secret': ADMIN_SECRET
            },
            body: JSON.stringify({ username, reason, duration_hours: duration_hours || null })
        });
    } catch (e) {
        console.error('DB ban failed:', e.message);
    }
}

async function banIPInDatabase(ip, reason, duration_hours) {
    try {
        await fetch(`${API_URL}/ban-ip`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Secret': ADMIN_SECRET
            },
            body: JSON.stringify({ ip, reason, duration_hours: duration_hours || null })
        });
    } catch (e) { console.error('IP ban DB failed:', e.message); }
}

async function loadBannedIPsFromDB() {
    try {
        const res = await fetch(`${API_URL}/banned-ips`, {
            headers: { 'X-Admin-Secret': ADMIN_SECRET }
        });
        const data = await res.json();
        if (data.ips) {
            data.ips.forEach(ip => bannedIPs.add(ip));
            console.log(`✅ Loaded ${bannedIPs.size} banned IPs from DB`);
        }
    } catch (e) { console.warn('Could not load banned IPs from DB'); }
}

async function unbanInDatabase(username) {
    try {
        await fetch(`${API_URL}/unban`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Secret': ADMIN_SECRET
            },
            body: JSON.stringify({ username })
        });
    } catch (e) {
        console.error('DB unban failed:', e.message);
    }
}

loadBannedIPsFromDB();

function isSpam(playerId, message) {
    if (!messageHistory[playerId]) messageHistory[playerId] = [];
    const now = Date.now();
    const recent = messageHistory[playerId].filter(m => now - m.timestamp < 15000);
    const sameCount = recent.filter(m => m.message.toLowerCase() === message.toLowerCase()).length;
    messageHistory[playerId].push({ message, timestamp: now });
    if (messageHistory[playerId].length > 10)
        messageHistory[playerId] = messageHistory[playerId].slice(-10);
    if (sameCount >= 2) return true;
    if (recent.length >= 4) return true;
    return false;
}

function initPlayerData(id) {
    if (!playerLoadouts[id]) playerLoadouts[id] = { equippedGun: 'gun_semi_auto', equippedAbilities: [], equippedPerk: null };
    if (!playerCoins[id]) playerCoins[id] = 0;
}

function generateMatchCode() {
    return Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
}

// Broadcast to the right audience (global or match room)
function broadcastToAudience(socket, event, data) {
    if (playerMode[socket.id] === 'global') {
        socket.broadcast.emit(event, data);
    } else if (socket.matchId) {
        socket.to(socket.matchId).emit(event, data);
    }
}

function emitToAudience(socket, event, data) {
    if (playerMode[socket.id] === 'global') {
        io.emit(event, data);
    } else if (socket.matchId) {
        io.to(socket.matchId).emit(event, data);
    }
}

// ── ADMIN HELPERS ────────────────────────────────────────────────────────────
function isAdmin(socketId) {
    return adminSessions[socketId]?.isAdmin === true;
}

function getOnlinePlayerList() {
    return Object.values(players).map(p => ({
        socketId:  p.id,
        username:  p.username,
        health:    p.health,
        score:     p.score,
        kills:     p.kills,
        deaths:    p.deaths,
        coins:     playerCoins[p.id] || 0,
        mode:      playerMode[p.id] || 'global',
        isAdmin:   adminSessions[p.id]?.isAdmin || false,
    }));
}

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Shotstrike Server</title>
            <style>
                body { background: #1a1a1a; color: white; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
                h1 { color: #60a5fa; font-size: 2.5em; }
                .status { color: #10b981; font-size: 1.2em; }
                .players { color: #fbbf24; font-size: 1.1em; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div>
                <h1>🎮 Shotstrike Server</h1>
                <p class="status">✅ Online</p>
                <p class="players">👥 Players online: ${Object.keys(players).length}</p>
                <p style="color:#6b7280; margin-top:20px;">Play at <a href="https://shotstrike.com" style="color:#60a5fa;">shotstrike.com</a></p>
            </div>
        </body>
        </html>
    `);
});

// ── SOCKET HANDLER ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    const clientIP = getClientIP(socket);

    // ── IP BAN CHECK ─────────────────────────────────────────────────
    if (bannedIPs.has(clientIP)) {
        socket.emit('banned', { reason: 'Your IP address has been banned.' });
        socket.disconnect(true);
        return;
    }

    console.log(`✅ Connected: ${socket.id} (${clientIP})`);

    playerMode[socket.id] = 'global';
    players[socket.id] = {
        id: socket.id, username: 'Guest',
        position: { x: 0, y: 1.67, z: 0 }, rotation: { x: 0, y: 0 },
        color: Math.floor(Math.random() * 0xffffff),
        health: 100, shield: 0, score: 0, kills: 0, deaths: 0,
        lastDamageTime: Date.now(), ip: clientIP,
    };
    initPlayerData(socket.id);

    // Send existing global players
    const globalPlayers = {};
    Object.keys(players).forEach(id => {
        if (playerMode[id] === 'global') globalPlayers[id] = players[id];
    });
    socket.emit('init', { playerId: socket.id, players: globalPlayers });
    socket.emit('playerData', { coins: playerCoins[socket.id], loadout: playerLoadouts[socket.id] });
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // ── AUTHENTICATE ─────────────────────────────────────────────────
    socket.on('authenticate', async (data) => {
        const { accountId, token, username } = data;
        if (!accountId || !token) return;

        socket.accountId = accountId;
        socket.authToken  = token;

        // Cache username for admin display
        adminSessions[socket.id] = {
            accountId,
            username: username || players[socket.id]?.username || 'Guest',
            isAdmin:  false,
        };

        // Check account ban
        if (bannedAccounts.has(accountId)) {
            socket.emit('banned', { reason: 'Your account has been banned.' });
            setTimeout(() => socket.disconnect(true), 1500);
            return;
        }

        const banStatus = await isAccountBanned(token);
        if (banStatus.banned) {
            bannedAccounts.add(accountId);
            socket.emit('banned', {
                reason: banStatus.reason || 'You have been banned.',
                until:  banStatus.until ? new Date(banStatus.until).toUTCString() : null
            });
            setTimeout(() => socket.disconnect(true), 1500);
            return;
        }

        // Check admin status from API
        try {
            const res  = await fetch(`${API_URL}/load`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data2 = await res.json();
            if (data2.success && data2.is_admin) {
                adminSessions[socket.id].isAdmin = true;
                socket.emit('adminGranted');
                console.log(`👑 Admin authenticated: ${username} (${socket.id})`);
            }
        } catch (e) { /* non-fatal */ }
    });

    // ── USERNAME ─────────────────────────────────────────────────────
    socket.on('setUsername', (username) => {
        players[socket.id].username = username;
        if (adminSessions[socket.id]) adminSessions[socket.id].username = username;
        broadcastToAudience(socket, 'playerUsernameUpdated', { playerId: socket.id, username });
    });

    // ── COINS ────────────────────────────────────────────────────────
    socket.on('syncCoins', (data) => {
        // Only accept if higher than current (prevents going backward)
        // Server is still source of truth for kills/rewards
        const incoming = typeof data === 'object' ? data.coins : data;
        if (typeof incoming === 'number' && incoming > (playerCoins[socket.id] || 0)) {
            playerCoins[socket.id] = incoming;
        }
        socket.emit('coinUpdate', { playerId: socket.id, coins: playerCoins[socket.id] });
    });

    // ── MOVEMENT ─────────────────────────────────────────────────────
    socket.on('move', (data) => {
        if (!players[socket.id]) return;
        players[socket.id].position = data.position;
        players[socket.id].rotation = data.rotation;
        if (data.matchId && customMatches[data.matchId]) {
            socket.to(data.matchId).emit('playerMoved', { playerId: socket.id, position: data.position, rotation: data.rotation });
        } else if (playerMode[socket.id] === 'global') {
            socket.broadcast.emit('playerMoved', { playerId: socket.id, position: data.position, rotation: data.rotation });
        }
    });

    // ── SHOOT ────────────────────────────────────────────────────────
    socket.on('shoot', (data) => {
        broadcastToAudience(socket, 'playerShot', { playerId: socket.id, from: data.from, direction: data.direction });
    });

    // ── HIT (server-authoritative damage) ────────────────────────────
    socket.on('hit', (data) => {
        const targetId  = data.targetId;
        const shooterId = socket.id;
        if (!players[targetId] || !players[shooterId] || targetId === shooterId) return;
        if (godModePlayers.has(targetId)) return;
        const targetPlayer = players[targetId];
        const loadout      = playerLoadouts[shooterId];

        // Look up damage from gun definition — never trust client
const GUNS = {
    'gun_semi_auto':        { damage: 12 },
    'gun_full_auto':        { damage: 7  },
    'gun_burst':            { damage: 20 },
    'gun_sniper':           { damage: 55 },
    'gun_battle_rifle':     { damage: 15 },
    'gun_smg':              { damage: 10 },
    'gun_lmg':              { damage: 6  },
    'gun_shotgun':          { damage: 18 },
    'gun_marksman':         { damage: 50 },
    'gun_carbine':          { damage: 10 },
    'gun_auto_shotgun':     { damage: 5  },
    'gun_semi_auto_sniper': { damage: 22 },
    'gun_full_auto_sniper': { damage: 13 },
    'gun_burst_dmr':        { damage: 32 },
    'gun_burst_lmg':        { damage: 12 },
    'gun_quadburst':        { damage: 16 },
    'gun_burst_carbine':    { damage: 15 },
};

        const equippedGun = loadout?.equippedGun || 'gun_semi_auto';
        const clientDamage = typeof data.damage === 'number' ? data.damage : null;
        const baseDamage   = GUNS[equippedGun]?.damage || 12;
        
        // Trust client damage only if it's within a reasonable range of the server value
        // This allows pellet counts and upgrades while preventing cheating
        let damage = (clientDamage && clientDamage <= baseDamage * 3 && clientDamage > 0)
            ? clientDamage
            : baseDamage;
        if (loadout?.equippedPerk === 'perk_tank') damage = Math.round(damage * 0.85);

        if (targetPlayer.shield > 0) {
            if (targetPlayer.shield >= damage) { targetPlayer.shield -= damage; damage = 0; }
            else { damage -= targetPlayer.shield; targetPlayer.shield = 0; }
        }
        targetPlayer.health -= damage;
        targetPlayer.lastDamageTime = Date.now();

        io.to(targetId).emit('playerHit', {
            targetId, health: targetPlayer.health, shield: targetPlayer.shield,
            damage, shooterId
        });
        broadcastToAudience(socket, 'playerDamaged', { targetId, shooterId, damage });

        if (targetPlayer.health <= 0) handlePlayerDeath(targetId, shooterId);
    });

    // ── DEATH ────────────────────────────────────────────────────────
    function handlePlayerDeath(targetId, killerId) {
        const target = players[targetId];
        const killer = players[killerId];
        if (!target || !killer) return;
    
        target.health = 100; target.shield = 0;
        target.position = { x: 0, y: 1.67, z: 0 };
        target.deaths += 1;
        killer.score  += 100;
        killer.kills  += 1;
        playerCoins[killerId] = (playerCoins[killerId] || 0) + 50;
    
        const killerMode = playerMode[killerId];
        const targetMode = playerMode[targetId];
        if (killerMode === 'global' && targetMode === 'global') {
            io.emit('playerDied', { targetId, killerId, killerScore: killer.score });
        } else {
            // FIX: look up the target's match room, not socket.matchId
            const targetSocket = io.sockets.sockets.get(targetId);
            const room = targetSocket?.matchId || null;
            if (room) io.to(room).emit('playerDied', { targetId, killerId, killerScore: killer.score });
        }
        io.emit('scoreUpdate', { playerId: killerId, score: killer.score, kills: killer.kills });
        io.to(killerId).emit('coinUpdate',  { playerId: killerId, coins: playerCoins[killerId] });
        io.to(targetId).emit('playerRespawn', { health: 100, shield: 0 });
    }

    // ── GRENADE ──────────────────────────────────────────────────────
    socket.on('throwGrenade', (data) => {
        const id = 'grenade_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        activeGrenades[id] = { id, position: data.position, velocity: data.velocity, thrownBy: socket.id };
        broadcastToAudience(socket, 'grenadeThrown', { grenadeId: id, position: data.position, velocity: data.velocity, thrownBy: socket.id });
    });
    socket.on('grenadeExploded', (data) => {
        broadcastToAudience(socket, 'grenadeExploded', { position: data.position, thrownBy: data.thrownBy });
    });
    socket.on('grenadeDamage', (data) => {
        const target = players[data.targetId];
        if (!target) return;
        const damage = Math.min(data.damage, 100); // cap at 100
        target.health -= damage;
        io.to(data.targetId).emit('playerHit', { targetId: data.targetId, health: target.health, damage, shooterId: data.thrownBy });
        if (target.health <= 0) handlePlayerDeath(data.targetId, data.thrownBy);
    });

    // ── CHAT ─────────────────────────────────────────────────────────
    socket.on('chatMessage', async (data) => {
        const message  = data.message.trim();
        const username = players[socket.id]?.username || 'Guest';
        if (!message || message.length < 2 || message.length > 100) return;
        if (isSpam(socket.id, message)) {
            socket.emit('chatMessage', { username: 'System', message: '⚠️ Slow down!' });
            return;
        }
        const safe = await moderateMessage(message);
        if (!safe) {
            socket.emit('chatMessage', { username: 'System', message: '⚠️ Message blocked.' });
            return;
        }
        emitToAudience(socket, 'chatMessage', { username, message });
    });

    // ── LOADOUT ──────────────────────────────────────────────────────
    socket.on('updateLoadout', (loadout) => {
        playerLoadouts[socket.id] = { ...playerLoadouts[socket.id], ...loadout };
        broadcastToAudience(socket, 'playerLoadoutUpdated', { playerId: socket.id, loadout: playerLoadouts[socket.id] });
    });

    // ── HEAL ─────────────────────────────────────────────────────────
    socket.on('healPlayer', (data) => {
        const p = players[socket.id];
        if (!p) return;
        p.health = Math.min(100, p.health + (data.amount || 0));
        io.to(socket.id).emit('playerHealthUpdate', { playerId: socket.id, health: p.health });
    });

    // ── SHIELD ───────────────────────────────────────────────────────
    socket.on('activateShield', (data) => {
        const p = players[socket.id];
        if (!p) return;
        p.shield = data.shieldAmount || 0;
        broadcastToAudience(socket, 'playerShieldActivated', { playerId: socket.id, shieldAmount: p.shield });
        io.to(socket.id).emit('shieldUpdate', { shield: p.shield });
    });

    // ── MATCHES ──────────────────────────────────────────────────────
    socket.on('createMatch', (data) => {
        const matchId   = 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const matchCode = data.private ? generateMatchCode() : null;
        customMatches[matchId] = {
            id: matchId, name: data.name, host: socket.id, hostName: data.host,
            maxPlayers: data.maxPlayers, mode: data.mode, timeLimit: data.timeLimit,
            private: data.private, code: matchCode, players: [socket.id], startTime: Date.now()
        };
        playerMode[socket.id] = matchId;
        socket.matchId = matchId;
        socket.join(matchId);
        socket.emit('matchCreated', { id: matchId, name: data.name, code: matchCode, maxPlayers: data.maxPlayers, mode: data.mode, timeLimit: data.timeLimit, host: data.host, players: 1 });
    });

    socket.on('joinMatch', (data) => {
        let match = data.code
            ? Object.values(customMatches).find(m => m.code === data.code)
            : customMatches[data.matchId];
        if (!match)               { socket.emit('matchError', 'Match not found'); return; }
        if (match.private && !data.code) { socket.emit('matchError', 'Private match'); return; }
        if (match.players.length >= match.maxPlayers) { socket.emit('matchError', 'Match is full'); return; }

        match.players.push(socket.id);
        playerMode[socket.id] = match.id;
        socket.matchId = match.id;
        socket.join(match.id);

        match.players.forEach(pid => {
            if (pid !== socket.id && players[pid])
                socket.emit('playerJoined', players[pid]);
        });
        socket.to(match.id).emit('playerJoined', players[socket.id]);
        socket.emit('matchJoined', { id: match.id, name: match.name, code: match.code, maxPlayers: match.maxPlayers, mode: match.mode, timeLimit: match.timeLimit, host: match.hostName, players: match.players.length });
        io.to(match.id).emit('matchUpdate', { players: match.players.length });
    });

    socket.on('getMatches', () => {
        socket.emit('matchList', Object.values(customMatches)
            .filter(m => !m.private)
            .map(m => ({ id: m.id, name: m.name, host: m.hostName, players: m.players.length, maxPlayers: m.maxPlayers, mode: m.mode, timeLimit: m.timeLimit })));
    });

    // ── ADMIN ACTIONS ────────────────────────────────────────────────
    socket.on('adminAction', async (data) => {
        // Every admin action must be verified
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', 'Not authorized');
            console.warn(`⚠️ Non-admin ${socket.id} attempted adminAction: ${data.type}`);
            return;
        }

        const { type, targetId, targetUsername, amount, position, duration, enabled, multiplier, reason, duration_hours, banIP } = data;
        console.log(`👑 Admin ${adminSessions[socket.id].username} → ${type} on ${targetUsername || targetId}`);

        switch (type) {

            case 'getPlayers':
                socket.emit('adminPlayerList', { players: getOnlinePlayerList() });
                break;

            case 'ban': {
                const targetSocket = io.sockets.sockets.get(targetId);
                const targetAccId  = targetSocket?.accountId;

                if (targetAccId) bannedAccounts.add(targetAccId);

                if (banIP && targetSocket) {
                    const tIP = getClientIP(targetSocket);
                    if (tIP && tIP !== '127.0.0.1' && tIP !== '::1') {
                        bannedIPs.add(tIP);
                        await banIPInDatabase(tIP, reason || 'IP banned by admin', duration_hours || null);
                        console.log(`🚫 IP banned: ${tIP}`);
                    } else {
                        socket.emit('adminError', 'Could not determine real IP - IP ban skipped');
                    }
                }

                if (targetUsername) {
                    await banInDatabase(targetUsername, reason || 'Banned by admin', duration_hours || null);
                }

                if (targetSocket) {
                    targetSocket.emit('banned', {
                        reason: reason || 'You have been banned from Shotstrike.',
                        until:  duration_hours
                            ? new Date(Date.now() + duration_hours * 3600000).toUTCString()
                            : null
                    });
                    setTimeout(() => targetSocket.disconnect(true), 1500);
                }

                // Notify all admins
                Object.keys(adminSessions).forEach(sid => {
                    if (adminSessions[sid].isAdmin)
                        io.to(sid).emit('adminLog', { message: `${adminSessions[socket.id].username} banned ${targetUsername || targetId}` });
                });
                break;
            }

            case 'unban': {
                if (targetUsername) {
                    await unbanInDatabase(targetUsername);
                    
                    // Find and remove their accountId from the in-memory cache
                    // Search all sockets and adminSessions for a matching username
                    for (const [sid, session] of Object.entries(adminSessions)) {
                        if (session.username === targetUsername) {
                            bannedAccounts.delete(session.accountId);
                            break;
                        }
                    }
                    
                    // Also search players object
                    for (const p of Object.values(players)) {
                        if (p.username === targetUsername) {
                            // Find their socket to get accountId
                            const ps = io.sockets.sockets.get(p.id);
                            if (ps?.accountId) bannedAccounts.delete(ps.accountId);
                            break;
                        }
                    }
                    
                    // Clear the entire bannedAccounts cache as a fallback
                    // (safe since it gets repopulated on reconnect via the DB check)
                    bannedAccounts.clear();
                    
                    socket.emit('adminSuccess', `${targetUsername} unbanned`);
                }
                break;
            }
            case 'kick': {
                const ts = io.sockets.sockets.get(targetId);
                if (ts) {
                    ts.emit('kicked', { reason: reason || 'Kicked by an admin.' });
                    setTimeout(() => ts.disconnect(true), 1000);
                }
                break;
            }
            case 'kill': {
                const p = players[targetId];
                if (p) {
                    // Directly kill without needing a valid "killer" player
                    p.health = 0;
                    p.deaths += 1;
                    p.health = 100;
                    p.shield = 0;
                    p.position = { x: 0, y: 1.67, z: 0 };
                    
                    io.emit('playerDied', { targetId, killerId: targetId, killerScore: 0 });
                    io.to(targetId).emit('playerRespawn', { health: 100, shield: 0 });
                    
                    if (data.reason) {
                        io.to(targetId).emit('adminKilled', { message: data.reason });
                    }
                    
                    socket.emit('adminSuccess', `Killed ${data.targetUsername}`);
                } else {
                    socket.emit('adminError', 'Player not found');
                }
                break;
            }
            case 'heal': {
                const p = players[targetId];
                if (p) { p.health = 100; p.shield = 0; io.to(targetId).emit('adminHeal', { health: 100 }); }
                break;
            }

            case 'giveCoins': {
                playerCoins[targetId] = (playerCoins[targetId] || 0) + (amount || 0);
                io.to(targetId).emit('coinUpdate', { playerId: targetId, coins: playerCoins[targetId] });
                break;
            }

            case 'setHealth': {
                const p = players[targetId];
                if (p) { p.health = Math.max(0, Math.min(100, amount || 100)); io.to(targetId).emit('adminSetHealth', { health: p.health }); }
                break;
            }

            case 'teleportToPlayer': {
                const p = players[targetId];
                const destPlayer = data.destinationId
                    ? players[data.destinationId]
                    : Object.values(players).find(pl => pl.username === data.destinationUsername);
                if (p && destPlayer) {
                    // Offset by 1 on X so they don't perfectly overlap
                    const destPos = {
                        x: destPlayer.position.x + 1,
                        y: destPlayer.position.y,
                        z: destPlayer.position.z
                    };
                    p.position = destPos;
                    io.to(targetId).emit('adminTeleport', { position: destPos });
                    socket.emit('adminSuccess', `Teleported ${data.targetUsername} to ${destPlayer.username}`);
                } else {
                    socket.emit('adminError', `Destination player "${data.destinationUsername}" not found`);
                }
                break;
            }

            case 'teleport': {
                const p = players[targetId];
                if (p && position) {
                    p.position = position;
                    io.to(targetId).emit('adminTeleport', { position });
                    socket.emit('adminSuccess', `Teleported ${data.targetUsername} to (${position.x}, ${position.y}, ${position.z})`);
                } else {
                    socket.emit('adminError', 'Player or position not found');
                }
                break;
            }

            case 'freeze': {
                io.to(targetId).emit('adminFreeze', { duration: duration || 5000 });
                break;
            }

            case 'godMode': {
                if (enabled) {
                    godModePlayers.add(targetId);
                } else {
                    godModePlayers.delete(targetId);
                }
                io.to(targetId).emit('adminGodMode', { enabled });
                break;
            }

            case 'resetStats': {
                const p = players[targetId];
                if (p) { p.score = 0; p.kills = 0; p.deaths = 0; io.to(targetId).emit('adminResetStats', { score: 0 }); }
                break;
            }

            case 'speedMultiplier': {
                io.to(targetId).emit('adminSpeedMultiplier', { multiplier: multiplier || 1.0 });
                break;
            }

            case 'broadcastMessage': {
                io.emit('chatMessage', { username: '📢 Admin', message: data.message || '' });
                break;
            }

            case 'getServerStats': {
                socket.emit('adminServerStats', {
                    totalPlayers:  Object.keys(players).length,
                    totalMatches:  Object.keys(customMatches).length,
                    bannedAccounts: bannedAccounts.size,
                    bannedIPs:     bannedIPs.size,
                    uptime:        process.uptime(),
                });
                break;
            }
        }
    });

    // ── DISCONNECT ───────────────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`❌ Disconnected: ${socket.id}`);

        if (playerMode[socket.id] === 'global') {
            io.emit('playerLeft', socket.id);
        } else if (socket.matchId && customMatches[socket.matchId]) {
            io.to(socket.matchId).emit('playerLeft', socket.id);
            const match = customMatches[socket.matchId];
            match.players = match.players.filter(p => p !== socket.id);
            if (match.players.length === 0) delete customMatches[socket.matchId];
            else io.to(socket.matchId).emit('matchUpdate', { players: match.players.length });
        }

        delete players[socket.id];
        delete playerLoadouts[socket.id];
        delete playerCoins[socket.id];
        delete messageHistory[socket.id];
        delete playerMode[socket.id];
        delete adminSessions[socket.id];
    });

    // Passive coins — single interval cleared on disconnect
    const coinInterval = setInterval(() => {
        if (players[socket.id]) {
            playerCoins[socket.id] = (playerCoins[socket.id] || 0) + 10;
            socket.emit('coinUpdate', { playerId: socket.id, coins: playerCoins[socket.id] });
        }
    }, 60000);
    socket.on('disconnect', () => clearInterval(coinInterval));
});

// Global health regen loop — smooth, runs every 50ms for all players
const REGEN_RATE = 5;      // HP per second
const REGEN_TICK = 50;     // ms between ticks
const REGEN_DELAY = 4000;  // ms after damage before regen starts

setInterval(() => {
    const now = Date.now();
    for (const id in players) {
        const p = players[id];
        if (!p || p.health <= 0 || p.health >= 100) continue;
        if (now - (p.lastDamageTime || 0) < REGEN_DELAY) continue;
        p.health = Math.min(100, p.health + (REGEN_RATE * REGEN_TICK / 1000));
        io.to(id).emit('playerHealthUpdate', { playerId: id, health: Math.round(p.health) });
    }
}, REGEN_TICK);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🎮 Shotstrike server on port ${PORT}`);
});
