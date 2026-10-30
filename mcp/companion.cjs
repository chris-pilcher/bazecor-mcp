#!/usr/bin/env node
// GPL-3.0-only. Standalone MCP stdio adapter; never starts Electron or opens USB.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { tools, guide, schemas } = require("./contract.cjs");

function attach(command) {
  return new Promise((resolve, reject) => {
    let credentials;
    let socket;
    const fail = error => {
      socket?.destroy();
      reject(error);
    };
    try {
      const root = process.env.BAZECOR_MCP_RUNTIME_DIR
        ? path.resolve(process.env.BAZECOR_MCP_RUNTIME_DIR)
        : path.join(os.homedir(), ".bazecor-mcp");
      const dir = fs.lstatSync(root);
      const info = fs.lstatSync(path.join(root, "connection.json"));
      if (
        !dir.isDirectory() ||
        dir.isSymbolicLink() ||
        info.isSymbolicLink() ||
        dir.uid !== process.getuid() ||
        info.uid !== process.getuid() ||
        dir.mode & 0o077 ||
        info.mode & 0o077
      )
        throw new Error("Unsafe MCP connection file permissions");
      credentials = JSON.parse(fs.readFileSync(path.join(root, "connection.json"), "utf8"));
      if (path.dirname(credentials.socket) !== root) throw new Error("Invalid MCP socket location");
    } catch (error) {
      reject(
        new Error(
          `Cannot attach to Bazecor. Start Bazecor MCP, open Layout Editor, then click Enable local MCP. ${error.message}`,
        ),
      );
      return;
    }
    socket = net.createConnection(credentials.socket);
    socket.setEncoding("utf8");
    socket.setTimeout(125000, () =>
      fail(new Error("Bazecor timed out. Read the current draft before retrying any save.")),
    );
    socket.on("error", e =>
      fail(new Error(`Bazecor is unavailable: ${e.message}. Open the app and enable local MCP.`)),
    );
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: credentials.token })}\n`));
    let buffer = "";
    let sent = false;
    let done = false;
    socket.on("close", () => {
      if (!done)
        reject(
          new Error("Bazecor disconnected. Re-read before retrying; an in-flight hardware write may have completed."),
        );
    });
    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) {
        fail(new Error("App response too large"));
        return;
      }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        let message;
        try {
          message = JSON.parse(buffer.slice(0, end));
        } catch {
          fail(new Error("Invalid app response"));
          return;
        }
        buffer = buffer.slice(end + 1);
        if (message.authenticated && !sent) {
          sent = true;
          socket.write(`${JSON.stringify({ id: 1, command })}\n`);
          continue;
        }
        if (message.id !== 1 || !sent) {
          fail(new Error("Unexpected app response"));
          return;
        }
        done = true;
        socket.destroy();
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      }
    });
  });
}

async function handle(message) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string")
    return { jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32600, message: "Invalid request" } };
  if (message.id === undefined) return undefined;
  const { method, params = {}, id } = message;
  const reply = result => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize")
    return reply({
      protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params.protocolVersion)
        ? params.protocolVersion
        : "2025-03-26",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "bazecor-live-editor", version: "0.2.0" },
      instructions: guide,
    });
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: tools.map(({ operation, ...tool }) => tool) });
  if (method === "resources/list")
    return reply({
      resources: [
        { uri: "bazecor://contract", name: "Live editor contract", mimeType: "text/plain" },
        { uri: "bazecor://schemas", name: "Validated tool schemas", mimeType: "application/json" },
      ],
    });
  if (method === "resources/read" && params.uri === "bazecor://schemas")
    return reply({ contents: [{ uri: params.uri, mimeType: "application/json", text: JSON.stringify(schemas) }] });
  if (method === "resources/read" && params.uri === "bazecor://contract")
    return reply({ contents: [{ uri: params.uri, mimeType: "text/plain", text: guide }] });
  if (method === "tools/call") {
    const definition = tools.find(t => t.name === params.name);
    if (!definition) return { jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } };
    try {
      const args = params.arguments || {};
      if (args.operation !== undefined) throw new Error("operation is selected by the tool name");
      const result = await attach({ ...args, operation: definition.operation });
      return reply({ content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
    } catch (error) {
      return reply({ content: [{ type: "text", text: error.message }], isError: true });
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
}
if (require.main === module) {
  let buffer = "";
  let inflight = 0;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) {
      process.stderr.write("MCP request exceeds 1 MiB\n");
      process.exit(1);
    }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      if (++inflight > 16) {
        process.stderr.write("Too many MCP requests\n");
        process.exit(1);
      }
      (async () => {
        try {
          const input = JSON.parse(line);
          if (Array.isArray(input) && (input.length === 0 || input.length > 16)) throw new Error("Invalid batch size");
          const result = Array.isArray(input)
            ? (await Promise.all(input.map(handle))).filter(Boolean)
            : await handle(input);
          if (result && (!Array.isArray(result) || result.length)) process.stdout.write(`${JSON.stringify(result)}\n`);
        } catch (error) {
          process.stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
          );
        } finally {
          inflight--;
        }
      })();
    }
  });
}
module.exports = { handle, attach };
