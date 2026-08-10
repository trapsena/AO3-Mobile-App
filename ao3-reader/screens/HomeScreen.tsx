import React from "react";
import { View, StyleSheet, TouchableOpacity, Text, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AO3ListingScreen from "./AO3ListingScreen";

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
      <View style={styles.header}>
        <View style={styles.headerTextBlock}>
          <Text style={styles.headerLabel}>Signed in as</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {username}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity onPress={openInBrowser} style={styles.iconBtn}>
            <Ionicons name="open-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={styles.iconBtn}>
            <Ionicons name="log-out" size={22} color="#f66" />
          </TouchableOpacity>
        </View>
      </View>

      <AO3ListingScreen
        url={profileUrl}
        title={`${username}'s AO3 dashboard`}
        showHeader={false}
      />
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
  headerTextBlock: {
    flex: 1,
    paddingRight: 12,
  },
  headerLabel: {
    color: "#9a9a9a",
    fontSize: 12,
    marginBottom: 2,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBtn: {
    padding: 8,
  },
  text: {
    color: "#fff",
    textAlign: "center",
    marginTop: 40,
  },
});

export default HomeScreen;
