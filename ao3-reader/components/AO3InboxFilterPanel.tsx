import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AO3InboxFilterGroup } from "../api/ao3InboxTypes";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PANEL_WIDTH = Math.min(340, SCREEN_WIDTH * 0.88);

type AO3InboxFilterPanelStyles = ReturnType<typeof createStyles>;

interface Props {
  visible: boolean;
  onClose: () => void;
  // Radio groups read off the loaded inbox page's own filter sidebar.
  groups: AO3InboxFilterGroup[];
  // The person's unapplied picks, keyed by radio group name. A group with no
  // entry here falls back to whichever option the loaded page has checked.
  values: Record<string, string>;
  onSelect: (name: string, value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

const AO3InboxFilterPanel: React.FC<Props> = ({ visible, onClose, groups, values, onSelect, onApply, onClear }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(PANEL_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, { toValue: visible ? 0 : PANEL_WIDTH, duration: 260, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: visible ? 1 : 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [visible, translateX, backdropOpacity]);

  const handleApply = useCallback(() => {
    onApply();
    onClose();
  }, [onApply, onClose]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.panel, { transform: [{ translateX }] }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Filter Inbox</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {groups.map((group) => {
            const picked = values[group.name];
            return (
              <View key={group.name} style={styles.section}>
                <Text style={styles.sectionTitle}>{group.title}</Text>
                {group.options.map((option) => (
                  <RadioRow
                    key={option.value}
                    groupName={group.name}
                    value={option.value}
                    label={option.label}
                    active={picked !== undefined ? picked === option.value : option.checked}
                    onSelect={onSelect}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyBtn} onPress={handleApply}>
            <Text style={styles.applyBtnText}>Filter</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

const RadioRow: React.FC<{
  groupName: string;
  value: string;
  label: string;
  active: boolean;
  onSelect: (name: string, value: string) => void;
  styles: AO3InboxFilterPanelStyles;
  colors: ThemeColors;
}> = React.memo(({ groupName, value, label, active, onSelect, styles, colors }) => {
  const handlePress = useCallback(() => onSelect(groupName, value), [onSelect, groupName, value]);
  return (
    <TouchableOpacity style={styles.radioRow} onPress={handlePress}>
      <Ionicons
        name={active ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={active ? colors.accent : colors.textFaint}
      />
      <Text style={[styles.radioLabel, active && styles.radioLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: PANEL_WIDTH,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 18,
    gap: 4,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  radioLabel: {
    color: colors.textMuted,
    fontSize: 14,
    flexShrink: 1,
  },
  radioLabelActive: {
    color: colors.text,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clearBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearBtnText: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  applyBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  applyBtnText: {
    color: colors.accentText,
    fontWeight: "700",
  },
});

export default AO3InboxFilterPanel;
