'use strict';

if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const app     = express();
const http    = require('http').createServer(app);
const io      = require('socket.io')(http, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── CONFIG ────────────────────────────────────────────────────────────────────
const API_URL      = process.env.API_URL      || 'https://shotstrike-api.strike1.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const PORT         = process.env.PORT         || 3000;

// Cloudflare AI moderation
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_KEY    = process.env.CF_API_KEY;
const CF_EMAIL      = process.env.CF_EMAIL;
const CF_MODEL      = '@cf/meta/llama-3-8b-instruct';
const CF_URL        = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;

// ── SERVER-SIDE GUN TABLE (source of truth for damage) ────────────────────────
const GUNS = {
    gun_semi_auto:        { damage: 12 },
    gun_full_auto:        { damage: 7  },
    gun_burst:            { damage: 20 },
    gun_sniper:           { damage: 55 },
    gun_battle_rifle:     { damage: 15 },
    gun_smg:              { damage: 10 },
    gun_lmg:              { damage: 6  },
    gun_shotgun:          { damage: 18 },
    gun_marksman:         { damage: 50 },
    gun_carbine:          { damage: 10 },
    gun_auto_shotgun:     { damage: 5  },
    gun_semi_auto_sniper: { damage: 22 },
    gun_full_auto_sniper: { damage: 13 },
    gun_burst_dmr:        { damage: 32 },
    gun_burst_lmg:        { damage: 12 },
    gun_quadburst:        { damage: 16 },
    gun_burst_carbine:    { damage: 15 },
};

// ── ANTICHEAT CONSTANTS ───────────────────────────────────────────────────────
const AC_MAX_SPEED        = 35;    // units/sec — covers sprint + dash ability
const AC_MAX_Y            = 80;    // above this = fly hack
const AC_MIN_SHOT_GAP_MS  = 38;    // ms — fastest legit gun with lag buffer
const AC_MAX_COINS_PER_MIN = 500;  // coins/min ceiling (legit max ~60)
const AC_WARN_THRESHOLD   = 3;
const AC_KICK_THRESHOLD   = 6;
const AC_BAN_THRESHOLD    = 3;
const AC_WINDOW_MS        = 60000;

// ── ANTICHEAT STATE ───────────────────────────────────────────────────────────
const acState     = {};        // socketId → { lastPos, lastMoveAt, speedStrikes, lastShotAt, violations, coinGainLog, kicked }
const acKickCount = {};        // accountId → number of kicks
const acAdmins    = new Set(); // exempt socket IDs

function acGet(socketId) {
    if (!acState[socketId]) acState[socketId] = {
        lastPos:      null,
        lastMoveAt:   0,
        speedStrikes: 0,
        lastShotAt:   0,
        violations:   [],
        coinGainLog:  [],
        kicked:       false,
    };
    return acState[socketId];
}

function acCleanup(socketId) {
    delete acState[socketId];
    acAdmins.delete(socketId);
}

function acFlag(socketId, accountId, type, detail) {
    if (acAdmins.has(socketId)) return 0;

    const s   = acGet(socketId);
    const now = Date.now();

    s.violations = s.violations.filter(v => now - v.ts < AC_WINDOW_MS);
    s.violations.push({ type, detail, ts: now });

    const count = s.violations.length;
    console.warn(`[AC] ${type} | socket=${socketId} | ${detail} | count=${count}`);

    if (count >= AC_KICK_THRESHOLD && !s.kicked) {
        s.kicked = true;

        if (accountId) {
            acKickCount[accountId] = (acKickCount[accountId] || 0) + 1;

            if (acKickCount[accountId] >= AC_BAN_THRESHOLD) {
                console.error(`[AC] AUTO-BAN | account=${accountId} | kicks=${acKickCount[accountId]}`);
                const sock = io.sockets.sockets.get(socketId);
                if (sock) {
                    sock.emit('banned', { reason: `Anticheat: repeated ${type}` });
                    setTimeout(() => sock.disconnect(true), 1500);
                }
                bannedAccounts.add(accountId);
                fetch(`${API_URL}/ban`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
                    body:    JSON.stringify({ username: accountId, reason: `Anticheat: ${type}`, duration_hours: null }),
                }).catch(e => console.error('[AC] Ban persist failed:', e.message));
                return count;
            }
        }

        console.warn(`[AC] KICK | socket=${socketId}`);
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
            sock.emit('kicked', { reason: `Anticheat: ${type}` });
            setTimeout(() => sock.disconnect(true), 1000);
        }

    } else if (count === AC_WARN_THRESHOLD) {
        console.warn(`[AC] WARN | socket=${socketId} | ${type}`);
    }

    return count;
}

function acCheckMove(socketId, accountId, pos) {
    if (acAdmins.has(socketId)) return true;

    const s   = acGet(socketId);
    const now = Date.now();
    const { x, y, z } = pos;

    if (y > AC_MAX_Y) {
        acFlag(socketId, accountId, 'FLY_HACK', `y=${y.toFixed(1)}`);
        return false;
    }

    if (s.lastPos) {
        const dt = (now - s.lastMoveAt) / 1000;
        if (dt > 0.01 && dt < 2.0) {
            const speed = Math.sqrt(
                Math.pow(x - s.lastPos.x, 2) + Math.pow(z - s.lastPos.z, 2)
            ) / dt;
            if (speed > AC_MAX_SPEED) {
                s.speedStrikes++;
                if (s.speedStrikes >= 3) {
                    acFlag(socketId, accountId, 'SPEED_HACK', `speed=${speed.toFixed(1)}`);
                    s.speedStrikes = 0;
                    return false;
                }
            } else {
                s.speedStrikes = Math.max(0, s.speedStrikes - 1);
            }
        }
    }

    s.lastPos    = { x, y, z };
    s.lastMoveAt = now;
    return true;
}

function acCheckShot(socketId, accountId) {
    if (acAdmins.has(socketId)) return true;

    const s   = acGet(socketId);
    const now = Date.now();
    const gap = now - s.lastShotAt;

    if (s.lastShotAt > 0 && gap < AC_MIN_SHOT_GAP_MS) {
        acFlag(socketId, accountId, 'RAPID_FIRE', `gap=${gap}ms`);
        return false;
    }

    s.lastShotAt = now;
    return true;
}

function acCheckCoinGain(socketId, accountId, amount) {
    if (acAdmins.has(socketId)) return true;

    const s   = acGet(socketId);
    const now = Date.now();

    s.coinGainLog = s.coinGainLog.filter(e => now - e.ts < 60000);
    s.coinGainLog.push({ amount, ts: now });

    const total = s.coinGainLog.reduce((sum, e) => sum + e.amount, 0);
    if (total > AC_MAX_COINS_PER_MIN) {
        acFlag(socketId, accountId, 'COIN_FARM', `coins/min=${total}`);
        return false;
    }

    return true;
}

// ── BAD WORDS ─────────────────────────────────────────────────────────────────
let blockedWords = [];
try {
    const p = path.join(__dirname, 'badwords.txt');
    if (fs.existsSync(p)) {
        blockedWords = fs.readFileSync(p, 'utf-8')
            .split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
        console.log(`✅ Loaded ${blockedWords.length} bad words`);
    }
} catch (e) { console.warn('Could not load badwords.txt'); }

function basicFilter(message) {
    const n = message.toLowerCase()
        .replace(/[@4]/g,'a').replace(/[8]/g,'b').replace(/[3]/g,'e')
        .replace(/[!1|]/g,'i').replace(/[0]/g,'o').replace(/[$5]/g,'s')
        .replace(/[7]/g,'t').replace(/[\s\-_\.]/g,'').replace(/[^\w]/g,'');

    const critical = [
        'nigger','nigga','faggot','fag','retard','rape','suicide','kys',
        'killyourself','sex','porn','xxx','naked','nude','penis','vagina',
        'pedo','pedophile','fuck','fck','shit','bitch','ass','damn','hell'
    ];
    for (const w of [...new Set([...critical, ...blockedWords])]) {
        if (w.length > 2 && n.includes(w)) return false;
    }
    if (/(.)\1{4,}/.test(message)) return false;
    const piPatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
        /\b(?:www\.|http|\.com|\.net|\.org)\b/i,
    ];
    for (const p of piPatterns) { if (p.test(message)) return false; }
    return true;
}

async function moderateMessage(message) {
    if (!CF_API_KEY) return true;
    try {
        const res = await fetch(CF_URL, {
            method:  'POST',
            headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_API_KEY, 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                messages: [
                    { role: 'system', content: 'You are a chat moderator for a kids video game. Respond SAFE or UNSAFE only. Guns and shooter terms are okay.' },
                    { role: 'user',   content: message.substring(0, 200) }
                ]
            })
        });
        const data = await res.json();
        const text = (data?.result?.response || '').trim().toUpperCase();
        return text.includes('SAFE') && !text.includes('UNSAFE');
    } catch { return true; }
}

// ── STATE ─────────────────────────────────────────────────────────────────────
const players        = {};
const playerLoadouts = {};
const playerCoins    = {};
const messageHistory = {};
const playerMode     = {};
const customMatches  = {};
const bannedAccounts = new Set();
const bannedIPs      = new Set();
const godModePlayers = new Set();
const adminSessions  = {};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getIP(socket) {
    return socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || socket.handshake.address;
}

async function isAccountBanned(token) {
    try {
        const res = await fetch(`${API_URL}/ban-check`, { headers: { 'Authorization': `Bearer ${token}` } });
        return await res.json();
    } catch { return { banned: false }; }
}

async function banInDB(username, reason, duration_hours) {
    try {
        await fetch(`${API_URL}/ban`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
            body:    JSON.stringify({ username, reason, duration_hours: duration_hours || null }),
        });
    } catch (e) { console.error('DB ban failed:', e.message); }
}

async function banIPInDB(ip, reason, duration_hours) {
    try {
        await fetch(`${API_URL}/ban-ip`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
            body:    JSON.stringify({ ip, reason, duration_hours: duration_hours || null }),
        });
    } catch (e) { console.error('IP ban failed:', e.message); }
}

async function unbanInDB(username) {
    try {
        await fetch(`${API_URL}/unban`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
            body:    JSON.stringify({ username }),
        });
    } catch (e) { console.error('DB unban failed:', e.message); }
}

async function loadBannedIPs() {
    try {
        const res  = await fetch(`${API_URL}/banned-ips`, { headers: { 'X-Admin-Secret': ADMIN_SECRET } });
        const data = await res.json();
        if (data.ips) { data.ips.forEach(ip => bannedIPs.add(ip)); console.log(`✅ Loaded ${bannedIPs.size} banned IPs`); }
    } catch { console.warn('Could not load banned IPs'); }
}

function isSpam(socketId, message) {
    if (!messageHistory[socketId]) messageHistory[socketId] = [];
    const now    = Date.now();
    const recent = messageHistory[socketId].filter(m => now - m.ts < 15000);
    const same   = recent.filter(m => m.msg.toLowerCase() === message.toLowerCase()).length;
    messageHistory[socketId].push({ msg: message, ts: now });
    if (messageHistory[socketId].length > 10) messageHistory[socketId] = messageHistory[socketId].slice(-10);
    return same >= 2 || recent.length >= 4;
}

function initPlayer(id) {
    if (!playerLoadouts[id]) playerLoadouts[id] = { equippedGun: 'gun_semi_auto' };
    if (!playerCoins[id])    playerCoins[id]    = 0;
}

function generateMatchCode() {
    return Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
}

function broadcastToAudience(socket, event, data) {
    if (playerMode[socket.id] === 'global') socket.broadcast.emit(event, data);
    else if (socket.matchId) socket.to(socket.matchId).emit(event, data);
}

function emitToAudience(socket, event, data) {
    if (playerMode[socket.id] === 'global') io.emit(event, data);
    else if (socket.matchId) io.to(socket.matchId).emit(event, data);
}

function isAdminSocket(socketId) {
    return adminSessions[socketId]?.isAdmin === true;
}

function getOnlinePlayerList() {
    return Object.values(players).map(p => {
        const ac = acState[p.id];
        const now = Date.now();
        const recentViolations = ac ? ac.violations.filter(v => now - v.ts < AC_WINDOW_MS).length : 0;
        return {
            socketId:     p.id,
            username:     p.username,
            health:       p.health,
            score:        p.score,
            kills:        p.kills,
            deaths:       p.deaths,
            coins:        playerCoins[p.id] || 0,
            isAdmin:      adminSessions[p.id]?.isAdmin || false,
            acViolations: recentViolations,
            acKicks:      acKickCount[adminSessions[p.id]?.accountId || ''] || 0,
        };
    });
}

// ── HOMEPAGE ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Shotstrike Server</title>
    <style>body{background:#1a1a1a;color:white;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}h1{color:#60a5fa;}</style>
    </head><body><div><h1>Shotstrike Server</h1><p style="color:#10b981">Online</p>
    <p style="color:#fbbf24">Players: ${Object.keys(players).length}</p></div></body></html>`);
});

// ── SOCKET HANDLER ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    const clientIP = getIP(socket);

    if (bannedIPs.has(clientIP)) {
        socket.emit('banned', { reason: 'Your IP address has been banned.' });
        socket.disconnect(true);
        return;
    }

    console.log(`✅ Connected: ${socket.id} (${clientIP})`);

    playerMode[socket.id] = 'global';
    players[socket.id] = {
        id:             socket.id,
        username:       'Guest',
        position:       { x: 0, y: 1.67, z: 0 },
        rotation:       { x: 0, y: 0 },
        color:          Math.floor(Math.random() * 0xffffff),
        health:         100,
        shield:         0,
        score:          0,
        kills:          0,
        deaths:         0,
        lastDamageTime: Date.now(),
        ip:             clientIP,
    };
    initPlayer(socket.id);

    const globalPlayers = {};
    Object.keys(players).forEach(id => { if (playerMode[id] === 'global') globalPlayers[id] = players[id]; });
    socket.emit('init', { playerId: socket.id, players: globalPlayers });
    socket.emit('playerData', { coins: playerCoins[socket.id], loadout: playerLoadouts[socket.id] });
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // ── AUTHENTICATE ──────────────────────────────────────────────
    socket.on('authenticate', async (data) => {
        const { accountId, token, username } = data;
        if (!accountId || !token) return;

        socket.accountId = accountId;
        socket.authToken  = token;
        adminSessions[socket.id] = { accountId, username: username || 'Guest', isAdmin: false };

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
                until:  banStatus.until ? new Date(banStatus.until).toUTCString() : null,
            });
            setTimeout(() => socket.disconnect(true), 1500);
            return;
        }

        try {
            const res   = await fetch(`${API_URL}/load`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data2 = await res.json();
            if (data2.success && data2.is_admin) {
                adminSessions[socket.id].isAdmin = true;
                acAdmins.add(socket.id);
                socket.emit('adminGranted');
                console.log(`👑 Admin: ${username} (${socket.id})`);
            }
        } catch { /* non-fatal */ }
    });

    // ── USERNAME ──────────────────────────────────────────────────
    socket.on('setUsername', (username) => {
        players[socket.id].username = username;
        if (adminSessions[socket.id]) adminSessions[socket.id].username = username;
        broadcastToAudience(socket, 'playerUsernameUpdated', { playerId: socket.id, username });
    });

    // ── COINS ─────────────────────────────────────────────────────
    socket.on('syncCoins', (data) => {
        // Only accept server-tracked value — never trust client
        socket.emit('coinUpdate', { playerId: socket.id, coins: playerCoins[socket.id] || 0 });
    });

    // ── MOVEMENT ──────────────────────────────────────────────────
    socket.on('move', (data) => {
        if (!players[socket.id]) return;

        if (!acCheckMove(socket.id, socket.accountId || null, data.position)) {
            socket.emit('adminTeleport', { position: players[socket.id].position });
            return;
        }

        players[socket.id].position = data.position;
        players[socket.id].rotation = data.rotation;

        if (data.matchId && customMatches[data.matchId]) {
            socket.to(data.matchId).emit('playerMoved', { playerId: socket.id, position: data.position, rotation: data.rotation });
        } else if (playerMode[socket.id] === 'global') {
            socket.broadcast.emit('playerMoved', { playerId: socket.id, position: data.position, rotation: data.rotation });
        }
    });

    // ── SHOOT ─────────────────────────────────────────────────────
    socket.on('shoot', (data) => {
        if (!acCheckShot(socket.id, socket.accountId || null)) return;
        broadcastToAudience(socket, 'playerShot', { playerId: socket.id, from: data.from, direction: data.direction });
    });

    // ── HIT ───────────────────────────────────────────────────────
    socket.on('hit', (data) => {
        const targetId  = data.targetId;
        const shooterId = socket.id;
        if (!players[targetId] || !players[shooterId] || targetId === shooterId) return;
        if (godModePlayers.has(targetId)) return;

        const equippedGun  = playerLoadouts[shooterId]?.equippedGun || 'gun_semi_auto';
        const damage       = GUNS[equippedGun]?.damage || 12; // always server value

        const target = players[targetId];

        if (target.shield > 0) {
            if (target.shield >= damage) { target.shield -= damage; }
            else { const rem = damage - target.shield; target.shield = 0; target.health -= rem; }
        } else {
            target.health -= damage;
        }
        target.lastDamageTime = Date.now();

        io.to(targetId).emit('playerHit', { targetId, health: target.health, shield: target.shield, damage, shooterId });
        broadcastToAudience(socket, 'playerDamaged', { targetId, shooterId, damage });

        if (target.health <= 0) handleDeath(targetId, shooterId);
    });

    // ── DEATH ─────────────────────────────────────────────────────
    function handleDeath(targetId, killerId) {
        const target = players[targetId];
        const killer = players[killerId];
        if (!target || !killer) return;

        target.health = 100; target.shield = 0;
        target.position = { x: 0, y: 1.67, z: 0 };
        target.deaths++;
        killer.score += 100;
        killer.kills++;

        const coinGain = 50;
        if (acCheckCoinGain(killerId, adminSessions[killerId]?.accountId || null, coinGain)) {
            playerCoins[killerId] = (playerCoins[killerId] || 0) + coinGain;
            io.to(killerId).emit('coinUpdate', { playerId: killerId, coins: playerCoins[killerId] });
        }

        const killerMode = playerMode[killerId];
        const targetMode = playerMode[targetId];
        if (killerMode === 'global' && targetMode === 'global') {
            io.emit('playerDied', { targetId, killerId, killerScore: killer.score });
        } else {
            const targetSock = io.sockets.sockets.get(targetId);
            const room = targetSock?.matchId || null;
            if (room) io.to(room).emit('playerDied', { targetId, killerId, killerScore: killer.score });
        }

        io.emit('scoreUpdate', { playerId: killerId, score: killer.score, kills: killer.kills });
        io.to(targetId).emit('playerRespawn', { health: 100, shield: 0 });
    }

    // ── CHAT ──────────────────────────────────────────────────────
    socket.on('chatMessage', async (data) => {
        const message  = data.message?.trim();
        const username = players[socket.id]?.username || 'Guest';
        if (!message || message.length < 2 || message.length > 100) return;
        if (isSpam(socket.id, message)) { socket.emit('chatMessage', { username: 'System', message: '⚠️ Slow down!' }); return; }
        if (!basicFilter(message))      { socket.emit('chatMessage', { username: 'System', message: '⚠️ Message blocked.' }); return; }
        const safe = await moderateMessage(message);
        if (!safe) { socket.emit('chatMessage', { username: 'System', message: '⚠️ Message blocked.' }); return; }
        emitToAudience(socket, 'chatMessage', { username, message });
    });

    // ── LOADOUT ───────────────────────────────────────────────────
    socket.on('updateLoadout', (loadout) => {
        playerLoadouts[socket.id] = { ...playerLoadouts[socket.id], ...loadout };
        broadcastToAudience(socket, 'playerLoadoutUpdated', { playerId: socket.id, loadout: playerLoadouts[socket.id] });
    });

    // ── HEAL ──────────────────────────────────────────────────────
    socket.on('healPlayer', (data) => {
        const p = players[socket.id];
        if (!p) return;
        p.health = Math.min(100, p.health + (data.amount || 0));
        io.to(socket.id).emit('playerHealthUpdate', { playerId: socket.id, health: p.health });
    });

    // ── SHIELD ────────────────────────────────────────────────────
    socket.on('activateShield', (data) => {
        const p = players[socket.id];
        if (!p) return;
        p.shield = data.shieldAmount || 0;
        broadcastToAudience(socket, 'playerShieldActivated', { playerId: socket.id, shieldAmount: p.shield });
        io.to(socket.id).emit('shieldUpdate', { shield: p.shield });
    });

    // ── MATCHES ───────────────────────────────────────────────────
    socket.on('createMatch', (data) => {
        const matchId   = 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const matchCode = data.private ? generateMatchCode() : null;
        customMatches[matchId] = {
            id: matchId, name: data.name, host: socket.id, hostName: data.host,
            maxPlayers: data.maxPlayers, mode: data.mode, timeLimit: data.timeLimit,
            private: data.private, code: matchCode, players: [socket.id], startTime: Date.now(),
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
        if (!match)                              { socket.emit('matchError', 'Match not found'); return; }
        if (match.private && !data.code)         { socket.emit('matchError', 'Private match'); return; }
        if (match.players.length >= match.maxPlayers) { socket.emit('matchError', 'Match is full'); return; }

        match.players.push(socket.id);
        playerMode[socket.id] = match.id;
        socket.matchId = match.id;
        socket.join(match.id);

        match.players.forEach(pid => { if (pid !== socket.id && players[pid]) socket.emit('playerJoined', players[pid]); });
        socket.to(match.id).emit('playerJoined', players[socket.id]);
        socket.emit('matchJoined', { id: match.id, name: match.name, code: match.code, maxPlayers: match.maxPlayers, mode: match.mode, timeLimit: match.timeLimit, host: match.hostName, players: match.players.length });
        io.to(match.id).emit('matchUpdate', { players: match.players.length });
    });

    socket.on('getMatches', () => {
        socket.emit('matchList', Object.values(customMatches)
            .filter(m => !m.private)
            .map(m => ({ id: m.id, name: m.name, host: m.hostName, players: m.players.length, maxPlayers: m.maxPlayers, mode: m.mode, timeLimit: m.timeLimit })));
    });

    // ── ADMIN ACTIONS ─────────────────────────────────────────────
    socket.on('adminAction', async (data) => {
        if (!isAdminSocket(socket.id)) { socket.emit('adminError', 'Not authorized'); return; }

        const { type, targetId, targetUsername, amount, position, duration, enabled, multiplier, reason, duration_hours, banIP } = data;
        console.log(`👑 Admin ${adminSessions[socket.id].username} → ${type} on ${targetUsername || targetId}`);

        switch (type) {

            case 'getPlayers':
                socket.emit('adminPlayerList', { players: getOnlinePlayerList() });
                break;

            case 'ban': {
                const targetSock  = io.sockets.sockets.get(targetId);
                const targetAccId = targetSock?.accountId;
                if (targetAccId) bannedAccounts.add(targetAccId);
                if (banIP && targetSock) {
                    const tIP = getIP(targetSock);
                    if (tIP && tIP !== '127.0.0.1' && tIP !== '::1') {
                        bannedIPs.add(tIP);
                        await banIPInDB(tIP, reason || 'IP banned by admin', duration_hours || null);
                    }
                }
                if (targetUsername) await banInDB(targetUsername, reason || 'Banned by admin', duration_hours || null);
                if (targetSock) {
                    targetSock.emit('banned', { reason: reason || 'Banned from Shotstrike.', until: duration_hours ? new Date(Date.now() + duration_hours * 3600000).toUTCString() : null });
                    setTimeout(() => targetSock.disconnect(true), 1500);
                }
                Object.keys(adminSessions).forEach(sid => { if (adminSessions[sid].isAdmin) io.to(sid).emit('adminLog', { message: `${adminSessions[socket.id].username} banned ${targetUsername || targetId}` }); });
                break;
            }

            case 'unban': {
                if (targetUsername) {
                    await unbanInDB(targetUsername);
                    bannedAccounts.clear();
                    socket.emit('adminSuccess', `${targetUsername} unbanned`);
                }
                break;
            }

            case 'kick': {
                const ts = io.sockets.sockets.get(targetId);
                if (ts) { ts.emit('kicked', { reason: reason || 'Kicked by admin.' }); setTimeout(() => ts.disconnect(true), 1000); }
                break;
            }

            case 'kill': {
                const p = players[targetId];
                if (p) {
                    p.health = 0; p.deaths++;
                    p.health = 100; p.shield = 0;
                    p.position = { x: 0, y: 1.67, z: 0 };
                    io.emit('playerDied', { targetId, killerId: targetId, killerScore: 0 });
                    io.to(targetId).emit('playerRespawn', { health: 100, shield: 0 });
                    if (data.reason) io.to(targetId).emit('adminKilled', { message: data.reason });
                    socket.emit('adminSuccess', `Killed ${targetUsername}`);
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

            case 'teleport': {
                const p = players[targetId];
                if (p && position) {
                    p.position = position;
                    io.to(targetId).emit('adminTeleport', { position });
                    socket.emit('adminSuccess', `Teleported ${targetUsername}`);
                }
                break;
            }

            case 'teleportToPlayer': {
                const p    = players[targetId];
                const dest = data.destinationId
                    ? players[data.destinationId]
                    : Object.values(players).find(pl => pl.username === data.destinationUsername);
                if (p && dest) {
                    const destPos = { x: dest.position.x + 1, y: dest.position.y, z: dest.position.z };
                    p.position = destPos;
                    io.to(targetId).emit('adminTeleport', { position: destPos });
                    socket.emit('adminSuccess', `Teleported ${targetUsername} to ${dest.username}`);
                } else {
                    socket.emit('adminError', `Player "${data.destinationUsername}" not found`);
                }
                break;
            }

            case 'freeze':
                io.to(targetId).emit('adminFreeze', { duration: duration || 5000 });
                break;

            case 'godMode':
                if (enabled) godModePlayers.add(targetId); else godModePlayers.delete(targetId);
                io.to(targetId).emit('adminGodMode', { enabled });
                break;

            case 'resetStats': {
                const p = players[targetId];
                if (p) { p.score = 0; p.kills = 0; p.deaths = 0; io.to(targetId).emit('adminResetStats', { score: 0 }); }
                break;
            }

            case 'broadcastMessage':
                io.emit('chatMessage', { username: 'Admin', message: data.message || '' });
                break;

            case 'getServerStats':
                socket.emit('adminServerStats', {
                    totalPlayers:   Object.keys(players).length,
                    totalMatches:   Object.keys(customMatches).length,
                    bannedAccounts: bannedAccounts.size,
                    bannedIPs:      bannedIPs.size,
                    uptime:         process.uptime(),
                });
                break;
        }
    });

    // ── DISCONNECT ────────────────────────────────────────────────
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
        acCleanup(socket.id);
    });

    // ── PASSIVE COINS ─────────────────────────────────────────────
    const coinInterval = setInterval(() => {
        if (!players[socket.id]) return;
        const gain = 10;
        if (acCheckCoinGain(socket.id, socket.accountId || null, gain)) {
            playerCoins[socket.id] = (playerCoins[socket.id] || 0) + gain;
            socket.emit('coinUpdate', { playerId: socket.id, coins: playerCoins[socket.id] });
        }
    }, 60000);
    socket.on('disconnect', () => clearInterval(coinInterval));
});

// ── HEALTH REGEN LOOP ─────────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const id in players) {
        const p = players[id];
        if (!p || p.health <= 0 || p.health >= 100) continue;
        if (now - (p.lastDamageTime || 0) < 4000) continue;
        p.health = Math.min(100, p.health + (5 * 50 / 1000));
        io.to(id).emit('playerHealthUpdate', { playerId: id, health: Math.round(p.health) });
    }
}, 50);

// ── MEMORY GC ─────────────────────────────────────────────────────────────────
setInterval(() => {
    const live = new Set(Array.from(io.sockets.sockets.keys()));
    let pruned  = 0;

    for (const id of Object.keys(players)) {
        if (!live.has(id)) {
            delete players[id]; delete playerLoadouts[id]; delete playerCoins[id];
            delete messageHistory[id]; delete playerMode[id]; delete adminSessions[id];
            acCleanup(id);
            pruned++;
        }
    }
    for (const matchId of Object.keys(customMatches)) {
        customMatches[matchId].players = customMatches[matchId].players.filter(id => live.has(id));
        if (customMatches[matchId].players.length === 0) { delete customMatches[matchId]; pruned++; }
    }
    for (const id of Object.keys(messageHistory)) {
        if (messageHistory[id]?.length > 10) messageHistory[id] = messageHistory[id].slice(-10);
    }

    const mem = process.memoryUsage();
    const mb  = v => (v / 1024 / 1024).toFixed(1);
    if (pruned > 0) console.log(`[GC] Pruned ${pruned} stale entries`);
    console.log(`[MEM] rss=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB`);
}, 5 * 60 * 1000);

// ── BOOT ──────────────────────────────────────────────────────────────────────
loadBannedIPs().then(() => {
    http.listen(PORT, () => console.log(`🎮 Shotstrike server on port ${PORT}`));
});
