import {
  buildGlobalSearchGroups,
  buildTabManagerUrl,
  focusOrOpenTabManager,
  getChrome,
  handleGlobalSearchResult,
  isTabManagerUrl
} from "./chrome/chromeApi";
import { isGlobalSearchMessage } from "./chrome/globalSearchMessages";
import type { GlobalSearchMessage } from "./chrome/globalSearchMessages";
import type { ChromeLike } from "./chrome/chromeTypes";

const GLOBAL_SEARCH_COMMAND = "open_global_search";
const GLOBAL_SEARCH_OVERLAY_FILE = "globalSearchOverlay.js";

const chromeApi = getChrome();

if (chromeApi) {
  chromeApi.commands?.onCommand?.addListener?.((command) => {
    if (command === GLOBAL_SEARCH_COMMAND) {
      void openGlobalSearch(chromeApi);
    }
  });

  chromeApi.runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
    if (!isGlobalSearchMessage(message)) {
      return false;
    }

    void handleGlobalSearchMessage(chromeApi, message)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown error" })
      );
    return true;
  });
}

const openGlobalSearch = async (api: ChromeLike): Promise<void> => {
  const [activeTab] = await api.tabs?.query?.({ active: true, currentWindow: true }) ?? [];
  if (!activeTab?.id) {
    await focusOrOpenTabManager(api, { search: "1" });
    return;
  }

  if (isTabManagerUrl(activeTab.url, api.runtime?.id)) {
    await api.tabs?.update?.(activeTab.id, { active: true, url: buildTabManagerUrl(api, { search: "1" }) });
    return;
  }

  try {
    await api.scripting?.executeScript?.({
      target: { tabId: activeTab.id },
      files: [GLOBAL_SEARCH_OVERLAY_FILE]
    });
  } catch {
    await focusOrOpenTabManager(api, { search: "1" });
  }
};

const handleGlobalSearchMessage = async (api: ChromeLike, message: GlobalSearchMessage) => {
  if (message.type === "tab-manager:global-search-query") {
    return {
      groups: await buildGlobalSearchGroups(api, message.query, Date.now())
    };
  }

  if (message.type === "tab-manager:global-search-pick") {
    await handleGlobalSearchResult(api, message.result);
    return { ok: true };
  }

  await focusOrOpenTabManager(api, { search: "1" });
  return { ok: true };
};
