import React, { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { PersonResult } from "../api/ao3PeopleSearch";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  person: PersonResult;
  // Tapping the card or the name opens that person's profile.
  onPress: (person: PersonResult) => void;
  onPressWorks?: (person: PersonResult) => void;
  onPressBookmarks?: (person: PersonResult) => void;
}

// One entry of People Search: the pseud's icon, "Pseud (account)", its work and
// bookmark counts and its "about" text — AO3's own people list, as a card.
const AO3PersonCard: React.FC<Props> = ({ person, onPress, onPressWorks, onPressBookmarks }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable onPress={() => onPress(person)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.header}>
        {person.iconUrl ? <Image source={{ uri: person.iconUrl }} style={styles.icon} /> : <View style={styles.icon} />}
        <View style={styles.titleBlock}>
          <Text style={styles.name} numberOfLines={2}>
            {person.pseud}
            {person.account ? <Text style={styles.account}>{` (${person.account.label})`}</Text> : null}
          </Text>
          {person.works || person.bookmarks ? (
            <Text style={styles.counts}>
              {person.works ? (
                <Text style={styles.countLink} onPress={() => onPressWorks?.(person)}>
                  {person.works.label}
                </Text>
              ) : null}
              {person.works && person.bookmarks ? ", " : null}
              {person.bookmarks ? (
                <Text style={styles.countLink} onPress={() => onPressBookmarks?.(person)}>
                  {person.bookmarks.label}
                </Text>
              ) : null}
            </Text>
          ) : null}
        </View>
      </View>
      {person.about ? <Text style={styles.about}>{person.about}</Text> : null}
    </Pressable>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      gap: 10,
    },
    cardPressed: { opacity: 0.75 },
    header: { flexDirection: "row", alignItems: "center", gap: 12 },
    icon: { width: 56, height: 56, borderRadius: 6, backgroundColor: colors.surfaceAlt },
    titleBlock: { flex: 1, gap: 4 },
    name: { color: colors.accent, fontSize: 15, fontWeight: "700" },
    account: { color: colors.textMuted, fontWeight: "400" },
    counts: { color: colors.textFaint, fontSize: 13 },
    countLink: { color: colors.textMuted, textDecorationLine: "underline" },
    about: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  });

export default React.memo(AO3PersonCard);
