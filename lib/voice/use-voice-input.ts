"use client";

import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Real-time voice dictation via AssemblyAI's v3 streaming API. Ported from the
 * reference implementation: getUserMedia → AudioContext(16kHz) → inline
 * AudioWorklet (Float32→Int16 PCM) → WebSocket. The token is prefetched on mount
 * and refreshed in the background so it's ready the instant the user clicks.
 *
 * Only finalized turns fire `onTranscript`; interim text fires
 * `onPartialTranscript` (cleared on turn end). The mic stays hidden when no key
 * is configured (`voiceAvailable === false`).
 */

const WORKLET_SRC = /* js */ `
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let i = 0;
    while (i < input.length) {
      const remaining = this.buffer.length - this.offset;
      const toCopy = Math.min(remaining, input.length - i);
      this.buffer.set(input.subarray(i, i + toCopy), this.offset);
      this.offset += toCopy;
      i += toCopy;
      if (this.offset >= this.buffer.length) {
        this.port.postMessage(this.buffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`;

export type VoiceToken = { token?: string; error?: string };

export type UseVoiceInputOptions = {
  /** Async function returning a temporary streaming token. */
  getToken: () => Promise<VoiceToken>;
  /** Finalized transcript text (a completed turn). */
  onTranscript: (text: string) => void;
  /** Interim text while speaking; called with "" when the turn finalizes. */
  onPartialTranscript?: (text: string) => void;
  onError?: (error: string) => void;
  /** RMS volume (0–1-ish) per audio frame, for a level meter. */
  onVolumeChange?: (rms: number) => void;
};

export type UseVoiceInput = {
  voiceAvailable: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  startRecording: () => void;
  stopRecording: () => void;
};

export function useVoiceInput({
  getToken,
  onTranscript,
  onPartialTranscript,
  onError,
  onVolumeChange,
}: UseVoiceInputOptions): UseVoiceInput {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const cleaningUpRef = useRef(false);
  const connectingRef = useRef(false);

  // Prefetched token — valid 600s; refresh if older than 50s (10s safety margin).
  const tokenRef = useRef<string | null>(null);
  const tokenTimeRef = useRef(0);
  const TOKEN_MAX_AGE = 50_000;

  const fetchVoiceToken = useCallback(async (): Promise<VoiceToken> => {
    const result = await getToken();
    if (!result.error && result.token) {
      tokenRef.current = result.token;
      tokenTimeRef.current = Date.now();
      setVoiceAvailable(true);
    } else {
      setVoiceAvailable(false);
    }
    return result;
  }, [getToken]);

  // Prefetch on mount so the token is ready when the user clicks. setState runs
  // in the fetch's resolution callback (external system), not synchronously.
  useEffect(() => {
    let cancelled = false;
    getToken().then((r) => {
      if (cancelled) return;
      if (!r.error && r.token) {
        tokenRef.current = r.token;
        tokenTimeRef.current = Date.now();
        setVoiceAvailable(true);
      } else {
        setVoiceAvailable(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const getReadyToken = useCallback(async (): Promise<VoiceToken> => {
    if (tokenRef.current && Date.now() - tokenTimeRef.current < TOKEN_MAX_AGE) {
      const token = tokenRef.current;
      tokenRef.current = null; // single-use; refresh the next one in the background
      fetchVoiceToken();
      return { token };
    }
    return fetchVoiceToken();
  }, [fetchVoiceToken]);

  const cleanup = useCallback(() => {
    if (cleaningUpRef.current) return;
    cleaningUpRef.current = true;

    workletRef.current?.disconnect();
    workletRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "Terminate" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    connectingRef.current = false;
    setIsConnecting(false);
    setIsRecording(false);
    cleaningUpRef.current = false;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startRecording = useCallback(async () => {
    if (connectingRef.current || cleaningUpRef.current) return;
    connectingRef.current = true;
    setIsConnecting(true);

    try {
      const result = await getReadyToken();
      if (result.error || !result.token) {
        onError?.(result.error ?? "Voice unavailable");
        cleanup();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const ws = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?token=${result.token}&sample_rate=16000&encoding=pcm_s16le`,
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
        workletRef.current = workletNode;

        workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.data;
          const int16 = new Int16Array(float32.length);
          let sum = 0;
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            sum += s * s;
          }
          ws.send(int16.buffer);
          onVolumeChange?.(Math.sqrt(sum / float32.length));
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
        setIsConnecting(false);
        setIsRecording(true);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type?: string;
            transcript?: string;
            end_of_turn?: boolean;
          };
          if (data.type === "Turn") {
            const text = data.transcript?.trim();
            if (data.end_of_turn) {
              if (text) onTranscript(text);
              onPartialTranscript?.("");
            } else {
              onPartialTranscript?.(text || "");
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        onError?.("Voice connection error");
        cleanup();
      };
      ws.onclose = () => cleanup();
    } catch (err) {
      onError?.(
        (err as Error).name === "NotAllowedError"
          ? "Microphone permission denied"
          : "Failed to start voice input",
      );
      cleanup();
    }
  }, [getReadyToken, onTranscript, onPartialTranscript, onError, onVolumeChange, cleanup]);

  const stopRecording = useCallback(() => cleanup(), [cleanup]);

  return { voiceAvailable, isConnecting, isRecording, startRecording, stopRecording };
}
