import { createContext, type ReactNode, useContext, useState } from "react";

const DisclosureContext = createContext<{
  open: ReadonlySet<string>;
  toggle: (id: string, open: boolean) => void;
} | null>(null);

// Keep choices even when a reading temporarily disappears during a retry.
export function DisclosureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  function toggle(id: string, expanded: boolean) {
    setOpen((current) => {
      if (current.has(id) === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  return <DisclosureContext value={{ open, toggle }}>{children}</DisclosureContext>;
}

export function Disclosure({
  id,
  className,
  summary,
  children,
}: {
  id: string;
  className: string;
  summary: string;
  children: ReactNode | ((open: boolean) => ReactNode);
}) {
  const context = useContext(DisclosureContext);
  if (!context) throw new Error("Disclosures require a provider.");
  const open = context.open.has(id);
  return (
    <details
      id={id}
      className={className}
      open={open}
      onToggle={(event) => context.toggle(id, event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {typeof children === "function" ? children(open) : children}
    </details>
  );
}
