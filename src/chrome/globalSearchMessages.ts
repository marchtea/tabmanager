import type { SearchGroups, SearchResult } from "../domain/types";

export type GlobalSearchQueryMessage = {
  type: "tab-manager:global-search-query";
  query: string;
};

export type GlobalSearchPickMessage = {
  type: "tab-manager:global-search-pick";
  result: SearchResult;
};

export type GlobalSearchOpenManagerMessage = {
  type: "tab-manager:global-search-open-manager";
};

export type OpenSearchModalMessage = {
  type: "tab-manager:open-search-modal";
};

export type GlobalSearchMessage =
  | GlobalSearchQueryMessage
  | GlobalSearchPickMessage
  | GlobalSearchOpenManagerMessage;

export type GlobalSearchQueryResponse = {
  groups: SearchGroups;
};

export type GlobalSearchActionResponse = {
  ok: boolean;
  error?: string;
};

export const isGlobalSearchMessage = (message: unknown): message is GlobalSearchMessage =>
  Boolean(
    message &&
      typeof message === "object" &&
      "type" in message &&
      typeof (message as { type?: unknown }).type === "string" &&
      (message as { type: string }).type.startsWith("tab-manager:global-search-")
  );
