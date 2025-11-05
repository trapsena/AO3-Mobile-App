import React from "react";
import { SafeAreaView, StatusBar, StyleSheet, ActivityIndicator } from "react-native";
import FanficReader from "./screens/FanficReader";
import LoginScreen from "./screens/LoginScreen";
import { useAO3Session } from "./hooks/useao3Auth";

const App: React.FC = () => {
  const { session, loading, login } = useAO3Session();

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
      <FanficReader />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
});

export default App;
