import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

export interface SelectFieldOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectFieldOption[];
  onChange: (value: string) => void;
  // Shown (dimmed) while `value` matches no option — the empty choice of an
  // AO3 menu, which has a blank entry rather than a label.
  placeholder?: string;
  // Adds a filter box to the list, for long menus like AO3's languages.
  searchable?: boolean;
  // Offers a "no choice" row at the top of the list that sets the value to "".
  allowEmpty?: boolean;
  title?: string;
}

// A tap-to-open stand-in for the HTML <select> AO3's forms use: the field shows
// the current choice, and the list opens in a modal.
const SelectField: React.FC<Props> = ({ value, options, onChange, placeholder = "Any", searchable, allowEmpty, title }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const selected = options.find((option) => option.value === value);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
    return allowEmpty && !needle ? [{ value: "", label: placeholder }, ...list] : list;
  }, [options, filter, allowEmpty, placeholder]);

  const close = () => {
    setOpen(false);
    setFilter("");
  };

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={[styles.fieldText, !selected && styles.fieldPlaceholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textFaint} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
            {searchable ? (
              <TextInput
                style={styles.filterInput}
                value={filter}
                onChangeText={setFilter}
                placeholder="Search"
                placeholderTextColor={colors.textFaint}
                autoCorrect={false}
                autoCapitalize="none"
              />
            ) : null}
            <FlatList
              data={visible}
              keyExtractor={(item) => item.value || "__empty"}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                  >
                    <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={2}>
                      {item.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    field: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 11,
      gap: 8,
    },
    fieldText: { flex: 1, color: colors.text, fontSize: 14 },
    fieldPlaceholder: { color: colors.textFaint },
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
    sheet: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      maxHeight: "75%",
      overflow: "hidden",
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
    },
    filterInput: {
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      marginHorizontal: 12,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 8,
    },
    rowText: { flex: 1, color: colors.textMuted, fontSize: 14 },
    rowTextActive: { color: colors.text, fontWeight: "700" },
  });

export default SelectField;
