import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loginAO3, logoutAO3, getSessionCookie } from "../api/ao3Auth";

export function useAO3Session() {
  const [session, setSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const cookie = await getSessionCookie();
      setSession(cookie);
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    try {
      const ok = await loginAO3(username, password);
      if (ok) {
        const cookie = await getSessionCookie();
        setSession(cookie);
        // Log the loaded session cookie (or token) so it's visible in the terminal/Metro logs
        console.log("[useAO3Session] login succeeded, session:", cookie);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await logoutAO3();
    setSession(null);
  };

  return { session, loading, login, logout };
}
