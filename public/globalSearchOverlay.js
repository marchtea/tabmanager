(() => {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return;
  }

  const overlayState = globalThis.__TAB_MANAGER_GLOBAL_SEARCH__;
  if (overlayState?.focusInput) {
    overlayState.focusInput();
    return;
  }

  const host = document.createElement("div");
  host.id = "tab-manager-global-search-host";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: "Camera Plain Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
    .backdrop {
      position: fixed;
      z-index: 2147483647;
      inset: 0;
      display: grid;
      place-items: start center;
      padding-top: 11vh;
      background: rgb(28 28 28 / 22%);
    }
    .panel {
      display: flex;
      width: min(760px, calc(100vw - 48px));
      max-height: 76vh;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #eceae4;
      border-radius: 16px;
      background: #fcfbf8;
      box-shadow: rgb(0 0 0 / 10%) 0 4px 12px;
    }
    input {
      width: 100%;
      height: 60px;
      padding: 0 18px;
      border: 0;
      border-bottom: 1px solid #eceae4;
      color: #1c1c1c;
      background: #fcfbf8;
      font: inherit;
      font-size: 18px;
      outline: none;
    }
    input::placeholder {
      color: #5f5f5d;
      font-size: 18px;
    }
    .results {
      min-height: 0;
      overflow-y: auto;
      padding: 10px;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }
    h2 {
      margin: 0;
      padding: 4px 8px;
      color: #5f5f5d;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
      text-transform: uppercase;
    }
    button {
      display: block;
      width: 100%;
      min-height: 54px;
      padding: 8px 10px;
      border: 1px solid transparent;
      border-radius: 12px;
      color: #1c1c1c;
      background: transparent;
      font: inherit;
      text-align: left;
    }
    button:hover, button.selected {
      border-color: rgb(28 28 28 / 40%);
      background: #f7f4ed;
    }
    strong, small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    strong {
      font-size: 14px;
      font-weight: 600;
      line-height: 1.3;
    }
    small {
      margin-top: 3px;
      color: #5f5f5d;
      font-size: 12px;
      line-height: 1.35;
    }
    .empty {
      margin: 0;
      padding: 18px 10px;
      border: 1px dashed rgb(28 28 28 / 40%);
      border-radius: 12px;
      color: #5f5f5d;
      font-size: 14px;
      text-align: center;
    }
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Tab Manager global search");

  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "搜索 spaces、stacks、tabs、history";
  input.setAttribute("aria-label", "搜索 spaces、stacks、tabs、history");

  const resultList = document.createElement("div");
  resultList.className = "results";
  panel.append(input, resultList);
  backdrop.append(panel);
  shadow.append(style, backdrop);

  let groups = emptyGroups();
  let flatResults = [];
  let selectedIndex = 0;
  let timer = 0;

  const close = () => {
    delete globalThis.__TAB_MANAGER_GLOBAL_SEARCH__;
    host.remove();
  };

  const focusInput = () => input.focus();
  globalThis.__TAB_MANAGER_GLOBAL_SEARCH__ = { close, focusInput };

  const search = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const response = await runtime.sendMessage({
        type: "tab-manager:global-search-query",
        query: input.value
      });
      groups = response?.groups || emptyGroups();
      flatResults = flatten(groups);
      selectedIndex = 0;
      render();
    }, 120);
  };

  const pickSelected = async () => {
    const result = flatResults[selectedIndex];
    if (!result) {
      return;
    }
    const response = await runtime.sendMessage({
      type: "tab-manager:global-search-pick",
      result
    });
    if (response?.ok) {
      close();
    }
  };

  const render = () => {
    resultList.replaceChildren();
    renderGroup("Spaces", groups.spaces);
    renderGroup("Stacks", groups.stacks);
    renderGroup("Saved Tabs", groups.savedTabs);
    renderGroup("Open Tabs", groups.openTabs);
    renderGroup("History", groups.history);
    if (flatResults.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = input.value.trim() ? "没有结果" : "输入关键词开始搜索";
      resultList.append(empty);
    }
  };

  const renderGroup = (label, results) => {
    if (!results.length) {
      return;
    }
    const group = document.createElement("section");
    group.className = "group";
    const heading = document.createElement("h2");
    heading.textContent = label;
    group.append(heading);

    for (const result of results) {
      const index = flatResults.findIndex((item) => item.id === result.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === selectedIndex ? "selected" : "";
      const title = document.createElement("strong");
      title.textContent = result.title;
      button.append(title);
      if (result.subtitle) {
        const subtitle = document.createElement("small");
        subtitle.textContent = result.subtitle;
        button.append(subtitle);
      }
      button.addEventListener("mouseenter", () => {
        selectedIndex = index;
        render();
      });
      button.addEventListener("click", () => {
        selectedIndex = index;
        void pickSelected();
      });
      group.append(button);
    }

    resultList.append(group);
  };

  input.addEventListener("input", search);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, Math.max(flatResults.length - 1, 0));
      render();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      render();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void pickSelected();
    }
  });
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) {
      close();
    }
  });

  render();
  input.focus();
})();

function emptyGroups() {
  return {
    spaces: [],
    stacks: [],
    savedTabs: [],
    openTabs: [],
    history: []
  };
}

function flatten(groups) {
  return [
    ...groups.spaces,
    ...groups.stacks,
    ...groups.savedTabs,
    ...groups.openTabs,
    ...groups.history
  ];
}
