#!/usr/bin/env node
/**
 * Direct CLI bridge to https://mcp.solana.com/mcp (Streamable HTTP MCP v2).
 * Supports:
 *   node scripts/solana-mcp-call.mjs list_sections
 *   node scripts/solana-mcp-call.mjs get_documentation <section>
 *   node scripts/solana-mcp-call.mjs search "<query>"
 *   node scripts/solana-mcp-call.mjs ask "<question>"
 *   node scripts/solana-mcp-call.mjs autofix <path-to-rs-file> [anchor|pinocchio]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MCP_URL = "https://mcp.solana.com/mcp";

async function postJsonRpc(payload, sessionId) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const nextSessionId = res.headers.get("mcp-session-id") ?? sessionId;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice(6).trim())
      .filter(Boolean);
    const last = dataLines.at(-1);
    return { body: last ? JSON.parse(last) : null, sessionId: nextSessionId };
  }
  return { body: text ? JSON.parse(text) : null, sessionId: nextSessionId };
}

async function callMcpTool(name, args) {
  const initRes = await postJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "cartridgefi-mcp-bridge", version: "1.0.0" },
    },
  });
  const sessionId = initRes.sessionId;
  try {
    await postJsonRpc(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      sessionId,
    );
  } catch {
    // Stateless servers may ignore notifications without id
  }
  const toolRes = await postJsonRpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
    sessionId,
  );
  return toolRes.body;
}

const [, , cmd, arg1, arg2] = process.argv;

async function main() {
  if (!cmd) {
    console.error(
      "Usage: solana-mcp-call.mjs <list_sections|get_documentation|search|ask|autofix> [args]",
    );
    process.exit(1);
  }
  let result;
  if (cmd === "list_sections") {
    result = await callMcpTool("list_sections", {});
  } else if (cmd === "get_documentation") {
    result = await callMcpTool("get_documentation", { section: arg1 });
  } else if (cmd === "search") {
    result = await callMcpTool("Solana_Documentation_Search", { query: arg1 });
  } else if (cmd === "ask") {
    result = await callMcpTool("Solana_Expert__Ask_For_Help", { question: arg1 });
  } else if (cmd === "autofix") {
    const absPath = resolve(process.cwd(), arg1);
    const code = readFileSync(absPath, "utf8");
    result = await callMcpTool("program_autofixer", {
      code,
      filename: arg1,
      framework: arg2 ?? "anchor",
    });
  } else {
    throw new Error(`Unknown command: ${cmd}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
