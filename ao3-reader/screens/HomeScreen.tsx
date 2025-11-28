import React from "react";
import { View, StyleSheet, TouchableOpacity, Text, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  username: string | null;
  onLogout: () => Promise<void>;
}

const HomeScreen: React.FC<Props> = ({ username, onLogout }) => {
  if (!username) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>No username available</Text>
      </View>
    );
  }

  const profileUrl = `https://archiveofourown.org/users/${encodeURIComponent(username)}`;

  // Log the username (we only use GET to find the name; we don't render the profile page inside the app)
  console.log("[HomeScreen] Username available (profile not rendered):", { username, profileUrl });

  const handleLogout = async () => {
    await onLogout();
  };

  const openInBrowser = async () => {
    try {
      await Linking.openURL(profileUrl);
    } catch (e) {
      console.warn("[HomeScreen] Could not open profile URL:", e);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header com botão de logout */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{username}</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <Text style={styles.text}>Conectado como</Text>
        <Text style={styles.username}>{username}</Text>

        <TouchableOpacity style={styles.openBtn} onPress={openInBrowser}>
          <Text style={styles.openBtnText}>Abrir perfil no navegador</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#111",
    borderBottomColor: "#333",
    borderBottomWidth: 1,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  logoutBtn: {
    padding: 8,
  },
  webview: {
    flex: 1,
  },
  loader: {
    marginTop: 40,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  username: {
    color: "#fff",
    fontSize: 20,
    marginTop: 8,
    fontWeight: "600",
  },
  openBtn: {
    marginTop: 20,
    backgroundColor: "#333",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
  },
  openBtnText: {
    color: "#fff",
    fontSize: 14,
  },
  text: {
    color: "#fff",
    textAlign: "center",
    marginTop: 40,
  },
});

export default HomeScreen;
