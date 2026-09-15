import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StatusBar, StyleSheet, ActivityIndicator, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import FanficReader from "./screens/FanficReader";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import AO3HistoryScreen from "./screens/AO3HistoryScreen";
import AO3BookmarksScreen from "./screens/AO3BookmarksScreen";
import Ao3Header, {
  Ao3Tab,
  HEADER_CONTENT_HEIGHT,
  ReaderHeaderInfo,
  HistoryHeaderInfo,
  BookmarksHeaderInfo,
} from "./components/Ao3Header";
import { useAO3Session } from "./hooks/useao3Auth";

const AppContent: React.FC = () => {
  const { session, username, loading, login, logout } = useAO3Session();
  const [activeTab, setActiveTab] = useState<Ao3Tab>("home");
  const [readerUrl, setReaderUrl] = useState<string | null>(null);
  const [bookmarksUsername, setBookmarksUsername] = useState<string | null>(null);
  const [readerHeaderInfo, setReaderHeaderInfo] = useState<ReaderHeaderInfo | null>(null);
  const [historyHeaderInfo, setHistoryHeaderInfo] = useState<HistoryHeaderInfo | null>(null);
  const [bookmarksHeaderInfo, setBookmarksHeaderInfo] = useState<BookmarksHeaderInfo | null>(null);
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

  // Called when a bookmark card's "Bookmarked by X" byline is tapped —
  // navigates to that user's public bookmarks page in-app instead of
  // opening it in the external browser.
  const openBookmarks = (targetUsername?: string) => {
    if (!targetUsername) {
      console.warn("[App] openBookmarks called without a username, ignoring");
      return;
    }
    setBookmarksUsername(targetUsername);
    setActiveTab("bookmarks");
  };

  // Shared "back to Home" handler for History/Bookmarks/Reader's onClose —
  // memoized (setActiveTab is itself stable) so it has a STABLE identity
  // across renders. Each of those screens lists `onClose` in the dependency
  // array of the effect that publishes its onGoBack to Ao3Header; passing a
  // fresh inline arrow function here on every render would make that
  // dependency look "changed" every time, re-running the effect, which
  // calls back into this component's state — an infinite render loop.
  const goHome = useCallback(() => setActiveTab("home"), []);

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
          onPressBookmarker={openBookmarks}
        />
      ) : activeTab === "history" ? (
        <AO3HistoryScreen
          username={username!}
          onClose={goHome}
          onWorkPress={(work) => openReader(work.workUrl)}
          onScroll={handleScroll}
          contentContainerTopPadding={headerHeight}
          onHeaderActionsChange={setHistoryHeaderInfo}
        />
      ) : activeTab === "bookmarks" ? (
        <AO3BookmarksScreen
          // Remount per user so switching whose bookmarks we're viewing
          // resets pagination/scroll cleanly, the same way FanficReader
          // remounts per fic.
          key={bookmarksUsername ?? "no-bookmarks-user"}
          username={bookmarksUsername ?? ""}
          currentUsername={username}
          onClose={goHome}
          onWorkPress={(bookmark) => openReader(bookmark.workUrl)}
          onScroll={handleScroll}
          topInset={headerHeight}
          onHeaderActionsChange={setBookmarksHeaderInfo}
        />
      ) : (
        <FanficReader
          // Remount per fic so the reader's internal chapter/index state
          // resets cleanly when a different work is opened.
          key={readerUrl ?? "no-fic-selected"}
          initialUrl={readerUrl ?? undefined}
          onClose={goHome}
          topInset={headerHeight}
          onHeaderActionsChange={setReaderHeaderInfo}
          onScroll={handleContentScroll}
        />
      )}

      {/* Independent absolute overlay above the scrollable content — replaces
          the old bottom tab bar. On Home, tapping the profile picture opens
          a left-to-right drawer with the same navigation options; on every
          other screen that same slot becomes a back button instead. Its
          title and action buttons swap to match whichever screen is active. */}
      <Ao3Header
        username={username}
        activeTab={activeTab}
        onNavigate={setActiveTab}
        onLogout={logout}
        readerHeaderInfo={readerHeaderInfo}
        historyHeaderInfo={historyHeaderInfo}
        bookmarksHeaderInfo={bookmarksHeaderInfo}
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
