import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Dimensions,
  Animated,
} from "react-native";
import { X, MessageCircle } from "lucide-react-native";
import { fetchWithSession } from "../api/ao3Auth";

interface Reply {
  id: string;
  username: string;
  userLink: string;
  avatarUrl: string;
  date: string;
  text: string;
  replies?: Reply[]; // Support nested replies
}

interface Comment {
  id: string;
  username: string;
  userLink: string;
  avatarUrl: string;
  chapterTitle: string;
  date: string;
  text: string;
  replies: Reply[];
}

interface CommentsDrawerProps {
  visible: boolean;
  currentUrl: string;
  onClose: () => void;
}

const SCREEN_HEIGHT = Dimensions.get("window").height;

const CommentsDrawer: React.FC<CommentsDrawerProps> = ({ visible, currentUrl, onClose }) => {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalComments, setTotalComments] = useState(0);
  const commentsPerPage = 30;

  // Load comments when drawer opens
  useEffect(() => {
    if (visible) {
      loadComments();
    }
  }, [visible, currentUrl]);

  // Animate drawer
  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  // Helper function to extract data from comment/reply HTML
  const extractCommentData = (html: string, commentId: string) => {
    // Extract avatar from div.icon > img
    const avatarMatch = html.match(/<div[^>]*class="icon"[^>]*>[\s\S]*?<img[^>]*src="([^"]*active_storage[^"]*)"[^>]*>/i);
    const avatarUrl = avatarMatch ? avatarMatch[1] : "";

    // Extract username from heading
    const userMatch = html.match(/<a[^>]*href="\/users\/([^"]+)\/pseuds\/[^"]*"[^>]*>([^<]+)<\/a>/i);
    const username = userMatch ? userMatch[2].trim() : "Anonymous";
    const userLink = userMatch ? `/users/${userMatch[1]}` : "";

    // Prefer published timestamp from <span class="posted datetime"> if present
    let date = "Unknown Date";
    const postedSpanMatch = html.match(/<span[^>]*class="posted datetime"[^>]*>([\s\S]*?)<\/span>/i);
    if (postedSpanMatch) {
      // Strip inner tags and collapse whitespace to form a readable timestamp
      const postedHtml = postedSpanMatch[1];
      const postedText = postedHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (postedText) {
        date = postedText;
      }
    }

    // Fallback: abbr.published
    if (date === "Unknown Date") {
      const dateMatch = html.match(/<abbr[^>]*class="published"[^>]*title="[^\"]*"[^>]*>([^<]+)<\/abbr>/i);
      if (dateMatch) date = dateMatch[1].trim();
    }

    // Extract comment text from blockquote
    const textMatch = html.match(/<blockquote[^>]*class="userstuff"[^>]*>([\s\S]*?)<\/blockquote>/i);
    let text = "";
    if (textMatch) {
      text = textMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    return { avatarUrl, username, userLink, date, text };
  };

  // Step 1: Find all comments and identify if they're root or replies
  const scanAllComments = (html: string) => {
    const allComments = new Map<
      string,
      {
        id: string;
        liElement: string;
        isReply: boolean;
        parentId: string | null;
      }
    >();

    // Find all <li class="comment"> elements (both root and replies)
    const allLiRegex = /<li[^>]*class="[^"]*comment[^"]*"[^>]*id="comment_(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;

    let match;
    while ((match = allLiRegex.exec(html)) !== null) {
      const commentId = match[1];
      const fullLiElement = match[0];
      const liContent = match[2];

      // Check if this <li> is inside an <ol class="thread"> that is a child of another <li class="comment">
      // We do this by checking if there's a pattern: </li><ol class="thread"> containing this element
      
      // Find the position of this match in the HTML
      const elementPosition = match.index;

      // Look backwards to find if this <li> is inside a nested <ol class="thread">
      // Strategy: Count how many <li class="comment"> tags appear before this one at the same "level"
      // If we find a closing </li> followed by </ol> at root level before seeing opening tags, it's nested

      const beforeElement = html.substring(0, elementPosition);
      
      // Count open <ol class="thread"> at root level before this element
      const threadOpenRegex = /<ol[^>]*class="[^"]*thread[^"]*"[^>]*>/gi;
      const liCommentRegex = /<li[^>]*class="[^"]*comment[^"]*"[^>]*>/gi;
      
      let threadCount = 0;
      let liCount = 0;
      let lastThreadPos = -1;
      let lastLiPos = -1;

      // Scan to find nesting level
      let threadMatch;
      threadOpenRegex.lastIndex = 0;
      while ((threadMatch = threadOpenRegex.exec(beforeElement)) !== null) {
        lastThreadPos = threadMatch.index;
        threadCount++;
      }

      let liMatch;
      liCommentRegex.lastIndex = 0;
      while ((liMatch = liCommentRegex.exec(beforeElement)) !== null) {
        lastLiPos = liMatch.index;
        liCount++;
      }

      // If the last <ol class="thread"> comes after the last <li class="comment">, 
      // then this comment is a reply (nested)
      const isReply = lastThreadPos > lastLiPos && threadCount > 0;

      // Find parent ID: look for the last <li id="comment_X"> before the current element that is not a reply
      let parentId: string | null = null;
      if (isReply) {
        const beforeThis = html.substring(0, elementPosition);
        const parentIdRegex = /<li[^>]*id="comment_(\d+)"[^>]*>/gi;
        let parentMatch;
        let lastParentId: string | null = null;

        parentIdRegex.lastIndex = 0;
        while ((parentMatch = parentIdRegex.exec(beforeThis)) !== null) {
          lastParentId = parentMatch[1];
        }
        parentId = lastParentId;
      }

      allComments.set(commentId, {
        id: commentId,
        liElement: fullLiElement,
        isReply,
        parentId,
      });
    }

    return allComments;
  };

  // Step 2: Extract data from a comment block
  const parseCommentElement = (liElement: string, commentId: string) => {
    try {
      const { avatarUrl, username, userLink, date, text } = extractCommentData(liElement, commentId);

      if (!text) return null;

      // Extract chapter title
      const chapterMatch = liElement.match(/<a[^>]*href="\/works\/\d+\/chapters\/\d+"[^>]*>([^<]+)<\/a>/i);
      const chapterTitle = chapterMatch ? chapterMatch[1].trim() : "Unknown Chapter";

      return { avatarUrl, username, userLink, date, text, chapterTitle };
    } catch (err) {
      console.warn("[CommentsDrawer] Error parsing comment element:", err);
      return null;
    }
  };

  // Step 3: Build the comment tree
  const parseComments = (html: string): Comment[] => {
    const allComments = scanAllComments(html);
    const comments: Comment[] = [];
    const commentMap = new Map<string, Comment>();
    const replyMap = new Map<string, Reply>();

    // First pass: Create all comment objects
    for (const [commentId, commentInfo] of allComments.entries()) {
      if (!commentInfo.isReply) {
        const data = parseCommentElement(commentInfo.liElement, commentId);
        if (data) {
          const comment: Comment = {
            id: commentId,
            username: data.username,
            userLink: data.userLink,
            avatarUrl: data.avatarUrl,
            chapterTitle: data.chapterTitle,
            date: data.date,
            text: data.text,
            replies: [],
          };
          comments.push(comment);
          commentMap.set(commentId, comment);
        }
      }
    }

    // Second pass: Create and attach replies
    for (const [replyId, replyInfo] of allComments.entries()) {
      if (replyInfo.isReply && replyInfo.parentId) {
        const data = parseCommentElement(replyInfo.liElement, replyId);
        if (data) {
          const reply: Reply = {
            id: replyId,
            username: data.username,
            userLink: data.userLink,
            avatarUrl: data.avatarUrl,
            date: data.date,
            text: data.text,
            replies: [],
          };

          // Check if parent is a root comment or another reply
          const parentComment = commentMap.get(replyInfo.parentId);
          if (parentComment) {
            // Direct reply to a root comment
            parentComment.replies.push(reply);
          } else {
            // Reply to another reply (nested)
            const parentReply = replyMap.get(replyInfo.parentId);
            if (parentReply) {
              if (!parentReply.replies) {
                parentReply.replies = [];
              }
              parentReply.replies.push(reply);
            }
          }

          replyMap.set(replyId, reply);
        }
      }
    }

    console.log(
      "[CommentsDrawer] Parsed comments:",
      comments.length,
      "with",
      Array.from(allComments.values()).filter((c) => c.isReply).length,
      "total replies"
    );

    // Log details about detected hierarchy
    for (const [commentId, commentInfo] of allComments.entries()) {
      if (commentInfo.isReply) {
        console.log(
          `[CommentsDrawer] Reply #${commentId} → Parent: #${commentInfo.parentId}`
        );
      } else {
        console.log(`[CommentsDrawer] Root Comment #${commentId}`);
      }
    }

    return comments;
  };

  const loadComments = async () => {
    setLoading(true);
    setComments([]);
    setCurrentPage(0);

    try {
      // Add query params to show comments
      const commentsUrl = currentUrl.includes("?")
        ? `${currentUrl}&show_comments=true#comments`
        : `${currentUrl}?show_comments=true#comments`;

      console.log("[CommentsDrawer] Fetching comments from:", commentsUrl);

      const res = await fetchWithSession(commentsUrl);
      if (!res.ok) {
        console.warn("[CommentsDrawer] Failed to fetch comments:", res.status);
        setLoading(false);
        return;
      }

      const html = await res.text();
      const parsedComments = parseComments(html);

      console.log("[CommentsDrawer] Parsed comments:", parsedComments.length);

      setComments(parsedComments);
      setTotalComments(parsedComments.length);
    } catch (err) {
      console.warn("[CommentsDrawer] Error fetching comments:", err);
    } finally {
      setLoading(false);
    }
  };

  const startIndex = currentPage * commentsPerPage;
  const endIndex = startIndex + commentsPerPage;
  const paginatedComments = comments.slice(startIndex, endIndex);
  const totalPages = Math.ceil(comments.length / commentsPerPage);

  // Recursive render function for nested replies
  const renderReply = (reply: Reply, depth: number) => {
    const marginLeft = depth * 20 + 30;
    
    return (
      <View key={reply.id}>
        <View style={[
          styles.replyItem,
          { marginLeft }
        ]}>
          {/* Published date - Top Right for reply */}
          <View style={styles.topRightDate}>
            <Text style={styles.topRightDateText}>{reply.date}</Text>
          </View>

          {/* Reply User Info */}
          <View style={styles.replyUserSection}>
            {reply.avatarUrl ? (
              <Image
                source={{ uri: reply.avatarUrl }}
                style={styles.replyAvatar}
              />
            ) : (
              <View style={styles.replyAvatarPlaceholder}>
                <Text style={styles.avatarPlaceholderText}>?</Text>
              </View>
            )}
            <Text style={styles.replyUsername}>{reply.username}</Text>
          </View>

          {/* Reply Text */}
          <Text style={styles.replyText}>{reply.text}</Text>

          {/* Reply to Reply Button */}
          <TouchableOpacity style={styles.replyToReplyButton}>
            <Text style={styles.replyButtonText}>Responder</Text>
          </TouchableOpacity>
        </View>

        {/* Nested Replies */}
        {reply.replies && reply.replies.length > 0 && (
          <View style={styles.nestedRepliesContainer}>
            {reply.replies.map((nestedReply) =>
              renderReply(nestedReply, depth + 1)
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      {/* Overlay */}
      {visible && (
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={onClose}
        />
      )}

      {/* Drawer */}
      <Animated.View
        style={[
          styles.drawer,
          {
            transform: [{ translateY }],
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MessageCircle color="#4dd0e1" size={20} />
            <Text style={styles.title}>Comentários ({totalComments})</Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <X color="#fff" size={22} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4dd0e1" />
            <Text style={styles.loadingText}>Carregando comentários...</Text>
          </View>
        ) : comments.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Nenhum comentário encontrado</Text>
          </View>
        ) : (
          <>
            <ScrollView style={styles.commentsList} showsVerticalScrollIndicator={false}>
              {paginatedComments.map((comment) => (
                <View key={comment.id} style={styles.commentContainer}>
                  {/* Main Comment */}
                  <View style={styles.commentItem}>
                    {/* Published date - Top Right */}
                    <View style={styles.topRightDate}>
                      <Text style={styles.topRightDateText}>{comment.date}</Text>
                    </View>

                    {/* User Info with Avatar */}
                    <View style={styles.userSection}>
                      {comment.avatarUrl ? (
                        <Image
                          source={{ uri: comment.avatarUrl }}
                          style={styles.avatar}
                        />
                      ) : (
                        <View style={styles.avatarPlaceholder}>
                          <Text style={styles.avatarPlaceholderText}>?</Text>
                        </View>
                      )}
                      <View style={styles.userInfo}>
                        <Text style={styles.username}>{comment.username}</Text>
                        <Text style={styles.chapterTitle}>{comment.chapterTitle}</Text>
                      </View>
                    </View>

                    {/* Comment Text */}
                    <Text style={styles.commentText}>{comment.text}</Text>

                    {/* Reply Button */}
                    <TouchableOpacity style={styles.replyButton}>
                      <Text style={styles.replyButtonText}>Responder</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Replies */}
                  {comment.replies.length > 0 && (
                    <View style={styles.repliesContainer}>
                      {comment.replies.map((reply) =>
                        renderReply(reply, 0)
                      )}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>

            {/* Pagination */}
            {totalPages > 1 && (
              <View style={styles.pagination}>
                <TouchableOpacity
                  style={[styles.pageButton, currentPage === 0 && styles.pageButtonDisabled]}
                  onPress={() => setCurrentPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                >
                  <Text style={styles.pageButtonText}>← Anterior</Text>
                </TouchableOpacity>
                <Text style={styles.pageIndicator}>
                  {currentPage + 1} / {totalPages}
                </Text>
                <TouchableOpacity
                  style={[styles.pageButton, currentPage === totalPages - 1 && styles.pageButtonDisabled]}
                  onPress={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                  disabled={currentPage === totalPages - 1}
                >
                  <Text style={styles.pageButtonText}>Próxima →</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 1,
  },
  drawer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.85,
    zIndex: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  loadingText: {
    color: "#999",
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
  },
  commentsList: {
    flex: 1,
    paddingHorizontal: 8,
  },
  // Main Comment Container
  commentContainer: {
    marginVertical: 8,
  },
  commentItem: {
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#4dd0e1",
    position: "relative",
  },
  dateBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "#4dd0e1",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 3,
  },
  dateBadgeText: {
    color: "#000",
    fontSize: 10,
    fontWeight: "bold",
  },
  topRightDate: {
    position: "absolute",
    top: 8,
    right: 8,
  },
  topRightDateText: {
    color: "#999",
    fontSize: 11,
  },
  userSection: {
    flexDirection: "row",
    marginBottom: 10,
    marginTop: 20,
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 0,
    backgroundColor: "#333",
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 0,
    backgroundColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholderText: {
    color: "#999",
    fontWeight: "bold",
  },
  userInfo: {
    flex: 1,
    justifyContent: "center",
  },
  username: {
    color: "#4dd0e1",
    fontWeight: "bold",
    fontSize: 13,
  },
  chapterTitle: {
    color: "#aaa",
    fontSize: 12,
    marginTop: 2,
  },
  commentText: {
    color: "#ccc",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  replyButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#222",
    borderRadius: 4,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#333",
  },
  replyButtonText: {
    color: "#4dd0e1",
    fontSize: 12,
    fontWeight: "500",
  },
  // Replies Container
  repliesContainer: {
    marginTop: 4,
    marginLeft: 30,
    borderLeftWidth: 2,
    borderLeftColor: "#333",
    paddingLeft: 12,
  },
  nestedRepliesContainer: {
    marginTop: 2,
    marginLeft: 0,
    borderLeftWidth: 1,
    borderLeftColor: "#222",
  },
  replyItem: {
    backgroundColor: "#0f0f0f",
    borderRadius: 6,
    padding: 10,
    marginVertical: 6,
    position: "relative",
  },
  replyDateBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "#555",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 3,
  },
  replyDateBadgeText: {
    color: "#ccc",
    fontSize: 9,
    fontWeight: "500",
  },
  replyUserSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 20,
    gap: 8,
  },
  replyAvatar: {
    width: 28,
    height: 28,
    borderRadius: 0,
    backgroundColor: "#333",
  },
  replyAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 0,
    backgroundColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  replyUsername: {
    color: "#7dd0e1",
    fontWeight: "600",
    fontSize: 12,
    flex: 1,
  },
  replyText: {
    color: "#bbb",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  replyToReplyButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#1a1a1a",
    borderRadius: 3,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#333",
  },
  // Pagination
  pagination: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  pageButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#222",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#333",
  },
  pageButtonDisabled: {
    opacity: 0.5,
  },
  pageButtonText: {
    color: "#4dd0e1",
    fontSize: 12,
    fontWeight: "500",
  },
  pageIndicator: {
    color: "#999",
    fontSize: 12,
  },
});

export default CommentsDrawer;
