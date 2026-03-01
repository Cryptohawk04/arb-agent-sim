'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// SSE clients
const sseClients = new Set();

function addSSEClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  }
}

function logToFile(event) {
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(DATA_DIR, `events-${today}.jsonl`);
  const line = JSON.stringify({ ...event, _logged: new Date().toISOString() }) + '\n';
  fs.appendFile(filePath, line, (err) => {
    if (err) console.error('Log write error:', err.message);
  });
}

function emit(type, payload) {
  const event = {
    type,
    ts: Date.now(),
    time: new Date().toISOString(),
    ...payload
  };
  broadcast(event);
  logToFile(event);
  return event;
}

function clientCount() { return sseClients.size; }

module.exports = { emit, addSSEClient, broadcast, clientCount };
