import React, { useEffect, useRef, useState } from "react";
import { Animated, StatusBar, StyleSheet, ActivityIndicator, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import FanficReader from "./screens/FanficReader";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import AO3HistoryScreen from "./screens/AO3HistoryScreen";
import Ao3Header, {
  Ao3Tab,
  HEADER_CONTENT_HEIGHT,
  ReaderHeaderInfo,
  HistoryHeaderInfo,
} from "./components/Ao3Header";
import { useAO3Session } from "./hooks/useao3Auth";

const AppContent: React.FC = () => {
  const { session, username, loading, login, logout } = useAO3Session();
  const [activeTab, setActiveTab] = useState<Ao3Tab>("home");
  const [readerUrl, setReaderUrl] = useState<string | null>(null);
  const [readerHeaderInfo, setReaderHeaderInfo] = useState<ReaderHeaderInfo | null>(null);
  const [historyHeaderInfo, setHistoryHeaderInfo] = useState<HistoryHeaderInfo | null>(null);
  const insets = useSafeAreaInsets();
  const headerHeight = HEADER_CONTENT_HEIGHT + insets.top;

  // Shared scroll position that Ao3Header uses to hide/show itself. Reset it
  // whenever the active tab changes so switching screens always reveals the
  // header instead of leaving it wherever the previous screen's scroll left it.
  const scrollY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    scrollY.setValue(0);
  }, [activeTab, scrollY]);

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: true },
  );

  // FanficReader's content scrolls inside a WebView rather than a native
  // ScrollView/FlatList, so it can't feed `scrollY` via Animated.event like
  // the other tabs do — it reports its scroll offset as a plain number
  // (via postMessage) instead, which this just applies directly.
  const handleContentScroll = (y: number) => {
    scrollY.setValue(y);
  };

  // Shared by HomeScreen and AO3HistoryScreen's work-card press handlers:
  // stash which fic to open, then actually switch to the Reader tab.
  const openReader = (url?: string) => {
    if (!url) {
      console.warn("[App] openReader called without a URL, ignoring");
      return;
    }
    setReaderUrl(url);
    setActiveTab("reader");
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <ActivityIndicator size="large" color="#fff" style={{ marginTop: insets.top + 40 }} />
      </View>
    );
  }

  // if there's no session, show LoginScreen; once login completes, useAO3Session will update session
  if (!session) {
    return (
      <View style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <LoginScreen onLogin={login} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Edge-to-edge content: each screen's list scrolls underneath the
          transparent status bar, with its own top padding leaving room for
          the header overlay below. */}
      {activeTab === "home" ? (
        <HomeScreen
          username={username}
          onOpenReader={openReader}
          onScroll={handleScroll}
          contentContainerTopPadding={headerHeight}
        />
      ) : activeTab === "history" ? (
        <AO3HistoryScreen
          username={username!}
          onWorkPress={(work) => openReader(work.workUrl)}
          onScroll={handleScroll}
          contentContainerTopPadding={headerHeight}
          onHeaderActionsChange={setHistoryHeaderInfo}
        />
      ) : (
        <FanficReader
          // Remount per fic so the reader's internal chapter/index state
          // resets cleanly when a different work is opened.
          key={readerUrl ?? "no-fic-selected"}
          initialUrl={readerUrl ?? undefined}
          onClose={() => setActiveTab("home")}
          topInset={headerHeight}
          onHeaderActionsChange={setReaderHeaderInfo}
          onScroll={handleContentScroll}
        />
      )}

      {/* Independent absolute overlay above the scrollable content — replaces
          the old bottom tab bar. Tapping the profile picture opens a
          left-to-right drawer with the same navigation options. Its title
          and action buttons swap to match whichever screen is active. */}
      <Ao3Header
        username={username}
        activeTab={activeTab}
        onNavigate={setActiveTab}
        onLogout={logout}
        readerHeaderInfo={readerHeaderInfo}
        historyHeaderInfo={historyHeaderInfo}
        scrollY={scrollY}
      />
    </View>
  );
};

const App: React.FC = () => (
  <SafeAreaProvider>
    <AppContent />
  </SafeAreaProvider>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
});

export default App;
