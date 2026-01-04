const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

/* ================== GAME DATA ================== */

const WEAPONS = {
  pistol: { damage: 20, fireRate: 400 },
  rifle: { damage: 25, fireRate: 120 },
  sniper: { damage: 80, fireRate: 900 }
};

const SKINS = ["default", "red", "blue", "gold"];
const TRAILS = ["default", "laser", "electric"];

const players = {};
const lastHitTime = {};
const lastShot = {};
let playerCount = 0;

/* ================== WEB PAGE ================== */

app.get("/", (req, res) => {
  res.send(`<h1 style="color:white;background:#111;padding:40px;text-align:center">
    🎮 Shotstrike Server Running<br>
    Players online: <span id="count">0</span>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      const s = io();
      s.on("playerCount", c => document.getElementById("count").textContent = c);
    </script>
  </h1>`);
});

/* ================== SOCKET LOGIC ================== */

io.on("connection", (socket) => {
  playerCount++;
  io.emit("playerCount", playerCount);

  const id = socket.id;

  players[id] = {
    id,
    position: { x: 0, y: 1.6, z: 15 },
    rotation: { x: 0, y: 0 },
    health: 100,
    score: 0,
    username: `Guest${Math.floor(Math.random() * 9999)}`,
    weapon: "rifle",
    skin: "default",
    trail: "default",
    isImmune: true,
    isDead: false,
    visible: true
  };

  setTimeout(() => {
    if (players[id]) players[id].isImmune = false;
  }, 3000);

  socket.emit("init", { playerId: id, players });
  socket.broadcast.emit("playerJoined", players[id]);

  socket.on("setUsername", (name) => {
    if (!players[id]) return;
    players[id].username = name.substring(0, 16);
    io.emit("playerUsernameUpdated", { playerId: id, username: players[id].username });
  });

  socket.on("equipWeapon", (weapon) => {
    if (WEAPONS[weapon] && players[id]) {
      players[id].weapon = weapon;
      io.emit("playerWeaponUpdate", { playerId: id, weapon });
    }
  });

  socket.on("equipCosmetics", ({ skin, trail }) => {
    if (!players[id]) return;
    if (SKINS.includes(skin)) players[id].skin = skin;
    if (TRAILS.includes(trail)) players[id].trail = trail;
    io.emit("playerCosmeticsUpdate", { playerId: id, skin, trail });
  });

  socket.on("move", (data) => {
    if (!players[id]) return;
    players[id].position = data.position;
    players[id].rotation = data.rotation;
    socket.broadcast.emit("playerMoved", { playerId: id, ...data });
  });

  socket.on("shoot", (data) => {
    lastShot[id] = Date.now();
    socket.broadcast.emit("playerShot", {
      playerId: id,
      from: data.from,
      direction: data.direction,
      trail: players[id].trail,
      weapon: players[id].weapon
    });
  });

  socket.on("hit", ({ targetId }) => {
    const attacker = players[id];
    const target = players[targetId];
    if (!attacker || !target) return;
    if (target.isDead || target.isImmune) return;

    const now = Date.now();
    if (lastHitTime[id] && now - lastHitTime[id] < 150) return;
    if (!lastShot[id] || now - lastShot[id] > 200) return;
    lastHitTime[id] = now;

    const weapon = WEAPONS[attacker.weapon];
    target.health -= weapon.damage;
    attacker.score += 10;

    if (target.health <= 0) {
      target.health = 0;
      target.isDead = true;
      target.visible = false;

      io.emit("playerVisibilityUpdate", { playerId: targetId, visible: false });
      io.emit("playerDied", { targetId, killerId: id });

      setTimeout(() => {
        if (!players[targetId]) return;
        Object.assign(players[targetId], {
          health: 100,
          isDead: false,
          isImmune: true,
          visible: true,
          position: { x: 0, y: 1.6, z: 15 }
        });

        io.emit("playerMoved", {
          playerId: targetId,
          position: players[targetId].position,
          rotation: players[targetId].rotation
        });

        io.emit("playerVisibilityUpdate", { playerId: targetId, visible: true });
        io.emit("playerHit", { targetId, health: 100 });

        setTimeout(() => {
          if (players[targetId]) players[targetId].isImmune = false;
        }, 3000);
      }, 3000);
    }

    io.emit("playerHit", { targetId, health: target.health });
    io.emit("scoreUpdate", { playerId: id, score: attacker.score });
  });

  socket.on("disconnect", () => {
    delete players[id];
    playerCount--;
    io.emit("playerLeft", id);
    io.emit("playerCount", playerCount);
  });
});

server.listen(PORT, () =>
  console.log(`🚀 Shotstrike server running on port ${PORT}`)
);
