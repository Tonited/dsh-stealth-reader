window.__ModuleLoader__.load({
  id: "dsh-stealth-reader",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // bundle 内的 require shim 从这里取值（见 bindRequireSlot）
    globalThis.__DSH_STEALTH_REQUIRE__ = require;
    "use strict";
    (() => {
      var __create = Object.create;
      var __defProp = Object.defineProperty;
      var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
      var __getOwnPropNames = Object.getOwnPropertyNames;
      var __getProtoOf = Object.getPrototypeOf;
      var __hasOwnProp = Object.prototype.hasOwnProperty;
      var __require = (x) => globalThis.__DSH_STEALTH_REQUIRE__(x);
      var __copyProps = (to, from, except, desc) => {
        if (from && typeof from === "object" || typeof from === "function") {
          for (let key of __getOwnPropNames(from))
            if (!__hasOwnProp.call(to, key) && key !== except)
              __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
        }
        return to;
      };
      var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
        // If the importer is in node compatibility mode or this is not an ESM
        // file that has been converted to a CommonJS file using a Babel-
        // compatible transform (i.e. "__esModule" has not been set), then set
        // "default" to the CommonJS "module.exports" for node compatibility.
        isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
        mod
      ));

      // src/client/index.tsx
      var React3 = __toESM(__require("react"), 1);

      // src/client/bindings.ts
      var KEY_SLOT = "__STEALTH_READER_KEY_HANDLER__";
      var POINTER_SLOT = "__STEALTH_READER_POINTER_HANDLER__";
      var BOUND_SLOT = "__STEALTH_READER_LISTENERS_BOUND__";
      function globalSlots() {
        return globalThis;
      }
      function forwardKey(slots, event) {
        slots[KEY_SLOT]?.(event);
      }
      function forwardPointer(slots, event) {
        slots[POINTER_SLOT]?.(event);
      }
      function bindHandlers(target, slots, handlers) {
        slots[KEY_SLOT] = handlers.keydown ?? void 0;
        slots[POINTER_SLOT] = handlers.pointer ?? void 0;
        if (slots[BOUND_SLOT]) return false;
        slots[BOUND_SLOT] = true;
        target.addEventListener("keydown", (event) => forwardKey(slots, event), true);
        const pointer = (event) => forwardPointer(slots, event);
        target.addEventListener("mousemove", pointer, true);
        target.addEventListener("pointerdown", pointer, true);
        target.addEventListener("wheel", pointer, true);
        target.addEventListener("touchstart", pointer, true);
        return true;
      }

      // src/client/readers.ts
      var SNAPSHOT_READER = "getSnapshot";
      function readSnapshot(observable) {
        if (!observable) return void 0;
        if (typeof observable[SNAPSHOT_READER] === "function") return observable[SNAPSHOT_READER]();
        if (typeof observable.get === "function") return observable.get();
        return observable.value;
      }
      function extractText(event) {
        if (!event) return void 0;
        const data = event.data ?? event;
        const content = data?.message?.content ?? data?.content ?? data?.text;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          const joined = content.map((part) => typeof part === "string" ? part : part?.text ?? part?.value ?? "").filter(Boolean).join(" ");
          if (joined.trim()) return joined;
        }
        return void 0;
      }
      function redact(text, maxLength = 60) {
        return text.replace(/https?:\/\/\S+/g, "\u2026").replace(/[\w.-]*\/[\w./-]+/g, "\u2026").replace(/\s+/g, " ").trim().slice(0, maxLength);
      }
      function toolNameOf(event) {
        const data = event?.data ?? event;
        const direct = data?.name ?? data?.tool ?? data?.toolName;
        if (typeof direct === "string" && direct) return direct;
        const nested = data?.call?.name ?? data?.result?.name;
        return typeof nested === "string" && nested ? nested : void 0;
      }

      // src/client/dialogue.ts
      var MAX_DIALOGUE_LINE = 96;
      function kindOf(entry) {
        const event = entry?.event ?? entry;
        const kind = event?.type ?? event?.kind;
        return typeof kind === "string" && kind ? kind : void 0;
      }
      function dataOf(entry) {
        const event = entry?.event ?? entry;
        return event?.data ?? event;
      }
      function roleOf(kind) {
        if (!kind) return null;
        const lower = kind.toLowerCase();
        if (lower.includes("chunk") || lower.includes("delta")) return null;
        if (lower.includes("context") || lower.includes("system")) return null;
        if (lower.includes("tool")) return lower.includes("result") ? "result" : "tool";
        if (lower.includes("assistant")) return "assistant";
        if (lower.includes("user") || lower.includes("human")) return "user";
        return null;
      }
      function summarizeArguments(raw) {
        if (typeof raw !== "string" || raw.trim().length === 0) return "";
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return "";
        }
        if (!parsed || typeof parsed !== "object") return "";
        const keys = ["file_path", "path", "filePath", "pattern", "query", "command", "url", "glob"];
        for (const key of keys) {
          const value = parsed[key];
          if (typeof value === "string" && value.trim()) return shortenPath(value.trim());
        }
        return "";
      }
      function shortenPath(value) {
        if (!/[/\\]/.test(value)) return value;
        const parts = value.split(/[/\\]/).filter(Boolean);
        if (parts.length <= 2) return parts.join("/");
        return parts.slice(-2).join("/");
      }
      function lineOf(entry) {
        const role = roleOf(kindOf(entry));
        if (!role) return null;
        const data = dataOf(entry);
        if (role === "tool") {
          const name = toolNameOf(data);
          if (!name) return null;
          return {
            role,
            name: redact(name, 32),
            text: summarizeArguments(data?.arguments ?? data?.args)
          };
        }
        if (role === "result") {
          const block = data?.message?.content?.[0];
          const body = typeof block?.content === "string" && block.content.trim() ? block.content : extractText(data) ?? "";
          const text2 = redact(body, MAX_DIALOGUE_LINE);
          if (!text2) return null;
          const failed = block?.isError === true || data?.error != null;
          return { role, text: text2, ok: !failed };
        }
        const raw = extractText(data);
        if (!raw) return null;
        const text = redact(raw, MAX_DIALOGUE_LINE);
        if (!text) return null;
        return { role, text };
      }
      function dialogueFromEntries(entries, limit = 40) {
        if (!Array.isArray(entries)) return [];
        const lines = [];
        let pending = null;
        for (const entry of entries) {
          const role = roleOf(kindOf(entry));
          if (role === "tool") {
            const call = lineOf(entry);
            pending = call;
            if (call) lines.push(call);
            continue;
          }
          if (role === "result") {
            const result = lineOf(entry);
            if (pending && result) {
              pending.ok = result.ok;
              if (result.ok === false && result.text) pending.text = result.text.slice(0, 60);
            }
            pending = null;
            continue;
          }
          pending = null;
          const line = lineOf(entry);
          if (line) lines.push(line);
        }
        return lines.slice(-limit);
      }

      // src/client/keys.ts
      var DEFAULT_SHORTCUT = { ctrl: true, shift: true, alt: true, code: "KeyZ" };
      function isToggleShortcut(event, shortcut = DEFAULT_SHORTCUT) {
        if (!event) return false;
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.repeat) return false;
        return event.ctrlKey === shortcut.ctrl && event.shiftKey === shortcut.shift && event.altKey === shortcut.alt && event.code === shortcut.code;
      }
      function resolveToggle(mode) {
        return mode === "stream" ? "closed" : "stream";
      }
      var DISMISSING_POINTER_EVENTS = /* @__PURE__ */ new Set(["mousemove", "click", "pointerdown"]);
      function isListSurface(surface) {
        return !surface.bookOpened || surface.listOpen;
      }
      function resolveInteraction(mode, event, options = {}) {
        if (isToggleShortcut(event)) return resolveToggle(mode);
        if (mode !== "stream") return null;
        if (options.listVisible) return null;
        if (DISMISSING_POINTER_EVENTS.has(event?.type)) return "closed";
        return null;
      }
      function resolveReadingKey(event) {
        if (!event) return null;
        if (event.isComposing || event.keyCode === 229) return null;
        if (event.ctrlKey || event.altKey || event.metaKey) return null;
        switch (event.code) {
          case "ArrowRight":
          case "BracketRight":
            return "nextChapter";
          case "ArrowLeft":
          case "BracketLeft":
            return "prevChapter";
          case "KeyL":
            return "toggleList";
          case "ArrowUp":
            return "lineUp";
          case "ArrowDown":
            return "lineDown";
          default:
            return null;
        }
      }

      // src/client/reading.tsx
      var React = __toESM(__require("react"), 1);

      // src/client/region.ts
      var MIN_WIDTH_RATIO = 0.4;
      var MIN_HEIGHT_RATIO = 0.5;
      var LEFT_EDGE_EPSILON = 0.5;
      function isMainLike(rect, viewport) {
        if (!rect) return false;
        if (!(rect.width > 0) || !(rect.height > 0)) return false;
        if (rect.left <= LEFT_EDGE_EPSILON) return false;
        if (rect.width < viewport.width * MIN_WIDTH_RATIO) return false;
        if (rect.height < viewport.height * MIN_HEIGHT_RATIO) return false;
        return true;
      }
      function pickMainRegion(candidates, viewport) {
        if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) return null;
        if (!candidates || candidates.length === 0) return null;
        let found = null;
        for (const rect of candidates) {
          if (isMainLike(rect, viewport)) found = rect;
        }
        return found;
      }
      function clampToViewport(rect, viewport) {
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(viewport.width, rect.left + rect.width);
        const bottom = Math.min(viewport.height, rect.top + rect.height);
        return {
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top)
        };
      }
      function regionStyle(region) {
        if (!region) return { position: "fixed", inset: 0 };
        return {
          position: "fixed",
          left: region.left,
          top: region.top,
          width: region.width,
          height: region.height
        };
      }
      function nextRegion(previous, measured) {
        return measured ?? previous;
      }
      function rectFromEdges(box) {
        const width = box.right - box.left;
        const height = box.bottom - box.top;
        if (!(width > 0) || !(height > 0)) return null;
        return { left: box.left, top: box.top, width, height };
      }
      function hasArea(box) {
        return !!box && box.bottom - box.top > 0 && box.right - box.left > 0;
      }
      function paneRegion(input, viewport) {
        if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) return null;
        if (!input || !input.scroll) return null;
        const { scroll } = input;
        const top = hasArea(input.header) ? input.header.bottom : scroll.top;
        const bottom = hasArea(input.seat) ? input.seat.top : scroll.bottom;
        const rect = rectFromEdges({ left: scroll.left, top, right: scroll.right, bottom });
        if (!rect) return null;
        if (rect.width < viewport.width * MIN_WIDTH_RATIO) return null;
        return rect;
      }

      // src/client/scroll.ts
      var LINES_PER_ARROW = 10;
      var FALLBACK_ROW_HEIGHT = 24;
      function clamp(value, min, max2) {
        if (!Number.isFinite(value)) return min;
        return Math.min(Math.max(value, min), max2);
      }
      function clampRatio(ratio) {
        return clamp(ratio, 0, 1);
      }
      function parseLength(value) {
        if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
        if (typeof value !== "string") return 0;
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      }
      function proseRowHeight(lineHeight, fontSize) {
        const height = parseLength(lineHeight);
        if (height > 0) return height;
        const size = parseLength(fontSize);
        return size > 0 ? size * 1.5 : FALLBACK_ROW_HEIGHT;
      }
      function readingRatio(revealed, total) {
        if (!(total > 0)) return 0;
        if (!Number.isFinite(revealed)) return 0;
        return clampRatio(revealed / total);
      }
      function restoreRevealed(total, ratio) {
        if (!(total > 0)) return 0;
        const target = Math.round(total * clampRatio(ratio));
        return Math.min(Math.max(target, 0), total);
      }
      function arrowScrollDelta(rowHeight, direction, lines = LINES_PER_ARROW) {
        const height = rowHeight > 0 ? rowHeight : FALLBACK_ROW_HEIGHT;
        return height * Math.max(1, lines) * direction;
      }
      function pickRowHeight(candidates) {
        for (const value of candidates) {
          if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
        }
        return FALLBACK_ROW_HEIGHT;
      }

      // src/client/typing.ts
      var DEFAULT_TEMPO = {
        charsPerSecond: 18,
        minLineMs: 90,
        maxLineMs: 2600
      };
      function lineDuration(chars, tempo = DEFAULT_TEMPO, quick = false) {
        if (quick) return Math.max(1, tempo.minLineMs);
        const perChar = tempo.charsPerSecond > 0 ? 1e3 / tempo.charsPerSecond : 0;
        const byChars = Math.max(0, chars) * perChar;
        const floor = Math.max(1, tempo.minLineMs);
        const ceiling = Math.max(floor, tempo.maxLineMs);
        return Math.min(Math.max(byChars, floor), ceiling);
      }
      function typingSchedule(lines, startChars, tempo = DEFAULT_TEMPO) {
        const from = Number.isFinite(startChars) ? Math.max(0, Math.floor(startChars)) : 0;
        const slots = [];
        let cursor = 0;
        let clock = 0;
        for (const line of lines) {
          const begin = cursor;
          const end = cursor + Math.max(0, line.chars) + 1;
          if (end > from) {
            const slotBegin = Math.max(begin, from);
            const duration = lineDuration(end - slotBegin, tempo, line.quick === true);
            slots.push({
              beginMs: clock,
              endMs: clock + duration,
              beginChars: slotBegin,
              endChars: end
            });
            clock += duration;
          }
          cursor = end;
        }
        return slots;
      }
      function scheduleDuration(slots) {
        return slots.length === 0 ? 0 : slots[slots.length - 1].endMs;
      }
      function charsAt(slots, elapsedMs) {
        if (slots.length === 0) return 0;
        const first = slots[0];
        if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return first.beginChars;
        const last = slots[slots.length - 1];
        if (elapsedMs >= last.endMs) return last.endChars;
        for (const slot2 of slots) {
          if (elapsedMs >= slot2.endMs) continue;
          const span = slot2.endMs - slot2.beginMs;
          if (!(span > 0)) return slot2.endChars;
          const progress = (Math.max(elapsedMs, slot2.beginMs) - slot2.beginMs) / span;
          const chars = slot2.beginChars + (slot2.endChars - slot2.beginChars) * progress;
          return Math.floor(chars);
        }
        return last.endChars;
      }

      // src/client/primitives.ts
      var cached;
      function loadModule() {
        try {
          const module = __require("@deepseek-ai/dsh-client-ui-primitives");
          return module && typeof module === "object" ? module : null;
        } catch {
          return null;
        }
      }
      function getPrimitives() {
        if (cached === void 0) cached = loadModule();
        return cached;
      }

      // src/client/richtext.ts
      var PLACEHOLDER = "\uFFFC";
      var PLACEHOLDER_PATTERN = /\uFFFC(\d+)\uFFFC/g;
      function imagePlaceholder(index) {
        return `${PLACEHOLDER}${index}${PLACEHOLDER}`;
      }
      function parseIndex(raw) {
        const index = Number.parseInt(raw, 10);
        return Number.isSafeInteger(index) && index >= 0 ? index : void 0;
      }
      function splitImagePlaceholders(text) {
        const blocks = [];
        let cursor = 0;
        PLACEHOLDER_PATTERN.lastIndex = 0;
        let match;
        while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
          if (match.index > cursor) {
            blocks.push({ type: "text", value: text.slice(cursor, match.index) });
          }
          const index = parseIndex(match[1]);
          if (index === void 0) blocks.push({ type: "text", value: match[0] });
          else blocks.push({ type: "image", index });
          cursor = match.index + match[0].length;
        }
        if (cursor < text.length) blocks.push({ type: "text", value: text.slice(cursor) });
        return blocks.filter((block) => block.type !== "text" || block.value.length > 0);
      }

      // src/client/store.ts
      var SLOT = "__STEALTH_READER_STORE__";
      function slot() {
        return globalThis;
      }
      function state() {
        return slot()[SLOT] ??= { mode: "closed", listVisible: false, listeners: /* @__PURE__ */ new Set() };
      }
      function current() {
        return state().mode;
      }
      function setMode(next) {
        const store = state();
        if (next === store.mode) return;
        store.mode = next;
        for (const listener of [...store.listeners]) listener(store.mode);
      }
      function openStream() {
        setMode("stream");
      }
      function close() {
        setMode("closed");
      }
      function goTo(next) {
        setMode(next);
      }
      function setListVisible(visible) {
        state().listVisible = visible === true;
      }
      function isListVisible() {
        return state().listVisible === true;
      }
      function subscribe(listener) {
        const store = state();
        store.listeners.add(listener);
        listener(store.mode);
        return () => {
          store.listeners.delete(listener);
        };
      }

      // src/client/stream.ts
      var MIN_GAP = 3;
      var MAX_GAP = 6;
      var DEFAULT_TOOL_OUTPUT_RATIO = 0.7;
      function seededRandom(seed) {
        let state2 = seed * 2654435761 >>> 0;
        return () => {
          state2 = state2 * 1664525 + 1013904223 >>> 0;
          return state2 / 4294967296;
        };
      }
      function splitParagraphs(text) {
        if (typeof text !== "string") return [];
        return text.split("\n").map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0);
      }
      function chapterLine(chapterIndex, chapterCount, chapterTitle) {
        const marker = `[${chapterIndex + 1}/${chapterCount}]`;
        const title = (chapterTitle ?? "").trim() || `\u7B2C ${chapterIndex + 1} \u7AE0`;
        return { kind: "chapter", source: "novel", text: `${marker} ${title}`, marker };
      }
      function clampRatio2(value) {
        if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_TOOL_OUTPUT_RATIO;
        return Math.min(Math.max(value, 0), 1);
      }
      function dialogueToStreamLine(line) {
        return { kind: line.role, source: "real", text: line.text, name: line.name, ok: line.ok };
      }
      function weaveStream(input) {
        const lines = [
          chapterLine(input.chapterIndex, input.chapterCount, input.chapterTitle)
        ];
        const paragraphs = splitParagraphs(input.chapterText);
        if (paragraphs.length === 0) return lines;
        const dialogue = (input.dialogue ?? []).filter(
          (line) => line && typeof line.text === "string" && line.text.trim().length > 0
        );
        const ratio = clampRatio2(input.toolOutputRatio);
        const random = seededRandom(input.chapterIndex + 1);
        let cursor = 0;
        let gap = MIN_GAP;
        for (const paragraph of paragraphs) {
          lines.push(
            random() < ratio ? { kind: "result", source: "novel", text: paragraph, ok: true } : { kind: "assistant", source: "novel", text: paragraph }
          );
          gap -= 1;
          if (gap > 0 || dialogue.length === 0) continue;
          lines.push(dialogueToStreamLine(dialogue[cursor % dialogue.length]));
          cursor += 1;
          gap = MIN_GAP + Math.floor(random() * (MAX_GAP - MIN_GAP + 1));
        }
        return lines;
      }

      // src/client/reading.tsx
      var Z_OVERLAY = 2147483e3;
      var PROGRESS_THROTTLE_MS = 800;
      var TICK_MS = 50;
      var FOLLOW_TOLERANCE = 40;
      var AppContext = React.createContext(null);
      function AppProvider({
        api,
        children
      }) {
        return React.createElement(AppContext.Provider, { value: api }, children);
      }
      function useApp() {
        const api = React.useContext(AppContext);
        if (!api) throw new Error("useApp \u5FC5\u987B\u653E\u5728 AppProvider \u5185");
        return api;
      }
      var MONO = 'Consolas, "Cascadia Mono", "Sarasa Mono SC", "Microsoft YaHei UI", ui-monospace, monospace';
      var ROOT_BASE = {
        // 关键：覆盖层是 `width: <主区宽度>` + 左右 padding，而 CSS 默认 content-box
        // 会让实际宽度 = 宽度 + 两侧 padding —— 右侧内容正好被裁掉，看起来就是"文字出界"。
        boxSizing: "border-box",
        zIndex: Z_OVERLAY,
        background: "var(--dsw-alias-bg-base, #16161a)",
        color: "var(--dsw-alias-label-secondary, #b9b9c0)",
        overflowY: "auto",
        overflowX: "hidden",
        // 覆盖区已经在输入框上方，这里按 DSH 消息流的实际内边距来（16px 32px）。
        padding: "16px 32px 24px",
        fontFamily: MONO,
        fontSize: 14,
        lineHeight: 1.95,
        cursor: "default",
        userSelect: "none"
      };
      var FONT_DELTA = "var(--dsh-content-font-delta, 0px)";
      var ROW_HEIGHT = `calc(24px + ${FONT_DELTA})`;
      var FONT_BODY = "var(--dsh-content-font-size, 14px)";
      var FONT_SECONDARY = "var(--dsh-content-font-size-secondary, 13px)";
      var LINE_BASE = {
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        // `break-word` 对付不了没有空格的超长串（URL、base64、连续标点）。
        overflowWrap: "anywhere"
      };
      var ASSISTANT_STYLE = {
        ...LINE_BASE,
        fontSize: FONT_BODY,
        lineHeight: ROW_HEIGHT,
        color: "var(--dsw-alias-label-primary, #e6e6ea)",
        margin: "4px 0"
      };
      var RESULT_STYLE = {
        ...LINE_BASE,
        fontSize: FONT_BODY,
        lineHeight: ROW_HEIGHT,
        color: "var(--dsw-alias-label-primary, #e6e6ea)",
        borderLeft: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,140,0.3))",
        margin: "4px 0 2px 22px",
        paddingLeft: 8,
        opacity: 0.95
      };
      var TOOL_ROW = {
        display: "flex",
        alignItems: "center",
        height: ROW_HEIGHT,
        minWidth: 0,
        margin: "2px 0"
      };
      var TOOL_LEADING = {
        position: "relative",
        flex: "none",
        width: `calc(16px + ${FONT_DELTA})`,
        height: `calc(16px + ${FONT_DELTA})`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginRight: 6,
        color: "var(--dsw-alias-label-tertiary, #8a8a95)"
      };
      var TOOL_NAME = {
        flex: "none",
        fontSize: FONT_SECONDARY,
        lineHeight: ROW_HEIGHT,
        color: "var(--dsw-alias-label-secondary, #b9b9c0)"
      };
      var TOOL_DOT = {
        background: "var(--dsw-alias-label-caption, #6a6a75)",
        borderRadius: 1,
        flex: "none",
        width: 2,
        height: 2,
        margin: "0 8px"
      };
      var TOOL_SUMMARY = {
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        fontSize: FONT_SECONDARY,
        lineHeight: ROW_HEIGHT,
        color: "var(--dsw-alias-label-tertiary, #8a8a95)",
        flex: "auto",
        overflow: "hidden"
      };
      var TOOL_SUFFIX = {
        flex: "none",
        marginLeft: 10,
        fontSize: 11,
        fontFamily: "var(--ds-font-family-code, ui-monospace, monospace)",
        color: "var(--dsw-alias-label-caption, #6a6a75)"
      };
      var USER_ROW = {
        display: "flex",
        justifyContent: "flex-end",
        margin: "10px 0"
      };
      var USER_BUBBLE = {
        background: "var(--dsw-specific-bubble, rgba(90,110,150,0.25))",
        borderRadius: 22,
        padding: "10px 16px",
        maxWidth: "82%",
        fontSize: FONT_BODY,
        lineHeight: ROW_HEIGHT,
        color: "var(--dsw-alias-label-primary, #e6e6ea)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word"
      };
      var LIST_TEXT = {
        fontSize: FONT_SECONDARY,
        lineHeight: ROW_HEIGHT,
        color: "var(--dsw-alias-label-tertiary, #8a8a95)"
      };
      var CHAPTER_ROW = {
        ...TOOL_ROW,
        margin: "18px 0 6px"
      };
      var TURN_STATUS = {
        fontSize: FONT_SECONDARY,
        lineHeight: ROW_HEIGHT,
        color: "var(--dsw-alias-label-tertiary, #8a8a95)",
        margin: "6px 0",
        backgroundImage: "linear-gradient(90deg, currentColor 0%, currentColor 35%, transparent 50%, currentColor 65%, currentColor 100%)",
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: "dsh-stealth-shimmer 1.8s linear infinite"
      };
      var KEYFRAMES_ID = "dsh-stealth-reader-keyframes";
      function ensureKeyframes() {
        if (typeof document === "undefined") return;
        if (document.getElementById(KEYFRAMES_ID)) return;
        const style = document.createElement("style");
        style.id = KEYFRAMES_ID;
        style.textContent = [
          "@keyframes dsh-stealth-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}"
        ].join("");
        document.head.appendChild(style);
      }
      function boxOf(node) {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      }
      function findHeader(scroll) {
        let node = scroll.parentElement;
        for (let depth = 0; node && depth < 8; depth += 1) {
          const header = node.querySelector(":scope > header");
          if (header) return header;
          node = node.parentElement;
        }
        return null;
      }
      function measureMainRegion(doc) {
        const probe = doc.querySelector('[data-stealth-reader="probe"]');
        if (!probe) return null;
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const scroll = probe.closest("[data-conversation-scroll]");
        if (scroll) {
          const pane = paneRegion(
            {
              scroll: boxOf(scroll),
              header: boxOf(findHeader(scroll)),
              seat: boxOf(probe.closest("[data-composer-seat]"))
            },
            viewport
          );
          if (pane) return clampToViewport(pane, viewport);
        }
        const candidates = [];
        let node = probe;
        while (node && node !== doc.body) {
          const box = node.getBoundingClientRect();
          candidates.push({ left: box.left, top: box.top, width: box.width, height: box.height });
          node = node.parentElement;
        }
        const region = pickMainRegion(candidates, viewport);
        return region ? clampToViewport(region, viewport) : null;
      }
      function useMainRegion() {
        const [region, setRegion] = React.useState(null);
        React.useEffect(() => {
          let frame = 0;
          const remeasure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              setRegion((previous) => nextRegion(previous, measureMainRegion(document)));
            });
          };
          remeasure();
          const timers = [120, 450, 1200].map((delay) => window.setTimeout(remeasure, delay));
          window.addEventListener("resize", remeasure);
          const poll = window.setInterval(remeasure, 1500);
          return () => {
            cancelAnimationFrame(frame);
            for (const timer of timers) window.clearTimeout(timer);
            window.clearInterval(poll);
            window.removeEventListener("resize", remeasure);
          };
        }, []);
        return region;
      }
      function ChapterImage({ image }) {
        const url = React.useMemo(() => {
          const data = image?.data;
          if (!data) return null;
          try {
            const bytes = new Uint8Array(data);
            return URL.createObjectURL(new Blob([bytes], { type: image.mediaType || "image/png" }));
          } catch {
            return null;
          }
        }, [image]);
        React.useEffect(() => {
          if (!url) return void 0;
          return () => URL.revokeObjectURL(url);
        }, [url]);
        if (!url) return null;
        return React.createElement("img", {
          src: url,
          alt: "",
          style: {
            display: "block",
            maxWidth: "100%",
            height: "auto",
            margin: "0.6em 0 0.6em 2ch",
            borderRadius: 2,
            opacity: 0.9
          }
        });
      }
      function ProseBlock({ text, images }) {
        const blocks = React.useMemo(() => splitImagePlaceholders(text), [text]);
        if (blocks.every((block) => block.type === "text")) {
          return React.createElement(React.Fragment, null, text);
        }
        return React.createElement(
          React.Fragment,
          null,
          blocks.map(
            (block, index) => block.type === "text" ? React.createElement("span", { key: `t${index}` }, block.value) : React.createElement(ChapterImage, {
              key: `i${index}`,
              image: images?.[block.index]
            })
          )
        );
      }
      function LeadingIcon() {
        return React.createElement(
          "svg",
          {
            width: 14,
            height: 14,
            viewBox: "0 0 14 14",
            fill: "none",
            "aria-hidden": "true",
            style: {
              width: `calc(14px + ${FONT_DELTA})`,
              height: `calc(14px + ${FONT_DELTA})`
            }
          },
          React.createElement("circle", { cx: 7, cy: 7, r: 5.2, stroke: "currentColor", strokeWidth: 1.2 })
        );
      }
      function ToolRow({
        name,
        summary,
        suffix,
        failed
      }) {
        const prim = getPrimitives();
        const dot = React.createElement("span", { "aria-hidden": "true", style: TOOL_DOT });
        const summaryNode = React.createElement("span", { style: TOOL_SUMMARY }, summary);
        const suffixNode = suffix ? React.createElement("span", { style: TOOL_SUFFIX }, suffix) : null;
        if (prim?.DisclosureRow) {
          const icon = failed && prim.StateDot ? React.createElement(prim.StateDot, { state: "error" }) : React.createElement(prim.IconChevronRightOutline14 ?? LeadingIcon, { size: 14 });
          return React.createElement(prim.DisclosureRow, {
            icon,
            title: name,
            // 分隔符由调用方提供（实测：collapsedContent 自己带 sep）。
            collapsedContent: React.createElement(
              React.Fragment,
              null,
              dot,
              summaryNode,
              suffixNode
            ),
            // 不展开：展开态会露出"里面到底是什么"，而我们并没有一个真实的调用可以展开。
            expandable: false,
            open: false
          });
        }
        return React.createElement(
          "div",
          { style: TOOL_ROW },
          React.createElement(
            "span",
            { style: TOOL_LEADING },
            failed && prim?.StateDot ? React.createElement(prim.StateDot, { state: "error" }) : React.createElement(LeadingIcon, null)
          ),
          React.createElement("span", { style: TOOL_NAME }, name),
          dot,
          summaryNode,
          suffixNode
        );
      }
      function ProseLine({
        text,
        images,
        indented
      }) {
        const prim = getPrimitives();
        const hasImages = text.includes(PLACEHOLDER) || (images?.length ?? 0) > 0;
        const content = !hasImages && prim?.MarkdownText ? React.createElement(prim.MarkdownText, { text, streaming: false }) : React.createElement(ProseBlock, { text, images });
        return React.createElement(
          "div",
          {
            style: indented ? RESULT_STYLE : ASSISTANT_STYLE,
            // 量"一行正文有多高"时的锚点：上下键一次滚十行，十行的单位就是这里的高度。
            "data-stealth-line": "prose"
          },
          content
        );
      }
      function StreamLineView({
        line,
        images
      }) {
        if (line.source === "novel") {
          if (line.kind === "chapter") {
            return React.createElement(ToolRow, {
              name: "Read",
              summary: line.text.replace(/^\[\d+\/\d+\]\s*/, ""),
              suffix: line.marker
            });
          }
          return React.createElement(ProseLine, {
            text: line.text,
            images,
            indented: line.kind === "result"
          });
        }
        switch (line.kind) {
          case "user":
            return React.createElement(
              "div",
              { style: USER_ROW },
              React.createElement("div", { style: USER_BUBBLE }, line.text)
            );
          case "tool":
            return React.createElement(ToolRow, {
              name: line.name ?? "Tool call",
              summary: line.text || "",
              failed: line.ok === false
            });
          default:
            return React.createElement(ProseLine, { text: line.text, images });
        }
      }
      function revealLines(lines, revealed) {
        const out = [];
        let used = 0;
        for (const line of lines) {
          if (used >= revealed) break;
          const budget = revealed - used;
          const text = line.text.length <= budget ? line.text : line.text.slice(0, budget);
          out.push({ line, text });
          used += line.text.length + 1;
        }
        return out;
      }
      function rowHeightOf(node) {
        if (!node) return 0;
        const prose = node.querySelector('[data-stealth-line="prose"]');
        if (prose instanceof HTMLElement) {
          const style = getComputedStyle(prose);
          return proseRowHeight(style.lineHeight, style.fontSize);
        }
        const first = node.firstElementChild;
        const height = first instanceof HTMLElement ? first.offsetHeight : 0;
        return pickRowHeight([height]);
      }
      function streamLength(lines) {
        return lines.reduce((total, line) => total + line.text.length + 1, 0);
      }
      function StreamBody({
        book,
        chapterIndex,
        chapter,
        loading,
        initialRatio,
        forceTop,
        covered,
        dialogue,
        region,
        app,
        onChapter,
        onToggleList
      }) {
        const scrollRef = React.useRef(null);
        const lastWriteRef = React.useRef(0);
        const locatedRef = React.useRef(null);
        const followRef = React.useRef(true);
        const lines = React.useMemo(
          () => chapter ? weaveStream({
            dialogue,
            chapterText: chapter.text,
            chapterTitle: chapter.title,
            chapterIndex,
            chapterCount: book.chapterCount
          }) : [],
          [chapter, chapterIndex, book.chapterCount, dialogue]
        );
        const total = React.useMemo(() => streamLength(lines), [lines]);
        const [startAt, setStartAt] = React.useState(null);
        const [revealed, setRevealed] = React.useState(0);
        const schedule = React.useMemo(
          () => typingSchedule(
            lines.map((line) => ({ chars: line.text.length, quick: line.source === "real" })),
            startAt ?? 0
          ),
          [lines, startAt]
        );
        const duration = React.useMemo(() => scheduleDuration(schedule), [schedule]);
        React.useEffect(() => {
          ensureKeyframes();
        }, []);
        React.useEffect(() => {
          if (loading || !chapter || total <= 0) return;
          const key = `${book.id}:${chapterIndex}`;
          if (locatedRef.current === key) return;
          locatedRef.current = key;
          const start = forceTop ? 0 : restoreRevealed(total, initialRatio);
          setStartAt(start);
          setRevealed(start);
          followRef.current = true;
        }, [loading, chapter, total, chapterIndex, book.id, forceTop, initialRatio]);
        React.useEffect(() => {
          if (startAt === null || schedule.length === 0 || duration <= 0) return void 0;
          const begin = Date.now();
          const timer = window.setInterval(() => {
            const elapsed = Date.now() - begin;
            setRevealed(charsAt(schedule, elapsed));
            if (elapsed >= duration) window.clearInterval(timer);
          }, TICK_MS);
          return () => window.clearInterval(timer);
        }, [schedule, startAt, duration]);
        React.useEffect(() => {
          const node = scrollRef.current;
          if (!node || !followRef.current) return;
          node.scrollTop = node.scrollHeight;
        }, [revealed]);
        const currentRatio = React.useCallback(
          () => readingRatio(revealed, total),
          [revealed, total]
        );
        const saveProgress = React.useCallback(
          async (index, value) => {
            try {
              await app.putProgress({
                bookId: book.id,
                chapterIndex: index,
                ratio: value,
                updatedAt: Date.now()
              });
            } catch {
            }
          },
          [app, book.id]
        );
        React.useEffect(() => {
          const node = scrollRef.current;
          if (!node) return void 0;
          const onScroll = () => {
            const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
            followRef.current = distanceToBottom < FOLLOW_TOLERANCE;
          };
          node.addEventListener("scroll", onScroll, { passive: true });
          return () => node.removeEventListener("scroll", onScroll);
        }, [chapter]);
        React.useEffect(() => {
          if (!chapter || total <= 0) return;
          const finished = revealed >= total;
          const now = Date.now();
          if (!finished && now - lastWriteRef.current < PROGRESS_THROTTLE_MS) return;
          lastWriteRef.current = now;
          void saveProgress(chapterIndex, currentRatio());
        }, [chapter, chapterIndex, currentRatio, revealed, total, saveProgress]);
        React.useEffect(
          () => () => {
            void saveProgress(chapterIndex, currentRatio());
          },
          [chapterIndex, currentRatio, saveProgress]
        );
        React.useEffect(() => {
          if (covered) return void 0;
          const onKeyDown2 = (event) => {
            const action = resolveReadingKey(event);
            if (!action) return;
            if (covered && action !== "toggleList") return;
            event.preventDefault();
            event.stopPropagation();
            if (action === "toggleList") {
              void saveProgress(chapterIndex, currentRatio());
              onToggleList();
              return;
            }
            if (action === "lineUp" || action === "lineDown") {
              const node = scrollRef.current;
              if (node) {
                node.scrollBy({
                  top: arrowScrollDelta(rowHeightOf(node), action === "lineDown" ? 1 : -1)
                });
              }
              return;
            }
            const next = action === "nextChapter" ? chapterIndex + 1 : chapterIndex - 1;
            if (next < 0 || next >= book.chapterCount) return;
            void saveProgress(chapterIndex, currentRatio());
            onChapter(next);
          };
          window.addEventListener("keydown", onKeyDown2, true);
          return () => window.removeEventListener("keydown", onKeyDown2, true);
        }, [book.chapterCount, chapterIndex, covered, currentRatio, onChapter, onToggleList, saveProgress]);
        const visible = React.useMemo(() => revealLines(lines, revealed), [lines, revealed]);
        const streaming = revealed < total;
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            {
              ref: scrollRef,
              style: { ...ROOT_BASE, ...regionStyle(region) },
              "data-stealth-reader": "stream",
              // 诊断用。逐字输出或续读出问题时，看一眼这四个数就够定位：
              //   data-start    本次从第几个字符开始（0 = 从头；几千 = 续读成功）
              //   data-revealed 已经输出到第几个字符
              //   data-total    全章字符总数（revealed == total 就是输出完了）
              //   data-ratio    阅读进度百分比（续读时会立刻跳到上次的位置）
              "data-start": startAt ?? 0,
              "data-revealed": revealed,
              "data-total": total,
              "data-ratio": Math.round(readingRatio(revealed, total) * 100)
            },
            loading || !chapter ? React.createElement("div", { style: TOOL_NAME }, "loading\u2026") : visible.map(
              (row, index) => React.createElement(StreamLineView, {
                key: index,
                line: row.line,
                images: chapter.images
              })
            ),
            // DSH 唯一的"正在生成"标志就是这一行（**没有光标**，全仓 0 命中）。
            streaming ? React.createElement(
              "div",
              { role: "status", style: TURN_STATUS },
              "\u6DF1\u5EA6\u6C42\u7D22\u4E2D..."
            ) : null
          )
        );
      }
      var LIST_ROW = {
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        padding: "5px 2ch",
        cursor: "pointer",
        borderRadius: 3
      };
      function footnote(text) {
        return React.createElement("div", { style: { ...LIST_TEXT, opacity: 0.38, marginTop: 2 } }, text);
      }
      function TaskList({
        books,
        progressMap,
        importing,
        error,
        activeId,
        region,
        onImport,
        onOpen,
        onOpenChapters,
        onDelete,
        onClose
      }) {
        const inputRef = React.useRef(null);
        const [dragging, setDragging] = React.useState(false);
        return React.createElement(
          "div",
          {
            style: { ...ROOT_BASE, ...regionStyle(region), padding: "24px 32px 32px" },
            "data-stealth-reader": "list",
            onDragOver: (event) => {
              event.preventDefault();
              setDragging(true);
            },
            onDragLeave: () => setDragging(false),
            onDrop: (event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer?.files?.[0];
              if (file) onImport(file);
            }
          },
          React.createElement(
            "div",
            { style: { ...LIST_TEXT, opacity: 0.5, marginBottom: 10 } },
            "recent tasks"
          ),
          books.length === 0 ? footnote(importing ? "attaching\u2026" : "no tasks \xB7 drop a .txt / .epub file here") : books.map(
            (book) => React.createElement(
              "div",
              {
                key: book.id,
                style: {
                  ...LIST_ROW,
                  background: book.id === activeId ? "rgba(128,128,150,0.14)" : "transparent"
                },
                onClick: () => onOpen(book.id)
              },
              React.createElement(
                "span",
                { style: { opacity: 0.5 } },
                book.id === activeId ? "\u25B8" : "\xB7"
              ),
              React.createElement(
                "span",
                {
                  style: {
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }
                },
                book.title
              ),
              React.createElement(
                "span",
                { style: { opacity: 0.5, fontSize: 12.5 } },
                `${Math.min((progressMap[book.id]?.chapterIndex ?? 0) + 1, book.chapterCount)}/${book.chapterCount} \xB7 ${Math.round((progressMap[book.id]?.ratio ?? 0) * 100)}%` + (book.warning ? " \xB7 !" : "")
              ),
              React.createElement(
                "span",
                {
                  title: "\u6B65\u9AA4",
                  onClick: (event) => {
                    event.stopPropagation();
                    onOpenChapters(book.id);
                  },
                  style: { opacity: 0.35, fontSize: 12.5, padding: "0 4px" }
                },
                "\u2261"
              ),
              React.createElement(
                "span",
                {
                  title: "\u79FB\u9664",
                  onClick: (event) => {
                    event.stopPropagation();
                    onDelete(book.id);
                  },
                  style: { opacity: 0.28, fontSize: 12.5, padding: "0 4px" }
                },
                "\u2715"
              )
            )
          ),
          React.createElement(
            "div",
            { style: { ...LIST_TEXT, opacity: 0.32, marginTop: 14, display: "flex", gap: 14 } },
            React.createElement(
              "span",
              { style: { cursor: "pointer" }, onClick: () => inputRef.current?.click() },
              importing ? "attaching\u2026" : "+ attach file"
            ),
            React.createElement("span", null, "\u2261 for steps \xB7 space page \xB7 l close")
          ),
          React.createElement("input", {
            ref: inputRef,
            type: "file",
            accept: ".txt,.epub,text/plain,application/epub+zip",
            style: { display: "none" },
            onChange: (event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = "";
            }
          }),
          error ? React.createElement(
            "div",
            { style: { ...LIST_TEXT, color: "#d98d8d", opacity: 0.9, marginTop: 10 } },
            `! ${error}`
          ) : null,
          dragging ? footnote("release to attach") : null
        );
      }
      function ChapterList({
        book,
        chapters,
        currentIndex,
        region,
        onPick,
        onBack
      }) {
        const boxRef = React.useRef(null);
        const currentRef = React.useRef(null);
        React.useEffect(() => {
          const box = boxRef.current;
          const row = currentRef.current;
          if (!box || !row) return;
          const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
          box.scrollTop += delta - box.clientHeight / 2 + row.offsetHeight / 2;
        }, [chapters]);
        return React.createElement(
          "div",
          {
            ref: boxRef,
            style: { ...ROOT_BASE, ...regionStyle(region), padding: "24px 32px 32px" },
            "data-stealth-reader": "chapters"
          },
          React.createElement(
            "div",
            { style: { ...LIST_TEXT, opacity: 0.5, marginBottom: 10, display: "flex", gap: 12 } },
            React.createElement(
              "span",
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }
              },
              book.title
            ),
            React.createElement(
              "span",
              { style: { opacity: 0.7 } },
              `${Math.min(currentIndex + 1, book.chapterCount)}/${book.chapterCount}`
            )
          ),
          chapters === void 0 ? footnote("loading steps\u2026") : chapters.map(
            (chapter) => React.createElement(
              "div",
              {
                key: chapter.index,
                ref: chapter.index === currentIndex ? currentRef : void 0,
                style: {
                  ...LIST_ROW,
                  background: chapter.index === currentIndex ? "rgba(128,128,150,0.14)" : "transparent"
                },
                onClick: () => onPick(chapter.index)
              },
              React.createElement(
                "span",
                { style: { opacity: 0.5 } },
                chapter.index < currentIndex ? "\u2713" : chapter.index === currentIndex ? "\u25B8" : "\xB7"
              ),
              React.createElement(
                "span",
                {
                  style: {
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }
                },
                chapter.title
              ),
              React.createElement(
                "span",
                { style: { opacity: 0.4, fontSize: 12.5 } },
                `${chapter.index + 1}`
              )
            )
          ),
          React.createElement(
            "div",
            { style: { ...LIST_TEXT, opacity: 0.32, marginTop: 14, display: "flex", gap: 14 } },
            React.createElement("span", { style: { cursor: "pointer" }, onClick: onBack }, "\u2190 back"),
            React.createElement("span", null, "space page \xB7 l close")
          )
        );
      }
      function StreamView({ dialogueSource }) {
        const app = useApp();
        const [books, setBooks] = React.useState(void 0);
        const [progressMap, setProgressMap] = React.useState({});
        const [open, setOpen] = React.useState(null);
        const [listView, setListView] = React.useState(null);
        const [chapterTitles, setChapterTitles] = React.useState(void 0);
        const [importing, setImporting] = React.useState(false);
        const [error, setError] = React.useState(void 0);
        const [forceTop, setForceTop] = React.useState(false);
        const region = useMainRegion();
        const listVisible = isListSurface({ bookOpened: open !== null, listOpen: listView !== null });
        React.useEffect(() => {
          setListVisible(listVisible);
          return () => setListVisible(false);
        }, [listVisible]);
        const dialogueRef = React.useRef(null);
        if (dialogueRef.current === null) {
          try {
            dialogueRef.current = dialogueSource();
          } catch {
            dialogueRef.current = [];
          }
        }
        const dialogue = dialogueRef.current;
        const refresh = React.useCallback(async () => {
          try {
            const [rows, progress] = await Promise.all([app.listBooks(), app.listProgress()]);
            setBooks(rows);
            setProgressMap(progress);
            return rows;
          } catch (cause) {
            setError(`\u8BFB\u53D6\u672C\u5730\u4E66\u5E93\u5931\u8D25\uFF1A${cause?.message ?? cause}`);
            setBooks([]);
            return [];
          }
        }, [app]);
        React.useEffect(() => {
          void refresh();
        }, [refresh]);
        const openBook = React.useCallback(
          async (bookId, rows, progress) => {
            const all = rows ?? books ?? [];
            const book = all.find((row) => row.id === bookId);
            if (!book) return;
            const record = (progress ?? progressMap)[bookId];
            const chapterIndex = Math.min(Math.max(record?.chapterIndex ?? 0, 0), book.chapterCount - 1);
            setForceTop(false);
            setListView(null);
            setOpen({ book, chapterIndex, chapter: void 0, loading: true });
            const chapter = await app.getChapter(book.id, chapterIndex);
            setOpen({ book, chapterIndex, chapter, loading: false });
          },
          [app, books, progressMap]
        );
        const autoOpenedRef = React.useRef(false);
        React.useEffect(() => {
          if (autoOpenedRef.current || books === void 0 || books.length === 0) return;
          autoOpenedRef.current = true;
          const recent = [...books].sort(
            (left, right) => (progressMap[right.id]?.updatedAt ?? 0) - (progressMap[left.id]?.updatedAt ?? 0)
          )[0];
          if (recent) void openBook(recent.id);
        }, [books, progressMap, openBook]);
        const goToChapter = React.useCallback(
          async (book, chapterIndex) => {
            const clamped = Math.min(Math.max(chapterIndex, 0), book.chapterCount - 1);
            setForceTop(true);
            setOpen({ book, chapterIndex: clamped, chapter: void 0, loading: true });
            const chapter = await app.getChapter(book.id, clamped);
            setOpen({ book, chapterIndex: clamped, chapter, loading: false });
          },
          [app]
        );
        const openChapters = React.useCallback((book) => {
          setChapterTitles(void 0);
          setListView({ kind: "chapters", book });
        }, []);
        const pickChapter = React.useCallback(
          (book, index) => {
            setListView(null);
            void goToChapter(book, index);
          },
          [goToChapter]
        );
        const chapterBook = listView?.kind === "chapters" ? listView.book : void 0;
        React.useEffect(() => {
          if (!chapterBook) return;
          let cancelled = false;
          void app.listChapterTitles(chapterBook.id).then(
            (rows) => {
              if (!cancelled) setChapterTitles(rows);
            },
            () => {
              if (!cancelled) setChapterTitles([]);
            }
          );
          return () => {
            cancelled = true;
          };
        }, [app, chapterBook]);
        const handleImport = React.useCallback(
          async (file) => {
            setImporting(true);
            setError(void 0);
            try {
              const result = await app.importFile(file);
              if (!result.ok) {
                setError(`${file.name}\uFF1A${result.error ?? "\u5BFC\u5165\u5931\u8D25"}`);
                return;
              }
              const rows = await refresh();
              setListView({ kind: "books" });
              const only = rows.length === 1 ? rows[0] : void 0;
              if (only) void openBook(only.id, rows);
            } finally {
              setImporting(false);
            }
          },
          [app, openBook, refresh]
        );
        const handleDelete = React.useCallback(
          async (bookId) => {
            await app.deleteBook(bookId);
            setOpen((current2) => current2?.book.id === bookId ? null : current2);
            await refresh();
          },
          [app, refresh]
        );
        const bookShelf = React.createElement(TaskList, {
          books: books ?? [],
          progressMap,
          importing,
          error,
          activeId: open?.book.id,
          region,
          onImport: (file) => void handleImport(file),
          onOpen: (bookId) => void openBook(bookId),
          onOpenChapters: (bookId) => {
            const book = (books ?? []).find((row) => row.id === bookId);
            if (book) openChapters(book);
          },
          onDelete: (bookId) => void handleDelete(bookId),
          onClose: () => {
            if (open) setListView(null);
            else close();
          }
        });
        const chapterList = chapterBook ? React.createElement(ChapterList, {
          book: chapterBook,
          chapters: chapterTitles,
          // 正在读的那本以内存里的章节为准（进度是切章时才落库的），其余看落库的进度。
          currentIndex: open?.book.id === chapterBook.id ? open.chapterIndex : progressMap[chapterBook.id]?.chapterIndex ?? 0,
          region,
          onPick: (index) => pickChapter(chapterBook, index),
          onBack: () => setListView({ kind: "books" })
        }) : null;
        if (!open) return chapterList ?? bookShelf;
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(StreamBody, {
            book: open.book,
            chapterIndex: open.chapterIndex,
            chapter: open.chapter,
            loading: open.loading,
            forceTop,
            initialRatio: progressMap[open.book.id]?.chapterIndex === open.chapterIndex ? progressMap[open.book.id]?.ratio ?? 0 : 0,
            covered: listView !== null,
            dialogue,
            region,
            app,
            onChapter: (index) => void goToChapter(open.book, index),
            onToggleList: () => {
              setListView((value) => value ? null : { kind: "books" });
              void refresh();
            }
          }),
          listView === null ? null : chapterList ?? bookShelf
        );
      }

      // src/client/modes.tsx
      var React2 = __toESM(__require("react"), 1);
      function Overlay({ stream }) {
        const [mode, setMode2] = React2.useState(current);
        React2.useEffect(() => subscribe(setMode2), []);
        if (mode === "closed") return null;
        return React2.createElement(React2.Fragment, null, stream);
      }

      // src/client/storage.ts
      var DB_NAME = "dsh-stealth-reader";
      var DB_VERSION = 1;
      var STORE_BOOKS = "books";
      var STORE_CHAPTERS = "chapters";
      var STORE_PROGRESS = "progress";
      function newBookId() {
        const random = globalThis.crypto?.randomUUID?.();
        return random ?? `book-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      }
      function openDatabase(name = DB_NAME) {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(name, DB_VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_BOOKS)) {
              db.createObjectStore(STORE_BOOKS, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
              const store = db.createObjectStore(STORE_CHAPTERS, { keyPath: ["bookId", "index"] });
              store.createIndex("byBook", "bookId");
            }
            if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
              db.createObjectStore(STORE_PROGRESS, { keyPath: "bookId" });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("\u65E0\u6CD5\u6253\u5F00\u672C\u5730\u4E66\u5E93"));
        });
      }
      function promisifyRequest(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      function promisifyTransaction(transaction) {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error ?? new Error("\u5199\u5165\u88AB\u4E2D\u6B62"));
        });
      }
      async function putBook(db, book, chapters, progress) {
        const transaction = db.transaction([STORE_BOOKS, STORE_CHAPTERS, STORE_PROGRESS], "readwrite");
        const books = transaction.objectStore(STORE_BOOKS);
        const chapterStore = transaction.objectStore(STORE_CHAPTERS);
        const progressStore = transaction.objectStore(STORE_PROGRESS);
        books.put(book);
        for (const chapter of chapters) chapterStore.put(chapter);
        progressStore.put(
          progress ?? { bookId: book.id, chapterIndex: 0, ratio: 0, updatedAt: Date.now() }
        );
        await promisifyTransaction(transaction);
      }
      async function listBooks(db) {
        const rows = await promisifyRequest(db.transaction(STORE_BOOKS).objectStore(STORE_BOOKS).getAll());
        return rows.sort((left, right) => right.addedAt - left.addedAt);
      }
      async function getChapter(db, bookId, index) {
        const store = db.transaction(STORE_CHAPTERS).objectStore(STORE_CHAPTERS);
        return await promisifyRequest(store.get([bookId, index]));
      }
      async function listChapterTitles(db, bookId) {
        const store = db.transaction(STORE_CHAPTERS).objectStore(STORE_CHAPTERS);
        const rows = await promisifyRequest(store.index("byBook").getAll(bookId));
        return rows.map((row) => ({ index: row.index, title: row.title })).sort((left, right) => left.index - right.index);
      }
      async function getProgress(db, bookId) {
        const store = db.transaction(STORE_PROGRESS).objectStore(STORE_PROGRESS);
        return await promisifyRequest(store.get(bookId));
      }
      async function putProgress(db, progress) {
        const transaction = db.transaction(STORE_PROGRESS, "readwrite");
        transaction.objectStore(STORE_PROGRESS).put(progress);
        await promisifyTransaction(transaction);
      }
      async function deleteBook(db, bookId) {
        const transaction = db.transaction(
          [STORE_BOOKS, STORE_CHAPTERS, STORE_PROGRESS],
          "readwrite"
        );
        transaction.objectStore(STORE_BOOKS).delete(bookId);
        transaction.objectStore(STORE_PROGRESS).delete(bookId);
        const index = transaction.objectStore(STORE_CHAPTERS).index("byBook");
        const keys = await promisifyRequest(index.getAllKeys(bookId));
        for (const key of keys) transaction.objectStore(STORE_CHAPTERS).delete(key);
        await promisifyTransaction(transaction);
      }

      // src/client/chapters.ts
      var CHUNK_CHARS = 5e3;
      var CHAPTER_PATTERN = /^(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇部集]|Chapter\s+\d+|\d{1,4}[.、]\s*\S)[^\n]{0,38}$/;
      function splitChapters(raw, options = {}) {
        const chunkChars = options.chunkChars ?? CHUNK_CHARS;
        const minChapters = options.minChapters ?? 2;
        const text = raw.replace(/\r\n?/g, "\n");
        if (text.trim().length === 0) return [];
        const marked = splitByMarkers(text);
        if (marked.length >= minChapters) return marked;
        return splitByLength(text, chunkChars);
      }
      function splitByMarkers(text) {
        const lines = text.split("\n");
        const starts = [];
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index].trim();
          if (line.length === 0 || line.length > 48) continue;
          if (CHAPTER_PATTERN.test(line)) starts.push({ line: index, title: line });
        }
        if (starts.length === 0) return [];
        const chapters = [];
        for (let index = 0; index < starts.length; index += 1) {
          const start = starts[index];
          const end = index + 1 < starts.length ? starts[index + 1].line : lines.length;
          const body = lines.slice(start.line + 1, end).join("\n").trim();
          chapters.push({ index: chapters.length, title: start.title, text: body });
        }
        return chapters;
      }
      function splitByLength(text, chunkChars) {
        const total = text.length;
        if (total === 0) return [];
        const target = total <= chunkChars * 1.5 ? total : chunkChars;
        const chapters = [];
        let cursor = 0;
        while (cursor < total) {
          let end = Math.min(total, cursor + target);
          if (end < total) {
            end = adjustBoundary(text, end);
          }
          const body = text.slice(cursor, end).trim();
          if (body.length > 0) {
            chapters.push({
              index: chapters.length,
              title: `\u7B2C ${chapters.length + 1} \u8282`,
              text: body
            });
          }
          cursor = end;
        }
        if (chapters.length === 0) return [{ index: 0, title: "\u5168\u6587", text: text.trim() }];
        if (chapters.length === 1 && chapters[0].text.length === text.trim().length) {
          return [{ index: 0, title: "\u5168\u6587", text: chapters[0].text }];
        }
        return chapters;
      }
      function adjustBoundary(text, position) {
        const search = text.slice(position, Math.min(text.length, position + 400));
        const blank = search.search(/\n\s*\n/);
        if (blank >= 0) return position + blank + 1;
        const newline = search.indexOf("\n");
        if (newline >= 0) return position + newline + 1;
        return position;
      }

      // src/client/decode.ts
      function tryDecodeUtf8(bytes) {
        if (hasBom(bytes)) {
          try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
          } catch {
            return void 0;
          }
        }
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return void 0;
        }
      }
      function decodeGb18030(bytes) {
        try {
          return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
        } catch {
          return "";
        }
      }
      function looksLikeText(text) {
        if (!text) return false;
        if (text.includes("\0")) return false;
        if (text.trim().length === 0) return false;
        const sample = text.slice(0, 6e3);
        if (sample.length === 0) return false;
        let suspicious = 0;
        let cjk = 0;
        for (const char of sample) {
          const code = char.codePointAt(0) ?? 0;
          if (code >= 19968 && code <= 40959 || code >= 12288 && code <= 12351) cjk += 1;
          else if (code === 65533 || // 替换字符
          code >= 57344 && code <= 63743 || // 私用区：乱码的典型落点
          code >= 128 && code <= 159) {
            suspicious += 1;
          }
        }
        return suspicious / sample.length < 0.05 && (cjk > 0 || sample.length < 200);
      }
      function hasBom(bytes) {
        return bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
      }
      function decodeText(bytes) {
        if (!bytes || bytes.length === 0) {
          return { text: "", encoding: "utf-8", error: "\u6587\u4EF6\u662F\u7A7A\u7684" };
        }
        const utf8 = tryDecodeUtf8(bytes);
        if (utf8 !== void 0) return { text: utf8, encoding: "utf-8" };
        const gb = decodeGb18030(bytes);
        if (looksLikeText(gb)) return { text: gb, encoding: "gb18030" };
        return {
          text: gb,
          encoding: "gb18030",
          error: "\u65E0\u6CD5\u8BC6\u522B\u6587\u4EF6\u7F16\u7801\uFF08\u5185\u5BB9\u4E0D\u50CF\u6587\u672C\uFF0C\u53EF\u80FD\u662F\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF09"
        };
      }

      // node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/browser.js
      var u8 = Uint8Array;
      var u16 = Uint16Array;
      var i32 = Int32Array;
      var fleb = new u8([
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        1,
        1,
        2,
        2,
        2,
        2,
        3,
        3,
        3,
        3,
        4,
        4,
        4,
        4,
        5,
        5,
        5,
        5,
        0,
        /* unused */
        0,
        0,
        /* impossible */
        0
      ]);
      var fdeb = new u8([
        0,
        0,
        0,
        0,
        1,
        1,
        2,
        2,
        3,
        3,
        4,
        4,
        5,
        5,
        6,
        6,
        7,
        7,
        8,
        8,
        9,
        9,
        10,
        10,
        11,
        11,
        12,
        12,
        13,
        13,
        /* unused */
        0,
        0
      ]);
      var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
      var freb = function(eb, start) {
        var b = new u16(31);
        for (var i2 = 0; i2 < 31; ++i2) {
          b[i2] = start += 1 << eb[i2 - 1];
        }
        var r = new i32(b[30]);
        for (var i2 = 1; i2 < 30; ++i2) {
          for (var j = b[i2]; j < b[i2 + 1]; ++j) {
            r[j] = j - b[i2] << 5 | i2;
          }
        }
        return { b, r };
      };
      var _a = freb(fleb, 2);
      var fl = _a.b;
      var revfl = _a.r;
      fl[28] = 258, revfl[258] = 28;
      var _b = freb(fdeb, 0);
      var fd = _b.b;
      var revfd = _b.r;
      var rev = new u16(32768);
      for (i = 0; i < 32768; ++i) {
        x = (i & 43690) >> 1 | (i & 21845) << 1;
        x = (x & 52428) >> 2 | (x & 13107) << 2;
        x = (x & 61680) >> 4 | (x & 3855) << 4;
        rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
      }
      var x;
      var i;
      var hMap = (function(cd, mb, r) {
        var s = cd.length;
        var i2 = 0;
        var l = new u16(mb);
        for (; i2 < s; ++i2) {
          if (cd[i2])
            ++l[cd[i2] - 1];
        }
        var le = new u16(mb);
        for (i2 = 1; i2 < mb; ++i2) {
          le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
        }
        var co;
        if (r) {
          co = new u16(1 << mb);
          var rvb = 15 - mb;
          for (i2 = 0; i2 < s; ++i2) {
            if (cd[i2]) {
              var sv = i2 << 4 | cd[i2];
              var r_1 = mb - cd[i2];
              var v = le[cd[i2] - 1]++ << r_1;
              for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
                co[rev[v] >> rvb] = sv;
              }
            }
          }
        } else {
          co = new u16(s);
          for (i2 = 0; i2 < s; ++i2) {
            if (cd[i2]) {
              co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
            }
          }
        }
        return co;
      });
      var flt = new u8(288);
      for (i = 0; i < 144; ++i)
        flt[i] = 8;
      var i;
      for (i = 144; i < 256; ++i)
        flt[i] = 9;
      var i;
      for (i = 256; i < 280; ++i)
        flt[i] = 7;
      var i;
      for (i = 280; i < 288; ++i)
        flt[i] = 8;
      var i;
      var fdt = new u8(32);
      for (i = 0; i < 32; ++i)
        fdt[i] = 5;
      var i;
      var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
      var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
      var max = function(a) {
        var m = a[0];
        for (var i2 = 1; i2 < a.length; ++i2) {
          if (a[i2] > m)
            m = a[i2];
        }
        return m;
      };
      var bits = function(d, p, m) {
        var o = p / 8 | 0;
        return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
      };
      var bits16 = function(d, p) {
        var o = p / 8 | 0;
        return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
      };
      var shft = function(p) {
        return (p + 7) / 8 | 0;
      };
      var slc = function(v, s, e) {
        if (s == null || s < 0)
          s = 0;
        if (e == null || e > v.length)
          e = v.length;
        return new u8(v.subarray(s, e));
      };
      var ec = [
        "unexpected EOF",
        "invalid block type",
        "invalid length/literal",
        "invalid distance",
        "stream finished",
        "no stream handler",
        ,
        // determined by compression function
        "no callback",
        "invalid UTF-8 data",
        "extra field too long",
        "date not in range 1980-2099",
        "filename too long",
        "stream finishing",
        "invalid zip data"
        // determined by unknown compression method
      ];
      var err = function(ind, msg, nt) {
        var e = new Error(msg || ec[ind]);
        e.code = ind;
        if (Error.captureStackTrace)
          Error.captureStackTrace(e, err);
        if (!nt)
          throw e;
        return e;
      };
      var inflt = function(dat, st, buf, dict) {
        var sl = dat.length, dl = dict ? dict.length : 0;
        if (!sl || st.f && !st.l)
          return buf || new u8(0);
        var noBuf = !buf;
        var resize = noBuf || st.i != 2;
        var noSt = st.i;
        if (noBuf)
          buf = new u8(sl * 3);
        var cbuf = function(l2) {
          var bl = buf.length;
          if (l2 > bl) {
            var nbuf = new u8(Math.max(bl * 2, l2));
            nbuf.set(buf);
            buf = nbuf;
          }
        };
        var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
        var tbts = sl * 8;
        do {
          if (!lm) {
            final = bits(dat, pos, 1);
            var type = bits(dat, pos + 1, 3);
            pos += 3;
            if (!type) {
              var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
              if (t > sl) {
                if (noSt)
                  err(0);
                break;
              }
              if (resize)
                cbuf(bt + l);
              buf.set(dat.subarray(s, t), bt);
              st.b = bt += l, st.p = pos = t * 8, st.f = final;
              continue;
            } else if (type == 1)
              lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
            else if (type == 2) {
              var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
              var tl = hLit + bits(dat, pos + 5, 31) + 1;
              pos += 14;
              var ldt = new u8(tl);
              var clt = new u8(19);
              for (var i2 = 0; i2 < hcLen; ++i2) {
                clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
              }
              pos += hcLen * 3;
              var clb = max(clt), clbmsk = (1 << clb) - 1;
              var clm = hMap(clt, clb, 1);
              for (var i2 = 0; i2 < tl; ) {
                var r = clm[bits(dat, pos, clbmsk)];
                pos += r & 15;
                var s = r >> 4;
                if (s < 16) {
                  ldt[i2++] = s;
                } else {
                  var c = 0, n = 0;
                  if (s == 16)
                    n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
                  else if (s == 17)
                    n = 3 + bits(dat, pos, 7), pos += 3;
                  else if (s == 18)
                    n = 11 + bits(dat, pos, 127), pos += 7;
                  while (n--)
                    ldt[i2++] = c;
                }
              }
              var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
              lbt = max(lt);
              dbt = max(dt);
              lm = hMap(lt, lbt, 1);
              dm = hMap(dt, dbt, 1);
            } else
              err(1);
            if (pos > tbts) {
              if (noSt)
                err(0);
              break;
            }
          }
          if (resize)
            cbuf(bt + 131072);
          var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
          var lpos = pos;
          for (; ; lpos = pos) {
            var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
            pos += c & 15;
            if (pos > tbts) {
              if (noSt)
                err(0);
              break;
            }
            if (!c)
              err(2);
            if (sym < 256)
              buf[bt++] = sym;
            else if (sym == 256) {
              lpos = pos, lm = null;
              break;
            } else {
              var add = sym - 254;
              if (sym > 264) {
                var i2 = sym - 257, b = fleb[i2];
                add = bits(dat, pos, (1 << b) - 1) + fl[i2];
                pos += b;
              }
              var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
              if (!d)
                err(3);
              pos += d & 15;
              var dt = fd[dsym];
              if (dsym > 3) {
                var b = fdeb[dsym];
                dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
              }
              if (pos > tbts) {
                if (noSt)
                  err(0);
                break;
              }
              if (resize)
                cbuf(bt + 131072);
              var end = bt + add;
              if (bt < dt) {
                var shift = dl - dt, dend = Math.min(dt, end);
                if (shift + bt < 0)
                  err(3);
                for (; bt < dend; ++bt)
                  buf[bt] = dict[shift + bt];
              }
              for (; bt < end; ++bt)
                buf[bt] = buf[bt - dt];
            }
          }
          st.l = lm, st.p = lpos, st.b = bt, st.f = final;
          if (lm)
            final = 1, st.m = lbt, st.d = dm, st.n = dbt;
        } while (!final);
        return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
      };
      var et = /* @__PURE__ */ new u8(0);
      var b2 = function(d, b) {
        return d[b] | d[b + 1] << 8;
      };
      var b4 = function(d, b) {
        return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
      };
      var b8 = function(d, b) {
        return b4(d, b) + b4(d, b + 4) * 4294967296;
      };
      function inflateSync(data, opts) {
        return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
      }
      var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
      var tds = 0;
      try {
        td.decode(et, { stream: true });
        tds = 1;
      } catch (e) {
      }
      var dutf8 = function(d) {
        for (var r = "", i2 = 0; ; ) {
          var c = d[i2++];
          var eb = (c > 127) + (c > 223) + (c > 239);
          if (i2 + eb > d.length)
            return { s: r, r: slc(d, i2 - 1) };
          if (!eb)
            r += String.fromCharCode(c);
          else if (eb == 3) {
            c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
          } else if (eb & 1)
            r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
          else
            r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
        }
      };
      function strFromU8(dat, latin1) {
        if (latin1) {
          var r = "";
          for (var i2 = 0; i2 < dat.length; i2 += 16384)
            r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
          return r;
        } else if (td) {
          return td.decode(dat);
        } else {
          var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
          if (r.length)
            err(8);
          return s;
        }
      }
      var slzh = function(d, b) {
        return b + 30 + b2(d, b + 26) + b2(d, b + 28);
      };
      var zh = function(d, b, z) {
        var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
        var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
        return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
      };
      var z64hs = function(d, b, l, z, sc, su, off) {
        var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
        var nf = nsc + nsu + noff;
        if (z && nf) {
          for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
            if (b2(d, b) == 1) {
              return [
                nsc ? b8(d, b + 4 + 8 * nsu) : sc,
                nsu ? b8(d, b + 4) : su,
                noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
                1
              ];
            }
          }
          if (z < 2)
            err(13);
        }
        return [sc, su, off, 0];
      };
      function unzipSync(data, opts) {
        var files = {};
        var e = data.length - 22;
        for (; b4(data, e) != 101010256; --e) {
          if (!e || data.length - e > 65558)
            err(13);
        }
        ;
        var c = b2(data, e + 8);
        if (!c)
          return {};
        var o = b4(data, e + 16);
        var z = b4(data, e - 20) == 117853008;
        if (z) {
          var ze = b4(data, e - 12);
          z = b4(data, ze) == 101075792;
          if (z) {
            c = b4(data, ze + 32);
            o = b4(data, ze + 48);
          }
        }
        var fltr = opts && opts.filter;
        for (var i2 = 0; i2 < c; ++i2) {
          var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
          o = no;
          if (!fltr || fltr({
            name: fn,
            size: sc,
            originalSize: su,
            compression: c_2
          })) {
            if (!c_2)
              files[fn] = slc(data, b, b + sc);
            else if (c_2 == 8)
              files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
            else
              err(14, "unknown compression type " + c_2);
          }
        }
        return files;
      }

      // src/client/xml.ts
      var NAMED_ENTITIES = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: "\xA0"
      };
      var ENTITY_PATTERN = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;
      function fromCodePoint(code) {
        if (!Number.isFinite(code) || code < 0 || code > 1114111) return null;
        if (code >= 55296 && code <= 57343) return null;
        try {
          return String.fromCodePoint(code);
        } catch {
          return null;
        }
      }
      function decodeEntities(text) {
        return text.replace(ENTITY_PATTERN, (whole, body) => {
          if (body.startsWith("#x") || body.startsWith("#X")) {
            return fromCodePoint(Number.parseInt(body.slice(2), 16)) ?? whole;
          }
          if (body.startsWith("#")) {
            return fromCodePoint(Number.parseInt(body.slice(1), 10)) ?? whole;
          }
          return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
        });
      }
      function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      function parseAttributes(raw) {
        const attrs = {};
        const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let match;
        while ((match = pattern.exec(raw)) !== null) {
          attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? "");
        }
        return attrs;
      }
      function attr(element, ...names) {
        for (const name of names) {
          if (element.attrs[name] !== void 0) return element.attrs[name];
          const lower = name.toLowerCase();
          for (const [key, value] of Object.entries(element.attrs)) {
            const local = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
            if (local.toLowerCase() === lower) return value;
          }
        }
        return void 0;
      }
      function openTagPattern(name) {
        return new RegExp(`<([A-Za-z_][\\w.-]*:)?${escapeRegExp(name)}(?=[\\s/>])([^>]*?)(/?)>`, "gi");
      }
      function findCloseIndex(xml, name, from) {
        const pattern = new RegExp(`</([A-Za-z_][\\w.-]*:)?${escapeRegExp(name)}\\s*>`, "i");
        const match = pattern.exec(xml.slice(from));
        return match ? from + match.index : -1;
      }
      function findElements(xml, name) {
        const found = [];
        const pattern = openTagPattern(name);
        let match;
        while ((match = pattern.exec(xml)) !== null) {
          const raw = match[2] ?? "";
          const selfClosing = match[3] === "/" || /\/\s*$/.test(raw);
          const contentStart = match.index + match[0].length;
          if (selfClosing) {
            found.push({
              name: match[1] ? `${match[1]}${name}` : name,
              attrs: parseAttributes(raw.replace(/\/\s*$/, "")),
              inner: "",
              selfClosing: true
            });
            continue;
          }
          const closeIndex = findCloseIndex(xml, name, contentStart);
          const inner = closeIndex === -1 ? xml.slice(contentStart) : xml.slice(contentStart, closeIndex);
          found.push({
            name: match[1] ? `${match[1]}${name}` : name,
            attrs: parseAttributes(raw),
            inner,
            selfClosing: false
          });
        }
        return found;
      }
      function firstText(xml, name) {
        const [element] = findElements(xml, name);
        if (!element) return void 0;
        const text = stripTags(element.inner, { blockBreaks: false }).trim();
        return text.length > 0 ? text : void 0;
      }
      var BLOCK_TAGS = "p|div|br|li|tr|td|th|section|article|blockquote|pre|figcaption|h[1-6]|hr|title|dd|dt";
      function stripTags(html, options = {}) {
        const blockBreaks = options.blockBreaks !== false;
        let text = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(new RegExp(`<(${["script", "style", "head"].join("|")})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, "gi"), "").replace(new RegExp(`<(${["script", "style", "head"].join("|")})\\b[^>]*/>`, "gi"), "");
        if (blockBreaks) {
          text = text.replace(new RegExp(`<\\s*(/\\s*)?(${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
        }
        text = text.replace(/<[^>]*>/g, "").replace(/[ \t\f\v\u00a0]+/g, " ");
        return decodeEntities(text);
      }
      function normalizeParagraphs(text) {
        return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/g, "").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
      }

      // src/client/epub.ts
      function normalizePath(path) {
        const out = [];
        for (const part of path.replace(/\\/g, "/").split("/")) {
          if (part === "" || part === ".") continue;
          if (part === "..") {
            out.pop();
            continue;
          }
          out.push(part);
        }
        return out.join("/");
      }
      function resolveHref(baseDir, href) {
        const withoutFragment = href.split("#")[0].split("?")[0];
        let decoded = withoutFragment;
        try {
          decoded = decodeURIComponent(withoutFragment);
        } catch {
        }
        if (decoded.startsWith("/")) return normalizePath(decoded);
        return normalizePath(baseDir ? `${baseDir}/${decoded}` : decoded);
      }
      function dirOf(path) {
        const index = path.lastIndexOf("/");
        return index === -1 ? "" : path.slice(0, index);
      }
      function findEntry(entries, path) {
        const direct = entries.get(path);
        if (direct) return direct;
        const lower = path.toLowerCase();
        for (const [key, value] of entries) {
          if (key.toLowerCase() === lower) return value;
        }
        return void 0;
      }
      var MEDIA_TYPES = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        bmp: "image/bmp",
        avif: "image/avif"
      };
      function guessMediaType(path) {
        const match = /\.([a-z0-9]+)$/i.exec(path);
        if (!match) return void 0;
        return MEDIA_TYPES[match[1].toLowerCase()];
      }
      var FONT_OBFUSCATION = "embedding";
      function inspectEncryption(encryptionXml) {
        if (!encryptionXml || encryptionXml.trim().length === 0) {
          return { encrypted: false, fontOnly: false, targets: [] };
        }
        const targets = [];
        let allFonts = true;
        for (const data of findElements(encryptionXml, "EncryptedData")) {
          const method = findElements(data.inner, "EncryptionMethod")[0];
          const algorithm = method ? attr(method, "Algorithm") ?? "" : "";
          const reference = findElements(data.inner, "CipherReference")[0];
          const uri = reference ? attr(reference, "URI") ?? "" : "";
          if (uri) targets.push(uri.replace(/^\//, ""));
          const looksLikeFont = algorithm.toLowerCase().includes(FONT_OBFUSCATION) || /\.(otf|ttf|ttc|woff2?|eot)$/i.test(uri);
          if (!looksLikeFont) allFonts = false;
        }
        return { encrypted: true, fontOnly: allFonts && targets.length > 0, targets };
      }
      function parseOpf(xml, opfPath) {
        const manifest = /* @__PURE__ */ new Map();
        for (const element of findElements(xml, "item")) {
          const id = attr(element, "id");
          const href = attr(element, "href");
          if (!id || !href) continue;
          manifest.set(id, {
            id,
            href,
            mediaType: attr(element, "media-type") ?? guessMediaType(href) ?? "",
            properties: attr(element, "properties") ?? ""
          });
        }
        const spineElement = findElements(xml, "spine")[0];
        const spineSource = spineElement ? spineElement.inner : xml;
        const linear = [];
        const nonLinear = [];
        for (const element of findElements(spineSource, "itemref")) {
          const idref = attr(element, "idref");
          if (!idref || !manifest.has(idref)) continue;
          if ((attr(element, "linear") ?? "").toLowerCase() === "no") nonLinear.push(idref);
          else linear.push(idref);
        }
        return {
          title: firstText(xml, "title"),
          opfPath,
          opfDir: dirOf(opfPath),
          manifest,
          // 全是 linear="no" 时（奇形怪状的书）不能把整本书丢空，退回全部项。
          spine: linear.length > 0 ? linear : nonLinear
        };
      }
      function findOpfPath(containerXml, entries) {
        if (containerXml) {
          const rootfile = findElements(containerXml, "rootfile");
          for (const element of rootfile) {
            const fullPath = attr(element, "full-path");
            if (fullPath) return normalizePath(fullPath);
          }
        }
        for (const key of entries.keys()) {
          if (/\.opf$/i.test(key)) return normalizePath(key);
        }
        return void 0;
      }
      var IMAGE_TAG = /<(img|image)\b([^>]*?)(\/?)>/gi;
      function inlineImages(html, resolve) {
        return html.replace(IMAGE_TAG, (_whole, _tag, rawAttrs) => {
          const attrs = parseAttributes(rawAttrs);
          const src = attrs["src"] ?? attrs["xlink:href"] ?? attrs["href"] ?? attrs["data-src"];
          if (!src) return "";
          const index = resolve(src);
          return index === null ? "" : imagePlaceholder(index);
        });
      }
      function bodyOf(xhtml) {
        const [body] = findElements(xhtml, "body");
        return body ? body.inner : xhtml;
      }
      function extractChapterText(xhtml, resolve) {
        return normalizeParagraphs(stripTags(inlineImages(bodyOf(xhtml), resolve)));
      }
      var MAX_TITLE_LENGTH = 120;
      function extractChapterTitle(xhtml, fallback) {
        for (let level = 1; level <= 6; level += 1) {
          const heading = firstText(xhtml, `h${level}`);
          if (heading && heading.length <= MAX_TITLE_LENGTH) return heading;
        }
        const title = firstText(xhtml, "title");
        if (title && title.length <= MAX_TITLE_LENGTH) return title;
        return fallback;
      }
      function readZip(bytes) {
        if (!bytes || bytes.length === 0) return { ok: false, error: "\u8FD9\u4E2A\u6587\u4EF6\u662F\u7A7A\u7684" };
        try {
          const unzipped = unzipSync(bytes);
          const entries = /* @__PURE__ */ new Map();
          for (const [key, value] of Object.entries(unzipped)) {
            entries.set(normalizePath(key), value);
          }
          if (entries.size === 0) return { ok: false, error: "\u8FD9\u4E2A epub \u91CC\u6CA1\u6709\u4EFB\u4F55\u5185\u5BB9" };
          return { ok: true, entries };
        } catch {
          return { ok: false, error: "\u8FD9\u4E2A\u6587\u4EF6\u4E0D\u662F\u6709\u6548\u7684 epub\uFF08\u65E0\u6CD5\u89E3\u538B\uFF0C\u53EF\u80FD\u5DF2\u635F\u574F\u6216\u4E0D\u662F epub\uFF09" };
        }
      }
      function decodeXhtml(bytes) {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
      function parseEpub(bytes, fallbackTitle) {
        const zip = readZip(bytes);
        if (!zip.ok) return zip;
        const { entries } = zip;
        const encryptionXml = findEntry(entries, "META-INF/encryption.xml");
        const encryption = inspectEncryption(encryptionXml ? decodeXhtml(encryptionXml) : void 0);
        if (encryption.encrypted && !encryption.fontOnly) {
          const where = encryption.targets.slice(0, 3).join("\u3001");
          return {
            ok: false,
            error: `\u8FD9\u672C epub \u6709 DRM \u52A0\u5BC6\uFF0C\u65E0\u6CD5\u8BFB\u53D6${where ? `\uFF08\u52A0\u5BC6\u5185\u5BB9\uFF1A${where}\uFF09` : ""}`
          };
        }
        const containerBytes = findEntry(entries, "META-INF/container.xml");
        const opfPath = findOpfPath(containerBytes ? decodeXhtml(containerBytes) : void 0, entries);
        if (!opfPath) return { ok: false, error: "\u8FD9\u672C epub \u7F3A\u5C11\u4E66\u76EE\u4FE1\u606F\uFF08\u627E\u4E0D\u5230 .opf \u6587\u4EF6\uFF09" };
        const opfBytes = findEntry(entries, opfPath);
        if (!opfBytes) return { ok: false, error: "\u8FD9\u672C epub \u7684\u4E66\u76EE\u4FE1\u606F\u5DF2\u635F\u574F\uFF08.opf \u6587\u4EF6\u7F3A\u5931\uFF09" };
        const opf = parseOpf(decodeXhtml(opfBytes), opfPath);
        if (opf.spine.length === 0) return { ok: false, error: "\u8FD9\u672C epub \u6CA1\u6709\u53EF\u8BFB\u7684\u6B63\u6587\uFF08spine \u4E3A\u7A7A\uFF09" };
        const warnings = [];
        if (encryption.fontOnly) warnings.push("\u5B57\u4F53\u5DF2\u52A0\u5BC6\uFF08\u4E0D\u5F71\u54CD\u9605\u8BFB\uFF09");
        const chapters = [];
        for (const idref of opf.spine) {
          const item = opf.manifest.get(idref);
          if (!item) continue;
          const itemPath = resolveHref(opf.opfDir, item.href);
          const itemBytes = findEntry(entries, itemPath);
          if (!itemBytes) {
            warnings.push(`\u7F3A\u5C11\u6B63\u6587\u6587\u4EF6\uFF1A${itemPath}`);
            continue;
          }
          const xhtml = decodeXhtml(itemBytes);
          const baseDir = dirOf(itemPath);
          const images = [];
          const indexByName = /* @__PURE__ */ new Map();
          const resolveImage = (src) => {
            const imagePath = resolveHref(baseDir, src);
            const existing = indexByName.get(imagePath);
            if (existing !== void 0) return existing;
            const manifestItem = findManifestByPath(opf, imagePath);
            const mediaType = manifestItem?.mediaType || guessMediaType(imagePath);
            if (!mediaType || !mediaType.startsWith("image/")) return null;
            const data = findEntry(entries, imagePath);
            if (!data || data.length === 0) return null;
            const index = images.length;
            images.push({ name: imagePath, mediaType, data });
            indexByName.set(imagePath, index);
            return index;
          };
          const text = extractChapterText(xhtml, resolveImage);
          if (text.length === 0 && images.length === 0) continue;
          chapters.push({
            index: chapters.length,
            // 兜底名不拿书名充数：目录里出现一行书名只会让人困惑。
            title: extractChapterTitle(xhtml, `\u7B2C ${chapters.length + 1} \u7AE0`),
            text,
            images
          });
        }
        if (chapters.length === 0) return { ok: false, error: "\u8FD9\u672C epub \u91CC\u6CA1\u6709\u53EF\u8BFB\u7684\u6B63\u6587" };
        return {
          ok: true,
          book: {
            title: opf.title && opf.title.length > 0 ? opf.title : fallbackTitle,
            chapters,
            warnings
          }
        };
      }
      function findManifestByPath(opf, path) {
        for (const item of opf.manifest.values()) {
          if (resolveHref(opf.opfDir, item.href) === path) return item;
        }
        return void 0;
      }

      // src/client/library.ts
      function titleFromFileName(fileName) {
        const withoutExtension = fileName.replace(/\.[^.]+$/, "");
        const cleaned = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
        return cleaned.length > 0 ? cleaned : "\u672A\u547D\u540D\u4E66\u7C4D";
      }
      function formatOf(fileName) {
        return /\.epub$/i.test(fileName) ? "epub" : "txt";
      }
      async function importTxt(db, fileName, bytes) {
        if (!bytes || bytes.length === 0) {
          return { ok: false, error: "\u8FD9\u4E2A\u6587\u4EF6\u6CA1\u6709\u53EF\u8BFB\u5185\u5BB9" };
        }
        const decoded = decodeText(bytes);
        if (decoded.error && decoded.text.trim().length === 0) {
          return { ok: false, error: decoded.error };
        }
        const chapters = splitChapters(decoded.text);
        if (chapters.length === 0) {
          return { ok: false, error: "\u8FD9\u4E2A\u6587\u4EF6\u6CA1\u6709\u53EF\u8BFB\u5185\u5BB9" };
        }
        const book = {
          id: newBookId(),
          title: titleFromFileName(fileName),
          format: "txt",
          encoding: decoded.encoding,
          chapterCount: chapters.length,
          addedAt: Date.now(),
          // 编码可疑时仍然入库（"宁可让你能读，也不要白白丢掉整本书"），但把告警带上。
          warning: decoded.error
        };
        const records = chapters.map((chapter) => ({
          bookId: book.id,
          index: chapter.index,
          title: chapter.title,
          text: chapter.text
        }));
        await putBook(db, book, records);
        return { ok: true, book };
      }
      async function importEpub(db, fileName, bytes) {
        if (!bytes || bytes.length === 0) {
          return { ok: false, error: "\u8FD9\u4E2A\u6587\u4EF6\u6CA1\u6709\u53EF\u8BFB\u5185\u5BB9" };
        }
        const parsed = parseEpub(bytes, titleFromFileName(fileName));
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const book = {
          id: newBookId(),
          title: parsed.book.title,
          format: "epub",
          chapterCount: parsed.book.chapters.length,
          addedAt: Date.now(),
          warning: parsed.book.warnings.length > 0 ? parsed.book.warnings.join("\uFF1B") : void 0
        };
        const records = parsed.book.chapters.map((chapter) => ({
          bookId: book.id,
          index: chapter.index,
          title: chapter.title,
          text: chapter.text,
          // 没有插图时字段整个省略，不存空数组。
          images: chapter.images.length > 0 ? chapter.images : void 0
        }));
        await putBook(db, book, records);
        return { ok: true, book };
      }
      async function importFile(db, fileName, bytes) {
        const format = formatOf(fileName);
        if (format === "epub") return importEpub(db, fileName, bytes);
        return importTxt(db, fileName, bytes);
      }

      // src/client/index.tsx
      var NAME = "dsh-stealth-reader";
      var COMMAND_NAME = "stealth";
      function registry() {
        return globalThis.__STEALTH_READER__STATE__ ??= {};
      }
      function log(entry) {
        const state2 = registry();
        (state2.log ??= []).push(entry);
      }
      function onKeyDown(event) {
        const mode = current();
        const next = resolveInteraction(mode, event);
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        log(`key:${next}`);
        goTo(next);
      }
      function onPointer(event) {
        const mode = current();
        const next = resolveInteraction(mode, event, { listVisible: isListVisible() });
        if (next === null) return;
        log(`pointer:${next}`);
        goTo(next);
      }
      function bindKeys() {
        const state2 = registry();
        const enabled = state2.handleKeys !== false;
        const bound = bindHandlers(window, globalSlots(), {
          keydown: enabled ? onKeyDown : null,
          pointer: enabled ? onPointer : null
        });
        log(bound ? "keys:bound" : "keys:updated");
      }
      function currentSessionEntries(sessions) {
        try {
          const state2 = readSnapshot(sessions?.list);
          const ids = state2?.ids ?? [];
          const current2 = state2?.current;
          const id = current2 && ids.includes(current2) ? current2 : ids[0];
          if (!id) return [];
          const binding = sessions?.binding?.(id);
          return binding?.eventSource?.getSnapshot?.()?.entries ?? [];
        } catch {
          return [];
        }
      }
      function apply(ctx) {
        const state2 = registry();
        state2.sessions = ctx.sessions;
        state2.handleKeys = state2.handleKeys ?? true;
        try {
          ctx.commandUi.register({
            name: COMMAND_NAME,
            description: () => "\u6253\u5F00\u9690\u853D\u9605\u8BFB\u5668",
            available: () => true,
            ui: { kind: "action", run: () => openStream() }
          });
          state2.commandUi = ctx.commandUi;
          console.info(`[${NAME}] \u5DF2\u6CE8\u518C\u5BA2\u6237\u7AEF\u547D\u4EE4 /${COMMAND_NAME}`);
        } catch (cause) {
          state2.commandError = cause?.message ?? String(cause);
          console.warn(`[${NAME}] \u5BA2\u6237\u7AEF\u547D\u4EE4\u6CE8\u518C\u5931\u8D25`, cause);
        }
        bindKeys();
        const app = createApp();
        const readDialogue = () => {
          const real = dialogueFromEntries(currentSessionEntries(state2.sessions));
          if (real.length > 0) return real;
          return DEFAULT_TEMPLATES.map((text) => ({ role: "assistant", text }));
        };
        ctx.slots.inject("shell.overlay", () => {
          const dispose = ctx.slots.register(
            { name: "shell.overlay", id: "stealth-reader", order: 60, label: () => NAME },
            () => React3.createElement(Overlay, {
              stream: React3.createElement(
                AppProvider,
                { api: app },
                React3.createElement(StreamView, { dialogueSource: readDialogue }),
                null
              )
            })
          );
          return typeof dispose === "function" ? dispose : () => dispose?.dispose?.();
        });
        ctx.slots.inject("conversation.input.dock", () => {
          const dispose = ctx.slots.register(
            { name: "conversation.input.dock", id: "stealth-reader-probe", order: 100 },
            () => React3.createElement("div", {
              "data-stealth-reader": "probe",
              style: {
                position: "absolute",
                width: 0,
                height: 0,
                visibility: "hidden",
                pointerEvents: "none"
              }
            })
          );
          return typeof dispose === "function" ? dispose : () => dispose?.dispose?.();
        });
      }
      var dbPromise;
      function getDb() {
        dbPromise ??= openDatabase();
        return dbPromise;
      }
      function createApp() {
        return {
          async listBooks() {
            return listBooks(await getDb());
          },
          async listProgress() {
            const db = await getDb();
            const books = await listBooks(db);
            const found = await Promise.all(
              books.map(async (book) => ({ id: book.id, record: await getProgress(db, book.id) }))
            );
            const map = {};
            for (const entry of found) {
              if (entry.record) map[entry.id] = entry.record;
            }
            return map;
          },
          async importFile(file) {
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const result = await importFile(await getDb(), file.name, bytes);
              if (result.ok) {
                console.info(
                  `[${NAME}] \u5DF2\u5BFC\u5165\u300A${result.book.title}\u300B\uFF1A${result.book.chapterCount} \u7AE0` + (result.book.warning ? `\uFF08${result.book.warning}\uFF09` : "")
                );
                return { ok: true };
              }
              console.warn(`[${NAME}] \u5BFC\u5165\u5931\u8D25\uFF1A${result.error}`);
              return { ok: false, error: result.error };
            } catch (cause) {
              const message = cause?.message ?? String(cause);
              console.warn(`[${NAME}] \u5BFC\u5165\u5F02\u5E38`, cause);
              return { ok: false, error: message };
            }
          },
          async deleteBook(bookId) {
            await deleteBook(await getDb(), bookId);
          },
          async getChapter(bookId, index) {
            return getChapter(await getDb(), bookId, index);
          },
          async listChapterTitles(bookId) {
            return listChapterTitles(await getDb(), bookId);
          },
          async putProgress(progress) {
            await putProgress(await getDb(), progress);
          }
        };
      }
      var DEFAULT_TEMPLATES = [
        "Analyzing repository structure\u2026",
        "Reading 42 files \xB7 12,480 lines",
        "Running test suite\u2026",
        "Applying patch to 3 files",
        "Generating diff\u2026"
      ];
      globalThis.__STEALTH_READER__ = {
        name: NAME,
        inject: ["slots", "commandUi", "sessions"],
        apply
      };
    })();

    var plugin = globalThis.__STEALTH_READER__;
    if (!plugin || typeof plugin.apply !== "function") {
      throw new Error("dsh-stealth-reader" + ": client bundle did not publish its plugin contract");
    }
    return plugin;
  }
});
