#!/usr/bin/env node
/**
 * Build a shareable ZIP for the team (app only — no synced notes, no secrets).
 *
 * Usage:
 *   node scripts/build-release.js
 *   node scripts/build-release.js --with-notes   # include notes/jira (large)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

const withNotes = process.argv.includes("--with-notes");
const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const folderName = `jarvis-${pkg.version}-${dateStamp}${withNotes ? "-con-notas" : ""}`;
const releaseDir = path.join(ROOT, "release");
const stagingRoot = path.join(releaseDir, "staging");
const stagingDir = path.join(stagingRoot, folderName);
const zipPath = path.join(releaseDir, `${folderName}.zip`);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".jarvis",
  ".atl",
  "release",
  "dist",
  ".cursor",
]);

const SKIP_FILES = new Set([
  ".env",
  "historial_jira.csv",
  ".DS_Store",
  "Thumbs.db",
]);

const SKIP_EXT = new Set([".log"]);

function shouldSkip(relPosix) {
  const parts = relPosix.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  const base = path.posix.basename(relPosix);
  if (SKIP_FILES.has(base)) return true;
  const ext = path.posix.extname(base);
  if (SKIP_EXT.has(ext)) return true;

  if (!withNotes && parts[0] === "notes" && parts[1] === "jira") {
    if (base.endsWith(".md")) return true;
  }

  return false;
}

function copyTree(srcDir, destDir, rel = "") {
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    const relPosix = rel ? `${rel}/${name}` : name;
    if (shouldSkip(relPosix)) continue;

    const stat = fs.statSync(src);
    const dest = path.join(destDir, name);

    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTree(src, dest, relPosix);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

function ensureNotesPlaceholder() {
  const jiraDir = path.join(stagingDir, "notes", "jira");
  fs.mkdirSync(jiraDir, { recursive: true });
  const keep = path.join(jiraDir, ".gitkeep");
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, "", "utf8");
}

function writeManifest() {
  const manifest = {
    name: "JARVIS",
    version: pkg.version,
    builtAt: new Date().toISOString(),
    withNotes,
    readme: "LEEME-INSTALACION.txt",
    installGuide: "docs/guia-instalacion-equipo.md",
    steps: [
      "Descomprimir ZIP",
      "copy .env.example .env",
      "Completar JIRA_EMAIL y JIRA_API_TOKEN",
      "npm install",
      "node scripts/sync-jira-api.js --full",
      "start.bat",
    ],
  };
  fs.writeFileSync(
    path.join(stagingDir, "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

function createZip() {
  fs.mkdirSync(releaseDir, { recursive: true });
  if (fs.existsSync(zipPath)) {
    console.warn(`AVISO: ya existe ${path.basename(zipPath)} — se sobrescribe solo este archivo.`);
  }
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const cwd = stagingRoot;
  const folder = folderName;
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${folder}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
      { cwd, stdio: "inherit" }
    );
  } else {
    execSync(`tar -a -c -f "${zipPath}" "${folder}"`, { cwd, stdio: "inherit" });
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

function main() {
  console.log(`Empaquetando JARVIS ${pkg.version}…`);
  console.log(withNotes ? "Modo: con notas jira/" : "Modo: app solamente (sin tickets)");

  if (fs.existsSync(stagingRoot)) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  copyTree(ROOT, stagingDir);
  if (!withNotes) ensureNotesPlaceholder();
  writeManifest();
  createZip();

  const fileCount = countFiles(stagingDir);
  const zipSizeMb = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);

  console.log("");
  console.log("Listo.");
  console.log(`  Archivos: ${fileCount}`);
  console.log(`  ZIP: ${zipPath}`);
  console.log(`  Tamaño: ${zipSizeMb} MB`);
  console.log("");
  console.log("Compartí el ZIP con el equipo + indicá LEEME-INSTALACION.txt");
}

main();
