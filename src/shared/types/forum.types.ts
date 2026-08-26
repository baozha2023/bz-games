export interface ForumPostSummary {
  id: string;
  title: string;
  authorNickname: string;
  authorGithubLogin: string;
  createdAt: string | null;
  likeCount: number;
  commentCount: number;
}

export interface ForumImage {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
  previewUrl?: string;
}

export interface ForumPostDetail extends ForumPostSummary {
  body: string;
  updatedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedByGithubName: string | null;
  status: 0 | 1 | 2;
  likedByMe: boolean;
  ownedByMe: boolean;
  images: ForumImage[];
}

export type ForumPostReference =
  | { id: string; status: "active"; title: string; body: string }
  | { id: string; status: "deleted" }
  | { id: string; status: "missing" };

export interface ForumPostReferenceResult {
  items: ForumPostReference[];
}

export interface ForumAuthor {
  id: string;
  nickname: string;
  githubLogin: string;
  avatarUrl: string;
}

export interface ForumComment {
  id: string;
  postId: string;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedByGithubName: string | null;
  status: 0 | 1 | 2;
  likeCount: number;
  likedByMe: boolean;
  ownedByMe: boolean;
  author: ForumAuthor;
}

export interface ForumPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ForumImageSelection {
  id: string;
  fileName: string;
  previewUrl: string;
}

export interface ForumImageSelectionResult {
  success: boolean;
  canceled?: boolean;
  selectionId?: string;
  images?: ForumImageSelection[];
  error?: string;
}

export type ForumMutationResult =
  | { success: true; id?: string; liked?: boolean; likeCount?: number }
  | {
      success: false;
      error: string;
      retryAfterSeconds?: number;
      resetAt?: string;
    };
