import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchWithSession } from "../api/ao3Auth";
import { extractUsernameFromUsersUrl } from "../api/ao3Bookmarks";
import { parsePeopleSearchResults, PeopleResultsPage, PersonResult } from "../api/ao3PeopleSearch";
import AO3PagingBar from "../components/AO3PagingBar";
import AO3PersonCard from "../components/AO3PersonCard";
import type { AO3Link } from "../components/AO3WorkBlurb";
import type { PeopleResultsHeaderInfo } from "../components/Ao3Header";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  // The People Search results address (see buildPeopleSearchUrl).
  url: string;
  onClose: () => void;
  // Opens a person's profile, the same call every author byline makes.
  onPressAuthor: (author: AO3Link) => void;
  // Open an account's works / bookmarks listing.
  onPressWorks: (username?: string) => void;
  onPressBookmarks: (username?: string) => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  onHeaderActionsChange?: (info: PeopleResultsHeaderInfo | null) => void;
}

const AO3PeopleResultsScreen: React.FC<Props> = ({
  url,
  onClose,
  onPressAuthor,
  onPressWorks,
  onPressBookmarks,
  onScroll,
  contentContainerTopPadding = 0,
  onHeaderActionsChange,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listRef = useRef<any>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [page, setPage] = useState<PeopleResultsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bumped to re-run the load for the same address (pull to refresh, retry).
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithSession(currentUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parsePeopleSearchResults(await res.text());
        if (cancelled) return;
        setPage(parsed);
        setFailed(false);
      } catch (error) {
        console.warn("[AO3PeopleResultsScreen] Could not load the results:", error);
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
    onHeaderActionsChange?.({ title: "People Search", onGoBack: onClose });
  }, [onClose, onHeaderActionsChange]);

  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToUrl = useCallback((next?: string) => {
    if (!next) return;
    setLoading(true);
    setPage(null);
    setCurrentUrl(next);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadCount((count) => count + 1);
  }, []);

  const handlePressPerson = useCallback(
    (person: PersonResult) => onPressAuthor({ label: person.pseud, href: person.pseudHref }),
    [onPressAuthor],
  );
  const handlePressWorks = useCallback(
    (person: PersonResult) => onPressWorks(extractUsernameFromUsersUrl(person.pseudHref) ?? undefined),
    [onPressWorks],
  );
  const handlePressBookmarks = useCallback(
    (person: PersonResult) => onPressBookmarks(extractUsernameFromUsersUrl(person.pseudHref) ?? undefined),
    [onPressBookmarks],
  );

  const renderItem = useCallback(
    ({ item }: { item: PersonResult }) => (
      <View style={styles.itemWrap}>
        <AO3PersonCard
          person={item}
          onPress={handlePressPerson}
          onPressWorks={handlePressWorks}
          onPressBookmarks={handlePressBookmarks}
        />
      </View>
    ),
    [styles, handlePressPerson, handlePressWorks, handlePressBookmarks],
  );

  const contentContainerStyle = useMemo(
    () => [styles.listContent, { paddingTop: styles.listContent.padding + contentContainerTopPadding }],
    [styles, contentContainerTopPadding],
  );

  const pagingBar = page ? <AO3PagingBar pagination={page} onGo={goToUrl} /> : null;

  const listHeader = (
    <View style={styles.headerWrap}>
      {page?.found ? <Text style={styles.foundText}>{page.found}</Text> : null}
      {pagingBar}
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: contentContainerTopPadding }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Searching people...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={listRef}
        data={page?.people ?? []}
        keyExtractor={(item, index) => `${item.pseudHref}-${index}`}
        renderItem={renderItem}
        contentContainerStyle={contentContainerStyle}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        ListHeaderComponent={listHeader}
        ListFooterComponent={pagingBar}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{failed ? "Couldn't load the results" : "No people found"}</Text>
            <Text style={styles.emptyBody}>
              {failed ? "Pull down to try again." : "Try a different name, fandom or search term."}
            </Text>
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
    headerWrap: { marginBottom: 4 },
    foundText: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 4 },
    itemWrap: { width: "100%", marginBottom: 12 },
    emptyState: { padding: 24, alignItems: "center", justifyContent: "center" },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 8 },
    emptyBody: { color: colors.textFaint, fontSize: 13, textAlign: "center", lineHeight: 18 },
  });

export default AO3PeopleResultsScreen;
