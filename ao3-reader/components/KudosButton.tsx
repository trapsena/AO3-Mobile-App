import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  // Fades in/out; while hidden it ignores touches.
  visible: boolean;
  // Kudos already left (this session): the heart is filled in.
  given: boolean;
  submitting: boolean;
  onPress: () => void;
  // Distance from the bottom of the screen, so it clears the controls below it.
  bottom: number;
}

// The round heart button that floats at the lower right once the end of a
// chapter is reached — in the app's accent colour — for leaving kudos.
const KudosButton: React.FC<Props> = ({ visible, given, submitting, onPress, bottom }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [visible, opacity]);

  return (
    <Animated.View pointerEvents={visible ? "box-none" : "none"} style={[styles.wrap, { bottom, opacity }]}>
      <TouchableOpacity
        style={styles.button}
        onPress={onPress}
        disabled={submitting}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={given ? "Kudos left" : "Leave kudos"}
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.accentText} />
        ) : (
          <Ionicons name={given ? "heart" : "heart-outline"} size={28} color={colors.accentText} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: { position: "absolute", right: 16 },
    button: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      elevation: 6,
      shadowColor: "#000",
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
    },
  });

export default KudosButton;
