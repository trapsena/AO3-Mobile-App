import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StatusBar, StyleSheet, ActivityIndicator, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import FanficReader from "./screens/FanficReader";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import AO3HistoryScreen from "./screens/AO3HistoryScreen";
import AO3BookmarksScreen from "./screens/AO3BookmarksScreen";
import AO3WorksScreen from "./screens/AO3WorksScreen";
import AO3ListingScreen from "./screens/AO3ListingScreen";
import Ao3Header, {
  Ao3Tab,
  HEADER_CONTENT_HEIGHT,
  ReaderHeaderInfo,
  HistoryHeaderInfo,
  BookmarksHeaderInfo,
  ProfileHeaderInfo,
  WorksHeaderInfo,
} from "./components/Ao3Header";
import { AO3Link } from "./components/AO3WorkBlurb";
import { extractUsernameFromUsersUrl } from "./api/ao3Bookmarks";
import { useAO3Session } from "./hooks/useao3Auth";

// A snapshot of "where we came from" — pushed onto AppContent's back stack
// every time openReader/openBookmarks/openProfile navigate to a new screen,
// so the header's back button can return to that exact prior screen (with
// whichever fic/user it was showing) instead of always jumping to Home.
interface NavEntry {
  tab: Ao3Tab;
  readerUrl: string | null;
  bookmarksUsername: string | null;
  profileUsername: string | null;
  worksUsername: string | null;
}

const AppContent: React.FC = () => {
  const { session, username, loading, login, logout } = useAO3Session();
  const [activeTab, setActiveTab] = useState<Ao3Tab>("home");
  const [readerUrl, setReaderUrl] = useState<string | null>(null);
  const [bookmarksUsername, setBookmarksUsername] = useState<string | null>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [worksUsername, setWorksUsername] = useState<string | null>(null);
  // Mutated directly (not state) — popping/pushing it should never itself
  // trigger a re-render; the setActiveTab/setReaderUrl/etc. calls around it
  // already do that. Kept in a ref (rather than plain state) specifically so
  // `goBack` below can stay referentially stable with an empty dependency
  // array — see the comment on `goBack` for why that stability matters.
  const navHistoryRef = useRef<NavEntry[]>([]);
  const [readerHeaderInfo, setReaderHeaderInfo] = useState<ReaderHeaderInfo | null>(null);
  const [historyHeaderInfo, setHistoryHeaderInfo] = useState<HistoryHeaderInfo | null>(null);
  const [bookmarksHeaderInfo, setBookmarksHeaderInfo] = useState<BookmarksHeaderInfo | null>(null);
  const [profileHeaderInfo, setProfileHeaderInfo] = useState<ProfileHeaderInfo | null>(null);
  const [worksHeaderInfo, setWorksHeaderInfo] = useState<WorksHeaderInfo | null>(null);
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

  // Snapshots wherever the app currently is onto the back stack, before a
  // navigation away from it — shared by openReader/openBookmarks/openProfile
  // below so `goBack` can later return to this exact screen.
  const pushNavHistory = () => {
    navHistoryRef.current.push({ tab: activeTab, readerUrl, bookmarksUsername, profileUsername, worksUsername });
  };

  // Shared by HomeScreen and AO3HistoryScreen's work-card press handlers:
  // stash which fic to open, then actually switch to the Reader tab.
  const openReader = (url?: string) => {
    if (!url) {
      console.warn("[App] openReader called without a URL, ignoring");
      return;
    }
    pushNavHistory();
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
    pushNavHistory();
    setBookmarksUsername(targetUsername);
    setActiveTab("bookmarks");
  };

  // Called when an author byline (on a work or bookmark blurb, anywhere in
  // the app) is tapped — navigates to that author's AO3 profile in-app,
  // reusing AO3ListingScreen (the same component Home uses to render the
  // logged-in user's own profile) for whichever user it belongs to.
  const openProfile = (author?: AO3Link) => {
    const targetUsername = author?.href ? extractUsernameFromUsersUrl(author.href) : undefined;
    if (!targetUsername) {
      console.warn("[App] openProfile called without a resolvable username, ignoring:", author);
      return;
    }
    pushNavHistory();
    setProfileUsername(targetUsername);
    setActiveTab("profile");
  };

  // Called when the "Works (N)" button (next to a profile's Works section
  // heading) is tapped — navigates to that user's full works listing in-app.
  const openWorks = (targetUsername?: string) => {
    if (!targetUsername) {
      console.warn("[App] openWorks called without a username, ignoring");
      return;
    }
    pushNavHistory();
    setWorksUsername(targetUsername);
    setActiveTab("works");
  };

  // Drawer nav items (Home/Reader/History) are top-level destinations reached
  // via the menu rather than by drilling into content — treated as a fresh
  // start, so they reset the back stack instead of adding to it.
  const navigateFromDrawer = useCallback((tab: Ao3Tab) => {
    navHistoryRef.current = [];
    setActiveTab(tab);
  }, []);

  // Shared back-button handler for History/Bookmarks/Reader/Profile's
  // onClose — pops the back stack and restores whatever screen (and
  // fic/user) was showing right before the current one, falling back to
  // Home once the stack is empty. Memoized with an EMPTY dependency array
  // (it only touches the ref and stable setState functions, never reads
  // component state directly) so it has a STABLE identity across renders.
  // Each of those screens lists `onClose` in the dependency array of the
  // effect that publishes its onGoBack to Ao3Header; passing a fresh inline
  // arrow function here on every render would make that dependency look
  // "changed" every time, re-running the effect, which calls back into this
  // component's state — an infinite render loop.
  const goBack = useCallback(() => {
    const entry = navHistoryRef.current.pop();
    if (!entry) {
      setActiveTab("home");
      return;
    }
    setActiveTab(entry.tab);
    if (entry.tab === "reader") setReaderUrl(entry.readerUrl);
    else if (entry.tab === "bookmarks") setBookmarksUsername(entry.bookmarksUsername);
    else if (entry.tab === "profile") setProfileUsername(entry.profileUsername);
    else if (entry.tab === "works") setWorksUsername(entry.worksUsername);
  }, []);

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
          onPressWorks={openWorks}
          onPressAuthor={openProfile}
        />
      ) : activeTab === "history" ? (
        <AO3HistoryScreen
          username={username!}
          onClose={goBack}
          onWorkPress={(work) => openReader(work.workUrl)}
          onPressAuthor={openProfile}
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
          onClose={goBack}
          onWorkPress={(bookmark) => openReader(bookmark.workUrl)}
          onPressAuthor={openProfile}
          onScroll={handleScroll}
          topInset={headerHeight}
          onHeaderActionsChange={setBookmarksHeaderInfo}
        />
      ) : activeTab === "profile" ? (
        <AO3ListingScreen
          // Remount per user so switching whose profile we're viewing resets
          // pagination/scroll cleanly, the same way Bookmarks/Reader do.
          key={profileUsername ?? "no-profile-user"}
          url={`https://archiveofourown.org/users/${encodeURIComponent(profileUsername ?? "")}`}
          showHeader={false}
          onItemPress={(item) => openReader(item.work?.workUrl ?? item.bookmark?.workUrl)}
          onPressBookmarker={openBookmarks}
          onPressWorks={openWorks}
          onPressAuthor={openProfile}
          currentUsername={username}
          onClose={goBack}
          onScroll={handleScroll}
          contentContainerTopPadding={headerHeight}
          onHeaderActionsChange={setProfileHeaderInfo}
        />
      ) : activeTab === "works" ? (
        <AO3WorksScreen
          // Remount per user so switching whose works we're viewing resets
          // pagination/scroll cleanly, the same way Bookmarks/Profile do.
          key={worksUsername ?? "no-works-user"}
          username={worksUsername ?? ""}
          onClose={goBack}
          onWorkPress={(work) => openReader(work.workUrl)}
          onPressAuthor={openProfile}
          onScroll={handleScroll}
          contentContainerTopPadding={headerHeight}
          onHeaderActionsChange={setWorksHeaderInfo}
        />
      ) : (
        <FanficReader
          // Remount per fic so the reader's internal chapter/index state
          // resets cleanly when a different work is opened.
          key={readerUrl ?? "no-fic-selected"}
          initialUrl={readerUrl ?? undefined}
          onClose={goBack}
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
        onNavigate={navigateFromDrawer}
        onLogout={logout}
        readerHeaderInfo={readerHeaderInfo}
        historyHeaderInfo={historyHeaderInfo}
        bookmarksHeaderInfo={bookmarksHeaderInfo}
        profileHeaderInfo={profileHeaderInfo}
        worksHeaderInfo={worksHeaderInfo}
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
