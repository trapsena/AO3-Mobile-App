import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = "https://archiveofourown.org";
const SESSION_KEY = "ao3_session_cookie";
const USERNAME_KEY = "ao3_username";
const COOKIES_KEY = "ao3_all_cookies";

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
    const [name, value] = parts.split("=");
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  });
  
  return cookies;
}

/**
 * Build cookie string from saved cookies
 */
async function buildCookieHeader(): Promise<string> {
  const saved = await AsyncStorage.getItem(COOKIES_KEY);
  if (!saved) return "";
  
  try {
    const cookies = JSON.parse(saved);
    return Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  } catch (e) {
    console.warn("[ao3Auth] buildCookieHeader: Error parsing saved cookies:", e);
    return "";
  }
}

export async function getCSRFToken(): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/users/login`);
  const html = await res.text();
  const match = html.match(/name="authenticity_token" value="([^"]+)"/);
  return match ? match[1] : null;
}

export async function loginAO3(username: string, password: string): Promise<boolean> {
  const token = await getCSRFToken();
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
    },
    body: formData.toString(),
    redirect: "manual",
  });

  const cookies = response.headers.get("set-cookie");
  if (cookies && cookies.includes("_otwarchive_session")) {
    // Extract all cookies and store them
    const allCookies = extractCookies(cookies);
    await AsyncStorage.setItem(COOKIES_KEY, JSON.stringify(allCookies));
    
    // Also store the full cookie string for backward compatibility
    await AsyncStorage.setItem(SESSION_KEY, cookies);

    console.log("[ao3Auth] Cookies saved:", Object.keys(allCookies).join(", "));
    console.log("[ao3Auth] Saved cookies:", allCookies);

    // Extract username from the 302 redirect (GET /users/login)
    try {
      const loggedUsername = await getLoggedUsername();
      if (loggedUsername) {
        await AsyncStorage.setItem(USERNAME_KEY, loggedUsername);
        const profileUrl = `https://archiveofourown.org/users/${encodeURIComponent(loggedUsername)}`;
        console.log("[ao3Auth] Login successful. Username:", loggedUsername);
        console.log("[ao3Auth] Profile URL:", profileUrl);
      } else {
        console.warn("[ao3Auth] Login succeeded but could not get username from 302 redirect");
      }
    } catch (e) {
      console.warn("[ao3Auth] Error getting username after login:", e);
    }

    // Try to extract the session token value for easy terminal display
    try {
      const m = cookies.match(/_otwarchive_session=([^;]+)/);
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

export async function fetchWithSession(url: string): Promise<Response> {
  const cookieHeader = await buildCookieHeader();
  return fetch(url, {
    headers: {
      Cookie: cookieHeader,
    },
  });
}

export async function logoutAO3() {
  await AsyncStorage.removeItem(SESSION_KEY);
  await AsyncStorage.removeItem(USERNAME_KEY);
  await AsyncStorage.removeItem(COOKIES_KEY);
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
export async function getLoggedUsername(): Promise<string | null> {
  const cookieHeader = await buildCookieHeader();
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
