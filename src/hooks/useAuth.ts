import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
}

export function useAuth(): AuthState & {
  signIn: (identifier: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
} {
  const [state, setState] = useState<{
    user: User | null;
    session: Session | null;
    profile: Profile | null;
    isLoading: boolean;
  }>({
    user: null,
    session: null,
    profile: null,
    isLoading: true,
  });

  const queryClient = useQueryClient();
  // Prevent double-fire from React StrictMode unmount/remount
  const initializedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function loadSessionAndProfile(sessionArg: Session | null) {
      if (!mounted) return;

      if (!sessionArg?.user) {
        setState({ user: null, session: null, profile: null, isLoading: false });
        return;
      }

      // Fetch profile in the same async step — no intermediate render with user+no profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", sessionArg.user.id)
        .single();

      if (!mounted) return;
      setState({
        user: sessionArg.user,
        session: sessionArg,
        profile: profile ?? null,
        isLoading: false,
      });
    }

    // Use getSession() for the initial load (avoids INITIAL_SESSION double-fire in StrictMode)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initializedRef.current) {
        initializedRef.current = true;
        loadSessionAndProfile(session);
      }
    });

    // Watch for subsequent auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!initializedRef.current) return; // Still waiting for getSession
        if (!mounted) return;
        if (!newSession) {
          queryClient.clear();
          setState({ user: null, session: null, profile: null, isLoading: false });
        } else {
          loadSessionAndProfile(newSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  const signIn = async (identifier: string, password: string) => {
    // Usernames map to a synthetic email; real emails (containing "@") pass through as-is.
    const email = identifier.includes("@")
      ? identifier.trim()
      : `${identifier.trim().toLowerCase()}@thecoop.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
  };

  return { ...state, signIn, signOut };
}
