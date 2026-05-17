const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 8080;
const clients = new Map();
let messageHistory = [];
const dmHistory = {};

function genId() { return Math.random().toString(36).slice(2, 9); }
function genTag() { return '#' + String(Math.floor(Math.random() * 9000) + 1000); }
const AV_COLORS = ['ac1','ac2','ac3','ac4','ac5','ac6','ac7','ac8'];
function genAv() { return AV_COLORS[Math.floor(Math.random() * AV_COLORS.length)]; }
function dmKey(a, b) { return [a, b].sort().join(':'); }

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocketServer({ server });

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const [ws, user] of clients) {
    if (ws !== exclude && ws.readyState === 1) ws.send(msg);
  }
}

function broadcastUserList() {
  const users = Array.from(clients.values()).map(u => ({
    id: u.id, name: u.name, tag: u.tag, av: u.av, status: u.status
  }));
  const msg = JSON.stringify({ type: 'user_list', users });
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  let user = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'join') {
      const name = (data.name || '').trim().slice(0, 20);
      if (!name) { ws.send(JSON.stringify({ type: 'error', msg: 'Geçersiz isim.' })); return; }
      for (const u of clients.values()) {
        if (u.name.toLowerCase() === name.toLowerCase()) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Bu isim zaten kullanımda.' }));
          return;
        }
      }
      user = { id: genId(), name, tag: genTag(), av: genAv(), status: 'online' };
      clients.set(ws, user);
      ws.send(JSON.stringify({ type: 'welcome', user, history: messageHistory }));
      broadcast({ type: 'user_joined', user }, ws);
      broadcastUserList();
      const sysmsg = { type: 'channel_msg', system: true, text: `${name} sunucuya katıldı`, time: nowStr() };
      messageHistory.push(sysmsg);
      if (messageHistory.length > 100) messageHistory.shift();
      broadcast(sysmsg);
      return;
    }

    if (!user) return;

    if (data.type === 'channel_msg') {
      const text = (data.text || '').trim().slice(0, 1000);
      const gif = data.gif || null;
      if (!text && !gif) return;
      const msg = {
        type: 'channel_msg',
        from: { id: user.id, name: user.name, tag: user.tag, av: user.av },
        text: text || '',
        gif: gif || null,
        time: nowStr()
      };
      messageHistory.push(msg);
      if (messageHistory.length > 100) messageHistory.shift();
      const encoded = JSON.stringify(msg);
      for (const [ws2] of clients) {
        if (ws2.readyState === 1) ws2.send(encoded);
      }
      return;
    }

    if (data.type === 'dm') {
      const toUser = Array.from(clients.values()).find(u => u.id === data.to);
      if (!toUser) return;
      const text = (data.text || '').trim().slice(0, 1000);
      const gif = data.gif || null;
      if (!text && !gif) return;
      const key = dmKey(user.id, data.to);
      if (!dmHistory[key]) dmHistory[key] = [];
      const msg = {
        type: 'dm',
        from: { id: user.id, name: user.name, tag: user.tag, av: user.av },
        to: data.to,
        text: text || '',
        gif: gif || null,
        time: nowStr()
      };
      dmHistory[key].push(msg);
      if (dmHistory[key].length > 200) dmHistory[key].shift();
      ws.send(JSON.stringify(msg));
      for (const [ws2, u2] of clients) {
        if (u2.id === data.to && ws2.readyState === 1) ws2.send(JSON.stringify(msg));
      }
      return;
    }

    if (data.type === 'dm_history') {
      const key = dmKey(user.id, data.with);
      ws.send(JSON.stringify({ type: 'dm_history', with: data.with, messages: dmHistory[key] || [] }));
      return;
    }

    if (data.type === 'get_history') {
      ws.send(JSON.stringify({ type: 'history_reload', messages: messageHistory }));
      return;
    }

    if (data.type === 'typing') {
      broadcast({ type: 'typing', from: user.id, name: user.name, channel: data.channel, to: data.to }, ws);
      return;
    }
  });

  ws.on('close', () => {
    if (!user) return;
    clients.delete(ws);
    const sysmsg = { type: 'channel_msg', system: true, text: `${user.name} ayrıldı`, time: nowStr() };
    messageHistory.push(sysmsg);
    if (messageHistory.length > 100) messageHistory.shift();
    broadcast(sysmsg);
    broadcast({ type: 'user_left', id: user.id });
    broadcastUserList();
  });
});

function nowStr() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

server.listen(PORT, () => {
  console.log(`\n✅ NexChat çalışıyor → http://localhost:${PORT}\n`);
});