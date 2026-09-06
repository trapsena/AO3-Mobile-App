import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = "https://archiveofourown.org";
const SESSION_KEY = "ao3_session_cookie";
const USERNAME_KEY = "ao3_username";
const COOKIES_KEY = "ao3_all_cookies";
const SESSION_COOKIE_NAME = "_otwarchive_session";
const AUTH_STORAGE_KEYS = [SESSION_KEY, USERNAME_KEY, COOKIES_KEY];

/**
 * Extract specific cookies from set-cookie header string
 */
function extractCookies(setCookieHeader: string | null): { [key: string]: string } {
  const cookies: { [key: string]: string } = {};
  
  if (!setCookieHeader) return cookies;
  
  // Handle multiple cookies separated by commas (but be careful with cookie values that might contain commas)
  const cookieStrings = setCookieHeader.split(/,(?=\s*[a-zA-Z_]+\s*=)/);
  
  cookieStrings.forEach((cookieStr) => {
    const parts = cookieStr.split(";")[0].trim();
    const [name, ...valueParts] = parts.split("=");
    const value = valueParts.join("=");
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  });
  
  return cookies;
}

function buildCookieHeaderFromCookies(cookies: { [key: string]: string }): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function saveResponseCookies(response: Response) {
  const setCookieHeader = response.headers.get("set-cookie");
  if (!setCookieHeader) return;

  const responseCookies = extractCookies(setCookieHeader);
  if (Object.keys(responseCookies).length === 0) return;

  try {
    const saved = await AsyncStorage.getItem(COOKIES_KEY);
    const savedCookies = saved ? JSON.parse(saved) : {};
    const nextCookies = { ...savedCookies, ...responseCookies };
    await AsyncStorage.setItem(COOKIES_KEY, JSON.stringify(nextCookies));

    if (responseCookies[SESSION_COOKIE_NAME]) {
      await AsyncStorage.setItem(SESSION_KEY, buildCookieHeaderFromCookies(nextCookies));
    }
  } catch (e) {
    console.warn("[ao3Auth] saveResponseCookies: Error saving response cookies:", e);
  }
}

async function clearStoredAO3Auth() {
  const keys = await AsyncStorage.getAllKeys();
  const staleSessionKeys = keys.filter((key) => {
    const normalized = key.toLowerCase();
    return (
      AUTH_STORAGE_KEYS.includes(key) ||
      normalized.includes("otwarchive") ||
      normalized.includes("_otwarchive_session")
    );
  });

  if (staleSessionKeys.length > 0) {
    await AsyncStorage.multiRemove(staleSessionKeys);
  }
}

/**
 * Build cookie string from saved cookies
 */
async function buildCookieHeader(): Promise<string> {
  const saved = await AsyncStorage.getItem(COOKIES_KEY);
  if (!saved) return "";
  
  try {
    const cookies = JSON.parse(saved);
    return buildCookieHeaderFromCookies(cookies);
  } catch (e) {
    console.warn("[ao3Auth] buildCookieHeader: Error parsing saved cookies:", e);
    return "";
  }
}

async function getLoginForm(): Promise<{ token: string | null; cookies: { [key: string]: string } }> {
  const res = await fetch(`${BASE_URL}/users/login`, {
    credentials: "omit",
  });
  const html = await res.text();
  const match = html.match(/name="authenticity_token" value="([^"]+)"/);
  return {
    token: match ? match[1] : null,
    cookies: extractCookies(res.headers.get("set-cookie")),
  };
}

export async function getCSRFToken(): Promise<string | null> {
  const { token } = await getLoginForm();
  return token;
}

export async function loginAO3(username: string, password: string): Promise<boolean> {
  await clearStoredAO3Auth();

  const loginForm = await getLoginForm();
  const token = loginForm.token;
  if (!token) throw new Error("Could not fetch CSRF token");

  const formData = new URLSearchParams();
  formData.append("user[login]", username);
  formData.append("user[password]", password);
  formData.append("authenticity_token", token);
  formData.append("commit", "Log in");

  const response = await fetch(`${BASE_URL}/users/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(Object.keys(loginForm.cookies).length > 0
        ? { Cookie: buildCookieHeaderFromCookies(loginForm.cookies) }
        : {}),
    },
    body: formData.toString(),
    credentials: "omit",
    redirect: "manual",
  });

  const cookies = response.headers.get("set-cookie");
  if (cookies && cookies.includes(SESSION_COOKIE_NAME) && response.status >= 300 && response.status < 400) {
    // Extract all cookies and store them
    const allCookies = { ...loginForm.cookies, ...extractCookies(cookies) };
    const cookieHeader = buildCookieHeaderFromCookies(allCookies);

    const loggedUsername = await getLoggedUsername(cookieHeader);
    if (!loggedUsername || loggedUsername.toLowerCase() !== username.trim().toLowerCase()) {
      console.warn("[ao3Auth] Login verification failed; clearing stale AO3 session", {
        requestedUsername: username,
        loggedUsername,
      });
      await clearStoredAO3Auth();
      return false;
    }

    await AsyncStorage.setItem(COOKIES_KEY, JSON.stringify(allCookies));
    
    // Also store the full cookie string for backward compatibility
    await AsyncStorage.setItem(SESSION_KEY, cookies);
    await AsyncStorage.setItem(USERNAME_KEY, loggedUsername);

    console.log("[ao3Auth] Cookies saved:", Object.keys(allCookies).join(", "));
    console.log("[ao3Auth] Saved cookies:", allCookies);

    const profileUrl = `https://archiveofourown.org/users/${encodeURIComponent(loggedUsername)}`;
    console.log("[ao3Auth] Login successful. Username:", loggedUsername);
    console.log("[ao3Auth] Profile URL:", profileUrl);

    // Try to extract the session token value for easy terminal display
    try {
      const m = cookies.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      const token = m ? m[1] : cookies;
      // This will appear in Metro/console when running the app
      console.log("[ao3Auth] Login successful. Session token:", token);
    } catch (e) {
      console.log("[ao3Auth] Login successful. Stored cookie:", cookies);
    }
    return true;
  }

  return false;
}

export async function getSessionCookie(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_KEY);
}

export async function fetchWithSession(url: string, init: RequestInit = {}): Promise<Response> {
  const cookieHeader = await buildCookieHeader();

  // Merge whatever headers the caller passed in (e.g. Content-Type for a
  // POST body) with the stored AO3 session cookie. The cookie is always
  // (re)applied last so a caller can't accidentally drop the session by
  // passing their own headers object.
  const headers = new Headers(init.headers);
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  console.log("[ao3Auth] fetchWithSession request", {
    url,
    method: init.method || "GET",
    hasCookieHeader: !!cookieHeader,
    cookieHeaderPreview: cookieHeader ? `${cookieHeader.slice(0, 40)}...` : "(none)",
  });

  const res = await fetch(url, {
    ...init,
    credentials: init.credentials ?? "omit",
    headers,
  });

  await saveResponseCookies(res);

  console.log("[ao3Auth] fetchWithSession response", {
    url,
    status: res.status,
    ok: res.ok,
    redirected: res.redirected,
    finalUrl: res.url,
  });

  return res;
}

export async function logoutAO3() {
  await clearStoredAO3Auth();
}

export async function getUsername(): Promise<string | null> {
  return AsyncStorage.getItem(USERNAME_KEY);
}

export async function setUsername(username: string): Promise<void> {
  await AsyncStorage.setItem(USERNAME_KEY, username);
}

/**
 * Get the logged-in username by making a GET request to /users/login with the session cookie.
 * The AO3 server responds with a 302 redirect to /users/<username>.
 * We capture that redirect location and extract the username.
 */
export async function getLoggedUsername(cookieHeaderOverride?: string): Promise<string | null> {
  const cookieHeader = cookieHeaderOverride ?? await buildCookieHeader();
  if (!cookieHeader) {
    console.warn("[ao3Auth] getLoggedUsername: No cookies available to send");
    return null;
  }

  try {
    console.log("[ao3Auth] getLoggedUsername: Fetching homepage to extract username using cookies:", cookieHeader);

    const res = await fetch(`${BASE_URL}/`, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        Accept: "text/html",
      },
      credentials: "omit",
    });

    if (!res || !res.ok) {
      console.warn("[ao3Auth] getLoggedUsername: homepage fetch returned non-OK status:", res && res.status);
      return null;
    }

    const html = await res.text();

    // Try several patterns known to appear in AO3 HTML that reference the user's profile
    const patterns: RegExp[] = [
      /href="\/users\/([^\"]+)"/i,
      /class=[\"']primary nav[\"'][^>]*href="\/users\/([^\"']+)"/i,
      /<li[^>]+class=[\"']dropdown user[\"'][\s\S]*?href="\/users\/([^\"']+)"/i,
      /\/users\/([^\/'\" >]+)/i,
    ];

    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) {
        const username = decodeURIComponent(m[1]);
        console.log("[ao3Auth] getLoggedUsername: Extracted username from homepage HTML:", username);
        return username;
      }
    }

    console.warn("[ao3Auth] getLoggedUsername: Could not extract username from homepage HTML");
    return null;
  } catch (e) {
    console.warn("[ao3Auth] getLoggedUsername: Error fetching/parsing homepage:", e);
    return null;
  }
}
