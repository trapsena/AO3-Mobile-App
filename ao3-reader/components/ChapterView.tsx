import React from "react";
import { ScrollView, Dimensions, StyleSheet } from "react-native";
import RenderHTML from "react-native-render-html";

interface Props {
  htmlContent: string;
}

const ChapterView: React.FC<Props> = ({ htmlContent }) => {
  const width = Dimensions.get("window").width;

  return (
    <ScrollView style={styles.container}>
      <RenderHTML
        contentWidth={width - 30}
        source={{ html: htmlContent }}
        baseStyle={styles.text}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 15 },
  text: { color: "white", fontSize: 16, lineHeight: 24 },
});

export default ChapterView;
