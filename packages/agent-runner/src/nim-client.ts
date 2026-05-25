import type { RateLimiter } from "./rate-limiter.js";
import { safeSleep } from "./rate-limiter.js";

export interface NimClientConfig {
  apiBase: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  requestTimeoutMs?: number;
}

export const DEFAULT_NIM_CONFIG: Partial<NimClientConfig> = {
  maxTokens: 256,
  temperature: 0.3,
  requestTimeoutMs: 20000,
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number } | null;
}

export class NimClient {
  private config: NimClientConfig;
  private rateLimiter: RateLimiter;

  constructor(config: NimClientConfig, rateLimiter: RateLimiter) {
    this.config = { ...DEFAULT_NIM_CONFIG, ...config };
    this.rateLimiter = rateLimiter;
  }

  async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<LLMResponse> {
    await this.rateLimiter.waitForToken(signal);

    const backoff = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
    for (let attempt = 0; attempt < backoff.length + 1; attempt++) {
      const timeoutMs = this.config.requestTimeoutMs ?? 20000;

      try {
        // Create a per-request abort controller for timeout
        const requestController = new AbortController();
        const timeoutId = setTimeout(() => requestController.abort(), timeoutMs);

        // If external signal is already aborted, throw immediately
        if (signal?.aborted) {
          clearTimeout(timeoutId);
          throw new Error("Aborted");
        }

        // Forward external abort to our request controller
        const onExternalAbort = () => requestController.abort();
        signal?.addEventListener("abort", onExternalAbort, { once: true });

        const res = await fetch(`${this.config.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
          }),
          signal: requestController.signal,
        });

        // Clean up timeout and listener
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onExternalAbort);

        if (res.status === 429) {
          const retryMs = backoff[attempt] ?? 60000;
          console.warn(`[nim:${this.config.model}] 429 rate limited, retrying in ${retryMs}ms (attempt ${attempt + 1})`);
          await safeSleep(retryMs, signal);
          await this.rateLimiter.waitForToken(signal);
          continue;
        }

        if (res.status === 503 || res.status >= 500) {
          const retryMs = backoff[attempt] ?? 60000;
          console.warn(`[nim:${this.config.model}] server error ${res.status}, retrying in ${retryMs}ms`);
          await safeSleep(retryMs, signal);
          continue;
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`API error ${res.status}: ${body.slice(0, 200)}`);
        }

        const data = await res.json() as {
          choices: Array<{ message: { content: string }; finish_reason: string }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };

        const choice = data.choices?.[0];
        if (!choice) throw new Error("No choices in response");

        return {
          content: choice.message.content,
          finishReason: choice.finish_reason,
          usage: data.usage
            ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
            : null,
        };
      } catch (err) {
        if (signal?.aborted) throw err;
        if (attempt >= backoff.length) throw err;
        const retryMs = backoff[attempt]!;
        console.warn(`[nim:${this.config.model}] request failed: ${(err as Error).message}, retrying in ${retryMs}ms`);
        await safeSleep(retryMs, signal);
      }
    }

    throw new Error("NIM client exhausted retries");
  }
}
