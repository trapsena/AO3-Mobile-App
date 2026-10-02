import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  index: number;              // índice atual (0-based)
  total: number;              // total de capítulos
  onPrev: () => void;
  onNext: () => void;
}

const ChapterControls: React.FC<Props> = ({ index, total, onPrev, onNext }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onPrev} disabled={index <= 0} style={[styles.btn, index <= 0 && styles.btnDisabled]}>
        <Text style={styles.btnText}>⬅️</Text>
      </TouchableOpacity>

      <Text style={styles.caption}>
        Capítulo {Math.min(index + 1, total)} / {total || "?"}
      </Text>

      <TouchableOpacity onPress={onNext} disabled={index >= total - 1} style={[styles.btn, index >= total - 1 && styles.btnDisabled]}>
        <Text style={styles.btnText}>➡️</Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: colors.surface },
  btn: { padding: 8 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.text, fontSize: 18 },
  caption: { color: colors.text, alignSelf: "center" },
});

export default ChapterControls;
