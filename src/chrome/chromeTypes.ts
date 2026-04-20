export type ChromeTabRecord = {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  active?: boolean;
};

export type ChromeHistoryRecord = {
  id?: string;
  title?: string;
  url?: string;
  lastVisitTime?: number;
};

export type ChromeWindowRecord = {
  id?: number;
  tabs?: ChromeTabRecord[];
};

export type ChromeCommandRecord = {
  name?: string;
  shortcut?: string;
};

export type ChromeTabRemoveInfo = {
  windowId?: number;
  isWindowClosing?: boolean;
};

export type ChromeTabChangeInfo = {
  title?: string;
  url?: string;
  favIconUrl?: string;
  status?: string;
};

export type ChromeMessageSender = {
  tab?: ChromeTabRecord;
};

export type ChromeLike = {
  runtime?: {
    id?: string;
    getURL?: (path: string) => string;
    onMessage?: {
      addListener?: (
        listener: (
          message: unknown,
          sender: ChromeMessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ) => void;
    };
    sendMessage?: (message: unknown) => Promise<unknown>;
  };
  tabs?: {
    query?: (queryInfo: Record<string, unknown>) => Promise<ChromeTabRecord[]>;
    update?: (tabId: number, updateProperties: Record<string, unknown>) => Promise<unknown>;
    move?: (
      tabId: number,
      moveProperties: { windowId?: number; index?: number }
    ) => Promise<ChromeTabRecord | undefined>;
    create?: (createProperties: { url: string }) => Promise<unknown>;
    remove?: (tabIds: number | number[]) => Promise<void>;
    onCreated?: {
      addListener?: (listener: (tab: ChromeTabRecord) => void) => void;
      removeListener?: (listener: (tab: ChromeTabRecord) => void) => void;
    };
    onUpdated?: {
      addListener?: (listener: (tabId: number, changeInfo: ChromeTabChangeInfo, tab: ChromeTabRecord) => void) => void;
      removeListener?: (listener: (tabId: number, changeInfo: ChromeTabChangeInfo, tab: ChromeTabRecord) => void) => void;
    };
    onRemoved?: {
      addListener?: (listener: (tabId: number, removeInfo: ChromeTabRemoveInfo) => void) => void;
      removeListener?: (listener: (tabId: number, removeInfo: ChromeTabRemoveInfo) => void) => void;
    };
  };
  windows?: {
    getAll?: (getInfo: { populate: boolean }) => Promise<ChromeWindowRecord[]>;
    update?: (windowId: number, updateInfo: Record<string, unknown>) => Promise<unknown>;
    remove?: (windowId: number) => Promise<void>;
  };
  history?: {
    search?: (query: {
      text: string;
      startTime: number;
      maxResults: number;
    }) => Promise<ChromeHistoryRecord[]>;
  };
  scripting?: {
    executeScript?: <T = string | undefined>(injection: {
      target: { tabId: number };
      func?: () => T;
      files?: string[];
    }) => Promise<Array<{ result?: T }>>;
  };
  commands?: {
    getAll?: () => Promise<ChromeCommandRecord[]>;
    onCommand?: {
      addListener?: (listener: (command: string) => void) => void;
    };
  };
  storage?: {
    local?: {
      get?: (keys: string[]) => Promise<Record<string, unknown>>;
      set?: (items: Record<string, unknown>) => Promise<void>;
    };
  };
};
