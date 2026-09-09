/**
 * The smallest element builder that stops three screens hand-writing `document.createElement`
 * plus six property assignments per node.
 *
 * Screens build their markup in `enter()` and strip it in `exit()`, so this is deliberately
 * plain: it returns real elements with no framework, no reconciliation and nothing retained.
 * Anything that needs to survive a frame is held by the screen that made it.
 */

type Props = {
  readonly class?: string;
  readonly text?: string;
  readonly html?: string;
  readonly type?: string;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly style?: Readonly<Record<string, string>>;
  readonly attrs?: Readonly<Record<string, string>>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  // Only ever fed literals from this codebase -- never player input, never a network string.
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.type && node instanceof HTMLButtonElement) node.type = props.type as "button";
  if (props.disabled !== undefined && "disabled" in node) {
    (node as HTMLButtonElement).disabled = props.disabled;
  }
  if (props.title) node.title = props.title;
  for (const [k, v] of Object.entries(props.style ?? {})) node.style.setProperty(k, v);
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

/**
 * Adds a listener and hands back the function that removes it.
 *
 * Screens collect these and run them all on `exit()`. A screen is rebuilt on every entry, so a
 * listener left attached to a node that has been detached keeps that whole subtree -- and its
 * closure -- alive: the DOM half of exactly the leak the Phase 1.75 memory gate looks for.
 */
export function on<K extends keyof GlobalEventHandlersEventMap>(
  target: HTMLElement | Window,
  event: K,
  handler: (ev: GlobalEventHandlersEventMap[K]) => void,
): () => void {
  target.addEventListener(event, handler as EventListener);
  return () => target.removeEventListener(event, handler as EventListener);
}
