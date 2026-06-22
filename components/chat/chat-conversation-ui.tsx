"use client";

import { isToolUIPart, type UIMessage } from "ai";
import { cn } from "@/lib/utils";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";

type Decision = {
  verdict: "continue" | "review" | "blocked";
  reason: string;
  nextPrompt: string | null;
};

const VERDICT: Record<Decision["verdict"], { label: string; cls: string }> = {
  continue: { label: "continue", cls: "bg-blue-500/12 text-blue-600" },
  review: { label: "review", cls: "bg-amber-500/14 text-amber-600" },
  blocked: { label: "blocked", cls: "bg-red-500/12 text-red-600" },
};

/**
 * Read-only renderer for a chat's messages — the same `ai-elements` components
 * the chat page uses, plus a decision card for the supervisor's `data-decision`
 * parts. No composer, no streaming loader.
 */
export function ChatConversationUI({ messages }: { messages: UIMessage[] }) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        if (m.role === "user") {
          return (
            <Message key={m.id} from="user">
              <MessageContent>
                {m.parts.map((p, i) =>
                  p.type === "text" ? (
                    <span key={i} className="whitespace-pre-wrap">
                      {p.text}
                    </span>
                  ) : null,
                )}
              </MessageContent>
            </Message>
          );
        }
        return (
          <div key={m.id} className="flex gap-3">
            <Message from="assistant" className="max-w-full flex-1">
              <MessageContent>
                {m.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <MessageResponse key={i}>{part.text}</MessageResponse>;
                  }
                  if (part.type === "reasoning") {
                    return (
                      <Reasoning key={i} isStreaming={false}>
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );
                  }
                  if (isToolUIPart(part)) {
                    const tp = part;
                    return (
                      <Tool key={i}>
                        <ToolHeader
                          type={tp.type as `tool-${string}`}
                          state={tp.state}
                        />
                        <ToolContent>
                          <ToolInput input={tp.input} />
                          <ToolOutput output={tp.output} errorText={tp.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  if (part.type === "data-decision") {
                    return (
                      <DecisionCard
                        key={i}
                        d={(part as { data: Decision }).data}
                      />
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          </div>
        );
      })}
    </div>
  );
}

function DecisionCard({ d }: { d: Decision }) {
  const v = VERDICT[d.verdict] ?? VERDICT.continue;
  return (
    <div className="mt-1 rounded-xl border bg-muted/40 p-3">
      <span
        className={cn(
          "inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
          v.cls,
        )}
      >
        ▸ {v.label}
      </span>
      {d.reason && (
        <div className="mt-2 text-[13px] leading-snug">{d.reason}</div>
      )}
      {d.nextPrompt && (
        <div className="mt-2 rounded-lg border bg-background px-3 py-2 text-[12.5px] leading-snug">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
            Next prompt → worker
          </div>
          {d.nextPrompt}
        </div>
      )}
    </div>
  );
}
