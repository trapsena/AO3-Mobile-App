import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AllFandomsHeaderInfo } from "../components/Ao3Header";
import { AO3FandomTag, fetchAllFandomsInCategory } from "../api/ao3Fandoms";

interface Props {
  title: string;
  allHref: string;
  onClose: () => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  onHeaderActionsChange?: (info: AllFandomsHeaderInfo | null) => void;
}

// AO3 renders an entire media category's fandom list on a single (often
// huge — several thousand entries) page with no server-side pagination, so
// this screen fetches it once and paginates/filters it locally: 200 rows per
// page keeps each render cheap, and the header's search box (published via
// onHeaderActionsChange, see AllFandomsHeaderInfo) filters the already-loaded
// list rather than re-hitting AO3.
const PAGE_SIZE = 200;

const AO3AllFandomsScreen: React.FC<Props> = ({
  title,
  allHref,
  onClose,
  onScroll,
  contentContainerTopPadding = 0,
  onHeaderActionsChange,
}) => {
  const [allFandoms, setAllFandoms] = useState<AO3FandomTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    setAllFandoms([]);
    fetchAllFandomsInCategory(allHref, (partial, done) => {
      if (cancelled) return;
      // The fetch itself can't be split up (AO3 returns the whole category
      // as one response), but parsing happens in chunks — this fires after
      // each chunk, so the very first chunk (already enough for a full page)
      // clears the full-screen spinner instead of waiting for every fandom
      // in the category (sometimes several thousand) to finish parsing.
      setAllFandoms(partial);
      setLoading(false);
      setLoadingMore(!done);
    });
    return () => {
      cancelled = true;
    };
  }, [allHref]);

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
    setPage(1);
  }, []);

  useEffect(() => {
    onHeaderActionsChange?.({
      title,
      onGoBack: onClose,
      searchQuery,
      onSearchQueryChange: handleSearchQueryChange,
    });
  }, [title, onClose, searchQuery, handleSearchQueryChange, onHeaderActionsChange]);

  // Separate, empty-dependency effect so this cleanup only runs on unmount —
  // see the identical pattern (and its rationale) in AO3BookmarksScreen.
  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allFandoms;
    return allFandoms.filter((f) => f.name.toLowerCase().includes(q));
  }, [allFandoms, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  const goToPrevPage = () => setPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setPage((p) => Math.min(totalPages, p + 1));

  const renderItem = useCallback(
    ({ item }: { item: AO3FandomTag }) => (
      <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(item.href)}>
        <Text style={styles.rowText} numberOfLines={1}>
          {item.name}
        </Text>
        {typeof item.count === "number" ? (
          <Text style={styles.rowCount}>{item.count.toLocaleString()}</Text>
        ) : null}
      </TouchableOpacity>
    ),
    [],
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator
          size="large"
          color="#7ec14b"
          style={{ marginTop: contentContainerTopPadding + 40 }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.FlatList
        data={pageItems}
        keyExtractor={(item, index) => `${item.href}-${index}`}
        renderItem={renderItem}
        contentContainerStyle={[styles.content, { paddingTop: contentContainerTopPadding + 16 }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        initialNumToRender={30}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.countRow}>
            <Text style={styles.countText}>
              {filtered.length.toLocaleString()} fandom{filtered.length === 1 ? "" : "s"}
              {searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : ""}
              {loadingMore ? " so far…" : ""}
            </Text>
            {loadingMore ? <ActivityIndicator size="small" color="#7ec14b" /> : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {searchQuery.trim() ? "No fandoms match your search." : "Couldn't load this list. Pull down to try again."}
          </Text>
        }
        ListFooterComponent={
          filtered.length > 0 ? (
            <View style={styles.paginationWrap}>
              <TouchableOpacity
                style={[styles.pageArrowBtn, currentPage <= 1 && styles.pageArrowBtnDisabled]}
                onPress={goToPrevPage}
                disabled={currentPage <= 1}
              >
                <Ionicons name="chevron-back" size={16} color={currentPage > 1 ? "#fff" : "#555"} />
              </TouchableOpacity>

              <Text style={styles.pageIndicatorText}>
                Page {currentPage} of {totalPages}
              </Text>

              <TouchableOpacity
                style={[styles.pageArrowBtn, currentPage >= totalPages && styles.pageArrowBtnDisabled]}
                onPress={goToNextPage}
                disabled={currentPage >= totalPages}
              >
                <Ionicons name="chevron-forward" size={16} color={currentPage < totalPages ? "#fff" : "#555"} />
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  countText: {
    color: "#888",
    fontSize: 13,
  },
  emptyText: {
    color: "#999",
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1c1c1c",
  },
  rowText: {
    flex: 1,
    color: "#e0e0e0",
    fontSize: 14,
    fontWeight: "500",
  },
  rowCount: {
    flexShrink: 0,
    color: "#888",
    fontSize: 12,
  },
  paginationWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 20,
  },
  pageArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#333",
  },
  pageArrowBtnDisabled: {
    opacity: 0.4,
  },
  pageIndicatorText: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default AO3AllFandomsScreen;
