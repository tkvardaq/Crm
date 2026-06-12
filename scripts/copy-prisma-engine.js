const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const standaloneDir = path.join(__dirname, "..", "apps", "web", ".next", "standalone");
const prismaClientDir = path.join(__dirname, "..", "apps", "web", "node_modules", "@prisma", "client");

const targetDir = path.join(standaloneDir, "node_modules", ".prisma", "client");

if (!fs.existsSync(standaloneDir)) {
  console.log("[copy-prisma-engine] No standalone directory found, skipping");
  process.exit(0);
}

if (!fs.existsSync(prismaClientDir)) {
  console.log("[copy-prisma-engine] No @prisma/client found, skipping");
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

const dllName = "query_engine-windows.dll.node";
const srcDll = path.join(prismaClientDir, dllName);
const dstDll = path.join(targetDir, dllName);

if (fs.existsSync(srcDll)) {
  fs.copyFileSync(srcDll, dstDll);
  console.log(`[copy-prisma-engine] Copied ${dllName} to standalone output`);
} else {
  console.warn(`[copy-prisma-engine] Source DLL not found at ${srcDll}, skipping`);
}

const indexDst = path.join(targetDir, "index.js");
const indexSrc = path.join(prismaClientDir, "index.js");
if (fs.existsSync(indexSrc) && !fs.existsSync(indexDst)) {
  fs.copyFileSync(indexSrc, indexDst);
}

console.log("[copy-prisma-engine] Done");