import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AO3BookmarkEditForm,
  fetchBookmarkEditForm,
  submitBookmarkEdit,
} from "../api/ao3BookmarkEdit";
import { fetchCollectionAutocomplete } from "../api/ao3Autocomplete";
import TagAutocompleteInput from "./TagAutocompleteInput";

interface Props {
  visible: boolean;
  editHref: string | null;
  // The page the bookmark action is being performed from, sent as the
  // submit request's Referer — matching how the rest of this app's AO3
  // write requests (replies, subscriptions, ...) identify their origin page.
  refererUrl: string;
  onClose: () => void;
  // Called after a successful save so the screen can refresh its list.
  onSaved: () => void;
}

const BookmarkEditModal: React.FC<Props> = ({ visible, editHref, refererUrl, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<AO3BookmarkEditForm | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [notes, setNotes] = useState("");
  const [tagString, setTagString] = useState("");
  const [collectionNames, setCollectionNames] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isRec, setIsRec] = useState(false);

  useEffect(() => {
    if (!visible || !editHref) return;

    setLoading(true);
    setLoadError(null);
    setForm(null);

    fetchBookmarkEditForm(editHref)
      .then((result) => {
        if (!result) {
          setLoadError("Couldn't load the bookmark's edit form. Please try again.");
          return;
        }
        setForm(result);
        setNotes(result.notes);
        setTagString(result.tagString);
        setCollectionNames(result.collectionNames);
        setIsPrivate(result.isPrivate);
        setIsRec(result.isRec);
      })
      .catch((err) => {
        console.warn("[BookmarkEditModal] Could not load edit form:", err);
        setLoadError("Couldn't load the bookmark's edit form. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [visible, editHref]);

  const handleSave = useCallback(() => {
    if (!form) return;
    setSubmitting(true);
    submitBookmarkEdit(form, { notes, tagString, collectionNames, isPrivate, isRec }, refererUrl)
      .then((result) => {
        if (result.ok) {
          onSaved();
        } else if (result.reason === "auth") {
          Alert.alert("Couldn't save bookmark", "AO3 may have signed you out. Try reloading and signing in again.");
        } else if (result.reason === "token") {
          Alert.alert("Couldn't save bookmark", "AO3 rejected the request (expired token). Reopen and try again.");
        } else {
          Alert.alert(
            "Couldn't save bookmark",
            result.status ? `AO3 didn't confirm the change (status ${result.status}).` : "Something went wrong.",
          );
        }
      })
      .catch((err) => {
        console.warn("[BookmarkEditModal] Save failed:", err);
        Alert.alert("Couldn't save bookmark", "Something went wrong. Please try again.");
      })
      .finally(() => setSubmitting(false));
  }, [form, notes, tagString, collectionNames, isPrivate, isRec, refererUrl, onSaved]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.cardWrap}
        >
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Save a bookmark</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.stateBox}>
                <ActivityIndicator size="large" color="#7ec14b" />
                <Text style={styles.stateText}>Loading...</Text>
              </View>
            ) : loadError ? (
              <View style={styles.stateBox}>
                <Text style={styles.errorText}>{loadError}</Text>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.body} contentContainerStyle={styles.bodyContent}>
                <View style={styles.field}>
                  <Text style={styles.label}>Notes</Text>
                  <Text style={styles.helper}>The creator's summary is added automatically.</Text>
                  <TextInput
                    style={styles.notesInput}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Write your notes..."
                    placeholderTextColor="#666"
                    multiline
                    textAlignVertical="top"
                  />
                </View>

                {/* Each autocomplete field's wrapper carries a fixed (never
                    toggled) z-index, higher than the field below it, so an
                    open suggestions dropdown always paints over the fields
                    that follow instead of underneath them — same static
                    approach used in AO3FilterPanel, since toggling this
                    dynamically in response to the dropdown opening/closing
                    was found to disrupt the keyboard on Android. */}
                <View style={[styles.field, styles.autocompleteLayer2]}>
                  <Text style={styles.label}>Your tags</Text>
                  <Text style={styles.helper}>The creator's tags are added automatically.</Text>
                  <TagAutocompleteInput
                    style={styles.textInput}
                    placeholder="Comma-separated tag names"
                    placeholderTextColor="#666"
                    value={tagString}
                    onChangeText={setTagString}
                  />
                </View>

                <View style={[styles.field, styles.autocompleteLayer1]}>
                  <Text style={styles.label}>Add to collections</Text>
                  <TagAutocompleteInput
                    style={styles.textInput}
                    placeholder="Comma-separated collection names"
                    placeholderTextColor="#666"
                    value={collectionNames}
                    onChangeText={setCollectionNames}
                    fetchSuggestions={fetchCollectionAutocomplete}
                  />
                </View>

                <View style={styles.checkRow}>
                  <TouchableOpacity style={styles.checkOption} onPress={() => setIsPrivate((prev) => !prev)}>
                    <Ionicons
                      name={isPrivate ? "checkbox" : "square-outline"}
                      size={20}
                      color={isPrivate ? "#7ec14b" : "#666"}
                    />
                    <Text style={styles.checkLabel}>Private bookmark</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.checkOption} onPress={() => setIsRec((prev) => !prev)}>
                    <Ionicons
                      name={isRec ? "checkbox" : "square-outline"}
                      size={20}
                      color={isRec ? "#7ec14b" : "#666"}
                    />
                    <Text style={styles.checkLabel}>Rec</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}

            {!loading && !loadError ? (
              <View style={styles.footer}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.updateBtn, submitting && styles.updateBtnDisabled]}
                  onPress={handleSave}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.updateText}>Update</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 20,
  },
  cardWrap: {
    maxHeight: "85%",
  },
  card: {
    backgroundColor: "#111",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  stateBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 10,
  },
  stateText: {
    color: "#999",
    fontSize: 14,
  },
  errorText: {
    color: "#f66",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  body: {
    maxHeight: 460,
  },
  bodyContent: {
    padding: 16,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  // Fixed, never-toggled stacking order for the autocomplete fields — see
  // the comment above their usage.
  autocompleteLayer2: { zIndex: 20, elevation: 2 },
  autocompleteLayer1: { zIndex: 10, elevation: 1 },
  label: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: "700",
  },
  helper: {
    color: "#8c8c8c",
    fontSize: 12,
  },
  notesInput: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 14,
    minHeight: 90,
  },
  textInput: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#fff",
    fontSize: 14,
  },
  checkRow: {
    flexDirection: "row",
    gap: 20,
  },
  checkOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkLabel: {
    color: "#ddd",
    fontSize: 14,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#222",
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  cancelText: {
    color: "#ccc",
    fontWeight: "600",
  },
  updateBtn: {
    flex: 1,
    backgroundColor: "#7ec14b",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  updateBtnDisabled: {
    opacity: 0.6,
  },
  updateText: {
    color: "#000",
    fontWeight: "700",
  },
});

export default BookmarkEditModal;
