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

export type ChromeLike = {
  runtime?: {
    id?: string;
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
  };
  windows?: {
    getAll?: (getInfo: { populate: boolean }) => Promise<ChromeWindowRecord[]>;
    update?: (windowId: number, updateInfo: Record<string, unknown>) => Promise<unknown>;
  };
  history?: {
    search?: (query: {
      text: string;
      startTime: number;
      maxResults: number;
    }) => Promise<ChromeHistoryRecord[]>;
  };
  scripting?: {
    executeScript?: (injection: {
      target: { tabId: number };
      func: () => string | undefined;
    }) => Promise<Array<{ result?: string }>>;
  };
  storage?: {
    local?: {
      get?: (keys: string[]) => Promise<Record<string, unknown>>;
      set?: (items: Record<string, unknown>) => Promise<void>;
    };
  };
};
