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
 * The chat message list — the single source of truth for rendering a
 * conversation, used by both the chat page and the supervisor-chat popup. Adds a
 * decision card for the supervisor's `data-decision` parts. Returns a fragment;
 * the caller supplies the scroll/layout wrapper.
 */
export function ChatConversationUI({
  messages,
  streaming = false,
}: {
  messages: UIMessage[];
  streaming?: boolean;
}) {
  return (
    <>
      {messages.map((m) => {
        if (m.role === "user") {
          return (
            <Message key={m.id} from="user">
              <MessageContent>
                {m.parts.map((part, i) =>
                  part.type === "text" ? (
                    <span key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  ) : null,
                )}
              </MessageContent>
            </Message>
          );
        }
        // Skip an assistant message until it has real content (avoids an empty
        // bubble flashing in before the first token).
        const hasRenderable = m.parts.some(
          (p) =>
            (p.type === "text" && p.text.trim().length > 0) ||
            (p.type === "reasoning" && p.text.trim().length > 0) ||
            isToolUIPart(p) ||
            p.type === "data-decision",
        );
        if (!hasRenderable) return null;
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
                      <Reasoning key={i} isStreaming={streaming}>
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
    </>
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
