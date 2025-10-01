import React from "react";
import { SafeAreaView, StatusBar, StyleSheet } from "react-native";
import FanficReader from "./screens/FanficReader";

const App: React.FC = () => {
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
