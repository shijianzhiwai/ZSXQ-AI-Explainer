import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const PING_INTERVAL_MS = 25_000;

export function inboxWsUrl(port, host = '127.0.0.1') {
  return `ws://${host}:${port}/ws`;
}

export function attachInboxWebSocket(server, { path = '/ws' } = {}) {
  const extensionClients = new Set();
  const pendingCommands = new Map();

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== path) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  function send(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function broadcast(message, { role } = {}) {
    for (const client of extensionClients) {
      if (!role || client.role === role) send(client.ws, message);
    }
  }

  function resolveCommand(id, result) {
    const entry = pendingCommands.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingCommands.delete(id);
    if (result.ok) entry.resolve(result);
    else entry.reject(new Error(result.error || 'command failed'));
  }

  function dispatchCommand(action, payload = {}, { timeoutMs = 300_000 } = {}) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      if (extensionClients.size === 0) {
        reject(new Error('no extension connected to websocket'));
        return;
      }
      const timer = setTimeout(() => {
        pendingCommands.delete(id);
        reject(new Error(`command timeout (${action})`));
      }, timeoutMs);
      pendingCommands.set(id, { resolve, reject, timer });
      broadcast({
        type: 'command',
        id,
        action,
        payload
      }, { role: 'extension' });
    });
  }

  wss.on('connection', (ws) => {
    const client = { ws, role: null, version: null, connectedAt: Date.now() };
    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        send(ws, { type: 'error', error: 'invalid JSON' });
        return;
      }

      if (message.type === 'hello' && message.role === 'extension') {
        client.role = 'extension';
        client.version = message.version || null;
        extensionClients.add(client);
        send(ws, { type: 'welcome', extension_clients: extensionClients.size });
        return;
      }

      if (message.type === 'pong') return;

      if (message.type === 'command_result' && message.id) {
        resolveCommand(message.id, {
          ok: Boolean(message.ok),
          data: message.data,
          error: message.error
        });
      }
    });

    ws.on('close', () => {
      extensionClients.delete(client);
    });
  });

  const pingTimer = setInterval(() => {
    broadcast({ type: 'ping', ts: Date.now() }, { role: 'extension' });
  }, PING_INTERVAL_MS);
  pingTimer.unref?.();

  return {
    dispatchCommand,
    getStatus() {
      return {
        path,
        extension_clients: extensionClients.size,
        extension_versions: [...extensionClients].map((client) => client.version || null),
        pending_commands: pendingCommands.size
      };
    }
  };
}
