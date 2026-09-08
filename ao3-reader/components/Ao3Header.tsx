import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
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

export type Ao3Tab = "home" | "reader" | "history";

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
  // Only rendered when activeTab === "reader" / "history" respectively.
  readerHeaderInfo?: ReaderHeaderInfo | null;
  historyHeaderInfo?: HistoryHeaderInfo | null;
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

  const panelWidth = 280;
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
          onPress={openMenu}
          style={styles.avatarBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {iconUrl ? (
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
