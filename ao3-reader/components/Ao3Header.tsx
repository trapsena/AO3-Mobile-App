import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getUserIconUrl } from "../api/ao3Auth";

export type Ao3Tab = "home" | "reader" | "history" | "bookmarks";

// Published by FanficReader (via onHeaderActionsChange) while the Reader tab
// is active, so Ao3Header can render the fic/chapter title and the
// TTS/comments/settings actions that used to live in ReaderHeader's own
// top bar, without owning any of that screen's state itself.
export interface ReaderHeaderInfo {
  fanficTitle: string;
  chapterTitle: string;
  isTtsActive: boolean;
  onToggleTts: () => void;
  onOpenComments: () => void;
  onOpenSettings: () => void;
  // Called instead of the generic "go back to Home" fallback, so the screen
  // can do its own cleanup first (FanficReader flushes reading progress
  // immediately before navigating away).
  onGoBack: () => void;
}

// Published by AO3HistoryScreen (via onHeaderActionsChange) while the
// History tab is active, replacing that screen's own inline title bar AND
// its History / Marked-for-Later tab row — both now live in Ao3Header, the
// same way the Reader tab's TTS toggle does.
export interface HistoryHeaderInfo {
  title: string;
  activeSubTab: "history" | "to-read";
  onSelectSubTab: (tab: "history" | "to-read") => void;
  onClearHistory: () => void;
  onGoBack: () => void;
}

// Published by AO3BookmarksScreen (via onHeaderActionsChange) while the
// Bookmarks screen is active — that screen isn't a persistent nav tab (it's
// opened by tapping a "Bookmarked by X" byline elsewhere); the header's own
// back button (instead of the profile picture) is what lets you return.
export interface BookmarksHeaderInfo {
  title: string;
  onGoBack: () => void;
}

interface Ao3HeaderProps {
  username: string | null;
  activeTab: Ao3Tab;
  title?: string;
  onNavigate: (tab: Ao3Tab) => void;
  onLogout: () => void;
  // Animated scroll position of whichever screen is currently active. The
  // header derives its own hide/show offset from this via diffClamp, so the
  // screen only has to forward its ScrollView/FlatList's onScroll here.
  scrollY: Animated.Value;
  // Only rendered when activeTab === "reader" / "history" / "bookmarks" respectively.
  readerHeaderInfo?: ReaderHeaderInfo | null;
  historyHeaderInfo?: HistoryHeaderInfo | null;
  bookmarksHeaderInfo?: BookmarksHeaderInfo | null;
}

export const HEADER_CONTENT_HEIGHT = 52;

const NAV_ITEMS: { key: Ao3Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "reader", label: "Reader", icon: "book" },
  { key: "history", label: "History", icon: "documents-outline" },
];

const Ao3Header: React.FC<Ao3HeaderProps> = ({
  username,
  activeTab,
  title,
  onNavigate,
  onLogout,
  scrollY,
  readerHeaderInfo,
  historyHeaderInfo,
  bookmarksHeaderInfo,
}) => {
  const insets = useSafeAreaInsets();
  const headerHeight = HEADER_CONTENT_HEIGHT + insets.top;

  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    if (!username) {
      setIconUrl(null);
      return;
    }
    (async () => {
      const url = await getUserIconUrl(username);
      if (!cancelled) setIconUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Classic core-Animated hide-on-scroll-down / show-on-scroll-up pattern:
  // clamp the raw scroll offset to [0, headerHeight] so only movement within
  // that range ever affects the header, then translate the header by it.
  const clampedScroll = useRef(Animated.diffClamp(scrollY, 0, headerHeight)).current;
  const translateY = clampedScroll.interpolate({
    inputRange: [0, headerHeight],
    outputRange: [0, -headerHeight],
    extrapolate: "clamp",
  });

  const panelWidth = 280;

  const openMenu = () => {
    setMenuOpen(true);
  };

  const closeMenu = () => {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setMenuOpen(false));
  };

  useEffect(() => {
    if (menuOpen) {
      Animated.timing(menuAnim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [menuOpen, menuAnim]);

  const handleNavigate = (tab: Ao3Tab) => {
    closeMenu();
    onNavigate(tab);
  };

  const handleLogout = () => {
    closeMenu();
    onLogout();
  };

  // The avatar (which opens the drawer) only makes sense on the Home/profile
  // screen. Everywhere else, that same slot becomes a back button instead —
  // each screen's own onGoBack lets it do cleanup first (e.g. FanficReader
  // flushing reading progress); if a screen hasn't published one yet (e.g.
  // its onHeaderActionsChange effect hasn't run on the very first frame
  // after switching tabs), falling back to "go to Home" is still correct.
  const handleGoBack = () => {
    if (activeTab === "reader" && readerHeaderInfo?.onGoBack) {
      readerHeaderInfo.onGoBack();
    } else if (activeTab === "history" && historyHeaderInfo?.onGoBack) {
      historyHeaderInfo.onGoBack();
    } else if (activeTab === "bookmarks" && bookmarksHeaderInfo?.onGoBack) {
      bookmarksHeaderInfo.onGoBack();
    } else {
      onNavigate("home");
    }
  };

  // Baseline value of menuAnim captured at the start of a drag, so moves can
  // be applied relative to wherever the panel already was (rather than
  // jumping) — the same "stop, capture, offset" technique used for any
  // interruptible drag-driven Animated.Value.
  const dragBaseRef = useRef(0);

  // Lets the already-open panel be dragged closed (or dragged back open if
  // released before crossing the halfway point) by hand, in addition to the
  // existing tap-the-backdrop / tap-a-nav-item ways of closing it. Only
  // claims the gesture once real horizontal movement is seen, so ordinary
  // taps on the nav items inside the panel still work normally.
  const panelPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      // The panel is full of TouchableOpacity nav items, which grab the
      // responder immediately on touch-down (so they can show a press
      // state). The plain (bubble-phase) handler above is only ever asked
      // when nothing underneath already wants the touch, so it never fires
      // for a drag that starts on top of one of those buttons — it's only
      // reached for drags starting on the panel's own empty background.
      // The capture-phase version below runs *before* that child gets a
      // look, so it's what actually lets a real horizontal drag steal the
      // gesture away from a nav item's press handling once it's clearly a
      // swipe and not a tap.
      onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        menuAnim.stopAnimation((value) => {
          dragBaseRef.current = value;
        });
      },
      onPanResponderMove: (_evt, gesture) => {
        const next = dragBaseRef.current + gesture.dx / panelWidth;
        menuAnim.setValue(Math.max(0, Math.min(1, next)));
      },
      onPanResponderRelease: (_evt, gesture) => {
        const projected = dragBaseRef.current + gesture.dx / panelWidth;
        const shouldOpen = projected > 0.5 || gesture.vx > 0.5;
        if (shouldOpen) {
          Animated.timing(menuAnim, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        } else {
          Animated.timing(menuAnim, {
            toValue: 0,
            duration: 200,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }).start(() => setMenuOpen(false));
        }
      },
      onPanResponderTerminate: (_evt, gesture) => {
        const projected = dragBaseRef.current + gesture.dx / panelWidth;
        if (projected > 0.5) {
          Animated.timing(menuAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        } else {
          Animated.timing(menuAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
            setMenuOpen(false),
          );
        }
      },
    }),
  ).current;

  // A thin, always-mounted strip along the left edge of the screen (rendered
  // as a top-level sibling below, not inside the header bar, so it still
  // works even while the header itself is scrolled out of view) that opens
  // the drawer on a rightward swipe starting near the edge. It only claims
  // the gesture on real rightward movement, so it doesn't steal vertical
  // scroll gestures from whatever list happens to be underneath it.
  const edgePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        gesture.dx > 12 && gesture.dx > Math.abs(gesture.dy),
      onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
        gesture.dx > 12 && gesture.dx > Math.abs(gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: () => {
        // Idempotent — setMenuOpen(true) when already true is a no-op, and
        // the open animation only (re)starts via the effect above, which is
        // keyed on menuOpen actually changing.
        openMenu();
      },
    }),
  ).current;

  const panelTranslateX = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth, 0],
  });
  const backdropOpacity = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <>
      {/* Full-height (not just header-height) so a swipe from the edge opens
          the drawer even when the header itself is currently scrolled out
          of view. Rendered as its own top-level sibling rather than inside
          the header bar's translateY-animated box for that reason. */}
      <View style={styles.edgeSwipeZone} {...edgePanResponder.panHandlers} />

      <Animated.View
        style={[
          styles.header,
          {
            height: headerHeight,
            paddingTop: insets.top,
            transform: [{ translateY }],
          },
        ]}
      >
        <TouchableOpacity
          onPress={activeTab === "home" ? openMenu : handleGoBack}
          style={styles.avatarBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {activeTab !== "home" ? (
            <Ionicons name="arrow-back" size={24} color="#fff" />
          ) : iconUrl ? (
            <Image source={{ uri: iconUrl }} style={styles.avatarImage} />
          ) : (
            <Ionicons name="person-circle-outline" size={32} color="#fff" />
          )}
        </TouchableOpacity>

        {activeTab === "reader" && readerHeaderInfo ? (
          <>
            <View style={styles.titleBlock}>
              <Text style={styles.readerFanficTitle} numberOfLines={1}>
                {readerHeaderInfo.fanficTitle || "Reading"}
              </Text>
              <Text style={styles.readerChapterTitle} numberOfLines={1}>
                {readerHeaderInfo.chapterTitle}
              </Text>
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity onPress={readerHeaderInfo.onToggleTts} style={styles.actionBtn}>
                <Ionicons
                  name="headset"
                  size={20}
                  color={readerHeaderInfo.isTtsActive ? "#4cd137" : "#fff"}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={readerHeaderInfo.onOpenComments} style={styles.actionBtn}>
                <Ionicons name="chatbubble-outline" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={readerHeaderInfo.onOpenSettings} style={styles.actionBtn}>
                <Ionicons name="settings-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </>
        ) : activeTab === "history" && historyHeaderInfo ? (
          <>
            <View style={styles.historyTabsRow}>
              <TouchableOpacity
                style={[
                  styles.historyTabBtn,
                  historyHeaderInfo.activeSubTab === "history" && styles.historyTabBtnActive,
                ]}
                onPress={() => historyHeaderInfo.onSelectSubTab("history")}
              >
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={historyHeaderInfo.activeSubTab === "history" ? "#000" : "#ddd"}
                />
                <Text
                  style={[
                    styles.historyTabLabel,
                    historyHeaderInfo.activeSubTab === "history" && styles.historyTabLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  History
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.historyTabBtn,
                  historyHeaderInfo.activeSubTab === "to-read" && styles.historyTabBtnActive,
                ]}
                onPress={() => historyHeaderInfo.onSelectSubTab("to-read")}
              >
                <Ionicons
                  name="bookmark-outline"
                  size={14}
                  color={historyHeaderInfo.activeSubTab === "to-read" ? "#000" : "#ddd"}
                />
                <Text
                  style={[
                    styles.historyTabLabel,
                    historyHeaderInfo.activeSubTab === "to-read" && styles.historyTabLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  Marked for Later
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={historyHeaderInfo.onClearHistory} style={styles.actionBtn}>
              <Ionicons name="trash-outline" size={20} color="#f66" />
            </TouchableOpacity>
          </>
        ) : activeTab === "bookmarks" && bookmarksHeaderInfo ? (
          <>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {bookmarksHeaderInfo.title || "Bookmarks"}
            </Text>
            <View style={styles.avatarBtn} />
          </>
        ) : (
          <>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title || (username ? `Signed in as ${username}` : "AO3 Reader")}
            </Text>
            <View style={styles.avatarBtn} />
          </>
        )}
      </Animated.View>

      <Modal visible={menuOpen} transparent animationType="none" onRequestClose={closeMenu}>
        <View style={styles.modalRoot}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
          </Animated.View>

          <Animated.View
            style={[
              styles.panel,
              {
                width: panelWidth,
                paddingTop: insets.top + 20,
                transform: [{ translateX: panelTranslateX }],
              },
            ]}
            {...panelPanResponder.panHandlers}
          >
            <View style={styles.panelProfile}>
              {iconUrl ? (
                <Image source={{ uri: iconUrl }} style={styles.panelAvatarImage} />
              ) : (
                <Ionicons name="person-circle-outline" size={48} color="#fff" />
              )}
              <Text style={styles.panelUsername} numberOfLines={1}>
                {username || "Not signed in"}
              </Text>
            </View>

            <View style={styles.panelDivider} />

            {NAV_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.panelItem, activeTab === item.key && styles.panelItemActive]}
                onPress={() => handleNavigate(item.key)}
              >
                <Ionicons
                  name={item.icon}
                  size={22}
                  color={activeTab === item.key ? "#7EC14B" : "#ddd"}
                />
                <Text
                  style={[styles.panelItemLabel, activeTab === item.key && styles.panelItemLabelActive]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}

            <View style={styles.panelSpacer} />

            <TouchableOpacity style={styles.panelItem} onPress={handleLogout}>
              <Ionicons name="log-out" size={22} color="#f66" />
              <Text style={[styles.panelItemLabel, { color: "#f66" }]}>Logout</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  edgeSwipeZone: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    // Wider than it looks like it needs to be: on Android with gesture
    // navigation enabled, the outermost ~16-20px of the screen edge is
    // reserved by the system for its own back gesture and never reaches the
    // app at all, so the zone needs enough margin past that for a swipe to
    // reliably still start inside it.
    width: 32,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    backgroundColor: "#0d0d0d",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  avatarBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    paddingHorizontal: 8,
  },
  headerTitleLeft: {
    textAlign: "left",
  },
  titleBlock: {
    flex: 1,
    paddingHorizontal: 10,
  },
  readerFanficTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  readerChapterTitle: {
    color: "#aaa",
    fontSize: 12,
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  actionBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  historyTabsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  historyTabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1c1c1c",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    flexShrink: 1,
  },
  historyTabBtnActive: {
    backgroundColor: "#7ec14b",
    borderColor: "#7ec14b",
  },
  historyTabLabel: {
    color: "#ddd",
    fontSize: 11,
    fontWeight: "600",
    flexShrink: 1,
  },
  historyTabLabelActive: {
    color: "#000",
  },
  modalRoot: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  panel: {
    height: "100%",
    backgroundColor: "#111",
    borderRightWidth: 1,
    borderRightColor: "#262626",
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "ios" ? 24 : 16,
  },
  panelProfile: {
    alignItems: "flex-start",
    marginBottom: 16,
  },
  panelAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#333",
    marginBottom: 8,
  },
  panelUsername: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  panelDivider: {
    height: 1,
    backgroundColor: "#262626",
    marginBottom: 8,
  },
  panelItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
  },
  panelItemActive: {
    opacity: 1,
  },
  panelItemLabel: {
    color: "#ddd",
    fontSize: 15,
    fontWeight: "600",
  },
  panelItemLabelActive: {
    color: "#7EC14B",
  },
  panelSpacer: {
    flex: 1,
  },
});

export default Ao3Header;
