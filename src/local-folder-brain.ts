/**
 * Local Folder Brain (جسر الملفات الحقيقي)
 * ----------------------------------------
 * Uses the browser's File System Access API (with explicit user consent) so any
 * HTML/AI web app (Moho AI, Gemini, Claude, ChatGPT UIs) can:
 *  - Open a real local project folder directly from the hard drive
 *  - Scan the full project tree while skipping heavy build/vendor folders
 *  - Read & search across all project files
 *  - Build compact, token-budgeted AI context packs
 *  - Preview unified diffs and apply direct edits straight to disk ("تطبيق مباشر")
 *    with automatic in-memory rollback snapshots (`undoLastEdit` / `undoFile`)
 */

export interface FolderEntryInfo {
  path: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
  extension?: string;
}

export interface FileSearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface FileDiffHunk {
  type: "context" | "add" | "remove";
  lineNumberOld?: number;
  lineNumberNew?: number;
  text: string;
}

export interface DirectEditProposal {
  id: string;
  path: string;
  oldContent: string;
  newContent: string;
  addedLines: number;
  removedLines: number;
  unifiedDiff: string;
  reason?: string;
}

export interface DirectEditRecord {
  id: string;
  path: string;
  previousContent: string | null;
  newContent: string;
  appliedAt: number;
  reason?: string;
}

export interface LocalFolderBrainOptions {
  /** Folder names to skip when scanning (defaults cover node_modules, .git, dist, etc.) */
  ignoreDirs?: string[];
  /** Max single file size in bytes to read as text (default 1 MB) */
  maxFileSizeBytes?: number;
  /** Optional interactive approval gate before writing to disk ("تطبيق مباشر") */
  onConfirmDirectEdit?: (proposal: DirectEditProposal) => boolean | Promise<boolean>;
  /** Optional callback whenever folder status changes (e.g. to sync with extension popup) */
  onStatusChange?: (status: LocalFolderBrainStatus) => void;
}

export interface LocalFolderBrainStatus {
  supported: boolean;
  connected: boolean;
  folderName: string | null;
  permission: "granted" | "prompt" | "denied" | "unknown";
  indexedFileCount: number;
  editHistoryCount: number;
  watching?: boolean;
  observerSupported?: boolean;
}

export interface FolderWatchEvent {
  type: "appeared" | "disappeared" | "modified" | "moved" | "unknown";
  path: string;
  timestamp: number;
}

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "target",
  ".idea",
  ".vscode",
  "coverage",
]);

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svgz",
  "pdf", "zip", "tar", "gz", "7z", "rar", "exe", "dll", "so", "dylib",
  "mp3", "mp4", "wav", "avi", "mov", "woff", "woff2", "ttf", "otf", "eot",
  "pyc", "class", "wasm", "sqlite", "db",
]);

const IDB_NAME = "moho_local_folder_brain_v5";
const IDB_STORE = "handles";

function normalizeRelPath(relPath: string): string {
  const cleaned = relPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) {
    throw new Error(`Invalid relative path (traversal blocked): ${relPath}`);
  }
  return parts.join("/");
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : "";
}

/**
 * Generates a compact, readable unified diff between two text snapshots.
 */
export function computeUnifiedDiff(
  path: string,
  oldText: string,
  newText: string
): { unifiedDiff: string; addedLines: number; removedLines: number } {
  const oldLines = oldText.length ? oldText.split(/\r?\n/) : [];
  const newLines = newText.length ? newText.split(/\r?\n/) : [];

  // Trim shared prefix and suffix for fast, clean diffing
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);

  if (removed.length === 0 && added.length === 0) {
    return { unifiedDiff: `--- a/${path}\n+++ b/${path}\n(no changes)`, addedLines: 0, removedLines: 0 };
  }

  const ctxStart = Math.max(0, prefix - 2);
  const ctxEndOld = Math.min(oldLines.length, oldLines.length - suffix + 2);
  const ctxEndNew = Math.min(newLines.length, newLines.length - suffix + 2);

  const lines: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${ctxStart + 1},${ctxEndOld - ctxStart} +${ctxStart + 1},${ctxEndNew - ctxStart} @@`,
  ];

  for (let i = ctxStart; i < prefix; i++) lines.push(` ${oldLines[i]}`);
  for (const r of removed) lines.push(`-${r}`);
  for (const a of added) lines.push(`+${a}`);
  for (let i = oldLines.length - suffix; i < ctxEndOld; i++) lines.push(` ${oldLines[i]}`);

  return {
    unifiedDiff: lines.join("\n"),
    addedLines: added.length,
    removedLines: removed.length,
  };
}

export class LocalFolderBrain {
  private rootHandle: any = null;
  private readonly ignoreDirs: Set<string>;
  private readonly maxFileSizeBytes: number;
  private readonly onConfirmDirectEdit?: LocalFolderBrainOptions["onConfirmDirectEdit"];
  private readonly onStatusChange?: LocalFolderBrainOptions["onStatusChange"];
  private cachedEntries: FolderEntryInfo[] = [];
  private editHistory: DirectEditRecord[] = [];
  private permissionState: LocalFolderBrainStatus["permission"] = "unknown";
  private gitignorePatterns: RegExp[] = [];
  private fsObserver: any = null;
  private pollTimer?: ReturnType<typeof setInterval>;
  private isWatching = false;

  constructor(options: LocalFolderBrainOptions = {}) {
    this.ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])]);
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 1024 * 1024;
    this.onConfirmDirectEdit = options.onConfirmDirectEdit;
    this.onStatusChange = options.onStatusChange;
  }

  static isSupported(): boolean {
    return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function";
  }

  getStatus(): LocalFolderBrainStatus {
    return {
      supported: LocalFolderBrain.isSupported(),
      connected: Boolean(this.rootHandle),
      folderName: this.rootHandle?.name ?? null,
      permission: this.permissionState,
      indexedFileCount: this.cachedEntries.filter((e) => e.kind === "file").length,
      editHistoryCount: this.editHistory.length,
      watching: this.isWatching,
      observerSupported: typeof globalThis !== "undefined" && "FileSystemObserver" in globalThis,
    };
  }

  private notifyStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }

  /**
   * Opens the native browser directory picker so the user grants access to their local project folder.
   */
  async pickFolder(options?: { mode?: "read" | "readwrite"; startIn?: string; persistHandle?: boolean }): Promise<LocalFolderBrainStatus> {
    if (!LocalFolderBrain.isSupported()) {
      throw new Error(
        "File System Access API (showDirectoryPicker) is not supported in this browser. Use Chrome, Edge, or Chromium."
      );
    }
    const mode = options?.mode ?? "readwrite";
    const handle = await (window as any).showDirectoryPicker({
      mode,
      ...(options?.startIn ? { startIn: options.startIn } : {}),
    });
    this.rootHandle = handle;
    this.permissionState = "granted";
    if (options?.persistHandle !== false) {
      await this.saveHandleToIndexedDB(handle).catch(() => {});
    }
    await this.scanTree();
    this.notifyStatus();
    return this.getStatus();
  }

  /**
   * Attach an already-obtained FileSystemDirectoryHandle (useful for tests or custom pickers).
   */
  async attachDirectoryHandle(handle: any): Promise<LocalFolderBrainStatus> {
    this.rootHandle = handle;
    this.permissionState = "granted";
    await this.scanTree();
    this.notifyStatus();
    return this.getStatus();
  }

  /**
   * Restores the previously picked folder from IndexedDB and verifies/requests readwrite permission.
   */
  async restoreSavedFolder(mode: "read" | "readwrite" = "readwrite"): Promise<boolean> {
    const saved = await this.loadHandleFromIndexedDB().catch(() => null);
    if (!saved) return false;
    const perm = (await saved.queryPermission?.({ mode })) ?? "prompt";
    if (perm === "granted") {
      this.rootHandle = saved;
      this.permissionState = "granted";
      await this.scanTree();
      this.notifyStatus();
      return true;
    }
    const req = (await saved.requestPermission?.({ mode })) ?? "denied";
    this.permissionState = req;
    if (req === "granted") {
      this.rootHandle = saved;
      await this.scanTree();
      this.notifyStatus();
      return true;
    }
    this.notifyStatus();
    return false;
  }

  disconnect(): void {
    this.rootHandle = null;
    this.cachedEntries = [];
    this.permissionState = "unknown";
    this.notifyStatus();
  }

  private ensureConnected(): any {
    if (!this.rootHandle) {
      throw new Error("No local project folder is connected. Call pickFolder() first.");
    }
    return this.rootHandle;
  }

  private async resolveFileHandle(relPath: string, create = false): Promise<any> {
    const root = this.ensureConnected();
    const norm = normalizeRelPath(relPath);
    const parts = norm.split("/");
    const fileName = parts.pop();
    if (!fileName) throw new Error(`Invalid file path: ${relPath}`);

    let dir = root;
    for (const seg of parts) {
      dir = await dir.getDirectoryHandle(seg, { create });
    }
    return dir.getFileHandle(fileName, { create });
  }

  /**
   * Recursively scans the project folder while skipping ignored directories.
   */
  async scanTree(options?: { maxFiles?: number; includeHidden?: boolean }): Promise<FolderEntryInfo[]> {
    const root = this.ensureConnected();
    const maxFiles = options?.maxFiles ?? 3000;
    const includeHidden = options?.includeHidden ?? false;
    await this.loadGitignore().catch(() => {});
    const entries: FolderEntryInfo[] = [];

    const walk = async (dirHandle: any, prefix: string) => {
      for await (const [name, handle] of dirHandle.entries()) {
        if (entries.length >= maxFiles) return;
        if (!includeHidden && name.startsWith(".") && name !== ".env.example") continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (this.isIgnoredByGitignore(rel, handle.kind === "directory")) continue;

        if (handle.kind === "directory") {
          if (this.ignoreDirs.has(name)) continue;
          entries.push({ path: rel, name, kind: "directory" });
          await walk(handle, rel);
        } else {
          let size: number | undefined;
          let lastModified: number | undefined;
          try {
            const file = await handle.getFile();
            size = file.size;
            lastModified = file.lastModified;
          } catch {
            // ignore stat errors
          }
          entries.push({
            path: rel,
            name,
            kind: "file",
            size,
            lastModified,
            extension: getExtension(name),
          });
        }
      }
    };

    await walk(root, "");
    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.cachedEntries = entries;
    this.notifyStatus();
    return entries;
  }

  async readFile(relPath: string): Promise<{ path: string; content: string; size: number; lastModified: number }> {
    const norm = normalizeRelPath(relPath);
    const fh = await this.resolveFileHandle(norm, false);
    const file: File = await fh.getFile();
    if (file.size > this.maxFileSizeBytes) {
      throw new Error(
        `File "${norm}" (${file.size} bytes) exceeds maxFileSizeBytes (${this.maxFileSizeBytes}).`
      );
    }
    const content = await file.text();
    return { path: norm, content, size: file.size, lastModified: file.lastModified };
  }

  async readMultipleFiles(paths: string[]): Promise<Array<{ path: string; content?: string; error?: string }>> {
    return Promise.all(
      paths.map(async (p) => {
        try {
          const res = await this.readFile(p);
          return { path: res.path, content: res.content };
        } catch (err) {
          return { path: p, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
  }

  async searchInFiles(
    query: string,
    options?: { isRegex?: boolean; caseSensitive?: boolean; maxMatches?: number; extensions?: string[] }
  ): Promise<FileSearchMatch[]> {
    if (!query) return [];
    const entries = this.cachedEntries.length ? this.cachedEntries : await this.scanTree();
    const maxMatches = options?.maxMatches ?? 100;
    const extFilter = options?.extensions?.length
      ? new Set(options.extensions.map((e) => e.replace(/^\./, "").toLowerCase()))
      : null;

    const flags = options?.caseSensitive ? "g" : "gi";
    const regex = options?.isRegex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

    const matches: FileSearchMatch[] = [];

    for (const entry of entries) {
      if (matches.length >= maxMatches) break;
      if (entry.kind !== "file") continue;
      if (entry.extension && BINARY_EXTENSIONS.has(entry.extension)) continue;
      if (extFilter && (!entry.extension || !extFilter.has(entry.extension))) continue;
      if (entry.size !== undefined && entry.size > this.maxFileSizeBytes) continue;

      try {
        const { content } = await this.readFile(entry.path);
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          const m = regex.exec(lines[i]);
          if (m) {
            matches.push({
              path: entry.path,
              line: i + 1,
              column: m.index + 1,
              preview: lines[i].trim().slice(0, 220),
            });
            if (matches.length >= maxMatches) break;
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    return matches;
  }

  /**
   * Builds a clean, token-budgeted Markdown context pack of the local project
   * ready to pass into Moho AI, Gemini, Claude, or ChatGPT.
   */
  async buildProjectContext(options?: {
    maxTotalChars?: number;
    includePaths?: string[];
    extensions?: string[];
  }): Promise<{ folderName: string; fileCount: number; includedFiles: string[]; markdown: string }> {
    const root = this.ensureConnected();
    const entries = this.cachedEntries.length ? this.cachedEntries : await this.scanTree();
    const maxChars = options?.maxTotalChars ?? 120_000;
    const extSet = options?.extensions?.length
      ? new Set(options.extensions.map((e) => e.replace(/^\./, "").toLowerCase()))
      : null;

    const treeText = entries
      .map((e) => (e.kind === "directory" ? `${e.path}/` : e.path))
      .join("\n");

    const sections: string[] = [
      `# Local Project Context: ${root.name}`,
      "",
      "## Project File Tree",
      "```text",
      treeText,
      "```",
      "",
      "## File Contents",
    ];

    let usedChars = sections.join("\n").length;
    const includedFiles: string[] = [];

    const candidates = options?.includePaths?.length
      ? entries.filter((e) => e.kind === "file" && options.includePaths!.includes(e.path))
      : entries.filter((e) => e.kind === "file");

    for (const file of candidates) {
      if (file.extension && BINARY_EXTENSIONS.has(file.extension)) continue;
      if (extSet && (!file.extension || !extSet.has(file.extension))) continue;
      if (file.size !== undefined && file.size > this.maxFileSizeBytes) continue;

      try {
        const { content } = await this.readFile(file.path);
        const block = `\n### ${file.path}\n\`\`\`${file.extension || ""}\n${content}\n\`\`\`\n`;
        if (usedChars + block.length > maxChars) continue;
        sections.push(block);
        usedChars += block.length;
        includedFiles.push(file.path);
      } catch {
        // skip unreadable files
      }
    }

    return {
      folderName: root.name,
      fileCount: entries.filter((e) => e.kind === "file").length,
      includedFiles,
      markdown: sections.join("\n"),
    };
  }

  /**
   * Prepares a Direct Edit Proposal with Unified Diff before modifying the real file on disk.
   */
  async previewEdit(relPath: string, newContent: string, reason?: string): Promise<DirectEditProposal> {
    const norm = normalizeRelPath(relPath);
    let oldContent = "";
    try {
      const existing = await this.readFile(norm);
      oldContent = existing.content;
    } catch {
      oldContent = "";
    }
    const { unifiedDiff, addedLines, removedLines } = computeUnifiedDiff(norm, oldContent, newContent);
    return {
      id: `edit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      path: norm,
      oldContent,
      newContent,
      addedLines,
      removedLines,
      unifiedDiff,
      reason,
    };
  }

  /**
   * "تطبيق مباشر" (Direct Apply): saves the new content directly to the real file on disk
   * after running the optional user confirmation callback, and records an instant undo snapshot.
   */
  async applyDirectEdit(
    relPath: string,
    newContent: string,
    options?: { reason?: string; skipConfirmation?: boolean }
  ): Promise<{ applied: boolean; proposal: DirectEditProposal; record?: DirectEditRecord }> {
    const proposal = await this.previewEdit(relPath, newContent, options?.reason);

    if (!options?.skipConfirmation && this.onConfirmDirectEdit) {
      const ok = await this.onConfirmDirectEdit(proposal);
      if (!ok) {
        return { applied: false, proposal };
      }
    }

    const fh = await this.resolveFileHandle(proposal.path, true);
    const writable = await fh.createWritable();
    await writable.write(newContent);
    await writable.close();

    const record: DirectEditRecord = {
      id: proposal.id,
      path: proposal.path,
      previousContent: proposal.oldContent,
      newContent,
      appliedAt: Date.now(),
      reason: options?.reason,
    };
    this.editHistory.push(record);
    await this.scanTree().catch(() => {});
    this.notifyStatus();

    return { applied: true, proposal, record };
  }

  async createFile(relPath: string, content = "", reason?: string) {
    return this.applyDirectEdit(relPath, content, { reason: reason ?? "Create new file" });
  }

  async deleteFile(relPath: string): Promise<{ deleted: boolean; path: string }> {
    const root = this.ensureConnected();
    const norm = normalizeRelPath(relPath);
    const parts = norm.split("/");
    const fileName = parts.pop();
    if (!fileName) throw new Error(`Invalid file path: ${relPath}`);
    let dir = root;
    for (const seg of parts) {
      dir = await dir.getDirectoryHandle(seg, { create: false });
    }
    await dir.removeEntry(fileName);
    await this.scanTree().catch(() => {});
    this.notifyStatus();
    return { deleted: true, path: norm };
  }

  async undoLastEdit(): Promise<{ undone: boolean; path?: string }> {
    const last = this.editHistory.pop();
    if (!last) return { undone: false };
    const fh = await this.resolveFileHandle(last.path, true);
    const writable = await fh.createWritable();
    await writable.write(last.previousContent ?? "");
    await writable.close();
    this.notifyStatus();
    return { undone: true, path: last.path };
  }

  private async loadGitignore(): Promise<void> {
    this.gitignorePatterns = [];
    try {
      const { content } = await this.readFile(".gitignore");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith("!")) continue;
        const cleaned = line.replace(/^\/+/, "").replace(/\/+$/, "");
        const escaped = cleaned
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*");
        this.gitignorePatterns.push(new RegExp(`(^|/)${escaped}(/|$)`));
      }
    } catch {
      // no .gitignore present
    }
  }

  private isIgnoredByGitignore(relPath: string, _isDir: boolean): boolean {
    if (!this.gitignorePatterns.length) return false;
    return this.gitignorePatterns.some((re) => re.test(relPath));
  }

  /**
   * Surgical Search-and-Replace Patch (ideal for AI coding agents):
   * replaces an exact target snippet inside a real local file without rewriting the whole file.
   */
  async applySearchReplacePatch(
    relPath: string,
    searchBlock: string,
    replaceBlock: string,
    options?: { reason?: string; replaceAll?: boolean; skipConfirmation?: boolean }
  ): Promise<{ applied: boolean; replacements: number; proposal?: DirectEditProposal; error?: string }> {
    const existing = await this.readFile(relPath);
    if (!searchBlock) {
      return { applied: false, replacements: 0, error: "searchBlock must be non-empty." };
    }
    if (!existing.content.includes(searchBlock)) {
      return {
        applied: false,
        replacements: 0,
        error: `Search block not found in "${relPath}". Read the latest file contents and retry.`,
      };
    }

    let replacements = 0;
    let updated: string;
    if (options?.replaceAll) {
      const parts = existing.content.split(searchBlock);
      replacements = parts.length - 1;
      updated = parts.join(replaceBlock);
    } else {
      replacements = 1;
      updated = existing.content.replace(searchBlock, replaceBlock);
    }

    const res = await this.applyDirectEdit(relPath, updated, {
      reason: options?.reason ?? `Surgical patch (${replacements} replacement)`,
      skipConfirmation: options?.skipConfirmation,
    });
    return { applied: res.applied, replacements, proposal: res.proposal };
  }

  /**
   * Real-time local directory watching via Chrome's FileSystemObserver API
   * (automatically falls back to lightweight metadata polling if unavailable).
   */
  async startWatching(
    onChange: (events: FolderWatchEvent[]) => void,
    options?: { pollIntervalMs?: number }
  ): Promise<{ mode: "FileSystemObserver" | "polling" }> {
    const root = this.ensureConnected();
    this.stopWatching();

    const ObserverCtor = (globalThis as any).FileSystemObserver;
    if (typeof ObserverCtor === "function") {
      this.fsObserver = new ObserverCtor((records: any[]) => {
        const events: FolderWatchEvent[] = records.map((r) => ({
          type: r.type || "unknown",
          path: Array.isArray(r.relativePathComponents) ? r.relativePathComponents.join("/") : "",
          timestamp: Date.now(),
        }));
        void this.scanTree().catch(() => {});
        onChange(events);
      });
      await this.fsObserver.observe(root, { recursive: true });
      this.isWatching = true;
      this.notifyStatus();
      return { mode: "FileSystemObserver" };
    }

    // Fallback: lightweight mtime polling
    let snapshot = new Map(
      this.cachedEntries
        .filter((e) => e.kind === "file")
        .map((e) => [e.path, `${e.size ?? 0}:${e.lastModified ?? 0}`])
    );
    const intervalMs = Math.max(1000, options?.pollIntervalMs ?? 2500);
    this.pollTimer = setInterval(async () => {
      try {
        const fresh = await this.scanTree();
        const nextMap = new Map(
          fresh
            .filter((e) => e.kind === "file")
            .map((e) => [e.path, `${e.size ?? 0}:${e.lastModified ?? 0}`])
        );
        const events: FolderWatchEvent[] = [];
        for (const [p, sig] of nextMap) {
          if (!snapshot.has(p)) events.push({ type: "appeared", path: p, timestamp: Date.now() });
          else if (snapshot.get(p) !== sig) events.push({ type: "modified", path: p, timestamp: Date.now() });
        }
        for (const p of snapshot.keys()) {
          if (!nextMap.has(p)) events.push({ type: "disappeared", path: p, timestamp: Date.now() });
        }
        snapshot = nextMap;
        if (events.length) onChange(events);
      } catch {
        // ignore transient polling errors
      }
    }, intervalMs);
    this.isWatching = true;
    this.notifyStatus();
    return { mode: "polling" };
  }

  stopWatching(): void {
    if (this.fsObserver) {
      try { this.fsObserver.disconnect(); } catch {}
      this.fsObserver = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.isWatching = false;
    this.notifyStatus();
  }

  getEditHistory(): DirectEditRecord[] {
    return [...this.editHistory];
  }

  // --- IndexedDB Handle Persistence ---
  private saveHandleToIndexedDB(handle: any): Promise<void> {
    if (typeof indexedDB === "undefined") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(handle, "rootFolder");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private loadHandleFromIndexedDB(): Promise<any> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, "readonly");
        const getReq = tx.objectStore(IDB_STORE).get("rootFolder");
        getReq.onsuccess = () => resolve(getReq.result ?? null);
        getReq.onerror = () => reject(getReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

export function createLocalFolderBrain(options?: LocalFolderBrainOptions): LocalFolderBrain {
  return new LocalFolderBrain(options);
}
