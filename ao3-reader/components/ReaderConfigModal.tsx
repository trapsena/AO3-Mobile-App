import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
} from "react-native";
import Slider from "@react-native-community/slider";
import { X } from "lucide-react-native";

interface ReaderConfigModalProps {
  visible: boolean;
  fontSize: number;
  lineHeight: number;
  padding: number;
  onChangeFontSize: (value: number) => void;
  onChangeLineHeight: (value: number) => void;
  onChangePadding: (value: number) => void;
  onClose: () => void;
}

const SCREEN_HEIGHT = Dimensions.get("window").height;

const ReaderConfigModal: React.FC<ReaderConfigModalProps> = ({
  visible,
  fontSize,
  lineHeight,
  padding,
  onChangeFontSize,
  onChangeLineHeight,
  onChangePadding,
  onClose,
}) => {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <>
      {/* Overlay escuro */}
      {visible && (
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={onClose}
        />
      )}

      {/* Bottom Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Configurações de leitura</Text>
          <TouchableOpacity onPress={onClose}>
            <X color="#fff" size={22} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Tamanho da fonte: {fontSize.toFixed(0)}</Text>
          <Slider
            minimumValue={12}
            maximumValue={28}
            value={fontSize}
            onValueChange={onChangeFontSize}
            minimumTrackTintColor="#fff"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Espaçamento entre linhas: {lineHeight}</Text>
          <Slider
            minimumValue={18}
            maximumValue={40}
            step={1}
            value={lineHeight}
            onValueChange={onChangeLineHeight}
            minimumTrackTintColor="#fff"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Padding lateral: {padding.toFixed(0)}</Text>
          <Slider
            minimumValue={10}
            maximumValue={50}
            value={padding}
            onValueChange={onChangePadding}
            minimumTrackTintColor="#fff"
          />
        </View>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  section: {
    marginVertical: 10,
  },
  label: {
    color: "#ccc",
    marginBottom: 6,
  },
});

export default ReaderConfigModal;
