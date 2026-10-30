import { app, ipcMain } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import crypto from "crypto";
import Window from "../main/managers/Window";
import { commandSchema } from "./domain";

// Linux first: do not imply untested named-pipe ACL protection on Windows.
const root = path.join(os.homedir(), ".bazecor-mcp");
let server: net.Server | undefined;
const sockets = new Set<net.Socket>();
let sequence = 0;
let editorId: number | undefined;
let lastActivity = "No client activity";
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
let chain = Promise.resolve();
function status() {
  return { enabled: !!server, clients: sockets.size, lastActivity, endpoint: path.join(root, "connection.json") };
}
function clearPending() {
  pending.forEach(p => {
    clearTimeout(p.timer);
    p.reject(new Error("MCP disconnected. Re-read the draft before retrying; an in-flight save may have completed."));
  });
  pending.clear();
}
function stop() {
  if (!server) return;
  server?.close();
  server = undefined;
  sockets.forEach(s => s.destroy());
  sockets.clear();
  clearPending();
  try {
    const endpoint = path.join(root, "connection.json");
    const owner = JSON.parse(fs.readFileSync(endpoint, "utf8"));
    if (owner.pid === process.pid) fs.unlinkSync(endpoint);
  } catch {
    /* already absent */
  }
}
async function forward(command: unknown) {
  const parsed = commandSchema.parse(command);
  const win = Window.getWindow();
  if (!win || win.isDestroyed())
    throw new Error("Open Bazecor's Layout Editor first. MCP never launches an app or device connection.");
  sequence += 1;
  const id = sequence;
  if (editorId !== win.webContents.id) throw new Error("Open the Layout Editor first and wait for it to load.");
  lastActivity = `${parsed.operation} at ${new Date().toISOString()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Editor did not respond. Open Layout Editor. Do not retry a save without reading its state."));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send("mcp:command", { id, command: parsed });
  });
}
function start() {
  if (server) return;
  if (process.platform === "win32")
    throw new Error("MCP local IPC currently supports Linux and macOS only; Windows pipe ACLs are not implemented.");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
    throw new Error("Unsafe MCP directory owner or type");
  fs.chmodSync(root, 0o700);
  const endpoint = path.join(root, "connection.json");
  if (fs.existsSync(endpoint)) {
    const previous = JSON.parse(fs.readFileSync(endpoint, "utf8"));
    if (Number.isSafeInteger(previous.pid) && previous.pid !== process.pid) {
      let alive = false;
      try {
        process.kill(previous.pid, 0);
        alive = true;
      } catch {
        /* stale process */
      }
      if (alive)
        throw new Error("Another Bazecor instance has MCP enabled. Disable MCP there before enabling this instance.");
    }
  }
  const token = crypto.randomBytes(32).toString("hex");
  const socketPath = path.join(root, `app-${process.pid}-${crypto.randomBytes(4).toString("hex")}.sock`);
  const listener = net.createServer(socket => {
    let buffer = "";
    let queued = 0;
    let authenticated = false;
    socket.setEncoding("utf8");
    socket.setTimeout(180000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    const accept = (line: string) => {
      let message: { token?: string; id?: number; command?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        socket.destroy();
        return;
      }
      if (!authenticated) {
        if (message.token !== token) {
          socket.destroy();
          return;
        }
        authenticated = true;
        sockets.add(socket);
        socket.write(`${JSON.stringify({ authenticated: true })}\n`);
        return;
      }
      const { id } = message;
      queued += 1;
      if (!Number.isSafeInteger(id) || queued > 16) {
        socket.destroy();
        return;
      }
      const current = server;
      chain = chain.then(async () => {
        queued -= 1;
        if (socket.destroyed || current !== server) return;
        try {
          const result = await forward(message.command);
          if (!socket.destroyed) socket.write(`${JSON.stringify({ id, result })}\n`);
        } catch (error) {
          if (!socket.destroyed) socket.write(`${JSON.stringify({ id, error: (error as Error).message })}\n`);
        }
      });
    };
    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) {
        socket.destroy();
        return;
      }
      while (buffer.includes("\n") && !socket.destroyed) {
        const end = buffer.indexOf("\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        accept(line);
      }
    });
  });
  server = listener;
  listener.on("error", () => {
    if (server === listener) stop();
  });
  listener.on("close", () => {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      /* removed */
    }
  });
  listener.listen(socketPath, () => {
    fs.chmodSync(socketPath, 0o600);
    fs.writeFileSync(
      path.join(root, "connection.json"),
      JSON.stringify({ socket: socketPath, token, pid: process.pid }),
      {
        mode: 0o600,
      },
    );
    fs.chmodSync(path.join(root, "connection.json"), 0o600);
  });
}
export function configureMcp() {
  ipcMain.on("mcp:editor", (event, available: boolean) => {
    if (event.sender !== Window.getWindow()?.webContents) return;
    editorId = available ? event.sender.id : undefined;
  });
  ipcMain.handle("mcp:control", (event, enabled?: boolean) => {
    if (event.sender !== Window.getWindow()?.webContents) throw new Error("Untrusted MCP control sender");
    if (enabled === true) start();
    if (enabled === false) stop();
    return status();
  });
  ipcMain.on("mcp:result", (event, message) => {
    if (event.sender !== Window.getWindow()?.webContents) return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  app.on("will-quit", stop);
}
