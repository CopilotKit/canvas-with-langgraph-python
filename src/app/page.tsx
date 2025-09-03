"use client";

import { useCoAgent, useCopilotAction, useCoAgentStateRender, useCopilotAdditionalInstructions, useLangGraphInterrupt } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotChat, CopilotPopup, useChatContext, HeaderProps } from "@copilotkit/react-ui";
import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, X } from "lucide-react"
import ShikiHighlighter from "react-shiki/web";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";

function NewItemMenu({ onSelect, align = "end", className }: { onSelect: (t: CardType) => void; align?: "start" | "end" | "center", className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="default" className={cn("gap-2 text-base font-semibold bg-card rounded-lg",
          // "hover:bg-accent/10 hover:border-accent hover:text-accent",
          className)}>
          <Plus className="size-5" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-0 w-fit bg-background">
        <DropdownMenuItem onClick={() => onSelect("project")}>Project</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("entity")}>Entity</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("note")}>Note</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("chart")}>Chart</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  proposed: boolean;
}

interface LinkItem {
  title: string;
  url: string;
}

type CardType = "project" | "entity" | "note" | "chart";

interface ProjectData {
  field1: string; // text
  field2: string; // select
  field3: string; // date
  field4: ChecklistItem[]; // checklist
  field4_id: number; // id counter
}

interface EntityData {
  field1: string; // text
  field2: string; // select
  field3: string[]; // tags
  field3_options: string[]; // options
}

interface NoteData {
  field1?: string; // textarea
}

interface ChartMetric {
  id: string;
  label: string;
  value: number | ""; // 0..100
}

interface ChartData {
  field1: ChartMetric[]; // metrics
  field1_id: number; // id counter
}

type ItemData = ProjectData | EntityData | NoteData | ChartData;

interface Item {
  id: string;
  type: CardType;
  name: string; // editable title
  subtitle: string; // subtitle shown under the title
  data: ItemData;
}

interface AgentState {
  items: Item[];
  globalTitle: string;
  globalDescription: string;
  activeItemId: string | null;
  lastAction?: string;
  itemsCreated: number;
}

const initialState: AgentState = {
  items: [],
  globalTitle: "",
  globalDescription: "",
  activeItemId: null,
  lastAction: "",
  itemsCreated: 0,
};

// Shared pure update helpers (used by UI and Copilot actions)
function projectAddField4Item(data: ProjectData, text?: string): { next: ProjectData; createdId: string } {
  const existing = data.field4 ?? [];
  const nextCount = (data.field4_id ?? 0) + 1;
  const id = String(nextCount).padStart(3, "0");
  const next = [...existing, { id, text: text ?? "", done: false, proposed: false }];
  return { next: { ...data, field4: next, field4_id: nextCount }, createdId: id };
}

function projectSetField4ItemText(data: ProjectData, checklistItemId: string, text: string): ProjectData {
  const next = (data.field4 ?? []).map((item) => (item.id === checklistItemId ? { ...item, text } : item));
  return { ...data, field4: next } as ProjectData;
}

function projectSetField4ItemDone(data: ProjectData, checklistItemId: string, done: boolean): ProjectData {
  const next = (data.field4 ?? []).map((item) => (item.id === checklistItemId ? { ...item, done } : item));
  return { ...data, field4: next } as ProjectData;
}

function projectRemoveField4Item(data: ProjectData, checklistItemId: string): ProjectData {
  const next = (data.field4 ?? []).filter((item) => item.id !== checklistItemId);
  return { ...data, field4: next } as ProjectData;
}

function chartAddField1Metric(data: ChartData, label?: string, value?: number | ""): { next: ChartData; createdId: string } {
  const existing = data.field1 ?? [];
  const nextCount = (data.field1_id ?? 0) + 1;
  const id = String(nextCount).padStart(3, "0");
  const safe: number | "" = typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : value === "" ? "" : 0;
  const next = [...existing, { id, label: label ?? "", value: safe }];
  return { next: { ...data, field1: next, field1_id: nextCount }, createdId: id };
}

function chartSetField1Label(data: ChartData, index: number, label: string): ChartData {
  const next = [...(data.field1 ?? [])];
  if (index >= 0 && index < next.length) {
    next[index] = { ...next[index], label };
    return { ...data, field1: next } as ChartData;
  }
  return data;
}

function chartSetField1Value(data: ChartData, index: number, value: number | ""): ChartData {
  const next = [...(data.field1 ?? [])];
  if (index >= 0 && index < next.length) {
    if (value === "") {
      next[index] = { ...next[index], value: "" };
    } else {
      const clamped = Math.max(0, Math.min(100, value));
      next[index] = { ...next[index], value: clamped };
    }
    return { ...data, field1: next } as ChartData;
  }
  return data;
}

function chartRemoveField1Metric(data: ChartData, index: number): ChartData {
  const next = [...(data.field1 ?? [])];
  if (index >= 0 && index < next.length) {
    next.splice(index, 1);
    return { ...data, field1: next } as ChartData;
  }
  return data;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return;
    const mediaQueryList = window.matchMedia(query);
    const updateMatch = () => setMatches(mediaQueryList.matches);
    updateMatch();
    mediaQueryList.addEventListener("change", updateMatch);
    return () => mediaQueryList.removeEventListener("change", updateMatch);
  }, [query]);

  return matches;
}

function AppChatHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="p-4 border-b border-sidebar-border">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-accent/10 text-sidebar-primary-foreground">
              <span>🪁</span>
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-bold text-sidebar-foreground">CopilotKit Canvas</h3>
            <div className="flex items-center gap-x-1.5 text-xs text-muted-foreground">
              <div className="inline-block size-1.5 rounded-full bg-green-500" />
              <div>Online <span className="opacity-50 text-[90%] select-none">•</span> Ready to help</div>
            </div>
          </div>
        </div>
        {typeof onClose === "function" && (
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground hover:bg-accent/10"
            onClick={() => onClose?.()}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function PopupHeader({}: HeaderProps) {
  const { setOpen } = useChatContext();
  return <AppChatHeader onClose={() => setOpen(false)} />;
}

export default function CopilotKitPage() {
  const { state, setState, running, run } = useCoAgent<AgentState>({
    name: "sample_agent",
    initialState,
  });

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [showJsonView, setShowJsonView] = useState<boolean>(false);
  

  

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[CoAgent state updated]", state);
  }, [JSON.stringify(state)]);

  // Reset JSON view when there are no items
  useEffect(() => {
    const itemsCount = (state?.items ?? []).length;
    if (itemsCount === 0 && showJsonView) {
      setShowJsonView(false);
    }
  }, [state?.items?.length, showJsonView]);

  // CSS scroll-driven animations handle fade and interactivity.

  useCoAgentStateRender<AgentState>({
    name: "sample_agent",
    render: ({ state }) => {
      const items = state?.items ?? initialState.items;
      const globalTitle = state?.globalTitle ?? initialState.globalTitle;
      const globalDescription = state?.globalDescription ?? initialState.globalDescription;
      return (
        <pre className="whitespace-pre-wrap text-xs text-violet-600 font-mono w-full overflow-hidden">
          {JSON.stringify({
            items,
            globalTitle,
            globalDescription,
          }, null, 2)}
        </pre>
      );
    },
  });

  // Strengthen grounding: always prefer shared state over chat history
  useCopilotAdditionalInstructions({
    instructions: (() => {
      const items = state?.items ?? initialState.items;
      const gTitle = state?.globalTitle ?? "";
      const gDesc = state?.globalDescription ?? "";
      const summary = items
        .slice(0, 5)
        .map((p: Item) => `id=${p.id} • name=${p.name} • type=${p.type}`)
        .join("\n");
      const fieldSchema = [
        "FIELD SCHEMA (authoritative):",
        "- project.data:",
        "  - field1: string (text)",
        "  - field2: string (select: 'Option A' | 'Option B' | 'Option C')",
        "  - field3: string (date 'YYYY-MM-DD')",
        "  - field4: ChecklistItem[] where ChecklistItem={id: string, text: string, done: boolean, proposed: boolean}",
        "- entity.data:",
        "  - field1: string",
        "  - field2: string (select: 'Option A' | 'Option B' | 'Option C')",
        "  - field3: string[] (selected tags; subset of field3_options)",
        "  - field3_options: string[] (available tags)",
        "- note.data:",
        "  - field1: string (textarea)",
        "- chart.data:",
        "  - field1: Array<{id: string, label: string, value: number | ''}> with value in [0..100] or ''",
      ].join("\n");
      const toolUsageHints = [
        "TOOL USAGE HINTS:",
        "- Prefer calling specific actions: setProjectField1, setProjectField2, setProjectField3, addProjectChecklistItem, setProjectChecklistItem, removeProjectChecklistItem.",
        "- field2 must be one of 'Option A' | 'Option B' | 'Option C'.",
        "- field3 accepts natural dates (e.g., 'tomorrow', '2025-01-30'); it will be normalized to YYYY-MM-DD.",
        "- Checklist edits accept either the generated id (e.g., '001') or a numeric index (e.g., '1', 1-based).",
        "- For charts, values are clamped to [0..100]; empty string clears.",
        "LOOP CONTROL: When asked to 'add a couple' items, add at most 2 and stop. Avoid repeated calls to the same mutating tool in one turn.",
        "RANDOMIZATION: If the user specifically asks for random/mock values, you MAY generate and set them right away using the tools (do not block for more details).",
        "VERIFICATION: After tools run, re-read the latest state and confirm what actually changed.",
      ].join("\n");
      return [
        "ALWAYS ANSWER FROM SHARED STATE (GROUND TRUTH).",
        "If a command does not specify which item to change, ask the user to clarify before proceeding.",
        `Global Title: ${gTitle || "(none)"}`,
        `Global Description: ${gDesc || "(none)"}`,
        "Items (sample):",
        summary || "(none)",
        fieldSchema,
        toolUsageHints,
      ].join("\n");
    })(),
  });

  // HITL: dropdown selector for item choice using LangGraph interrupt
  useLangGraphInterrupt({
    enabled: ({ eventValue }) => {
      try {
        return typeof eventValue === "object" && eventValue?.type === "choose_item";
      } catch {
        return false;
      }
    },
    render: ({ event, resolve }) => {
      const items = state?.items ?? initialState.items;
      if (!items.length) {
        return (
          <div className="rounded-md border bg-white p-4 text-sm shadow">
            <p>No items available.</p>
            <button
              className="mt-3 rounded border px-3 py-1"
              onClick={() => resolve("")}
            >
              Close
            </button>
          </div>
        );
      }
      let selectedId = items[0].id;
      return (
        <div className="rounded-md border bg-white p-4 text-sm shadow">
          <p className="mb-2 font-medium">Select an item</p>
          <p className="mb-3 text-xs text-gray-600">{(event?.value as any)?.content ?? "Which item should I use?"}</p>
          <select
            className="w-full rounded border px-2 py-1"
            defaultValue={selectedId}
            onChange={(e) => {
              selectedId = e.target.value;
            }}
          >
            {items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
          <div className="mt-3 flex justify-end gap-2">
            <button
              className="rounded border px-3 py-1"
              onClick={() => resolve("")}
            >
              Cancel
            </button>
            <button
              className="rounded border bg-blue-600 px-3 py-1 text-white"
              onClick={() => resolve(selectedId)}
            >
              Use item
            </button>
          </div>
        </div>
      );
    },
  });

  // HITL: choose a card type when not specified
  useLangGraphInterrupt({
    enabled: ({ eventValue }) => {
      try {
        return typeof eventValue === "object" && eventValue?.type === "choose_card_type";
      } catch {
        return false;
      }
    },
    render: ({ event, resolve }) => {
      const options: { id: CardType; label: string }[] = [
        { id: "project", label: "Project" },
        { id: "entity", label: "Entity" },
        { id: "note", label: "Note" },
        { id: "chart", label: "Chart" },
      ];
      let selected: CardType | "" = "";
      return (
        <div className="rounded-md border bg-white p-4 text-sm shadow">
          <p className="mb-2 font-medium">Select a card type</p>
          <p className="mb-3 text-xs text-gray-600">{(event?.value as any)?.content ?? "Which type of card should I create?"}</p>
          <select
            className="w-full rounded border px-2 py-1"
            defaultValue=""
            onChange={(e) => {
              selected = e.target.value as CardType;
            }}
          >
            <option value="" disabled>Select an item type…</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded border px-3 py-1" onClick={() => resolve("")}>Cancel</button>
            <button
              className="rounded border bg-blue-600 px-3 py-1 text-white"
              onClick={() => selected && resolve(selected)}
              disabled={!selected}
            >
              Use type
            </button>
          </div>
        </div>
      );
    },
  });

  const updateItem = useCallback(
    (itemId: string, updates: Partial<Item>) => {
      setState((prev) => {
        const base = prev ?? initialState;
        const items: Item[] = base.items ?? [];
        const nextItems = items.map((p) => (p.id === itemId ? { ...p, ...updates } : p));
        return { ...base, items: nextItems } as AgentState;
      });
    },
    [setState]
  );

  const updateItemData = useCallback(
    (itemId: string, updater: (prev: ItemData) => ItemData) => {
      setState((prev) => {
        const base = prev ?? initialState;
        const items: Item[] = base.items ?? [];
        const nextItems = items.map((p) => (p.id === itemId ? { ...p, data: updater(p.data) } : p));
        return { ...base, items: nextItems } as AgentState;
      });
    },
    [setState]
  );

  const deleteItem = useCallback((itemId: string) => {
    setState((prev) => {
      const base = prev ?? initialState;
      const existed = (base.items ?? []).some((p) => p.id === itemId);
      const items: Item[] = (base.items ?? []).filter((p) => p.id !== itemId);
      const activeItemId = base.activeItemId === itemId ? null : base.activeItemId;
      return { ...base, items, activeItemId, lastAction: existed ? `deleted:${itemId}` : `not_found:${itemId}` } as AgentState;
    });
  }, [setState]);

  // Checklist item local helper removed; Copilot actions handle checklist CRUD

  const toggleTag = useCallback((itemId: string, tag: string) => {
    updateItemData(itemId, (prev) => {
      const anyPrev = prev as any;
      if (Array.isArray(anyPrev.field3)) {
        const selected = new Set<string>(anyPrev.field3 ?? []);
        if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
        return { ...anyPrev, field3: Array.from(selected) } as ItemData;
      }
      return prev;
    });
  }, [updateItemData]);

  // Remove checklist item local helper removed; use Copilot action instead

  // Helper to generate default data by type
  const defaultDataFor = useCallback((type: CardType): ItemData => {
    switch (type) {
      case "project":
        return {
          field1: "",
          field2: "",
          field3: "",
          field4: [],
          field4_id: 0,
        } as ProjectData;
      case "entity":
        return {
          field1: "",
          field2: "",
          field3: [],
          field3_options: ["Tag 1", "Tag 2", "Tag 3"],
        } as EntityData;
      case "note":
        return { field1: "" } as NoteData;
      case "chart":
        return { field1: [], field1_id: 0 } as ChartData;
      default:
        return { content: "" } as NoteData;
    }
  }, []);

  const addItem = useCallback((type: CardType, name?: string) => {
    const t: CardType = type;
    let newId = "";
    setState((prev) => {
      const base = prev ?? initialState;
      const items: Item[] = base.items ?? [];
      const nextCount = (base.itemsCreated ?? 0) + 1;
      newId = String(nextCount).padStart(4, "0");
      const item: Item = {
        id: newId,
        type: t,
        name: name && name.trim() ? name.trim() : "",
        subtitle: "",
        data: defaultDataFor(t),
      };
      const nextItems = [...items, item];
      return { ...base, items: nextItems, activeItemId: newId, itemsCreated: nextCount } as AgentState;
    });
    return newId;
  }, [defaultDataFor, setState]);

  const setActiveItem = useCallback((itemId: string) => {
    setState((prev) => {
      const base = prev ?? initialState;
      return { ...base, activeItemId: itemId } as AgentState;
    });
  }, [setState]);

  // Frontend Actions (exposed as tools to the agent via CopilotKit)
  useCopilotAction({
    name: "setGlobalTitle",
    description: "Set the global title/name (outside of items).",
    available: "remote",
    parameters: [
      { name: "title", type: "string", required: true, description: "The new global title/name." },
    ],
    handler: ({ title }: { title: string }) => {
      setState((prev) => ({ ...(prev ?? initialState), globalTitle: title }));
    },
  });

  useCopilotAction({
    name: "setGlobalDescription",
    description: "Set the global description/subtitle (outside of items).",
    available: "remote",
    parameters: [
      { name: "description", type: "string", required: true, description: "The new global description/subtitle." },
    ],
    handler: ({ description }: { description: string }) => {
      setState((prev) => ({ ...(prev ?? initialState), globalDescription: description }));
    },
  });

  // Frontend Actions (item-scoped)
  useCopilotAction({
    name: "setItemName",
    description: "Set an item's name/title.",
    available: "remote",
    parameters: [
      { name: "name", type: "string", required: true, description: "The new item name/title." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ name, itemId }: { name: string; itemId: string }) => {
      updateItem(itemId, { name });
    },
  });

  // Set item subtitle
  useCopilotAction({
    name: "setItemSubtitle",
    description: "Set an item's subtitle (short description).",
    available: "remote",
    parameters: [
      { name: "subtitle", type: "string", required: true, description: "The new item subtitle." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ subtitle, itemId }: { subtitle: string; itemId: string }) => {
      updateItem(itemId, { subtitle });
    },
  });

  useCopilotAction({
    name: "setItemDescription",
    description: "Set an item's description/subtitle.",
    available: "remote",
    parameters: [
      { name: "description", type: "string", required: true, description: "The new item description/subtitle (note only)." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ description, itemId }: { description: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        if ((prev as NoteData).field1 !== undefined) {
          return { ...(prev as NoteData), field1: description } as NoteData;
        }
        return prev;
      });
    },
  });

  // Note-specific field updates (field numbering)
  useCopilotAction({
    name: "setNoteField1",
    description: "Update note field1 (textarea).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New content for field1." },
      { name: "itemId", type: "string", required: true, description: "Target item id (note)." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const nd = prev as NoteData;
        if (Object.prototype.hasOwnProperty.call(nd, "field1")) {
          return { ...(nd as NoteData), field1: value } as NoteData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "appendNoteField1",
    description: "Append text to note field1 (textarea).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "Text to append." },
      { name: "itemId", type: "string", required: true, description: "Target item id (note)." },
      { name: "withNewline", type: "boolean", required: false, description: "If true, prefix with a newline." },
    ],
    handler: ({ value, itemId, withNewline }: { value: string; itemId: string; withNewline?: boolean }) => {
      updateItemData(itemId, (prev) => {
        const nd = prev as NoteData;
        if (Object.prototype.hasOwnProperty.call(nd, "field1")) {
          const existing = (nd.field1 ?? "");
          const next = existing + (withNewline ? "\n" : "") + value;
          return { ...(nd as NoteData), field1: next } as NoteData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "clearNoteField1",
    description: "Clear note field1 (textarea) content.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (note)." },
    ],
    handler: ({ itemId }: { itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const nd = prev as NoteData;
        if (Object.prototype.hasOwnProperty.call(nd, "field1")) {
          return { ...(nd as NoteData), field1: "" } as NoteData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "setProjectField1",
    description: "Update project field1 (text).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field1." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      const safeValue = String((value as unknown as string) ?? "");
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as any;
        if (typeof anyPrev.field1 === "string") {
          return { ...anyPrev, field1: safeValue } as ItemData;
        }
        return prev;
      });
    },
  });

  // Project-specific field updates
  useCopilotAction({
    name: "setProjectField2",
    description: "Update project field2 (select).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field2." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      const safeValue = String((value as unknown as string) ?? "");
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as any;
        if (typeof anyPrev.field2 === "string") {
          return { ...anyPrev, field2: safeValue } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "setProjectField3",
    description: "Update project field3 (date, YYYY-MM-DD).",
    available: "remote",
    parameters: [
      { name: "date", type: "string", required: true, description: "Date in YYYY-MM-DD format." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: (args: { date?: string; itemId: string } & Record<string, unknown>) => {
      const itemId = String(args.itemId);
      const rawInput = (args as any).date ?? (args as any).value ?? (args as any).val ?? (args as any).text;
      const normalizeDate = (input: unknown): string | null => {
        if (input == null) return null;
        if (input instanceof Date && !isNaN(input.getTime())) {
          const yyyy = input.getUTCFullYear();
          const mm = String(input.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(input.getUTCDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        }
        const asString = String(input);
        // Already in YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
        const parsed = new Date(asString);
        if (!isNaN(parsed.getTime())) {
          const yyyy = parsed.getUTCFullYear();
          const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(parsed.getUTCDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        }
        return null;
      };
      const normalized = normalizeDate(rawInput);
      if (!normalized) return;
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as any;
        if (typeof anyPrev.field3 === "string") {
          return { ...anyPrev, field3: normalized } as ItemData;
        }
        return prev;
      });
    },
  });

  // Project field4 (checklist) CRUD
  useCopilotAction({
    name: "addProjectChecklistItem",
    description: "Add a new checklist item to a project.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (project)." },
      { name: "text", type: "string", required: false, description: "Initial checklist text (optional)." },
    ],
    handler: ({ itemId, text }: { itemId: string; text?: string }) => {
      let createdId = "";
      updateItemData(itemId, (prev) => {
        const { next, createdId: id } = projectAddField4Item(prev as ProjectData, text);
        createdId = id;
        return next;
      });
      return createdId;
    },
  });

  useCopilotAction({
    name: "setProjectChecklistItem",
    description: "Update a project's checklist item text and/or done state.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (project)." },
      { name: "checklistItemId", type: "string", required: true, description: "Checklist item id." },
      { name: "text", type: "string", required: false, description: "New text (optional)." },
      { name: "done", type: "boolean", required: false, description: "Done status (optional)." },
    ],
    handler: (args: any) => {
      const itemId = String(args.itemId ?? "");
      let target = args.checklistItemId ?? args.id ?? args.index;
      let targetId = target != null ? String(target) : "";
      const maybeDone = args.done;
      const text: string | undefined = args.text != null ? String(args.text) : undefined;
      const toBool = (v: unknown): boolean | undefined => {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
          const s = v.trim().toLowerCase();
          if (s === "true") return true;
          if (s === "false") return false;
        }
        return undefined;
      };
      const done = toBool(maybeDone);
      updateItemData(itemId, (prev) => {
        let next = prev as ProjectData;
        const list = (next.field4 ?? []);
        // If a plain numeric was provided, allow using it as index (0- or 1-based)
        if (!list.some((c) => c.id === targetId) && /^\d+$/.test(targetId)) {
          const n = parseInt(targetId, 10);
          let idx = -1;
          if (n >= 0 && n < list.length) idx = n; // 0-based
          else if (n > 0 && n - 1 < list.length) idx = n - 1; // 1-based
          if (idx >= 0) targetId = list[idx].id;
        }
        if (typeof text === "string") next = projectSetField4ItemText(next, targetId, text);
        if (typeof done === "boolean") next = projectSetField4ItemDone(next, targetId, done);
        return next;
      });
    },
  });

  useCopilotAction({
    name: "removeProjectChecklistItem",
    description: "Remove a checklist item from a project by id.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (project)." },
      { name: "checklistItemId", type: "string", required: true, description: "Checklist item id to remove." },
    ],
    handler: ({ itemId, checklistItemId }: { itemId: string; checklistItemId: string }) => {
      updateItemData(itemId, (prev) => projectRemoveField4Item(prev as ProjectData, checklistItemId));
    },
  });

  // Entity field updates and field3 (tags)
  useCopilotAction({
    name: "setEntityField1",
    description: "Update entity field1 (text).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field1." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as any;
        if (typeof anyPrev.field1 === "string") {
          return { ...anyPrev, field1: value } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "setEntityField2",
    description: "Update entity field2 (select).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field2." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as any;
        if (typeof anyPrev.field2 === "string") {
          return { ...anyPrev, field2: value } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "addEntityField3",
    description: "Add a tag to entity field3 (tags) if not present.",
    available: "remote",
    parameters: [
      { name: "tag", type: "string", required: true, description: "Tag to add." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ tag, itemId }: { tag: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const e = prev as EntityData;
        const current = new Set<string>((e.field3 ?? []) as string[]);
        current.add(tag);
        return { ...e, field3: Array.from(current) } as EntityData;
      });
    },
  });

  useCopilotAction({
    name: "removeEntityField3",
    description: "Remove a tag from entity field3 (tags) if present.",
    available: "remote",
    parameters: [
      { name: "tag", type: "string", required: true, description: "Tag to remove." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ tag, itemId }: { tag: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const e = prev as EntityData;
        return { ...e, field3: ((e.field3 ?? []) as string[]).filter((t) => t !== tag) } as EntityData;
      });
    },
  });

  // Chart field1 (metrics) CRUD
  useCopilotAction({
    name: "addChartField1",
    description: "Add a new metric (field1 entries).",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "label", type: "string", required: false, description: "Metric label (optional)." },
      { name: "value", type: "number", required: false, description: "Metric value 0..100 (optional)." },
    ],
    handler: ({ itemId, label, value }: { itemId: string; label?: string; value?: number }) => {
      let createdId = "";
      updateItemData(itemId, (prev) => {
        const { next, createdId: id } = chartAddField1Metric(prev as ChartData, label, value);
        createdId = id;
        return next;
      });
      return createdId;
    },
  });

  useCopilotAction({
    name: "setChartField1Label",
    description: "Update chart field1 entry label by index.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "index", type: "number", required: true, description: "Metric index (0-based)." },
      { name: "label", type: "string", required: true, description: "New metric label." },
    ],
    handler: ({ itemId, index, label }: { itemId: string; index: number; label: string }) => {
      updateItemData(itemId, (prev) => chartSetField1Label(prev as ChartData, index, label));
    },
  });

  useCopilotAction({
    name: "setChartField1Value",
    description: "Update chart field1 entry value by index (0..100).",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "index", type: "number", required: true, description: "Metric index (0-based)." },
      { name: "value", type: "number", required: true, description: "Metric value 0..100." },
    ],
    handler: ({ itemId, index, value }: { itemId: string; index: number; value: number }) => {
      updateItemData(itemId, (prev) => chartSetField1Value(prev as ChartData, index, value));
    },
  });

  useCopilotAction({
    name: "removeChartField1",
    description: "Remove a chart field1 entry by index.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "index", type: "number", required: true, description: "Metric index (0-based)." },
    ],
    handler: ({ itemId, index }: { itemId: string; index: number }) => {
      updateItemData(itemId, (prev) => chartRemoveField1Metric(prev as ChartData, index));
    },
  });

  useCopilotAction({
    name: "createItem",
    description: "Create a new item.",
    available: "remote",
    parameters: [
      { name: "type", type: "string", required: true, description: "One of: project, entity, note, chart." },
      { name: "name", type: "string", required: false, description: "Optional item name." },
    ],
    handler: ({ type, name }: { type: string; name?: string }) => {
      const t = (type as CardType);
      addItem(t, name);
    },
  });

  // Frontend action: delete an item by id
  useCopilotAction({
    name: "deleteItem",
    description: "Delete an item by id.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ itemId }: { itemId: string }) => {
      const existed = (state?.items ?? initialState.items).some((p) => p.id === itemId);
      deleteItem(itemId);
      return existed ? `deleted:${itemId}` : `not_found:${itemId}`;
    },
  });

  const titleClasses = cn(
    /* base styles */
    "w-full outline-none rounded-md px-2 py-1",
    "bg-transparent placeholder:text-gray-400",
    "ring-1 ring-transparent transition-all ease-out",
    /* hover styles */
    "hover:ring-border",
    /* focus styles */
    "focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10",
    "focus:shadow-accent focus:placeholder:text-accent/65 focus:text-accent",
  );

  return (
    <div
      style={{ "--copilot-kit-primary-color": "#2563eb" } as CopilotKitCSSProperties}
      className="h-screen flex flex-col"
    >
      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat Sidebar */}
        <aside className="-order-1 max-md:hidden flex flex-col min-w-80 w-[30vw] max-w-120 p-4 pr-0">
          <div className="h-full flex flex-col align-start w-full shadow-lg rounded-2xl border border-sidebar-border overflow-hidden">
            {/* Chat Header */}
            <AppChatHeader />
            {/* Chat Content - conditionally rendered to avoid duplicate rendering */}
            {isDesktop && (
              <CopilotChat
                className="flex-1 overflow-auto w-full"
                labels={{
                  title: "Agent",
                  initial:
                    "👋 Share a brief or ask to extract fields. Changes will sync with the canvas in real time.",
                }}
                suggestions={[
                  {
                    title: "Add a Project",
                    message: "Create a new project.",
                  },
                  {
                    title: "Add an Entity",
                    message: "Create a new entity.",
                  },
                  {
                    title: "Add a Note",
                    message: "Create a new note.",
                  },
                  {
                    title: "Add a Chart",
                    message: "Create a new chart.",
                  },
                ]}
              />
            )}
          </div>
        </aside>
        {/* Main Content */}
        <main className="relative flex flex-1 h-full">
          <div className="relative overflow-auto size-full px-4 sm:px-8 md:px-10 py-4">
            <div className={cn(
              "relative mx-auto max-w-7xl h-full min-h-8",
              (showJsonView || (state?.items ?? []).length === 0) && "flex flex-col",
            )}>
              {/* Global Title & Description (hidden in JSON view) */}
              {!showJsonView && (
                <div className="sticky top-0 mb-6 scroll-fade-heading">
                  <input
                    value={state?.globalTitle ?? initialState.globalTitle}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setState((prev) => ({ ...(prev ?? initialState), globalTitle: e.target.value }))
                    }
                    placeholder="Canvas title..."
                    className={cn(titleClasses, "text-2xl font-semibold")}
                  />
                  <input
                    value={state?.globalDescription ?? initialState.globalDescription}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setState((prev) => ({ ...(prev ?? initialState), globalDescription: e.target.value }))
                    }
                    placeholder="Canvas description..."
                    className={cn(titleClasses, "mt-2 text-sm leading-6 resize-none overflow-hidden")}
                  />
                </div>
              )}
              {(state?.items ?? []).length === 0 ? (
                <EmptyState className="flex-1">
                  <div className="mx-auto max-w-lg text-center">
                    <h2 className="text-lg font-semibold text-foreground">Nothing here yet</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Create your first item to get started.</p>
                    <div className="mt-6 flex justify-center">
                      <NewItemMenu onSelect={(t: CardType) => addItem(t)} align="center" className="md:h-10" />
                    </div>
                  </div>
                </EmptyState>
              ) : (
                <div className="flex-1 py-0 overflow-hidden">
                  {showJsonView ? (
                    <div className="pb-16 size-full">
                      <div className="rounded-2xl border shadow-sm bg-card size-full overflow-auto max-md:text-sm">
                        <ShikiHighlighter language="json" theme="github-light">
                          {JSON.stringify({
                            items: state?.items ?? initialState.items,
                            globalTitle: state?.globalTitle ?? initialState.globalTitle,
                            globalDescription: state?.globalDescription ?? initialState.globalDescription,
                          }, null, 2)}
                        </ShikiHighlighter>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-6 lg:grid-cols-2 pb-20">
                      {(state?.items ?? initialState.items).map((item) => (
                        <article key={item.id} className="relative rounded-2xl border p-5 shadow-sm transition-colors ease-out bg-card hover:border-accent/40 focus-within:border-accent/60">
                          <button
                            type="button"
                            aria-label="Delete card"
                            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-card text-gray-400 hover:bg-accent/10 hover:text-accent transition-colors"
                            onClick={() => deleteItem(item.id)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <ItemHeader
                            id={item.id}
                            name={item.name}
                            subtitle={item.subtitle}
                            description={""}
                            onNameChange={(v) => updateItem(item.id, { name: v })}
                            onSubtitleChange={(v) => updateItem(item.id, { subtitle: v })}
                            onDescriptionChange={(v) => updateItemData(item.id, (prev) => prev)}
                          />

                          <div className="mt-6">
                            <CardRenderer item={item} onUpdateData={(updater) => updateItemData(item.id, updater)} onToggleTag={(tag) => toggleTag(item.id, tag)} />
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {(state?.items ?? []).length > 0 ? (
            <div className={cn(
              "absolute left-1/2 -translate-x-1/2 bottom-4",
              "inline-flex rounded-lg shadow-lg bg-card",
              "[&_button]:bg-card [&_button]:w-22 md:[&_button]:h-10",
              "[&_button]:shadow-none! [&_button]:hover:bg-accent",
              "[&_button]:hover:border-accent [&_button]:hover:text-accent",
              "[&_button]:hover:bg-accent/10!",
            )}>
              <NewItemMenu
                onSelect={(t: CardType) => addItem(t)}
                align="center"
                className="rounded-r-none border-r-0 peer"
              />
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "gap-1.25 text-base font-semibold rounded-l-none",
                  "peer-hover:border-l-accent!",
                )}
                onClick={() => setShowJsonView((v) => !v)}
              >
                {showJsonView
                  ? "Canvas"
                  : <>JSON</>
                }
              </Button>
            </div>
          ) : null}
        </main>
      </div>
      <div className="md:hidden">
        {/* Mobile Chat Popup - conditionally rendered to avoid duplicate rendering */}
        {!isDesktop && (
          <CopilotPopup
            Header={PopupHeader}
            labels={{
              title: "Agent",
              initial:
                "👋 Share a brief or ask to extract fields. Changes will sync with the canvas in real time.",
            }}
            suggestions={[
              {
                title: "Add a Project",
                message: "Create a new project.",
              },
              {
                title: "Add an Entity",
                message: "Create a new entity.",
              },
              {
                title: "Add a Note",
                message: "Create a new note.",
              },
              {
                title: "Add a Chart",
                message: "Create a new chart.",
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function ItemHeader(props: {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  onNameChange: (value: string) => void;
  onSubtitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onNameCommit?: (value: string) => void;
  onDescriptionCommit?: (value: string) => void;
}) {
  const { id, name, subtitle, description, onNameChange, onSubtitleChange, onDescriptionChange, onNameCommit, onDescriptionCommit } = props;
  return (
    <div className="mb-4">
      <div className="mb-2">
        <span className="rounded-sm border border-dashed border-foreground/25 px-1 py-0.5 text-xs font-mono text-muted-foreground/50">
          <span className="font-medium">ID:</span><span className="-tracking-widest"> </span><span className="tracking-wide">{id}</span>
        </span>
      </div>
      <input
        value={name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onNameChange(e.target.value)}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => onNameCommit?.(e.target.value)}
        placeholder="Item title"
        className="w-full appearance-none text-2xl font-semibold outline-none placeholder:text-gray-400 transition-colors focus:text-accent focus:placeholder:text-accent/65"
      />
      <TextareaAutosize
        value={subtitle}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onSubtitleChange(e.target.value)}
        placeholder="Optional subtitle or short description"
        className="mt-2 w-full bg-transparent text-sm leading-6 resize-none outline-none placeholder:text-gray-400 transition-colors focus:text-accent focus:placeholder:text-accent/65"
        minRows={1}
      />
    </div>
  );
}

function CardRenderer(props: {
  item: Item;
  onUpdateData: (updater: (prev: ItemData) => ItemData) => void;
  onToggleTag: (tag: string) => void;
}) {
  const { item, onUpdateData, onToggleTag } = props;

  if (item.type === "note") {
    const d = item.data as NoteData;
    return (
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-gray-500">Field 1 (textarea)</label>
        <TextareaAutosize
          value={d.field1 ?? ""}
          onChange={(e) => onUpdateData(() => ({ field1: e.target.value }))}
          placeholder="Write note..."
          className="min-h-40 w-full resize-none rounded-md border bg-white/60 p-3 text-sm leading-6 outline-none placeholder:text-gray-400 transition-colors hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10 focus:text-accent focus:placeholder:text-accent/65"
          minRows={6}
        />
      </div>
    );
  }

  if (item.type === "chart") {
    const d = item.data as ChartData;
    return (
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Field 1 (metrics)</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            onClick={() => onUpdateData((prev) => chartAddField1Metric(prev as ChartData, "", "").next)}
          >
            <Plus className="size-3.5" />
            Add new
          </button>
        </div>
        <div className="space-y-3">
          {(!d.field1 || d.field1.length === 0) && (
            <div className="grid place-items-center py-1.75 text-xs text-primary/50 font-medium text-pretty">
              Nothing here yet. Add a metric to get started.
            </div>
          )}
          {d.field1.map((m, i) => {
            const number = String(m.id ?? String(i + 1)).padStart(3, "0");
            return (
            <div key={m.id ?? `metric-${i}`} className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted-foreground/80">{number}</span>
              <input
                value={m.label}
                placeholder="Metric label"
                onChange={(e) => onUpdateData((prev) => chartSetField1Label(prev as ChartData, i, e.target.value))}
                className="w-25 rounded-md border px-2 py-1 text-sm outline-none transition-colors placeholder:text-gray-400 hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10 focus:text-accent focus:placeholder:text-accent/65"
              />
              <div className="flex items-center gap-3 flex-1">
                <Progress value={m.value || 0} />
              </div>
              <input
                className={cn(
                  "w-10 rounded-md border px-2 py-1 text-xs outline-none appearance-none [-moz-appearance:textfield]",
                  "[&::-webkit-outer-spin-button]:[-webkit-appearance:none] [&::-webkit-outer-spin-button]:m-0",
                  "[&::-webkit-inner-spin-button]:[-webkit-appearance:none] [&::-webkit-inner-spin-button]:m-0",
                  "transition-colors hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm",
                  "focus:bg-accent/10 focus:text-accent font-mono",
                )}
                type="number"
                min={0}
                max={100}
                value={m.value}
                onChange={(e) => onUpdateData((prev) => chartSetField1Value(prev as ChartData, i, e.target.value === "" ? "" : Number(e.target.value)))}
                placeholder="0"
              />
              <button
                type="button"
                aria-label="Delete metric"
                className="text-gray-400 hover:text-accent"
                onClick={() => onUpdateData((prev) => chartRemoveField1Metric(prev as ChartData, i))}
              >
                <X className="h-5 w-5 md:h-6 md:w-6" />
              </button>
            </div>
          );})}
        </div>
      </div>
    );
  }

  if (item.type === "project") {
    const d = item.data as ProjectData;
    const set = (partial: Partial<ProjectData>) => onUpdateData((prev) => ({ ...(prev as ProjectData), ...partial }));
    return (
      <div className="mt-4 @container">
        {/* Field 1 full width */}
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-gray-500">Field 1 (Text)</label>
          <input
            value={d.field1}
            onChange={(e) => set({ field1: e.target.value })}
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none transition-colors placeholder:text-gray-400 hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10 focus:text-accent focus:placeholder:text-accent/65"
            placeholder="Field 1 value"
          />
        </div>
        {/* Row 2 split */}
        <div className="contents @xs:grid gap-3 md:grid-cols-2">
          <div className="@max-xs:mb-3">
            <label className="mb-1 block text-xs font-medium text-gray-500">Field 2 (Select)</label>
            <select
              value={d.field2}
              onChange={(e) => set({ field2: e.target.value })}
              required
              className="w-full rounded-md border px-2 py-1.5 text-sm outline-none transition-colors hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10 focus:text-accent invalid:text-gray-400"
            >
              <option value="">Select...</option>
              {["Option A", "Option B", "Option C"].map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Field 3 (Date)</label>
            <input
              type="date"
              value={d.field3}
              onChange={(e) => set({ field3: e.target.value })}
              required
              className="w-full rounded-md border px-2 py-1.5 text-sm outline-none transition-colors hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10 focus:text-accent invalid:text-gray-400"
            />
          </div>
        </div>
        {/* Checklist */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-500">Field 4 (checklist)</label>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              onClick={() => onUpdateData((prev) => projectAddField4Item(prev as ProjectData, "").next)}
            >
              <Plus className="size-3.5" />
              Add new
            </button>
          </div>
          <div className="space-y-2">
            {(!d.field4 || d.field4.length === 0) && (
              <div className="grid place-items-center py-1.75 text-xs text-primary/50 font-medium text-pretty">
                Nothing here yet. Add a checklist item to get started.
              </div>
            )}
            {(d.field4 ?? []).map((c, i) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground/80">{String(c.id ?? String(i + 1)).padStart(3, "0")}</span>
                <input
                  type="checkbox"
                  checked={!!c.done}
                  onChange={(e) => onUpdateData((prev) => projectSetField4ItemDone(prev as ProjectData, c.id, e.target.checked))}
                  className="h-4 w-4"
                />
                <input
                  value={c.text}
                  placeholder="Checklist item label"
                  onChange={(e) => onUpdateData((prev) => projectSetField4ItemText(prev as ProjectData, c.id, e.target.value))}
                  className="flex-1 rounded-md border px-2 py-1 text-sm outline-none transition-colors placeholder:text-gray-400 hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:bg-accent/10 focus:text-accent focus:placeholder:text-accent/65"
                />
                <button
                  type="button"
                  aria-label="Delete checklist item"
                  className="text-gray-400 hover:text-accent"
                  onClick={() => onUpdateData((prev) => projectRemoveField4Item(prev as ProjectData, c.id))}
                >
                  <X className="h-5 w-5 md:h-6 md:w-6" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Entity card
  const e = item.data as EntityData;
  const setEntity = (partial: Partial<EntityData>) => onUpdateData((prev) => ({ ...(prev as EntityData), ...partial }));
  return (
    <div className="mt-4">
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-gray-500">Field 1 (Text)</label>
        <input
          value={e.field1}
          onChange={(ev) => setEntity({ field1: ev.target.value })}
          className="w-full rounded-md border px-2 py-1.5 text-sm outline-none transition-colors placeholder:text-gray-400 hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10 focus:text-accent focus:placeholder:text-accent/65"
          placeholder="Field 1 value"
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-gray-500">Field 2 (Select)</label>
        <select
          value={e.field2}
          onChange={(ev) => setEntity({ field2: ev.target.value })}
          required
          className="w-full rounded-md border px-2 py-1.5 text-sm outline-none transition-colors hover:ring-1 hover:ring-border focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10 focus:text-accent invalid:text-gray-400"
        >
          <option value="">Select...</option>
          {["Option A", "Option B", "Option C"].map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-gray-500">Field 3 (Tags)</label>
        <div className="flex flex-wrap gap-2">
          {(e.field3_options ?? []).map((t) => {
            const active = (e.field3 ?? []).includes(t);
            return (
              <button
                key={t}
                onClick={() => onToggleTag(t)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  active ? "bg-accent/20 border-accent text-accent" : "text-gray-600"
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Select<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[] | string[];
  onChange: (value: T) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <div className="flex h-9 items-center gap-1 rounded-md border px-2">
      <span className="text-[11px] text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T)}
        className="h-7 appearance-none bg-transparent pl-1 pr-4 text-sm outline-none"
      >
        {options.map((opt) => (
          <option key={String(opt)} value={String(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    </div>
  );
}

function TagEditor(props: { tags: string[]; onAdd: (tag: string) => void; onRemove: (tag: string) => void }) {
  const { tags, onAdd, onRemove } = props;
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onAdd((e.target as HTMLInputElement).value);
      (e.target as HTMLInputElement).value = "";
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      {tags.map((t: string) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
          {t}
          <button className="text-gray-500" onClick={() => onRemove(t)} aria-label={`Remove ${t}`}>
            ×
          </button>
        </span>
      ))}
      <input
        onKeyDown={handleKeyDown}
        placeholder="Add tag and press Enter"
        className="min-w-32 flex-1 rounded-md px-1 text-sm outline-none"
      />
    </div>
  );
}

function AddChecklistInput(props: { onAdd: (text: string) => void }) {
  const { onAdd } = props;
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onAdd((e.target as HTMLInputElement).value);
      (e.target as HTMLInputElement).value = "";
    }
  };
  return (
    <input
      onKeyDown={onKeyDown}
      placeholder="+ Add item and press Enter"
      className="w-full rounded-md border px-2 py-1 text-sm outline-none"
    />
  );
}

function LinkList(props: {
  links: LinkItem[];
  onChange: (next: LinkItem[]) => void;
}) {
  const { links, onChange } = props;

  const add = () => {
    const title = window.prompt("Link title");
    const url = window.prompt("Link URL (https://…)");
    if (!title || !url) return;
    try {
      // basic validation
      // eslint-disable-next-line no-new
      new URL(url);
      onChange([...links, { title, url }]);
    } catch {
      // ignore invalid URL
    }
  };

  const removeAt = (idx: number) => {
    const next = links.slice(0, idx).concat(links.slice(idx + 1));
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {links.length === 0 && <p className="text-xs text-gray-500">No links yet.</p>}
      {links.map((l, i) => (
        <div key={`${l.title}-${i}`} className="flex items-center justify-between gap-2 rounded-md border p-2">
          <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-sm text-blue-600 underline">
            {l.title}
          </a>
          <button onClick={() => removeAt(i)} className="rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
            Remove
          </button>
        </div>
      ))}
      <button onClick={add} className="rounded-md border px-3 py-1 text-xs text-gray-700 hover:bg-gray-50">
        + Add link
      </button>
    </div>
  );
}
