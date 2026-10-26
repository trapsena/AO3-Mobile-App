import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AO3Pagination } from "../api/ao3Pagination";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  pagination: AO3Pagination;
  // Called with the address of the page to go to.
  onGo: (href: string) => void;
}

// AO3's page bar (previous / numbered pages / next) for a results list. Draws
// nothing when there is only one page.
const AO3PagingBar: React.FC<Props> = ({ pagination, onGo }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { pages, prevHref, nextHref } = pagination;
  if (!prevHref && !nextHref && pages.length <= 1) return null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.arrow, !prevHref && styles.arrowDisabled]}
        onPress={() => prevHref && onGo(prevHref)}
        disabled={!prevHref}
      >
        <Ionicons name="chevron-back" size={16} color={prevHref ? colors.text : colors.textFaint} />
      </TouchableOpacity>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.numbers}>
        {pages.map((p, index) =>
          p.isGap ? (
            <Text key={`gap-${index}`} style={styles.gap}>
              …
            </Text>
          ) : (
            <TouchableOpacity
              key={`${p.label}-${index}`}
              style={[styles.number, p.isCurrent && styles.numberActive]}
              onPress={() => p.href && !p.isCurrent && onGo(p.href)}
              disabled={p.isCurrent || !p.href}
            >
              <Text style={[styles.numberText, p.isCurrent && styles.numberTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ),
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.arrow, !nextHref && styles.arrowDisabled]}
        onPress={() => nextHref && onGo(nextHref)}
        disabled={!nextHref}
      >
        <Ionicons name="chevron-forward" size={16} color={nextHref ? colors.text : colors.textFaint} />
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 12 },
    arrow: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    arrowDisabled: { opacity: 0.4 },
    numbers: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
    number: {
      minWidth: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    numberActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    numberText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
    numberTextActive: { color: colors.accentText },
    gap: { color: colors.textFaint, fontSize: 13, paddingHorizontal: 4, alignSelf: "center" },
  });

export default AO3PagingBar;
