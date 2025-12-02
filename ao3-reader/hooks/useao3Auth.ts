import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loginAO3, logoutAO3, getSessionCookie, getUsername, getLoggedUsername } from "../api/ao3Auth";

export function useAO3Session() {
  const [session, setSession] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const cookie = await getSessionCookie();
      let user = await getUsername();
      
      // If we have a session but no cached username, fetch it from the 302 redirect
      if (cookie && !user) {
        user = await getLoggedUsername();
        if (user) {
          console.log("[useAO3Session] init: fetched username from 302 redirect:", user);
        }
      }
      
      setSession(cookie);
      setUsername(user);
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    try {
      const ok = await loginAO3(username, password);
      if (ok) {
        const cookie = await getSessionCookie();
        const user = await getUsername();
        setSession(cookie);
        setUsername(user);
        // Log the loaded session cookie (or token) so it's visible in the terminal/Metro logs
        console.log("[useAO3Session] login succeeded, session:", cookie, "username:", user);
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
    setUsername(null);
  };

  return { session, username, loading, login, logout };
}