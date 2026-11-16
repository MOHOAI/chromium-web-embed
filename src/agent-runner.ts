import type {
  AgentExecutionResult,
  SharedTabScreenshot,
} from "./protocol.js";
import type {
  ExecutedProviderAction,
  ProviderAdapter,
} from "./providers/types.js";
import {
  type AgentAuditEntry,
  type SafetyConfirmationHandler,
  SafetyPolicyEngine,
} from "./safety-policy.js";

export interface AgentActionExecutor {
  executeComputerAction(
    action: Record<string, unknown>,
    options?: {
      tabId?: number;
      provider?: string;
      callId?: string;
      safetyAcknowledged?: boolean;
    }
  ): Promise<AgentExecutionResult>;
  screenshot(options?: {
    tabId?: number;
    format?: "png" | "jpeg";
    quality?: number;
  }): Promise<SharedTabScreenshot>;
}

export interface AgentRunnerOptions<TResponse, TResult> {
  agent: AgentActionExecutor;
  adapter: ProviderAdapter<TResponse, TResult>;
  safety?: SafetyPolicyEngine;
  onSafetyConfirmation?: SafetyConfirmationHandler;
  turnLimit?: number;
  tabId?: number;
  onTurn?: (info: {
    turn: number;
    actions: ExecutedProviderAction[];
    response: TResponse;
  }) => void | Promise<void>;
}

export interface AgentRunResult<TResponse> {
  completed: boolean;
  turns: number;
  finalText: string;
  lastResponse: TResponse;
  auditLog: AgentAuditEntry[];
}

export class ComputerUseAgentRunner<TResponse = unknown, TResult = unknown> {
  private readonly agent: AgentActionExecutor;
  private readonly adapter: ProviderAdapter<TResponse, TResult>;
  private readonly safety: SafetyPolicyEngine;
  private readonly onSafetyConfirmation?: SafetyConfirmationHandler;
  private readonly turnLimit: number;
  private readonly tabId?: number;
  private readonly onTurn?: AgentRunnerOptions<TResponse, TResult>["onTurn"];

  constructor(options: AgentRunnerOptions<TResponse, TResult>) {
    this.agent = options.agent;
    this.adapter = options.adapter;
    this.safety = options.safety ?? new SafetyPolicyEngine();
    this.onSafetyConfirmation = options.onSafetyConfirmation;
    this.turnLimit = options.turnLimit ?? 15;
    this.tabId = options.tabId;
    this.onTurn = options.onTurn;
  }

  async run(
    initialPrompt: string,
    stepFn: (input: {
      turn: number;
      prompt?: string;
      initialScreenshot?: SharedTabScreenshot;
      toolResults?: TResult;
      previousResponse?: TResponse;
    }) => Promise<TResponse>
  ): Promise<AgentRunResult<TResponse>> {
    const initialScreenshot = await this.agent.screenshot({
      tabId: this.tabId,
      format: "png",
    });

    let response = await stepFn({
      turn: 0,
      prompt: initialPrompt,
      initialScreenshot,
    });

    for (let turn = 1; turn <= this.turnLimit; turn++) {
      if (this.adapter.isComplete(response)) {
        return {
          completed: true,
          turns: turn - 1,
          finalText: this.adapter.extractFinalText(response),
          lastResponse: response,
          auditLog: this.safety.getAuditLog(),
        };
      }

      const parsedActions = this.adapter.parseActions(response);
      const executed: ExecutedProviderAction[] = [];
      let batchHalted = false;

      for (const parsed of parsedActions) {
        if (batchHalted) {
          executed.push({
            parsed,
            skipped: true,
            result: {
              ok: false,
              actionType: parsed.action.type,
              tabId: this.tabId ?? 0,
              url: initialScreenshot.url,
              error: "Not executed: an earlier computer action in this turn failed.",
              durationMs: 0,
            },
          });
          continue;
        }

        const evaluatedDecision = this.safety.evaluateAction(
          parsed.action,
          parsed.safetyDecision
        );

        const confirmation = await this.safety.resolveConfirmation(
          {
            provider: this.adapter.providerId,
            action: parsed.action,
            decision: evaluatedDecision,
          },
          this.onSafetyConfirmation
        );

        if (!confirmation.approved) {
          const errMsg =
            evaluatedDecision.explanation ??
            `Action "${parsed.action.type}" rejected by safety policy (${evaluatedDecision.decision}).`;
          const failResult: AgentExecutionResult = {
            ok: false,
            actionType: parsed.action.type,
            tabId: this.tabId ?? 0,
            url: initialScreenshot.url,
            error: errMsg,
            durationMs: 0,
          };
          this.safety.recordAudit({
            timestamp: Date.now(),
            provider: this.adapter.providerId,
            actionType: parsed.action.type,
            intent: parsed.action.intent,
            safetyDecision: evaluatedDecision,
            userApproved: false,
            ok: false,
            error: errMsg,
            durationMs: 0,
          });
          executed.push({ parsed, result: failResult });
          if (this.adapter.providerId === "anthropic") {
            batchHalted = true;
          }
          continue;
        }

        const result = await this.agent.executeComputerAction(
          parsed.action as unknown as Record<string, unknown>,
          {
            tabId: this.tabId,
            provider: this.adapter.providerId,
            callId: parsed.callId,
            safetyAcknowledged:
              evaluatedDecision.decision === "require_confirmation" &&
              confirmation.approved,
          }
        );

        this.safety.recordAudit({
          timestamp: Date.now(),
          provider: this.adapter.providerId,
          actionType: parsed.action.type,
          intent: parsed.action.intent,
          url: result.url,
          safetyDecision: evaluatedDecision,
          userApproved:
            evaluatedDecision.decision === "require_confirmation"
              ? confirmation.approved
              : undefined,
          ok: result.ok,
          error: result.error,
          durationMs: result.durationMs,
        });

        executed.push({ parsed, result });
        if (!result.ok && this.adapter.providerId === "anthropic") {
          batchHalted = true;
        }
      }

      const latestScreenshot = await this.agent.screenshot({
        tabId: this.tabId,
        format: "png",
      });

      if (this.onTurn) {
        await this.onTurn({ turn, actions: executed, response });
      }

      const toolResults = this.adapter.formatResults(executed, latestScreenshot);
      response = await stepFn({
        turn,
        toolResults,
        previousResponse: response,
      });
    }

    return {
      completed: this.adapter.isComplete(response),
      turns: this.turnLimit,
      finalText: this.adapter.extractFinalText(response),
      lastResponse: response,
      auditLog: this.safety.getAuditLog(),
    };
  }
}
