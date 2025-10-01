import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface Props {
  index: number;              // índice atual (0-based)
  total: number;              // total de capítulos
  onPrev: () => void;
  onNext: () => void;
}

const ChapterControls: React.FC<Props> = ({ index, total, onPrev, onNext }) => {
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

const styles = StyleSheet.create({
  container: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: "#111" },
  btn: { padding: 8 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "white", fontSize: 18 },
  caption: { color: "white", alignSelf: "center" },
});

export default ChapterControls;
