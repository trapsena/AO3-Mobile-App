import React, { useCallback, useEffect, useState } from "react";
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
import { AO3FandomCategory, fetchFandomCategories } from "../api/ao3Fandoms";
import { AO3Link } from "../components/AO3WorkBlurb";

interface Props {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  // Opens the in-app full listing for one category (AO3AllFandomsScreen) —
  // a much bigger destination than a single fandom's own tag page.
  onOpenAllFandoms: (category: { title: string; allHref: string }) => void;
  // Opens the in-app works listing for a single fandom tag (AO3TagWorksScreen)
  // — a fandom's href already points straight at AO3's own `/tags/<fandom>/works`,
  // the same shape every other tag chip in this app already navigates with.
  onPressTag: (tag: AO3Link) => void;
}

// AO3's own "Fandoms" index (archiveofourown.org/media) — 11 media
// categories, each showing its 5 most popular fandoms plus a link to browse
// every fandom in that category. Tapping a fandom opens its works listing
// in-app (same destination every other tag chip in the app uses); "All X..."
// opens the in-app full alphabetical listing instead.
const AO3FandomsScreen: React.FC<Props> = ({
  onScroll,
  contentContainerTopPadding = 0,
  onOpenAllFandoms,
  onPressTag,
}) => {
  const [categories, setCategories] = useState<AO3FandomCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchFandomCategories();
    setCategories(result);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingTop: contentContainerTopPadding + 16 }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#7ec14b"
            colors={["#7ec14b"]}
          />
        }
      >
        <Text style={styles.pageTitle}>Fandoms</Text>

        {categories.length === 0 ? (
          <Text style={styles.emptyText}>Couldn't load fandoms. Pull down to try again.</Text>
        ) : (
          categories.map((category) => (
            <View key={category.id} style={styles.fandomsBox}>
              <Text style={styles.fandomsTitle}>{category.title}</Text>

              <View style={styles.fandomsList}>
                {category.topFandoms.map((fandom, index) => (
                  <TouchableOpacity
                    key={`${fandom.name}-${index}`}
                    style={styles.fandomPill}
                    onPress={() => onPressTag({ label: fandom.name, href: fandom.href })}
                  >
                    <Text style={styles.fandomPillText} numberOfLines={1}>
                      {fandom.name}
                    </Text>
                    {typeof fandom.count === "number" ? (
                      <Text style={styles.fandomPillCount}>{` (${fandom.count})`}</Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.allBtn}
                onPress={() => onOpenAllFandoms({ title: category.title, allHref: category.allHref })}
              >
                <Text style={styles.allBtnText}>All {category.title}...</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </Animated.ScrollView>
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
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  pageTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  emptyText: {
    color: "#999",
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
  fandomsBox: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  fandomsTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  fandomsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fandomPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1c",
    borderColor: "#343434",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  fandomPillText: {
    flexShrink: 1,
    color: "#d8d8d8",
    fontSize: 12,
    fontWeight: "600",
  },
  fandomPillCount: {
    flexShrink: 0,
    color: "#d8d8d8",
    fontSize: 12,
    fontWeight: "600",
  },
  allBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  allBtnText: {
    color: "#7ec14b",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default AO3FandomsScreen;
