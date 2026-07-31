import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = join(projectRoot, "www");
const args = new Set(process.argv.slice(2));
const host = process.env.HOST || "127.0.0.1";
const requestedPort = Number(process.env.PORT || getArgValue("--port") || 5173);
const shouldOpen = !args.has("--no-open");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

await access(join(webRoot, "index.html"));

const server = createServer(async (request, response) => {
  try {
    const filePath = await resolveRequestPath(request.url || "/");
    const fileInfo = await stat(filePath);

    if (!fileInfo.isFile()) {
      return sendNotFound(response);
    }

    const headers = {
      "Content-Type": mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-store",
    };

    if (filePath.endsWith("index.html")) {
      headers["Clear-Site-Data"] = "\"cache\"";
    }

    if (filePath.endsWith("service-worker.js")) {
      headers["Service-Worker-Allowed"] = "/";
    }

    response.writeHead(200, headers);

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendNotFound(response);
      return;
    }

    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Local dev server error");
    console.error(error);
  }
});

const port = await listen(server, requestedPort);
const url = `http://${host}:${port}/`;

console.log(`Local dev server is running: ${url}`);
console.log("Serving ./www. Press Ctrl+C to stop.");

if (shouldOpen) {
  openBrowser(url);
}

async function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, "http://local.dev");
  const cleanPath = decodeURIComponent(url.pathname);
  const candidate = normalize(join(webRoot, cleanPath));
  const safeRelativePath = relative(webRoot, candidate);

  if (safeRelativePath.startsWith("..") || safeRelativePath === "" && cleanPath !== "/") {
    throw Object.assign(new Error("Path is outside web root"), { code: "ENOENT" });
  }

  if (cleanPath.endsWith("/")) {
    return join(candidate, "index.html");
  }

  try {
    const fileInfo = await stat(candidate);
    if (fileInfo.isDirectory()) {
      return join(candidate, "index.html");
    }
    return candidate;
  } catch (error) {
    if (!extname(candidate)) {
      return join(webRoot, "index.html");
    }
    throw error;
  }
}

function listen(targetServer, startPort) {
  return new Promise((resolveListen, rejectListen) => {
    const tryPort = (portToTry) => {
      targetServer.once("error", (error) => {
        if (error.code === "EADDRINUSE") {
          tryPort(portToTry + 1);
          return;
        }
        rejectListen(error);
      });

      targetServer.listen(portToTry, host, () => resolveListen(portToTry));
    };

    tryPort(startPort);
  });
}

function openBrowser(targetUrl) {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? ["cmd", ["/c", "start", "", targetUrl]]
      : platform === "darwin"
        ? ["open", [targetUrl]]
        : ["xdg-open", [targetUrl]];

  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

function getArgValue(name) {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : "";
}

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}
