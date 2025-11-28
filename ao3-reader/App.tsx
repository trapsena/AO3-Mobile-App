import React, { useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet, ActivityIndicator, View, TouchableOpacity, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import FanficReader from "./screens/FanficReader";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import { useAO3Session } from "./hooks/useao3Auth";

const App: React.FC = () => {
  const { session, username, loading, login, logout } = useAO3Session();
  const [activeTab, setActiveTab] = useState<"home" | "reader">("home");

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#fff" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  // if there's no session, show LoginScreen; once login completes, useAO3Session will update session
  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <LoginScreen onLogin={login} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Content */}
      {activeTab === "home" ? (
        <HomeScreen username={username} onLogout={logout} />
      ) : (
        <FanficReader />
      )}

      {/* Bottom Navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "home" && styles.tabBtnActive]}
          onPress={() => setActiveTab("home")}
        >
          <Ionicons name="home" size={24} color={activeTab === "home" ? "#7EC14B" : "#999"} />
          <Text style={[styles.tabLabel, activeTab === "home" && styles.tabLabelActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "reader" && styles.tabBtnActive]}
          onPress={() => setActiveTab("reader")}
        >
          <Ionicons name="book" size={24} color={activeTab === "reader" ? "#7EC14B" : "#999"} />
          <Text style={[styles.tabLabel, activeTab === "reader" && styles.tabLabelActive]}>Reader</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabBtn}
          onPress={logout}
        >
          <Ionicons name="log-out" size={24} color="#f66" />
          <Text style={[styles.tabLabel, { color: "#f66" }]}>Logout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#111",
    borderTopColor: "#333",
    borderTopWidth: 1,
    paddingBottom: 8,
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  tabBtnActive: {
    backgroundColor: "rgba(126, 193, 75, 0.1)",
  },
  tabLabel: {
    color: "#999",
    fontSize: 12,
    marginTop: 4,
  },
  tabLabelActive: {
    color: "#7EC14B",
  },
});

export default App;
