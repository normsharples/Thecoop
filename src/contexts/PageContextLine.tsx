import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * The topbar's second line.
 *
 * The page name alone tells you where you are but not what you are looking at.
 * Every page carries a different context — a venue and a period on the
 * dashboard, an unpublished-shift count on the roster — so the line is set by
 * the page, not by the layout's title map.
 *
 * The rule (DESIGN_SYSTEM.md → "Topbar context line"): scope, then period,
 * then at most one live count. Plain sentence case, separated by middots, no
 * numbers that already lead the page body.
 */
interface PageContextValue {
  line: string | null;
  setLine: (line: string | null) => void;
}

const PageContextLine = createContext<PageContextValue>({
  line: null,
  setLine: () => {},
});

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [line, setLine] = useState<string | null>(null);
  return (
    <PageContextLine.Provider value={{ line, setLine }}>{children}</PageContextLine.Provider>
  );
}

/** Read the current line — the topbar, and nothing else. */
export function usePageContextLine(): string | null {
  return useContext(PageContextLine).line;
}

/** Set the line for as long as the calling page is mounted. */
export function useSetPageContextLine(line: string | null): void {
  const { setLine } = useContext(PageContextLine);
  useEffect(() => {
    setLine(line);
    return () => setLine(null);
  }, [line, setLine]);
}
