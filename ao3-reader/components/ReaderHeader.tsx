import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { Settings, X } from "lucide-react-native";

interface ReaderHeaderProps {
  fanficTitle: string;
  chapterTitle: string;
  fontSize: number;
  lineSpacing: number;
  paragraphSpacing: number;
  padding: number;
  onConfigChange: (config: {
    fontSize?: number;
    lineSpacing?: number;
    paragraphSpacing?: number;
    padding?: number;
  }) => void;
  onToggleTts?: () => void;
  isTtsActive?: boolean;
}

const ReaderHeader: React.FC<ReaderHeaderProps> = ({
  fanficTitle,
  chapterTitle,
  fontSize,
  lineSpacing,
  paragraphSpacing,
  padding,
  onConfigChange,
  onToggleTts,
  isTtsActive = false,
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <>
      {/* 🧭 Header principal */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.fanficTitle}>
            {fanficTitle}
          </Text>
          <Text numberOfLines={1} style={styles.chapterTitle}>
            {chapterTitle}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TouchableOpacity onPress={() => onToggleTts && onToggleTts()} style={{ marginRight: 12 }}>
            <Ionicons name="headset" size={20} color={isTtsActive ? "#4cd137" : "#fff"} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setVisible(true)}>
            <Settings color="#fff" size={22} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ⚙️ Modal de configuração */}
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configurações de Leitura</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <X color="#fff" size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView>
              <View style={styles.setting}>
                <Text style={styles.label}>Tamanho da fonte: {fontSize}px</Text>
                <Slider
                  minimumValue={12}
                  maximumValue={28}
                  value={fontSize}
                  onValueChange={(v) => onConfigChange({ fontSize: v })}
                />
              </View>

              <View style={styles.setting}>
                <Text style={styles.label}>Espaçamento entre linhas: {lineSpacing}</Text>
                <Slider
                  minimumValue={1.2}
                  maximumValue={2.5}
                  step={0.1}
                  value={lineSpacing}
                  onValueChange={(v) => onConfigChange({ lineSpacing: v })}
                />
              </View>

              <View style={styles.setting}>
                <Text style={styles.label}>
                  Espaçamento entre parágrafos: {paragraphSpacing}
                </Text>
                <Slider
                  minimumValue={0}
                  maximumValue={20}
                  step={1}
                  value={paragraphSpacing}
                  onValueChange={(v) => onConfigChange({ paragraphSpacing: v })}
                />
              </View>

              <View style={styles.setting}>
                <Text style={styles.label}>Padding lateral: {padding}px</Text>
                <Slider
                  minimumValue={10}
                  maximumValue={50}
                  step={1}
                  value={padding}
                  onValueChange={(v) => onConfigChange({ padding: v })}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: "#111",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  fanficTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  chapterTitle: {
    color: "#aaa",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#222",
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  setting: {
    marginVertical: 12,
  },
  label: {
    color: "#ccc",
    marginBottom: 6,
  },
});

export default ReaderHeader;
