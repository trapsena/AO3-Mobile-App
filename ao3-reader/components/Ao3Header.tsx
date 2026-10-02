import React, { useEffect, useMemo, useRef, useState } from "react";
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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getUserIconUrl } from "../api/ao3Auth";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";
import ThemeSettingsModal from "./ThemeSettingsModal";

export type Ao3Tab =
  | "home"
  | "reader"
  | "history"
  | "inbox"
  | "bookmarks"
  | "profile"
  | "works"
  | "fandoms"
  | "allFandoms"
  | "tagWorks";

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

// Published by AO3InboxScreen (via onHeaderActionsChange) while the Inbox tab
// is active — a persistent drawer tab like History, so its back button works
// the same way, plus a toggle for the inbox's own filter panel.
export interface InboxHeaderInfo {
  title: string;
  onGoBack: () => void;
  onToggleFilters: () => void;
}

// Published by AO3BookmarksScreen (via onHeaderActionsChange) while the
// Bookmarks screen is active — that screen isn't a persistent nav tab (it's
// opened by tapping a "Bookmarked by X" byline elsewhere); the header's own
// back button (instead of the profile picture) is what lets you return.
export interface BookmarksHeaderInfo {
  title: string;
  onGoBack: () => void;
  // Opens or closes the filter/sort panel the screen owns (facets scraped
  // from the currently loaded page) — see AO3FilterPanel. Tapping the
  // header's filter button again while the panel is already open closes it.
  onToggleFilters: () => void;
}

// Published by AO3WorksScreen (via onHeaderActionsChange) while the Works
// screen is active — same shape and same reasoning as BookmarksHeaderInfo:
// not a persistent nav tab, reached by tapping a "Works (N)" button
// elsewhere, so the header's back button is what lets you return.
export interface WorksHeaderInfo {
  title: string;
  onGoBack: () => void;
  onToggleFilters: () => void;
}

// Published by AO3TagWorksScreen (via onHeaderActionsChange) while it's
// showing every work tagged with a given fandom/relationship/character/
// freeform/warning tag — same not-a-nav-tab reasoning and shape as
// WorksHeaderInfo (reached by tapping a tag chip anywhere in the app, not
// via the drawer).
export interface TagWorksHeaderInfo {
  title: string;
  onGoBack: () => void;
  onToggleFilters: () => void;
}

// Published by AO3AllFandomsScreen (via onHeaderActionsChange) while it's
// showing every fandom in one media category — same not-a-nav-tab reasoning
// as WorksHeaderInfo, but the header renders a live search box (instead of a
// filter toggle) that filters the screen's already-loaded fandom list.
export interface AllFandomsHeaderInfo {
  title: string;
  onGoBack: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

// Published by AO3ListingScreen (via onHeaderActionsChange) while it's being
// used to view someone's profile (the "profile" tab) rather than embedded in
// Home — same shape and same reasoning as BookmarksHeaderInfo above.
export interface ProfileHeaderInfo {
  title: string;
  onGoBack: () => void;
  // Only set when viewing someone else's profile (never your own, which has
  // no Subscribe/Mute/Block on AO3 either) — lets the header show a dropdown
  // with these actions instead of AO3ListingScreen needing its own menu UI.
  actions?: {
    isSubscribed: boolean;
    subscribing: boolean;
    onToggleSubscribe: () => void;
    onMute: () => void;
    onBlock: () => void;
  };
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
  // Only rendered when activeTab === "reader" / "history" / "inbox" / "bookmarks" / "profile" / "works" respectively.
  readerHeaderInfo?: ReaderHeaderInfo | null;
  historyHeaderInfo?: HistoryHeaderInfo | null;
  inboxHeaderInfo?: InboxHeaderInfo | null;
  bookmarksHeaderInfo?: BookmarksHeaderInfo | null;
  profileHeaderInfo?: ProfileHeaderInfo | null;
  worksHeaderInfo?: WorksHeaderInfo | null;
  allFandomsHeaderInfo?: AllFandomsHeaderInfo | null;
  tagWorksHeaderInfo?: TagWorksHeaderInfo | null;
}

export const HEADER_CONTENT_HEIGHT = 52;

const NAV_ITEMS: { key: Ao3Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "reader", label: "Reader", icon: "book" },
  { key: "history", label: "History", icon: "documents-outline" },
  { key: "inbox", label: "Inbox", icon: "mail-outline" },
  { key: "bookmarks", label: "Bookmarks", icon: "bookmark-outline" },
  { key: "fandoms", label: "Fandoms", icon: "grid-outline" },
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
  inboxHeaderInfo,
  bookmarksHeaderInfo,
  profileHeaderInfo,
  worksHeaderInfo,
  allFandomsHeaderInfo,
  tagWorksHeaderInfo,
}) => {
  const insets = useSafeAreaInsets();
  const headerHeight = HEADER_CONTENT_HEIGHT + insets.top;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;
  // The Subscribe/Mute/Block dropdown shown on someone else's profile — a
  // separate, much simpler Modal than the drawer above (no drag/animation
  // needed, just show/hide on tap).
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  // The "Color Theme" drawer item's own picker — a separate Modal rendered
  // alongside the drawer's, opened without closing the drawer first (so
  // tapping its own close/Select button is what dismisses both at once).
  const [themeModalOpen, setThemeModalOpen] = useState(false);

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

  const handleOpenThemeSettings = () => {
    closeMenu();
    setThemeModalOpen(true);
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
    } else if (activeTab === "inbox" && inboxHeaderInfo?.onGoBack) {
      inboxHeaderInfo.onGoBack();
    } else if (activeTab === "bookmarks" && bookmarksHeaderInfo?.onGoBack) {
      bookmarksHeaderInfo.onGoBack();
    } else if (activeTab === "profile" && profileHeaderInfo?.onGoBack) {
      profileHeaderInfo.onGoBack();
    } else if (activeTab === "works" && worksHeaderInfo?.onGoBack) {
      worksHeaderInfo.onGoBack();
    } else if (activeTab === "allFandoms" && allFandomsHeaderInfo?.onGoBack) {
      allFandomsHeaderInfo.onGoBack();
    } else if (activeTab === "tagWorks" && tagWorksHeaderInfo?.onGoBack) {
      tagWorksHeaderInfo.onGoBack();
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
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          ) : iconUrl ? (
            <Image source={{ uri: iconUrl }} style={styles.avatarImage} />
          ) : (
            <Ionicons name="person-circle-outline" size={32} color={colors.text} />
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
                  color={readerHeaderInfo.isTtsActive ? "#4cd137" : colors.text}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={readerHeaderInfo.onOpenComments} style={styles.actionBtn}>
                <Ionicons name="chatbubble-outline" size={20} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={readerHeaderInfo.onOpenSettings} style={styles.actionBtn}>
                <Ionicons name="settings-outline" size={20} color={colors.text} />
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
                  color={historyHeaderInfo.activeSubTab === "history" ? colors.accentText : colors.textMuted}
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
                  color={historyHeaderInfo.activeSubTab === "to-read" ? colors.accentText : colors.textMuted}
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
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
          </>
        ) : activeTab === "inbox" && inboxHeaderInfo ? (
          <>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {inboxHeaderInfo.title || "Inbox"}
            </Text>
            <TouchableOpacity
              onPress={inboxHeaderInfo.onToggleFilters}
              style={styles.avatarBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="options-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </>
        ) : activeTab === "bookmarks" && bookmarksHeaderInfo ? (
          <>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {bookmarksHeaderInfo.title || "Bookmarks"}
            </Text>
            <TouchableOpacity
              onPress={bookmarksHeaderInfo.onToggleFilters}
              style={styles.avatarBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="options-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </>
        ) : activeTab === "works" && worksHeaderInfo ? (
          <>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {worksHeaderInfo.title || "Works"}
            </Text>
            <TouchableOpacity
              onPress={worksHeaderInfo.onToggleFilters}
              style={styles.avatarBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="options-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </>
        ) : activeTab === "tagWorks" && tagWorksHeaderInfo ? (
          <>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {tagWorksHeaderInfo.title || "Works"}
            </Text>
            <TouchableOpacity
              onPress={tagWorksHeaderInfo.onToggleFilters}
              style={styles.avatarBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="options-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </>
        ) : activeTab === "profile" && profileHeaderInfo ? (
          <>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {profileHeaderInfo.title || "Profile"}
            </Text>
            {profileHeaderInfo.actions ? (
              <TouchableOpacity
                onPress={() => setProfileMenuOpen(true)}
                style={styles.avatarBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
              </TouchableOpacity>
            ) : (
              <View style={styles.avatarBtn} />
            )}
          </>
        ) : activeTab === "allFandoms" && allFandomsHeaderInfo ? (
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.textFaint} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={allFandomsHeaderInfo.searchQuery}
              onChangeText={allFandomsHeaderInfo.onSearchQueryChange}
              placeholder={`Search ${allFandomsHeaderInfo.title}`}
              placeholderTextColor="#777"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {allFandomsHeaderInfo.searchQuery.length > 0 ? (
              <TouchableOpacity
                onPress={() => allFandomsHeaderInfo.onSearchQueryChange("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={16} color={colors.textFaint} />
              </TouchableOpacity>
            ) : null}
          </View>
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
                <Ionicons name="person-circle-outline" size={48} color={colors.text} />
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
                  color={activeTab === item.key ? colors.accent : colors.textMuted}
                />
                <Text
                  style={[styles.panelItemLabel, activeTab === item.key && styles.panelItemLabelActive]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.panelItem} onPress={handleOpenThemeSettings}>
              <Ionicons name="color-palette" size={22} color={colors.textMuted} />
              <Text style={styles.panelItemLabel}>Color Theme</Text>
            </TouchableOpacity>

            <View style={styles.panelSpacer} />

            <TouchableOpacity style={styles.panelItem} onPress={handleLogout}>
              <Ionicons name="log-out" size={22} color={colors.danger} />
              <Text style={[styles.panelItemLabel, { color: colors.danger }]}>Logout</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <ThemeSettingsModal visible={themeModalOpen} onClose={() => setThemeModalOpen(false)} />

      <Modal
        visible={profileMenuOpen && activeTab === "profile" && !!profileHeaderInfo?.actions}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileMenuOpen(false)}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setProfileMenuOpen(false)} />
        <View style={[styles.profileMenu, { top: headerHeight + 4 }]}>
          <TouchableOpacity
            style={styles.profileMenuItem}
            disabled={profileHeaderInfo?.actions?.subscribing}
            onPress={() => {
              profileHeaderInfo?.actions?.onToggleSubscribe();
              setProfileMenuOpen(false);
            }}
          >
            <Ionicons
              name={profileHeaderInfo?.actions?.isSubscribed ? "heart" : "heart-outline"}
              size={16}
              color={colors.textMuted}
            />
            <Text style={styles.profileMenuItemLabel}>
              {profileHeaderInfo?.actions?.isSubscribed ? "Unsubscribe" : "Subscribe"}
            </Text>
          </TouchableOpacity>
          <View style={styles.profileMenuDivider} />
          <TouchableOpacity
            style={styles.profileMenuItem}
            onPress={() => {
              profileHeaderInfo?.actions?.onMute();
              setProfileMenuOpen(false);
            }}
          >
            <Ionicons name="volume-mute-outline" size={16} color={colors.textMuted} />
            <Text style={styles.profileMenuItemLabel}>Mute</Text>
          </TouchableOpacity>
          <View style={styles.profileMenuDivider} />
          <TouchableOpacity
            style={styles.profileMenuItem}
            onPress={() => {
              profileHeaderInfo?.actions?.onBlock();
              setProfileMenuOpen(false);
            }}
          >
            <Ionicons name="ban-outline" size={16} color={colors.danger} />
            <Text style={[styles.profileMenuItemLabel, { color: colors.danger }]}>Block</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    borderColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.text,
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
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  readerChapterTitle: {
    color: colors.textMuted,
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
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 1,
  },
  historyTabBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  historyTabLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    flexShrink: 1,
  },
  historyTabLabelActive: {
    color: colors.accentText,
  },
  searchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 0,
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
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
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
    borderColor: colors.border,
    marginBottom: 8,
  },
  panelUsername: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  panelDivider: {
    height: 1,
    backgroundColor: colors.border,
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
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
  },
  panelItemLabelActive: {
    color: colors.accent,
  },
  panelSpacer: {
    flex: 1,
  },
  profileMenu: {
    position: "absolute",
    right: 12,
    minWidth: 160,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    overflow: "hidden",
  },
  profileMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  profileMenuItemLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  profileMenuDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
});

export default Ao3Header;
