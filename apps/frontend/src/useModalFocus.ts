import { onMounted, onUnmounted, type Ref } from "vue";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

interface ModalFocusOptions {
  /** The dialog element that keeps focus while it is open. */
  container: Ref<HTMLElement | undefined>;
  /** Element focused on open; the first focusable element when omitted or not rendered. */
  initialFocus?: Ref<HTMLElement | undefined>;
  /** Called on Escape. */
  onEscape: () => void;
}

/**
 * Keyboard behaviour for a modal dialog: moves focus in on open, keeps Tab
 * inside, handles Escape, and returns focus to the opener on close.
 *
 * The listener runs in the window's capture phase and stops Escape and Tab
 * there, so a dialog opened on top of another one (for example over the mod
 * details panel) is the only one that reacts.
 */
export function useModalFocus({ container, initialFocus, onEscape }: ModalFocusOptions): void {
  let previousActiveElement: Element | null = null;
  let movingBackwards = false;

  function focusable(): HTMLElement[] {
    return container.value === undefined ? [] : [...container.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== "Tab" || container.value === undefined) {
      return;
    }
    event.stopPropagation();
    movingBackwards = event.shiftKey;
    const elements = focusable();
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const inside = active !== null && container.value.contains(active);
    if (event.shiftKey && (!inside || active === first)) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && (!inside || active === last)) {
      first.focus();
      event.preventDefault();
    }
  }

  // The keydown check only sees the first and last element. The browser can
  // still move focus out on its own (Tab skips the rest of a radio group, a
  // click lands on the backdrop), so anything that lands outside is pulled back.
  function handleFocusIn(event: FocusEvent): void {
    if (container.value === undefined || !(event.target instanceof Node) || container.value.contains(event.target)) {
      return;
    }
    const elements = focusable();
    (movingBackwards ? elements[elements.length - 1] : elements[0])?.focus();
  }

  onMounted(() => {
    previousActiveElement = document.activeElement;
    window.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    (initialFocus?.value ?? focusable()[0])?.focus();
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown, true);
    document.removeEventListener("focusin", handleFocusIn, true);
    if (previousActiveElement instanceof HTMLElement && previousActiveElement.isConnected) {
      previousActiveElement.focus();
    }
  });
}
