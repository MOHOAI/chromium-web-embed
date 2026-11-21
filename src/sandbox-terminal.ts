/**
 * Sandbox Terminal & Multi-Language Code Runner (v6.0.0)
 * ------------------------------------------------------
 * Connects web apps & AI agents (Moho AI, Gemini, Claude, ChatGPT) via the
 * Chrome extension bridge to the local Windows 10/11 SandboxTerminalEngine
 * strictly jailed inside the user's connected project folder.
 */

import type { BrowserEvent } from "./protocol.js";

export interface SandboxTerminalTransport {
  desktopExecute(action: string, payload?: Record<string, unknown>): Promise<unknown>;
  onTabEvent(listener: (event: BrowserEvent) => void): () => void;
}

export interface TerminalExecutionResult {
  ok: boolean;
  jobId: string;
  exitCode: number | null;
  timedOut: boolean;
  cwd: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface DetectedRuntimesInfo {
  workspaceRoot: string | null;
  runtimes: Record<string, string>;
}

export class SandboxTerminalClient {
  private readonly bridge: SandboxTerminalTransport;
  private outputListeners = new Set<(chunk: { stream: "stdout" | "stderr"; chunk: string }) => void>();
  private unsub?: () => void;

  constructor(bridge: SandboxTerminalTransport) {
    this.bridge = bridge;
    this.unsub = this.bridge.onTabEvent((ev) => {
      if (ev.type === "terminal.output" && ev.payload) {
        for (const cb of this.outputListeners) {
          try {
            cb(ev.payload as { stream: "stdout" | "stderr"; chunk: string });
          } catch {}
        }
      }
    });
  }

  onOutput(listener: (chunk: { stream: "stdout" | "stderr"; chunk: string }) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  async setWorkspace(folderPath: string): Promise<{ ok: boolean; workspaceRoot: string }> {
    return (await this.bridge.desktopExecute("terminal_set_workspace", { path: folderPath })) as {
      ok: boolean;
      workspaceRoot: string;
    };
  }

  async detectRuntimes(): Promise<DetectedRuntimesInfo> {
    return (await this.bridge.desktopExecute("terminal_detect_runtimes", {})) as DetectedRuntimesInfo;
  }

  async exec(
    command: string,
    options?: { cwd?: string; timeoutSec?: number; jobId?: string }
  ): Promise<TerminalExecutionResult> {
    return (await this.bridge.desktopExecute("terminal_exec", {
      command,
      cwd: options?.cwd,
      timeoutSec: options?.timeoutSec ?? 30,
      jobId: options?.jobId,
    })) as TerminalExecutionResult;
  }

  async runFile(
    relPath: string,
    options?: { args?: string[]; timeoutSec?: number }
  ): Promise<TerminalExecutionResult> {
    return (await this.bridge.desktopExecute("terminal_run_file", {
      path: relPath,
      args: options?.args,
      timeoutSec: options?.timeoutSec ?? 30,
    })) as TerminalExecutionResult;
  }

  async runCode(
    language: "python" | "javascript" | "node" | "typescript" | "powershell" | "batch" | "go" | "php" | string,
    code: string,
    options?: { timeoutSec?: number }
  ): Promise<TerminalExecutionResult> {
    return (await this.bridge.desktopExecute("terminal_run_code", {
      language,
      code,
      timeoutSec: options?.timeoutSec ?? 30,
    })) as TerminalExecutionResult;
  }

  async kill(jobId: string): Promise<{ ok: boolean; jobId?: string }> {
    return (await this.bridge.desktopExecute("terminal_kill", { jobId })) as { ok: boolean; jobId?: string };
  }

  dispose(): void {
    this.unsub?.();
    this.outputListeners.clear();
  }
}

export function createSandboxTerminalClient(bridge: SandboxTerminalTransport): SandboxTerminalClient {
  return new SandboxTerminalClient(bridge);
}
