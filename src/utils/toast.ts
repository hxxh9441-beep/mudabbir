// src/utils/toast.ts
// إشعارٌ بسيط بلا مكتبة: أيُّ جزءٍ من التطبيق يستدعي `notify(...)` فيظهره
// `ToastHost`. الغرض الأول: ألّا يفشل الحفظ بصمت (كان يُكتفى بـconsole.error).

export type ToastKind = 'error' | 'success' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** زرّ اختياريّ (مثل «إعادة المحاولة») */
  action?: { label: string; run: () => void };
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(items));

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l(items);
  return () => {
    listeners.delete(l);
  };
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function notify(
  message: string,
  kind: ToastKind = 'info',
  opts: { action?: ToastItem['action']; ms?: number } = {},
): number {
  const id = nextId++;
  items = [...items, { id, kind, message, action: opts.action }];
  emit();
  // الأخطاء لا تختفي وحدها إن كان فيها إجراء
  const ms = opts.ms ?? (kind === 'error' ? (opts.action ? 0 : 8000) : 3500);
  if (ms > 0) window.setTimeout(() => dismissToast(id), ms);
  return id;
}
