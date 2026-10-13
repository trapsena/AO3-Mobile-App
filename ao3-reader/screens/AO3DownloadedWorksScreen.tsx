import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  DownloadedFanficEntry,
  loadCachedDownloadedFanfics,
  syncDownloadedFanfics,
} from "../api/ao3DownloadedFanfics";
import AO3WorkBlurb, { AO3Link } from "../components/AO3WorkBlurb";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  // Tapping a card opens that downloaded file in the reader.
  onWorkPress: (entry: DownloadedFanficEntry) => void;
  onPressAuthor: (author: AO3Link) => void;
  // Opens the in-app works listing for a tag (AO3TagWorksScreen).
  onPressTag: (tag: AO3Link) => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
}

// True when both lists are the same files, unchanged — the saved list shown
// first and the folder check that follows it usually agree, and keeping the
// list that is already on screen avoids redrawing every card for nothing.
const sameFiles = (a: DownloadedFanficEntry[], b: DownloadedFanficEntry[]) =>
  a.length === b.length &&
  a.every((entry, i) => entry.fileName === b[i].fileName && entry.sizeBytes === b[i].sizeBytes && entry.savedAt === b[i].savedAt);

// Every HTML work in the app's "Fanfics" folder, drawn with the same card the
// web listings use. The card data (tags, stats, ...) was read out of each
// file's own <dl class="tags"> block and saved on the phone (see
// api/ao3DownloadedFanfics.ts), so nothing here touches the network.
const AO3DownloadedWorksScreen: React.FC<Props> = ({
  onWorkPress,
  onPressAuthor,
  onPressTag,
  onScroll,
  contentContainerTopPadding = 0,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [entries, setEntries] = useState<DownloadedFanficEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The saved list first — it needs no file access, so the cards are up
      // straight away — then the folder check, which picks up new downloads and
      // drops deleted ones.
      try {
        const saved = await loadCachedDownloadedFanfics();
        if (!cancelled && saved.length > 0) {
          setEntries(saved);
          setLoading(false);
        }
      } catch (error) {
        console.warn("[AO3DownloadedWorksScreen] Could not load the saved list:", error);
      }
      try {
        const current = await syncDownloadedFanfics();
        if (!cancelled) setEntries((previous) => (sameFiles(previous, current) ? previous : current));
      } catch (error) {
        console.warn("[AO3DownloadedWorksScreen] Could not check the Fanfics folder:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A tag without a link (the rating / category pills, which are shown for
  // information) has no works list to open.
  const handlePressTag = useCallback(
    (tag: AO3Link) => {
      if (tag.href) onPressTag(tag);
    },
    [onPressTag],
  );

  const keyExtractor = useCallback((item: DownloadedFanficEntry) => item.fileName, []);

  const contentContainerStyle = useMemo(
    () => [styles.listContent, { paddingTop: styles.listContent.padding + contentContainerTopPadding }],
    [styles, contentContainerTopPadding],
  );

  const renderItem = useCallback(
    ({ item }: { item: DownloadedFanficEntry }) => (
      <View style={styles.itemWrap}>
        <AO3WorkBlurb
          kind="work"
          work={item.work}
          onPressWork={() => onWorkPress(item)}
          onPressAuthor={onPressAuthor}
          onPressTag={handlePressTag}
        />
      </View>
    ),
    [styles, onWorkPress, onPressAuthor, handlePressTag],
  );

  const listHeader = useMemo(
    () =>
      entries.length > 0 ? (
        <Text style={styles.countText}>
          {entries.length} downloaded work{entries.length === 1 ? "" : "s"}
        </Text>
      ) : null,
    [styles, entries.length],
  );

  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No downloads yet</Text>
        <Text style={styles.emptyBody}>
          Open a work in the reader and choose Download from the ⋮ menu. It will be listed here.
        </Text>
      </View>
    ),
    [styles],
  );

  return (
    // No paddingTop here: this box stays full-screen so the list can scroll
    // its content behind the app's absolutely-positioned header (see the same
    // note in AO3WorksScreen).
    <View style={styles.container}>
      {loading ? (
        <View style={[styles.loading, { paddingTop: contentContainerTopPadding }]}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <Animated.FlatList
          data={entries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={contentContainerStyle}
          onScroll={onScroll}
          scrollEventThrottle={16}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
        />
      )}
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    loading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    listContent: {
      padding: 16,
      gap: 16,
    },
    itemWrap: {
      width: "100%",
      marginBottom: 16,
    },
    countText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    emptyState: {
      padding: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      marginBottom: 8,
    },
    emptyBody: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: "center",
      lineHeight: 18,
    },
  });

export default AO3DownloadedWorksScreen;
