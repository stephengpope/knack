"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { ChevronDown, Share, Star, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  renameChatAction,
  deleteChatAction,
  toggleStarAction,
} from "@/app/(app)/actions";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
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
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { AgentMark, Logomark } from "@/components/brand/logo";
import { ModelPicker } from "@/components/chat/model-picker";
import { DEFAULT_MODEL, type ModelOption } from "@/lib/models";

export function Chat({
  id,
  initialMessages,
  initialModel,
  title,
  starred = false,
  userName,
  models = [],
}: {
  id: string;
  initialMessages: UIMessage[];
  initialModel?: string | null;
  title?: string | null;
  starred?: boolean;
  userName: string;
  models?: ModelOption[];
}) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel ?? DEFAULT_MODEL);
  const [chatTitle, setChatTitle] = useState(title ?? "");
  const [isStarred, setIsStarred] = useState(starred);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title ?? "");
  const navigated = useRef(false);

  function startRename() {
    setRenameValue(chatTitle);
    setRenaming(true);
  }
  function commitRename() {
    setRenaming(false);
    const next = renameValue.trim();
    if (next && next !== chatTitle) {
      setChatTitle(next);
      renameChatAction(id, next);
    }
  }
  function toggleStar() {
    setIsStarred((s) => !s);
    toggleStarAction(id);
  }
  function deleteChat() {
    router.push("/");
    deleteChatAction(id);
  }
  // only the first completed turn of a NEW chat needs a server refresh
  const needsSidebarRefresh = useRef(initialMessages.length === 0);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agent" }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id,
    messages: initialMessages,
    transport,
    onFinish: () => {
      if (needsSidebarRefresh.current) {
        needsSidebarRefresh.current = false;
        router.refresh();
      }
    },
  });

  const isWelcome = messages.length === 0;

  function submit(message: PromptInputMessage) {
    const text = message.text?.trim();
    if (!text) return;
    if (isWelcome && !navigated.current) {
      navigated.current = true;
      window.history.replaceState({}, "", `/chat/${id}`);
    }
    sendMessage({ text }, { body: { model } });
  }

  const composer = (
    <PromptInput
      onSubmit={submit}
      className="rounded-2xl border-input bg-card shadow-[0_14px_40px_-34px_var(--shadow)]"
    >
      <PromptInputBody>
        <PromptInputTextarea
          placeholder={isWelcome ? "How can I help you today?" : "Reply to Knack…"}
          autoFocus
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <ModelPicker
            model={model}
            onModelChange={setModel}
            models={models}
          />
        </PromptInputTools>
        <PromptInputSubmit
          status={status}
          onStop={stop}
          className="knack-gradient knack-glow size-9 rounded-[11px] text-white"
        />
      </PromptInputFooter>
    </PromptInput>
  );

  if (isWelcome) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 flex items-center gap-4">
          <Logomark size={38} strokeWidth={1.6} />
          <h1 className="font-heading text-[42px] font-medium tracking-[-0.02em]">
            Hey there, {userName.split(" ")[0]}
          </h1>
        </div>
        <div className="w-full max-w-[780px]">{composer}</div>
      </div>
    );
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="min-w-0 max-w-[420px] flex-1 rounded-[9px] border border-primary bg-background px-2.5 py-1.5 text-[14.5px] font-bold outline-none"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-0.5">
            <div
              onDoubleClick={startRename}
              title="Double-click to rename"
              className="-ml-2 min-w-0 truncate rounded-md px-2 py-1 text-[14.5px] font-bold transition-colors hover:bg-accent"
            >
              {chatTitle || "New chat"}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Chat options"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint outline-none transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
              >
                <ChevronDown className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[168px]">
                <DropdownMenuItem onClick={toggleStar}>
                  <Star
                    className={cn(
                      "size-[15px]",
                      isStarred && "fill-primary text-primary",
                    )}
                  />
                  {isStarred ? "Unstar" : "Star"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={startRename}>
                  <Pencil className="size-[15px]" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={deleteChat}>
                  <Trash2 className="size-[15px]" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => toast("Sharing is coming soon")}
            className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold transition-colors hover:bg-accent"
          >
            <Share className="size-[15px]" /> Share
          </button>
        </div>
      </header>

      <Conversation>
        <ConversationContent className="mx-auto max-w-[780px]">
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
            return (
              <div key={m.id} className="flex gap-3">
                <AgentMark size={30} className="mt-1 shrink-0" />
                <Message from="assistant" className="max-w-full flex-1">
                  <MessageContent>
                    {m.parts.map((part, i) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={i}>{part.text}</MessageResponse>
                        );
                      }
                      if (part.type === "reasoning") {
                        return (
                          <Reasoning
                            key={i}
                            isStreaming={status === "streaming"}
                          >
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
                              <ToolOutput
                                output={tp.output}
                                errorText={tp.errorText}
                              />
                            </ToolContent>
                          </Tool>
                        );
                      }
                      return null;
                    })}
                  </MessageContent>
                </Message>
              </div>
            );
          })}
          {status === "submitted" && (
            <div className="flex items-center gap-3">
              <AgentMark size={30} className="shrink-0" />
              <div className="flex items-center gap-1.5 rounded-[14px] border border-input bg-muted px-4 py-3.5">
                {[0, 0.2, 0.4].map((d) => (
                  <span
                    key={d}
                    className="size-[7px] rounded-full bg-primary"
                    style={{ animation: `knack-blink 1.2s ${d}s infinite` }}
                  />
                ))}
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="px-6 pb-5 pt-1.5">
        <div className="mx-auto max-w-[780px]">{composer}</div>
      </div>
    </>
  );
}
