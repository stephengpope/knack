"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Mic, Loader2, ArrowRight, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useVoiceInput } from "@/lib/voice/use-voice-input";
import { getVoiceTokenAction } from "@/lib/voice/actions";
import { taskHelperTurnAction } from "@/app/(app)/board/task-helper-actions";
import type {
  ClarifyRound,
  TicketDraft,
} from "@/lib/task-helper/types";
import { VoiceBars } from "@/components/board/voice-bars";

type Phase = "capture" | "questions" | "review";
type Persisted = {
  phase: Phase;
  brief: string;
  rounds: ClarifyRound[];
  questions: string[];
  answers: string[];
  draft: TicketDraft | null;
};
// Active dictation target: the brief textarea, or an answer index.
type Target = "brief" | number;

const joinText = (base: string, add: string) =>
  base + (base && !base.endsWith(" ") ? " " : "") + add;

// Read saved progress for a card (survives drawer close/reopen + page reload).
function loadPersisted(cardId: string): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`taskhelper:${cardId}`);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export function TaskHelperDialog({
  cardId,
  cardRef,
  open,
  onOpenChange,
  onApply,
}: {
  cardId: string;
  cardRef: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (draft: TicketDraft, alsoPlan: boolean) => void;
}) {
  const storageKey = `taskhelper:${cardId}`;

  // Restore once on mount; the component remounts per drawer-open, so this also
  // resumes after a close/reopen or reload.
  const [persisted] = useState(() => loadPersisted(cardId));
  const [phase, setPhase] = useState<Phase>(persisted?.phase ?? "capture");
  const [brief, setBrief] = useState(persisted?.brief ?? "");
  const [rounds, setRounds] = useState<ClarifyRound[]>(persisted?.rounds ?? []);
  const [questions, setQuestions] = useState<string[]>(persisted?.questions ?? []);
  const [answers, setAnswers] = useState<string[]>(persisted?.answers ?? []);
  const [draft, setDraft] = useState<TicketDraft | null>(persisted?.draft ?? null);
  const [loading, setLoading] = useState(false);

  // Dictation: one mic routed to whichever field was last focused.
  const [target, setTarget] = useState<Target>("brief");
  const [partial, setPartial] = useState("");
  const volumeRef = useRef(0);

  // Persist on change; a fresh/empty card leaves no record (so reset clears it).
  useEffect(() => {
    const empty =
      phase === "capture" && !brief.trim() && rounds.length === 0 && !draft;
    try {
      if (empty) localStorage.removeItem(storageKey);
      else
        localStorage.setItem(
          storageKey,
          JSON.stringify({ phase, brief, rounds, questions, answers, draft }),
        );
    } catch {
      /* quota — non-fatal */
    }
  }, [storageKey, phase, brief, rounds, questions, answers, draft]);

  function reset() {
    setPhase("capture");
    setBrief("");
    setRounds([]);
    setQuestions([]);
    setAnswers([]);
    setDraft(null);
    setTarget("brief");
    setPartial("");
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  // ── voice ─────────────────────────────────────────────────────────────────
  const appendToTarget = useCallback(
    (text: string) => {
      if (target === "brief") setBrief((b) => joinText(b, text));
      else
        setAnswers((a) =>
          a.map((v, i) => (i === target ? joinText(v, text) : v)),
        );
    },
    [target],
  );

  const { voiceAvailable, isConnecting, isRecording, startRecording, stopRecording } =
    useVoiceInput({
      getToken: getVoiceTokenAction,
      onVolumeChange: (rms) => {
        volumeRef.current = rms;
      },
      onTranscript: appendToTarget,
      onPartialTranscript: setPartial,
      onError: (e) => toast.error(e),
    });

  // Display value with the live partial folded into the focused field.
  const withPartial = (t: Target, base: string) =>
    isRecording && target === t && partial ? joinText(base, partial) : base;

  // ── turn calls ──────────────────────────────────────────────────────────
  async function runTurn(nextRounds: ClarifyRound[]) {
    if (isRecording) stopRecording();
    setPartial("");
    setLoading(true);
    try {
      const r = await taskHelperTurnAction({ brief, rounds: nextRounds });
      if (r.done && r.ticketDraft) {
        setDraft(r.ticketDraft);
        setPhase("review");
      } else {
        setQuestions(r.questions);
        setAnswers(r.questions.map(() => ""));
        setTarget(0);
        setPhase("questions");
      }
    } catch {
      toast.error("The Task Helper hit an error — try again.");
    } finally {
      setLoading(false);
    }
  }

  function submitBrief() {
    if (!brief.trim()) return;
    void runTurn([]);
  }

  function submitAnswers() {
    const committed = [...rounds, { questions, answers }];
    setRounds(committed);
    void runTurn(committed);
  }

  function apply(alsoPlan: boolean) {
    if (!draft) return;
    onApply(draft, alsoPlan);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && isRecording) stopRecording();
        onOpenChange(o);
      }}
    >
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-5 text-primary" />
            Task Helper
            <span className="ml-1 text-xs font-semibold text-ink-faint">
              {cardRef}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {phase === "capture" && (
            <CapturePhase
              brief={withPartial("brief", brief)}
              onBrief={setBrief}
              onFocus={() => setTarget("brief")}
            />
          )}

          {phase === "questions" && (
            <QuestionsPhase
              roundNo={rounds.length + 1}
              questions={questions}
              valueFor={(i) => withPartial(i, answers[i])}
              onAnswer={(i, v) =>
                setAnswers((a) => a.map((x, j) => (j === i ? v : x)))
              }
              onFocus={(i) => setTarget(i)}
            />
          )}

          {phase === "review" && draft && <ReviewPhase draft={draft} />}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-sm font-semibold text-ink-soft backdrop-blur-sm">
              <Loader2 className="size-4 animate-spin" />
              Thinking…
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3.5">
          {phase !== "review" && voiceAvailable && (
            <MicButton
              isRecording={isRecording}
              isConnecting={isConnecting}
              volumeRef={volumeRef}
              onClick={() => (isRecording ? stopRecording() : startRecording())}
            />
          )}

          {phase !== "capture" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={loading}
              className="gap-1.5 text-ink-soft"
            >
              <RotateCcw className="size-3.5" />
              Start over
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {phase === "capture" && (
              <Button
                onClick={submitBrief}
                disabled={loading || !brief.trim()}
                className="gap-1.5"
              >
                Continue <ArrowRight className="size-4" />
              </Button>
            )}
            {phase === "questions" && (
              <Button
                onClick={submitAnswers}
                disabled={loading}
                className="gap-1.5"
              >
                Submit answers <ArrowRight className="size-4" />
              </Button>
            )}
            {phase === "review" && (
              <>
                <Button variant="outline" onClick={() => apply(false)}>
                  Update
                </Button>
                <Button onClick={() => apply(true)} className="gap-1.5">
                  Update &amp; Plan
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CapturePhase({
  brief,
  onBrief,
  onFocus,
}: {
  brief: string;
  onBrief: (v: string) => void;
  onFocus: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          The Task Helper rewrites this card&apos;s <b>Goal</b>, <b>Details</b>,
          and <b>Acceptance criteria</b> when you Update. Anything there now will
          be replaced.
        </span>
      </div>
      <div>
        <Label>What do you want done?</Label>
        <Textarea
          autoFocus
          value={brief}
          onChange={(e) => onBrief(e.target.value)}
          onFocus={onFocus}
          rows={7}
          placeholder={
            'I want ___ so that ___ — e.g. "I want a 3-day Lisbon trip planned and booked so it’s all set before Friday."'
          }
          className="mt-1.5 resize-none"
        />
        <p className="mt-2 text-xs text-ink-faint">
          Rough is fine — the helper will ask about anything unclear.
        </p>
      </div>
    </div>
  );
}

function QuestionsPhase({
  roundNo,
  questions,
  valueFor,
  onAnswer,
  onFocus,
}: {
  roundNo: number;
  questions: string[];
  valueFor: (i: number) => string;
  onAnswer: (i: number, v: string) => void;
  onFocus: (i: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label>A few questions</Label>
        <span className="text-xs font-bold text-ink-faint">
          Round {roundNo}
        </span>
      </div>
      {questions.map((q, i) => (
        <div
          key={i}
          className="rounded-lg border bg-card p-3.5"
        >
          <div className="mb-2 flex gap-2 text-sm font-semibold leading-snug">
            <span className="text-ink-faint">{i + 1}.</span>
            <span>{q}</span>
          </div>
          <Textarea
            value={valueFor(i)}
            onChange={(e) => onAnswer(i, e.target.value)}
            onFocus={() => onFocus(i)}
            rows={2}
            placeholder="Your answer… (leave blank if it doesn't matter)"
            className="resize-none text-sm"
          />
        </div>
      ))}
    </div>
  );
}

function ReviewPhase({ draft }: { draft: TicketDraft }) {
  return (
    <div className="space-y-5">
      <Field label="Title" value={draft.title} />
      <Field label="Goal" value={draft.userStory} />
      <Field label="Details" value={draft.details} multiline />
      <div>
        <Label>Acceptance criteria</Label>
        <ul className="mt-2 space-y-1.5">
          {draft.acceptanceCriteria.map((c, i) => (
            <li
              key={i}
              className="flex gap-2.5 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span className="text-ink-faint">{i + 1}.</span>
              <span>{c}</span>
            </li>
          ))}
          {draft.acceptanceCriteria.length === 0 && (
            <li className="text-xs text-ink-faint">(none)</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <p
        className={cn(
          "mt-1.5 rounded-md border bg-card px-3 py-2.5 text-sm leading-relaxed",
          multiline && "whitespace-pre-wrap",
        )}
      >
        {value || <span className="text-ink-faint">(empty)</span>}
      </p>
    </div>
  );
}

function MicButton({
  isRecording,
  isConnecting,
  volumeRef,
  onClick,
}: {
  isRecording: boolean;
  isConnecting: boolean;
  volumeRef: React.RefObject<number>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // Keep the focused field's target — clicking the mic must not steal focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={isRecording ? "Stop dictation" : "Dictate"}
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors",
        isRecording
          ? "border-black bg-black text-white"
          : "border-input text-ink-soft hover:bg-accent",
      )}
    >
      {isConnecting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isRecording ? (
        <VoiceBars volumeRef={volumeRef} isRecording={isRecording} />
      ) : (
        <Mic className="size-4" />
      )}
      {isRecording ? "Listening…" : isConnecting ? "Connecting…" : "Dictate"}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  );
}
