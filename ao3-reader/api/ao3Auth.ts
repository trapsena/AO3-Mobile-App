import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = "https://archiveofourown.org";
const SESSION_KEY = "ao3_session_cookie";

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
    // Store the full cookie string
    await AsyncStorage.setItem(SESSION_KEY, cookies);
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
  const cookie = await getSessionCookie();
  return fetch(url, {
    headers: {
      Cookie: cookie ?? "",
    },
  });
}

export async function logoutAO3() {
  await AsyncStorage.removeItem(SESSION_KEY);
}
