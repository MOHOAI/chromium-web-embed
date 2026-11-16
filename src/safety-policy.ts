import type {
  SafetyDecision,
  SafetyPolicyCategory,
  UnifiedComputerAction,
} from "./protocol.js";

export interface SafetyPolicyConfig {
  /** Allowed hostnames or URL prefixes (if non-empty, all other URLs are blocked). */
  allowlist?: string[];
  /** Blocked hostnames or URL prefixes (checked before allowlist). */
  blocklist?: string[];
  /** Gemini safety policies explicitly disabled by the caller. */
  disabledSafetyPolicies?: SafetyPolicyCategory[];
  /** Require human confirmation before any navigation outside allowlist or form submission. */
  requireConfirmationForNavigation?: boolean;
  /** Maximum number of audit entries retained in memory. */
  maxAuditEntries?: number;
}

export interface SafetyConfirmationPrompt {
  provider: string;
  action: UnifiedComputerAction;
  decision: SafetyDecision;
  currentUrl?: string;
}

export type SafetyConfirmationHandler = (
  prompt: SafetyConfirmationPrompt
) => Promise<"CONTINUE" | "TERMINATE" | boolean> | "CONTINUE" | "TERMINATE" | boolean;

export interface AgentAuditEntry {
  timestamp: number;
  provider: string;
  actionType: string;
  intent?: string;
  url?: string;
  safetyDecision?: SafetyDecision;
  userApproved?: boolean;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export const DEFAULT_COMPUTER_USE_SYSTEM_INSTRUCTION = `## RULE 1: Seek User Confirmation (USER_CONFIRMATION)
Before executing any consequential or irreversible action, pause and seek explicit user confirmation:
- Consent & Agreements: Terms of Service, Privacy Policies, Cookie banners, EULAs, or legal contracts.
- Robot Detection: CAPTCHAs or human-verification challenges.
- Financial Transactions: Purchases, transfers, payments, or regulated goods.
- Sending Communications: Sending emails, chat messages, or social media posts.
- Sensitive Information: Health, financial, or government records, or sensitive identifiers.
- User Data Management: Downloading/saving files or transferring user data.
- Browser Data & Identity: Saved passwords, autofill, history, or logging into user accounts.

## RULE 2: Default Behavior (ACTUATE)
If an action does not fall under USER_CONFIRMATION, actuate proactively step-by-step until the task is complete, verifying the screen state after each step.`;

function matchesPattern(urlStr: string, pattern: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const cleanPattern = pattern.trim().toLowerCase();
    if (!cleanPattern) return false;
    if (cleanPattern.startsWith("http://") || cleanPattern.startsWith("https://")) {
      return urlStr.toLowerCase().startsWith(cleanPattern);
    }
    const host = parsed.hostname.toLowerCase();
    if (cleanPattern.startsWith("*.")) {
      const domain = cleanPattern.slice(2);
      return host === domain || host.endsWith(`.${domain}`);
    }
    return host === cleanPattern || host.endsWith(`.${cleanPattern}`);
  } catch {
    return false;
  }
}

export class SafetyPolicyEngine {
  private readonly config: SafetyPolicyConfig;
  private readonly auditLog: AgentAuditEntry[] = [];

  constructor(config: SafetyPolicyConfig = {}) {
    this.config = config;
  }

  isUrlAllowed(url: string): { allowed: boolean; reason?: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        allowed: false,
        reason: `Blocked non-HTTP(S) protocol "${parsed.protocol}"`,
      };
    }

    if (this.config.blocklist?.some((p) => matchesPattern(url, p))) {
      return { allowed: false, reason: `URL "${url}" matched blocklist` };
    }

    if (
      this.config.allowlist &&
      this.config.allowlist.length > 0 &&
      !this.config.allowlist.some((p) => matchesPattern(url, p))
    ) {
      return { allowed: false, reason: `URL "${url}" is not in allowlist` };
    }

    return { allowed: true };
  }

  evaluateAction(
    action: UnifiedComputerAction,
    incomingDecision?: SafetyDecision
  ): SafetyDecision {
    if (action.type === "navigate") {
      const check = this.isUrlAllowed(action.url);
      if (!check.allowed) {
        return {
          decision: "blocked",
          explanation: check.reason,
        };
      }
      if (this.config.requireConfirmationForNavigation) {
        return {
          decision: "require_confirmation",
          explanation: `Confirm navigation to ${action.url}`,
        };
      }
    }

    if (incomingDecision) {
      if (
        incomingDecision.category &&
        this.config.disabledSafetyPolicies?.includes(
          incomingDecision.category as SafetyPolicyCategory
        ) &&
        incomingDecision.decision === "require_confirmation"
      ) {
        return {
          ...incomingDecision,
          decision: "allowed",
        };
      }
      return incomingDecision;
    }

    return { decision: "allowed" };
  }

  async resolveConfirmation(
    prompt: SafetyConfirmationPrompt,
    handler?: SafetyConfirmationHandler
  ): Promise<{ approved: boolean; decision: SafetyDecision }> {
    if (prompt.decision.decision === "blocked") {
      return { approved: false, decision: prompt.decision };
    }
    if (prompt.decision.decision === "allowed") {
      return { approved: true, decision: prompt.decision };
    }
    if (!handler) {
      return { approved: false, decision: prompt.decision };
    }
    const result = await handler(prompt);
    const approved = result === true || result === "CONTINUE";
    return { approved, decision: prompt.decision };
  }

  recordAudit(entry: AgentAuditEntry): void {
    this.auditLog.push(entry);
    const maxEntries = this.config.maxAuditEntries ?? 500;
    if (this.auditLog.length > maxEntries) {
      this.auditLog.splice(0, this.auditLog.length - maxEntries);
    }
  }

  getAuditLog(): AgentAuditEntry[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog.length = 0;
  }
}
