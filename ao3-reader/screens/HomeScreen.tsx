import React from "react";
import { View, StyleSheet, Text, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import AO3ListingScreen, { AO3ListingItem } from "./AO3ListingScreen";

interface Props {
  username: string | null;
  // Called with a fic's URL when a work card is pressed. The caller (App.tsx)
  // owns the active tab, so it's the one that should switch to the Reader tab.
  onOpenReader?: (url: string) => void;
  // Forwarded to AO3ListingScreen's list so the app's collapsible header can
  // track this screen's scroll position.
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
}

const HomeScreen: React.FC<Props> = ({ username, onOpenReader, onScroll, contentContainerTopPadding }) => {
  if (!username) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>No username available</Text>
      </View>
    );
  }

  const profileUrl = `https://archiveofourown.org/users/${encodeURIComponent(username)}`;

  const handleItemPress = (item: AO3ListingItem) => {
    const url = item.work?.workUrl ?? item.bookmark?.workUrl;
    if (!url) {
      console.warn("[HomeScreen] Pressed item has no work URL, nothing to open:", item.id);
      return;
    }
    onOpenReader?.(url);
  };

  return (
    <View style={styles.container}>
      <AO3ListingScreen
        url={profileUrl}
        title={`${username}'s AO3 dashboard`}
        showHeader={false}
        onItemPress={handleItemPress}
        onScroll={onScroll}
        contentContainerTopPadding={contentContainerTopPadding}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  text: {
    color: "#fff",
    textAlign: "center",
    marginTop: 40,
  },
});

export default HomeScreen;