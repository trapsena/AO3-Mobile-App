import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, PanResponder, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { ThemeMode, useTheme } from "../contexts/ThemeContext";
import { HsvColor, hexToRgb, hsvToRgb, hueToHex, isValidHex, rgbToHex, rgbToHsv } from "./colorUtils";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SQUARE_SIZE = 260;
const HUE_BAR_HEIGHT = 28;
const CURSOR_SIZE = 22;

// Six-stop rainbow gradient (red -> yellow -> green -> cyan -> blue ->
// magenta -> back to red) — react-native-svg's LinearGradient only
// interpolates linearly between adjacent stops, so hue needs this many
// anchor points to read as a smooth hue wheel rather than muddy in between.
const HUE_GRADIENT_STOPS = [0, 60, 120, 180, 240, 300, 360].map((h) => ({
  offset: h / 360,
  color: hueToHex(h),
}));

function getReadableTextColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
}

const ThemeSettingsModal: React.FC<Props> = ({ visible, onClose }) => {
  const { mode, accentColor, colors, setMode, setAccentColor } = useTheme();

  // Staged selections, committed to the real theme only when "Select" is
  // tapped (matching the referenced picker's own stage-then-commit pattern)
  // — reset from the live theme every time the modal opens.
  const [draftMode, setDraftMode] = useState<ThemeMode>(mode);
  const [hsv, setHsv] = useState<HsvColor>(() => rgbToHsv(hexToRgb(accentColor)));
  const [hexInput, setHexInput] = useState(accentColor);

  useEffect(() => {
    if (!visible) return;
    setDraftMode(mode);
    setHsv(rgbToHsv(hexToRgb(accentColor)));
    setHexInput(accentColor);
  }, [visible, mode, accentColor]);

  const draftHex = useMemo(() => rgbToHex(hsvToRgb(hsv)), [hsv]);
  const pureHueHex = useMemo(() => hueToHex(hsv.h), [hsv.h]);
  const draftAccentText = useMemo(() => getReadableTextColor(draftHex), [draftHex]);

  // Keeps the hex field in sync when the square/hue bar are dragged, without
  // fighting the user's own typing: this only overwrites hexInput when hsv
  // (and therefore draftHex) actually changed, which a still-incomplete
  // typed value never does — see handleHexInputChange below.
  useEffect(() => {
    setHexInput(draftHex);
  }, [draftHex]);

  const handleHexInputChange = useCallback((text: string) => {
    const normalized = text.startsWith("#") ? text : `#${text}`;
    setHexInput(normalized);
    if (isValidHex(normalized)) {
      setHsv(rgbToHsv(hexToRgb(normalized)));
    }
  }, []);

  // Dragging within the SV square / hue bar: PanResponder's own
  // locationX/Y drifts once a drag moves outside the view it started on, so
  // this instead measures the view's on-screen origin once per gesture (in
  // onPanResponderGrant) and works from the gesture's absolute pageX/pageY
  // for the rest of it.
  const squareRef = useRef<View>(null);
  const squareOriginRef = useRef({ x: 0, y: 0 });

  const applySquareTouch = useCallback((pageX: number, pageY: number) => {
    const { x: originX, y: originY } = squareOriginRef.current;
    const relX = Math.max(0, Math.min(SQUARE_SIZE, pageX - originX));
    const relY = Math.max(0, Math.min(SQUARE_SIZE, pageY - originY));
    setHsv((prev) => ({ ...prev, s: relX / SQUARE_SIZE, v: 1 - relY / SQUARE_SIZE }));
  }, []);

  const squarePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        squareRef.current?.measure((_x, _y, _w, _h, pageX, pageY) => {
          squareOriginRef.current = { x: pageX, y: pageY };
          applySquareTouch(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        });
      },
      onPanResponderMove: (evt) => applySquareTouch(evt.nativeEvent.pageX, evt.nativeEvent.pageY),
    }),
  ).current;

  const hueBarRef = useRef<View>(null);
  const hueBarOriginXRef = useRef(0);

  const applyHueTouch = useCallback((pageX: number) => {
    const relX = Math.max(0, Math.min(SQUARE_SIZE, pageX - hueBarOriginXRef.current));
    const h = (relX / SQUARE_SIZE) * 360;
    setHsv((prev) => ({ ...prev, h: Math.min(h, 359.999) }));
  }, []);

  const huePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        hueBarRef.current?.measure((_x, _y, _w, _h, pageX) => {
          hueBarOriginXRef.current = pageX;
          applyHueTouch(evt.nativeEvent.pageX);
        });
      },
      onPanResponderMove: (evt) => applyHueTouch(evt.nativeEvent.pageX),
    }),
  ).current;

  const handleSelect = () => {
    setAccentColor(draftHex);
    setMode(draftMode);
    onClose();
  };

  const cursorLeft = hsv.s * SQUARE_SIZE - CURSOR_SIZE / 2;
  const cursorTop = (1 - hsv.v) * SQUARE_SIZE - CURSOR_SIZE / 2;
  const hueCursorLeft = (hsv.h / 360) * SQUARE_SIZE - CURSOR_SIZE / 2;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Color Theme</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textFaint }]}>Appearance</Text>
          <View style={styles.modeRow}>
            {(["dark", "light"] as ThemeMode[]).map((option) => {
              const active = draftMode === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.modeBtn,
                    { borderColor: colors.border },
                    active && { backgroundColor: draftHex, borderColor: draftHex },
                  ]}
                  onPress={() => setDraftMode(option)}
                >
                  <Ionicons
                    name={option === "dark" ? "moon" : "sunny"}
                    size={15}
                    color={active ? draftAccentText : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: active ? draftAccentText : colors.textMuted },
                    ]}
                  >
                    {option === "dark" ? "Dark" : "Light"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textFaint }]}>Accent Color</Text>
          <View style={[styles.hexRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <View style={[styles.hexSwatch, { backgroundColor: draftHex }]} />
            <TextInput
              style={[styles.hexInput, { color: colors.text }]}
              value={hexInput}
              onChangeText={handleHexInputChange}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="#7ec14b"
              placeholderTextColor={colors.textFaint}
              maxLength={7}
            />
          </View>

          <View
            ref={squareRef}
            style={styles.square}
            {...squarePanResponder.panHandlers}
          >
            <Svg width={SQUARE_SIZE} height={SQUARE_SIZE}>
              <Defs>
                <LinearGradient id="sat" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
                  <Stop offset="1" stopColor={pureHueHex} stopOpacity={1} />
                </LinearGradient>
                <LinearGradient id="val" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#000000" stopOpacity={0} />
                  <Stop offset="1" stopColor="#000000" stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={SQUARE_SIZE} height={SQUARE_SIZE} fill="url(#sat)" />
              <Rect x={0} y={0} width={SQUARE_SIZE} height={SQUARE_SIZE} fill="url(#val)" />
            </Svg>
            <View
              pointerEvents="none"
              style={[
                styles.cursor,
                { left: cursorLeft, top: cursorTop, backgroundColor: draftHex },
              ]}
            />
          </View>

          <View ref={hueBarRef} style={styles.hueBar} {...huePanResponder.panHandlers}>
            <Svg width={SQUARE_SIZE} height={HUE_BAR_HEIGHT}>
              <Defs>
                <LinearGradient id="hue" x1="0" y1="0" x2="1" y2="0">
                  {HUE_GRADIENT_STOPS.map((stop) => (
                    <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={1} />
                  ))}
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={SQUARE_SIZE} height={HUE_BAR_HEIGHT} rx={HUE_BAR_HEIGHT / 2} fill="url(#hue)" />
            </Svg>
            <View
              pointerEvents="none"
              style={[
                styles.hueCursor,
                { left: hueCursorLeft, backgroundColor: pureHueHex },
              ]}
            />
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={onClose}
            >
              <Text style={[styles.cancelBtnText, { color: colors.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selectBtn, { backgroundColor: draftHex }]}
              onPress={handleSelect}
            >
              <Text style={[styles.selectBtnText, { color: draftAccentText }]}>Select</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  hexRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  hexSwatch: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  hexInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    padding: 0,
  },
  square: {
    width: SQUARE_SIZE,
    height: SQUARE_SIZE,
    alignSelf: "center",
    borderRadius: 12,
    overflow: "hidden",
  },
  cursor: {
    position: "absolute",
    width: CURSOR_SIZE,
    height: CURSOR_SIZE,
    borderRadius: CURSOR_SIZE / 2,
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  hueBar: {
    width: SQUARE_SIZE,
    height: HUE_BAR_HEIGHT,
    alignSelf: "center",
    marginTop: 16,
  },
  hueCursor: {
    position: "absolute",
    top: (HUE_BAR_HEIGHT - CURSOR_SIZE) / 2,
    width: CURSOR_SIZE,
    height: CURSOR_SIZE,
    borderRadius: CURSOR_SIZE / 2,
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  cancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  selectBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },
  selectBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
});

export default ThemeSettingsModal;
