import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { fetchWithSession } from "../api/ao3Auth";
import { parseTagSearchResults, TagResult, TagResultsPage } from "../api/ao3TagSearch";
import AO3PagingBar from "../components/AO3PagingBar";
import type { AO3Link } from "../components/AO3WorkBlurb";
import type { TagResultsHeaderInfo } from "../components/Ao3Header";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  // The Tag Search results address (see buildTagSearchUrl).
  url: string;
  onClose: () => void;
  // Opens the in-app works listing for a tag (AO3TagWorksScreen).
  onPressTag: (tag: AO3Link) => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  onHeaderActionsChange?: (info: TagResultsHeaderInfo | null) => void;
}

const AO3TagResultsScreen: React.FC<Props> = ({
  url,
  onClose,
  onPressTag,
  onScroll,
  contentContainerTopPadding = 0,
  onHeaderActionsChange,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listRef = useRef<any>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [page, setPage] = useState<TagResultsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithSession(currentUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseTagSearchResults(await res.text());
        if (cancelled) return;
        setPage(parsed);
        setFailed(false);
      } catch (error) {
        console.warn("[AO3TagResultsScreen] Could not load the results:", error);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUrl, reloadCount]);

  useEffect(() => {
    onHeaderActionsChange?.({ title: "Tag Search", onGoBack: onClose });
  }, [onClose, onHeaderActionsChange]);

  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToUrl = useCallback((next: string) => {
    setLoading(true);
    setPage(null);
    setCurrentUrl(next);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadCount((count) => count + 1);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: TagResult }) => (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => onPressTag({ label: item.name, href: item.worksHref })}
      >
        <View style={styles.rowTop}>
          {item.type ? <Text style={styles.typeBadge}>{item.type}</Text> : null}
          {typeof item.uses === "number" ? <Text style={styles.uses}>{item.uses.toLocaleString()} works</Text> : null}
        </View>
        <Text style={styles.tagName}>{item.name}</Text>
      </TouchableOpacity>
    ),
    [styles, onPressTag],
  );

  const contentContainerStyle = useMemo(
    () => [styles.listContent, { paddingTop: styles.listContent.padding + contentContainerTopPadding }],
    [styles, contentContainerTopPadding],
  );

  const pagingBar = page ? <AO3PagingBar pagination={page} onGo={goToUrl} /> : null;

  const listHeader = (
    <View>
      {page?.found ? <Text style={styles.foundText}>{page.found}</Text> : null}
      {pagingBar}
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: contentContainerTopPadding }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Searching tags...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={listRef}
        data={page?.tags ?? []}
        keyExtractor={(item, index) => `${item.worksHref}-${index}`}
        renderItem={renderItem}
        contentContainerStyle={contentContainerStyle}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        initialNumToRender={20}
        windowSize={9}
        ListHeaderComponent={listHeader}
        ListFooterComponent={pagingBar}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{failed ? "Couldn't load the results" : "No tags found"}</Text>
            <Text style={styles.emptyBody}>{failed ? "Pull down to try again." : "Try a different name or filter."}</Text>
          </View>
        }
      />
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: "center", justifyContent: "center", gap: 12 },
    loadingText: { color: colors.textMuted, fontSize: 14 },
    listContent: { padding: 16 },
    foundText: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 4 },
    row: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 8,
      gap: 4,
    },
    rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    typeBadge: { color: colors.textFaint, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    uses: { color: colors.textFaint, fontSize: 12 },
    tagName: { color: colors.accent, fontSize: 15 },
    emptyState: { padding: 24, alignItems: "center", justifyContent: "center" },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 8 },
    emptyBody: { color: colors.textFaint, fontSize: 13, textAlign: "center", lineHeight: 18 },
  });

export default AO3TagResultsScreen;
