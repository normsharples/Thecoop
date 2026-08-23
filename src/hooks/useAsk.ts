import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRestaurantScope } from "./useRestaurantScope";

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
  /** Which reporting functions produced the answer — shown under "How I got this". */
  steps?: AskStep[];
  error?: boolean;
}

export interface AskStep {
  tool: string;
  input: Record<string, unknown>;
  rows: number;
  error?: string;
}

interface AskResponse {
  answer?: string;
  steps?: AskStep[];
  error?: string;
  usage?: { input_tokens: number; output_tokens: number; model: string };
}

/**
 * Conversation state for the assistant drawer.
 *
 * The venue scope and current page ride along with every question, so "how did
 * we go today" means the venues in the switcher, the same as every other screen.
 */
export function useAsk(page?: string) {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const { ids, isAll } = useRestaurantScope();

  const reset = useCallback(() => setMessages([]), []);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isThinking) return;

      // Take the history BEFORE this question so the request carries the same
      // turns the user can see, then append theirs.
      const history = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setIsThinking(true);

      try {
        const { data, error } = await supabase.functions.invoke<AskResponse>("ask", {
          body: {
            messages: [...history, { role: "user", content: trimmed }],
            context: {
              // Empty selection means "all venues", which the function already
              // does by default — sending nothing keeps the prompt honest.
              restaurant_ids: isAll ? undefined : ids,
              page,
            },
          },
        });

        if (error) {
          // invoke() surfaces non-2xx as an error with the body on .context.
          let detail = error.message;
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            try {
              const body = (await ctx.json()) as AskResponse;
              if (body?.error) detail = body.error;
            } catch {
              /* keep the generic message */
            }
          }
          throw new Error(detail);
        }

        if (data?.error) throw new Error(data.error);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data?.answer ?? "No answer came back.",
            steps: data?.steps,
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              err instanceof Error
                ? err.message
                : "Something went wrong reaching the assistant.",
            error: true,
          },
        ]);
      } finally {
        setIsThinking(false);
      }
    },
    [messages, isThinking, ids, isAll, page]
  );

  return { messages, isThinking, send, reset };
}
