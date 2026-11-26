#!/usr/bin/env node
import type { Server as NodeHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createCartridgeMcpServer, createServer } from "./server.js";

export const MCP_SERVER_VERSION = "2.0.0";
export { createCartridgeMcpServer, createServer };
export * from "./bindings.js";
export * from "./upstream.js";

export interface StartedMcpHttpServer {
  port: number;
  host: string;
  mcpUrl: string;
  healthUrl: string;
  httpServer: NodeHttpServer;
  close: () => Promise<void>;
}

/**
 * Starts the CartridgeFi MCP v2 server over Streamable HTTP (`POST/GET/DELETE /mcp` + `GET /health`)
 * using `createMcpHandler(createCartridgeMcpServer)` + `createMcpExpressApp` + `toNodeHandler`.
 */
export async function startCartridgeMcpHttpServer(options?: {
  port?: number;
  host?: string;
}): Promise<StartedMcpHttpServer> {
  const host = options?.host ?? "127.0.0.1";
  const requestedPort = options?.port ?? Number(process.env.PORT ?? 8790);

  const handler = createMcpHandler(createCartridgeMcpServer);
  const app = createMcpExpressApp({ host });
  const nodeHandler = toNodeHandler(handler);

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      server: "cartridgefi-mcp-server",
      version: MCP_SERVER_VERSION,
      transport: "streamable-http",
      tools: [
        "discover_live_markets",
        "compile_cartridge_manifest",
        "simulate_cartridge_wasm",
        "deploy_cartridge_onchain",
        "generate_framework_binding",
        "inspect_creator_vault",
      ],
    });
  });

  app.all("/mcp", (req, res) => {
    void nodeHandler(req, res, req.body);
  });

  const httpServer = await new Promise<NodeHttpServer>((resolve, reject) => {
    const srv = app.listen(requestedPort, host, () => resolve(srv));
    srv.on("error", reject);
  });

  const addr = httpServer.address() as AddressInfo | string | null;
  const boundPort = typeof addr === "object" && addr !== null ? addr.port : requestedPort;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  return {
    port: boundPort,
    host,
    mcpUrl: `http://${displayHost}:${boundPort}/mcp`,
    healthUrl: `http://${displayHost}:${boundPort}/health`,
    httpServer,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

function isDirectMcpInvocation(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url);
    return (
      path.resolve(entryArg) === path.resolve(currentFile) ||
      entryArg.endsWith("/cartridgefi-mcp") ||
      entryArg.endsWith("\\cartridgefi-mcp")
    );
  } catch {
    return false;
  }
}

if (isDirectMcpInvocation()) {
  const useHttp =
    process.env.TRANSPORT === "http" ||
    process.argv.includes("--http") ||
    process.argv.includes("--transport=http");

  if (useHttp) {
    void startCartridgeMcpHttpServer().then((started) => {
      console.error(`@cartridgefi/mcp listening on ${started.mcpUrl} (health: ${started.healthUrl})`);
    });
  } else {
    serveStdio(createCartridgeMcpServer);
    console.error("@cartridgefi/mcp running on stdio");
  }
}
